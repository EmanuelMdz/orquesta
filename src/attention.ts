import { defaults } from './config.js';
import type { Run } from './types.js';

// Local diagnostics only: viewing a blocked run never invokes a model.
export function runAttention(run:Run){
  if(!['blocked','paused','waiting_user'].includes(run.status))return null;
  const tasks=run.tasks.filter(task=>task.status==='blocked');
  const errors=[...tasks.map(task=>task.error).filter(Boolean),run.error].filter(Boolean) as string[];
  const details=tasks.filter(task=>task.error).map(task=>({taskId:task.id,title:task.title,error:task.error!}));
  const minutes=(run.config?.agentTimeoutMs??defaults.agentTimeoutMs)/60000;
  const idleMinutes=(run.config?.agentIdleTimeoutMs??defaults.agentIdleTimeoutMs)/60000;
  const base={title:'El trabajo necesita atención',message:'Revisá la causa antes de reintentar.',hint:'Se conservan las decisiones y las tareas integradas. Reintentar usa llamadas de modelos.',retryLabel:'Reintentar pendientes',retryAllowed:true,details};
  if(run.tasks.some(task=>task.pendingQuestion))return{...base,title:'Astra necesita una decisión tuya',message:'Respondé la pregunta de abajo. Después podés continuar desde este panel.',retryAllowed:false};
  if(tasks.some(task=>task.corrections?.stopped))return{...base,title:'Se detuvo una repetición sin avance',message:tasks.find(task=>task.corrections?.stopped)?.error||'La tarea sigue sin avanzar después de cambiar el enfoque.',hint:'Se conserva el trabajo. Aportá la evidencia que falta o ajustá la tarea; reanudar sin cambios no genera nuevas llamadas para esa tarea.',retryAllowed:false};
  if(run.status==='paused')return{...base,title:'El equipo está pausado',message:'Podés continuar desde el trabajo guardado.',retryLabel:'Continuar trabajo'};
  const gate=errors.find(error=>/maxCalls|Límite de consultas|pruebas de Astra|worktree directamente|fuera del flujo|modificad[oa]|cambió.*(aprobación|revisión)|conflict/i.test(error));
  if(gate)return{...base,message:gate,hint:'Este bloqueo requiere revisar el plan, los límites o el código. Repetir la misma llamada no lo resuelve.',retryAllowed:false};
  if(errors.some(error=>/Límite de correcciones/.test(error)))return{...base,title:'Podés continuar las correcciones',message:'El antiguo tope de correcciones fue retirado. Se conserva el trabajo y la revisión pendiente.',hint:'Ahora se detecta el estancamiento entre entregas. '+base.hint,retryLabel:'Continuar correcciones'};
  const specific=errors.filter(error=>!/Hay tareas bloqueadas o dependencias pendientes/.test(error));
  if(specific.length&&specific.every(error=>/Sin actividad observable del agente/.test(error)))return{...base,title:'No se recibió actividad del agente',message:`El agente dejó de emitir señales de avance${idleMinutes?' durante '+idleMinutes+' min':''}. Puede estar esperando al proveedor; no confirma que haya un error en el código.`,hint:base.hint+' No se reintenta automáticamente.'};
  if(specific.length&&specific.every(error=>/Tiempo de espera agotado/.test(error))){
    const timeout=Number(specific[0].match(/\((\d+) ms\)/)?.[1]);
    return{...base,title:'Se agotó el tiempo de espera',message:(tasks.length?tasks.length+' tarea'+(tasks.length===1?'':'s')+' interrumpida'+(tasks.length===1?'':'s'):'La respuesta fue interrumpida')+(timeout?' al llegar a '+timeout/60000+' min.':'.'),hint:(minutes?`Cada respuesta dispone de hasta ${minutes} min. `:'Las respuestas ya no tienen un tope de duración por defecto. ')+base.hint};
  }
  if(specific.length&&specific.every(error=>/at capacity|overloaded|rate.?limit|too many requests|429|529/i.test(error)))return{...base,title:'El proveedor no tiene capacidad disponible',message:'Esperá unos minutos y reintentá desde acá. Se mantiene el modelo que elegiste.'};
  if(errors.length)return{...base,message:specific[0]||errors[0]};
  return base;
}
