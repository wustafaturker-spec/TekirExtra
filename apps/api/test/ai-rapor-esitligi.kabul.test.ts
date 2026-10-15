import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { baglamAl, baglamlaCalistir } from '../src/core/istek-baglami';
import { RaporController } from '../src/rapor/rapor.controller';
import { RaporService } from '../src/rapor/rapor.service';
import { RaporlarController } from '../src/core/raporlar/raporlar.controller';
import { RaporlarService } from '../src/core/raporlar/raporlar.service';
import { UcCagirici } from '../src/ai/ajan/uc-cagirici';
import { aracBul } from '../src/ai/ajan/araclar';
import { finansKaynaklariCikar } from '../src/ai/ajan/finans-kaynaklari';
import { finansAciklamasiniDogrula, finansOlgulari } from '../src/ai/ajan/finans-aciklama';
import { veritabaniAdresiniDogrula } from '../scripts/ai-hazirlik-envanteri.lib.mjs';
import '../src/fatura/fatura.raporlar';

// Yalnız aracın "bugün" sınırı sabitlenir; gerçek Date constructor korunur.
// Fake Date kullanımı yerel saat dilimi hatasını maskeleyebilir.
vi.mock('../src/ai/ajan/araclar/arac', async importOriginal => ({
  ...await importOriginal<typeof import('../src/ai/ajan/araclar/arac')>(), BUGUN: () => '2026-10-14',
}));

const env = resolve(__dirname, '../.env');
if (existsSync(env)) process.loadEnvFile(env);
const db = new PrismaClient({ datasourceUrl: veritabaniAdresiniDogrula(process.env.DATABASE_URL) });
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });

