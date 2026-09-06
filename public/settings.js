(() => {
  const $ = id => document.getElementById(id);
  let disposed=false;const requests=new AbortController();
  window.addEventListener('pagehide',()=>{disposed=true;requests.abort();});
  const token = sessionStorage.getItem('orquesta-token');
  if (!token) return;
  const fields = { orchestratorProvider:'cfg-orchestrator-provider', implementerProvider:'cfg-implementer-provider', astraModel:'cfg-astra', opusModel:'cfg-opus', workers:'cfg-workers', maxCalls:'cfg-calls', instructions:'cfg-instructions', qaRoot:'cfg-qa-root', maxQuestions:'cfg-questions' };
  let library={presets:[]};
  const presets = { node:'node --test', vitest:'node node_modules/vitest/vitest.mjs run', playwright:'node node_modules/@playwright/test/cli.js test', pytest:'python -m pytest' };
  async function api(path, body) {
    const response = await fetch('/api/' + path, { signal:requests.signal, method:body === undefined ? 'GET' : 'POST', headers:{ Authorization:'Bearer ' + token, ...(body === undefined ? {} : {'Content-Type':'application/json'}) }, body:body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'No se pudo guardar.'); return data;
  }
  async function load() {
    const data = await api('config');
    if(disposed)return;
    for (const [key,id] of Object.entries(fields)) $(id).value = data.config[key] ?? '';
    $('cfg-timeout').value = data.config.timeoutMs / 1000;
    $('cfg-agent-timeout').value = (data.config.agentTimeoutMs ?? 0) / 60000;
    $('cfg-agent-idle').value = (data.config.agentIdleTimeoutMs ?? 900000) / 60000;
    $('cfg-context').value = data.config.maxContextBytes / 1000;
    $('cfg-qa-command').value = data.qaCommandLine;
    $('cfg-checks').value = data.checksText;
    $('cfg-setup').value = data.setupText;
    $('cfg-preset').value = Object.keys(presets).find(key => presets[key] === data.qaCommandLine) || 'custom';
    $('project-detection').textContent = '· ' + data.project.framework;
    $('project-readiness').hidden = data.hasCommit && !data.dirty;
    $('project-readiness').textContent = !data.hasCommit ? 'Este repo todavía no tiene un commit inicial. Guardá el proyecto en Git antes de iniciar trabajo.' : data.dirty ? 'Antes de iniciar, guardá tus cambios en Git o con stash. La configuración de Orquesta ya está lista. Archivos pendientes:\n' + data.dirty : '';
    await loadPresets(data.config);
  }
  async function loadPresets(config){
    library=await api('presets');if(disposed)return;$('cfg-combo').replaceChildren(new Option('Personalizado',''));
    for(const preset of library.presets){const option=new Option(preset.name+(preset.id===library.defaultId?' · predeterminado':''),preset.id);$('cfg-combo').append(option);}
    $('cfg-combo').value=library.presets.find(p=>Object.entries(p.team).every(([key,value])=>config[key]===value))?.id||'';
  }
  $('cfg-combo').addEventListener('change',()=>{
    const preset=library.presets.find(p=>p.id===$('cfg-combo').value);if(!preset)return;
    for(const [key,value] of Object.entries(preset.team))if(fields[key])$(fields[key]).value=value;
    $('preset-name').value=preset.name;$('settings-status').textContent='Combo seleccionado. Guardá la configuración para aplicarlo al proyecto.';
  });
  $('cfg-preset').addEventListener('change', () => {
    if (presets[$('cfg-preset').value]) $('cfg-qa-command').value = presets[$('cfg-preset').value];
  });
  async function saveSettings(){
    const config = {};
    for (const [key,id] of Object.entries(fields)) config[key] = $(id).type === 'number' ? Number($(id).value) : $(id).value;
    config.timeoutMs = Number($('cfg-timeout').value) * 1000;
    config.agentTimeoutMs = Number($('cfg-agent-timeout').value) * 60000;
    config.agentIdleTimeoutMs = Number($('cfg-agent-idle').value) * 60000;
    config.maxContextBytes = Number($('cfg-context').value) * 1000;
    return api('config', { config, qaCommandLine:$('cfg-qa-command').value, checksText:$('cfg-checks').value, setupText:$('cfg-setup').value });
  }
  $('settings-form').addEventListener('submit', async event => {
    event.preventDefault(); $('settings-save').disabled = true; $('settings-status').textContent = 'Guardando…';
    try {
      await saveSettings();
      $('settings-status').textContent = 'Guardada para este proyecto.';
      document.dispatchEvent(new Event('orquesta-config-changed'));
    } catch (error) { $('settings-status').textContent = error.message; }
    finally { $('settings-save').disabled = false; }
  });
  $('preset-save').addEventListener('click',async()=>{
    if(!$('settings-form').reportValidity())return;
    if(!$('preset-name').value.trim()){$('settings-status').textContent='Escribí un nombre para el combo.';return;}
    $('preset-save').disabled=true;
    try{const saved=await saveSettings();await api('presets',{name:$('preset-name').value,makeDefault:$('preset-default').checked});await loadPresets(saved.config);$('settings-status').textContent='Combo guardado para todos tus proyectos.';document.dispatchEvent(new Event('orquesta-config-changed'));}
    catch(error){$('settings-status').textContent=error.message;}finally{$('preset-save').disabled=false;}
  });
  $('settings-doctor').addEventListener('click', async () => {
    $('settings-doctor').disabled = true; $('doctor-result').hidden = false; $('doctor-result').textContent = 'Comprobando sesiones de Codex y Claude…';
    try {
      const data = await api('doctor', {});
      $('doctor-result').textContent = data.providers.map(provider => (provider.authenticated ? '✓ ' : '· ') + provider.name + ': ' + provider.message).join('\n');
    } catch (error) { $('doctor-result').textContent = error.message; }
    finally { $('settings-doctor').disabled = false; }
  });
  document.addEventListener('orquesta-refresh-project', () => load().catch(error => { if(!disposed)$('settings-status').textContent = error.message; }));
  load().catch(error => { if(!disposed)$('settings-status').textContent = error.message; });
})();
