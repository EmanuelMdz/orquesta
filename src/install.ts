import { realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './process.js';
import { executable } from './commands.js';
import { installIntegrations } from './integrations.js';
import { defaults, doctor } from './config.js';
import { version } from './version.js';

export type InstallationReport=ReturnType<typeof installIntegrations>&{version:string;diagnostics:Awaited<ReturnType<typeof doctor>>};

export function installationSummary(report:InstallationReport){
  const providers=report.diagnostics.providers.map(provider=>`  ${provider.name}: ${provider.authenticated?'sesión disponible':provider.message}`).join('\n');
  return `Orquesta ${report.version} instalada para todos tus proyectos.\n\nAbrí el chat dentro de tu proyecto y escribí:\n\n  Codex        ${report.codex}\n  Claude Code  ${report.claude}\n  Terminal     ${report.terminal}\n\nEn Codex se usa el signo $, no /orquesta. Escribí $ y seleccioná orquesta.\nSi el chat estaba abierto al instalar, reabrilo; también podés buscar en /skills.\n\nConexiones:\n${providers}\n\nLa instalación terminó. No se inició ninguna tarea.`;
}

// Bootstrap from npx, then register helpers from the permanent global package.
// Packing the compiled payload avoids nested global Git preparation in npm 11.
export async function installEverywhere():Promise<InstallationReport>{
  const npm=async(args:string[],cwd?:string)=>{
    const call=executable('npm',args);const result=await execute(call.command,call.args,{cwd,timeoutMs:180000});
    if(result.code!==0)throw new Error(result.stderr||result.stdout);return result.stdout;
  };
  const root=(await npm(['root','--global'])).trim();
  const current=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
  const target=join(root,'orquesta-local');
  let permanent=false;try{permanent=current===realpathSync(target);}catch{}
  if(permanent){
    const installed=installIntegrations();
    for(const target of installed.installed){
      const probe=await execute(process.execPath,[join(target,'launch.mjs'),'--version'],{timeoutMs:10000});
      if(probe.code!==0||probe.stdout.trim()!==version)throw new Error('No se pudo verificar el acceso instalado: '+target);
    }
    return{...installed,version,diagnostics:await doctor(defaults)};
  }
  const temporary=mkdtempSync(join(tmpdir(),'orquesta-install-'));
  try{
    const packed=JSON.parse(await npm(['pack','--ignore-scripts','--json','--pack-destination',temporary],current));
    await npm(['install','--global',join(temporary,packed[0].filename),'--no-fund']);
    const result=await execute(process.execPath,[join(target,'bin','orquesta.mjs'),'install','--json'],{timeoutMs:90000});
    if(result.code!==0)throw new Error(result.stderr);return JSON.parse(result.stdout);
  }finally{rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
