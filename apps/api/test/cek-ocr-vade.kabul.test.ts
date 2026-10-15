import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, expect, it, vi } from "vitest";
import { AiService } from "../src/ai/ai.service";
import type { IAiProvider } from "../src/ai/saglayici/ai-provider.interface";
import { KasaBankaService } from "../src/kasa-banka/kasa-banka.service";
import { baglamAl, baglamlaCalistir } from "../src/core/istek-baglami";
const envDosyasi = resolve(__dirname, "../.env");
if (existsSync(envDosyasi)) process.loadEnvFile(envDosyasi);
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });
it("OCR önerisi kayıt oluşturmaz; vade analizi/liste PostgreSQL ve RLS ile tutarlıdır; test kayıtları rollback edilir", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T22:00:00Z"));
  const a = randomUUID(), b = randomUUID(), rollback = new Error("Çek OCR/vade rollback");
  let tamam = false;
  try {
    await db.$transaction(async (tx) => {
      const baglam = (id: string) => tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
      async function kur(tenantId: string, tutar: number) {
        await baglam(tenantId);
        await tx.tenant.create({ data: { id: tenantId, unvan: "Çek OCR/vade testi", vkn: tenantId } });
        const user = await tx.user.create({ data: { tenantId, eposta: `${tenantId}@test.local`, parolaHash: "test", adSoyad: "Test", rol: "yonetici" } });
        await tx.cekSenet.createMany({ data: [
          { tenantId, tur: "cek", portfoyNo: "BUGUN", borclu: "Test", tutar, tutarTry: tutar, vadeTarihi: new Date("2026-10-15") },
          { tenantId, tur: "cek", portfoyNo: "KAPALI", borclu: "Test", tutar: 999, tutarTry: 999, vadeTarihi: new Date("2026-10-15"), durum: "tahsil_edildi" },
          { tenantId, tur: "senet", portfoyNo: "USD", borclu: "Test", tutar: 50, tutarTry: 2000, dovizCinsi: "USD", vadeTarihi: new Date("2026-10-15") },
          { tenantId, tur: "cek", portfoyNo: "VERILEN", yon: "verilen", durum: "verildi", borclu: "Test", tutar: 75, tutarTry: 75, vadeTarihi: new Date("2026-10-16") },
          { tenantId, tur: "senet", portfoyNo: "GECIKEN", borclu: "Test", tutar: 25, tutarTry: 25, vadeTarihi: new Date("2026-10-14") },
        ] });
        return user.id;
      }
      const userB = await kur(b, 99999), userA = await kur(a, 100);
      const prisma = { tenantIslem: async (tenantId: string, fn: (islem: Prisma.TransactionClient) => Promise<unknown>) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${baglamAl()?.userId ?? ""}, true)`;
        return fn(tx);
      } };
      const kasa = Object.assign(Object.create(KasaBankaService.prototype), { prisma }) as KasaBankaService;
      const calistir = <T>(tenantId: string, userId: string, is: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, is);
      const analiz = await calistir(a, userA, () => kasa.cekSenetVadeAnalizi());
      expect(analiz.bugun).toBe("2026-10-15");
      expect(analiz.gruplar[1].alinan.dovizler).toEqual([{ doviz: "TRY", tutar: "100.00", adet: 1 }, { doviz: "USD", tutar: "50.00", adet: 1 }]);
      expect(analiz.gruplar[2].verilen.dovizler[0].tutar).toBe("75.00");
      const liste = await calistir(a, userA, () => kasa.cekSenetListele(undefined, undefined, "alinan", undefined, "2026-10-15", "2026-10-15", true));
      expect(liste).toHaveLength(analiz.gruplar[1].alinan.adet);
      expect(liste.map((k) => k.portfoyNo).sort()).toEqual(["BUGUN", "USD"]);
      const ozet = await calistir(a, userA, () => kasa.cekSenetOzet("alinan"));
      expect(ozet.geciken.adet).toBe(1);
      expect((await calistir(b, userB, () => kasa.cekSenetVadeAnalizi())).gruplar[1].alinan.dovizler[0].tutar).toBe("99999.00");
      const ai = new AiService(prisma as never);
      const provider = { saglayiciAdi: "ollama", modelAdi: "sentetik-test", yapilandirilmisUretim: async () => ({
        belgeTuru: "CEK", cekNo: "00123", banka: "Test", sube: null, hesapNo: "000123", borclu: "Test",
        kesideYeri: null, tarih: "2026-12-31", tutar: "100.01", paraBirimi: "TRY", yaziylaTutar: null,
        yaziylaTutarSayisal: null, guvenSkoru: 0.9, belirsizAlanlar: [],
      }) };
      vi.spyOn(ai as unknown as { getProviderForTenant: (id: string) => Promise<IAiProvider> }, "getProviderForTenant").mockResolvedValue(provider as unknown as IAiProvider);
      const sayi = await calistir(a, userA, () => prisma.tenantIslem(a, (islem) => islem.cekSenet.count()));
      const okuma = await calistir(a, userA, () => ai.cekOcrTara(a, { mimeType: "image/png", gorselBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }));
      expect(okuma.veri.cekNo).toBe("00123");
      expect(await tx.cekSenet.count()).toBe(sayi);
      expect(await tx.aiOcrDenetim.findFirst({ where: { tenantId: a } })).toMatchObject({ userId: userA, durum: "basarili", saglayici: "ollama" });
      await baglam(b); expect(await tx.aiOcrDenetim.findMany({ where: { tenantId: a } })).toEqual([]);
      tamam = true; throw rollback;
    }, { timeout: 30000 });
  } catch (h) { if (h !== rollback) throw h; }
  expect(tamam).toBe(true);
  for (const tenantId of [a, b]) await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    expect(await tx.tenant.findUnique({ where: { id: tenantId } })).toBeNull();
  });
});
