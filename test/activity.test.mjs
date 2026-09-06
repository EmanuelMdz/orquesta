import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Engine } from '../dist/engine.js';
import { createDemo } from '../dist/demo.js';
import { defaults } from '../dist/config.js';
import { startServer } from '../dist/server.js';
import { CliProvider } from '../dist/providers.js';

async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Timed out waiting for activity');}
async function view(t,configure){
  const root=mkdtempSync(join(tmpdir(),'orquesta-map-')),repo=await createDemo(root);
  let calls=0;const engine=new Engine(repo,{...defaults,workers:2},{invoke:()=>{calls++;throw Error('UI must not call a provider');}});
  const run=await engine.create('Título breve\n\n'+('Instrucciones completas. '.repeat(200)));
  configure(run);engine.store.save(run);
  const server=await startServer(engine);
  const dom=new JSDOM(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),{url:server.url,runScripts:'outside-only'}),w=dom.window;
  const requests=[];
  w.fetch=(path,options)=>{requests.push({path,method:options?.method||'GET'});return fetch(server.origin+path,options);};
  w.TextDecoder=TextDecoder;w.AbortController=AbortController;
  t.after(async()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();await server.close();await engine.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  w.eval(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'));
  await until(()=>w.document.getElementById('connection').textContent.includes('Conectado'));
  return{w,engine,run,requests,calls:()=>calls};
}
test('blocked planning keeps configured workers visible and the full objective collapsed without model calls',async t=>{
  const{w,engine,run,requests,calls}=await view(t,run=>{run.status='blocked';run.calls=1;run.error='Opus no puede modificar las pruebas de Astra';});
  const d=w.document;
  assert.equal(d.getElementById('goal').textContent,'Título breve');
  assert.equal(d.getElementById('full-objective').textContent,run.objective);
  assert.equal(d.getElementById('objective-details').open,false);assert.equal(d.getElementById('new-work').open,false);
  assert.equal(d.querySelectorAll('.map-node.worker').length,2);assert.equal(d.querySelectorAll('.map-node.busy').length,0);
  assert.match(d.querySelector('[data-agent="astra"]').textContent,/Plan bloqueado/);
  assert.match(d.querySelector('[data-agent="worker:1"]').textContent,/Sin tareas/);
  d.querySelector('[data-agent="worker:1"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  d.getElementById('objective-details').open=true;d.getElementById('show-logs').click();d.getElementById('feed-all').click();
  assert(requests.every(request=>request.method==='GET'));assert.equal(calls(),0);assert.equal(engine.store.get(run.id).calls,1);
});
test('stagnation is explained in the panel with no blind retry and no provider calls',async t=>{
  const{w,engine,run,calls}=await view(t,run=>{
    run.status='blocked';run.error='Hay tareas bloqueadas o dependencias pendientes.';
    run.tasks=[{id:'fix',title:'Arreglar cálculo',description:'',allowedPaths:['src/add.js'],acceptance:[],dependsOn:[],checks:[],attempts:3,questions:0,workerId:1,status:'blocked',error:'Sin avance tras cambiar el enfoque',corrections:{context:'x',history:[],stalledRounds:2,stopped:true}}];
  });
  assert.match(w.document.getElementById('recovery-title').textContent,/repetición sin avance/);
  assert.equal(w.document.getElementById('resume').hidden,true);
  assert.equal(w.document.getElementById('cfg-corrections'),null);
  engine.event(run,'astra','task.replanning','Verificar primero el cálculo intermedio.','fix');
  await until(()=>w.document.getElementById('feed').textContent.includes('Cambio de enfoque'));
  assert.match(w.document.getElementById('feed').textContent,/Astra → Opus 1/);assert.equal(calls(),0);
});

test('real SSE updates the map and Astra/System/Opus conversation with no extra agent work',async t=>{
  const{w,engine,run,requests,calls}=await view(t,run=>{
    run.status='running';run.calls=3;
    run.tasks=[{id:'first',workerId:1,title:'Primera tarea',status:'implementing',checks:[],acceptance:[]},{id:'second',workerId:2,title:'Segunda tarea',status:'queued',checks:[],acceptance:[]}];
  });
  const d=w.document;
  engine.event(run,'opus','provider.started','opus · implement','first',{phase:'implement'});
  engine.event(run,'opus','provider.model','Modelo informado: claude-opus-5','first',{resolvedModel:'claude-opus-5'});
  engine.event(run,'opus','provider.progress','Actividad recibida del agente','first',{lastActivityAt:new Date().toISOString()});
  engine.event(run,'astra','agent.message','Mensaje disponible de Astra');
  engine.event(run,'system','workspace.preparing','Entorno del segundo agente','second');
  await until(()=>d.querySelector('[data-agent="worker:1"]').classList.contains('busy'));
  assert.equal(d.querySelector('[data-agent="worker:2"]').classList.contains('busy'),false);
  assert(d.querySelector('[data-agent="system"]').classList.contains('busy'));
  assert.match(d.getElementById('live-text').textContent,/Opus 1/);
  assert.match(d.getElementById('live-progress').textContent,/Opus 1: última señal/);
  engine.event(run,'opus','agent.result','Implementación lista','first');
  engine.event(run,'opus','decision.requested','Consulta del primer agente','first');
  engine.event(run,'astra','decision.answered','Respuesta de Astra','first');
  await until(()=>d.getElementById('feed').textContent.includes('Respuesta de Astra'));
  assert.match(d.getElementById('feed').textContent,/Opus 1 → Astra/);
  assert.match(d.getElementById('feed').textContent,/Astra → Opus 1/);
  d.querySelector('[data-agent="worker:1"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  assert.match(d.getElementById('agent-detail').textContent,/Modelo informado: claude-opus-5/);
  assert(d.getElementById('feed').textContent.includes('Respuesta de Astra'));
  assert(!d.getElementById('feed').textContent.includes('Entorno del segundo agente'));
  d.getElementById('feed-all').click();assert(d.getElementById('feed').textContent.includes('Entorno del segundo agente'));
  run.status='paused';engine.store.save(run);engine.event(run,'system','run.paused','Pausa');
  await until(()=>d.querySelectorAll('.map-node.busy').length===0);
  assert.equal(d.getElementById('live-status').hidden,true);
  assert(requests.every(request=>request.method==='GET'));assert.equal(calls(),0);assert.equal(engine.store.get(run.id).calls,3);
});

test('legacy five-task runs show two workers, three queued tasks and actionable timeout recovery',async t=>{
  const{w,engine,run,requests,calls}=await view(t,run=>{
    run.status='blocked';run.calls=11;delete run.config.agentTimeoutMs;
    run.error='Hay tareas bloqueadas o dependencias pendientes. Revisá los eventos.';
    run.tasks=Array.from({length:5},(_,i)=>({id:'task'+i,title:'Entrega '+i,status:i<2?'blocked':'queued',attempts:0,questions:0,checks:[],acceptance:[],dependsOn:i<2?[]:['task0'],error:i<2?'Tiempo de espera agotado (300000 ms)':undefined}));
  });
  const d=w.document;
  assert.equal(d.querySelectorAll('.map-node.worker').length,2);
  assert.equal(d.querySelector('[data-agent="worker:3"]'),null);
  assert.equal(d.getElementById('queue-summary').textContent,'3 tareas pendientes');
  assert.equal(d.querySelectorAll('#queue-list li').length,3);
  assert.match(d.getElementById('recovery-message').textContent,/2 tareas interrumpidas.*5 min/);
  assert.match(d.getElementById('recovery-hint').textContent,/no tienen un tope de duración/);
  assert.match(d.getElementById('recovery-hint').textContent,/usa llamadas de modelos/);
  assert.match(d.getElementById('run-error').textContent,/Entrega 0: Tiempo de espera/);
  assert.equal(d.getElementById('resume').textContent,'Reintentar pendientes →');
  assert.equal(engine.store.get(run.id).config.agentTimeoutMs,undefined,'Viewing old history must not rewrite it');
  assert.equal(calls(),0);assert(requests.every(request=>request.method==='GET'));
  let starts=0;engine.start=async id=>{assert.equal(id,run.id);starts++;};
  d.getElementById('resume').click();d.getElementById('resume').click();
  await until(()=>starts===1&&!d.getElementById('resume').disabled);
  assert.equal(requests.filter(request=>request.path==='/api/resume').length,1);
  assert.equal(engine.store.get(run.id).calls,11);
});

test('legacy sequential task events reuse display slots rather than creating more agents',async t=>{
  const{w,engine,run}=await view(t,run=>{
    run.status='running';run.tasks=Array.from({length:4},(_,i)=>({id:'t'+i,title:'Tarea '+i,status:i<2?'integrated':'implementing',checks:[],acceptance:[],dependsOn:[]}));
  });
  for(const id of ['t0','t1'])engine.event(run,'opus','task.started',id,id);
  for(const id of ['t0','t1'])engine.event(run,'system','task.integrated',id,id);
  for(const id of ['t2','t3']){engine.event(run,'opus','task.started',id,id);engine.event(run,'opus','provider.started','opus · implement',id,{phase:'implement'});}
  engine.event(run,'opus','agent.result','Consulta','t2');engine.event(run,'opus','task.started','Segunda llamada de la misma tarea','t2');engine.event(run,'opus','provider.started','opus · implement','t2',{phase:'implement'});
  await until(()=>w.document.querySelectorAll('.map-node.worker.busy').length===2);
  assert.equal(w.document.querySelectorAll('.map-node.worker').length,2);
  assert.match(w.document.querySelector('[data-agent="worker:1"]').textContent,/Tarea 2/);
  assert.match(w.document.querySelector('[data-agent="worker:2"]').textContent,/Tarea 3/);
});
test('provider telemetry forwards existing messages and tool events without exposing reasoning or structured code',async t=>{
  const root=mkdtempSync(join(tmpdir(),'orquesta-telemetry-'));t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200}));
  for(const name of ['codex','claude']){
    const cwd=join(root,name);mkdirSync(cwd);const fake=join(cwd,'provider.js');
    const response={summary:'Resultado estructurado',files:[{path:'private.js',content:'FULL_CODE_SHOULD_NOT_BE_A_MESSAGE'}]};
    const trace=name==='codex'?[
      {type:'item.completed',item:{type:'reasoning',text:'PRIVATE_REASONING'}},
      {type:'item.completed',item:{type:'agent_message',text:'Mensaje observable'}},
      {type:'item.started',item:{type:'command_execution',command:'git status'}},
      {type:'item.completed',item:{type:'command_execution',command:'git status',exit_code:0,aggregated_output:'ok'}},
      {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(response)}}
    ]:[{type:'assistant',message:{content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:'Mensaje observable'},{type:'text',text:JSON.stringify(response)}]}},{type:'result',structured_output:response}];
    writeFileSync(fake,`const fs=require('node:fs');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{fs.writeFileSync('input.txt',input);for(const event of ${JSON.stringify(trace)})console.log(JSON.stringify(event));});`);
    const provider=new CliProvider({...defaults,orchestratorProvider:name,codexPath:fake,claudePath:fake});
    const events=[],prompt='Original prompt, unchanged.';
    const result=await provider.invoke({role:'astra',phase:'plan',cwd,prompt,schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}},additionalProperties:true},signal:new AbortController().signal,run:{},onEvent:(type,message,data)=>events.push({type,message,data})});
    assert.deepEqual(result.value,response);assert.equal(readFileSync(join(cwd,'input.txt'),'utf8'),prompt);
    assert.deepEqual(events.filter(event=>event.type==='agent.message').map(event=>event.message),['Mensaje observable']);
    assert(!JSON.stringify(events).includes('PRIVATE_REASONING'));assert(!JSON.stringify(events).includes('FULL_CODE_SHOULD_NOT_BE_A_MESSAGE'));
    assert.equal(events.find(event=>event.type==='provider.started').data.phase,'plan');
    if(name==='codex')assert(events.some(event=>event.type==='tool.completed'&&event.data.exitCode===0));
  }
});

