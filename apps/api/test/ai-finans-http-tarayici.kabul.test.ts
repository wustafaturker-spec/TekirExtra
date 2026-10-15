import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { Module } from '@nestjs/common';
import { ModuleRef, NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, type Prisma } from '@prisma/client';
import { chromium, type Browser } from 'playwright';
import { afterAll, expect, it } from 'vitest';
import { AuthGuard } from '../src/auth/auth.guard';
import { RollerGuard } from '../src/auth/roller.guard';
import { baglamAl, bosTutucuylaCalistir } from '../src/core/istek-baglami';
import { RaporService } from '../src/rapor/rapor.service';
import { RaporController } from '../src/rapor/rapor.controller';
import { AiAjanService } from '../src/ai/ajan/ai-ajan.service';
import { AiAjanController } from '../src/ai/ajan/ai-ajan.controller';
import { AracYurutucu } from '../src/ai/ajan/arac-yurutucu';
import { UcCagirici } from '../src/ai/ajan/uc-cagirici';
import { AJAN_ARACLARI } from '../src/ai/ajan/araclar';
import type { IAiProvider, AiAracliSohbetGirdisi } from '../src/ai/saglayici/ai-provider.interface';
import { veritabaniAdresiniDogrula } from '../scripts/ai-hazirlik-envanteri.lib.mjs';
import { AiBosYanitHatasi } from '../src/ai/saglayici/ai-bos-yanit';

const env = resolve(__dirname, '../.env');
if (existsSync(env)) process.loadEnvFile(env);
const db = new PrismaClient({ datasourceUrl: veritabaniAdresiniDogrula(process.env.DATABASE_URL) });
afterAll(async () => { await db.$disconnect(); });

/** Aynı senaryo kaynak koduyla veya yeni dist + üretim Next artefaktıyla çalışır. */
const artefakt = process.env.AI_FINANS_TEST_DIST === '1';
const requireDist = createRequire(import.meta.url);
const yukle = (yol: string) => requireDist(resolve(__dirname, '../dist', yol));
const runtime = artefakt ? {
  ...yukle('auth/auth.guard.js'), ...yukle('auth/roller.guard.js'), ...yukle('core/istek-baglami.js'),
  ...yukle('rapor/rapor.service.js'), ...yukle('rapor/rapor.controller.js'),
  ...yukle('ai/ajan/ai-ajan.service.js'), ...yukle('ai/ajan/ai-ajan.controller.js'),
  ...yukle('ai/ajan/arac-yurutucu.js'), ...yukle('ai/ajan/uc-cagirici.js'), ...yukle('ai/ajan/araclar/index.js'),
  ...yukle('ai/saglayici/ai-bos-yanit.js'),
} : { AuthGuard, RollerGuard, baglamAl, bosTutucuylaCalistir, RaporService, RaporController, AiAjanService, AiAjanController, AracYurutucu, UcCagirici, AJAN_ARACLARI, AiBosYanitHatasi };

