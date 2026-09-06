import { defaults } from './config.js';
import type { Run } from './types.js';

// Local diagnostics only: viewing a blocked run never invokes a model.
export function runAttention(run:Run){
  if(!['blocked','paused','waiting_user'].includes(run.status))return null;
  const tasks=run.tasks.filter(task=>task.status==='blocked');
  const errors=[...tasks.map(task=>task.error).filter(Boolean),run.error].filter(Boolean) as string[];
  const details=tasks.filter(task=>task.error).map(task=>({taskId:task.id,title:task.title,error:task.error!}));
  const minutes=(run.config?.agentTimeoutMs??defaults.agentTimeoutMs)/60000;
  const base={title:'El trabajo necesita atención',message:'Revisá la causa antes de reintentar.',hint:'Se conservan las decisiones y las tareas integradas. Reintentar usa llamadas de modelos.',retryLabel:'Reintentar pendientes',retryAllowed:true,details};
  if(run.tasks.some(task=>task.pendingQuestion))return{...base,title:'Astra necesita una decisión tuya',message:'Respondé la pregunta de abajo. Después podés continuar desde este panel.',retryAllowed:false};
  if(run.status==='paused')return{...base,title:'El equipo está pausado',message:'Podés continuar desde el trabajo guardado.',retryLabel:'Continuar trabajo'};
  const gate=errors.find(error=>/maxCalls|Límite de (consultas|correcciones)|pruebas de Astra|worktree directamente|fuera del flujo|modificad[oa]|cambió.*(aprobación|revisión)|conflict/i.test(error));
  if(gate)return{...base,message:gate,hint:'Este bloqueo requiere revisar el plan, los límites o el código. Repetir la misma llamada no lo resuelve.',retryAllowed:false};
  const specific=errors.filter(error=>!/Hay tareas bloqueadas o dependencias pendientes/.test(error));
  if(specific.length&&specific.every(error=>/Tiempo de espera agotado/.test(error))){
    const timeout=Number(specific[0].match(/\((\d+) ms\)/)?.[1]);
    return{...base,title:'Se agotó el tiempo de espera',message:(tasks.length?tasks.length+' tarea'+(tasks.length===1?'':'s')+' interrumpida'+(tasks.length===1?'':'s'):'La respuesta fue interrumpida')+(timeout?' al llegar a '+timeout/60000+' min.':'.'),hint:`Al reintentar, cada respuesta del agente dispone de hasta ${minutes} min. Se conservan las decisiones y tareas integradas; las respuestas incompletas se vuelven a pedir y usan llamadas de modelos.`};
  }
  if(specific.length&&specific.every(error=>/at capacity|overloaded|rate.?limit|too many requests|429|529/i.test(error)))return{...base,title:'El proveedor no tiene capacidad disponible',message:'Esperá unos minutos y reintentá desde acá. Se mantiene el modelo que elegiste.'};
  if(errors.length)return{...base,message:specific[0]||errors[0]};
  return base;
}
