import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize, loadConfig, saveConfig } from '../dist/config.js';
import { parseCommand, commandLine } from '../dist/commands.js';
import { git, commitAll } from '../dist/git.js';
import { openService } from '../dist/service.js';
import { execute, cleanEnvironment } from '../dist/process.js';
import { presetLibrary,savePreset } from '../dist/presets.js';
import { installIntegrations } from '../dist/integrations.js';
import { backgroundService,findService } from '../dist/service.js';
import { CliProvider } from '../dist/providers.js';

const source=fileURLToPath(new URL('..',import.meta.url));
async function project(t){
  const dir=mkdtempSync(join(tmpdir(),'orq-project-'));const repo=join(dir,'repo');mkdirSync(repo);
  await git(repo,['init','-b','main']);writeFileSync(join(repo,'README.md'),'# Example\n');await commitAll(repo,'Initial');
  const resources=[];t.after(async()=>{for(const resource of resources)await resource.close();rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});});return{dir,repo,resources};
}

test('first use needs no tracked config, gitignore edit or extra commit; projects keep separate settings',async t=>{
  const a=await project(t),b=await project(t);const before=await git(a.repo,['rev-parse','HEAD']);
  initialize(a.repo);initialize(b.repo);
  saveConfig(a.repo,{...loadConfig(a.repo),workers:3,instructions:'Consultá cambios de arquitectura.'});
  assert.equal(loadConfig(a.repo).workers,3);assert.equal(loadConfig(b.repo).workers,2);
  assert.equal(await git(a.repo,['status','--porcelain']),'');assert.equal(await git(a.repo,['rev-parse','HEAD']),before);
  assert.equal(existsSync(join(a.repo,'.gitignore')),false);assert.equal(existsSync(join(a.repo,'orquesta.config.json')),false);
  const original=readFileSync(join(a.repo,'.orquesta/config.json'),'utf8');
  assert.throws(()=>saveConfig(a.repo,{workers:1000}));assert.throws(()=>saveConfig(a.repo,{qaRoot:'../escape'}));
  assert.equal(readFileSync(join(a.repo,'.orquesta/config.json'),'utf8'),original);
});

test('command fields preserve quoted arguments and Windows paths without shell evaluation',()=>{
  const args=['C:\\Program Files\\nodejs\\node.exe','path with spaces/test.js','--name','a "quoted" value'];
  assert.deepEqual(parseCommand(commandLine(args)),args);
  assert.deepEqual(parseCommand('node --test "tests/my test.js"'),['node','--test','tests/my test.js']);
  assert.deepEqual(parseCommand('node script.js && echo nope'),['node','script.js','&&','echo','nope']);
  assert.throws(()=>parseCommand('node "missing'));
});

test('a personal combo becomes the default in new projects while existing projects keep their settings',async t=>{
  const a=await project(t),b=await project(t);const previous=process.env.ORQUESTA_USER_DIR;process.env.ORQUESTA_USER_DIR=join(a.dir,'personal');
  t.after(()=>{if(previous===undefined)delete process.env.ORQUESTA_USER_DIR;else process.env.ORQUESTA_USER_DIR=previous;});
  initialize(a.repo);const config={...loadConfig(a.repo),workers:3,orchestratorProvider:'claude',astraModel:'opus',implementerProvider:'codex',opusModel:'gpt-6-astra'};
  const saved=savePreset('Mi equipo',config,true);assert.equal(presetLibrary().defaultId,saved.id);
  initialize(b.repo);assert.equal(loadConfig(b.repo).workers,3);assert.equal(loadConfig(b.repo).orchestratorProvider,'claude');assert.equal(loadConfig(a.repo).workers,2);
  assert.equal(await git(b.repo,['status','--porcelain']),'');
});

test('skill installation covers both clients and preserves an existing unrelated skill',async t=>{
  const {dir}=await project(t);const home=join(dir,'home');const result=installIntegrations(home);
  assert.equal(result.installed.length,2);for(const target of result.installed){assert(existsSync(join(target,'SKILL.md')));assert(existsSync(join(target,'launch.mjs')));}
  const helper=join(result.installed[0],'launch.mjs');const response=await execute(process.execPath,[helper,'--version'],{timeoutMs:10000});assert.equal(response.code,0);assert.match(response.stdout,/0.2.0/);
  const existing=join(result.installed[0],'SKILL.md');writeFileSync(existing,'Personal skill');assert.throws(()=>installIntegrations(home),/Se conservó/);assert.equal(readFileSync(existing,'utf8'),'Personal skill');
});

