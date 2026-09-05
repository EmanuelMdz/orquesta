import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Engine } from './engine.js';
import { defaults, doctor, initialize, loadConfig, repository, findBinary, binaryCommand } from './config.js';
import { createDemo } from './demo.js';
import { startServer } from './server.js';
import { serveMcp } from './mcp.js';
import { execute } from './process.js';
import type { Event } from './types.js';
export async function main(argv:string[]){
  const{values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{repo:{type:'string'},port:{type:'string'},ui:{type:'boolean'},json:{type:'boolean'},help:{type:'boolean'},task:{type:'string'}}});
  const command=positionals[0]??'ui';const print=(data:unknown)=>console.log(values.json?JSON.stringify(data):typeof data==='string'?data:JSON.stringify(data,null,2));
  if(values.help||command==='help'){
    print(`Orquesta 0.1.0 · Astra dirige, Opus implementa\n\n  orquesta setup                     Configura este proyecto y comprueba las CLI\n  orquesta doctor                    Detecta CLI y estado de sesión\n  orquesta run "objetivo" --ui        Trabajo real y panel local\n  orquesta demo --ui                  Demo aislada, sin llamadas a modelos\n  orquesta ui                        Panel del proyecto\n  orquesta status [run_id]            Estado guardado\n  orquesta inspect run_id --task ID   Diff de una entrega\n  orquesta resume run_id --ui         Reanudar\n  orquesta answer run_id task_id "respuesta"\n  orquesta connect-codex              Registra la tool MCP en tu Codex\n\nOpciones: --repo RUTA, --port NUMERO, --json. Ctrl+C pausa y conserva cambios.\nLas ejecuciones reales consumen tu uso de Codex y Claude. No hay fallback automático de modelos.`);return;
  }
  if(command==='mcp'){await serveMcp();return;}
  if(command==='doctor'){const info=await doctor(defaults);if(values.json)print(info);else{print('Node '+info.node);for(const p of info.providers)print(`${p.installed?'✓':'✗'} ${p.name}: ${p.path??'no encontrado'}\n  ${p.message}`);}return;}
  if(command==='connect-codex'){
    const binary=findBinary('codex');if(!binary)throw new Error('No se encontró codex');const entry=fileURLToPath(new URL('../bin/orquesta.mjs',import.meta.url));
    const lookup=binaryCommand(binary,['mcp','get','orquesta','--json']);
    const existing=await execute(lookup.command,lookup.args,{timeoutMs:30000});
    if(existing.code===0){
      const saved=JSON.parse(existing.stdout);const transport=saved.transport??saved;
      if(transport.command===process.execPath&&JSON.stringify(transport.args)===JSON.stringify([entry,'mcp'])){print('Orquesta ya está conectada a Codex. Reiniciá tu sesión codex para cargar sus herramientas.');return;}
      throw new Error('Ya existe un servidor MCP llamado orquesta con otra configuración. Se conservó sin cambios. Revisalo con codex mcp get orquesta.');
    }
    const call=binaryCommand(binary,['mcp','add','orquesta','--',process.execPath,entry,'mcp']);
    const r=await execute(call.command,call.args,{timeoutMs:30000});if(r.code)throw new Error(r.stderr);print(r.stdout);print('Reiniciá tu sesión codex para cargar las herramientas de Orquesta.');return;
  }
  const repo=command==='demo'?await createDemo(values.repo??process.cwd()):await repository(values.repo??process.cwd());
  if(command==='setup'||command==='init'){
    print('Configuración: '+initialize(repo));const info=await doctor(loadConfig(repo));for(const p of info.providers)print(`${p.name}: ${p.message}`);print('Revisá y guardá orquesta.config.json y .gitignore con Git antes de ejecutar.');return;
  }
  const engine=new Engine(repo,loadConfig(repo));let panel:Awaited<ReturnType<typeof startServer>>|undefined;
  const log=(event:Event)=>{if(values.json){console.log(JSON.stringify(event));return;}if(event.type==='provider.log'||event.type==='provider.usage')return;const color=process.stdout.isTTY?(event.role==='opus'?'\x1b[33m':event.role==='quality'?'\x1b[32m':'\x1b[36m'):'';console.log(`${color}${event.time.slice(11,19)} ${event.role.toUpperCase()}${event.taskId?' ['+event.taskId+']':''}${color?'\x1b[0m':''}  ${event.message}`);};
  engine.on('event',log);engine.on('backgroundError',error=>console.error('Orquesta:',error.message));
  let closing=false;
  const shutdown=async()=>{if(closing)return;closing=true;await engine.close();if(panel)await panel.close();};
  process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
  try{
    if(command==='ui'||values.ui){const port=values.port===undefined?0:Number(values.port);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Puerto inválido');panel=await startServer(engine,{port,demo:command==='demo'});print('Panel local: '+panel.url);print('Proyecto: '+repo);}
    if(command==='status'){const data=positionals[1]?engine.store.get(positionals[1]):engine.store.list();print(data);}
    else if(command==='inspect'){if(!positionals[1])throw new Error('Falta run_id');print(await engine.diff(positionals[1],values.task));}
    else if(command==='answer'){if(positionals.length<4)throw new Error('Uso: orquesta answer run_id task_id "respuesta"');await engine.answer(positionals[1],positionals[2],positionals.slice(3).join(' '));print('Respuesta guardada. Ejecutá orquesta resume '+positionals[1]);}
    else if(command==='run'||command==='demo'||command==='resume'){
      const run=command==='resume'?engine.store.get(positionals[1]??''):await engine.create(command==='demo'?'Implementar saludo y suma con consulta, revisión y pruebas.':positionals.slice(1).join(' '),command==='demo'?'demo':'live');
      print('Run: '+run.id);const result=await engine.start(run.id);print(`Estado: ${result.status}\nRama: ${result.integrationBranch}\nProyecto: ${repo}`);if(!panel&&result.status!=='completed')process.exitCode=result.status==='waiting_user'?2:1;
    }else if(command!=='ui')throw new Error('Comando desconocido. Ejecutá orquesta --help');
    if(!panel)await shutdown();
  }catch(error){await shutdown();throw error;}
}
