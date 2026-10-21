// Run a command with a wall-clock timeout; capture output; never throws.
import { spawn } from 'node:child_process';

export function run(cmd, args = [], { cwd, env, timeoutMs = 600_000, input } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let out = '', err = '', timedOut = false;
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 10_000).unref();
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    if (input != null) child.stdin.end(input);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: `${err}\n${e.message}`, timedOut, ms: Date.now() - started }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code, out, err, timedOut, ms: Date.now() - started }); });
  });
}
export const sh = (command, opts = {}) => run('/bin/bash', ['-lc', command], opts);
export const tail = (s, n = 1500) => (s || '').trim().slice(-n);
