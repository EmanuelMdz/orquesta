import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute, redact } from './process.js';
import { findBinary, binaryCommand, defaults } from './config.js';
import { validate } from './schemas.js';
import type { AgentRequest, AgentResult, Config, Provider } from './types.js';
export class CliProvider implements Provider {
  constructor(private config:Config){}
  async invoke(request:AgentRequest):Promise<AgentResult>{
    const opus=request.role==='opus';const name=opus?(this.config.implementerProvider??'claude'):(this.config.orchestratorProvider??'codex');const claude=name==='claude';const model=opus?this.config.opusModel:this.config.astraModel;const binary=findBinary(name,claude?this.config.claudePath:this.config.codexPath);
    if(!binary)throw new Error(`No se encontró ${name}. Ejecutá orquesta setup.`);
    const temp=mkdtempSync(join(tmpdir(),'orquesta-schema-'));
    const schemaPath=join(temp,'schema.json');writeFileSync(schemaPath,JSON.stringify(request.schema));
    let session:string|undefined;let result:any;let finalText='';let providerError='',resolvedModel='';let lastProgressReport=-Infinity;
    const args=claude?
      ['-p','--model',model,'--effort','medium','--output-format','stream-json','--verbose','--include-partial-messages','--json-schema',JSON.stringify(request.schema),'--tools','','--permission-mode','dontAsk','--strict-mcp-config','--no-chrome','--disable-slash-commands',...(request.session?['--resume',request.session]:[])]:
      ['exec','--model',model,'-c','model_reasoning_effort="medium"','-c','mcp_servers.orquesta={enabled=false,command="node"}','--sandbox','read-only','--json','--color','never','--output-schema',schemaPath,'-'];
    const command=binaryCommand(binary,args);
    const timeoutMs=this.config.agentTimeoutMs??defaults.agentTimeoutMs;
    const idleTimeoutMs=this.config.agentIdleTimeoutMs??defaults.agentIdleTimeoutMs;
    request.onEvent('provider.started',`${model} · ${request.phase}`,{provider:name,model,phase:request.phase,timeoutMs,idleTimeoutMs});
    const milestones=new Set<string>();
    const progress=(event:any)=>{
      if(event.type==='stream_event'){
        const inner=event.event,delta=inner?.delta;
        // Only acknowledge generation, never pings, retries or stderr logs.
        // Reasoning fragments are neither stored nor forwarded to the UI.
        return inner?.type==='content_block_delta'&&['text_delta','thinking_delta','input_json_delta'].includes(delta?.type)&&[delta.text,delta.thinking,delta.partial_json].some(value=>typeof value==='string'&&value.length>0);
      }
      if(event.type==='assistant')return event.message?.content?.some((block:any)=>block.type==='tool_use'||(block.type==='text'&&block.text?.length>0)||(block.type==='thinking'&&block.thinking?.length>0))??false;
      if(['item.started','item.updated','item.completed'].includes(event.type)&&['command_execution','agent_message','reasoning'].includes(event.item?.type)){
        if(event.item.id&&event.type!=='item.updated'){const key=event.type+':'+event.item.id;if(milestones.has(key))return false;milestones.add(key);}
        return true;
      }
      return false;
    };
    const message=(text:string)=>{
      // Final structured proposals are represented by agent.result, not a second
      // giant JSON transcript. Forward existing conversational output only.
      try{JSON.parse(text);return;}catch{}
      if(text.trim())request.onEvent('agent.message',redact(text).slice(0,4000));
    };
    try{
      const response=await execute(command.command,command.args,{cwd:request.cwd,input:request.prompt,signal:request.signal,timeoutMs,idleTimeoutMs,captureOutput:'tail',onLine:(line,stream)=>{
        if(!line.trim())return;
        if(stream==='stderr'){request.onEvent('provider.log',redact(line).slice(0,3000));return;}
        let event:any;try{event=JSON.parse(line);}catch{return;}
        const reported=event.type==='system'&&event.subtype==='init'?event.model:event.type==='assistant'?event.message?.model:event.type==='stream_event'&&event.event?.type==='message_start'?event.event.message?.model:undefined;
        if(typeof reported==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,149}$/.test(reported)&&reported!==resolvedModel){resolvedModel=reported;request.onEvent('provider.model','Modelo informado: '+reported,{provider:name,requestedModel:model,resolvedModel:reported});}
        if(event.type==='thread.started')session=event.thread_id;
        if(event.session_id)session=event.session_id;
        if(event.type==='result'){
          if(event.is_error){providerError=event.result||JSON.stringify(event.errors||event.subtype);return;}
          result=event.structured_output;finalText=event.result??finalText;
          if(event.usage||event.total_cost_usd)request.onEvent('provider.usage','Uso reportado por el proveedor',{usage:event.usage,costUsd:event.total_cost_usd});
        }
        if(event.type==='item.completed'&&event.item?.type==='agent_message'){finalText=event.item.text??finalText;message(event.item.text??'');}
        if(event.type==='item.started'&&event.item?.type==='command_execution')request.onEvent('tool.started',model+' está consultando el proyecto',{command:redact(event.item.command??'')});
        if(event.type==='item.completed'&&event.item?.type==='command_execution')request.onEvent('tool.completed','Consulta al proyecto completada',{command:redact(event.item.command??''),exitCode:event.item.exit_code,output:redact(event.item.aggregated_output??'').slice(-4000)});
        if(event.type==='turn.completed'&&event.usage)request.onEvent('provider.usage','Uso reportado por Codex',event.usage);
        if(event.type==='error'||event.type==='turn.failed')providerError=event.message||event.error?.message||'El proveedor devolvió un error';
        if(event.type==='assistant'){
          for(const block of event.message?.content??[]){if(block.type==='text'&&block.text)message(block.text);}
        }
        if(progress(event)){
          const now=Date.now();if(now-lastProgressReport>=5000){lastProgressReport=now;request.onEvent('provider.progress','Actividad recibida del agente',{phase:request.phase,lastActivityAt:new Date(now).toISOString()});}
          return true;
        }
      }});
      if(providerError||response.code!==0)throw new Error(redact(providerError||response.stderr||`${name} terminó con código ${response.code}`).slice(0,2000));
      if(result===undefined){try{result=JSON.parse(finalText);}catch{throw new Error(`${name} no devolvió JSON estructurado válido`);}}
      validate(request.schema,result);return{value:result,session};
    }finally{rmSync(temp,{recursive:true,force:true});}
  }
}
// Deterministic provider used only when mode=demo. It still exercises real Git, files, checks and persistence.
export class DemoProvider implements Provider {
  constructor(private delayMs=350){}
  async invoke(request:AgentRequest):Promise<AgentResult>{
    request.onEvent('provider.started','Demo · '+request.phase,{provider:'demo',phase:request.phase});
    await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new Error('Ejecución pausada'));};const timer=setTimeout(()=>{request.signal.removeEventListener('abort',stop);resolve();},this.delayMs);if(request.signal.aborted)stop();else request.signal.addEventListener('abort',stop,{once:true});});
    request.onEvent('provider.demo','Proveedor simulado · '+request.phase);
    const write=(path:string,content:string)=>({path,content,action:'write' as const});let value:any;
    if(request.phase==='plan')value={summary:'Implementar saludo y suma, consultar formato y verificar casos límite.',tasks:[{id:'saludo',title:'Saludo personalizable',description:'Implementar greet(name) en src/greet.js. Consultar a Astra el comportamiento para nombre vacío.',allowedPaths:['src/greet.js'],dependsOn:[],acceptance:['Saluda a Ana con Hola, Ana!','Para nombre vacío devuelve Hola, mundo!']},{id:'suma',title:'Suma de números',description:'Implementar add(a,b) en src/add.js.',allowedPaths:['src/add.js'],dependsOn:[],acceptance:['Suma enteros positivos y negativos']}]};
    if(request.phase==='decide')value={status:'answered',answer:'Cuando el nombre esté vacío o contenga espacios, usá mundo. Resultado esperado: Hola, mundo!'};
    if(request.phase==='implement'){
      const task=request.task!;
      if(task.id==='saludo'&&!request.run.decisions.some(d=>d.taskId===task.id))value={status:'needs_decision',summary:'Necesito definir el caso vacío.',question:'¿Qué saludo corresponde si el nombre está vacío?',files:[]};
      else{const fixed=task.attempts>0;value={status:'completed',summary:task.id==='saludo'?'Implementé el saludo.':'Implementé la suma.',question:'',files:[task.id==='saludo'?write('src/greet.js',fixed?"export function greet(name) { return `Hola, ${name.trim() || 'mundo'}!`; }\n":"export function greet(name) { return `Hola, ${name}!`; }\n"):write('src/add.js','export function add(a, b) { return a + b; }\n')]};}
    }
    if(request.phase==='tests')value={summary:'Pruebas independientes de aceptación.',files:[write('test/orquesta/'+request.task!.id+'/acceptance.test.mjs',request.task!.id==='saludo'?"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../../../src/greet.js';\ntest('saludo con nombre',()=>assert.equal(greet('Ana'),'Hola, Ana!'));\ntest('saludo sin nombre',()=>assert.equal(greet('  '),'Hola, mundo!'));\n":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../../../src/add.js';\ntest('suma positiva',()=>assert.equal(add(2,3),5));\ntest('suma negativa',()=>assert.equal(add(-3,1),-2));\n")]};
    if(request.phase==='review'){const failed=request.task!.checks.some(c=>c.exitCode!==0);value={verdict:failed?'changes_requested':'approved',summary:failed?'El caso vacío incumple la decisión. Corregí greet.':'El código y las pruebas cumplen los criterios.',findings:failed?['No se usa mundo para un nombre vacío.']:[]};}
    if(request.phase==='review'){value.progress=request.task!.review?'advancing':'initial';value.nextApproach=value.verdict==='changes_requested'?'Aplicar el valor mundo después de recortar los espacios.':'';}
    validate(request.schema,value);return{value,session:'demo-'+request.phase+'-'+(request.task?.id??'director')};
  }
}
