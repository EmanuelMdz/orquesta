import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../dist/engine.js';
import { createDemo } from '../dist/demo.js';
import { defaults,validateConfig } from '../dist/config.js';
import { schemas,validate } from '../dist/schemas.js';
import { runAttention } from '../dist/attention.js';
import { recordCorrection } from '../dist/corrections.js';

async function fixture(t,values,reviewProgress='advancing'){
  const root=mkdtempSync(join(tmpdir(),'orq-corrections-'));const repo=await createDemo(root);
  const requests=[];let index=0;
  const provider={invoke:async r=>{
    requests.push({phase:r.phase,details:JSON.parse(r.prompt.split('\n\n').at(-1)).details});
    const write=(path,content)=>({path,content,action:'write'});let value;
    if(r.phase==='plan')value={summary:'Alcanzar cuatro',tasks:[{id:'value',title:'Valor',description:'value() debe devolver 4.',allowedPaths:['src/value.js'],dependsOn:[],acceptance:['value() devuelve 4']} ]};
    if(r.phase==='implement')value={status:'completed',summary:'Entrega '+index,question:'',files:[write('src/value.js',`export const value = () => ${values[Math.min(index++,values.length-1)]};\n`)]};
    if(r.phase==='tests')value={summary:'Aceptación real de la función',files:[write('test/orquesta/value/acceptance.test.mjs',"import {value} from '../../../src/value.js';\nimport assert from 'node:assert/strict';\nassert.equal(value(),4);\n")]};
    if(r.phase==='review'){
      const passed=r.task.checks.every(c=>c.exitCode===0);
      value={verdict:passed?'approved':'changes_requested',summary:'Revisión '+index,findings:passed?[]:[`Falta resolver etapa ${index}`],progress:r.task.review?reviewProgress:'initial',nextApproach:passed?'':'Usar un cálculo distinto y verificar el valor antes de entregar.'};
    }
    validate(r.schema,value);return{value};
  }};
  let engine=new Engine(repo,{...defaults,maxCorrections:2},provider);
  t.after(async()=>{await engine.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  return{get engine(){return engine;},requests,async reopen(){await engine.close();engine=new Engine(repo,defaults,provider);return engine;}};
}

test('legacy correction limits disappear and advancing work can exceed two corrections',async t=>{
  const f=await fixture(t,[0,1,2,3,4]);const run=await f.engine.create('Correcciones con avance','demo');
  const result=await f.engine.start(run.id);
  assert.equal(result.status,'completed',result.error);assert.equal(result.tasks[0].attempts,4);
  assert.equal(result.config.maxCorrections,undefined);assert.equal(validateConfig({...defaults,maxCorrections:0}).maxCorrections,undefined);
  assert.equal(result.calls,12,'No separate model calls for stagnation tracking or replanning');
  assert.equal(f.engine.store.events(run.id).filter(e=>e.type==='task.replanning').length,0);
  const reviews=f.requests.filter(r=>r.phase==='review');
  assert.match(reviews[1].details.correctionDiff,/value/);assert.equal(reviews[1].details.previousReview.summary,'Revisión 1');
  assert.equal(result.tasks[0].checks.every(c=>c.exitCode===0),true);
});

test('oscillating implementations trigger one changed approach, then stop across process restarts',async t=>{
  const f=await fixture(t,[0,1,0,1]);const run=await f.engine.create('No repetir A B A B','demo');
  const result=await f.engine.start(run.id);const task=result.tasks[0];
  assert.equal(result.status,'blocked');assert.match(task.error,/Sin avance/);assert.equal(task.attempts,4);
  assert.equal(f.engine.store.events(run.id).filter(e=>e.type==='task.replanning').length,1);
  assert.match(f.requests.filter(r=>r.phase==='implement').at(-1).details.changedApproach,/cálculo distinto/);
  assert.equal(runAttention(result).retryAllowed,false);
  assert.equal(readFileSync(join(task.worktree,'src/value.js'),'utf8'),'export const value = () => 1;\n');
  await f.reopen();const retried=await f.engine.start(run.id);
  assert.equal(retried.calls,result.calls,'A repeated resume cannot spend another model call');
  assert.equal(retried.tasks[0].corrections.stopped,true);
  const adjusted=f.engine.store.get(run.id);adjusted.decisions.push({taskId:'value',question:'Evidencia nueva',answer:'Ejemplo verificado de cálculo',source:'user'});f.engine.store.save(adjusted);
  const next=await f.engine.start(run.id);assert(next.calls>result.calls,'New evidence permits a new bounded attempt');
});

test('Astra detects semantic stagnation even when implementations and wording change',async t=>{
  const f=await fixture(t,[0,1,2],'stalled');const run=await f.engine.create('No confundir cambios con avance','demo');
  const result=await f.engine.start(run.id);
  assert.equal(result.tasks[0].attempts,3);assert.equal(result.tasks[0].corrections.stopped,true);
  assert.equal(f.engine.store.events(run.id).filter(e=>e.type==='task.replanning').length,1);
});

test('local evidence catches repeated findings but allows checks to improve',()=>{
  const task={corrections:{context:'test',history:[],stalledRounds:0},review:{progress:'advancing',nextApproach:'Cambiar cálculo'}};
  const revision=(code,failedChecks=['SQL'])=>({sha:code,code,findings:['Falta validar el envío'],failedChecks});
  assert.equal(recordCorrection(task,revision('a')),'continue');
  assert.equal(recordCorrection(task,revision('b')),'replan');
  assert.equal(recordCorrection(task,revision('b',[])),'continue');
  assert.equal(task.corrections.stalledRounds,0);
  assert.equal(recordCorrection(task,revision('b',[])),'replan');
  assert.equal(recordCorrection(task,revision('c',[])),'stop');
  assert.throws(()=>validate(schemas.review,{verdict:'approved',summary:'ok',findings:[]}),/inválida/);
});

test('old correction-limit blocks are resumable after upgrading',()=>{
  const run={status:'blocked',tasks:[{id:'a',title:'Tarea',status:'blocked',error:'Límite de correcciones alcanzado; Astra debe replantear la tarea.'}]};
  assert.equal(runAttention(run).retryAllowed,true);assert.match(runAttention(run).message,/retirado/);
});
