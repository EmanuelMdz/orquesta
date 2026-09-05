# Validación de la versión 0.1.0

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
