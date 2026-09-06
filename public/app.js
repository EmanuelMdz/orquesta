(() => {
  const $=id=>document.getElementById(id);
  const requests=new AbortController();
  let disposed=false,refreshTimer=null,reconnectTimer=null,clockTimer=null,loading=false,reloadPending=false;
  const token=location.hash.slice(1)||sessionStorage.getItem('orquesta-token');
  if(token){sessionStorage.setItem('orquesta-token',token);history.replaceState(null,'',location.pathname);}
  let state={runs:[],running:false,demo:false},runId=null,selectedAgent='all',selectedTask=null,tab='activity',events=[],lastSeq=0,pendingStart=null,renderedRun;
  let workerAssignments=new Map(),retrying=false;
  const labels={created:'Preparada',running:'Trabajando',paused:'Pausada',waiting_user:'Esperando tu respuesta',blocked:'Bloqueada',completed:'Completada',queued:'En cola',implementing:'Escribiendo código',waiting_astra:'Esperando a Astra',testing:'En pruebas',reviewing:'En revisión',approved:'Aprobada',integrated:'Integrada'};
  const phases={plan:'Planificando',implement:'Escribiendo código',decide:'Resolviendo una consulta',tests:'Preparando pruebas',review:'Revisando código'};
  const eventLabels={'decision.requested':'Consulta','decision.answered':'Respuesta','task.correction':'Corrección','task.approved':'Entrega aprobada','files.changed':'Archivos modificados','check.started':'Prueba iniciada','check.completed':'Resultado de prueba','plan.created':'Plan','provider.started':'Trabajando','run.completed':'Completado','task.integrated':'Integración','decision.needs_user':'Pregunta para vos','task.assigned':'Asignación','task.started':'Tarea iniciada','agent.result':'Resultado','agent.message':'Mensaje','run.created':'Tarea confirmada','run.started':'Inicio','run.blocked':'Bloqueo','task.blocked':'Bloqueo','run.paused':'Pausa','workspace.preparing':'Preparando entorno','workspace.prepared':'Entorno listo','tool.started':'Consulta al proyecto','tool.completed':'Consulta completada','provider.log':'Log técnico','provider.usage':'Uso reportado','integration.testing':'Pruebas de integración'};
  const current=()=>state.runs.find(run=>run.id===runId);
  const config=()=>current()?.config||state.config||{};
  const modelName=role=>{const model=role==='opus'?(config().opusModel||'opus'):(config().astraModel||'gpt-6-astra');return model==='gpt-6-astra'?'Astra':model==='opus'?'Opus':model;};
  const shorten=(text,length)=>{text=String(text||'').replace(/\s+/g,' ').trim();return text.length>length?text.slice(0,length-1).trimEnd()+'…':text;};
  function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function svgNode(tag,attributes={},text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,String(value));if(text!==undefined)n.textContent=text;return n;}
  function error(message){if(disposed)return;$('error').hidden=!message;$('error').textContent=message||'';}
  async function api(path,body){const response=await fetch('/api/'+path,{signal:requests.signal,method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+(token||''),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo completar la acción');return data;}
  function chooseRun(id){if(id===runId)return;runId=id;selectedAgent='all';selectedTask=null;events=[];lastSeq=0;}
  function addEvents(more){for(const event of more){if(event.runId!==runId||events.some(saved=>saved.seq===event.seq))continue;events.push(event);lastSeq=Math.max(lastSeq,event.seq||0);}events.sort((a,b)=>a.seq-b.seq);}
  async function loadEvents(){
    const id=runId;
    for(;;){const more=await api('events?run='+encodeURIComponent(id)+'&after='+lastSeq);if(id!==runId||disposed)return;addEvents(more);if(more.length<2000)break;}
    renderTeam();renderFeed();
  }
  async function load(){
    if(loading){reloadPending=true;return;}
    loading=true;
    try{state=await api('state');if(disposed)return;if(!runId)chooseRun(state.runs[0]?.id??null);render();if(runId)await loadEvents();}
    finally{loading=false;if(reloadPending&&!disposed){reloadPending=false;schedule();}}
  }
  function schedule(){if(disposed||refreshTimer)return;refreshTimer=setTimeout(()=>{refreshTimer=null;load().catch(e=>error(e.message));},120);}
  const workerCount=()=>Math.max(1,Math.min(4,Number(config().workers)||2));
  const validWorker=id=>Number.isInteger(id)&&id>0&&id<=workerCount();
  // Reconstruct display slots for old histories. Queued tasks are a backlog,
  // never additional agents. New events carry the actual assigned slot.
  function assignDisplayWorkers(){
    const tasks=current()?.tasks||[],known=new Map(tasks.map(task=>[task.id,task])),active=new Map();workerAssignments=new Map();
    const free=preferred=>validWorker(preferred)&&!active.has(preferred)?preferred:Array.from({length:workerCount()},(_,i)=>i+1).find(id=>!active.has(id));
    for(const event of events){
      if(event.type==='run.started')active.clear();
      const task=known.get(event.taskId);if(!task)continue;
      const slot=validWorker(event.workerId)?event.workerId:validWorker(task.workerId)?task.workerId:workerAssignments.get(task.id);
      if(event.type==='task.assigned'||event.type==='task.started'||(!workerAssignments.has(task.id)&&event.role==='opus')){
        for(const [id,owner] of active)if(owner===task.id)active.delete(id);
        const assigned=validWorker(event.workerId)?event.workerId:free(slot);
        if(assigned){workerAssignments.set(task.id,assigned);active.set(assigned,task.id);}
      }
      if(['task.blocked','task.approved','task.integrated'].includes(event.type))for(const [id,taskId] of active)if(taskId===task.id)active.delete(id);
    }
    for(const task of tasks){
      if(validWorker(task.workerId))workerAssignments.set(task.id,task.workerId);
      else if(!workerAssignments.has(task.id)&&(task.status!=='queued'||task.worktree)){
        const used=new Set(workerAssignments.values());
        workerAssignments.set(task.id,Array.from({length:workerCount()},(_,i)=>i+1).find(id=>!used.has(id))||1);
      }
    }
  }
  function workerId(taskId){return workerAssignments.get(taskId)||null;}
  function eventWorker(event){return validWorker(event.workerId)?event.workerId:workerId(event.taskId);}
  function actor(event){
    if(event.role==='system'||event.type.startsWith('check.')||event.type==='integration.testing')return 'system';
    if(event.role==='astra'||event.role==='quality')return 'astra';
    if(event.role==='opus')return eventWorker(event)?'worker:'+eventWorker(event):'opus';
    return 'user';
  }
  function actorName(key){return key==='astra'?modelName('astra'):key==='system'?'System':key==='user'?'Vos':key.startsWith('worker:')?modelName('opus')+' '+key.split(':')[1]:modelName('opus');}
  function activity(){
    const active=new Map();
    for(const event of events){
      const key=actor(event)+':'+(event.taskId||'run');
      if(event.type==='run.started'||['run.blocked','run.paused','run.completed'].includes(event.type))active.clear();
      if(event.type==='provider.started')active.set('provider:'+key,{actor:actor(event),taskId:event.taskId,since:event.time,phase:event.data?.phase||event.message.split('·').pop().trim()});
      if(event.type==='agent.result')active.delete('provider:'+key);
      if(['workspace.preparing','check.started'].includes(event.type))active.set('system:'+(event.taskId||'run')+':'+event.message,{actor:'system',taskId:event.taskId,since:event.time,phase:event.type==='check.started'?'Ejecutando pruebas':'Preparando entorno'});
      if(['workspace.prepared','check.completed'].includes(event.type)){
        const name=event.type==='check.completed'?(event.data?.name||event.message.replace(/: (aprobada|falló)$/,'')):event.message.replace(/: (lista|falló)$/,'');
        active.delete('system:'+(event.taskId||'run')+':'+name);
      }
      if(event.type==='task.blocked')for(const [id,call] of active)if(call.taskId===event.taskId)active.delete(id);
    }
    return current()?.status==='running'?[...active.values()]:[];
  }
  function team(){
    const run=current(),tasks=run?.tasks||[],calls=activity();
    const count=workerCount();
    const members=[{key:'astra',name:modelName('astra'),kind:'director',caption:'PLAN · DECISIONES · REVISIÓN'},...Array.from({length:count},(_,i)=>({key:'worker:'+(i+1),name:actorName('worker:'+(i+1)),kind:'worker',caption:'IMPLEMENTADOR'})),{key:'system',name:'System',kind:'system',caption:'ENTORNO · GIT · PRUEBAS'}];
    for(const member of members){
      const ownCalls=calls.filter(call=>call.actor===member.key);
      member.tasks=member.kind==='worker'?tasks.filter(task=>'worker:'+workerId(task.id)===member.key):[];
      member.task=member.tasks.find(task=>ownCalls.some(call=>call.taskId===task.id))||member.tasks.find(task=>!['integrated','approved','queued'].includes(task.status))||member.tasks.find(task=>task.status==='queued')||member.tasks.at(-1);
      member.busy=ownCalls.length>0;
      member.since=ownCalls[0]?.since;
      member.status=member.busy?(phases[ownCalls[0].phase]||ownCalls[0].phase)+(ownCalls.length>1?' · '+ownCalls.length+' tareas':''):member.kind==='worker'?(member.task?(labels[member.task.status]||member.task.status):'Sin tareas asignadas'):'En espera';
      member.mood=member.busy?'busy':member.task?.status==='blocked'?'blocked':'waiting';
      if(run?.status==='completed'){member.status='Completado';member.mood='done';}
      if(['paused','blocked','waiting_user'].includes(run?.status)&&!member.busy){
        if(member.kind==='director')member.status=run.status==='blocked'&&!tasks.length?'Plan bloqueado':labels[run.status];
        if(member.kind==='system')member.status=run.status==='blocked'?'Requiere atención':'En espera';
        if(member.kind==='worker'&&member.task&&!['integrated','approved','blocked'].includes(member.task.status))member.status=run.status==='paused'?'Pausado':'En espera';
        if(run.status==='blocked'&&member.kind!=='worker')member.mood='blocked';
      }
    }
    return members;
  }
  function selectAgent(key){selectedAgent=selectedAgent===key?'all':key;const member=team().find(m=>m.key===selectedAgent);selectedTask=member?.task?.id||null;renderTeam();renderFeed();renderTests();if(tab==='changes')loadDiff().catch(e=>error(e.message));}
  function renderTeam(){
    if(disposed)return;
    assignDisplayWorkers();
    const members=team(),workers=members.filter(m=>m.kind==='worker'),rows=Math.ceil(workers.length/4),height=365+(rows-1)*135;
    const svg=svgNode('svg',{viewBox:'0 0 680 '+height,class:'team-map',role:'group','aria-label':'Mapa interactivo del equipo'});
    svg.append(svgNode('title',{},'Agentes conectados de Orquesta'),svgNode('desc',{},'Seleccioná un agente para filtrar la comunicación. La actividad proviene de eventos registrados.'));
    const defs=svgNode('defs'),pattern=svgNode('pattern',{id:'map-grid',width:22,height:22,patternUnits:'userSpaceOnUse'});pattern.append(svgNode('circle',{cx:1,cy:1,r:.8,class:'grid-dot'}));defs.append(pattern);svg.append(defs,svgNode('rect',{width:680,height,fill:'url(#map-grid)'}));
    const system=members.find(m=>m.key==='system'),director=members[0];
    svg.append(svgNode('path',{d:'M164 96 H244',class:'map-edge '+(system.busy?'busy':'')}));
    workers.forEach((member,index)=>{
      const row=Math.floor(index/4),columns=Math.min(4,workers.length-row*4),column=index%4;
      member.x=24+(column+.5)*632/columns;member.y=235+row*135;
      const path='M340 148 C340 193 '+member.x+' 193 '+member.x+' '+member.y;
      const consulting=member.task?.status==='waiting_astra';
      svg.append(svgNode('path',{d:path,class:'map-edge '+(member.busy?'busy':consulting?'consulting':'')}));
      if(member.busy||consulting)svg.append(svgNode('circle',{cx:member.x,cy:member.y-8,r:4,class:'edge-dot '+(consulting?'consulting':'busy')}));
    });
    function card(member,x,y,width,cardHeight){
      const selected=selectedAgent===member.key;
      const group=svgNode('g',{class:'map-node '+member.kind+' '+member.mood+(selected?' selected':''),role:'button',tabindex:0,'aria-label':member.name+': '+member.status,'aria-pressed':selected,'data-agent':member.key,transform:'translate('+x+' '+y+')'});
      group.append(svgNode('title',{},member.name+' · '+member.status+(member.task?' · '+member.task.title:'')),svgNode('rect',{width,height:cardHeight,rx:13,class:'node-bg'}));
      group.append(svgNode('circle',{cx:width-17,cy:18,r:4,class:'node-indicator'}));
      group.append(svgNode('text',{x:16,y:25,class:'node-caption'},member.kind==='director'?'DIRECTOR':member.kind==='system'?'LOCAL':'IMPLEMENTADOR'));
      group.append(svgNode('text',{x:16,y:54,class:'node-name'},shorten(member.name,width<160?17:23)));
      group.append(svgNode('text',{x:16,y:76,class:'node-status'},shorten(member.status,width<160?23:31)));
      if(cardHeight>100)group.append(svgNode('text',{x:16,y:96,class:'node-task'},shorten(member.task?.title||member.caption,width<160?23:31)));
      group.addEventListener('click',()=>selectAgent(member.key));group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectAgent(member.key);}});
      svg.append(group);
    }
    card(system,24,49,140,95);card(director,244,38,192,110);
    workers.forEach(member=>{const width=workers.length>3?142:180;card(member,member.x-width/2,member.y,width,110);});
    const focused=document.activeElement?.getAttribute('data-agent');$('agents').replaceChildren(svg);
    if(focused)$('agents').querySelector('[data-agent="'+focused+'"]')?.focus();
    $('team-count').textContent='1 director · '+workers.length+' implementadores';
    const tasks=current()?.tasks||[],queued=tasks.filter(task=>task.status==='queued');
    $('queue-summary').textContent=queued.length+' tareas pendientes';$('task-queue').hidden=!queued.length;$('queue-list').replaceChildren();
    for(const task of queued){const item=node('li','',task.title);const waiting=task.dependsOn?.some(id=>tasks.find(other=>other.id===id)?.status!=='integrated');item.append(node('small','muted',waiting?'Espera una entrega anterior':'Lista para un implementador libre'));$('queue-list').append(item);}
    const busy=members.filter(m=>m.busy).length;$('map-state').textContent=busy?busy+' trabajando':labels[current()?.status]||'Listo para empezar';$('map-state').className='map-state'+(busy?' busy':'');
    const chosen=members.find(m=>m.key===selectedAgent);$('agent-detail').replaceChildren();
    if(chosen){$('agent-detail').append(node('strong','',chosen.name+' · '+chosen.status),node('div','',chosen.task?.title||(chosen.key==='astra'?'Planifica, resuelve consultas y revisa.':'Prepara el entorno, integra cambios y ejecuta pruebas.')));}
    else $('agent-detail').append(node('strong','','Todo el equipo'),node('div','','Seleccioná un nodo para seguir sus mensajes y respuestas.'));
    $('task-picker').hidden=!chosen?.tasks.length;$('task-select').replaceChildren();
    for(const task of chosen?.tasks||[]){const option=node('option','',task.title+' · '+(labels[task.status]||task.status));option.value=task.id;option.selected=task.id===selectedTask;$('task-select').append(option);}
    renderLive(members);
  }
  function renderLive(members){
    const busy=members.filter(m=>m.busy);$('live-status').hidden=!busy.length;
    $('live-text').textContent=busy.map(m=>m.name+' · '+m.status.toLowerCase()).join(' / ');
    $('live-elapsed').dataset.since=busy.map(m=>m.since).filter(Boolean).sort()[0]||'';updateClock();
  }
  function updateClock(){const since=$('live-elapsed').dataset.since;if(!since){$('live-elapsed').textContent='';return;}const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(since))/1000));$('live-elapsed').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
  function render(){
    const run=current();$('repo').textContent=state.repo||'';$('mode').textContent=state.demo?'DEMO · MODELOS SIMULADOS':modelName('astra')+' + '+modelName('opus')+' · EJECUCIÓN REAL';
    $('run-select').replaceChildren();if(!state.runs.length)$('run-select').append(node('option','','Sin ejecuciones'));
    for(const item of state.runs){const option=node('option','',item.id+' · '+(labels[item.status]||item.status));option.value=item.id;option.selected=item.id===runId;$('run-select').append(option);}
    $('start').disabled=state.running;$('start').textContent=state.demo?'Repetir demo →':'Revisar tarea →';$('objective').disabled=state.demo;if(state.demo)$('objective').value='Implementar saludo y suma con consulta, revisión y pruebas.';
    $('pause').disabled=!state.running;
    const attention=run?.attention;$('recovery').hidden=!attention||state.running;
    $('recovery-title').textContent=attention?.title||'';$('recovery-message').textContent=shorten(attention?.message,260);$('recovery-hint').textContent=attention?.hint||'';
    $('resume').hidden=!attention?.retryAllowed||state.running;$('resume').disabled=retrying||!!run?.tasks.some(task=>task.pendingQuestion);$('resume').textContent=retrying?'Continuando…':(attention?.retryLabel||'Continuar trabajo')+' →';
    const firstLine=run?.objective.split(/\r?\n/).map(line=>line.replace(/^#{1,6}\s+/, '').trim()).find(Boolean);
    $('goal').textContent=run?shorten(firstLine||'Tarea en curso',100):'Todo listo para empezar';
    $('full-objective').textContent=run?.objective||'';$('objective-details').hidden=!run;
    $('run-error-details').hidden=!run?.error;$('run-error').textContent=[run?.error,...(attention?.details||[]).map(item=>item.title+': '+item.error)].filter(Boolean).join('\n\n');
    $('run-status').textContent=run?(labels[run.status]||run.status)+(run.status==='blocked'&&!run.tasks.length?' · El plan se bloqueó antes de iniciar implementadores.':''):modelName('astra')+' planifica y revisa. '+modelName('opus')+' implementa.';
    $('run-label').textContent=run?'TRABAJO '+run.id:'TU EQUIPO DE DESARROLLO';
    if(renderedRun!==runId){$('new-work').open=!run;$('objective-details').open=false;$('run-error-details').open=false;renderedRun=runId;}
    const pending=run?.tasks.find(task=>task.pendingQuestion);$('question-box').hidden=!pending;$('question-text').textContent=pending?pending.title+': '+pending.pendingQuestion:'';
    const completed=run?.tasks.filter(task=>task.status==='integrated').length||0;$('summary').textContent=run?completed+'/'+run.tasks.length+' tareas integradas · '+run.calls+' llamadas':'Estado persistido localmente';$('branch').textContent=run?.integrationBranch||'Sin publicación automática';
    renderTeam();renderFeed();renderTests();if(tab==='changes')loadDiff().catch(e=>error(e.message));
  }
  function renderFeed(){
    if(disposed)return;
    $('feed-scope').textContent=selectedAgent==='all'?'Toda la comunicación':'Comunicación · '+actorName(selectedAgent);$('feed-all').hidden=selectedAgent==='all';
    const feed=$('feed'),bottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<60;
    const filtered=events.filter(event=>(!['provider.log','provider.usage','provider.demo'].includes(event.type)||$('show-logs').checked)&&(selectedAgent==='all'||actor(event)===selectedAgent||(selectedAgent.startsWith('worker:')&&eventWorker(event)===Number(selectedAgent.split(':')[1])))).slice(-200);
    const openDetails=new Set([...feed.querySelectorAll('details[open]')].map(detail=>detail.dataset.event));feed.replaceChildren();
    if(!filtered.length){const run=current();feed.append(node('div','empty',!run?'Confirmá una tarea para ver la actividad del equipo.':run.status==='blocked'&&!run.tasks.length?'Los implementadores todavía no comenzaron. El plan está bloqueado.':'Todavía no hay mensajes para esta selección.'));return;}
    for(const event of filtered){
      const cls=event.type==='decision.requested'?'question':event.type==='decision.answered'?'decision':event.type.includes('blocked')||event.type==='task.correction'?'failed':'';
      const article=node('article','event '+cls);article.dataset.seq=String(event.seq);
      const time=node('time','event-time',event.time.slice(11,19));time.dateTime=event.time;
      const body=node('div','event-body'),key=actor(event),worker=eventWorker(event);
      let from=actorName(key);
      if(event.type==='decision.requested')from+=' → '+modelName('astra');
      if(['decision.answered','task.correction'].includes(event.type)&&worker)from+=' → '+actorName('worker:'+worker);
      const title=node('div','event-title',from);title.append(node('span','tag',eventLabels[event.type]||event.type));
      if(event.role==='quality'&&key==='astra')title.append(node('span','tag','Calidad'));
      body.append(title);
      if(event.message.length>700){const detail=node('details','message-details');detail.dataset.event=String(event.seq);detail.open=openDetails.has(detail.dataset.event);detail.append(node('summary','',shorten(event.message,180)),node('p','event-message',event.message));body.append(detail);}
      else body.append(node('p','event-message',event.type==='provider.started'?(phases[event.data?.phase||event.message.split('·').pop().trim()]||event.message):event.message));
      if(event.data?.command){const detail=node('details','event-command');detail.dataset.event=String(event.seq)+'-command';detail.open=openDetails.has(detail.dataset.event);detail.append(node('summary','','Ver comando'),node('pre','',Array.isArray(event.data.command)?event.data.command.join(' '):event.data.command));body.append(detail);}
      const task=current()?.tasks.find(task=>task.id===event.taskId);if(task)body.append(node('div','event-task',task.title));
      article.append(time,body);feed.append(article);
    }
    if(bottom)feed.scrollTop=feed.scrollHeight;
  }
  async function loadDiff(){if(!runId){$('diff').textContent='Todavía no hay cambios.';return;}const id=runId,task=selectedTask;const result=await api('diff?run='+encodeURIComponent(id)+(task?'&task='+encodeURIComponent(task):''));if(id!==runId||task!==selectedTask)return;$('diff-scope').textContent=task?'· '+task:'· integración';$('diff').replaceChildren();if(!result.diff){$('diff').textContent='Todavía no hay cambios confirmados en esta entrega.';return;}for(const line of result.diff.split('\n'))$('diff').append(node('span',line.startsWith('+')?'diff-add':line.startsWith('-')?'diff-del':'',line+'\n'));}
  function renderTests(){const run=current(),container=$('test-results');container.replaceChildren();const task=run?.tasks.find(task=>task.id===selectedTask);const results=task?task.checks:[...(run?.tasks.flatMap(task=>task.checks.map(check=>({...check,name:task.title+' · '+check.name})))||[]),...(run?.checks||[])];if(!results.length){container.append(node('div','empty','Las pruebas todavía no se ejecutaron.'));return;}for(const check of results){const card=node('details','test-card'),summary=node('summary');summary.append(node('span','',check.name),node('span',check.exitCode===0?'pass':'fail',check.exitCode===0?'APROBADA':'FALLÓ'));card.append(summary,node('pre','',check.command.join(' ')+'\nCommit: '+check.sha+'\nExit code: '+check.exitCode+' · '+check.durationMs+' ms\n\n'+check.output));container.append(card);}}
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{tab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(item=>item.setAttribute('aria-selected',String(item===button)));for(const id of ['activity','changes','tests'])$(id).hidden=id!==tab;if(tab==='changes')loadDiff().catch(e=>error(e.message));}));
  $('feed-all').addEventListener('click',()=>{selectedAgent='all';selectedTask=null;renderTeam();renderFeed();renderTests();});
  $('show-logs').addEventListener('change',renderFeed);
  $('task-select').addEventListener('change',()=>{selectedTask=$('task-select').value;renderTests();if(tab==='changes')loadDiff().catch(e=>error(e.message));});
  $('run-select').addEventListener('change',()=>{chooseRun($('run-select').value);render();loadEvents().catch(e=>error(e.message));});
  $('start-form').addEventListener('submit',async event=>{event.preventDefault();error('');try{const{config}=await api('config');pendingStart={objective:$('objective').value,expectedConfig:config};$('confirm-team').textContent=`Orquestador: ${config.astraModel} (${config.orchestratorProvider}) · Implementadores: ${config.workers} × ${config.opusModel} (${config.implementerProvider}) · Máximo: ${config.maxCalls} llamadas.`;$('confirm-objective').textContent=pendingStart.objective;$('confirm-work').hidden=false;$('confirm-start').focus();}catch(e){error(e.message);}});
  $('confirm-cancel').addEventListener('click',()=>{pendingStart=null;$('confirm-work').hidden=true;});
  $('confirm-start').addEventListener('click',async()=>{if(!pendingStart)return;error('');$('confirm-start').disabled=true;try{const result=await api('runs',pendingStart);pendingStart=null;$('confirm-work').hidden=true;chooseRun(result.id);await load();}catch(e){error(e.message);}finally{if(!disposed)$('confirm-start').disabled=false;}});
  $('pause').addEventListener('click',()=>api('pause',{}).then(load).catch(e=>error(e.message)));
  $('resume').addEventListener('click',async()=>{if(retrying)return;retrying=true;render();error('');try{await api('resume',{id:runId});await load();}catch(e){error(e.message);}finally{retrying=false;if(!disposed)render();}});
  $('answer-form').addEventListener('submit',async event=>{event.preventDefault();const task=current()?.tasks.find(task=>task.pendingQuestion);if(!task)return;try{await api('answer',{id:runId,taskId:task.id,answer:$('answer').value});$('answer').value='';await load();}catch(e){error(e.message);}});
  async function stream(){
    try{
      const response=await fetch('/api/stream',{signal:requests.signal,headers:{Authorization:'Bearer '+(token||'')}});if(!response.ok)throw Error('No autorizado');if(disposed)return;$('connection').textContent='● Conectado';
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      for(;;){const{done,value}=await reader.read();if(done||disposed)break;buffer+=decoder.decode(value,{stream:true});const messages=buffer.split('\n\n');buffer=messages.pop();for(const message of messages){const line=message.split('\n').find(line=>line.startsWith('data: '));if(!line)continue;const event=JSON.parse(line.slice(6));if(event.type==='run.created')chooseRun(event.runId);schedule();}}
    }catch{}
    if(disposed)return;$('connection').textContent='● Reconectando';reconnectTimer=setTimeout(()=>{load().catch(()=>{});stream();},2000);
  }
  document.addEventListener('orquesta-config-changed',()=>{pendingStart=null;$('confirm-work').hidden=true;load().catch(e=>error(e.message));});
  window.addEventListener('focus',()=>{if(token&&!disposed){load().catch(e=>error(e.message));document.dispatchEvent(new Event('orquesta-refresh-project'));}});
  window.addEventListener('pagehide',()=>{disposed=true;requests.abort();clearTimeout(refreshTimer);clearTimeout(reconnectTimer);clearInterval(clockTimer);});
  clockTimer=setInterval(updateClock,1000);
  if(!token){error('Abrí el enlace completo del panel que aparece en la terminal, incluyendo lo que sigue a #.');$('connection').textContent='● Falta conexión';}else load().then(stream).catch(e=>error(e.message));
})();
