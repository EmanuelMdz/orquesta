import test from 'node:test';
import assert from 'node:assert/strict';
import { runAttention } from '../dist/attention.js';
import { validateConfig,defaults } from '../dist/config.js';

test('blocked-run diagnostics distinguish capacity, timeouts, user decisions and review gates',()=>{
  const run={status:'blocked',tasks:[],config:defaults};
  assert.equal(runAttention({...run,status:'running'}),null);
  assert.equal(runAttention({...run,error:'Selected model is at capacity'}).title,'El proveedor no tiene capacidad disponible');
  assert.equal(runAttention({...run,error:'Opus no puede modificar las pruebas de Astra'}).retryAllowed,false);
  assert.equal(runAttention({...run,tasks:[{status:'blocked',pendingQuestion:'Tu decisión'}]}).retryAllowed,false);
  assert.equal(runAttention({...run,status:'paused'}).retryLabel,'Continuar trabajo');
  assert.equal(runAttention({...run,error:'Se alcanzó maxCalls.'}).retryAllowed,false);
  const diagnostic=runAttention({...run,error:'Hay tareas bloqueadas o dependencias pendientes.',tasks:[{id:'a',title:'API',status:'blocked',error:'Tiempo de espera agotado (300000 ms)'},{id:'b',title:'UI',status:'blocked',error:'La entrega aprobada fue modificada.'}]});
  assert.equal(diagnostic.retryAllowed,false,'A timeout must not hide another task’s review failure');
  assert.equal(diagnostic.details.length,2);
});

test('older configurations gain the response timeout while retaining their existing limits',()=>{
  const legacy={...defaults,timeoutMs:300000,maxCalls:17};delete legacy.agentTimeoutMs;
  const config=validateConfig(legacy);assert.equal(config.agentTimeoutMs,0);assert.equal(config.agentIdleTimeoutMs,900000);assert.equal(config.timeoutMs,300000);assert.equal(config.maxCalls,17);
  assert.equal(validateConfig({...legacy,agentTimeoutMs:1800000}).agentTimeoutMs,1800000);
  assert.equal(validateConfig({...legacy,agentIdleTimeoutMs:0}).agentIdleTimeoutMs,0);
  for(const invalid of [-1,NaN,'1200000',86400001])for(const field of ['agentTimeoutMs','agentIdleTimeoutMs'])assert.throws(()=>validateConfig({...legacy,[field]:invalid}),new RegExp(field));
});
