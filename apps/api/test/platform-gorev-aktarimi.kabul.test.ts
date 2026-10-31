import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformGorevService } from "../src/mevzuat/platform-gorev.service";
import { PlatformKullanicilarService } from "../src/mevzuat/platform-kullanicilar.service";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * PLT-31: yönetici editöre düşürülürken açık platform görevleri gerçek
 * PostgreSQL'de, platform rolüyle aynı transaction'da aktarılır. Aktarım
 * olmadan rol değişmez; eşzamanlı atama yarışı sahipsiz görev bırakmaz.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
function platformAdresi(): string {
  if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;
  const u = new URL(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? "");
  u.username = "tekir_platform";
  u.password = "tekir_platform_dev";
  return u.toString();
}
const platform = new PrismaClient({ datasourceUrl: platformAdresi() });
const baglanti = { db: platform } as unknown as PlatformPrismaService;
const kullanicilar = new PlatformKullanicilarService(baglanti);
const gorevler = new PlatformGorevService(baglanti);

const iz = `plt31-${randomUUID().slice(0, 8)}`;
const acilanlar: string[] = [];
async function kisi(rol: "yonetici" | "mevzuat_editoru" = "yonetici") {
  const k = await yonetici.platformKullanici.create({ data: { eposta: `${iz}-${acilanlar.length}@ornek.invalid`, adSoyad: `${iz} ${acilanlar.length}`, parolaHash: "x", totpSecretSifreli: "x", rol } });
  acilanlar.push(k.id);
  return k.id;
}
const olarak = <T>(id: string, is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: id, eposta: "kabul@ornek.invalid", rol: "yonetici" }, is);
const gorev = (olusturan: string, sorumluId: string, durum: "acik" | "tamamlandi" = "acik") =>
  yonetici.platformGorev.create({ data: { baslik: `${iz} görev`, kapsam: "platform", durum, sorumluId, olusturanId: olusturan } });

let ben: string, ayse: string, mehmet: string;
beforeEach(async () => { [ben, ayse, mehmet] = [await kisi(), await kisi(), await kisi()]; });

afterAll(async () => {
  await yonetici.platformGorev.deleteMany({ where: { baslik: { startsWith: iz } } });
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id = ANY(${acilanlar}::uuid[])`;
  await yonetici.platformKullanici.deleteMany({ where: { id: { in: acilanlar } } });
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-31 — rol düşürmede görev aktarımı (gerçek PostgreSQL)", () => {
  it("hedefsiz düşürme reddedilir ve hiçbir şey değişmez", async () => {
    const g = await gorev(ben, ayse);
    await expect(olarak(ben, () => kullanicilar.guncelle(ayse, { rol: "mevzuat_editoru" }))).rejects.toThrow(/1 açık platform görevi/);
    expect((await yonetici.platformKullanici.findUniqueOrThrow({ where: { id: ayse } })).rol).toBe("yonetici");
    expect(await yonetici.platformGorev.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ sorumluId: ayse, surum: 1 });
  });

  it("hedefle düşürmede açık görevler aktarılır, kapalılar kalır; rol ve görevler birlikte yazılır", async () => {
    const [acik, kapali] = [await gorev(ben, ayse), await gorev(ben, ayse, "tamamlandi")];
    await olarak(ben, () => kullanicilar.guncelle(ayse, { rol: "mevzuat_editoru", gorevAktarimHedefiId: mehmet }));
    expect((await yonetici.platformKullanici.findUniqueOrThrow({ where: { id: ayse } })).rol).toBe("mevzuat_editoru");
    expect(await yonetici.platformGorev.findUniqueOrThrow({ where: { id: acik.id } })).toMatchObject({ sorumluId: mehmet, surum: 2 });
    expect(await yonetici.platformGorev.findUniqueOrThrow({ where: { id: kapali.id } })).toMatchObject({ sorumluId: ayse, surum: 1 });
    const olay = await yonetici.mevzuatOlay.findFirst({ where: { kullaniciId: ben, olay: "platform_gorevi_guncellendi" } });
    expect(olay?.detay).toMatchObject({ gorevId: acik.id, oncekiSorumluId: ayse, yeniSorumluId: mehmet, neden: "rol_dusurme_aktarimi" });
  });

  it("kapanmış görev, sorumlusu editöre düştükten sonra yeniden atanmadan açılamaz", async () => {
    const kapali = await gorev(ben, ayse, "tamamlandi");
    await olarak(ben, () => kullanicilar.guncelle(ayse, { rol: "mevzuat_editoru" }));
    await expect(olarak(ben, () => gorevler.guncelle(kapali.id, { surum: 1, durum: "acik" }))).rejects.toThrow(/yalnız platform yöneticisi/);
    await olarak(ben, () => gorevler.guncelle(kapali.id, { surum: 1, durum: "acik", sorumluId: mehmet }));
    expect(await yonetici.platformGorev.findUniqueOrThrow({ where: { id: kapali.id } })).toMatchObject({ durum: "acik", sorumluId: mehmet });
  });

  it("eşzamanlı atama ve rol düşürme, editöre atanmış açık platform görevi bırakmaz", async () => {
    for (let i = 0; i < 5; i++) {
      const hedef = await kisi();
      const sonuc = await Promise.allSettled([
        olarak(ben, () => gorevler.olustur({ baslik: `${iz} yarış ${i}`, aciklama: null, kapsam: "platform", oncelik: "normal", sonTarih: null, sorumluId: hedef, degisiklikId: null })),
        olarak(ben, () => kullanicilar.guncelle(hedef, { rol: "mevzuat_editoru", gorevAktarimHedefiId: mehmet })),
      ]);
      expect(sonuc[1].status).toBe("fulfilled");
      const sahipsiz = await yonetici.platformGorev.count({ where: { kapsam: "platform", durum: { in: ["acik", "devam_ediyor"] }, sorumluId: hedef } });
      expect(sahipsiz).toBe(0);
      // Atama önce kazandıysa görev aktarılmıştır; düşürme önce kazandıysa atama reddedilmiştir.
      if (sonuc[0].status === "fulfilled") expect((await yonetici.platformGorev.findUniqueOrThrow({ where: { id: sonuc[0].value.id } })).sorumluId).toBe(mehmet);
      else expect(String(sonuc[0].reason)).toMatch(/yalnız platform yöneticisi/);
    }
  });
});
