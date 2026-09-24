import { build } from '../../../web/node_modules/esbuild/lib/main.js';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'public/brand'), { recursive: true });
await copyFile(path.join(root, '../../web/public/brand/ballantyne-title-logo.png'), path.join(root, 'public/brand/ballantyne-title-logo.png'));
await build({ absWorkingDir: root, entryPoints: ['src/app.tsx'], outfile: 'public/app.js', bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic', nodePaths: [path.join(root, '../../web/node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, minify: true, sourcemap: false, legalComments: 'none' });
