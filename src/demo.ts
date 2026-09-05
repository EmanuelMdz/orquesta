import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, initialize } from './config.js';
import { commitAll, git } from './git.js';
export async function createDemo(parent:string){
  const repo=resolve(parent,'.orquesta','demos','demo-'+randomUUID().slice(0,8));mkdirSync(join(repo,'src'),{recursive:true});
  writeFileSync(join(repo,'package.json'),JSON.stringify({name:'orquesta-example',private:true,type:'module',scripts:{test:'node --test'}},null,2)+'\n');
  writeFileSync(join(repo,'src','greet.js'),'export function greet(name) { throw new Error("TODO"); }\n');
  writeFileSync(join(repo,'src','add.js'),'export function add(a, b) { throw new Error("TODO"); }\n');
  writeFileSync(join(repo,'README.md'),'# Proyecto de prueba de Orquesta\n\nImplementar greet(name) y add(a,b). Las pruebas deben usar node:test.\n');
  await git(repo,['init','-b','main']);initialize(repo);await commitAll(repo,'Proyecto de prueba inicial');return repo;
}
