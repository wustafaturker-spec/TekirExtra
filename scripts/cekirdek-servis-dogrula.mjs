import { readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const sha = value => createHash('sha256').update(value).digest('hex');
const inside = (base, target) => { const p = relative(base, target); return p !== '..' && !p.startsWith('../') && !isAbsolute(p); };
async function fileHash(path) {
  if ((await stat(path)).size < 16 * 1024 * 1024) return sha(await readFile(path));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function dogrula(base, spec) {
  base = await realpath(base);
  let count = 0;
  for (const [folder, expected] of Object.entries(spec.dizinler)) {
    const dir = resolve(base, folder);
    assert(inside(base, dir) && dir !== base, 'Geçersiz paket dizini');
    const found = {};
    async function walk(current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        assert(!entry.name.startsWith('.env'), 'Paket içinde ortam dosyası');
        const path = join(current, entry.name), key = relative(dir, path);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isSymbolicLink()) {
          assert(inside(dir, await realpath(path)), 'Paket dışına sembolik bağlantı');
          found[key] = sha('symlink\0' + await readlink(path));
        } else {
          assert(entry.isFile(), 'Desteklenmeyen dosya türü');
          found[key] = await fileHash(path);
        }
      }
    }
    assert(inside(base, await realpath(dir)), 'Paket dizini dışarıya bağlanıyor');
    await walk(dir);
    assert.deepEqual(Object.keys(found).sort(), Object.keys(expected).sort(), 'Eksik veya ek paket dosyası');
    for (const [file, hash] of Object.entries(expected)) assert.equal(found[file], hash, 'Dosya değişmiş: ' + folder + '/' + file);
    count += Object.keys(found).length;
  }
  return { durum: 'gecti', aday: spec.aday, dosyaAdedi: count, node: process.version };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const bundle = dirname(fileURLToPath(import.meta.url));
    const spec = JSON.parse(await readFile(join(bundle, 'surum.json'), 'utf8'));
    console.log(JSON.stringify(await dogrula(resolve(bundle, '..'), spec)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
