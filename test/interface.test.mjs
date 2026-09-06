import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { Engine } from '../dist/engine.js';
import { createDemo } from '../dist/demo.js';
import { defaults,loadConfig } from '../dist/config.js';
import { DemoProvider } from '../dist/providers.js';
import { startServer } from '../dist/server.js';
import { execute,cleanEnvironment } from '../dist/process.js';
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Timed out waiting for UI state');}
test('dashboard loads API data, switches tabs, selects agents and records user answers safely',async t=>{
  const root=mkdtempSync(join(tmpdir(),'orq-ui-'));const repo=await createDemo(root);const engine=new Engine(repo,defaults,new DemoProvider(1));const run=await engine.create('Objetivo de prueba','demo');
  run.status='waiting_user';run.tasks=[{id:'demo',title:'Backend',description:'Task',allowedPaths:['src/add.js'],dependsOn:[],acceptance:['Works'],status:'blocked',attempts:0,questions:1,checks:[{name:'Acceptance',command:['node','--test'],exitCode:0,output:'ok',durationMs:10,sha:run.base}],pendingQuestion:'¿Cómo tratamos el caso vacío?'}];engine.store.save(run);engine.event(run,'opus','decision.requested','<img src=x onerror=alert(1)>','demo');
  const server=await startServer(engine,{demo:true});const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');const dom=new JSDOM(html,{url:server.url,runScripts:'outside-only'});const w=dom.window;
  t.after(async()=>{dom.window.dispatchEvent(new w.Event('pagehide'));dom.window.close();await server.close();await engine.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  w.fetch=(path,options)=>path==='/api/stream'?Promise.resolve({ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{})})}}):fetch(server.origin+path,options);
  w.TextDecoder=TextDecoder;w.AbortController=AbortController;w.eval(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'));
  await until(()=>{const error=w.document.getElementById('error').textContent;if(error)assert.fail(error);return w.document.getElementById('goal').textContent==='Objetivo de prueba';});
  await until(()=>w.document.getElementById('feed').textContent.includes('<img'));
  assert.equal(w.document.querySelector('#feed img'),null);assert.equal(w.location.hash,'');
  w.document.getElementById('tab-tests').click();assert.equal(w.document.getElementById('tests').hidden,false);assert(w.document.querySelector('.test-card'));
  const agent=w.document.querySelector('[data-agent="worker:1"]');agent.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.match(w.document.getElementById('agent-detail').textContent,/Backend/);
  assert.match(w.document.getElementById('feed').textContent,/Opus 1 → Astra/);
  assert(w.document.querySelector('[data-agent="system"]'));assert(w.document.querySelector('[data-agent="worker:2"]'));
  w.document.getElementById('answer').value='Usar mundo';w.document.getElementById('answer-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>engine.store.get(run.id).decisions.length===1);assert.equal(engine.store.get(run.id).decisions[0].answer,'Usar mundo');
  await engine.wait();
  w.eval(readFileSync(new URL('../public/settings.js',import.meta.url),'utf8'));
  await until(()=>w.document.getElementById('project-detection').textContent.includes('Node.js'));
  w.document.getElementById('cfg-workers').value='3';w.document.getElementById('cfg-instructions').value='Mantener accesibilidad.';
  w.document.getElementById('settings-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>w.document.getElementById('settings-status').textContent.includes('Guardada'));
  assert.equal(loadConfig(repo).workers,3);assert.equal(loadConfig(repo).instructions,'Mantener accesibilidad.');
  w.document.getElementById('objective').value='Objetivo confirmado';
  const count=engine.store.list().length;
  w.document.getElementById('start-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>w.document.getElementById('confirm-work').hidden===false);
  assert.equal(engine.store.list().length,count,'Reviewing a task must not start agents');
  assert.match(w.document.getElementById('confirm-team').textContent,/3 × opus/);
  w.document.getElementById('confirm-cancel').click();assert.equal(w.document.getElementById('confirm-work').hidden,true);
});
test('MCP speaks JSON-RPC over stdio and exposes tools inside Codex',async()=>{
  const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'ping'}].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const result=await execute(process.execPath,['bin/orquesta.mjs','mcp'],{cwd:new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),input,timeoutMs:15000,env:cleanEnvironment()});
  assert.equal(result.code,0,result.stderr);const messages=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(messages.length,3);assert.equal(messages[0].result.serverInfo.name,'orquesta');assert(messages[1].result.tools.some(t=>t.name==='orquesta_start'));assert(messages[1].result.tools.some(t=>t.name==='orquesta_events'));
  const exposed=messages[1].result.tools;
  for(const name of ['orquesta_status','orquesta_events']){
    const hints=exposed.find(t=>t.name===name).annotations;
    assert.equal(hints.readOnlyHint,true);assert.equal(hints.destructiveHint,false);assert.equal(hints.openWorldHint,false);
  }
  for(const name of ['orquesta_start','orquesta_resume']){
    const hints=exposed.find(t=>t.name===name).annotations;
    assert.equal(hints.readOnlyHint,false);assert.equal(hints.destructiveHint,true);assert.equal(hints.openWorldHint,true);
  }
});
