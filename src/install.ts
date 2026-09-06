import { realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './process.js';
import { executable } from './commands.js';
import { installIntegrations } from './integrations.js';

// Bootstrap from npx, then register helpers from the permanent global package.
// Packing the compiled payload avoids nested global Git preparation in npm 11.
export async function installEverywhere(){
  const npm=async(args:string[],cwd?:string)=>{
    const call=executable('npm',args);const result=await execute(call.command,call.args,{cwd,timeoutMs:180000});
    if(result.code!==0)throw new Error(result.stderr||result.stdout);return result.stdout;
  };
  const root=(await npm(['root','--global'])).trim();
  const current=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
  const target=join(root,'orquesta-local');
  let permanent=false;try{permanent=current===realpathSync(target);}catch{}
  if(permanent)return installIntegrations();
  const temporary=mkdtempSync(join(tmpdir(),'orquesta-install-'));
  try{
    const packed=JSON.parse(await npm(['pack','--ignore-scripts','--json','--pack-destination',temporary],current));
    await npm(['install','--global',join(temporary,packed[0].filename),'--no-fund']);
    const result=await execute(process.execPath,[join(target,'bin','orquesta.mjs'),'install','--json'],{timeoutMs:30000});
    if(result.code!==0)throw new Error(result.stderr);return JSON.parse(result.stdout);
  }finally{rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
