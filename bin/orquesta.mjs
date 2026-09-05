#!/usr/bin/env node
try {
  const { main } = await import('../dist/cli.js');
  await main(process.argv.slice(2));
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') console.error('Primero ejecutá npm install y npm run build en el repositorio de Orquesta.');
  else console.error(`Orquesta: ${error.message}`);
  process.exitCode = 1;
}
