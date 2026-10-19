const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
async function main() {
  assert(process.argv[2], 'Aday dizini gerekli');
  const candidate = resolve(process.argv[2]);
  const read = async name => JSON.parse(await fs.readFile(join(candidate, name), 'utf8'));
  const { adayiDogrula } = await import(resolve(root, 'scripts/f02-aday-dogrula.mjs'));
  const aday = await adayiDogrula(candidate, { kaynak: false });
  const runtime = await read('f02-runtime-prova.json');
  const browser = await read('f02-tam-akis-prova.json');
  const archive = await read('f02-runtime-arsiv.json');
  const core = await read('cekirdek-kabul.json');
  const pointer = await read('runtime-son-aday.json');
  for (const proof of [runtime, browser]) {
    assert.equal(proof.durum, 'gecti');
    assert.equal(proof.temizlik, true);
    assert.equal(proof.runtime.name, pointer.name);
    assert.equal(proof.runtime.aday.dosyaOzeti, aday.dosyaOzeti);
  }
  assert.equal(archive.durum, 'arsiv_hazir');
  assert.equal(archive.runtime.name, pointer.name);
  assert.equal(core.durum, 'gecti');
  const scripts = [
    ['cekirdek-runtime-prova.cjs', runtime.betikSha256],
    ['cekirdek-runtime-arsivle.cjs', archive.betikSha256],
    ['cekirdek-tam-akis-prova.cjs', browser.betikSha256],
    ['cekirdek-tam-akis-tarayici.cjs', browser.tarayiciBetikSha256],
  ];
  for (const [file, hash] of scripts) assert.equal(sha(await fs.readFile(resolve(root, 'scripts', file))), hash, file);
  const archiveHash = createHash('sha256');
  for await (const part of createReadStream(join(candidate, archive.archive.file))) archiveHash.update(part);
  assert.equal(archiveHash.digest('hex'), archive.archive.sha256);
  const names = ['manifest.json', 'cekirdek-kabul.json', 'f02-runtime-prova.json', 'f02-runtime-arsiv.json', 'f02-tam-akis-prova.json', 'runtime-son-aday.json', pointer.manifest, pointer.name + '-browsers.manifest.json'];
  for (const entry of await fs.readdir(join(candidate, browser.ekranDizini))) names.push(browser.ekranDizini + '/' + entry);
  const files = {};
  for (const name of names.sort()) files[name] = sha(await fs.readFile(join(candidate, name)));
  const summary = { surum: 1, durum: 'gecti', zaman: new Date().toISOString(), aday,
    runtimeKontrolleri: runtime.testAdedi, pdfKontrolleri: 1, tamAkisKontrolleri: browser.testAdedi,
    temizlik: true, gercekSirketDegisikligi: false, yayinlandi: false,
    arsiv: archive.archive, kanitlar: files, kanitOzeti: sha(JSON.stringify(files)),
    kalanlar: ['hedef kapasite ve servis yonetimi', 'onayli onceki dagitima geri donus', 'gercek pilot ve alan kabulu', 'canli yayin'],
  };
  await fs.writeFile(join(candidate, 'cekirdek-runtime-kabul-ozeti.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
