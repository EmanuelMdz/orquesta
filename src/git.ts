import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execute, cleanEnvironment } from './process.js';
export async function git(cwd:string,args:string[]){const r=await execute('git',args,{cwd,env:cleanEnvironment(),timeoutMs:60000});if(r.code!==0)throw new Error(`git ${args[0]}: ${r.stderr.trim()||r.stdout.trim()}`);return r.stdout.trim();}
export async function head(cwd:string){return git(cwd,['rev-parse','HEAD']);}
export async function trackedFiles(cwd:string){const out=await git(cwd,['ls-files','-z']);return out.split('\0').filter(Boolean);}
export async function assertClean(repo:string){const status=await git(repo,['status','--porcelain']);if(status)throw new Error('El repositorio tiene cambios sin guardar. Hacé commit o stash antes de iniciar Orquesta.');}
export async function createWorktree(repo:string,path:string,branch:string,base:string){mkdirSync(dirname(path),{recursive:true});if(!existsSync(path))await git(repo,['worktree','add','-b',branch,path,base]);}
export async function commitAll(cwd:string,message:string){
  await git(cwd,['add','--all']);const status=await git(cwd,['status','--porcelain']);
  if(status)await git(cwd,['-c','user.name=Orquesta','-c','user.email=orquesta@localhost','-c','commit.gpgsign=false','commit','-m',message]);return head(cwd);
}
export async function isAncestor(cwd:string,sha:string){const r=await execute('git',['merge-base','--is-ancestor',sha,'HEAD'],{cwd,env:cleanEnvironment(),timeoutMs:10000});if(r.code>1)throw new Error(r.stderr);return r.code===0;}
export async function merge(cwd:string,sha:string){
  if(await isAncestor(cwd,sha))return;
  try{await git(cwd,['-c','user.name=Orquesta','-c','user.email=orquesta@localhost','-c','commit.gpgsign=false','merge','--no-ff',sha,'-m','Orquesta: integrar entrega revisada']);}
  catch(error){await git(cwd,['merge','--abort']).catch(()=>{});throw error;}
}
export function acquireLock(directory:string,runId:string){
  mkdirSync(directory,{recursive:true});const file=join(directory,'execution.lock');
  if(existsSync(file)){
    let previous:any;try{previous=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Lock inválido: revisá .orquesta/execution.lock');}
    let alive=false;try{process.kill(previous.pid,0);alive=true;}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM')alive=true;}
    if(alive)throw new Error('Ya hay una ejecución activa en este proyecto: '+previous.runId);
    rmSync(file);
  }
  writeFileSync(file,JSON.stringify({pid:process.pid,runId}),{flag:'wx'});
  return()=>{if(existsSync(file)){const current=JSON.parse(readFileSync(file,'utf8'));if(current.pid===process.pid&&current.runId===runId)rmSync(file);}};
}
