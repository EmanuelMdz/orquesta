import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { execute } from './process.js';
import type { Config } from './types.js';
export const defaults:Config={version:1,astraModel:'gpt-6-astra',opusModel:'opus',workers:2,maxCorrections:2,maxQuestions:3,maxCalls:40,timeoutMs:300000,maxContextBytes:160000,qaRoot:'test/orquesta',qaCommand:['node','--test'],checks:[]};
export function loadConfig(repo:string):Config{
  const file=join(repo,'orquesta.config.json');const config={...defaults,...(existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{})};
  for(const [key,min,max] of [['workers',1,4],['maxCorrections',0,5],['maxQuestions',1,10],['maxCalls',1,200],['timeoutMs',1000,1800000],['maxContextBytes',1000,1000000]] as const){if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw new Error('Configuración inválida: '+key);}
  if(config.version!==1)throw new Error('Versión de configuración no soportada');
  if(!Array.isArray(config.qaCommand)||config.qaCommand.length===0||!config.qaCommand.every((x:unknown)=>typeof x==='string'&&x.length>0))throw new Error('qaCommand debe ser un array de comando y argumentos');
  if(!Array.isArray(config.checks)||!config.checks.every((x:any)=>typeof x.name==='string'&&typeof x.command==='string'&&Array.isArray(x.args)&&x.args.every((a:any)=>typeof a==='string')))throw new Error('checks inválidos');
  return config;
}
export async function repository(path:string){const r=await execute('git',['rev-parse','--show-toplevel'],{cwd:resolve(path),timeoutMs:10000});if(r.code!==0)throw new Error('Elegí una carpeta con un repositorio Git.');return resolve(r.stdout.trim());}
export function initialize(repo:string){
  const file=join(repo,'orquesta.config.json');if(!existsSync(file))writeFileSync(file,JSON.stringify(defaults,null,2)+'\n');
  const ignore=join(repo,'.gitignore');const content=existsSync(ignore)?readFileSync(ignore,'utf8'):'';
  if(!content.split(/\r?\n/).includes('.orquesta/'))writeFileSync(ignore,content+(content.endsWith('\n')||!content?'':'\n')+'.orquesta/\n');
  return file;
}
export function findBinary(name:'codex'|'claude',configured?:string):string|undefined{
  if(configured){if(existsSync(configured))return resolve(configured);throw new Error('No existe el ejecutable configurado para '+name);}
  const envPath=process.env[name==='codex'?'ORQUESTA_CODEX_PATH':'ORQUESTA_CLAUDE_PATH'];if(envPath&&existsSync(envPath))return envPath;
  const suffix=process.platform==='win32'?'.exe':'';
  for(const dir of (process.env.PATH??'').split(delimiter)){
    const file=join(dir,name+suffix);if(existsSync(file))return file;
    if(process.platform==='win32'){
      const entry=name==='codex'?join(dir,'node_modules','@openai','codex','bin','codex.js'):join(dir,'node_modules','@anthropic-ai','claude-code','cli.js');
      if(existsSync(entry))return entry;
    }
  }
  for(const folder of [join(homedir(),'.local','bin'),join(homedir(),'.cargo','bin')]){const file=join(folder,name+suffix);if(existsSync(file))return file;}
  const extensions=join(homedir(),'.vscode','extensions');
  if(existsSync(extensions)){
    const prefix=name==='codex'?'openai.chatgpt-':'anthropic.claude-code-';
    const versions=readdirSync(extensions).filter(x=>x.startsWith(prefix)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    for(const version of versions){
      const folder=join(extensions,version);
      const file=name==='claude'?join(folder,'resources','native-binary',name+suffix):join(folder,'bin',process.platform==='win32'?'windows-x86_64':process.platform==='darwin'?(process.arch==='arm64'?'macos-aarch64':'macos-x86_64'):'linux-x86_64',name+suffix);
      if(existsSync(file))return file;
    }
  }
  // npm installs on Windows expose a .cmd shim. Resolve only known JS entry points, never shell-expand user input.
  const npmRoot=process.env.APPDATA?join(process.env.APPDATA,'npm','node_modules'):'';
  const entry=name==='codex'?join(npmRoot,'@openai','codex','bin','codex.js'):join(npmRoot,'@anthropic-ai','claude-code','cli.js');
  return npmRoot&&existsSync(entry)?entry:undefined;
}
export function binaryCommand(file:string,args:string[]){return file.endsWith('.js')?{command:process.execPath,args:[file,...args]}:{command:file,args};}
export async function doctor(config:Config){
  const entries=await Promise.all((['codex','claude'] as const).map(async name=>{
    const path=findBinary(name,name==='codex'?config.codexPath:config.claudePath);
    if(!path)return{name,path:null,installed:false,authenticated:false,message:'No encontrado. Instalá la CLI oficial o configurá su ruta.'};
    try{
      const v=binaryCommand(path,['--version']);const version=await execute(v.command,v.args,{timeoutMs:15000});
      const a=binaryCommand(path,name==='codex'?['login','status']:['auth','status']);const auth=await execute(a.command,a.args,{timeoutMs:30000});
      let authenticated=auth.code===0;
      if(name==='claude'){try{authenticated=Boolean(JSON.parse(auth.stdout).loggedIn);}catch{authenticated=auth.code===0;}}
      return{name,path,installed:version.code===0,version:version.stdout.trim(),authenticated,message:authenticated?'Sesión disponible; acceso al modelo se verifica al ejecutar.':'Iniciá sesión con '+name+' antes de una ejecución real.'};
    }catch(error){return{name,path,installed:true,authenticated:false,message:(error as Error).message};}
  }));return{node:process.version,platform:process.platform,providers:entries};
}
