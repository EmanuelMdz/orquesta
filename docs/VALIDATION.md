# Validación

## Versión 0.2.2 — mapa y comunicación

28 pruebas locales aprobadas. Los nuevos controles cubren el mapa en una planificación bloqueada, los dos implementadores configurados, la tarea completa plegada, filtrado de consultas y respuestas y actualizaciones mediante SSE real. Ninguna acción de lectura del panel invoca proveedores ni incrementa el contador de llamadas.

El circuito de demo conserva exactamente 11 llamadas simuladas; los números de implementador y sus eventos se agregan localmente. La telemetría reenvía mensajes y comandos existentes de CLI simuladas, conserva el prompt recibido y excluye bloques de razonamiento y propuestas JSON completas del chat visible.

Se renderizó e inspeccionó el SVG real del mapa en estados de trabajo y bloqueo. La interfaz se verificó con jsdom y un servidor HTTP real; no hubo un navegador automatizable disponible para revisar la página completa. No se ejecutaron llamadas a modelos reales para esta actualización.

Los cambios no reanudan un plan rechazado ni permiten que los implementadores modifiquen pruebas reservadas para calidad independiente. El error nuevo identifica la tarea y ruta que provocaron el rechazo.

## Versión 0.2.1 — instalación y primer uso

La skill principal se llama `orquesta`; `orquestar` se conserva como alias. El instalador comprueba que los cuatro helpers ejecuten la versión instalada y muestra el comando exacto de cada cliente y el estado de sus conexiones.

