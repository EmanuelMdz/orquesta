import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defaults, doctor, initialize, loadConfig, repository, findBinary, binaryCommand } from './config.js';
import { createDemo } from './demo.js';
import { serveMcp } from './mcp.js';
import { execute } from './process.js';
import { openService, backgroundService } from './service.js';
import { openBrowser } from './browser.js';
import { installEverywhere, installationSummary } from './install.js';
import { version } from './version.js';
import type { Event, Run } from './types.js';

async function connectCodex(){
  const binary=findBinary('codex');if(!binary)throw new Error('No se encontró codex.');
  const entry=fileURLToPath(new URL('../bin/orquesta.mjs',import.meta.url));
  const lookup=binaryCommand(binary,['mcp','get','orquesta','--json']);
  const existing=await execute(lookup.command,lookup.args,{timeoutMs:30000});
  if(existing.code===0){
    const saved=JSON.parse(existing.stdout);const transport=saved.transport??saved;
    if(transport.command===process.execPath&&JSON.stringify(transport.args)===JSON.stringify([entry,'mcp']))return 'Orquesta ya está conectada. Reiniciá la sesión de Codex que estuviera abierta.';
    throw new Error('Ya existe otro servidor llamado orquesta. Se conservó su configuración. Podés usar orquesta codex para conectarte sólo en esta sesión.');
  }
  const call=binaryCommand(binary,['mcp','add','orquesta','--',process.execPath,entry,'mcp']);
  const result=await execute(call.command,call.args,{timeoutMs:30000});if(result.code)throw new Error(result.stderr);
  return 'Orquesta conectada. Reiniciá la sesión de Codex que estuviera abierta.';
}