test('model routing depends on the chosen role provider, including Claude directing Codex implementers',async t=>{
  const {dir,repo}=await project(t);const fake=join(dir,'provider.js');
  writeFileSync(fake,`const args=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>{const value={summary:JSON.stringify(args)};console.log(JSON.stringify(args[0]==='-p'?{type:'result',structured_output:value}:{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));});`);
  const config={...loadConfig(repo),orchestratorProvider:'claude',astraModel:'opus',implementerProvider:'codex',opusModel:'gpt-6-astra',codexPath:fake,claudePath:fake};
  const provider=new CliProvider(config);const schema={type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false};
  const invoke=role=>provider.invoke({phase:'decide',role,cwd:repo,prompt:'test',schema,signal:new AbortController().signal,run:{},onEvent:()=>{}});
  const director=JSON.parse((await invoke('astra')).value.summary);assert.equal(director[0],'-p');assert.equal(director[director.indexOf('--model')+1],'opus');
  const worker=JSON.parse((await invoke('opus')).value.summary);assert.equal(worker[0],'exec');assert.equal(worker[worker.indexOf('--model')+1],'gpt-6-astra');
});

test('launch returns a reusable background service that can be closed from another client',async t=>{
  const {repo}=await project(t);const service=await backgroundService(repo);const again=await backgroundService(repo);
  assert.equal(service.url,again.url);assert.equal(service.owned,false);
  const info=await service.request('/api/config');assert.equal(info.dirty,'');
  await service.request('/api/stop',{});
  let stopped=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,100));if(!await findService(repo)){stopped=true;break;}}
  assert(stopped,'Background service must release its descriptor after stopping');
});

test('one shared service connects Codex MCP and dashboard; closing a client preserves its owner',async t=>{
  const {repo,resources}=await project(t);const owner=await openService(repo,{demo:true});resources.push(owner);
  const peer=await openService(repo);assert.equal(peer.owned,false);assert.equal(peer.url,owner.url);
  const saved=await peer.request('/api/config',{config:{workers:1,instructions:'Regla de este proyecto.'},qaCommandLine:'node --test',checksText:'',setupText:''});
  assert.equal(saved.config.workers,1);
  const messages=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}},
    {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'orquesta_start',arguments:{repo_path:repo,objective:'Demo compartida'}}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'orquesta_pause',arguments:{repo_path:repo}}}
  ];
  const result=await execute(process.execPath,[join(source,'bin/orquesta.mjs'),'mcp'],{input:messages.map(JSON.stringify).join('\n')+'\n',env:cleanEnvironment(),timeoutMs:15000});
  assert.equal(result.code,0,result.stderr);
  const replies=result.stdout.trim().split('\n').map(JSON.parse);const started=JSON.parse(replies[1].result.content[0].text);
  assert.equal(started.panel_url,owner.url);assert(started.run_id);
  await owner.engine.wait();
  const state=await peer.request('/api/state');assert.equal(state.runs[0].id,started.run_id);assert.equal(state.runs[0].status,'paused');
  assert.equal(state.runs[0].config.instructions,'Regla de este proyecto.');
  assert((await peer.request('/api/events?run='+started.run_id)).some(e=>e.type==='run.pause_requested'));
  await peer.close();assert.equal((await owner.request('/api/health')).app,'orquesta');
  assert.equal(await git(repo,['status','--porcelain']),'');
});

test('orquesta codex bootstraps a clean project and passes a session-local MCP connection to Codex',async t=>{
  const {repo,dir}=await project(t);initialize(repo);
  const fake=join(dir,'fake-codex.js');writeFileSync(fake,"console.log('CODEX_ARGS '+JSON.stringify(process.argv.slice(2)));\n");
  saveConfig(repo,{...loadConfig(repo),codexPath:fake});
  const result=await execute(process.execPath,[resolve(source,'bin/orquesta.mjs'),'codex','--repo',repo,'--no-open'],{env:cleanEnvironment(),timeoutMs:15000});
  assert.equal(result.code,0,result.stderr);
  const line=result.stdout.split('\n').find(line=>line.startsWith('CODEX_ARGS '));assert(line);
  const args=JSON.parse(line.slice(11));assert.equal(args[0],'--model');assert.equal(args[1],'gpt-6-astra');
  assert(args.some(arg=>arg.startsWith('mcp_servers.orquesta=')&&arg.includes('"mcp"')));
  assert.equal(await git(repo,['status','--porcelain']),'');
  assert.equal(existsSync(join(repo,'.orquesta/panel.json')),false);
});
