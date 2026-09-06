import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Engine } from '../dist/engine.js';
import { createDemo } from '../dist/demo.js';
import { defaults,doctor } from '../dist/config.js';
const info=await doctor(defaults);
if(info.providers.some(p=>!p.authenticated))throw new Error('Iniciá sesión con Codex y Claude antes de test:live.');
const root=resolve(import.meta.dirname,'..');const repo=await createDemo(root);
const config={...defaults,workers:1,maxCalls:10,timeoutMs:180000,maxContextBytes:50000};
const engine=new Engine(repo,config);
engine.on('event',e=>{if(!['provider.log','provider.usage'].includes(e.type))console.log(e.time.slice(11,19),e.role,e.type,e.message);});
const objective='Prueba de integración con modelos reales. Planificá UNA SOLA tarea de implementación con id suma-live y allowedPaths=["src/add.js"]. Implementar export function add(a,b): suma dos números finitos, permite negativos y decimales; para NaN, Infinity y entradas que no sean números, lanzar TypeError. No modificar greet.js. Protocolo obligatorio de esta prueba: en su PRIMERA respuesta Opus debe devolver needs_decision preguntando a Astra si los valores no finitos deben lanzar TypeError. Astra responderá confirmando esa regla y después Opus implementará. Esto comprueba el canal de consultas aunque el criterio esté indicado aquí. Astra Calidad debe crear pruebas node:test compactas y revisarlas. No añadir dependencias.';
const run=await engine.create(objective,'live');console.log('Proyecto de prueba real:',repo);console.log('Run:',run.id);
try{
  const result=await engine.start(run.id);
  writeFileSync(join(root,'.orquesta','live-smoke-latest.json'),JSON.stringify({repo,runId:run.id,status:result.status,sha:result.finalSha,error:result.error,calls:result.calls},null,2));
  assert.equal(result.status,'completed',result.error);
  const events=engine.store.events(run.id);assert(events.some(e=>e.type==='decision.requested'),'Opus no consultó a Astra');assert(events.some(e=>e.type==='decision.answered'),'No hubo respuesta de Astra');assert(result.checks.every(c=>c.exitCode===0));
  console.log('PASS: Astra planificó y respondió, Opus implementó, Astra escribió pruebas y revisó; la integración pasó.');
}finally{await engine.close();}
