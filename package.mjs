import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const protectedRoot = resolve('D:/desktop/文档/secret').toLowerCase();
function safePath(name) {
  const path = resolve(root, name);
  if (path.toLowerCase() === protectedRoot || path.toLowerCase().startsWith(protectedRoot + sep) || !path.startsWith(root + sep)) throw Error('Protected/outside path');
  return path;
}
execFileSync(process.execPath, [safePath('build.mjs')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [safePath('verify.mjs')], { cwd: root, stdio: 'inherit' });
const { version, displayName } = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
const destination = `dist/v${version}`;
await mkdir(safePath(destination), { recursive: true });

// Standard ZIP with UTF-8 filenames; no executable packaging dependencies.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const { name, content } of entries) {
    const filename = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE((46 << 9) | (10 << 5) | 19, 12); // 2026-10-19.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    directorySize += central.length + filename.length;
    offset += header.length + filename.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...directory, end]);
}
const files = [`${displayName}.html`, `启动${displayName}.cmd`, 'serve.mjs', 'launch.mjs', '使用说明.txt', 'THIRD_PARTY_NOTICES.md'];
const entries = await Promise.all(files.map(async file => ({ name: `${displayName}/${file}`, content: await readFile(safePath(file)) })));
const zipName = `yu-daguan-local-v${version}.zip`;
await writeFile(safePath(`${destination}/${zipName}`), zip(entries));
await copyFile(safePath(`${displayName}.html`), safePath(`${destination}/${displayName}.html`));
const outputs = [zipName, `${displayName}.html`];
const checksums = [];
for (const file of outputs) {
  const bytes = await readFile(safePath(`${destination}/${file}`));
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`);
}
await writeFile(safePath(`${destination}/SHA256SUMS.txt`), checksums.join('\n') + '\n');
console.log(`发布包已生成：${destination}/${zipName}`);
