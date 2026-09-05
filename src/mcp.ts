import { createInterface } from 'node:readline';
import { Engine } from './engine.js';
import { loadConfig, repository } from './config.js';
// Small stdio MCP surface. Diagnostics belong on stderr; stdout is JSON-RPC only.
export async function serveMcp(){
  const engines=new Map<string,Engine>();
  const properties={repo_path:{type:'string',description:'Ruta absoluta al repositorio Git inicializado con orquesta init.'}};
  const tool=(name:string,description:string,extra:Record<string,unknown>,required:string[])=>{
    const readOnly=['orquesta_status','orquesta_events'].includes(name);
    const runsAgents=['orquesta_start','orquesta_resume'].includes(name);
    return{name,description,annotations:{readOnlyHint:readOnly,destructiveHint:runsAgents,idempotentHint:readOnly||name==='orquesta_pause',openWorldHint:runsAgents},inputSchema:{type:'object',properties:{...properties,...extra},required:['repo_path',...required],additionalProperties:false}};
  };
  const tools=[
    tool('orquesta_start','Inicia trabajo real: Astra planifica, Opus implementa, Astra revisa y prueba. Consume uso de ambas cuentas. Devuelve run_id inmediatamente; consultar status/events. El repo debe estar limpio y tener commit inicial.',{objective:{type:'string'}},['objective']),
    tool('orquesta_status','Lee el estado y las preguntas pendientes. Sin run_id lista ejecuciones.',{run_id:{type:'string'}},[]),
    tool('orquesta_events','Lee mensajes explícitos, decisiones y acciones. after permite lectura incremental.',{run_id:{type:'string'},after:{type:'integer',minimum:0}},['run_id']),
    tool('orquesta_pause','Solicita pausa conservando cambios y decisiones.',{},[]),
    tool('orquesta_resume','Reanuda una ejecución pausada o bloqueada después de resolver la causa.',{run_id:{type:'string'}},['run_id']),
    tool('orquesta_answer','Registra la respuesta del usuario a una pregunta que Astra no pudo resolver. No inventar preferencias del usuario.',{run_id:{type:'string'},task_id:{type:'string'},answer:{type:'string'}},['run_id','task_id','answer'])
  ];
  const write=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
  async function engineFor(path:string){const repo=await repository(path);let engine=engines.get(repo);if(!engine){engine=new Engine(repo,loadConfig(repo));engines.set(repo,engine);}return engine;}
  const reader=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of reader){
    if(!line.trim())continue;let message:any;
    try{message=JSON.parse(line);}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});continue;}
    if(message.id===undefined)continue;
    try{
      let result:any;
      if(message.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'orquesta',version:'0.1.0'}};
      else if(message.method==='ping')result={};
      else if(message.method==='tools/list')result={tools};
      else if(message.method==='tools/call'){
        try{
          const{name,arguments:args}=message.params??{};if(!tools.some(t=>t.name===name)||typeof args?.repo_path!=='string')throw new Error('Tool o repo_path inválido');const engine=await engineFor(args.repo_path);let data:any;
          if(name==='orquesta_start'){const run=await engine.create(String(args.objective??''));void engine.start(run.id).catch(error=>console.error(error.message));data={run_id:run.id,status:'started'};}
          if(name==='orquesta_status')data=args.run_id?engine.store.get(args.run_id):engine.store.list();
          if(name==='orquesta_events')data=engine.store.events(args.run_id,args.after??0);
          if(name==='orquesta_pause'){engine.pause();data={status:'pause_requested'};}
          if(name==='orquesta_resume'){if(engine.running)throw new Error('Ya hay una ejecución activa');engine.store.get(args.run_id);void engine.start(args.run_id).catch(error=>console.error(error.message));data={status:'resume_requested'};}
          if(name==='orquesta_answer'){await engine.answer(args.run_id,args.task_id,args.answer);data={status:'answered'};}
          result={content:[{type:'text',text:JSON.stringify(data)}]};
        }catch(error){result={isError:true,content:[{type:'text',text:(error as Error).message}]};}
      }else{write({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}});continue;}
      write({jsonrpc:'2.0',id:message.id,result});
    }catch(error){write({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:(error as Error).message}});}
  }
  await Promise.all([...engines.values()].map(e=>e.close()));
}
