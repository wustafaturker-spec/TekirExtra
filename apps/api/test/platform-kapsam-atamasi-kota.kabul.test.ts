import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR, PAKET_MODUL_KODLARI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const servis = new PlatformPaketService({ db } as never), kisi = randomUUID(), firmalar: string[] = [];
const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "atomik@kabul.invalid", rol: "yonetici" }, is);
let paketId: string, kaynak: string, hedef: string;
const kapsam = (sinir: number | null = 1): PaketKapsamSozlesmesi => ({ semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: Object.fromEntries(["kullanici", "cari", "stok", "aylikFatura"].map((k) => [k, { sinir, uyariYuzdesi: 80 }])) as PaketKapsamSozlesmesi["kotalar"] });
async function yayinla(k: PaketKapsamSozlesmesi) {
  const d = await db.platformPaketSurumu.findFirst({ where: { paketId, durum: "taslak" } }) ?? await yonetici(() => servis.taslakAc(paketId, kaynak));
  const g = await yonetici(() => servis.guncelle(paketId, d.id, { ad: "Atomik kapsam", aciklama: "Kota kabulü", ozellikler: ["Kapsam kabulü"], siralama: 1, kapsamSozlesmesi: k,
    fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: ([1, 3, 6, 12] as const).map((aySayisi) => ({ aySayisi, matrah: String(1000 * aySayisi) })) }, kilitSurumu: d.kilitSurumu }));
  return (await yonetici(() => servis.yayinla(paketId, d.id, g.kilitSurumu))).id;
}
async function firma() {
  const id = randomUUID(); firmalar.push(id);
  await admin.tenant.create({ data: { id, unvan: "Atomik kota kabul", vkn: String(7700000000 + firmalar.length) } });
  await admin.tenantAbonelik.create({ data: { tenantId: id, planKodu: "v1", donemSonu: new Date(Date.now() + 86400000) } });
  return id;
}
const onizle = (id: string, surumId = hedef) => yonetici(() => servis.atamaOnizle({ surumId, tenantIds: [id], atamaKapsami: "kapsam", uygulamaTarihi: bugunTR(), neden: "Kapsam ve kota kabulü" }));
async function ata(id: string, surumId = hedef) { const p = await onizle(id, surumId); await yonetici(() => servis.atamaUygula(p.id)); return p; }
const cari = (tenantId: string, aktif = true) => admin.cariHesap.create({ data: { tenantId, kod: randomUUID(), unvan: "Kabul carisi", tip: "musteri", aktif } });
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Atomik yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  const p = await db.platformPaket.findUniqueOrThrow({ where: { kod: "profesyonel" }, include: { surumler: { where: { surumNo: 1 } } } });
  paketId = p.id; kaynak = p.surumler[0].id; hedef = await yayinla(kapsam());
});
afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: kisi } });
  await admin.platformPaketAtamasi.deleteMany({ where: { kullaniciId: kisi } });
  await admin.fatura.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.cariHesap.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.stokKart.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.user.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.tenant.deleteMany({ where: { id: { in: firmalar } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: firmalar } } });
  await admin.platformKullanici.deleteMany({ where: { id: kisi } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});
