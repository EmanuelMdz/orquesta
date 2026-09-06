import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './types.js';

export const teamKeys=['orchestratorProvider','implementerProvider','astraModel','opusModel','workers','maxCalls','maxQuestions'] as const;
export interface Preset { id:string; name:string; team:Partial<Config> }
interface Library { version:1; defaultId:string; presets:Preset[] }
const builtin:Preset={id:'astra-opus',name:'Astra + Opus',team:{orchestratorProvider:'codex',implementerProvider:'claude',astraModel:'gpt-6-astra',opusModel:'opus',workers:2,maxCalls:40,maxQuestions:3}};
const directory=()=>process.env.ORQUESTA_USER_DIR??join(homedir(),'.orquesta');
export function presetLibrary():Library{
  const file=join(directory(),'presets.json');
  if(!existsSync(file))return{version:1,defaultId:builtin.id,presets:[structuredClone(builtin)]};
  const data=JSON.parse(readFileSync(file,'utf8'));
  if(data.version!==1||!Array.isArray(data.presets)||typeof data.defaultId!=='string')throw new Error('El archivo personal de combos no es válido.');
  for(const preset of data.presets)if(preset.team)delete preset.team.maxCorrections;
  return data;
}
export function defaultTeam(){const library=presetLibrary();return library.presets.find(p=>p.id===library.defaultId)?.team??builtin.team;}
export function savePreset(name:string,config:Config,makeDefault=false){
  if(typeof name!=='string'||!name.trim()||name.length>80)throw new Error('El nombre del combo admite de 1 a 80 caracteres.');
  const library=presetLibrary();let preset=library.presets.find(p=>p.name===name.trim());
  const team=Object.fromEntries(teamKeys.map(key=>[key,config[key]]));
  if(preset)preset.team=team;else{preset={id:randomUUID(),name:name.trim(),team};library.presets.push(preset);}
  if(makeDefault)library.defaultId=preset.id;
  const dir=directory();mkdirSync(dir,{recursive:true});const temp=join(dir,'presets.'+process.pid+'.tmp');
  writeFileSync(temp,JSON.stringify(library,null,2)+'\n',{flag:'wx'});renameSync(temp,join(dir,'presets.json'));return preset;
}
