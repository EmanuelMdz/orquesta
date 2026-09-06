import { createInterface } from 'node:readline';
import { repository } from './config.js';
import { openService, type Service } from './service.js';
// Small stdio MCP surface. Diagnostics belong on stderr; stdout is JSON-RPC only.
export async function serveMcp(){
  const services=new Map<string,Service>();
  const properties={repo_path:{type:'string',description:'Ruta absoluta al repositorio Git. Orquesta configura el proyecto automáticamente.'}};
  const tool=(name:string,description:string,extra:Record<string,unknown>,required:string[])=>{
    const readOnly=['orquesta_status','orquesta_events'].includes(name);
    const runsAgents=['orquesta_start','orquesta_resume'].includes(name);
    return{name,description,annotations:{readOnlyHint:readOnly,destructiveHint:runsAgents,idempotentHint:readOnly||name==='orquesta_pause',openWorldHint:runsAgents},inputSchema:{type:'object',properties:{...properties,...extra},required:['repo_path',...required],additionalProperties:false}};
  };
  const tools=[
    tool('orquesta_start','Inicia trabajo real: Astra planifica, Opus implementa, Astra revisa y prueba. Consume uso de ambas cuentas. Devuelve run_id y panel_url: mostrá el enlace al usuario y seguí consultando status/events. El repo debe estar limpio y tener commit inicial. Usa la configuración de ese proyecto.',{objective:{type:'string'}},['objective']),
    tool('orquesta_status','Lee el estado y las preguntas pendientes. Sin run_id lista ejecuciones.',{run_id:{type:'string'}},[]),
    tool('orquesta_events','Lee mensajes explícitos, decisiones y acciones. after permite lectura incremental.',{run_id:{type:'string'},after:{type:'integer',minimum:0}},['run_id']),
    tool('orquesta_pause','Solicita pausa conservando cambios y decisiones.',{},[]),
    tool('orquesta_resume','Reanuda una ejecución pausada o bloqueada después de resolver la causa.',{run_id:{type:'string'}},['run_id']),
    tool('orquesta_answer','Registra la respuesta del usuario a una pregunta que Astra no pudo resolver. No inventar preferencias del usuario.',{run_id:{type:'string'},task_id:{type:'string'},answer:{type:'string'}},['run_id','task_id','answer'])
  ];
  const write=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
  async function serviceFor(path:string){const repo=await repository(path);let service=services.get(repo);if(!service){service=await openService(repo);services.set(repo,service);}return service;}
  const reader=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of reader){
    if(!line.trim())continue;let message:any;
    try{message=JSON.parse(line);}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});continue;}
    if(message.id===undefined)continue;
    try{
      let result:any;
      if(message.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'orquesta',version:'0.2.0'},instructions:'Orquesta dirige agentes Astra y Opus por proyecto. Al iniciar o reanudar, mostrá panel_url y seguí consultando status/events hasta un estado terminal. No inventes respuestas del usuario. No dupliques un inicio que ya devolvió run_id.'};
      else if(message.method==='ping')result={};
      else if(message.method==='tools/list')result={tools};
      else if(message.method==='tools/call'){
        try{
          const{name,arguments:args}=message.params??{};if(!tools.some(t=>t.name===name)||typeof args?.repo_path!=='string')throw new Error('Tool o repo_path inválido');const service=await serviceFor(args.repo_path);let data:any;
          if(name==='orquesta_start'){const run=await service.request('/api/runs',{objective:String(args.objective??'')});data={run_id:run.id,status:'started',panel_url:service.url};}
          if(name==='orquesta_status')data=args.run_id?await service.request('/api/run?id='+encodeURIComponent(args.run_id)):(await service.request('/api/state')).runs;
          if(name==='orquesta_events')data=await service.request('/api/events?run='+encodeURIComponent(args.run_id)+'&after='+(Number(args.after)||0));
          if(name==='orquesta_pause')data=await service.request('/api/pause',{});
          if(name==='orquesta_resume'){data=await service.request('/api/resume',{id:args.run_id});data.panel_url=service.url;}
          if(name==='orquesta_answer')data=await service.request('/api/answer',{id:args.run_id,taskId:args.task_id,answer:args.answer});
          result={content:[{type:'text',text:JSON.stringify(data)}]};
        }catch(error){result={isError:true,content:[{type:'text',text:(error as Error).message}]};}
      }else{write({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}});continue;}
      write({jsonrpc:'2.0',id:message.id,result});
    }catch(error){write({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:(error as Error).message}});}
  }
  await Promise.all([...services.values()].map(service=>service.close()));
}
