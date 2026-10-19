import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const blocked = resolve('D:/desktop/文档/secret').toLowerCase();
function safePath(name) {
  const file = resolve(root, name);
  if (file.toLowerCase() === blocked || file.toLowerCase().startsWith(blocked + sep) || !file.startsWith(root + sep)) throw Error('Protected/outside path');
  return file;
}
if (process.platform !== 'win32') throw Error('Windows EXE needs to be built on Windows.');
const { version, displayName } = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
const work = '.desktop-build';
const destination = `dist/v${version}`;
await mkdir(safePath(work), { recursive: true });
await mkdir(safePath(destination), { recursive: true });
const html = await readFile(safePath(`${displayName}.html`));
await writeFile(safePath(`${work}/app.html.gz`), gzipSync(html, { level: 9 }));

// A small code-generated icon avoids bundling any extra image-processing dependency.
const width = 32, pixels = Buffer.alloc(width * width * 4), mask = Buffer.alloc(width * 4);
for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
  let color = null;
  if (Math.abs(x - 11) + Math.abs(y - 14) <= 11) color = [95, 184, 185];
  if (Math.abs(x - 21) + Math.abs(y - 18) <= 10) color = [89, 176, 127];
  const i = ((width - 1 - y) * width + x) * 4;
  if (color) { pixels[i] = color[2]; pixels[i + 1] = color[1]; pixels[i + 2] = color[0]; pixels[i + 3] = 255; }
  else mask[(width - 1 - y) * 4 + Math.floor(x / 8)] |= 1 << (7 - x % 8);
}
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0); dib.writeInt32LE(width, 4); dib.writeInt32LE(width * 2, 8);
dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(pixels.length + mask.length, 20);
const image = Buffer.concat([dib, pixels, mask]);
const iconHeader = Buffer.alloc(22);
iconHeader.writeUInt16LE(1, 2); iconHeader.writeUInt16LE(1, 4);
iconHeader[6] = width; iconHeader[7] = width;
iconHeader.writeUInt16LE(1, 10); iconHeader.writeUInt16LE(32, 12);
iconHeader.writeUInt32LE(image.length, 14); iconHeader.writeUInt32LE(22, 18);
await writeFile(safePath(`${work}/app.ico`), Buffer.concat([iconHeader, image]));
await writeFile(safePath(`${work}/AssemblyInfo.cs`), `using System.Reflection;\n[assembly: AssemblyTitle(${JSON.stringify(displayName)})]\n[assembly: AssemblyProduct(${JSON.stringify(displayName)})]\n[assembly: AssemblyDescription("408 offline question bank; no Node.js installation required")]\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n`);
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (compiler.toLowerCase().startsWith(blocked)) throw Error('Protected compiler path');
await access(compiler);
const exeName = `yu-daguan-local-v${version}-win-x64.exe`;
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', `/out:${safePath(`${destination}/${exeName}`)}`, `/win32icon:${safePath(`${work}/app.ico`)}`, `/win32manifest:${safePath('desktop/app.manifest')}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', `/resource:${safePath(`${work}/app.html.gz`)},OfflineHtmlGzip`, `/resource:${safePath(`${work}/app.ico`)},AppIcon`, safePath('desktop/Program.cs'), safePath(`${work}/AssemblyInfo.cs`)], { cwd: root, stdio: 'inherit', windowsHide: true });
const report = execFileSync(safePath(`${destination}/${exeName}`), ['--resource-check'], { encoding: 'utf8', windowsHide: true });
const expected = createHash('sha256').update(html).digest('hex');
if (!report.includes(`HTML_SHA256=${expected}`)) throw Error('Compiled EXE resource does not match the verified offline HTML.');
const bytes = await readFile(safePath(`${destination}/${exeName}`));
if (bytes.subarray(0, 2).toString() !== 'MZ') throw Error('Invalid Windows executable');
await writeFile(safePath(`${work}/exe-verification.json`), JSON.stringify({ version, exeName, htmlBytes: html.length, htmlSha256: expected, exeBytes: bytes.length, exeSha256: createHash('sha256').update(bytes).digest('hex'), nodeRequired: false }, null, 2));
console.log(`Windows 单文件 EXE 已生成：${destination}/${exeName} (${bytes.length} bytes)`);
