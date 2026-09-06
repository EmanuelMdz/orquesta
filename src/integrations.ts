import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function installIntegrations(userHome=homedir()){
  const source=fileURLToPath(new URL('../integrations/orquesta/SKILL.md',import.meta.url));
  const entry=fileURLToPath(new URL('../bin/orquesta.mjs',import.meta.url));
  const marker='<!-- orquesta-managed-skill -->';const content=readFileSync(source,'utf8');
  const roots=[join(userHome,'.agents','skills'),join(userHome,'.claude','skills')];
  const targets=roots.flatMap(root=>['orquesta','orquestar'].map(name=>({name,path:join(root,name)})));
  for(const target of targets){
    const file=join(target.path,'SKILL.md');
    if(existsSync(file)&&!readFileSync(file,'utf8').includes(marker))throw new Error('Ya existe una skill '+target.name+' ajena a Orquesta: '+file+'. Se conservó.');
  }
  for(const target of targets){
    mkdirSync(target.path,{recursive:true});writeFileSync(join(target.path,'SKILL.md'),content.replace(/^name: orquesta$/m,'name: '+target.name));
    writeFileSync(join(target.path,'launch.mjs'),`import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,[${JSON.stringify(entry)},...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});\nchild.on('error',error=>{console.error(error.message);process.exitCode=1;});\nchild.on('exit',code=>{process.exitCode=code??1;});\n`);
  }
  return{installed:targets.map(target=>target.path),codex:'$orquesta',claude:'/orquesta',terminal:'orquesta',aliases:{codex:'$orquestar',claude:'/orquestar'},message:'Reabrí los chats que no detecten la nueva skill. En Codex escribí $ y elegí orquesta, o buscala en /skills. Está disponible en todos tus proyectos.'};
}
