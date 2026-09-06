#!/usr/bin/env node
try {
  if (process.argv.slice(2).includes('--version')) {
    const { readFileSync } = await import('node:fs');
    const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    console.log(process.argv.includes('--json') ? JSON.stringify(version) : version);
  } else {
  const { main } = await import('../dist/cli.js');
  await main(process.argv.slice(2));
  }
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') console.error('Primero ejecutá npm install y npm run build en el repositorio de Orquesta.');
  else console.error(`Orquesta: ${error.message}`);
  process.exitCode = 1;
}
