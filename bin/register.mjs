import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm also runs lifecycle scripts in temporary Git build directories. Register only
// from the final global installation, never from a clone or a project dependency.
if (process.env.npm_config_global === 'true' && process.env.npm_execpath && process.env.ORQUESTA_SKIP_INTEGRATIONS !== '1') {
  try {
    const root = execFileSync(process.execPath, [process.env.npm_execpath, 'root', '--global'], { encoding:'utf8', windowsHide:true }).trim();
    const current = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
    if (current === realpathSync(join(root, 'orquesta-local'))) {
      const { installIntegrations } = await import('../dist/integrations.js');
      installIntegrations();
      console.log('Orquesta lista: $orquesta en Codex, /orquesta en Claude, u orquesta en la terminal. Reabrí los chats que estaban abiertos.');
    }
  } catch (error) {
    console.error('Orquesta instalada. Para activar los comandos de chat, ejecutá orquesta install. ' + error.message);
  }
}
