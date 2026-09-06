import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const personal=mkdtempSync(join(tmpdir(),'orquesta-test-settings-'));
const files=readdirSync(new URL('../test/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).map(name=>new URL('../test/'+name,import.meta.url));
const {fileURLToPath}=await import('node:url');
try{
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test',...files.map(file=>fileURLToPath(file))],{stdio:'inherit',env:{...process.env,ORQUESTA_USER_DIR:personal,ORQUESTA_NO_OPEN:'1'},windowsHide:true});
    child.once('error',reject);child.once('exit',code=>resolve(code??1));
  });
}finally{rmSync(personal,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