describe("kontrollü kapsam ataması ve atomik kota — gerçek PostgreSQL", () => {
  it("önizleme erişimi değiştirmez; açık onay koşulları bağlar ve tekrar güvenlidir", async () => {
    const id = await firma(), p = await onizle(id);
    expect(p).toMatchObject({ atamaKapsami: "kapsam", kayitlar: [{ kullanim: { cari: 0 }, sonrakiLimitler: { cari: 1 } }] });
    expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: id } })).paketSurumId).toBe(kaynak);
    await yonetici(() => servis.atamaUygula(p.id));
    expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: id } })).paketKosullari).toMatchObject({ semaSurumu: 2, kapsamSozlesmesi: kapsam() });
    expect(await yonetici(() => servis.atamaUygula(p.id))).toMatchObject({ tekrar: true });
    await expect(admin.tenantAbonelik.update({ where: { tenantId: id }, data: { planKodu: "baslangic" } })).rejects.toThrow("kontrollu kapsam");
  });
  it("önizlemeden sonra kaynak kullanımı değişirse onay reddedilir", async () => {
    const id = await firma(), p = await onizle(id); await cari(id);
    await expect(yonetici(() => servis.atamaUygula(p.id))).rejects.toThrow("Yeni bir atama önizlemesi");
    await ata(id);
  });
  it("kullanımın altına inen kapsam hazırlanmaz", async () => {
    const id = await firma(); await cari(id); await cari(id);
    await expect(onizle(id)).rejects.toThrow("Mevcut kullanım");
  });
  it("eşzamanlı iki cari yalnız son tek yeri bir kez kullanır", async () => {
    const id = await firma(); await ata(id);
    const r = await Promise.allSettled([cari(id), cari(id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason)).toContain("paket_kota_dolu:cari");
    expect(await admin.cariHesap.count({ where: { tenantId: id, aktif: true } })).toBe(1);
  });
  it("toplu ekleme kısmi kayıt bırakmaz; pasif kartı açmak da kota tüketir", async () => {
    const id = await firma(); await ata(id);
    await expect(admin.cariHesap.createMany({ data: [1, 2].map((n) => ({ tenantId: id, kod: String(n), unvan: "Toplu", tip: "musteri" as const })) })).rejects.toThrow("paket_kota_dolu:cari");
    expect(await admin.cariHesap.count({ where: { tenantId: id } })).toBe(0);
    const a = await cari(id), b = await cari(id, false);
    await expect(admin.cariHesap.update({ where: { id: b.id }, data: { aktif: true } })).rejects.toThrow("paket_kota_dolu:cari");
    await admin.cariHesap.update({ where: { id: a.id }, data: { aktif: false } });
    await admin.cariHesap.update({ where: { id: b.id }, data: { aktif: true } });
  });
  it("Repeatable Read eski sayımla kotayı aşamaz", async () => {
    const id = await firma(); await ata(id);
    await expect(admin.$transaction(async (tx) => {
      await tx.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: id } });
      await cari(id);
      await tx.cariHesap.create({ data: { tenantId: id, kod: "ESKI", unvan: "Eski görünüm", tip: "musteri" } });
    }, { isolationLevel: "RepeatableRead" })).rejects.toMatchObject({ code: "P2034" });
    expect(await admin.cariHesap.count({ where: { tenantId: id } })).toBe(1);
  });
  it("kiracı rolü doğrudan yazımda kotayı veya başka firma bağlamını aşamaz", async () => {
    const id = await firma(); await ata(id); await cari(id);
    await expect(app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id',${id},true)`;
      await tx.cariHesap.create({ data: { tenantId: id, kod: "UYG", unvan: "Uygulama", tip: "musteri" } });
    })).rejects.toThrow("paket_kota_dolu:cari");
    const b = await firma();
    await expect(app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id',${id},true)`;
      await tx.cariHesap.create({ data: { tenantId: b, kod: "YAB", unvan: "Yabancı", tip: "musteri" } });
    })).rejects.toThrow();
  });
  it("planlı kapsam geçişinde kullanım değişirse engellenir ve eski kapsam korunur", async () => {
    const id = await firma();
    const p = await yonetici(() => servis.atamaOnizle({ surumId: hedef, tenantIds: [id], atamaKapsami: "kapsam", uygulamaTarihi: null, uygulamaTuru: "donem_sonu", neden: "Planlı kapsam kabulü" }));
    await yonetici(() => servis.atamaUygula(p.id)); await cari(id);
    await admin.$executeRaw`UPDATE platform_paket_atamalari SET uygulanacak_at=clock_timestamp()-interval '1 second' WHERE id=${p.id}::uuid`;
    await servis.planliAtamalariIsle();
    expect(await admin.platformPaketAtamasi.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ uygulandiAt: null, engelNedeni: "atama_kaynak_degisti" });
    expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: id } })).paketSurumId).toBe(kaynak);
  });
  it("kaynağı değişmeyen planlı kapsam worker tarafından bir kez uygulanır", async () => {
    const id = await firma();
    const p = await yonetici(() => servis.atamaOnizle({ surumId: hedef, tenantIds: [id], atamaKapsami: "kapsam", uygulamaTarihi: null, uygulamaTuru: "donem_sonu", neden: "Planlı kapsam kabulü" }));
    await yonetici(() => servis.atamaUygula(p.id));
    await admin.$executeRaw`UPDATE platform_paket_atamalari SET uygulanacak_at=clock_timestamp()-interval '1 second' WHERE id=${p.id}::uuid`;
    await servis.planliAtamalariIsle(); await servis.planliAtamalariIsle();
    expect((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: id } })).paketKosullari).toMatchObject({ semaSurumu: 2 });
    expect((await admin.platformPaketAtamasi.findUniqueOrThrow({ where: { id: p.id } })).uygulandiAt).not.toBeNull();
  });
  it("stok ve kullanıcı rol/aktif değişimi aynı atomik sınırı kullanır", async () => {
    const id = await firma(); await ata(id);
    await admin.stokKart.create({ data: { tenantId: id, kod: "1", ad: "Ürün" } });
    await expect(admin.stokKart.create({ data: { tenantId: id, kod: "2", ad: "Kopya" } })).rejects.toThrow("paket_kota_dolu:stok");
    const user = (rol: "yonetici" | "calisan") => admin.user.create({ data: { tenantId: id, eposta: `${randomUUID()}@kabul.invalid`, adSoyad: "Kota kullanıcı", parolaHash: "x", rol } });
    await user("yonetici"); const calisan = await user("calisan");
    await expect(admin.user.update({ where: { id: calisan.id }, data: { rol: "yonetici" } })).rejects.toThrow("paket_kota_dolu:kullanici");
  });
  it("fatura kotası oluşturma ayını kullanır; iptal kotayı boşaltmaz", async () => {
    const id = await firma(); await ata(id); const c = await cari(id);
    const data = { tenantId: id, cariId: c.id, tip: "satis" as const, tarih: new Date("2020-01-01"), toplamBrut: 0, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: 0, toplamKdv: 0, toplamTevkifat: 0, toplamNetKdv: 0, genelToplam: 0 };
    const f = await admin.fatura.create({ data }); await admin.fatura.update({ where: { id: f.id }, data: { durum: "iptal" } });
    await expect(admin.fatura.create({ data })).rejects.toThrow("paket_kota_dolu:aylikFatura");
    await admin.fatura.create({ data: { ...data, createdAt: new Date("2020-01-01") } });
  });
  it("kapalı modül doğrudan DB yazımında da korunur; null kota sınırsızdır", async () => {
    const k = kapsam(null); k.moduller = ["cari"]; const h = await yayinla(k);
    const id = await firma(); const p = await ata(id, h);
    expect(p.kayitlar[0].kapananModuller).toContain("stok");
    await cari(id); await cari(id);
    await expect(admin.stokKart.create({ data: { tenantId: id, kod: "1", ad: "Kapalı" } })).rejects.toThrow("paket_modul_kapali:stok");
  });
  it("sıfır kota ilk kaydı engeller; başka firmanın kullanımı sayılmaz", async () => {
    const h = await yayinla(kapsam(0)), id = await firma(); await ata(id, h);
    await expect(cari(id)).rejects.toThrow("paket_kota_dolu:cari");
    const b = await firma(); await ata(b); await cari(b);
  });
});
