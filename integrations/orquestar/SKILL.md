---
name: orquestar
description: Configura y ejecuta equipos de agentes con Orquesta en el repositorio actual. Usar cuando el usuario invoque orquestar, pida elegir un combo de agentes o quiera delegar y observar trabajo mediante Orquesta.
---
<!-- orquesta-managed-skill -->

Usá Orquesta desde este chat. La aplicación conserva equipos predeterminados, configuración por proyecto, consultas, pruebas y el historial de agentes.

El helper `launch.mjs` de esta misma carpeta apunta a la instalación de Orquesta. Ejecutá `node RUTA-DE-ESTA-SKILL/launch.mjs COMANDO --repo RUTA-DEL-PROYECTO`; así funciona aunque la terminal no encuentre `orquesta` en PATH. Usá rutas absolutas y argumentos estructurados cuando el host lo permita.

1. Leé `describe --json`. Devuelve la configuración actual y los combos personales. Mostrá un menú breve: usar el equipo de este proyecto, elegir un combo guardado o personalizar. Si el usuario ya indicó su elección, usala. Para personalizar, guiá la selección del proveedor y modelo orquestador, proveedor y modelo implementador, cantidad de implementadores y límites que quiera cambiar. Usá el formulario de preguntas del chat cuando esté disponible; en otro caso, opciones breves en texto.
2. Guardá sólo las preferencias elegidas mediante `configure --file ARCHIVO_JSON`. El archivo debe contener el objeto completo de configuración obtenido de describe con esos cambios. Podés usar un archivo temporal bajo `.orquesta/`. No agregues archivos de configuración a Git ni hagas commits de los cambios del usuario. Conservá los comandos de pruebas y preparación propios del repo al elegir un combo de agentes.
3. Si pide guardar el equipo para reutilizarlo, ejecutá `preset --name "NOMBRE" --default --json`; omití `--default` si no lo quiere preseleccionar para proyectos nuevos. El proyecto actual recuerda su propia configuración.
4. Pedí la tarea si falta. Mostrá un resumen concreto del equipo, cantidad, tarea y límite de llamadas, y pedí confirmación antes de iniciar. Si esa combinación y tarea ya fueron confirmadas explícitamente, respetá la confirmación existente.
5. Ejecutá `launch --json` para abrir el panel y mostrale su `panel_url`. Después de confirmar, guardá `{ "objective": "TAREA", "expectedConfig": CONFIGURACION_CONFIRMADA }` en un archivo temporal y ejecutá `start --file ARCHIVO_JSON --json`. Devuelve un identificador; no repitas el inicio si ya se obtuvo uno.
6. Seguí el trabajo mediante `events RUN_ID --after ULTIMA_SECUENCIA --json` y `status RUN_ID --json`. Resumí asignaciones, consultas, decisiones, cambios y resultados reales; no inventes razonamiento interno. Consultá a intervalos razonables mientras el usuario quiera seguimiento.
7. Si necesita una respuesta humana, mostrala y usá `answer RUN_ID TASK_ID "RESPUESTA"` sólo con la respuesta del usuario. Reanudá con `resume RUN_ID` cuando corresponda. Para pausar: `pause`. Para cerrar el servicio conservando trabajo: `stop`.

La CLI de este chat no determina los modelos de los agentes: se usan los proveedores y modelos guardados en la configuración. Orquesta puede usar Codex y Claude Code; cada proveedor necesita su sesión y acceso al modelo elegido. No sustituyas un modelo que falle por otro sin decisión del usuario.

Si prefiere configurar todo visualmente, ejecutá sólo `launch --json`: el panel permite elegir equipo, guardar combos, escribir tarea y confirmar. No intentes abrir un programa interactivo de terminal dentro de una llamada de herramienta sin terminal interactiva.
