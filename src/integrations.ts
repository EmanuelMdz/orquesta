import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function installIntegrations(userHome=homedir()){
  const source=fileURLToPath(new URL('../integrations/orquestar/SKILL.md',import.meta.url));
  const entry=fileURLToPath(new URL('../bin/orquesta.mjs',import.meta.url));
  const marker='<!-- orquesta-managed-skill -->';const content=readFileSync(source,'utf8');
  const targets=[join(userHome,'.agents','skills','orquestar'),join(userHome,'.claude','skills','orquestar')];
  for(const target of targets){
    const file=join(target,'SKILL.md');
    if(existsSync(file)&&!readFileSync(file,'utf8').includes(marker))throw new Error('Ya existe una skill orquestar ajena a Orquesta: '+file+'. Se conservó.');
  }
  for(const target of targets){
    mkdirSync(target,{recursive:true});writeFileSync(join(target,'SKILL.md'),content);
    writeFileSync(join(target,'launch.mjs'),`import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,[${JSON.stringify(entry)},...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});\nchild.on('error',error=>{console.error(error.message);process.exitCode=1;});\nchild.on('exit',code=>{process.exitCode=code??1;});\n`);
  }
  return{installed:targets,codex:'$orquestar',claude:'/orquestar',message:'Reabrí los chats que no detecten la nueva skill. Está disponible en todos tus proyectos.'};
}
