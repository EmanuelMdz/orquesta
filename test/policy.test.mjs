import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeRelative,applyChanges,validatePlan } from '../dist/policy.js';
import { defaults } from '../dist/config.js';
import { Store } from '../dist/store.js';
import { execute,cleanEnvironment } from '../dist/process.js';
test('rejects traversal, controls and Windows path aliases',()=>{
  for(const path of ['../outside','/absolute','C:/outside','a\\b','.git/config','.env','a/../b','x/CON.txt','file.','file ','a//b','AGENTS.md','.orquesta/state'])assert.throws(()=>safeRelative(path),undefined,path);
  assert.equal(safeRelative('src/auth/service.ts'),'src/auth/service.ts');
});
test('validates whole change batch before writes',()=>{
  const root=mkdtempSync(join(tmpdir(),'orquesta-policy-'));try{mkdirSync(join(root,'src'));writeFileSync(join(root,'src','a.js'),'original');assert.throws(()=>applyChanges(root,[{path:'src/a.js',content:'changed',action:'write'},{path:'src/b.js',content:'not allowed',action:'write'}],['src/a.js']));assert.equal(readFileSync(join(root,'src','a.js'),'utf8'),'original');}finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects a junction escaping the worktree',()=>{
  const root=mkdtempSync(join(tmpdir(),'orquesta-link-')),outside=mkdtempSync(join(tmpdir(),'orquesta-outside-'));
  try{symlinkSync(outside,join(root,'escape'),process.platform==='win32'?'junction':'dir');assert.throws(()=>applyChanges(root,[{path:'escape/a',content:'x',action:'write'}],['escape/a']),/simbólico/);}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
const task=(id,dependsOn=[])=>({id,title:id,description:id,allowedPaths:['src/'+id+'.js'],dependsOn,acceptance:['works']});
test('rejects cycles, missing dependencies and QA scope',()=>{
  assert.throws(()=>validatePlan({tasks:[task('a',['b']),task('b',['a'])]},defaults),/cíclicas/);
  assert.throws(()=>validatePlan({tasks:[task('a',['missing'])]},defaults),/inexistente/);
  assert.throws(()=>validatePlan({tasks:[{...task('a'),allowedPaths:['test/orquesta/a.test.js']}]},defaults),/pruebas/);
});
test('event storage redacts secrets without corrupting JSON',()=>{
  const dir=mkdtempSync(join(tmpdir(),'orquesta-store-'));const store=new Store(dir);
  try{store.event({runId:'r',time:'now',role:'system',type:'test',message:'password="example-secret"',data:{key:'sk-ant-abcdefghijklmnopqrstuv'}});const event=store.events('r')[0];assert(!JSON.stringify(event).includes('example-secret'));assert(!JSON.stringify(event).includes('sk-ant-'));assert.equal(event.seq,1);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('commands time out and cancellation terminates the child',async()=>{
  await assert.rejects(execute(process.execPath,['-e','setTimeout(()=>{},30000)'],{timeoutMs:100}),/agotado/);
  const controller=new AbortController();const promise=execute(process.execPath,['-e','setTimeout(()=>{},30000)'],{signal:controller.signal});setTimeout(()=>controller.abort(),100);await assert.rejects(promise,/pausada/);
});
test('test subprocess environment excludes model credentials',()=>{
  process.env.ORQUESTA_TEST_SECRET='do-not-forward';try{assert.equal(cleanEnvironment().ORQUESTA_TEST_SECRET,undefined);}finally{delete process.env.ORQUESTA_TEST_SECRET;}
});
test('nested test execution does not inherit the parent runner protocol',()=>{
  const original=process.env.NODE_TEST_CONTEXT;process.env.NODE_TEST_CONTEXT='child-v8';try{assert.equal(cleanEnvironment().NODE_TEST_CONTEXT,undefined);}finally{if(original===undefined)delete process.env.NODE_TEST_CONTEXT;else process.env.NODE_TEST_CONTEXT=original;}
});
