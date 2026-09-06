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
  const{engine}=await fixture(t);const run=await engine.create('pause','demo');let paused=false;
  engine.on('event',event=>{if(!paused&&event.type==='decision.answered'){paused=true;engine.pause();}});
  const first=await engine.start(run.id);assert.equal(first.status,'paused');assert.equal(first.decisions.length,1);
  const second=await engine.start(run.id);assert.equal(second.status,'completed',second.error);assert.equal(second.decisions.length,1);
});
test('a real user question stays pending until explicitly answered',async t=>{
  const base=new DemoProvider(1);const provider={invoke:r=>r.phase==='decide'?Promise.resolve({value:{status:'needs_user',answer:'¿Usamos mundo?'}}):base.invoke(r)};
  const{engine}=await fixture(t,{},provider);const run=await engine.create('question','demo');const first=await engine.start(run.id);assert.equal(first.status,'waiting_user');assert.equal(first.tasks.find(t=>t.id==='saludo').pendingQuestion,'¿Usamos mundo?');await assert.rejects(engine.start(run.id),/pregunta/);
  await engine.answer(run.id,'saludo','Sí, mundo para nombres vacíos.');const result=await engine.start(run.id);assert.equal(result.status,'completed',result.error);assert.equal(result.decisions[0].source,'user');
});
test('review approval cannot override failing executable tests',async t=>{
  const base=new DemoProvider(1);const provider={invoke:r=>r.phase==='review'?Promise.resolve({value:{verdict:'approved',summary:'Looks good',findings:[]}}):base.invoke(r)};
  const{engine}=await fixture(t,{maxCorrections:0},provider);const run=await engine.create('gate','demo');const result=await engine.start(run.id);assert.equal(result.status,'blocked');assert.notEqual(result.tasks.find(t=>t.id==='saludo').status,'integrated');assert.equal(result.finalSha,undefined);
});
test('call budget stops the workflow before additional provider usage',async t=>{
  const{engine}=await fixture(t,{maxCalls:1});const run=await engine.create('budget','demo');const result=await engine.start(run.id);assert.equal(result.status,'blocked');assert.equal(result.calls,1);
});
test('dirty project is rejected before creating worktrees',async t=>{
  const{repo,engine}=await fixture(t);writeFileSync(join(repo,'src/add.js'),'user work');await assert.rejects(engine.create('change'),/sin guardar/);assert.equal(engine.store.list().length,0);
});
