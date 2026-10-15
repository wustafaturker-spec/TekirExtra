import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, expect, it, vi } from 'vitest';
import { AiAjanService } from '../src/ai/ajan/ai-ajan.service';
import { SenaryoAiProvider } from '../src/ai/saglayici/mock-ai.provider';
import { istekBaglami } from '../src/core/istek-baglami';
import { veritabaniAdresiniDogrula } from '../scripts/ai-hazirlik-envanteri.lib.mjs';

const env = resolve(__dirname, '../.env');
if (existsSync(env)) process.loadEnvFile(env);
const db = new PrismaClient({ datasourceUrl: veritabaniAdresiniDogrula(process.env.DATABASE_URL) });
afterAll(async () => { await db.$disconnect(); });

it('yanıtsız rezervasyonlar model geçmişine girmez; eski mesajlar, kayıtlar ve tekrar koruması korunur', async () => {
  const tenantId = randomUUID(), rollback = new Error('izole test kayıtlarını geri al');
  let tamam = false;
  try {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.tenant.create({ data: { id: tenantId, unvan: 'İzole geçmiş testi', vkn: tenantId } });
      const user = await tx.user.create({ data: { tenantId, eposta: `${tenantId}@test.local`, parolaHash: 'test', adSoyad: 'Test', rol: 'yonetici' } });
      const oturum = await tx.ajanOturumu.create({ data: { tenantId, userId: user.id, kanal: 'WEB', kanalKimlik: randomUUID() } });
      const eskiYanit = { oturumId: oturum.id, cevap: 'Tamamlanan yanıt', onayTalepleri: [], araclar: [] };
      const tamamlananId = randomUUID(), bekleyenId = randomUUID();
      const tarih = (s: number) => new Date(Date.UTC(2026, 9, 14, 10, 0, s));
      await tx.ajanMesajGecmisi.createMany({ data: [
        { oturumId: oturum.id, rol: 'user', icerik: 'Eski kullanıcı mesajı', createdAt: tarih(0) },
        { oturumId: oturum.id, rol: 'assistant', icerik: 'Eski asistan mesajı', createdAt: tarih(1) },
        { oturumId: oturum.id, rol: 'user', requestId: tamamlananId, icerik: 'Tamamlanan talep', yanit: eskiYanit, createdAt: tarih(2) },
        { oturumId: oturum.id, rol: 'assistant', icerik: eskiYanit.cevap, createdAt: tarih(3) },
        // Son 24 satırın tamamı başarısız/bekleyen istek olabilir. Filtre
        // LIMIT'ten önce uygulanmalı; SQL NULL ve JSON null dışlanmalı.
        ...Array.from({ length: 30 }, (_, i) => ({
          oturumId: oturum.id, rol: 'user', requestId: i === 0 ? bekleyenId : randomUUID(),
          icerik: `Yanıtsız talep ${i}`, createdAt: tarih(4 + i),
          ...(i % 2 ? { yanit: Prisma.JsonNull } : {}),
        })),
      ] });
      const prisma = { tenantIslem: async <T>(id: string, fn: (t: Prisma.TransactionClient) => Promise<T>) => {
        if (id !== tenantId) throw new Error('TEST_KAPSAMI_DISI');
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
        return fn(tx);
      } };
      const provider = new SenaryoAiProvider([{ metin: 'Merhaba, nasıl yardımcı olabilirim?', aracCagrilari: [] }]);
      const izinliAraclar = vi.fn().mockReturnValue([]);
      const service = new AiAjanService(prisma as never, { izinliAraclar } as never);
      service.saglayiciBul = async () => ({ saglayici: provider, ozelTalimatlar: null });
      const calistir = (mesaj: string, id: string) => istekBaglami.run({ deger: { tenantId, userId: user.id, rol: 'yonetici' } }, () => service.mesajiIsle(mesaj, id));

      await expect(calistir('Tekrar', bekleyenId)).rejects.toThrow(/halen işleniyor/);
      expect(provider.girdiler).toHaveLength(0);
      expect(await calistir('Tekrar', tamamlananId)).toEqual(eskiYanit);
      expect(provider.girdiler).toHaveLength(0);
      await calistir('Merhaba', randomUUID());
      expect(provider.girdiler[0].mesajlar).toEqual([
        { rol: 'kullanici', metin: 'Eski kullanıcı mesajı' },
        { rol: 'asistan', metin: 'Eski asistan mesajı' },
        { rol: 'kullanici', metin: 'Tamamlanan talep' },
        { rol: 'asistan', metin: eskiYanit.cevap },
        { rol: 'kullanici', metin: 'Merhaba' },
      ]);
      // Filtre yalnız model bağlamını etkiler; kayıt ve idempotency silinmez.
      expect(await tx.ajanMesajGecmisi.count({ where: { oturumId: oturum.id, icerik: { startsWith: 'Yanıtsız talep' } } })).toBe(30);
      await expect(calistir('Tekrar', bekleyenId)).rejects.toThrow(/halen işleniyor/);
      expect(provider.girdiler).toHaveLength(1);
      tamam = true;
      throw rollback;
    }, { timeout: 30_000 });
  } catch (hata) { if (hata !== rollback) throw hata; }
  expect(tamam).toBe(true);
  const kalan = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.tenant.count({ where: { id: tenantId } });
  });
  expect(kalan).toBe(0);
});
