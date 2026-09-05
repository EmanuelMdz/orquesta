# Orquesta

Astra dirige, Opus implementa. Orquestador local para usar desde la terminal de VS Code, con un panel que muestra tareas, consultas, respuestas, cambios y pruebas en vivo.

**Versión 0.1.0 funcional.** Usa los procesos oficiales `codex` y Claude Code con sus sesiones existentes. No necesita que copies claves al proyecto. Las ejecuciones reales consumen el uso de tus cuentas. El acceso al modelo configurado debe estar disponible en cada cuenta; no hay sustitución automática.

## Instalar

Requisitos: Node.js 22.13 o superior, Git, Codex CLI con sesión iniciada y Claude Code con sesión iniciada y acceso a Opus. En Windows también se detecta Claude instalado por su extensión de VS Code.

Desde este repositorio:

```powershell
npm ci
npm run build
npm pack
npm install -g .\orquesta-local-0.1.0.tgz
orquesta doctor
```

Otra persona puede recibir `orquesta-local-0.1.0.tgz` e instalarlo con `npm install -g RUTA-AL-ARCHIVO.tgz`; no necesita TypeScript ni compilar el proyecto. También necesita sus propias CLI y sesiones. El paquete no está publicado en npm y todavía no existe instalador `.exe`.

Si PowerShell bloquea scripts, usá `npm.cmd` y `orquesta.cmd`. Después de instalar, `orquesta --help` muestra los comandos.

## Seguir usando `codex`

```powershell
orquesta connect-codex
codex
```

Reiniciá una sesión de Codex que ya estuviera abierta. Orquesta queda registrada como servidor MCP del usuario. Tu comando `codex` sigue siendo el mismo. En el proyecto que quieras modificar, podés pedir:

> Usá orquesta_start en este repositorio para implementar [objetivo]. Astra debe planificar, resolver consultas y revisar; Opus debe escribir la implementación. Mostrame los eventos y el resultado de las pruebas.

Herramientas: `orquesta_start`, `orquesta_status`, `orquesta_events`, `orquesta_pause`, `orquesta_resume` y `orquesta_answer`. Cada una recibe la ruta del repositorio; las de seguimiento también reciben el identificador de ejecución. La tarea continúa en el servidor MCP mientras Codex puede consultar sus eventos. Si la sesión termina, el servidor intenta pausar sus tareas y guarda el estado.

`connect-codex` conserva cualquier servidor existente llamado `orquesta` que apunte a otra instalación. Para quitar esta conexión: `codex mcp remove orquesta`.

Las consultas de estado y eventos se declaran como lectura. Iniciar o reanudar trabajo puede pedir aprobación según la política de tu Codex, porque ejecuta agentes y modifica worktrees. En modo no interactivo con aprobaciones deshabilitadas, usá el comando explícito `orquesta run` para iniciar trabajo.

## Probar y ver el trabajo

```powershell
orquesta demo --ui
```

Abrí el enlace local que imprime la terminal. La demo no llama modelos: simula sus respuestas, pero crea un repositorio aislado, aplica cambios y ejecuta pruebas reales. Incluye una consulta, una prueba que falla y su corrección. También podés hacer doble clic en `Probar-demo.cmd` desde el repositorio.

El panel muestra los mensajes explícitos y eventos observables de los agentes, no razonamiento privado interno. Hay pestañas de actividad, cambios y pruebas, selección de ejecuciones y controles para iniciar, pausar, reanudar y responder consultas humanas. Los eventos también aparecen en terminal y quedan guardados localmente.

`Ver-prueba-real.cmd` abre el registro de la última prueba con modelos reales realizada en esta copia. `Abrir-panel.cmd` abre el panel del propio repositorio Orquesta. Cada comando imprime el enlace que hay que abrir.

## Trabajar sobre un proyecto

El proyecto debe ser un repositorio Git con un commit inicial y sin cambios pendientes. Primero revisá o guardá tu trabajo.

```powershell
cd C:\ruta\a\tu-proyecto
orquesta setup
git add orquesta.config.json .gitignore
git commit -m "Configure Orquesta"
orquesta run "Implementar la funcionalidad y sus criterios de aceptación" --ui
```