export async function main(argv:string[]){
  const{values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{repo:{type:'string'},port:{type:'string'},ui:{type:'boolean'},'no-open':{type:'boolean'},json:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'},task:{type:'string'},file:{type:'string'},name:{type:'string'},default:{type:'boolean'},after:{type:'string'}}});
  const command=positionals[0]??'ui';
  const print=(data:unknown)=>console.log(values.json?JSON.stringify(data):typeof data==='string'?data:JSON.stringify(data,null,2));
  if(values.version){print(version);return;}
  if(values.help||command==='help'){
    print(`Orquesta ${version} · Astra dirige, Opus implementa

  orquesta                            Abre el panel de este proyecto
  orquesta install                    Instala /orquesta en Claude y $orquesta en Codex
  orquesta launch                     Abre el menú y devuelve la terminal
  orquesta codex                      Abre Codex y el panel, conectados
  orquesta config                     Configuración visual de este proyecto
  orquesta run "objetivo" --ui         Inicia trabajo y abre el panel
  orquesta demo --ui                   Demo aislada sin llamadas a modelos
  orquesta doctor                     Comprueba Codex y Claude
  orquesta status [run_id]             Estado guardado
  orquesta inspect run_id --task ID    Cambios de una entrega
  orquesta pause                      Pausa el trabajo del proyecto
  orquesta resume run_id --ui          Reanuda una ejecución
  orquesta answer run_id task_id "respuesta"
  orquesta connect-codex               Conexión permanente al comando codex
  orquesta describe --json             Configuración y combos para el asistente
  orquesta configure --file CONFIG     Guarda configuración de este proyecto
  orquesta preset --name "NOMBRE" --default
  orquesta start --file TAREA --json   Inicia y devuelve el ID inmediatamente
  orquesta events run_id --after 0     Actividad incremental
  orquesta stop                       Pausa y cierra el servicio del proyecto

No hace falta setup ni un commit de configuración. Los ajustes se guardan por proyecto.
Opciones: --repo RUTA, --no-open, --port NUMERO, --json.
Ctrl+C pausa si esta terminal inició el servicio. Las llamadas reales consumen tus cuentas.`);return;
  }
  if(command==='mcp'){await serveMcp();return;}
  if(command==='install'){const report=await installEverywhere();print(values.json?report:installationSummary(report));return;}
  if(command==='connect-codex'){print(await connectCodex());return;}
  if(command==='doctor'){
    const repo=await repository(values.repo??process.cwd()).catch(()=>undefined);
    print(await doctor(repo?loadConfig(repo):defaults));return;
  }
  const allowed=['ui','config','codex','setup','init','run','demo','status','inspect','pause','resume','answer','launch','start','describe','configure','preset','events','stop'];
  if(!allowed.includes(command))throw new Error('Comando desconocido. Ejecutá orquesta --help.');
  const repo=command==='demo'?await createDemo(values.repo??process.cwd()):await repository(values.repo??process.cwd());
  if(command==='setup'||command==='init'){print('Configuración local: '+initialize(repo));print('Listo. Ejecutá orquesta para abrir el panel.');return;}
  const port=values.port===undefined?0:Number(values.port);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Puerto inválido.');
  const service=['launch','start'].includes(command)?await backgroundService(repo):await openService(repo,{port,demo:command==='demo'});
  const withPanel=['ui','config','codex'].includes(command)||!!values.ui;
  let closing=false;
  const shutdown=async()=>{if(closing)return;closing=true;await service.close();};
  const signal=()=>{void shutdown();};
  process.once('SIGINT',signal);process.once('SIGTERM',signal);
  function log(event:Event){
    if(values.json){console.log(JSON.stringify(event));return;}
    if(['provider.log','provider.usage'].includes(event.type))return;
    console.log(`${event.time.slice(11,19)} ${event.role.toUpperCase()}${event.taskId?' ['+event.taskId+']':''}  ${event.message}`);
  }
  try{
    if(command==='launch'){
      if(!values['no-open'])await openBrowser(service.url).catch(error=>console.error(error.message));
      print({panel_url:service.url,repo});await shutdown();return;
    }
    if(withPanel){
      print('Panel: '+service.url);print('Proyecto: '+repo);
      if(!values['no-open']&&!values.json)await openBrowser(service.url).catch(error=>console.error(error.message));
    }
    if(command==='codex'){
      const config=loadConfig(repo);const binary=findBinary('codex',config.codexPath);if(!binary)throw new Error('No se encontró Codex. Revisá orquesta doctor.');
      const entry=fileURLToPath(new URL('../bin/orquesta.mjs',import.meta.url));
      const mcp=`mcp_servers.orquesta={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(entry)},"mcp"],enabled=true}`;
      const call=binaryCommand(binary,[...(config.orchestratorProvider==='codex'?['--model',config.astraModel]:[]),'-c',mcp]);
      await new Promise<void>((resolve,reject)=>{
        const child=spawn(call.command,call.args,{cwd:repo,stdio:'inherit',windowsHide:true});
        child.once('error',reject);child.once('exit',code=>{process.exitCode=code??1;resolve();});
      });
      await shutdown();return;
    }
    if(command==='status')print(positionals[1]?await service.request('/api/run?id='+encodeURIComponent(positionals[1])):(await service.request('/api/state')).runs);
    if(command==='describe')print({...await service.request('/api/config'),combos:await service.request('/api/presets')});
    if(command==='configure'){
      if(!values.file)throw new Error('Usá configure --file ARCHIVO_JSON.');
      print(await service.request('/api/config',{config:JSON.parse(readFileSync(values.file,'utf8'))}));
    }
    if(command==='preset'){
      if(!values.name)print(await service.request('/api/presets'));
      else print(await service.request('/api/presets',{name:values.name,makeDefault:!!values.default}));
    }
    if(command==='events')print(await service.request('/api/events?run='+encodeURIComponent(positionals[1]??'')+'&after='+(Number(values.after)||0)));
    if(command==='stop'){print(await service.request('/api/stop',{}));await shutdown();return;}
    if(command==='start'){
      const payload=values.file?JSON.parse(readFileSync(values.file,'utf8')):{objective:positionals.slice(1).join(' ')};
      const run=await service.request('/api/runs',payload);print({run_id:run.id,panel_url:service.url,repo});await shutdown();return;
    }
    if(command==='inspect'){
      if(!positionals[1])throw new Error('Falta run_id.');
      print((await service.request('/api/diff?run='+encodeURIComponent(positionals[1])+(values.task?'&task='+encodeURIComponent(values.task):''))).diff);
    }
    if(command==='pause')print(await service.request('/api/pause',{}));
    if(command==='answer'){
      if(positionals.length<4)throw new Error('Uso: orquesta answer run_id task_id "respuesta"');
      print(await service.request('/api/answer',{id:positionals[1],taskId:positionals[2],answer:positionals.slice(3).join(' ')}));
    }
    if(['run','demo','resume'].includes(command)){
      const result=command==='resume'?await service.request('/api/resume',{id:positionals[1]}):await service.request('/api/runs',{objective:command==='demo'?'Implementar saludo y suma con consulta, revisión y pruebas.':positionals.slice(1).join(' ')});
      print('Run: '+result.id);let after=0;
      while(!closing){
        const events=await service.request<Event[]>('/api/events?run='+encodeURIComponent(result.id)+'&after='+after);
        for(const event of events){log(event);after=Math.max(after,event.seq??0);}
        const run=await service.request<Run>('/api/run?id='+encodeURIComponent(result.id));
        if(!['created','running'].includes(run.status)){
          print(`Estado: ${run.status}\nRama: ${run.integrationBranch}`);
          if(run.status!=='completed')process.exitCode=run.status==='waiting_user'?2:1;
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,300));
      }
    }else if(service.engine&&withPanel){service.engine.on('event',log);}
    if(!withPanel||!service.owned)await shutdown();
  }catch(error){await shutdown();throw error;}
}
