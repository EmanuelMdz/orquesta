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
test('real SSE updates the map and Astra/System/Opus conversation with no extra agent work',async t=>{
  const{w,engine,run,requests,calls}=await view(t,run=>{
    run.status='running';run.calls=3;
    run.tasks=[{id:'first',workerId:1,title:'Primera tarea',status:'implementing',checks:[],acceptance:[]},{id:'second',workerId:2,title:'Segunda tarea',status:'queued',checks:[],acceptance:[]}];
  });
  const d=w.document;
  engine.event(run,'opus','provider.started','opus · implement','first',{phase:'implement'});
  engine.event(run,'astra','agent.message','Mensaje disponible de Astra');
  engine.event(run,'system','workspace.preparing','Entorno del segundo agente','second');
  await until(()=>d.querySelector('[data-agent="worker:1"]').classList.contains('busy'));
  assert.equal(d.querySelector('[data-agent="worker:2"]').classList.contains('busy'),false);
  assert(d.querySelector('[data-agent="system"]').classList.contains('busy'));
  assert.match(d.getElementById('live-text').textContent,/Opus 1/);
  engine.event(run,'opus','agent.result','Implementación lista','first');
  engine.event(run,'opus','decision.requested','Consulta del primer agente','first');
  engine.event(run,'astra','decision.answered','Respuesta de Astra','first');
  await until(()=>d.getElementById('feed').textContent.includes('Respuesta de Astra'));
  assert.match(d.getElementById('feed').textContent,/Opus 1 → Astra/);
  assert.match(d.getElementById('feed').textContent,/Astra → Opus 1/);
  d.querySelector('[data-agent="worker:1"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  assert(d.getElementById('feed').textContent.includes('Respuesta de Astra'));
  assert(!d.getElementById('feed').textContent.includes('Entorno del segundo agente'));
  d.getElementById('feed-all').click();assert(d.getElementById('feed').textContent.includes('Entorno del segundo agente'));
  run.status='paused';engine.store.save(run);engine.event(run,'system','run.paused','Pausa');
  await until(()=>d.querySelectorAll('.map-node.busy').length===0);
  assert.equal(d.getElementById('live-status').hidden,true);
  assert(requests.every(request=>request.method==='GET'));assert.equal(calls(),0);assert.equal(engine.store.get(run.id).calls,3);
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
