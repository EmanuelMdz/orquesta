import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Change, Config, Plan } from './types.js';
const control=/^(?:\.git|\.orquesta|\.codex|\.claude|node_modules)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|orquesta\.config\.json)$/i;
export function safeRelative(path:string):string{
  if(!path||path.includes('\\')||path.includes(':')||path.startsWith('/')||path.includes('\0')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)))throw new Error('Ruta inválida: '+path);
  if(control.test(path))throw new Error('Ruta de control protegida: '+path);
  return path;
}
export function safeTarget(root:string,path:string){
  safeRelative(path);const target=resolve(root,path);const rel=relative(resolve(root),target);
  if(rel.startsWith('..'+sep)||rel==='..'||resolve(root)===target)throw new Error('Ruta fuera del worktree');
  let current=resolve(root);
  if(lstatSync(current).isSymbolicLink())throw new Error('Worktree simbólico no permitido');
  for(const part of path.split('/')){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Enlace simbólico no permitido: '+path);}
  return target;
}
export function validatePlan(plan:Plan,config:Config){
  const ids=new Set<string>();const qa=safeRelative(config.qaRoot);
  for(const task of plan.tasks){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(task.id)||ids.has(task.id))throw new Error('Identificador de tarea inválido o repetido');ids.add(task.id);
    const unique=new Set<string>();
    for(const path of task.allowedPaths){safeRelative(path);const key=path.toLowerCase();if(key===qa.toLowerCase()||key.startsWith(qa.toLowerCase()+'/'))throw new Error('Opus no puede modificar las pruebas de Astra');if(unique.has(key))throw new Error('Ruta repetida en la tarea');unique.add(key);}
  }
  const visited=new Set<string>(),visiting=new Set<string>();
  function visit(id:string){if(visited.has(id))return;if(visiting.has(id))throw new Error('El plan contiene dependencias cíclicas');const task=plan.tasks.find(t=>t.id===id);if(!task)throw new Error('Dependencia inexistente: '+id);visiting.add(id);for(const dep of task.dependsOn)visit(dep);visiting.delete(id);visited.add(id);}
  for(const id of ids)visit(id);
}
export function applyChanges(root:string,files:Change[],allowed:string[]){
  const allowedSet=new Set(allowed);const seen=new Set<string>();
  // Validate the entire batch before writing the first byte.
  const targets=files.map(file=>{
    if(!allowedSet.has(file.path))throw new Error('Cambio fuera del alcance: '+file.path);
    const key=file.path.toLowerCase();if(seen.has(key))throw new Error('Cambio duplicado: '+file.path);seen.add(key);
    if(Buffer.byteLength(file.content)>1_000_000)throw new Error('Archivo demasiado grande');
    const target=safeTarget(root,file.path);if(existsSync(target)&&!lstatSync(target).isFile())throw new Error('El destino no es un archivo regular');
    return{...file,target};
  });
  for(const file of targets){if(file.action==='delete'){if(existsSync(file.target))unlinkSync(file.target);}else{mkdirSync(dirname(file.target),{recursive:true});writeFileSync(file.target,file.content,'utf8');}}
}
export function readSource(root:string,files:string[],budget:number){
  const result:Record<string,string>={};let used=0;const omitted:string[]=[];
  for(const path of files){
    if(control.test(path)||/\.(?:pem|key|p12|pfx|lock|png|jpg|gif|pdf|zip|db|sqlite)$/i.test(path))continue;
    try{const target=safeTarget(root,path);if(!existsSync(target)||!lstatSync(target).isFile()||lstatSync(target).size>budget){omitted.push(path);continue;}const content=readFileSync(target,'utf8');if(content.includes('\0'))continue;const size=Buffer.byteLength(content);if(used+size>budget){omitted.push(path);continue;}result[path]=content;used+=size;}catch{omitted.push(path);}
  }
  return{files:result,omitted};
}
