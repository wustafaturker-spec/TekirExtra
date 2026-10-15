import "../src/ayar-tanimlari";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, expect, it, vi } from "vitest";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { BildirimUreticiService } from "../src/bildirimler/bildirim-uretici.service";
import type { BildirimGirdisi } from "../src/bildirimler/bildirim.service";
const envDosyasi = resolve(__dirname, "../.env");
if (existsSync(envDosyasi)) process.loadEnvFile(envDosyasi);
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); });

it("şirket hatırlatma ayarı PostgreSQL'de saklanır ve diğer tenant'a taşınmaz; yalnız test verileri rollback edilir", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
  const a = randomUUID(), b = randomUUID(), userId = randomUUID(), rollback = new Error("Hatırlatma testi rollback");
  let tamam = false;
  try {
    await db.$transaction(async (tx) => {
      const baglam = (tenantId: string) => tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      for (const tenantId of [a, b]) {
        await baglam(tenantId);
        await tx.tenant.create({ data: { id: tenantId, unvan: "Çek hatırlatma testi", vkn: tenantId } });
        await tx.cekSenet.createMany({ data: [
          { tenantId, tur: "cek", portfoyNo: "ONCE", borclu: "Test", tutar: 100, tutarTry: 100, vadeTarihi: new Date("2026-10-17") },
          { tenantId, tur: "senet", portfoyNo: "BUGUN", borclu: "Test", tutar: 100, tutarTry: 100, vadeTarihi: new Date("2026-10-14") },
          { tenantId, tur: "cek", portfoyNo: "GECIKMIS", borclu: "Test", tutar: 100, tutarTry: 100, vadeTarihi: new Date("2026-10-13") },
          { tenantId, tur: "cek", portfoyNo: "TAHSIL", borclu: "Test", tutar: 100, tutarTry: 100, vadeTarihi: new Date("2026-10-14"), durum: "tahsil_edildi" },
        ] });
      }
      const prisma = { tenantIslem: async (tenantId: string, fn: (islem: Prisma.TransactionClient) => Promise<unknown>) => { await baglam(tenantId); return fn(tx); } };
      const ayarlar = new AyarlarService(prisma as never);
      const uretici = Object.assign(Object.create(BildirimUreticiService.prototype), {
        prisma, ayarlar, rapor: { vadesiGecenler: async () => ({ alacakSayisi: 0, borcSayisi: 0 }) },
        kartEkstreUyarilari: async () => [], krediTaksitUyarilari: async () => [], teminatSureUyarilari: async () => [],
        mutabakatItirazlari: async () => [], ihracKayitliOzetleri: async () => [], irsaliyeFaturaOzetleri: async () => [],
      }) as { vadeOzetleri: () => Promise<BildirimGirdisi[]> };
      const calistir = <T>(tenantId: string, is: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, is);
      await calistir(a, () => ayarlar.guncelle("kasaBanka", { cekSenetHatirlatmaGun: 3, cekSenetVadeGunuHatirlat: false }));
      expect(await calistir(a, () => ayarlar.getir("kasaBanka"))).toMatchObject({ cekSenetHatirlatmaGun: 3, cekSenetVadeGunuHatirlat: false });
      expect(await calistir(b, () => ayarlar.getir("kasaBanka"))).toMatchObject({ cekSenetHatirlatmaGun: 7, cekSenetVadeGunuHatirlat: true });
      const bildirimA = await calistir(a, () => uretici.vadeOzetleri());
      expect(bildirimA.map((g) => g.birlesimAnahtari)).toEqual(["cek_senet:2026-10-14:once:3", "cek_senet:2026-10-14:geciken"]);
      expect(bildirimA[0].aciklama).toBe("1 evrakın vadesine 3 gün kaldı.");
      const bildirimB = await calistir(b, () => uretici.vadeOzetleri());
      expect(bildirimB.map((g) => g.birlesimAnahtari)).toEqual(["cek_senet:2026-10-14:bugun", "cek_senet:2026-10-14:geciken"]);
      expect(bildirimB[0].aciklama).toBe("1 evrakın vade günü bugün.");
      tamam = true; throw rollback;
    }, { timeout: 30000 });
  } catch (h) { if (h !== rollback) throw h; }
  expect(tamam).toBe(true);
});
