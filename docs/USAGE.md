# Guía de uso de Orquesta

[← Volver a la portada](../README.md)

Elegí un equipo de agentes, escribí una tarea y miralos trabajar. Podés abrir el asistente desde el chat de **Codex** o **Claude Code**, o desde una terminal normal.

El combo inicial usa **Astra para planificar, resolver dudas, crear pruebas y revisar**, y **Opus para implementar**. Podés cambiar los proveedores, modelos y cantidad de implementadores, y guardar tus propios combos.

## Instalar una vez

Requisitos: Node.js 22.13 o superior y Git. Cada proveedor que uses necesita su CLI oficial instalada, sesión iniciada y acceso al modelo elegido. En Windows también se detectan las CLI de las extensiones de VS Code. Las ejecuciones reales consumen el uso de tus cuentas.

```powershell
npx --yes --package=git+https://github.com/EmanuelMdz/orquesta.git#v0.2.3 orquesta install
```

El instalador prepara el paquete, lo instala globalmente e instala la skill `orquesta` para ambos clientes. No necesitás copiar nada dentro de tus proyectos.

También podés pasarle el enlace de este repo a Codex o Claude y pedirle: **«Instalá Orquesta para usarla en todos mis proyectos»**. Las instrucciones para ese agente están en [INSTALL.md](../INSTALL.md).

Si tu npm omite los scripts de instalación, ejecutá `orquesta install` después. Para comprobar las CLI: `orquesta doctor`. Si PowerShell bloquea scripts `.ps1`, usá `npm.cmd` y `orquesta.cmd`.

## Desde el chat de un proyecto

En **Claude Code**, escribí:

```text
/orquesta
```

En **Codex**, escribí:

```text
$orquesta
```

En Codex también podés elegir la skill desde `/skills`. Reabrí el chat si todavía no aparece después de instalar. Cada cliente conserva su propio formato de invocación; no hay un comando `/orquesta` idéntico en ambos.

El asistente guía este flujo:

1. Usar el equipo del proyecto, elegir un combo guardado o personalizarlo.
2. Elegir el modelo orquestador, el modelo implementador y la cantidad de implementadores.
3. Guardar el combo si querés reutilizarlo.
4. Escribir la tarea, revisar el equipo y confirmar.
5. Abrir el panel y seguir asignaciones, consultas, respuestas, cambios y pruebas.

La selección dentro del chat usa las preguntas que ofrece cada cliente, o mensajes con opciones. La skill contiene las instrucciones del asistente; no modifica la interfaz interna de Codex o Claude. El panel es una interfaz local en el navegador, compartida por ambos clientes.

**El chat desde el que lo abrís no determina quién dirige.** Podés abrirlo en Claude y elegir Astra como orquestador, o usar un modelo de Claude como orquestador y modelos de Codex como implementadores. Los nombres de modelo se envían al proveedor elegido; se comprueba su acceso al ejecutar, sin sustituir modelos automáticamente.

## Desde una terminal normal

Dentro de cualquier repositorio:

```powershell
orquesta
```

Se abre el panel. Usá **Configurar este proyecto**, elegí el equipo, guardá, escribí la tarea y pulsá **Revisar tarea**. Los agentes empiezan cuando pulsás **Confirmar e iniciar**.

Para abrir el panel y recuperar inmediatamente la terminal:

```powershell
orquesta launch
```

Para abrir tu Codex de terminal conectado al mismo panel:

```powershell
orquesta codex
```

No hace falta `setup`, modificar `.gitignore` ni hacer un commit para configurar Orquesta. Podés abrir y configurar un repo con cambios pendientes. Antes de iniciar una ejecución, el repo debe tener un commit inicial y sus cambios guardados en Git o en un stash; Orquesta muestra qué está pendiente y no lo guarda por vos.

## Combos y configuración por proyecto

En **Configurar este proyecto** podés elegir proveedores, modelos, implementadores simultáneos, límites de llamadas y correcciones, instrucciones y comandos de pruebas.

**Guardar combo** conserva el equipo para todos tus repositorios. La opción **Preseleccionar en proyectos nuevos** lo convierte en tu equipo inicial. Los proyectos que ya configuraste conservan su propia selección. Los comandos de pruebas, preparación e instrucciones siguen perteneciendo a cada repo.

Los ajustes locales están en `.orquesta/config.json`, excluida mediante los metadatos locales de Git. Los combos personales están en `~/.orquesta/presets.json`. Si un proyecto ya contiene `orquesta.config.json`, se usa como base; la configuración local tiene prioridad. Cada ejecución guarda una copia de su configuración para que una reanudación conserve el equipo y las pruebas originales.

El director siempre realiza plan, decisiones y calidad. Los implementadores pueden trabajar en paralelo cuando sus archivos y dependencias lo permiten. La concurrencia admitida en esta versión es de 1 a 4 implementadores.

Las respuestas de modelos disponen de hasta 20 minutos (`agentTimeoutMs: 1200000`), separados del límite de comandos y pruebas (`timeoutMs`, 5 minutos por defecto). Ambos se ajustan en **Límites avanzados** para ejecuciones nuevas. Las ejecuciones antiguas que no tenían el límite de respuesta incorporan el nuevo valor predeterminado al reanudarse, conservando el resto de su configuración. Los tiempos máximos son límites totales, no de inactividad.

## Ver y controlar a los agentes

