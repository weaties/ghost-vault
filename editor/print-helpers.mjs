#!/usr/bin/env node
// Print koenig-helpers.js with comments and indentation stripped, ready to
// paste into the automation session's javascript tool (about a third smaller).
// Usage: npm run editor:helpers
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./koenig-helpers.js', import.meta.url), 'utf8');
process.stdout.write(
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/^\s+/, ''))
    .filter(Boolean)
    .join('\n') + '\n'
);