- Las 25 pruebas de la suite pasan localmente en Windows. La prueba de integración cubre ambos nombres, ejecución de los helpers, reinstalación y conservación de skills ajenas.
- `npm run test:install` empaqueta el código y lo instala mediante `npm exec` en un perfil vacío, con prefijo global, caché y configuración de npm temporales. Usa rutas con espacios, elimina la caché después de instalar, ejecuta los helpers desde la copia permanente y abre dos repositorios Git sin cambios versionados. Este chequeo necesita conexión al registro de npm y no llama a modelos.
- La instalación local de 0.2.1 detectó las sesiones de ambos proveedores. `skills/list` de Codex CLI 0.153.4, con `forceReload`, devolvió `orquesta` y `orquestar` habilitadas para otro proyecto, sin errores de carga. Esto comprueba descubrimiento real de la skill; no equivale a probar visualmente el autocompletado o un menú conversacional completo.
- GitHub Actions ejecuta la suite, el empaquetado y la instalación desde un perfil vacío en Windows, Ubuntu y macOS. El estado actual está en [Checks](https://github.com/EmanuelMdz/orquesta/actions/workflows/check.yml).

`--version` funciona sin cargar el motor SQLite. Las llamadas reales a modelos siguen limitadas a las pruebas históricas detalladas más abajo.

## Versión 0.2.0 — 6 de septiembre de 2026

`npm test`: **25 pruebas aprobadas**, sin fallos, en Windows con Node 24.12.0. El runner usa un directorio personal temporal para que los combos reales del usuario no alteren las pruebas.

Además del circuito central y las políticas de la versión anterior, se comprobaron:

- Primer uso en repositorios limpios sin crear archivos versionados ni commits de configuración.
- Ajustes distintos por proyecto, validación antes de guardar y conservación de la configuración anterior si el cambio es inválido.
- Combos personales predeterminados para proyectos nuevos y conservación de los ajustes de proyectos existentes.
- Instalación de skills para Codex y Claude con un helper ejecutable, conservando skills ajenas del mismo nombre.
- Enrutamiento de modelos según el proveedor de cada rol, incluido Claude como director y Codex como implementador, usando CLI simuladas.
- Servicio en segundo plano reutilizable y cierre desde otro cliente.
- Codex MCP y panel compartiendo la misma ejecución, consultas y pausa; cerrar el cliente MCP conserva al propietario del servicio.
- Lanzamiento `orquesta codex` con conexión MCP de sesión, comprobado con una CLI simulada.
- Configuración y confirmación visual con jsdom y API real: revisar una tarea no inicia agentes, y la cancelación conserva el estado.

La skill pasó `quick_validate.py`. Compilación y comprobación de tipos aprobadas. Las pruebas de interfaz usan jsdom; no equivalen a una revisión visual en un navegador ni a una prueba completa del menú conversacional dentro de ambos clientes.

La prueba real de modelos documentada abajo corresponde al combo Astra→Opus de la versión 0.1. El circuito central sigue cubierto por tests, pero no se ejecutaron todos los combos posibles con cuentas reales.

## Versión 0.1.0 — registro histórico

Fecha: 5 de septiembre de 2026. Plataforma: Windows, Node 24.12.0, Git 2.49.0, Codex CLI 0.153.4, Claude Code 2.1.261.

## Pruebas locales

17 pruebas aprobadas: 15 de motor/políticas/API y 2 de interfaz/protocolo.

- Pipeline con dos tareas, consulta a Astra, test fallido, corrección y aprobación del commit exacto.
- Pausa y reanudación, consulta humana pendiente, presupuesto de llamadas y repositorio sucio.
- Rechazo de una aprobación cuando existen pruebas fallidas.
- Validación de rutas, traversal, rutas de control, alias de Windows, symlinks/junctions y propuestas completas antes de escribir.
- Ciclos de dependencias y separación del alcance de implementación y QA.
- Redacción, limpieza de credenciales, tiempo máximo y cancelación de procesos.
- Regresión del entorno heredado de `node:test`: el fallo de un test hijo se detecta correctamente.
- API local: autenticación, Origin, streaming de eventos y estado.
- Interfaz con jsdom y servidor HTTP real: actividad, tareas, pestañas, respuesta del usuario y texto malicioso sin ejecución HTML.
- MCP por stdio: inicialización, listado de herramientas y ping sin contaminar stdout.

También pasaron compilación TypeScript, comprobación de tipos y auditoría de instalación con cero vulnerabilidades reportadas. La interfaz se verificó con jsdom, no mediante una inspección visual en un navegador real.

## Prueba con modelos reales

Comando: `npm run test:live`. Este test consume uso de las cuentas y no se ejecuta dentro de `npm test`.

- Ejecución: `20260905231006-77a08d`.
- Estado final: `completed`.
- Llamadas a modelos: 6.
- Astra: `gpt-6-astra`; Opus: selector `opus` de Claude Code.
- Astra planificó la función `add(a, b)` con validación de números finitos.
- Opus preguntó a Astra si debía lanzar `TypeError` para entradas no válidas; Astra confirmó y Opus implementó. La consulta fue solicitada expresamente por el fixture para probar este canal.
- Astra generó tres pruebas independientes. Las tres pasaron; Astra revisó y aprobó.
- La integración repitió las tres pruebas: las tres pasaron.
- Commit final: `302db5aac3c2898694fe6a38b98b47cace659e81`.

El registro local se conserva en `.orquesta/demos/demo-1135b556/.orquesta`; el resumen está en `.orquesta/live-smoke-latest.json`. Estos archivos se excluyen del repositorio y del paquete distribuible.

## Instalación y conexión

Se generó el paquete `orquesta-local-0.1.0.tgz`, se inspeccionó su lista de archivos y se instaló globalmente. El paquete contiene CLI compilada, panel y documentación; excluye credenciales, repositorios de prueba y registros. `orquesta --help` y `orquesta doctor --json` funcionaron desde la instalación global y detectaron ambas sesiones.

`orquesta connect-codex` registró el servidor MCP global; repetir el comando confirmó la misma configuración. Un proceso real `codex exec` con Astra invocó `orquesta_status` mediante esa conexión y recibió `completed` con una tarea. Las anotaciones de lectura de estado/eventos se comprobaron también en el test de protocolo. Las acciones que inician agentes conservan la política de aprobación de Codex.

El panel HTTP activo leyó la ejecución real guardada y respondió correctamente usando su token local.

La prueba confirma el circuito real de una tarea acotada. No demuestra funcionamiento universal con repositorios grandes, otros frameworks, dependencias complejas ni fallos abruptos del sistema.
