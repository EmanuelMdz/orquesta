import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
export function redact(text: string): string {
  return text.replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9_]{12,})\b/g,'[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1[REDACTED]');
}
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const env={...process.env};
  for(const key of Object.keys(env)) if(/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) || /^(CODEX|CLAUDE|ANTHROPIC|OPENAI|NODE_TEST)/.test(key) || key==='NODE_OPTIONS') delete env[key];
  env.GIT_TERMINAL_PROMPT='0'; env.CI='1'; return env;
}
export interface ProcessOptions { cwd?:string; input?:string; signal?:AbortSignal; timeoutMs?:number; idleTimeoutMs?:number; env?:NodeJS.ProcessEnv; onLine?:(line:string,stream:'stdout'|'stderr')=>boolean|void; maxBytes?:number; captureOutput?:'full'|'tail' }
export async function execute(command:string,args:string[],options:ProcessOptions={}) {
  if(options.signal?.aborted) throw options.signal.reason ?? new Error('Cancelado');
  return await new Promise<{stdout:string;stderr:string;code:number}>((resolve,reject)=>{
    const child=spawn(command,args,{cwd:options.cwd,env:options.env??process.env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',done=false,reason:Error|undefined,idleTimer:ReturnType<typeof setTimeout>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
    const limit=options.maxBytes??4_000_000;
    const decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')};
    const pending={stdout:'',stderr:''};
    const terminate=(error:Error)=>{
      if(done||reason)return;reason=error;
      if(process.platform==='win32' && child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}
      else{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);}
    };
    const abort=()=>terminate(new Error('Ejecución pausada'));
    const timeoutMs=options.timeoutMs??300000;
    const timeout=timeoutMs>0?setTimeout(()=>terminate(new Error(`Tiempo de espera agotado (${timeoutMs} ms)`)),timeoutMs):undefined;
    const progress=()=>{if(done||reason)return;if(idleTimer)clearTimeout(idleTimer);if((options.idleTimeoutMs??0)>0)idleTimer=setTimeout(()=>terminate(new Error(`Sin actividad observable del agente (${options.idleTimeoutMs} ms). Puede estar esperando al proveedor; no se recibió progreso.`)),options.idleTimeoutMs);};
    const line=(text:string,stream:'stdout'|'stderr')=>{if(options.onLine?.(text,stream)===true)progress();};
    progress();
    options.signal?.addEventListener('abort',abort,{once:true});
    for(const name of ['stdout','stderr'] as const){
      child[name].on('data',(buffer:Buffer)=>{
        const text=decoders[name].write(buffer);
        if(name==='stdout')stdout+=text;else stderr+=text;
        if(options.captureOutput==='tail'){stdout=stdout.slice(-Math.floor(limit/2));stderr=stderr.slice(-Math.floor(limit/2));}
        else if(stdout.length+stderr.length>limit){terminate(new Error('La salida excedió el límite permitido'));return;}
        pending[name]+=text;
        const lines=pending[name].split('\n');pending[name]=lines.pop()!;
        if(pending[name].length>limit||lines.some(text=>text.length>limit)){terminate(new Error('Una línea de salida excedió el límite permitido'));return;}
        try{for(const text of lines)line(text.replace(/\r$/,''),name);}catch(error){terminate(error as Error);}
      });
    }
    const finish=(error?:Error,code?:number)=>{
      if(done)return;done=true;clearTimeout(timeout);clearTimeout(idleTimer);clearTimeout(killTimer);options.signal?.removeEventListener('abort',abort);
      for(const name of ['stdout','stderr'] as const){pending[name]+=decoders[name].end();if(pending[name]){try{line(pending[name],name);}catch(e){error=e as Error;}}}
      if(error||reason)reject(error??reason);else resolve({stdout,stderr,code:code??1});
    };
    child.on('error',error=>finish(error));child.on('close',code=>finish(undefined,code??1));
    child.stdin.on('error',()=>{});child.stdin.end(options.input??'');
  });
}
