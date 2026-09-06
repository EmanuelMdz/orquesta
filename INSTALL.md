# Instalación asistida

Si el usuario te pasó este repositorio para instalar Orquesta, completá la instalación global y verificá los comandos de chat. No crees configuraciones ni commits en cada proyecto.

1. Comprobá Node.js >=22.13, npm y Git. Comprobá también `orquesta --version` si el comando existe. La versión documentada acá es 0.2.0: si ya está instalada, pasá a la verificación del paso 3. Si hay una versión posterior, no hagas un downgrade automático.
2. Para una instalación nueva o una versión anterior, ejecutá `npx --yes --package=git+https://github.com/EmanuelMdz/orquesta.git#v0.2.0 orquesta install`. En PowerShell podés usar `npx.cmd`. El instalador deja una copia global permanente y registra las skills desde esa copia. Este repositorio es público: no requiere una cuenta de GitHub para descargarlo. No lo clones dentro del proyecto del usuario.
3. Ejecutá `orquesta install` de forma idempotente para comprobar que están instaladas las skills para ambos clientes, y `orquesta doctor` para detectar sus CLI/sesiones. No copies ni imprimas credenciales. Una CLI que falte sólo impide usar sus modelos; informá qué falta sin cambiar de proveedor.
4. Informá al usuario: `/orquestar` dentro de Claude Code, `$orquestar` o `/skills` dentro de Codex, y `orquesta` desde una terminal. Reabrí los chats que no detecten la nueva skill.
5. No inicies una tarea de desarrollo sólo por instalar la herramienta. El asistente guía la elección de equipo y tarea y espera su confirmación.

La instalación global registra skills sólo desde la ubicación final del paquete; no desde clones temporales de npm ni cuando se instala como dependencia local de otro proyecto. No se modifica la política de aprobación de ninguna CLI.

Si falta un requisito, informá cuál. Las CLI oficiales y las sesiones de Codex y Claude se preparan por separado; instalar Orquesta no crea cuentas ni garantiza acceso a todos los modelos. Si una skill ajena ya ocupa el nombre `orquestar`, conservála y explicá el conflicto. No cambies permisos, modelos ni configuraciones del proyecto para hacer pasar la verificación.

Para actualizar, repetí el comando de instalación global. Para instalar una copia local del código: `npm ci`, `npm pack`, `npm install -g ./orquesta-local-0.2.0.tgz`.
