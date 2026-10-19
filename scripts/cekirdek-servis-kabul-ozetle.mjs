import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { adayiDogrula } from './f02-aday-dogrula.mjs';
assert(process.argv[2], 'Aday dizini gerekli');
const candidate = resolve(process.argv[2]), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const read = async path => JSON.parse(await readFile(join(candidate, path), 'utf8'));
const proof = await read('cekirdek-servis-prova.json'), bundle = await read('isletim/paket.json');
assert.equal(proof.durum, 'gecti'); assert.equal(proof.temizlik, true);
assert(proof.kontroller.every(row => row.durum === 'gecti'));
assert.equal(bundle.aday.dosyaOzeti, proof.runtime.aday.dosyaOzeti);
const files = {};
for (const [name, hash] of Object.entries(bundle.dosyalar)) {
  const value = sha(await readFile(join(candidate, 'isletim', name)));
  assert.equal(value, hash, 'Servis paketi değişmiş: ' + name); files['isletim/' + name] = hash;
}
assert.equal(sha(await readFile(join(root, 'scripts/cekirdek-servis-prova.cjs'))), proof.betikSha256);
assert.equal(sha(await readFile(join(root, 'scripts/cekirdek-tam-akis-tarayici.cjs'))), proof.tarayiciBetikSha256);
assert.equal(sha(await readFile(join(root, 'scripts/cekirdek-servis-paketi.mjs'))), bundle.betikSha256);
const previous = await read('cekirdek-isletim-kabul-ozeti.json');
assert.equal(sha(await readFile(join(candidate, previous.rapor.file))), previous.rapor.sha256);
const runtime = await read(previous.oncekiRuntimeKaniti.file);
assert.equal(sha(await readFile(join(candidate, previous.oncekiRuntimeKaniti.file))), previous.oncekiRuntimeKaniti.sha256);
for (const [name, hash] of Object.entries(runtime.kanitlar)) assert.equal(sha(await readFile(join(candidate, name))), hash, 'Önceki kanıt değişmiş: ' + name);
for (const name of ['cekirdek-servis-prova.json', 'isletim/paket.json', 'cekirdek-isletim-kabul-ozeti.json']) files[name] = sha(await readFile(join(candidate, name)));
for (const name of await readdir(join(candidate, proof.ekranDizini))) files[proof.ekranDizini + '/' + name] = sha(await readFile(join(candidate, proof.ekranDizini, name)));
const summary = { surum: 1, durum: 'gecti', zaman: new Date().toISOString(), aday: await adayiDogrula(candidate, { kaynak: false }),
  kontrolAdedi: proof.testAdedi, temizlik: true, servisPaketi: 'isletim', dosyalar: files,
  kanitOzeti: sha(JSON.stringify(files)), servisKuruldu: false, hostRebootSinandi: false,
  oncekiSurumeDonusKabulu: false, gercekSirketDegisikligi: false, yayinlandi: false };
await writeFile(join(candidate, 'cekirdek-servis-kabul-ozeti.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
