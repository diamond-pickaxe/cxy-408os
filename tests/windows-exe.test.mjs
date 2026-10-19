import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blocked = resolve('D:/desktop/文档/secret').toLowerCase();
function safePath(name) {
  const file = resolve(root, name);
  if (file.toLowerCase() === blocked || file.toLowerCase().startsWith(blocked + sep) || !file.startsWith(root + sep)) throw Error('Protected/outside path');
  return file;
}
const { version, displayName } = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
const exe = safePath(`dist/v${version}/yu-daguan-local-v${version}-win-x64.exe`);
const html = await readFile(safePath(`${displayName}.html`));
const expectedSha = createHash('sha256').update(html).digest('hex');
// The child process has only standard Windows paths; Node.js is unavailable to it.
const env = { ...process.env, PATH: join(process.env.WINDIR || 'C:\\Windows', 'System32') };
const resource = execFileSync(exe, ['--resource-check'], { encoding: 'utf8', env, windowsHide: true });
const child = spawn(exe, ['--self-test', '--port=0'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let output = '', errors = '';
child.stderr.on('data', chunk => errors += chunk);
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(`EXE startup timed out: ${errors}`)), 15000);
  child.stdout.on('data', chunk => { output += chunk; const match = output.match(/PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(Error(`EXE exited early: ${code}, ${errors}`)); });
});
const base = `http://127.0.0.1:${port}`;

test('native EXE contains the complete verified question bank and runs without Node.js', () => {
  assert.match(resource, new RegExp(`HTML_BYTES=${html.length}`));
  assert.match(resource, new RegExp(`HTML_SHA256=${expectedSha}`));
  assert.match(output, new RegExp(`HTML_SHA256=${expectedSha}`));
});

test('native EXE serves all embedded questions and an application health response', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-app-id'), 'yu-daguan-local');
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha);
  const health = await (await fetch(`${base}/__health`)).json();
  assert.equal(health.version, version);
  assert.equal(health.htmlSha256, expectedSha);
});

test('server supports HEAD and favicon and refuses filesystem access and writes', async () => {
  const response = await fetch(base, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(`${base}/favicon.ico`)).status, 200);
  for (const route of ['/user-notes.json', '/seed.js', '/.private/', '/data.js', '/anything']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base, { method: 'POST', body: 'write' })).status, 405);
});

test('loopback server rejects requests carrying a different Host header', async () => {
  const status = await new Promise((resolve, reject) => {
    const request = http.request(base, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); });
    request.once('error', reject);
    request.end();
  });
  assert.equal(status, 403);
});

after(async () => {
  child.stdin.end('\n');
  if (child.exitCode === null) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('EXE did not exit cleanly')); }, 5000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`EXE exit code ${code}: ${errors}`)); });
  });
  assert.equal(child.exitCode, 0);
});
