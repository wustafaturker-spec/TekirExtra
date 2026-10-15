import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PROFILLER, profilSorgusunuKur, saltOkunurIslem, veritabaniAdresiniDogrula } from '../scripts/ai-hazirlik-envanteri.lib.mjs';
import { metadataOku } from '../scripts/ai-hazirlik-envanteri.mjs';

const env = resolve(__dirname, '../.env');
if (existsSync(env)) process.loadEnvFile(env);
const db = new PrismaClient({ datasourceUrl: veritabaniAdresiniDogrula(process.env.DATABASE_URL) });
const katalog = new PrismaClient({ datasourceUrl: veritabaniAdresiniDogrula(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL) });
afterAll(async () => { await db.$disconnect(); await katalog.$disconnect(); });

describe('P0-01 gerçek PostgreSQL — ticari kayıt taramadan', () => {
  it('katalog geçiş/RLS/FK denetimi başarılıdır', async () => {
    const rapor = await metadataOku(katalog);
    expect(rapor.veritabani).toBe('tekirextra');
    expect(Number(rapor.migration.tamamlanan)).toBeGreaterThan(0);
    expect(rapor.migration.tamamlanmamis).toBe('0');
    expect(rapor.tenantTabloSayisi).toBeGreaterThan(50);
    expect(rapor.rlsEksikleri).toEqual([]);
    expect(rapor.dogrulanmamis_fk).toBe('0');
  });

  it('21 profil boş rastgele bağlamda çalışır; başka şirket kayıtları gelmez', async () => {
    const tenantId = randomUUID();
    await saltOkunurIslem(db, tenantId, async (tx) => {
      const [rol] = await tx.$queryRawUnsafe('SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user');
      expect(rol).toEqual({ rolsuper: false, rolbypassrls: false });
      expect(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })).toBeNull();
      for (const profil of PROFILLER) {
        const q = profilSorgusunuKur(profil, Prisma.dmmf.datamodel.models);
        const [row] = await tx.$queryRawUnsafe(q.sql, tenantId);
        expect(row.adet, profil.kod).toBe('0');
        if (q.grupSql) expect(await tx.$queryRawUnsafe(q.grupSql, tenantId), profil.kod).toEqual([]);
      }
    });
  });

  it('yazma komutu hiçbir satıra dokunmasa da READ ONLY tarafından reddedilir', async () => {
    await expect(saltOkunurIslem(db, randomUUID(), (tx) =>
      tx.$executeRawUnsafe('DELETE FROM public.stok_kartlari WHERE FALSE'),
    )).rejects.toMatchObject({ code: 'P2010', meta: { code: '25006' } });
  });
});
