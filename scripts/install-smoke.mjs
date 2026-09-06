// Exercise the distributed package through npm exec, without the developer's
// installation, personal settings or npm cache. This check needs npm registry access.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executable } from '../dist/commands.js';
import { execute, cleanEnvironment } from '../dist/process.js';

const source=fileURLToPath(new URL('..',import.meta.url));
const version=JSON.parse(readFileSync(join(source,'package.json'),'utf8')).version;
const temporary=realpathSync(mkdtempSync(join(tmpdir(),'orquesta-install-check-')));
const personal=join(temporary,'home with spaces');
const prefix=join(temporary,'global prefix');
const cache=join(temporary,'npm cache');
const work=join(temporary,'working');
for(const path of [personal,prefix,cache,work])mkdirSync(path,{recursive:true});
const env={...cleanEnvironment(),HOME:personal,USERPROFILE:personal,APPDATA:join(personal,'AppData','Roaming'),LOCALAPPDATA:join(personal,'AppData','Local'),
  CODEX_HOME:join(personal,'.codex'),CLAUDE_CONFIG_DIR:join(personal,'.claude'),ORQUESTA_USER_DIR:join(personal,'.orquesta'),ORQUESTA_NO_OPEN:'1',
  npm_config_prefix:prefix,npm_config_cache:cache,npm_config_userconfig:join(personal,'.npmrc'),npm_config_globalconfig:join(personal,'global.npmrc')};
for(const key of Object.keys(env))if(/^npm_config_(global|prefix|cache|userconfig|globalconfig)$/i.test(key)&&!Object.hasOwn({npm_config_prefix:1,npm_config_cache:1,npm_config_userconfig:1,npm_config_globalconfig:1},key))delete env[key];
delete env.ORQUESTA_SKIP_INTEGRATIONS;
const npm=executable('npm',[]);
const run=async(command,args,cwd=work)=>{
  const result=await execute(command,args,{cwd,env,timeoutMs:240000});
  assert.equal(result.code,0,`${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
};
const npmRun=(args,cwd)=>run(npm.command,[...npm.args,...args],cwd);
function removeWithinTemporary(path){
  const absolute=resolve(path),inside=relative(temporary,absolute);
  assert(inside&&!inside.startsWith('..')&&!isAbsolute(inside),'Cleanup must stay inside the test workspace');
  rmSync(absolute,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}

try{
  const packed=JSON.parse(await npmRun(['pack','--ignore-scripts','--json','--pack-destination',temporary],source));
  const archive=join(temporary,packed[0].filename);
  assert(existsSync(archive));
  const result=JSON.parse(await npmRun(['exec','--yes','--package',archive,'--','orquesta','install','--json']));
  assert.equal(result.version,version);
  assert.equal(result.codex,'$orquesta');assert.equal(result.claude,'/orquesta');
  const globalRoot=await npmRun(['root','--global']);
  const entry=join(globalRoot,'orquesta-local','bin','orquesta.mjs');
  assert(existsSync(entry));
  const expected=['.agents','.claude'].flatMap(client=>['orquesta','orquestar'].map(name=>join(personal,client,'skills',name)));
  assert.deepEqual(result.installed,expected);
  removeWithinTemporary(cache);
  for(const skill of expected){
    const name=skill.endsWith('orquestar')?'orquestar':'orquesta';
    assert(new RegExp(`^name: ${name}$`,'m').test(readFileSync(join(skill,'SKILL.md'),'utf8')));
    const helper=join(skill,'launch.mjs');
    assert(readFileSync(helper,'utf8').includes(JSON.stringify(entry)),'Helper must use the permanent installed entry');
    assert.equal(await run(process.execPath,[helper,'--version']),version);
  }
  const repeated=JSON.parse(await run(process.execPath,[entry,'install','--json']));
  assert.deepEqual(repeated.installed,result.installed);
  const helper=join(expected[0],'launch.mjs');
  for(const name of ['first repo','second repo']){
    const repo=join(temporary,name);mkdirSync(repo);
    await run('git',['init','-b','main'],repo);
    writeFileSync(join(repo,'README.md'),'# Installation fixture\n');
    await run('git',['add','README.md'],repo);
    await run('git',['-c','user.name=Orquesta Test','-c','user.email=test@example.invalid','commit','-m','Initial'],repo);
    const described=JSON.parse(await run(process.execPath,[helper,'describe','--repo',repo,'--json'],repo));
    assert.equal(described.config.version,1);
    assert.equal(await run('git',['status','--porcelain'],repo),'');
  }
  console.log(`Installation ${version} OK: fresh profile, npm exec, global package, both skills and aliases, cache removed, two clean repositories.`);
}finally{
  assert.equal(dirname(temporary),realpathSync(tmpdir()));
  rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
