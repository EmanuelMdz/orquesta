import { join } from 'node:path';
import type { Check } from './types.js';

// Tokenize a command without executing shell syntax. Quoted paths retain Windows backslashes.
export function parseCommand(line:string):string[]{
  const result:string[]=[];let token='',quote='',started=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(quote){if(char===quote)quote='';else if(char==='\\'&&(line[i+1]===quote||(quote==='"'&&line[i+1]==='\\'))){token+=line[++i];}else token+=char;started=true;}
    else if(char==='"'||char==="'"){quote=char;started=true;}
    else if(/\s/.test(char)){if(started){result.push(token);token='';started=false;}}
    else{token+=char;started=true;}
  }
  if(quote)throw new Error('Hay comillas sin cerrar en el comando.');
  if(started)result.push(token);
  if(!result.length||!result[0])throw new Error('Escribí un comando.');
  return result;
}
export function commandLine(args:string[]):string{return args.map(x=>/\s|["']/.test(x)?JSON.stringify(x):x).join(' ');}
export function commandList(text:string):Check[]{return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((line,index)=>{const[command,...args]=parseCommand(line);return{name:'Comprobación '+(index+1),command,args};});}
export function executable(command:string,args:string[]){
  if(command==='node')return{command:process.execPath,args};
  if(process.platform==='win32'&&['npm','npm.cmd'].includes(command))return{command:process.execPath,args:[join(process.execPath,'..','node_modules','npm','bin','npm-cli.js'),...args]};
  return{command,args};
}
