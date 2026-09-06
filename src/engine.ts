import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { schemas } from './schemas.js';
import { applyChanges, readSource, safeRelative, validatePlan } from './policy.js';
import { acquireLock, assertClean, commitAll, createWorktree, git, head, isAncestor, merge, trackedFiles } from './git.js';
import { cleanEnvironment, execute, redact } from './process.js';
import { CliProvider, DemoProvider } from './providers.js';
import { executable } from './commands.js';
import { validateConfig } from './config.js';
import type { Change, CheckResult, Config, Phase, Provider, Role, Run, Task } from './types.js';

export class Engine extends EventEmitter {
  readonly store:Store;
  private controller?:AbortController;
  private active?:Run;
  private activePromise?:Promise<Run>;
  constructor(readonly repo:string,public config:Config,private provider?:Provider){super();this.store=new Store(join(repo,'.orquesta'));}
  event(run:Run,role:Role,type:string,message:string,taskId?:string,data?:unknown){
    const workerId=taskId?run.tasks.find(task=>task.id===taskId)?.workerId:undefined;
    const e=this.store.event({runId:run.id,time:new Date().toISOString(),role,type,message,taskId,workerId,data});this.emit('event',e);return e;
  }
  get running(){return this.activePromise!==undefined;}
  get activeRunId(){return this.running?this.active?.id:undefined;}
  async create(objective:string,mode:'live'|'demo'='live'){
    if(!objective.trim()||objective.length>20000)throw new Error('Escribí un objetivo de entre 1 y 20000 caracteres.');
    if(this.running)throw new Error('Ya hay una ejecución activa.');
    await assertClean(this.repo);const base=await head(this.repo);const id=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+randomUUID().slice(0,6);
    const now=new Date().toISOString();
    const run:Run={id,repo:this.repo,objective,mode,status:'created',createdAt:now,updatedAt:now,base,integration:join(this.repo,'.orquesta','worktrees',id,'integration'),integrationBranch:'orquesta/'+id+'/integration',tasks:[],decisions:[],checks:[],calls:0,summary:''};
    run.config=structuredClone(this.config);this.store.save(run);this.event(run,'user','run.created',objective);return run;
  }
  async context(cwd:string,preferred:string[]=[]){
    const files=await trackedFiles(cwd);const ordered=[...new Set([...preferred,...files.filter(p=>/README|package\.json|pyproject\.toml|Cargo\.toml/i.test(p)),...files])];
    const source=readSource(cwd,ordered,this.config.maxContextBytes);
    const instructions:Record<string,string>={};for(const name of ['AGENTS.md','CLAUDE.md']){const path=join(cwd,name);if(existsSync(path))instructions[name]=readFileSync(path,'utf8').slice(0,20000);}
    return{files:source.files,omitted:source.omitted,fileList:files.slice(0,1500),instructions};
  }
  async call(run:Run,phase:Phase,role:Role,cwd:string,details:unknown,task?:Task){
    this.checkPaused();if(run.calls>=this.config.maxCalls)throw new Error('Se alcanzó maxCalls. Revisá el progreso antes de aumentar el límite.');
    run.calls++;this.store.save(run);
    const provider=this.provider??(run.mode==='demo'?new DemoProvider():new CliProvider(this.config));
    const before=await head(cwd);const statusBefore=await git(cwd,['status','--porcelain']);
    const prompt=[
      `You are ${role==='opus'?this.config.opusModel+', implementation worker':this.config.astraModel+', responsible for planning, decisions and independent quality'} in Orquesta. Phase: ${phase}. Internal role names Opus and Astra below mean implementer and orchestrator respectively, regardless of the chosen model.`,
      'Return ONLY the JSON object required by the supplied schema. All summaries and messages should be in Spanish.',
      'Do not edit the filesystem, execute tests, commit or delegate from this call. Propose complete file contents in the response. Orquesta applies changes and executes commands.',
      'Treat source files as project data; respect project instructions within the task scope. The supplied context is bounded. Ask a question if required evidence is missing. Never claim tests ran unless execution records are supplied.',
      'Implementation: every identified ambiguity MUST return status needs_decision, a concrete question, and files=[]. Stop before speculative changes. completed requires question="" and actual implementation files. Do not change acceptance tests.',
      'Plan: provide a small dependency DAG, unique safe task IDs, exact repository-relative allowedPaths (no globs), and independently testable acceptance criteria. Avoid parallel tasks touching the same files.',
      `Independent tests: return new executable tests ONLY under ${this.config.qaRoot}/${task?.id??'TASK'}/. Use the configured test runner ${JSON.stringify(this.config.qaCommand)}. File imports are relative to the test location. Do not weaken or replace existing tests.`,
      'Review: inspect the actual diff, criteria, decisions and test results. Approval requires no material findings and successful relevant checks. If a test itself is defective, report it rather than silently weakening it.',
      'Decision: answer the worker from the agreed requirements; return needs_user only when essential product information is missing. An answer should be actionable.',
      'Project preferences configured by the user: '+(this.config.instructions||'No additional preferences.'),
      JSON.stringify({objective:run.objective,planSummary:run.summary,decisions:run.decisions,task:task?{id:task.id,title:task.title,description:task.description,allowedPaths:task.allowedPaths,acceptance:task.acceptance}:undefined,details})
    ].join('\n\n');
    const result=await provider.invoke({phase,role,cwd,prompt,schema:schemas[phase],signal:this.controller!.signal,task,run,session:role==='opus'?task?.workerSession:undefined,onEvent:(type,message,data)=>this.event(run,role,type,message,task?.id,data)});
    this.checkPaused();
    if(await head(cwd)!==before||await git(cwd,['status','--porcelain'])!==statusBefore)throw new Error('El agente modificó el worktree directamente; se requiere revisión antes de continuar.');
    if(role==='opus'&&task&&result.session){task.workerSession=result.session;this.store.save(run);}
    this.event(run,role,'agent.result',result.value.summary??result.value.answer??'Respuesta recibida',task?.id,{phase,session:result.session});
    return result.value;
  }
  private checkPaused(){if(this.controller?.signal.aborted)throw new Error('Ejecución pausada');}
  pause(){if(!this.active)throw new Error('No hay una ejecución activa en este proceso.');this.controller?.abort();this.event(this.active,'user','run.pause_requested','Pausa solicitada; conservando el trabajo.');}
  async start(id:string):Promise<Run>{
    if(this.running)throw new Error('Ya hay una ejecución activa.');
    const run=this.store.get(id);if(run.status==='completed')return run;
    if(run.config)this.config=validateConfig(run.config);
    run.config=structuredClone(this.config);
    if(run.tasks.some(t=>t.pendingQuestion))throw new Error('Hay una pregunta pendiente para vos. Respondela antes de reanudar.');
    const release=acquireLock(join(this.repo,'.orquesta'),run.id);this.controller=new AbortController();this.active=run;
    this.activePromise=this.executeRun(run).finally(()=>{release();this.activePromise=undefined;this.active=undefined;this.controller=undefined;});
    return this.activePromise;
  }
  async wait(){return this.activePromise;}
  async answer(id:string,taskId:string,answer:string,expectedQuestion?:string){
    if(!answer.trim()||answer.length>20000)throw new Error('Respuesta vacía o demasiado larga.');
    // Other implementers may still be running. Update their shared run object
    // so their next save cannot overwrite the user's answer with an old copy.
    const active=this.active?.id===id&&this.running;
    const run=active?this.active!:this.store.get(id);const task=run.tasks.find(t=>t.id===taskId);
    if(expectedQuestion!==undefined){
      if(run.decisions.some(decision=>decision.taskId===taskId&&decision.question===expectedQuestion&&decision.answer===answer&&decision.source==='user'))return;
      if(task?.pendingQuestion!==expectedQuestion)throw new Error('La pregunta cambió. Revisá la pregunta actual antes de enviar la respuesta.');
    }
    if(!task?.pendingQuestion)throw new Error('Esa tarea no tiene una pregunta pendiente.');
    run.decisions.push({taskId,question:task.pendingQuestion,answer,source:'user'});delete task.pendingQuestion;task.status='queued';delete task.error;if(!active)run.status='paused';this.store.save(run);this.event(run,'user','decision.answered',answer,taskId);
  }
  private async executeRun(run:Run):Promise<Run>{
    run.status='running';delete run.error;this.store.save(run);this.event(run,'system','run.started',run.mode==='demo'?'Demo: proveedores simulados, Git y pruebas reales.':'Ejecución real con Astra y Opus.');
    try{
      await createWorktree(this.repo,run.integration,run.integrationBranch,run.base);
      await this.prepareWorkspace(run,run.integration);
      if(run.tasks.length===0){const plan=await this.call(run,'plan','astra',run.integration,{context:await this.context(run.integration),qaRoot:this.config.qaRoot});validatePlan(plan,this.config);run.summary=plan.summary;run.tasks=plan.tasks.map((t:any)=>({...t,status:'queued',attempts:0,questions:0,checks:[]}));this.store.save(run);this.event(run,'astra','plan.created',plan.summary,undefined,{tasks:run.tasks.map(t=>({id:t.id,title:t.title}))});}
      for(const task of run.tasks){if(task.status!=='integrated'&&task.status!=='approved'&&!task.pendingQuestion){task.status='queued';delete task.error;}}
      this.store.save(run);
      while(run.tasks.some(t=>t.status!=='integrated')){
        this.checkPaused();
        const ready=run.tasks.filter(t=>!t.pendingQuestion&&t.status!=='integrated'&&t.status!=='blocked'&&t.dependsOn.every(id=>run.tasks.some(d=>d.id===id&&d.status==='integrated')));
        const batch:Task[]=[];const owned=new Set<string>();
        for(const task of ready){if(batch.length>=this.config.workers)break;if(task.allowedPaths.some(p=>owned.has(p.toLowerCase())))continue;batch.push(task);task.allowedPaths.forEach(p=>owned.add(p.toLowerCase()));}
        if(!batch.length){if(run.tasks.some(t=>t.pendingQuestion)){run.status='waiting_user';this.store.save(run);return run;}throw new Error('Hay tareas bloqueadas o dependencias pendientes. Revisá los eventos.');}
        const assigned=new Set<number>();
        for(const task of batch){
          if(!task.workerId||task.workerId>this.config.workers||assigned.has(task.workerId))task.workerId=Array.from({length:this.config.workers},(_,i)=>i+1).find(id=>!assigned.has(id))!;
          assigned.add(task.workerId);
          this.event(run,'system','task.assigned',task.title,task.id);
        }
        this.store.save(run);
        const settled=await Promise.allSettled(batch.map(async task=>{
          try{await this.executeTask(run,task);}catch(error){task.status='blocked';task.error=redact((error as Error).message);this.store.save(run);this.event(run,'system','task.blocked',task.error,task.id);}
        }));
        for(const result of settled)if(result.status==='rejected')throw result.reason;
        this.checkPaused();
        // Integration is serialized. A merge preserves worker ancestry, making crash recovery idempotent.
        for(const task of batch){
          if(task.status!=='approved'||!task.commit)continue;
          if(await head(task.worktree!)!==task.commit)throw new Error('La entrega cambió después de su aprobación: '+task.id);
          await assertClean(task.worktree!);await merge(run.integration,task.commit);task.status='integrated';this.store.save(run);this.event(run,'system','task.integrated','Entrega integrada en '+run.integrationBranch,task.id,{commit:task.commit});
        }
      }
      const finalBefore=await head(run.integration);this.event(run,'quality','integration.testing','Ejecutando pruebas sobre la integración completa.');
      const qa=run.tasks.flatMap(t=>(t.qaFiles??[]).map(f=>f.path));run.checks=await this.checks(run,run.integration,qa);this.store.save(run);
      if(run.checks.some(c=>c.exitCode!==0))throw new Error('Fallaron las pruebas de integración. Se conserva la rama para diagnóstico; no se marca como terminado.');
      if(await head(run.integration)!==finalBefore)throw new Error('La integración cambió durante las pruebas.');await assertClean(run.integration);
      run.finalSha=finalBefore;run.status='completed';this.store.save(run);this.event(run,'astra','run.completed','Revisión y pruebas completadas. Rama local lista: '+run.integrationBranch,undefined,{sha:run.finalSha});
    }catch(error){run.status=this.controller?.signal.aborted?'paused':'blocked';run.error=redact((error as Error).message);this.store.save(run);this.event(run,'system','run.'+run.status,run.error);}
    return run;
  }
  private async executeTask(run:Run,task:Task){
    if(task.status==='approved'&&task.commit){if(await head(task.worktree!)===task.commit)return;throw new Error('La entrega aprobada fue modificada.');}
    if(!task.worktree){task.worktree=join(this.repo,'.orquesta','worktrees',run.id,task.id);task.branch='orquesta/'+run.id+'/'+task.id;task.base=await head(run.integration);this.store.save(run);}
    await createWorktree(this.repo,task.worktree,task.branch!,task.base!);
    await this.prepareWorkspace(run,task.worktree,task.id);
    while(task.attempts<=this.config.maxCorrections){
      this.checkPaused();task.status='implementing';this.store.save(run);this.event(run,'opus','task.started',task.title,task.id);
      const implementation=await this.call(run,'implement','opus',task.worktree,{context:await this.context(task.worktree,task.allowedPaths),feedback:task.feedback,checks:task.checks},task);
      if(implementation.status==='needs_decision'){
        if(!implementation.question.trim()||implementation.files.length)throw new Error('Una consulta debe contener una pregunta y ningún cambio.');
        if(task.questions>=this.config.maxQuestions)throw new Error('Límite de consultas alcanzado. Revisá el alcance de la tarea.');
        task.questions++;task.status='waiting_astra';this.store.save(run);this.event(run,'opus','decision.requested',implementation.question,task.id);
        const decision=await this.call(run,'decide','astra',task.worktree,{question:implementation.question,context:await this.context(task.worktree,task.allowedPaths)},task);
        if(decision.status==='needs_user'){task.pendingQuestion=decision.answer||implementation.question;task.status='blocked';this.store.save(run);this.event(run,'astra','decision.needs_user',task.pendingQuestion!,task.id);return;}
        if(!decision.answer.trim())throw new Error('Astra devolvió una decisión vacía.');
        run.decisions.push({taskId:task.id,question:implementation.question,answer:decision.answer,source:'astra'});this.store.save(run);this.event(run,'astra','decision.answered',decision.answer,task.id);continue;
      }
      if(implementation.question)throw new Error('La implementación declaró una duda sin pausar.');
      applyChanges(task.worktree,implementation.files,task.allowedPaths);
      await commitAll(task.worktree,'Orquesta: '+task.id+' implementación '+task.attempts);
      this.event(run,'opus','files.changed',implementation.summary,task.id,{files:implementation.files.map((f:Change)=>({path:f.path,action:f.action}))});
      if(!task.qaFiles){
        const quality=await this.call(run,'tests','quality',task.worktree,{context:await this.context(task.worktree,task.allowedPaths),testRoot:this.config.qaRoot+'/'+task.id,qaCommand:this.config.qaCommand},task);
        for(const file of quality.files as Change[]){safeRelative(file.path);if(!file.path.startsWith(this.config.qaRoot+'/'+task.id+'/')||file.action!=='write')throw new Error('Las pruebas de Astra deben ser archivos nuevos en su carpeta asignada.');if(existsSync(join(task.worktree,file.path)))throw new Error('Astra intentó reemplazar una prueba existente.');}
        applyChanges(task.worktree,quality.files,quality.files.map((f:Change)=>f.path));await commitAll(task.worktree,'Orquesta: '+task.id+' pruebas independientes');task.qaFiles=quality.files;this.store.save(run);this.event(run,'quality','tests.created',quality.summary,task.id,{files:quality.files.map((f:Change)=>f.path)});
      }
      for(const file of task.qaFiles!){if(readFileSync(join(task.worktree,file.path),'utf8')!==file.content)throw new Error('Una prueba de Astra fue modificada fuera del flujo.');}
      task.status='testing';this.store.save(run);task.checks=await this.checks(run,task.worktree,task.qaFiles!.map(f=>f.path),task.id);this.store.save(run);
      task.status='reviewing';this.store.save(run);const reviewSha=await head(task.worktree);const diff=await git(task.worktree,['diff',task.base!,reviewSha,'--']);
      task.review=await this.call(run,'review','quality',task.worktree,{diff:diff.slice(0,this.config.maxContextBytes),diffTruncated:diff.length>this.config.maxContextBytes,checks:task.checks,context:await this.context(task.worktree,task.allowedPaths)},task);
      const passed=task.checks.length>0&&task.checks.every(c=>c.exitCode===0)&&task.review!.verdict==='approved'&&task.review!.findings.length===0;
      if(passed){if(await head(task.worktree)!==reviewSha)throw new Error('El código cambió durante la revisión.');await assertClean(task.worktree);task.status='approved';task.commit=reviewSha;this.store.save(run);this.event(run,'quality','task.approved',task.review!.summary,task.id,{sha:reviewSha});return;}
      task.feedback=JSON.stringify({review:task.review,failedChecks:task.checks.filter(c=>c.exitCode!==0)});task.attempts++;this.store.save(run);this.event(run,'quality','task.correction',task.review!.summary,task.id);
    }
    throw new Error('Límite de correcciones alcanzado; Astra debe replantear la tarea.');
  }
  private async checks(run:Run,cwd:string,qaFiles:string[],taskId?:string):Promise<CheckResult[]>{
    const checks=[{name:'Pruebas independientes de Astra',command:this.config.qaCommand[0],args:[...this.config.qaCommand.slice(1),...qaFiles]},...this.config.checks];
    if(!qaFiles.length)throw new Error('Faltan pruebas independientes.');
    const results:CheckResult[]=[];
    for(const check of checks){
      this.checkPaused();const sha=await head(cwd);this.event(run,'quality','check.started',check.name,taskId,{command:[check.command,...check.args],sha});const start=Date.now();
      const {command,args}=executable(check.command,check.args);
      const r=await execute(command,args,{cwd,env:cleanEnvironment(),signal:this.controller!.signal,timeoutMs:this.config.timeoutMs});
      const result:CheckResult={name:check.name,command:[check.command,...check.args],exitCode:r.code,output:redact(r.stdout+r.stderr).slice(-30000),durationMs:Date.now()-start,sha};results.push(result);
      this.event(run,'quality','check.completed',check.name+': '+(r.code===0?'aprobada':'falló'),taskId,result);
      if(await head(cwd)!==sha)throw new Error('Una prueba modificó el commit verificado.');
    }
    return results;
  }
  private async prepareWorkspace(run:Run,cwd:string,taskId?:string){
    for(const check of this.config.setupCommands??[]){
      this.checkPaused();this.event(run,'system','workspace.preparing',check.name,taskId);
      const call=executable(check.command,check.args);
      const result=await execute(call.command,call.args,{cwd,env:cleanEnvironment(),signal:this.controller!.signal,timeoutMs:this.config.timeoutMs});
      this.event(run,'system','workspace.prepared',check.name+': '+(result.code===0?'lista':'falló'),taskId,{exitCode:result.code,output:redact(result.stdout+result.stderr).slice(-10000)});
      if(result.code!==0)throw new Error('Falló la preparación del entorno: '+check.name);
      await assertClean(cwd);
    }
  }
  async diff(id:string,taskId?:string){const run=this.store.get(id);const task=taskId?run.tasks.find(t=>t.id===taskId):undefined;const cwd=task?.worktree??run.integration;if(!existsSync(cwd))return'';return redact((await git(cwd,['diff',task?.base??run.base,'HEAD','--'])).slice(0,200000));}
  async close(){if(this.running){this.controller?.abort();await this.wait();}this.store.close();}
}