El mapa muestra al orquestador, System y los implementadores numerados. Al seleccionar un agente, la comunicación se filtra incluyendo consultas y respuestas relacionadas. **Ver todos** recupera la conversación completa. La selección de tarea permite inspeccionar diffs y pruebas de cada entrega.

La actividad visual usa eventos ya registrados, sin nuevas llamadas ni instrucciones a los modelos. Las CLI sólo aportan los mensajes que emiten durante la ejecución; cuando aún no hay respuesta, el panel indica la fase y el tiempo transcurrido. Los logs técnicos se pueden mostrar con una opción del panel. Los mensajes del chat externo que prepara o inicia Orquesta quedan fuera de este registro.

El título de la tarea es breve y **Ver tarea completa** conserva las instrucciones originales. Un plan rechazado aparece como bloqueado con los implementadores todavía sin tareas. El mapa respeta la cantidad de implementadores configurada; las tareas en cola se muestran aparte. Para historiales sin número de implementador se reconstruyen puestos de visualización a partir de los eventos, sin modificar el historial. Las ejecuciones nuevas guardan el puesto asignado a cada tarea.

Si el trabajo se interrumpe, una tarjeta explica la causa y permite **Reintentar pendientes** cuando corresponde. Los tiempos de espera y la falta de capacidad se distinguen de las preguntas humanas y los bloqueos que requieren revisión. No hay reintentos automáticos: abrir el panel no llama a modelos; pulsar reintentar sí puede hacerlo. Las decisiones y tareas integradas se conservan, pero una respuesta incompleta vuelve a solicitarse. El panel evita iniciar dos reintentos por un doble clic.

El panel muestra roles y tareas, mensajes explícitos entre agentes, consultas al orquestador, decisiones, diffs y resultados de pruebas. Son acciones y comunicaciones observables; no razonamiento privado interno ni terminales completas de cada modelo.

Codex, Claude y el panel controlan el mismo servicio por proyecto. Podés iniciar desde el chat y pausar o responder desde el panel. No hace falta refrescar para recibir eventos de esa ejecución. Los comandos de inicio MCP también devuelven el enlace del panel.

```powershell
orquesta status
orquesta events RUN_ID --after 0
orquesta inspect RUN_ID
orquesta pause
orquesta answer RUN_ID TASK_ID "Tu decisión"
orquesta resume RUN_ID --ui
orquesta stop
```

`launch` y `start` dejan el servicio en segundo plano; `stop` lo pausa y cierra conservando los datos. Si una terminal inició el servicio en primer plano, `Ctrl+C` lo pausa y cierra. Cerrar un cliente que se conectó a un servicio existente conserva ese servicio.

Las entregas aprobadas quedan en `orquesta/<run_id>/integration`. Revisá esa rama y fusionála cuando quieras. La rama de origen conserva su HEAD; no se hace push automático del trabajo generado.

## Pruebas y dependencias de cada repo

El panel permite elegir Node.js, Vitest, Playwright, pytest o un comando propio. El ejecutor recibe los archivos de pruebas de aceptación al final de sus argumentos. La configuración del framework debe incluir la carpeta de pruebas elegida: por ejemplo, revisá `testDir` si usás Playwright.

Los agentes trabajan en worktrees separados. Si tu proyecto necesita dependencias, configurá **Preparar dependencias**, por ejemplo `npm ci --ignore-scripts`, y agregá comprobaciones como `npm run build`. Estos comandos se ejecutan dentro de cada worktree; la preparación debe dejar los archivos versionados intactos. Preparar servicios, credenciales de pruebas o entornos complejos puede requerir ajustes propios del proyecto.

Los comandos usan argumentos de procesos sin shell: `&&`, redirecciones y expansión de variables no se interpretan. Escribí un comando por línea. Las rutas con espacios van entre comillas.

## Demo y desarrollo

```powershell
orquesta demo --ui
```

La demo simula los modelos y ejecuta Git y tests reales. No consume llamadas a modelos. Incluye una consulta, un fallo y su corrección.

Desde el código fuente:

```powershell
npm ci
npm test
npm run check
```

`npm run test:live` ejecuta una prueba con modelos reales y consume uso de tus cuentas. No forma parte de la suite normal. [Validación](VALIDATION.md) · [Arquitectura](ARCHITECTURE.md).

## Alcance

Versión 0.2: CLI, skills para ambos chats, equipos configurables, combos personales, panel local y motor con Git, decisiones y QA independiente. Los agentes proponen archivos estructurados y el motor valida su alcance antes de escribirlos. Un resultado de revisión no puede aprobar una prueba fallida.

El panel escucha en `127.0.0.1` y usa un token local. `.orquesta` contiene historial y código; se excluye de Git y del paquete. Los worktrees separan cambios, pero no son un sandbox de seguridad. Las pruebas y los comandos de preparación ejecutan código del proyecto.

La pausa normal está probada. Una caída abrupta durante escrituras o fusiones puede necesitar revisión manual. Los conflictos de integración bloquean el trabajo; no hay reparación automática de pruebas incorrectas. Se validó el circuito real Astra→Opus en Windows. Los otros combos tienen pruebas de enrutamiento de CLI, no una garantía de funcionamiento de todos los modelos o frameworks.

Referencias: [skills de Codex](https://learn.chatgpt.com/docs/build-skills), [skills de Claude Code](https://code.claude.com/docs/en/skills) e [instalación desde Git con npm](https://docs.npmjs.com/cli/install/).
