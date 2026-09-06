import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../dist/engine.js';
import { DemoProvider } from '../dist/providers.js';
import { createDemo } from '../dist/demo.js';
import { defaults } from '../dist/config.js';
import { head,git } from '../dist/git.js';
import { startServer } from '../dist/server.js';
async function fixture(t,config={},provider=new DemoProvider(1)){
  const root=mkdtempSync(join(tmpdir(),'orq-test-'));const repo=await createDemo(root);const engine=new Engine(repo,{...defaults,...config},provider);
  t.after(async()=>{await engine.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});return{repo,engine};
}
test('full pipeline: two workers, question, failed test, correction, exact commit approval',async t=>{
  const{repo,engine}=await fixture(t);const original=await head(repo);const run=await engine.create('demo','demo');const result=await engine.start(run.id);
  assert.equal(result.status,'completed',result.error);assert.equal(await head(repo),original);assert.equal(await git(repo,['status','--porcelain']),'');
  const events=engine.store.events(run.id);assert(events.some(e=>e.type==='decision.requested'));assert(events.some(e=>e.type==='decision.answered'));assert(events.some(e=>e.type==='check.completed'&&e.data.exitCode===1));assert(events.some(e=>e.type==='task.correction'));
  assert(result.tasks.every(t=>t.status==='integrated'));assert(result.checks.every(c=>c.exitCode===0&&c.sha===result.finalSha));assert.equal(await head(result.integration),result.finalSha);
  assert.match(readFileSync(join(result.integration,'src/greet.js'),'utf8'),/trim/);assert.equal(result.tasks.find(t=>t.id==='saludo').attempts,1);
  assert.deepEqual([...new Set(result.tasks.map(task=>task.workerId))].sort(),[1,2]);
  assert(events.filter(event=>event.role==='opus').every(event=>event.workerId===result.tasks.find(task=>task.id===event.taskId)?.workerId));
  assert.equal(result.calls,11,'Worker identities and activity events must not introduce provider calls');
});
test('pause and resume preserves persisted decisions and existing worktrees',async t=>{
  const{engine}=await fixture(t);const run=await engine.create('pause','demo');delete run.config.agentTimeoutMs;engine.store.save(run);let paused=false;
  engine.on('event',event=>{if(!paused&&event.type==='decision.answered'){paused=true;engine.pause();}});
  const first=await engine.start(run.id);assert.equal(first.status,'paused');assert.equal(first.decisions.length,1);
  assert.equal(first.config.agentTimeoutMs,0);assert.equal(first.config.timeoutMs,300000);
  const second=await engine.start(run.id);assert.equal(second.status,'completed',second.error);assert.equal(second.decisions.length,1);
});
test('a real user question stays pending until explicitly answered',async t=>{
  const base=new DemoProvider(1);const provider={invoke:r=>r.phase==='decide'?Promise.resolve({value:{status:'needs_user',answer:'¿Usamos mundo?'}}):base.invoke(r)};
  const{engine}=await fixture(t,{},provider);const run=await engine.create('question','demo');const first=await engine.start(run.id);assert.equal(first.status,'waiting_user');assert.equal(first.tasks.find(t=>t.id==='saludo').pendingQuestion,'¿Usamos mundo?');await assert.rejects(engine.start(run.id),/pregunta/);
  await engine.answer(run.id,'saludo','Sí, mundo para nombres vacíos.');const result=await engine.start(run.id);assert.equal(result.status,'completed',result.error);assert.equal(result.decisions[0].source,'user');
});

test('a user can answer while another implementer works without losing the decision or duplicating it',async t=>{
  const base=new DemoProvider(1);let releaseSlow,slow=false;
  const provider={invoke:async r=>{
    if(r.phase==='implement'&&r.task.id==='suma'&&!slow){slow=true;await new Promise(resolve=>{releaseSlow=resolve;r.signal.addEventListener('abort',resolve,{once:true});});}
    if(r.phase==='decide')return{value:{status:'needs_user',answer:'¿Usamos mundo?'}};
    return base.invoke(r);
  }};
  const{engine}=await fixture(t,{},provider);const run=await engine.create('Concurrent decision','demo');const working=engine.start(run.id);
  const server=await startServer(engine);t.after(()=>server.close());
  const send=()=>fetch(server.origin+'/api/answer',{method:'POST',headers:{Authorization:'Bearer '+server.token,'Content-Type':'application/json'},body:JSON.stringify({id:run.id,taskId:'saludo',answer:'Usar mundo',question:'¿Usamos mundo?',resume:true})});
  for(let i=0;i<500&&!engine.store.get(run.id).tasks.some(task=>task.pendingQuestion);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert(slow);assert(engine.running);assert(engine.store.get(run.id).tasks.some(task=>task.pendingQuestion));
  try{
    const response=await send();assert.equal(response.status,200);assert.equal((await response.json()).continuing,true);
    assert.equal((await send()).status,200);
    assert.equal(engine.store.get(run.id).decisions.length,1);assert(engine.running);
    assert.equal(engine.store.get(run.id).status,'running');
    await assert.rejects(engine.answer(run.id,'saludo','Respuesta desactualizada','Pregunta anterior'),/pregunta cambió/);
  }finally{releaseSlow();}
  const result=await working;assert.equal(result.status,'completed',result.error);assert.equal(result.decisions.length,1);assert.equal(result.decisions[0].answer,'Usar mundo');
  assert.equal(engine.store.events(run.id).filter(event=>event.type==='decision.answered').length,1);
});
test('review approval cannot override failing executable tests',async t=>{
  const base=new DemoProvider(1);const provider={invoke:async r=>{
    if(r.phase==='review')return{value:{verdict:'approved',summary:'Looks good',findings:[],progress:'advancing',nextApproach:''}};
    const result=await base.invoke(r);
    if(r.phase==='implement'&&r.task.id==='saludo'&&result.value.status==='completed')result.value.files[0].content="export function greet(name) { return 'broken'; }\n";
    return result;
  }};
  const{engine}=await fixture(t,{},provider);const run=await engine.create('gate','demo');const result=await engine.start(run.id);assert.equal(result.status,'blocked');assert.notEqual(result.tasks.find(t=>t.id==='saludo').status,'integrated');assert.equal(result.finalSha,undefined);
  assert.match(result.tasks.find(t=>t.id==='saludo').error,/Sin avance/);
});
test('call budget stops the workflow before additional provider usage',async t=>{
  const{engine}=await fixture(t,{maxCalls:1});const run=await engine.create('budget','demo');const result=await engine.start(run.id);assert.equal(result.status,'blocked');assert.equal(result.calls,1);
});
test('dirty project is rejected before creating worktrees',async t=>{
  const{repo,engine}=await fixture(t);writeFileSync(join(repo,'src/add.js'),'user work');await assert.rejects(engine.create('change'),/sin guardar/);assert.equal(engine.store.list().length,0);
});