test('agent responses have a separate timeout from commands and still stop at their configured limit',async t=>{
  const root=mkdtempSync(join(tmpdir(),'orquesta-timeout-'));t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200}));
  const fake=join(root,'provider.js');
  writeFileSync(fake,`process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>console.log(JSON.stringify({type:'result',structured_output:{summary:'ok'}})),250));`);
  const events=[],request={role:'opus',phase:'implement',cwd:root,prompt:'Exact request',schema:{type:'object'},signal:new AbortController().signal,run:{},onEvent:(type,message,data)=>events.push({type,message,data})};
  const result=await new CliProvider({...defaults,claudePath:fake,timeoutMs:50,agentTimeoutMs:3000}).invoke(request);
  assert.equal(result.value.summary,'ok');assert.equal(events[0].data.timeoutMs,3000);
  await assert.rejects(new CliProvider({...defaults,claudePath:fake,timeoutMs:3000,agentTimeoutMs:100}).invoke(request),/Tiempo de espera agotado \(100 ms\)/);
  const legacy={...defaults,claudePath:fake};delete legacy.agentTimeoutMs;events.length=0;
  await new CliProvider(legacy).invoke(request);assert.equal(events[0].data.timeoutMs,0);assert.equal(events[0].data.idleTimeoutMs,900000);
});

