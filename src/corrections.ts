import { createHash } from 'node:crypto';
import { git } from './git.js';
import type { Config, CorrectionRevision, Run, Task } from './types.js';

export const stalledMessage='Sin avance tras cambiar el enfoque: se repiten entregas o problemas sin resolver. Se conservó el trabajo; hace falta nueva evidencia o ajustar la tarea antes de reintentar.';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=(text:string)=>text.toLowerCase().replace(/\b[0-9a-f]{7,40}\b/g,'COMMIT').replace(/\s+/g,' ').trim();

// Git blob identities ignore commit messages/timestamps and catch A → B → A.
export async function implementationIdentity(task:Task){
  return digest(await git(task.worktree!,['ls-tree','-r','HEAD','--',...task.allowedPaths]));
}

export function correctionContext(run:Run,task:Task,config:Config){
  return digest({objective:run.objective,description:task.description,paths:task.allowedPaths,acceptance:task.acceptance,decisions:run.decisions.filter(d=>d.taskId===task.id),instructions:config.instructions,checks:config.checks,setup:config.setupCommands,qaCommand:config.qaCommand});
}

export function recordCorrection(task:Task,revision:CorrectionRevision){
  const state=task.corrections!;
  const previous=state.history.at(-1);
  const failedChecks=revision.failedChecks;
  const checksImproved=!!previous&&failedChecks.length<previous.failedChecks.length&&failedChecks.every(name=>previous.failedChecks.includes(name));
  const findings=revision.findings.map(normalize).sort();
  const repeatedFindings=!!previous&&findings.length>0&&digest(findings)===digest(previous.findings.map(normalize).sort());
  const repeatedCode=state.history.some(item=>item.code===revision.code);
  const stalled=!!previous&&((repeatedCode&&!checksImproved)||(repeatedFindings&&!checksImproved)||task.review?.progress==='stalled');
  state.history.push(revision);state.history=state.history.slice(-12);
  state.stalledRounds=stalled?state.stalledRounds+1:0;
  if(!stalled){delete state.strategy;return 'continue';}
  if(state.stalledRounds>=2){state.stopped=true;return 'stop';}
  state.strategy=task.review?.nextApproach?.trim()||'Revisá la causa del fallo con la evidencia disponible y proponé un cambio de enfoque concreto. No repitas la entrega anterior; si falta un recurso imprescindible, consultá a Astra.';
  return 'replan';
}
