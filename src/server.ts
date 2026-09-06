import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Engine } from './engine.js';
import type { Run, Event } from './types.js';
import { loadConfig, saveConfig, projectInfo, doctor } from './config.js';
import { parseCommand, commandList, commandLine } from './commands.js';
import { git } from './git.js';
import { presetLibrary, savePreset } from './presets.js';
import { isDeepStrictEqual } from 'node:util';
import { runAttention } from './attention.js';
const publicDirectory=fileURLToPath(new URL('../public/',import.meta.url));
export function publicRun(run:Run){return{...run,attention:runAttention(run),tasks:run.tasks.map(({qaFiles,...task})=>({...task,qaFiles:qaFiles?.map(f=>({path:f.path}))}))};}
async function jsonBody(request:IncomingMessage){let body='';for await(const chunk of request){body+=chunk;if(body.length>50000)throw new Error('Solicitud demasiado grande');}return body?JSON.parse(body):{};}
export async function startServer(engine:Engine,options:{port?:number;demo?:boolean;onShutdown?:()=>void}={}){
  const token=randomBytes(32).toString('hex');const clients=new Set<ServerResponse>();let url='';
  const authorized=(request:IncomingMessage)=>{const raw=request.headers.authorization?.replace(/^Bearer /,'')??'';const a=Buffer.from(raw),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);};
  const send=(response:ServerResponse,status:number,data:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(data));};
  const server=createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
    try{
      const target=new URL(request.url??'/','http://127.0.0.1');
      if(!['127.0.0.1','localhost'].includes((request.headers.host??'').split(':')[0])){send(response,403,{error:'Host inválido'});return;}
      if(target.pathname.startsWith('/api/')){
        if(!authorized(request)){send(response,401,{error:'Abrí el enlace completo que muestra la terminal.'});return;}
        if(request.headers.origin&&request.headers.origin!==url){send(response,403,{error:'Origen no permitido'});return;}
        if(request.method==='GET'&&target.pathname==='/api/health'){send(response,200,{app:'orquesta',version:'0.2.0',repo:engine.repo,pid:process.pid});return;}
        if(request.method==='GET'&&target.pathname==='/api/state'){send(response,200,{repo:engine.repo,config:loadConfig(engine.repo),demo:!!options.demo,running:engine.running,runs:engine.store.list().map(publicRun)});return;}
        if(request.method==='GET'&&target.pathname==='/api/run'){send(response,200,publicRun(engine.store.get(target.searchParams.get('id')??'')));return;}
        if(request.method==='GET'&&target.pathname==='/api/presets'){send(response,200,presetLibrary());return;}
        if(request.method==='GET'&&target.pathname==='/api/config'){
          const config=loadConfig(engine.repo);const status=await git(engine.repo,['status','--porcelain']);const hasCommit=await git(engine.repo,['rev-parse','--verify','HEAD']).then(()=>true,()=>false);
          send(response,200,{config,project:projectInfo(engine.repo),dirty:status,hasCommit,qaCommandLine:commandLine(config.qaCommand),checksText:config.checks.map(c=>commandLine([c.command,...c.args])).join('\n'),setupText:(config.setupCommands??[]).map(c=>commandLine([c.command,...c.args])).join('\n')});return;
        }
        if(request.method==='GET'&&target.pathname==='/api/events'){send(response,200,engine.store.events(target.searchParams.get('run')??'',Math.max(0,Number(target.searchParams.get('after'))||0)));return;}
        if(request.method==='GET'&&target.pathname==='/api/diff'){send(response,200,{diff:await engine.diff(target.searchParams.get('run')??'',target.searchParams.get('task')??undefined)});return;}
        if(request.method==='GET'&&target.pathname==='/api/stream'){
          response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});response.write(': connected\n\n');clients.add(response);response.on('close',()=>clients.delete(response));return;
        }
        if(request.method==='POST'){
          if(!request.headers['content-type']?.startsWith('application/json')){send(response,415,{error:'Usá application/json'});return;}
          const body=await jsonBody(request);
          if(target.pathname==='/api/stop'){if(!options.onShutdown)throw new Error('Este panel se cierra desde su terminal.');send(response,202,{status:'stopping'});setImmediate(options.onShutdown);return;}
          if(target.pathname==='/api/presets'){send(response,200,savePreset(body.name,loadConfig(engine.repo),body.makeDefault===true));return;}
          if(target.pathname==='/api/doctor'){send(response,200,await doctor(loadConfig(engine.repo)));return;}
          if(target.pathname==='/api/config'){
            if(engine.running)throw new Error('Pausá el trabajo antes de cambiar la configuración.');
            const current=loadConfig(engine.repo);const value={...current,...body.config};
            if(typeof body.qaCommandLine==='string')value.qaCommand=parseCommand(body.qaCommandLine);
            if(typeof body.checksText==='string')value.checks=commandList(body.checksText);
            if(typeof body.setupText==='string')value.setupCommands=commandList(body.setupText);
            const config=saveConfig(engine.repo,value);engine.config=config;send(response,200,{config});return;
          }
          if(target.pathname==='/api/runs'){
            if(body.expectedConfig&&!isDeepStrictEqual(body.expectedConfig,loadConfig(engine.repo)))throw new Error('La configuración cambió. Revisá otra vez el equipo antes de confirmar.');
            if(!engine.running&&!options.demo)engine.config=loadConfig(engine.repo);
            const run=await engine.create(options.demo?'Implementar saludo y suma con consulta y pruebas.':String(body.objective??''),options.demo?'demo':'live');
            void engine.start(run.id).catch(error=>engine.emit('backgroundError',error));send(response,202,{id:run.id});return;
          }
          if(target.pathname==='/api/pause'){engine.pause();send(response,202,{status:'pause_requested'});return;}
          if(target.pathname==='/api/resume'){const id=String(body.id??'');if(engine.running)throw new Error('Ya hay trabajo activo');const run=engine.store.get(id);if(run.tasks.some(t=>t.pendingQuestion))throw new Error('Respondé la pregunta pendiente antes de reanudar.');void engine.start(id).catch(error=>engine.emit('backgroundError',error));send(response,202,{id});return;}
          if(target.pathname==='/api/answer'){
            const id=String(body.id??'');await engine.answer(id,String(body.taskId??''),String(body.answer??''),typeof body.question==='string'?body.question:undefined);
            if(body.resume===true&&!engine.running&&!engine.store.get(id).tasks.some(task=>task.pendingQuestion))void engine.start(id).catch(error=>engine.emit('backgroundError',error));
            send(response,200,{status:'answered',continuing:engine.activeRunId===id});return;
          }
        }
        send(response,404,{error:'Ruta inexistente'});return;
      }
      if(request.method!=='GET'){send(response,405,{error:'Método no permitido'});return;}
      const files:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/settings.js':['settings.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/settings.css':['settings.css','text/css; charset=utf-8']};
      const file=files[target.pathname];if(!file){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});response.end(readFileSync(join(publicDirectory,file[0])));
    }catch(error){send(response,400,{error:(error as Error).message});}
  });
  const broadcast=(event:Event)=>{const message='data: '+JSON.stringify(event)+'\n\n';for(const client of clients){if(client.writableLength>1_000_000){client.destroy();clients.delete(client);}else client.write(message);}};
  engine.on('event',broadcast);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('No se pudo abrir el panel');url='http://127.0.0.1:'+address.port;
  const heartbeat=setInterval(()=>{for(const client of clients)client.write(': heartbeat\n\n');},15000);heartbeat.unref();
  return{url:url+'/#'+token,origin:url,token,close:async()=>{clearInterval(heartbeat);engine.off('event',broadcast);for(const client of clients)client.end();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