test('answer form keeps failed drafts and acknowledges sending with exactly one continuation request',async t=>{
  const{w,engine,run}=await view(t,run=>{run.status='waiting_user';run.tasks=[{id:'question',title:'Decisión',status:'blocked',pendingQuestion:'¿Cuál es la regla?',checks:[],acceptance:[],dependsOn:[]}];});
  let attempts=0,starts=0;const original=w.fetch;
  engine.start=async()=>{starts++;};
  w.fetch=(path,options)=>{
    if(path==='/api/answer'){
      attempts++;const body=JSON.parse(options.body);assert.equal(body.resume,true);assert.equal(body.question,'¿Cuál es la regla?');
      if(attempts===1)return Promise.resolve({ok:false,json:async()=>({error:'Fallo de conexión simulado'})});
    }
    return original(path,options);
  };
  const d=w.document,input=d.getElementById('answer');input.value='Regla confirmada';input.dispatchEvent(new w.Event('input'));
  d.getElementById('answer-form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  await until(()=>d.getElementById('answer-feedback').textContent.includes('No se pudo enviar'));
  assert.equal(input.value,'Regla confirmada');assert.equal(engine.store.get(run.id).decisions.length,0);
  const draftKey=Array.from({length:w.sessionStorage.length},(_,i)=>w.sessionStorage.key(i)).find(key=>key.startsWith('orquesta-answer:'));
  assert.equal(w.sessionStorage.getItem(draftKey),'Regla confirmada');assert.equal(d.getElementById('answer-feedback').hidden,false);
  d.getElementById('answer-form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  d.getElementById('answer-form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  await until(()=>d.getElementById('question-box').hidden);
  assert.equal(attempts,2);assert.equal(starts,1);assert.equal(engine.store.get(run.id).decisions[0].answer,'Regla confirmada');
  assert.equal(w.sessionStorage.getItem(draftKey),null);assert.match(d.getElementById('answer-feedback').textContent,/Respuesta guardada/);
});
