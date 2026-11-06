import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformDuyuruService } from "../src/mevzuat/platform-duyuru.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(), ids: string[] = [];
const servis = new PlatformDuyuruService({ db: platform } as never, {} as never);
const yonetici = <T>(is: () => Promise<T>, kullaniciId = kisi) => platformBaglamiylaCalistir({ kullaniciId, eposta: "duyuru@kabul.invalid", rol: "yonetici" }, is);
const girdi = { baslik: "Bakım duyurusu", icerik: "Bakım takvimi\nİkinci satır", butonMetni: "Bilgi", butonUrl: "/panel" };
async function olustur() { const d = await yonetici(() => servis.olustur(girdi)); ids.push(d.id); return d; }
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Duyuru kabul", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
});
afterAll(async () => {
  await admin.$executeRaw`DELETE FROM platform_duyuru_gecmisi WHERE kullanici_id = ${kisi}::uuid`;
  for (const id of ids) await admin.$executeRaw`DELETE FROM platform_duyurular WHERE id = ${id}::uuid`;
  await admin.platformKullanici.delete({ where: { id: kisi } });
  await Promise.all([admin.$disconnect(), platform.$disconnect(), app.$disconnect()]);
});
describe("duyuru taslakları — gerçek PostgreSQL", () => {
  it("oluşturma ve güncelleme sürümlerini içerikleriyle saklar", async () => {
    const d = await olustur(); expect(d).toMatchObject({ ...girdi, durum: "taslak", surum: 1 });
    const yeni = await yonetici(() => servis.guncelle(d.id, { ...girdi, baslik: "Yeni başlık", surum: 1 }));
    expect(yeni.surum).toBe(2);
    const gecmis = await yonetici(() => servis.gecmis(d.id, 1));
    expect(gecmis.map((g) => g.surum)).toEqual([2, 1]);
    expect(gecmis[1].icerik).toMatchObject(girdi);
    expect(await yonetici(() => servis.gecmis(d.id, 2))).toEqual([]);
  });
  it("iki eşzamanlı düzenlemeden yalnız biri kaydolur", async () => {
    const d = await olustur();
    const sonuclar = await Promise.allSettled(["Birinci başlık", "İkinci başlık"].map((baslik) => yonetici(() => servis.guncelle(d.id, { ...girdi, baslik, surum: 1 }))));
    expect(sonuclar.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(sonuclar.filter((s) => s.status === "rejected")).toHaveLength(1);
    expect(await yonetici(() => servis.getir(d.id))).toMatchObject({ surum: 2 });
    expect(await yonetici(() => servis.gecmis(d.id, 1))).toHaveLength(2);
  });
  it("arşiv servis ve doğrudan SQL düzeyinde değiştirilemez", async () => {
    const d = await olustur();
    expect(await yonetici(() => servis.arsivle(d.id, 1))).toMatchObject({ durum: "arsiv", surum: 2 });
    await expect(yonetici(() => servis.guncelle(d.id, { ...girdi, surum: 2 }))).rejects.toThrow("Arşivlenmiş");
    await expect(platform.$executeRaw`UPDATE platform_duyurular SET baslik = 'Değişti', surum = 3 WHERE id = ${d.id}::uuid`).rejects.toThrow();
    const liste = await yonetici(() => servis.listele({ sayfa: 1, durum: "arsiv" }));
    expect(liste.kayitlar.some((r) => r.id === d.id)).toBe(true);
  });
  it("kiracı rolü taslakları ve geçmişi okuyamaz; platform geçmişi değiştiremez", async () => {
    await expect(app.$queryRaw`SELECT * FROM platform_duyurular`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM platform_duyuru_gecmisi`).rejects.toThrow();
    await expect(platform.$executeRaw`UPDATE platform_duyuru_gecmisi SET icerik = '{}'::jsonb`).rejects.toThrow();
    await expect(platform.$executeRaw`DELETE FROM platform_duyurular`).rejects.toThrow();
  });
  it("geçmiş yazımı başarısızsa taslak da geri alınır", async () => {
    const [once] = await admin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM platform_duyurular`;
    await expect(yonetici(() => servis.olustur(girdi), randomUUID())).rejects.toThrow();
    const [sonra] = await admin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM platform_duyurular`;
    expect(sonra.n).toBe(once.n);
  });
});