El plan de Astra divide el trabajo con archivos y dependencias explícitas. Opus trabaja en worktrees separados, consulta a Astra cuando devuelve una duda y recibe su respuesta antes de continuar. Astra escribe pruebas independientes y revisa el diff con sus resultados. Se vuelve a probar la integración completa.

El resultado queda en la rama `orquesta/<run_id>/integration`; tu rama de origen conserva su HEAD. El panel y la terminal muestran la rama y el estado. Para incorporar una ejecución terminada, revisá el diff y fusioná esa rama desde tu rama de trabajo cuando quieras.

```powershell
orquesta status
orquesta inspect RUN_ID
orquesta resume RUN_ID --ui
orquesta answer RUN_ID TASK_ID "Tu decisión"
```

`Ctrl+C` intenta pausar y conservar el trabajo. Una consulta marcada para el usuario requiere su respuesta explícita. Un panel abierto en otro proceso puede observar el estado persistido, pero la pausa del motor activo debe pedirse en el proceso que lo ejecuta (su panel, terminal o MCP).

## Configuración

`orquesta setup` crea `orquesta.config.json`. Valores principales:

| Campo | Predeterminado | Uso |
| --- | --- | --- |
| `astraModel` | `gpt-6-astra` | Plan, decisiones, pruebas y revisión |
| `opusModel` | `opus` | Implementación |
| `workers` | `2` | Implementaciones concurrentes si sus archivos no se superponen |
| `maxCalls` | `40` | Tope de llamadas por ejecución |
| `maxCorrections` | `2` | Rondas de corrección por tarea |
| `maxQuestions` | `3` | Consultas por tarea |
| `timeoutMs` | `300000` | Tiempo máximo por subproceso |
| `maxContextBytes` | `160000` | Presupuesto del contexto de archivos |
| `qaRoot` | `test/orquesta` | Carpeta reservada a pruebas de Astra |
| `qaCommand` | `["node", "--test"]` | Comando al que se agregan las pruebas generadas |
| `checks` | `[]` | Comprobaciones adicionales del proyecto |

La configuración predeterminada sirve para proyectos JavaScript con `node:test`. Otros lenguajes y frameworks necesitan adaptar el comando y preparar dependencias dentro de los worktrees; esto todavía no se automatiza. Los comandos se ejecutan como argumentos de procesos, sin pasar por una shell. Para CLI no detectadas, configurá `codexPath` y `claudePath`, o `ORQUESTA_CODEX_PATH` y `ORQUESTA_CLAUDE_PATH`.

## Desarrollo y validación

```powershell
npm test
npm run check
npm run test:live
```

**`test:live` sí llama modelos reales.** Crea su propio repositorio de prueba y comprueba el circuito completo Astra → Opus → consulta → Astra → implementación → pruebas → revisión → integración. Los demás tests son locales.

Resultados y alcance: [validación](docs/VALIDATION.md). Diseño y módulos: [arquitectura](docs/ARCHITECTURE.md).

## Alcance de esta versión

Los agentes devuelven archivos estructurados; el motor valida su alcance y los escribe. Opus recibe contexto acotado y no tiene herramientas de shell habilitadas. Codex se ejecuta con sandbox de solo lectura durante sus propuestas. Las pruebas sí ejecutan código del proyecto: usalo con repositorios confiables. Los worktrees separan cambios, no son un sandbox de seguridad.

El panel escucha solamente en `127.0.0.1`, usa un token local y guarda el historial en `.orquesta`. No publiques esa carpeta: puede contener código y conversaciones. No se hace push a servicios externos.

La pausa normal está probada. Una caída abrupta durante una escritura o fusión puede requerir revisar el worktree; no hay recuperación transaccional completa. Los conflictos de integración bloquean la ejecución y los tests incorrectos pueden necesitar intervención. No hay instalación automática de dependencias, reparación automática de QA ni aislamiento con contenedores. Se probó el protocolo MCP y una consulta de estado desde un proceso real de Codex; una sesión que ya estuviera abierta debe reiniciarse para cargar la conexión.

Próximos pasos posibles: instalador de escritorio, preparación de entornos por proyecto, contexto con grafo del código y recuperación más amplia ante interrupciones. Windows es la plataforma verificada de extremo a extremo en esta versión.
