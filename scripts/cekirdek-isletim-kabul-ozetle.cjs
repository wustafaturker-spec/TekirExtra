const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const sha = value => createHash('sha256').update(value).digest('hex');
async function main() {
  assert(process.argv[2], 'Aday dizini gerekli');
  const candidate = resolve(process.argv[2]);
  const runtime = JSON.parse(await fs.readFile(join(candidate, 'cekirdek-runtime-kabul-ozeti.json'), 'utf8'));
  assert.equal(runtime.durum, 'gecti');
  for (const [name, hash] of Object.entries(runtime.kanitlar)) {
    assert.equal(sha(await fs.readFile(join(candidate, name))), hash, 'Önceki kanıt değişmiş: ' + name);
  }
  const file = 'cekirdek-isletim-prova.json';
  const raw = await fs.readFile(join(candidate, file));
  const proof = JSON.parse(raw);
  assert.equal(proof.durum, 'gecti');
  assert.equal(proof.temizlik, true);
  assert.equal(proof.aday.dosyaOzeti, runtime.aday.dosyaOzeti);
  assert(proof.kontroller.every(row => row.durum === 'gecti'));
  const script = await fs.readFile(resolve(__dirname, 'cekirdek-isletim-prova.cjs'));
  assert.equal(sha(script), proof.betikSha256);
  const { adayiDogrula } = await import(resolve(__dirname, 'f02-aday-dogrula.mjs'));
  await adayiDogrula(candidate, { kaynak: false });
  const measurement = proof.kontroller.find(row => row.ad === 'yerel_http_es_zamanli_okuma_olcumu');
  assert(measurement);
  assert.equal(measurement.basarisizIstek, 0);
  const summary = {
    surum: 1, durum: 'gecti', zaman: new Date().toISOString(), aday: proof.aday,
    isletimKontrolAdedi: proof.testAdedi, temizlik: true,
    rapor: { file, sha256: sha(raw) }, betikSha256: sha(script),
    oncekiRuntimeKaniti: { file: 'cekirdek-runtime-kabul-ozeti.json', sha256: sha(await fs.readFile(join(candidate, 'cekirdek-runtime-kabul-ozeti.json'))) },
    yerelOlcum: measurement, uretimKapasiteKabulu: false, oncekiSurumeDonusKabulu: false,
    gercekSirketDegisikligi: false, yayinlandi: false,
  };
  await fs.writeFile(join(candidate, 'cekirdek-isletim-kabul-ozeti.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
