# Instalación asistida

Si el usuario te pasó este repositorio para instalar Orquesta, completá la instalación global y verificá los comandos de chat. No crees configuraciones ni commits en cada proyecto.

1. Comprobá Node.js >=22.13, npm y Git.
2. Ejecutá `npm install -g git+https://github.com/EmanuelMdz/orquesta.git`. En PowerShell podés usar `npm.cmd`. Si el repo es privado, el usuario necesita acceso de GitHub.
3. Ejecutá `orquesta install` de forma idempotente para comprobar que están instaladas las skills para ambos clientes, y `orquesta doctor` para detectar sus CLI/sesiones. No copies ni imprimas credenciales. Una CLI que falte sólo impide usar sus modelos; informá qué falta sin cambiar de proveedor.
4. Informá al usuario: `/orquestar` dentro de Claude Code, `$orquestar` o `/skills` dentro de Codex, y `orquesta` desde una terminal. Reabrí los chats que no detecten la nueva skill.
5. No inicies una tarea de desarrollo sólo por instalar la herramienta. El asistente guía la elección de equipo y tarea y espera su confirmación.

La instalación global registra skills sólo desde la ubicación final del paquete; no desde clones temporales de npm ni cuando se instala como dependencia local de otro proyecto. No se modifica la política de aprobación de ninguna CLI.

Para actualizar, repetí el comando de instalación global. Para instalar una copia local del código: `npm ci`, `npm pack`, `npm install -g ./orquesta-local-0.2.0.tgz`.