async function bosPort() {
  const s = createServer();
  await new Promise<void>((r, j) => { s.once('error', j); s.listen(0, '127.0.0.1', r); });
  const port = (s.address() as { port: number }).port;
  await new Promise<void>(r => s.close(() => r()));
  return port;
}
async function bekle(url: string, process: ChildProcess) {
  for (let i = 0; i < 240; i++) {
    if (process.exitCode !== null) throw new Error('IZOLE_WEB_BASLATILAMADI');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* henüz açılmadı */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('IZOLE_WEB_ZAMAN_ASIMI');
}
async function kapat(p: ChildProcess) {
  if (p.exitCode !== null) return;
  p.kill('SIGTERM');
  await new Promise<void>((r, j) => {
    const timeout = setTimeout(() => j(new Error('IZOLE_WEB_KAPANMADI')), 15000);
    p.once('exit', () => { clearTimeout(timeout); r(); });
  });
}

it('HTTP JWT/rol + Chromium: aynı rapor, model hatasında kaynak kartı, geçmiş ve şirket ayrımı; test verileri rollback', async () => {
  const { AuthGuard, RollerGuard, baglamAl, bosTutucuylaCalistir, RaporService, RaporController, AiAjanService, AiAjanController, AracYurutucu, UcCagirici, AJAN_ARACLARI, AiBosYanitHatasi } = runtime;
  const webPort = await bosPort(), webUrl = `http://127.0.0.1:${webPort}`;
  const webCwd = resolve(__dirname, '../../web');
  const webDist = artefakt ? '.next-p0-02-release-20261014' : '.next-ai-http-e2e';
  if (artefakt && !existsSync(resolve(webCwd, webDist, 'BUILD_ID'))) throw new Error('URETIM_WEB_ARTEFAKTI_YOK');
  const web = spawn(process.execPath, [resolve(webCwd, 'node_modules/next/dist/bin/next'), artefakt ? 'start' : 'dev', '-H', '127.0.0.1', '-p', String(webPort)], {
    cwd: webCwd, env: { ...process.env, NEXT_DIST_DIR: webDist, NEXT_PUBLIC_API_URL: '/api/v1', NODE_ENV: artefakt ? 'production' : 'development' },
    stdio: 'ignore',
  });
  let browser: Browser | undefined;
  const a = randomUUID(), b = randomUUID(), rollback = new Error('yalnız izole test kayıtlarını geri al');
  let tamam = false;
  try {
    await bekle(`${webUrl}/giris`, web);
    await fetch(`${webUrl}/panel/raporlar/gelir-gider`);
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
    await db.$transaction(async tx => {
      const [rol] = await tx.$queryRaw<{ super: boolean; bypass: boolean }[]>`SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
      expect(rol).toEqual({ super: false, bypass: false });
      const kur = async (tenantId: string, satis: string) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await tx.tenant.create({ data: { id: tenantId, unvan: 'İzole HTTP tarayıcı test', vkn: tenantId } });
        const user = await tx.user.create({ data: { tenantId, eposta: `${tenantId}@test.local`, parolaHash: 'test', adSoyad: 'HTTP Test', rol: 'yonetici' } });
        const cari = await tx.cariHesap.create({ data: { tenantId, kod: 'C1', unvan: 'Test cari', tip: 'musteri' } });
        const stok = await tx.stokKart.create({ data: { tenantId, kod: 'H1', ad: 'Hizmet', tip: 'hizmet' } });
        for (const [tip, tutar] of [['satis', satis], ['alis', '300']] as const) await tx.fatura.create({ data: {
          tenantId, cariId: cari.id, tip, durum: 'kesin', tarih: new Date('2026-10-01T00:00:00Z'),
          toplamBrut: tutar, toplamMatrah: tutar, genelToplam: tutar, toplamSatirIskontosu: '0', genelIskontoToplam: '0', toplamKdv: '0', toplamTevkifat: '0', toplamNetKdv: '0',
          ...(tip === 'alis' ? { satirlar: { create: [{ tenantId, stokId: stok.id, miktar: '1', birimFiyat: '300', matrah: '300', toplamTutar: '300', kdvTutari: '0', netKdvTutari: '0' }] } } : {}),
        } });
        return user.id;
      };
      const userB = await kur(b, '999999'), userA = await kur(a, '100');
      const prisma = { tenantIslem: async (id: string, fn: (t: Prisma.TransactionClient) => Promise<unknown>) => {
        if (![a, b].includes(id)) throw new Error('TEST_KAPSAMI_DISI');
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true), set_config('app.user_id', ${baglamAl()?.userId ?? ''}, true)`;
        return fn(tx);
      } };
      let modelHatasi = false;
      let bosYanit = false, bosDeneme = 0, jsonDuzeltmeSayisi = 0;
      const provider = (): IAiProvider => {
        let tur = 0;
        return { saglayiciAdi: 'mock', modelAdi: 'izole-http-test',
          metinUret: async () => { throw new Error('KAPSAM_DISI'); },
          yapilandirilmisUretim: async (g, sema) => {
            jsonDuzeltmeSayisi++;
            const olgular = JSON.parse(g.prompt.slice(g.prompt.lastIndexOf('\n') + 1));
            expect(g.prompt).not.toContain('Raporunuzu aşağıda açıklıyorum');
            return sema.parse({ olguIdleri: [olgular.find((f: { ad: string }) => f.ad === 'Net kâr').id] });
          },
          aracliSohbet: async (g: AiAracliSohbetGirdisi) => {
            if (bosYanit) {
              bosDeneme++;
              throw new AiBosYanitHatasi('gemini', { bitisKodu: 'STOP', engellemeKodu: null, adaySayisi: 1, parcaSayisi: 0 });
            }
            if (tur++ === 0) return { metin: '', aracCagrilari: [{ id: randomUUID(), ad: 'gelir_gider', girdi: { baslangic: '2026-10-01', bitis: '2026-10-01' } }] };
            if (modelHatasi) throw new Error('sentetik-provider-hatasi');
            // JSON olmayan araçlı sohbet yanıtı tek yapılandırılmış çağrıyla
            // düzeltilmeli; ilk serbest metin kullanıcıya taşınmamalı.
            return { metin: 'Raporunuzu aşağıda açıklıyorum', aracCagrilari: [] };
          },
        };
      };
      Reflect.defineMetadata('design:paramtypes', [RaporService], RaporController);
      Reflect.defineMetadata('design:paramtypes', [AiAjanService], AiAjanController);
      class TestModule {}
      Module({ controllers: [RaporController, AiAjanController], providers: [
        Reflector, { provide: RaporService, useValue: new RaporService(prisma as never) },
        { provide: AiAjanService, inject: [ModuleRef, Reflector], useFactory: (ref: ModuleRef, reflector: Reflector) => {
          const uc = new UcCagirici(ref, reflector, prisma as never);
          const yurutucu = new AracYurutucu(uc, { olustur: async () => { throw new Error('YAZMA_KAPSAM_DISI'); } } as never);
          yurutucu.izinliAraclar = rol => AJAN_ARACLARI.filter(t => t.ad === 'gelir_gider' && t.sinif === 'okuma' && uc.yetkiliMi(t.uc, rol));
          const ajan = new AiAjanService(prisma as never, yurutucu);
          ajan.saglayiciBul = async () => ({ saglayici: provider(), ozelTalimatlar: null });
          return ajan;
        } },
      ] })(TestModule);
      const app = await NestFactory.create(TestModule, { logger: false });
      const jwt = new JwtService({ secret: randomUUID() });
      const reflector = app.get(Reflector);
      app.setGlobalPrefix('api/v1');
      app.use((_req: unknown, _res: unknown, next: () => void) => bosTutucuylaCalistir(next));
      app.useGlobalGuards(new AuthGuard(jwt, reflector), new RollerGuard(reflector));
      await app.listen(0, '127.0.0.1');
      const apiUrl = await app.getUrl();
      const token = jwt.sign({ sub: userA, tenantId: a, rol: 'yonetici' });
      const istek = (yol: string, jeton = token) => fetch(`${apiUrl}/api/v1${yol}`, { headers: jeton ? { Authorization: `Bearer ${jeton}` } : {} });
      try {
        expect((await istek('/rapor/gelir-gider', '')).status).toBe(401);
        expect((await istek('/rapor/gelir-gider', 'bozuk')).status).toBe(401);
        expect((await istek('/rapor/gelir-gider', jwt.sign({ sub: userA, tenantId: a, rol: 'depo' }))).status).toBe(403);
        const rapor = await istek('/rapor/gelir-gider?baslangic=2026-10-01&bitis=2026-10-01');
        expect(rapor.status).toBe(200);
        const sonuc = await rapor.json();
        expect(sonuc.karZarar.netKar).toBe(-200);
        expect((await (await istek('/rapor/gelir-gider?baslangic=2026-10-01&bitis=2026-10-01', jwt.sign({ sub: userB, tenantId: b, rol: 'yonetici' }))).json()).karZarar.netKar).toBe(999699);
        const page = await browser!.newPage();
        await page.addInitScript(t => sessionStorage.setItem('tekir_access', t), token);
        // Bu allowlist dışında hiçbir tarayıcı isteği canlı API'ye ulaşamaz.
        await page.route('**/api/v1/**', async route => {
          const u = new URL(route.request().url()), yol = u.pathname.replace('/api/v1', '');
          if (yol.startsWith('/rapor/') || yol.startsWith('/ai/ajan/')) {
            const yanit = await route.fetch({ url: `${apiUrl}${u.pathname}${u.search}` });
            await route.fulfill({ response: yanit });
          } else if (yol === '/auth/ben') await route.fulfill({ json: { userId: userA, tenantId: a, rol: 'yonetici', adSoyad: 'HTTP Test' } });
          else if (yol === '/ai/onay-talepleri') await route.fulfill({ json: [] });
          else if (yol === '/bildirimler/ozet') await route.fulfill({ json: { okunmamis: 0 } });
          else if (yol === '/bildirimler') await route.fulfill({ json: { kayitlar: [] } });
          else if (yol === '/ebelge/uygulamalar') await route.fulfill({ json: { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } } });
          else await route.fulfill({ status: 404, json: { mesaj: 'TEST_KAPSAMI_DISI' } });
        });
        await page.goto(`${webUrl}/panel/raporlar/gelir-gider?baslangic=2026-10-01&bitis=2026-10-01`);
        await page.locator('h2').filter({ hasText: '-200,00' }).waitFor();
        await page.getByRole('button', { name: 'Asistan', exact: true }).first().click();
        await page.getByRole('textbox', { name: 'Asistana mesaj' }).fill('Bu dönemin net kârını göster');
        const cevapPromise = page.waitForResponse(r => r.url().includes('/ai/ajan/mesaj') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Gönder', exact: true }).click();
        const cevap = await (await cevapPromise).json();
        expect(cevap.finansAciklama.durum).toBe('dogrulandi');
        expect(cevap.finansAciklama.duzeltmeDurumu).toBe('dogrulandi');
        expect(jsonDuzeltmeSayisi).toBe(1);
        expect(cevap.kaynaklar[0].kalemler.find((k: { ad: string }) => k.ad === 'Net kâr').deger).toBe(String(sonuc.karZarar.netKar));
        expect(cevap.kaynaklar[0].kalemler.find((k: { ad: string }) => k.ad === 'Diğer gelirler').deger).toBe(String(sonuc.karZarar.digerGelirler));
        await page.getByText('Kaynak verileri (1)', { exact: true }).click();
        expect(await page.locator('details[open]').innerText()).toContain('-200,00 TRY');
        expect(await page.locator('details[open]').innerText()).toContain('Diğer gelirler: 0,00 TRY');
        expect(await page.locator('details[open] a').getAttribute('href')).toContain('baslangic=2026-10-01&bitis=2026-10-01');
        modelHatasi = true;
        await page.getByRole('textbox', { name: 'Asistana mesaj' }).fill('Tekrar göster');
        const hataPromise = page.waitForResponse(r => r.url().includes('/ai/ajan/mesaj') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Gönder', exact: true }).click();
        const hata = await (await hataPromise).json();
        expect(hata.finansAciklama.neden).toBe('model_hatasi');
        await page.getByText('AI açıklaması doğrulanamadı; doğrulanmış kaynak özeti gösteriliyor.', { exact: false }).waitFor();
        await page.locator('details').filter({ has: page.getByText('Kaynak verileri (1)', { exact: true }) }).last().locator('summary').click();
        expect(await page.locator('details[open]').last().innerText()).toContain('-200,00 TRY');
        await page.reload();
        await page.getByRole('button', { name: 'Asistan', exact: true }).first().click();
        await page.getByText('AI açıklaması doğrulanamadı; doğrulanmış kaynak özeti gösteriliyor.', { exact: false }).waitFor();
        expect(await page.getByText('Kaynak verileri (1)', { exact: true }).count()).toBe(2);
        bosYanit = true;
        await page.getByRole('textbox', { name: 'Asistana mesaj' }).fill('Merhaba');
        const bosPromise = page.waitForResponse(r => r.url().includes('/ai/ajan/mesaj') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Gönder', exact: true }).click();
        const bosHttp = await bosPromise;
        expect(bosHttp.status()).toBe(503);
        expect((await bosHttp.json()).hataKodu).toBe('AI_BOS_YANIT_STOP');
        expect(bosDeneme).toBe(3);
        await page.getByText('Gemini kullanılabilir yanıt üretmedi. Tanı kodu: AI_BOS_YANIT_STOP.', { exact: true }).waitFor();
        expect(await page.getByText('Kaynak verileri (1)', { exact: true }).count()).toBe(2);
        await page.close();
      } finally { await app.close(); }
      tamam = true;
      throw rollback;
    }, { timeout: 240000 });
  } catch (h) { if (h !== rollback) throw h; }
  finally { await browser?.close(); await kapat(web); }
  expect(tamam).toBe(true);
  for (const id of [a, b]) await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    expect(await tx.tenant.findUnique({ where: { id } })).toBeNull();
  });
}, 300000);
