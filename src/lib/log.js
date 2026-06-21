/** Tiny leveled logger so the CLI output is consistent and greppable. */
const COLORS = { info: '', warn: '\x1b[33m', error: '\x1b[31m', ok: '\x1b[32m', dim: '\x1b[2m' };
const RESET = '\x1b[0m';

function emit(level, label, msg) {
  const color = COLORS[level] || '';
  process.stderr.write(`${color}${label}${RESET} ${msg}\n`);
}

export const log = {
  info: (m) => emit('info', '·', m),
  ok: (m) => emit('ok', '✓', m),
  warn: (m) => emit('warn', '!', m),
  error: (m) => emit('error', '✗', m),
  dim: (m) => emit('dim', ' ', m),
};
