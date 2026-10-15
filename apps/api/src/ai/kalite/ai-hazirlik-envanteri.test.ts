import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  argumanlariCoz, veritabaniAdresiniDogrula, PROFILLER, profilSorgusunuKur,
  profiliDegerlendir, saltOkunurIslem, platformOzetiniCikar, rlsEksikleriniBul,
} from '../../../scripts/ai-hazirlik-envanteri.lib.mjs';
import { tenantOku } from '../../../scripts/ai-hazirlik-envanteri.mjs';

const tenantId = '00000000-0000-4000-8000-000000000001';
const modeller = Prisma.dmmf.datamodel.models;

describe('P0-01 salt okunur hazırlık envanteri', () => {
  it('şirket seçimi veya metadata seçimi olmadan çalışmaz', () => {
    expect(argumanlariCoz(['--metadata-only'])).toEqual({ mod: 'metadata' });
    expect(argumanlariCoz(['--tenant-id', tenantId])).toEqual({ mod: 'tenant', tenantId });
    for (const args of [[], ['--all'], ['--tenant-id', 'x'], ['--metadata-only', '--tenant-id', tenantId]]) {
      expect(() => argumanlariCoz(args)).toThrow('KAPSAM_GECERSIZ');
    }
  });

  it('yalnız tekirextra hedefini kabul eder', () => {
    expect(veritabaniAdresiniDogrula('postgresql://localhost:5433/tekirextra')).toContain('/tekirextra');
    for (const url of ['postgresql://localhost/other', 'https://localhost/tekirextra', 'postgresql://localhost/tekirextra_backup']) {
      expect(() => veritabaniAdresiniDogrula(url)).toThrow('VERITABANI_KAPSAMI_GECERSIZ');
    }
  });

  it('21 profilin alanları mevcut şemaya eşleşir ve tenant parametreli kalır', () => {
    expect(PROFILLER).toHaveLength(21);
    expect(new Set(PROFILLER.map((p) => p.kod)).size).toBe(21);
    for (const p of PROFILLER) {
      const q = profilSorgusunuKur(p, modeller);
      expect(q.eksikAlanlar, p.kod).toEqual([]);
      expect(q.sql).toContain('t."tenant_id" = $1::uuid');
      expect(q.sql).not.toContain(tenantId);
      expect(q.sql).not.toMatch(/SELECT\s+t\.\*|SELECT\s+\*/i);
      if (q.grupSql) expect(q.grupSql).toContain('t."tenant_id" = $1::uuid');
    }
  });

  it('satır-fatura birleşiminde iki taraf da aynı şirkettedir', () => {
    const q = profilSorgusunuKur(PROFILLER.find((p) => p.kod === 'kesin-alis-satir'), modeller);
    expect(q.sql).toContain('p."tenant_id" = t."tenant_id"');
    expect(q.sql).toContain("p.\"tip\" = 'alis'");
    expect(q.sql).toContain("p.\"durum\" = 'kesin'");
  });

  it('READ ONLY ve bağlam iş sorgularından önce kurulur', async () => {
    const sira: string[] = [];
    const tx = {
      $executeRawUnsafe: vi.fn(async (sql) => { sira.push(sql); }),
      $queryRawUnsafe: vi.fn(async (sql, id) => { sira.push(sql); expect(id).toBe(tenantId); }),
    };
    const db = { $transaction: vi.fn(async (fn) => fn(tx)) };
    await saltOkunurIslem(db, tenantId, async () => { sira.push('iş sorgusu'); });
    expect(sira).toEqual(['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '10s'", "SELECT set_config('app.tenant_id', $1, true)", 'iş sorgusu']);
  });

  it.each([{ rolsuper: true, rolbypassrls: false }, { rolsuper: false, rolbypassrls: true }])('RLS atlayan rolle ticari okuma yapmaz: %j', async (rol) => {
    const findUnique = vi.fn();
    const tx = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn(async () => [rol]), tenant: { findUnique } };
    const db = { $transaction: vi.fn(async (fn) => fn(tx)) };
    await expect(tenantOku(db, tenantId, modeller)).rejects.toThrow('UYGULAMA_ROLU_GEREKLI');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('kayıt sayısı model doğruluğu veya üretim kabulü sayılmaz', () => {
    const p = PROFILLER[0];
    expect(profiliDegerlendir(p, { adet: '0' }, [])).toBe('veri_yok');
    expect(profiliDegerlendir(p, { adet: '1', eksik_anaBirim: '1' }, [])).toBe('veri_tamamlama_gerekli');
    expect(profiliDegerlendir(p, { adet: '10000' }, [])).toBe('kural_tabanli_pilot_adayi_uzman_kontrolu_gerekli');
    expect(profiliDegerlendir(p, { adet: '10' }, ['alan'])).toBe('sema_eslemesi_incelenmeli');
  });

  it('platform raporu anahtar/adres değerlerini içermez', () => {
    const result = platformOzetiniCikar({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-secret', OLLAMA_BASE_URL: 'http://private-host' });
    expect(result.openaiAnahtariVar).toBe(true);
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(JSON.stringify(result)).not.toContain('private-host');
    expect(result.canliCagri).toBe('yapilmadi');
    expect(JSON.stringify(platformOzetiniCikar({ AI_PROVIDER: 'test-secret' }))).not.toContain('test-secret');
  });

  it('şirket AI ayarında anahtar, adres ve serbest metin seçmez', async () => {
    const aiOku = vi.fn(async () => null);
    const tx = {
      $executeRawUnsafe: vi.fn(),
      $queryRawUnsafe: vi.fn(async (sql, id) => {
        if (sql.includes('pg_roles')) return [{ rolsuper: false, rolbypassrls: false }];
        expect(id).toBe(tenantId);
        if (sql.includes('count(*)::text AS adet')) return [{ adet: '0' }];
        return [];
      }),
      tenant: { findUnique: vi.fn(async () => ({ id: tenantId })) },
      tenantAiAyari: { findUnique: aiOku },
    };
    const db = { $transaction: vi.fn(async (fn) => fn(tx)) };
    const rapor = await tenantOku(db, tenantId, modeller);
    expect(rapor.profiller).toHaveLength(21);
    const secim = aiOku.mock.calls[0][0];
    expect(secim.where).toEqual({ tenantId });
    expect(Object.keys(secim.select).sort()).toEqual([
      'saglayici', 'modelAdi', 'ekonomikModelAdi', 'gucluModelAdi', 'ozelliklerEtkin',
      'yurtDisiOnayAt', 'yurtDisiOnaySaglayici', 'yurtDisiOnayModel', 'yurtDisiOnayPolitika',
      'gunlukCagriSiniri', 'aylikMaliyetButcesiUsd',
    ].sort());
  });

  it('RLS, FORCE veya politika eksiklikleri gizlenmez', () => {
    const row = { tablo: 'stok_kartlari', rls: true, force: true, politika: '1' };
    expect(rlsEksikleriniBul([row])).toEqual([]);
    for (const broken of [{ ...row, rls: false }, { ...row, force: false }, { ...row, politika: '0' }]) {
      expect(rlsEksikleriniBul([broken])).toEqual([broken]);
    }
    expect(rlsEksikleriniBul([{ ...row, tablo: 'auth_kimlikler', rls: false }])).toEqual([]);
  });
});