async function senaryo(test: (s: any) => Promise<void>) {
  const a = randomUUID(), b = randomUUID(), rollback = new Error('yalnız kendi test kayıtlarını rollback et');
  let tamam = false;
  try {
    await db.$transaction(async tx => {
      const [rol] = await tx.$queryRaw<{ super: boolean; bypass: boolean }[]>`SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
      expect(rol).toEqual({ super: false, bypass: false });
      const context = async (id: string) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`; };
      const kur = async (id: string) => {
        await context(id);
        await tx.tenant.create({ data: { id, unvan: 'AI rapor eşitliği test', vkn: id } });
        const user = await tx.user.create({ data: { tenantId: id, eposta: `${id}@test.local`, parolaHash: 'test', adSoyad: 'Test', rol: 'yonetici' } });
        const cari = await tx.cariHesap.create({ data: { tenantId: id, kod: 'C1', unvan: 'Test cari', tip: 'musteri' } });
        const stok = await tx.stokKart.create({ data: { tenantId: id, kod: 'H1', ad: 'Test hizmet', tip: 'hizmet' } });
        return { userId: user.id, cariId: cari.id, stokId: stok.id };
      };
      const B = await kur(b), A = await kur(a);
      const fatura = async (id: string, cariId: string, tip: Prisma.FaturaCreateInput['tip'], matrah: string, tarih: string, ek: any = {}) => {
        await context(id);
        return tx.fatura.create({ data: { tenantId: id, cariId, tip, durum: 'kesin', tarih: new Date(tarih),
          toplamMatrah: matrah, genelToplam: matrah, toplamBrut: matrah,
          toplamSatirIskontosu: '0', genelIskontoToplam: '0', toplamKdv: '0', toplamTevkifat: '0', toplamNetKdv: '0', ...ek } });
      };
      await fatura(b, B.cariId, 'satis', '999999', '2026-10-01T00:00:00Z');
      await fatura(a, A.cariId, 'satis', '100', '2026-10-01T00:00:00Z');
      await fatura(a, A.cariId, 'satis', '50', '2026-10-14T23:59:59.999Z', { dovizCinsi: 'USD', kur: '40' });
      await fatura(a, A.cariId, 'satis_iade', '50', '2026-10-14T00:00:00Z');
      await fatura(a, A.cariId, 'satis', '700', '2026-10-15T00:00:00Z');
      await fatura(a, A.cariId, 'satis', '10000', '2026-09-30T23:59:59.999Z');
      for (const durum of ['taslak', 'iptal']) await fatura(a, A.cariId, 'satis', '99999', '2026-10-01T00:00:00Z', { durum });
      await fatura(a, A.cariId, 'alis', '300', '2026-10-01T00:00:00Z', { satirlar: { create: [
        { tenantId: a, stokId: A.stokId, miktar: '1', birimFiyat: '300', matrah: '300', toplamTutar: '300', kdvOrani: '0', kdvTutari: '0', netKdvTutari: '0' },
      ] } });
      const prisma = { tenantIslem: async (id: string, fn: (t: Prisma.TransactionClient) => Promise<unknown>) => {
        if (![a, b].includes(id)) throw new Error('TEST_KAPSAMI_DISI');
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true), set_config('app.user_id', ${baglamAl()?.userId ?? ''}, true)`;
        return fn(tx);
      } };
      const ekran = new RaporController(new RaporService(prisma as never));
      const katalog = new RaporlarController(new RaporlarService(prisma as never, {} as never));
      const controllers = new Map<unknown, unknown>([[RaporController, ekran], [RaporlarController, katalog]]);
      const uc = new UcCagirici({ get: (c: unknown) => { if (!controllers.has(c)) throw new Error('UC_KAPSAMI_DISI'); return controllers.get(c); } } as never, new Reflector(), prisma as never);
      const calistir = <T>(is: () => Promise<T>, tenant = a, role = 'yonetici') => baglamlaCalistir({ tenantId: tenant, userId: tenant === a ? A.userId : B.userId, rol: role as never }, is);
      const arac = async (ad: string, girdi: unknown) => {
        const t = aracBul(ad)!;
        return t.calistir({ uc, kaynak: 'asistan', arac: ad }, t.girdi.parse(girdi)) as Promise<any>;
      };
      await test({ tx, a, b, A, ekran, katalog, calistir, arac, fatura });
      tamam = true;
      throw rollback;
    }, { timeout: 60000 });
  } catch (h) { if (h !== rollback) throw h; }
  expect(tamam).toBe(true);
  for (const id of [a, b]) await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    expect(await tx.tenant.findUnique({ where: { id } })).toBeNull();
  });
}

describe('AI / ekran controller rapor eşitliği — gerçek PostgreSQL, RLS, rollback', () => {
  it('gelir gider aynı etkin dönemde eşittir; iade, kur, gün sonu, iptal ve ileri tarih ayrılır', async () => senaryo(async s => {
    await s.calistir(async () => {
      const ai = await s.arac('gelir_gider', { baslangic: '2026-10-01', bitis: '2026-10-31' });
      const ekran = await s.ekran.gelirGiderRaporu('2026-10-01', '2026-10-14');
      expect(ai.karZarar).toEqual(ekran.karZarar);
      expect(ai.ozet).toEqual(ekran.ozet);
      expect(ai.karZarar).toMatchObject({ netSatis: 2050, hizmetAlislari: 300, netKar: 1750 });
      expect(ai.donem).toEqual({ baslangic: '2026-10-01', bitis: '2026-10-14' });
      const link = new URL(ai.adres, 'https://tekir.invalid');
      expect((await s.ekran.gelirGiderRaporu(link.searchParams.get('baslangic'), link.searchParams.get('bitis'))).karZarar).toEqual(ai.karZarar);
      const ileri = await s.arac('gelir_gider', { baslangic: '2026-10-01', bitis: '2026-10-31', ileriTarihDahil: true });
      expect(ileri.karZarar).toEqual((await s.ekran.gelirGiderRaporu('2026-10-01', '2026-10-31')).karZarar);
      expect(ileri.karZarar.netKar).toBe(2450);
      const eksi = await s.arac('gelir_gider', { baslangic: '2026-10-01', bitis: '2026-10-01' });
      expect(eksi.karZarar.netKar).toBe(-200);
      const kaynak = finansKaynaklariCikar('gelir_gider', JSON.stringify(eksi));
      const olgu = finansOlgulari(kaynak).find(f => f.ad === 'Net kâr')!;
      expect(finansAciklamasiniDogrula(JSON.stringify({ olguIdleri: [olgu.id] }), kaynak).cevap).toContain('-200,00 TRY');
    });
    expect((await s.calistir(() => s.arac('gelir_gider', { baslangic: '2026-10-01', bitis: '2026-10-14' }), s.b)).karZarar.netSatis).toBe(999999);
  }));

  it('ilk 30 satır tam rapor toplamını değiştirmez; kaynak linkindeki filtre/gruplama eşittir', async () => senaryo(async s => {
    await s.calistir(async () => {
      for (let i = 0; i < 35; i++) {
        const c = await s.tx.cariHesap.create({ data: { tenantId: s.a, kod: `EK${i}`, unvan: `Ek cari ${i}`, tip: 'musteri' } });
        await s.fatura(s.a, c.id, 'satis', '1', '2026-10-02T00:00:00Z');
      }
      const filtreler = { baslangic: '2026-10-01', bitis: '2026-10-14' };
      const ekran = await s.katalog.calistir('fatura.donemsel-ozet', { filtreler, gruplama: 'cari' });
      const ai = await s.arac('rapor_calistir', { kod: 'fatura.donemsel-ozet', suzgecler: Object.entries(filtreler).map(([alan, deger]) => ({ alan, deger })), gruplama: 'cari' });
      expect(ai.satirlar).toHaveLength(30);
      expect(ai.satirSayisi).toBe(36);
      expect(ai.satirlar).toEqual(ekran.satirlar.slice(0, 30));
      expect(ai.toplamlar).toEqual(ekran.toplamlar);
      expect(ai.toplamlar.netSatis.deger).toBe(2085);
      const kaynak = finansKaynaklariCikar('rapor_calistir', JSON.stringify(ai));
      expect(kaynak[0].uyarilar.join(' ')).toContain('30 / 36');
      expect(kaynak[0].kalemler.find(k => k.ad === 'Net Satış (TL)')?.deger).toBe('2085');
      const link = new URL(ai.adres, 'https://tekir.invalid');
      const yeniden = await s.katalog.calistir(link.searchParams.get('rapor'), { filtreler: { baslangic: link.searchParams.get('f.baslangic'), bitis: link.searchParams.get('f.bitis') }, gruplama: link.searchParams.get('g') });
      expect(yeniden.toplamlar).toEqual(ai.toplamlar);
      const satis = await s.arac('rapor_calistir', { kod: 'fatura.donemsel-ozet', suzgecler: [
        ...Object.entries(filtreler).map(([alan, deger]) => ({ alan, deger })), { alan: 'tip', deger: 'satis' },
      ], gruplama: 'tip' });
      const satisEkran = await s.katalog.calistir('fatura.donemsel-ozet', { filtreler: { ...filtreler, tip: 'satis' }, gruplama: 'tip' });
      expect(satis.satirlar).toEqual(satisEkran.satirlar);
      expect(satis.satirSayisi).toBe(1);
      expect(satis.toplamlar).toBeNull();
      expect(satis.satirlar[0].netSatis).toBe('2135.00');
      const tek = finansKaynaklariCikar('rapor_calistir', JSON.stringify(satis));
      expect(tek[0].kalemler.find(k => k.ad === 'Net Satış (TL) (tek satır)')?.deger).toBe('2135.00');
    });
  }));

  it('finans özeti aynı controller hesabını kullanır; depo rolü mali rapora erişemez', async () => senaryo(async s => {
    await s.calistir(async () => {
      expect(await s.arac('finansal_ozet', {})).toEqual(await s.ekran.finansalOzet());
    });
    await expect(s.calistir(() => s.arac('finansal_ozet', {}), s.a, 'depo')).rejects.toThrow('yetkiniz yok');
    await expect(s.calistir(() => s.arac('rapor_calistir', { kod: 'fatura.kar-marji' }), s.a, 'depo')).rejects.toThrow('yetkiniz yok');
  }));
});
