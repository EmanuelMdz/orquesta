import { execute } from './process.js';

export async function openBrowser(url:string){
  if(process.env.ORQUESTA_NO_OPEN==='1')return;
  if(!/^http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})$/.test(url))throw new Error('URL de panel inválida.');
  const command=process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`Start-Process -FilePath '${url}'`]:[url];
  const result=await execute(command,args,{timeoutMs:10000});
  if(result.code!==0)throw new Error('No se pudo abrir el navegador. Abrí el enlace que muestra la terminal.');
}
