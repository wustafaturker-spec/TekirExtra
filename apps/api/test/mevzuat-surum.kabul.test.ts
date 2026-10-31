import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import type { MevzuatService } from "../src/mevzuat/mevzuat.service";
import { PlatformMevzuatService } from "../src/mevzuat/platform-mevzuat.service";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * PLT-28: mevzuat değişikliğinde sürüm ve yarış denetimi gerçek PostgreSQL'de,
 * platform rolüyle. Test hiçbir değişikliği başarıyla YAYINLAMAZ: yayınlanan kayıt
 * tüm kiracılara yansır ve silinemez. Kayıtlar taslak/onay bekliyor olarak silinir.
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
const okuyucu = { onbellekTemizle: () => undefined } as unknown as MevzuatService;
const servis = () => new PlatformMevzuatService({ db: platform } as unknown as PlatformPrismaService, okuyucu);

const iz = `plt28-${randomUUID().slice(0, 8)}`;
let ayse: string, mehmet: string;
const acilanlar: string[] = [];
const olarak = <T>(kim: string, is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kim, eposta: `${kim}@kabul.invalid`, rol: "mevzuat_editoru" }, is);
const bilgi = (baslik: string) => ({ baslik, dayanak: "PLT-28 kabul testi dayanağı", aciklama: null, yururlukBaslangic: "2099-01-01" });
const satir = (ad: string) => ({ tur: "tevkifat_kodu", anahtar: "698", islem: "ekle" as const, deger: { ad, oranlar: ["4/10"] } });
const durum = (id: string) => yonetici.mevzuatDegisiklik.findUniqueOrThrow({ where: { id }, include: { satirlar: true } });
async function yeni() {
  const { id } = await olarak(ayse, () => servis().olustur(bilgi(`${iz} değişiklik`)));
  acilanlar.push(id);
  return id;
}
const sonuc409 = { status: 409 };

beforeAll(async () => {
  const kisi = async (ad: string) => (await yonetici.platformKullanici.create({ data: { eposta: `${iz}-${ad}@ornek.invalid`, adSoyad: `${iz} ${ad}`, parolaHash: "x", totpSecretSifreli: "x", rol: "mevzuat_editoru" } })).id;
  [ayse, mehmet] = [await kisi("ayse"), await kisi("mehmet")];
});

afterAll(async () => {
  // Hiçbiri yayınlanmadı: değişmezlik tetikleyicisi silmeye izin verir.
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE degisiklik_id = ANY(${acilanlar}::uuid[]) OR kullanici_id = ANY(${[ayse, mehmet]}::uuid[])`;
  await yonetici.mevzuatDegisiklikSatiri.deleteMany({ where: { degisiklikId: { in: acilanlar } } });
  await yonetici.mevzuatDegisiklik.deleteMany({ where: { id: { in: acilanlar } } });
  await yonetici.platformKullanici.deleteMany({ where: { id: { in: [ayse, mehmet] } } });
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-28 — mevzuat sürüm ve yarış denetimi (gerçek PostgreSQL)", () => {
  it("iki editör aynı sürümden kaydeder: biri kazanır, diğeri 409 alır ve yazdığı değer kayda girmez", async () => {
    const id = await yeni();
    const sonuc = await Promise.allSettled([
      olarak(ayse, () => servis().guncelle(id, bilgi(`${iz} Ayşe`), 1)),
      olarak(mehmet, () => servis().guncelle(id, bilgi(`${iz} Mehmet`), 1)),
    ]);
    expect(sonuc.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const kaybeden = sonuc.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(kaybeden.reason).toMatchObject(sonuc409);
    expect((kaybeden.reason as { getResponse(): { guncelSurum: number } }).getResponse().guncelSurum).toBe(2);
    const d = await durum(id);
    expect(d.surum).toBe(2);
    expect(d.baslik).toBe(sonuc[0].status === "fulfilled" ? `${iz} Ayşe` : `${iz} Mehmet`);
  });

  it("her yazım sürümü artırır; başlık kaydı kalemleri silmez, eski sürümle kalem/senaryo/silme 409 alır", async () => {
    const id = await yeni();
    await olarak(ayse, () => servis().satirlariYaz(id, [satir("İlk kalem")], 1));
    await olarak(ayse, () => servis().guncelle(id, bilgi(`${iz} yeni başlık`), 2));
    const d = await durum(id);
    expect(d.surum).toBe(3);
    expect(d.satirlar.map((s) => (s.deger as { ad: string }).ad)).toEqual(["İlk kalem"]);
    await expect(olarak(mehmet, () => servis().satirlariYaz(id, [satir("Eski sürümden")], 2))).rejects.toMatchObject(sonuc409);
    await expect(olarak(mehmet, () => servis().kabulSenaryolariYaz(id, [], 1))).rejects.toMatchObject(sonuc409);
    await expect(olarak(mehmet, () => servis().sil(id, 2))).rejects.toMatchObject(sonuc409);
    expect((await durum(id)).satirlar.map((s) => (s.deger as { ad: string }).ad)).toEqual(["İlk kalem"]);
  });

  it("kalem yazımı ile onaya gönderme yarışı: onaya giden içerik sonradan değişmez", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await yeni();
      await olarak(ayse, () => servis().satirlariYaz(id, [satir("Onaya giden")], 1));
      const [kalem, onay] = await Promise.allSettled([
        olarak(mehmet, () => servis().satirlariYaz(id, [satir("Yarışta yazılan")], 2)),
        olarak(ayse, () => servis().onayaGonder(id, 2)),
      ]);
      expect([kalem.status, onay.status].filter((s) => s === "fulfilled")).toHaveLength(1);
      const d = await durum(id);
      if (onay.status === "fulfilled") {
        expect(d.durum).toBe("onay_bekliyor");
        expect(d.satirlar.map((s) => (s.deger as { ad: string }).ad)).toEqual(["Onaya giden"]);
        // Onay beklerken hiçbir sürümle kalem yazılamaz.
        await expect(olarak(mehmet, () => servis().satirlariYaz(id, [satir("Sonradan")], d.surum))).rejects.toMatchObject(sonuc409);
      } else {
        expect(d.durum).toBe("taslak");
        expect(d.satirlar.map((s) => (s.deger as { ad: string }).ad)).toEqual(["Yarışta yazılan"]);
      }
    }
  });

  it("eski sürümle yayın, taslağa çekme ve geri çevirme reddedilir; dört göz ilkesi sürer", async () => {
    const id = await yeni();
    await olarak(ayse, () => servis().satirlariYaz(id, [satir("Yayın denemesi")], 1));
    await olarak(ayse, () => servis().onayaGonder(id, 2));
    await expect(olarak(mehmet, () => servis().yayinla(id, 2))).rejects.toMatchObject(sonuc409);
    await expect(olarak(mehmet, () => servis().geriCevir(id, "eski sürümden gerekçe", 2))).rejects.toMatchObject(sonuc409);
    await expect(olarak(ayse, () => servis().taslagaCek(id, 2))).rejects.toMatchObject(sonuc409);
    // Hazırlayan güncel sürümle de yayınlayamaz (başarılı yayın bilerek denenmez).
    await expect(olarak(ayse, () => servis().yayinla(id, 3))).rejects.toThrow(/Dört göz/);
    await olarak(mehmet, () => servis().geriCevir(id, "Kabul testi geri çevirmesi", 3));
    const d = await durum(id);
    expect(d).toMatchObject({ durum: "taslak", surum: 4, retGerekcesi: "Kabul testi geri çevirmesi" });
  });
});
