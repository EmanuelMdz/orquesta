import { existsSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Engine } from './engine.js';
import { initialize, loadConfig, localDirectory, repository } from './config.js';
import { acquireLock } from './git.js';
import { startServer } from './server.js';

interface Descriptor { repo:string; origin:string; token:string; pid:number }
export interface Service {
  repo:string; url:string; owned:boolean; engine?:Engine;
  request<T=any>(path:string,body?:unknown):Promise<T>;
  close():Promise<void>;
}
function client(data:Descriptor):Service{
  return{repo:data.repo,url:data.origin+'/#'+data.token,owned:false,close:async()=>{},async request<T>(path:string,body?:unknown):Promise<T>{
    if(!/^\/api\/[a-z]+(?:\?[^#]*)?$/.test(path))throw new Error('Ruta de servicio inválida.');
    const response=await fetch(data.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+data.token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/api/doctor'?60000:15000),redirect:'error'});
    const result:any=await response.json();if(!response.ok)throw new Error(result.error??'Error del panel');return result;
  }};
}
export async function findService(repo:string):Promise<Service|undefined>{
  const file=join(localDirectory(repo),'panel.json');if(!existsSync(file))return;
  try{
    const data:Descriptor=JSON.parse(readFileSync(file,'utf8'));
    if(data.repo!==repo||!/^http:\/\/127\.0\.0\.1:\d+$/.test(data.origin)||!/^[a-f0-9]{64}$/.test(data.token)||!Number.isInteger(data.pid))return;
    const service=client(data);const response=await fetch(data.origin+'/api/health',{headers:{Authorization:'Bearer '+data.token},signal:AbortSignal.timeout(1500),redirect:'error'});
    if(!response.ok)return;const health:any=await response.json();
    if(health.app==='orquesta'&&health.repo===repo&&health.pid===data.pid)return service;
  }catch{}
}
export async function openService(path:string,options:{port?:number;demo?:boolean}={}):Promise<Service>{
  const repo=await repository(path);const found=await findService(repo);if(found)return found;
  initialize(repo);let release:()=>void;
  try{release=acquireLock(join(localDirectory(repo),'panel-owner'),'panel');}
  catch(error){
    for(let i=0;i<25;i++){await new Promise(resolve=>setTimeout(resolve,100));const peer=await findService(repo);if(peer)return peer;}
    throw error;
  }
  const engine=new Engine(repo,loadConfig(repo));
  engine.on('backgroundError',error=>console.error('Orquesta:',error.message));
  try{
    let shutdown=()=>{};
    const server=await startServer(engine,{...options,onShutdown:()=>shutdown()});const data={repo,origin:server.origin,token:server.token,pid:process.pid};
    const file=join(localDirectory(repo),'panel.json');writeFileSync(file,JSON.stringify(data),{mode:0o600});
    const service=client(data);let closed=false;
    const owned:Service={...service,owned:true,engine,close:async()=>{
      if(closed)return;closed=true;await engine.close();await server.close();
      try{if(JSON.parse(readFileSync(file,'utf8')).token===data.token)rmSync(file);}catch{}
      release();
    }};
    shutdown=()=>{void owned.close().catch(error=>console.error(error.message));};return owned;
  }catch(error){await engine.close();release();throw error;}
}
export async function backgroundService(path:string):Promise<Service>{
  const repo=await repository(path);const found=await findService(repo);if(found)return found;
  initialize(repo);const dir=localDirectory(repo);
  const out=openSync(join(dir,'panel.log'),'a'),err=openSync(join(dir,'panel-error.log'),'a');
  let failure:Error|undefined;
  try{
    const entry=fileURLToPath(new URL('../bin/orquesta.mjs',import.meta.url));
    const child=spawn(process.execPath,[entry,'ui','--repo',repo,'--no-open'],{cwd:repo,stdio:['ignore',out,err],detached:true,windowsHide:true});
    child.once('error',error=>{failure=error;});child.unref();
  }finally{closeSync(out);closeSync(err);}
  for(let i=0;i<60;i++){if(failure)throw failure;await new Promise(resolve=>setTimeout(resolve,100));const service=await findService(repo);if(service)return service;}
  throw new Error('No se pudo iniciar el panel. Revisá .orquesta/panel-error.log.');
}
