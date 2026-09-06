import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { execute } from './process.js';
import type { Config } from './types.js';
import { defaultTeam } from './presets.js';
export const defaults:Config={version:1,orchestratorProvider:'codex',implementerProvider:'claude',astraModel:'gpt-6-astra',opusModel:'opus',workers:2,maxCorrections:2,maxQuestions:3,maxCalls:40,timeoutMs:300000,agentTimeoutMs:1200000,maxContextBytes:160000,qaRoot:'test/orquesta',qaCommand:['node','--test'],checks:[],instructions:'',setupCommands:[]};
export function validateConfig(input:unknown):Config{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('La configuración debe ser un objeto.');
  const allowed=new Set([...Object.keys(defaults),'codexPath','claudePath']);
  for(const key of Object.keys(input))if(!allowed.has(key))throw new Error('Campo de configuración desconocido: '+key);
  const config={...structuredClone(defaults),...input} as Config;
  for(const key of ['orchestratorProvider','implementerProvider'] as const)if(!['codex','claude'].includes(config[key]??''))throw new Error('Proveedor inválido: '+key);
  for(const [key,min,max] of [['workers',1,4],['maxCorrections',0,5],['maxQuestions',1,10],['maxCalls',1,200],['timeoutMs',1000,1800000],['agentTimeoutMs',1000,3600000],['maxContextBytes',1000,1000000]] as const){if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw new Error('Configuración inválida: '+key);}
  if(config.version!==1)throw new Error('Versión de configuración no soportada');
  if(!Array.isArray(config.qaCommand)||config.qaCommand.length===0||!config.qaCommand.every((x:unknown)=>typeof x==='string'&&x.length>0))throw new Error('qaCommand debe ser un array de comando y argumentos');
  for(const key of ['checks','setupCommands'] as const)if(!Array.isArray(config[key])||!config[key]!.every((x:any)=>x&&typeof x.name==='string'&&typeof x.command==='string'&&x.command.length>0&&Array.isArray(x.args)&&x.args.every((a:any)=>typeof a==='string')))throw new Error(key+' inválidos');
  for(const key of ['astraModel','opusModel'] as const)if(typeof config[key]!=='string'||!config[key].trim()||config[key].length>150)throw new Error('Modelo inválido: '+key);
  if(typeof config.instructions!=='string'||config.instructions.length>20000)throw new Error('Las instrucciones admiten hasta 20000 caracteres.');
  if(typeof config.qaRoot!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(config.qaRoot)||/^(node_modules|dist|bin)(\/|$)/.test(config.qaRoot))throw new Error('Carpeta de pruebas inválida.');
  for(const key of ['codexPath','claudePath'] as const)if(config[key]!==undefined&&typeof config[key]!=='string')throw new Error('Ruta inválida: '+key);
  return config;
}
export function localDirectory(repo:string){
  const dir=join(repo,'.orquesta');
  if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw new Error('.orquesta no puede ser un enlace o junction.');
  return dir;
}
export function loadConfig(repo:string):Config{
  const shared=join(repo,'orquesta.config.json'),local=join(localDirectory(repo),'config.json');
  return validateConfig({...defaults,...(!existsSync(shared)&&!existsSync(local)?defaultTeam():{}),...(existsSync(shared)?JSON.parse(readFileSync(shared,'utf8')):{}),...(existsSync(local)?JSON.parse(readFileSync(local,'utf8')):{})});
}
export async function repository(path:string){const r=await execute('git',['rev-parse','--show-toplevel'],{cwd:resolve(path),timeoutMs:10000});if(r.code!==0)throw new Error('Elegí una carpeta con un repositorio Git.');return resolve(r.stdout.trim());}
export function initialize(repo:string){
  const dir=localDirectory(repo);mkdirSync(dir,{recursive:true});
  const ignore=resolve(repo,execFileSync('git',['rev-parse','--git-path','info/exclude'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim());
  const content=existsSync(ignore)?readFileSync(ignore,'utf8'):'';
  if(!content.split(/\r?\n/).includes('/.orquesta/')){mkdirSync(dirname(ignore),{recursive:true});writeFileSync(ignore,content+(content.endsWith('\n')||!content?'':'\n')+'/.orquesta/\n');}
  const file=join(dir,'config.json');if(!existsSync(file))saveConfig(repo,loadConfig(repo));
  return file;
}
export function saveConfig(repo:string,value:unknown){
  const config=validateConfig(value);const dir=localDirectory(repo);mkdirSync(dir,{recursive:true});
  const file=join(dir,'config.json');if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new Error('La configuración no puede ser un enlace.');
  const temporary=join(dir,'config.'+process.pid+'.tmp');writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{flag:'wx'});renameSync(temporary,file);return config;
}
export function projectInfo(repo:string){
  let pkg:any={};try{pkg=JSON.parse(readFileSync(join(repo,'package.json'),'utf8'));}catch{}
  const deps={...pkg.dependencies,...pkg.devDependencies};
  const framework=deps.vitest?'Vitest':deps['@playwright/test']?'Playwright':existsSync(join(repo,'pyproject.toml'))?'Python':'Node.js';
  return{name:pkg.name??repo.split(/[\\/]/).pop(),framework,scripts:pkg.scripts??{},npmLock:existsSync(join(repo,'package-lock.json'))};
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
