import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
try {
  const latest = JSON.parse(readFileSync(resolve(root, '.orquesta/live-smoke-latest.json'), 'utf8'));
  const child = spawn(process.execPath, [resolve(root, 'bin/orquesta.mjs'), 'ui', '--repo', latest.repo], { stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error('No hay una prueba real guardada en esta copia. Ejecutá npm run test:live para crearla.');
  process.exitCode = 1;
}
