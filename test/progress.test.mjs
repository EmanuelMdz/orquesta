import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CliProvider } from '../dist/providers.js';
import { defaults } from '../dist/config.js';
import { execute } from '../dist/process.js';

function fixture(t,source,config={}){
  const root=mkdtempSync(join(tmpdir(),'orquesta-progress-'));t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200}));
  const fake=join(root,'claude.js');writeFileSync(fake,source);
  const events=[],provider=new CliProvider({...defaults,claudePath:fake,agentTimeoutMs:0,agentIdleTimeoutMs:1500,...config});
  return{events,invoke:()=>provider.invoke({role:'opus',phase:'implement',cwd:root,prompt:'Original request',schema:{type:'object'},signal:new AbortController().signal,run:{},onEvent:(type,message,data)=>events.push({type,message,data})})};
}

test('streamed progress keeps long responses alive and reports the resolved Opus model without extra prompts',async t=>{
  const{events,invoke}=fixture(t,`
    if(!process.argv.includes('--include-partial-messages'))throw Error('Missing partial streaming flag');
    let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
      if(input!=='Original request')throw Error('Changed prompt');
      console.log(JSON.stringify({type:'system',subtype:'init',model:'claude-opus-5'}));
      let count=0;const timer=setInterval(()=>{
        console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'PRIVATE_INTERNAL_CONTENT'}}}));
        if(++count===10){clearInterval(timer);console.log(JSON.stringify({type:'result',structured_output:{summary:'Completed long response'}}));}
      },200);
    });`);
  assert.equal((await invoke()).value.summary,'Completed long response');
  assert.equal(events.find(event=>event.type==='provider.model').data.resolvedModel,'claude-opus-5');
  assert(events.some(event=>event.type==='provider.progress'));assert(!JSON.stringify(events).includes('PRIVATE_INTERNAL_CONTENT'));
  assert(events.filter(event=>event.type==='provider.progress').length<10,'Progress metadata is throttled, not one stored event per token');
});

test('pings, retries and stderr noise do not keep an unresponsive provider alive',async t=>{
  const{invoke}=fixture(t,`process.stdin.resume();process.stdin.on('end',()=>setInterval(()=>{
    console.error('Repeated network log');
    console.log(JSON.stringify({type:'stream_event',event:{type:'ping'}}));
    console.log(JSON.stringify({type:'system',subtype:'api_retry',attempt:1}));
  },50));`,{agentIdleTimeoutMs:600});
  await assert.rejects(invoke(),/Sin actividad observable del agente \(600 ms\)/);
});

test('unlimited streaming uses bounded capture and remains cancellable',async()=>{
  const result=await execute(process.execPath,['-e',`let i=0;const timer=setInterval(()=>{console.log('progress '+i);if(++i===100)clearInterval(timer)},5);`],{timeoutMs:0,idleTimeoutMs:1000,maxBytes:128,captureOutput:'tail',onLine:()=>true});
  assert.equal(result.code,0);assert(result.stdout.length<=64);assert.match(result.stdout,/progress 99/);
  const controller=new AbortController();const task=execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:0,idleTimeoutMs:0,signal:controller.signal});
  controller.abort();await assert.rejects(task,/pausada/);
});
