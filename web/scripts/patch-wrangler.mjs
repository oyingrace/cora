#!/usr/bin/env node
// Patches dist/client/wrangler.json after every vite build.
//
// vinext generates this file with:
//   main = "../server/index.js"       ← the RSC root (wrong for deployment)
//   assets.run_worker_first = missing ← means CF serves assets, never calls the worker
//
// We need:
//   main = "../server/ssr/index.js"   ← the SSR Worker entrypoint vinext actually builds
//   assets.run_worker_first = true    ← so every request hits the worker first
//
// Run automatically via "postbuild:vinext" in package.json.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wranglerPath = resolve(__dirname, '../dist/client/wrangler.json');

const config = JSON.parse(readFileSync(wranglerPath, 'utf8'));

config.main = '../server/ssr/index.js';
// Array form: worker handles all routes EXCEPT static assets which CF serves directly.
// "!/_next/static/*" exclusion ensures CSS/JS chunks bypass the worker and get
// served straight from the Assets binding with the immutable cache headers in _headers.
config.assets = { ...config.assets, run_worker_first: ['/*', '!/_next/static/*'] };

writeFileSync(wranglerPath, JSON.stringify(config));
console.log('[patch-wrangler] dist/client/wrangler.json patched:');
console.log('  main:', config.main);
console.log('  assets.run_worker_first:', JSON.stringify(config.assets.run_worker_first));
