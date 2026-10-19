import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dogrula } from './cekirdek-servis-dogrula.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tekir-servis-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'api'));
  await writeFile(join(root, 'api/main.js'), 'sabit aday');
  return { root, spec: { aday: 'fixture', dizinler: { api: { 'main.js': sha('sabit aday') } } } };
}
test('sabit dosya ve paket içi bağlantı kabul edilir', async t => {
  const { root, spec } = await fixture(t);
  await symlink('main.js', join(root, 'api/entry.js'));
  spec.dizinler.api['entry.js'] = sha('symlink\0main.js');
  assert.equal((await dogrula(root, spec)).dosyaAdedi, 2);
});
test('değişmiş uygulama dosyası reddedilir', async t => {
  const { root, spec } = await fixture(t);
  await writeFile(join(root, 'api/main.js'), 'değişti');
  await assert.rejects(dogrula(root, spec), /Dosya değişmiş/);
});
test('eksik dosya reddedilir', async t => {
  const { root, spec } = await fixture(t);
  await rm(join(root, 'api/main.js'));
  await assert.rejects(dogrula(root, spec), /Eksik veya ek/);
});
test('sonradan eklenen dosya reddedilir', async t => {
  const { root, spec } = await fixture(t);
  await writeFile(join(root, 'api/ek.js'), 'ek');
  await assert.rejects(dogrula(root, spec), /Eksik veya ek/);
});
test('pakete yanlışlıkla eklenen ortam dosyası reddedilir', async t => {
  const { root, spec } = await fixture(t);
  await writeFile(join(root, 'api/.env.local'), 'sentetik');
  await assert.rejects(dogrula(root, spec), /ortam dosyası/);
});
test('paket dışına çıkan bağlantı reddedilir', async t => {
  const { root, spec } = await fixture(t);
  await writeFile(join(root, 'dis.js'), 'dış');
  await symlink('../dis.js', join(root, 'api/dis.js'));
  spec.dizinler.api['dis.js'] = sha('symlink\0../dis.js');
  await assert.rejects(dogrula(root, spec), /dışına sembolik/);
});
test('dizin yoluyla release dışına çıkılamaz', async t => {
  const { root } = await fixture(t);
  await assert.rejects(dogrula(root, { dizinler: { '..': {} } }), /Geçersiz paket dizini/);
});
