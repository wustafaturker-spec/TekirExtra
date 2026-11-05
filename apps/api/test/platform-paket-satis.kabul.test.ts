import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PAKET_MODUL_KODLARI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const servis = new PlatformPaketService({ db } as never), kisi = randomUUID(), pasif = randomUUID(), firma = randomUUID();
const olarak = <T>(is: () => Promise<T>, kullaniciId = kisi, rol = "yonetici") => platformBaglamiylaCalistir({ kullaniciId, eposta: "satis@kabul.invalid", rol: rol as never }, is);
const icerik = { ad: "Satış kabul paketi", aciklama: "Satış sürümü yayın sürümünden ayrıdır", ozellikler: ["Kapsamlı paket"], siralama: 10 };
const fiyat = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: [{ aySayisi: 1 as const, matrah: "100.00" }] };
const kapsam: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: { kullanici: { sinir: 10, uyariYuzdesi: 80 }, cari: { sinir: null, uyariYuzdesi: 80 }, stok: { sinir: null, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 } } };
let paketId: string, ilkId: string, ikinciId: string;
async function yayinla(ek: { fiyatlandirma?: typeof fiyat | null; kapsamSozlesmesi?: PaketKapsamSozlesmesi | null } = {}) {
  const d = await olarak(() => servis.taslakAc(paketId, ilkId));
  const g = await olarak(() => servis.guncelle(paketId, d.id, { ...icerik, fiyatlandirma: fiyat, kapsamSozlesmesi: kapsam, ...ek, kilitSurumu: d.kilitSurumu }));
  return olarak(() => servis.yayinla(paketId, g.id, g.kilitSurumu));
}
async function degistir(acik: boolean, surumId: string | null = null, kilitSurumu?: number) {
  const p = await olarak(() => servis.satisGetir(paketId));
  const s = surumId ? await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: surumId } }) : null;
  return olarak(() => servis.satisDegistir(paketId, { acik, surumId, surumKilitSurumu: s?.kilitSurumu ?? null, kilitSurumu: kilitSurumu ?? p.kilitSurumu, neden: "Satış durumunun kabul kontrolü" }));
}
beforeAll(async () => {
  for (const [id, aktif] of [[kisi, true], [pasif, false]] as const) await admin.platformKullanici.create({ data: { id, aktif, eposta: `${id}@kabul.invalid`, adSoyad: "Satış yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await admin.tenant.create({ data: { id: firma, unvan: "Satışta korunacak abonelik", vkn: "7899990001" } });
  await admin.tenantAbonelik.create({ data: { tenantId: firma, planKodu: "v1" } });
  const p = await olarak(() => servis.olustur({ ...icerik, kod: `satis_${randomUUID().slice(0, 8)}`, fiyatlandirma: fiyat, kapsamSozlesmesi: kapsam }));
  paketId = p.id; ilkId = p.surum.id;
  await olarak(() => servis.yayinla(paketId, ilkId, p.surum.kilitSurumu));
  ikinciId = (await yayinla()).id;
});
afterAll(async () => {
  // Yayınlar ve satış geçmişi test DB'si kapanana kadar saklanır; FK'lı yönetici silinmez.
  await admin.tenant.deleteMany({ where: { id: firma } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: firma } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});
describe("ayrı katalog satış durumu — gerçek PostgreSQL", () => {
  it("oluşturma/yayın satış seçmez; eski paketler kapalı gelir", async () => {
    expect(await olarak(() => servis.satisGetir(paketId))).toMatchObject({ acik: false, surum: null, kilitSurumu: 1, toplam: 0 });
    expect(await db.platformPaket.count({ where: { eskiPlanKodu: { not: null }, satisAcik: true } })).toBe(0);
    expect((await olarak(() => servis.listele({ arama: "satis_", sayfa: 1 }))).kayitlar).toEqual(expect.arrayContaining([expect.objectContaining({ id: paketId, satisAcik: false })]));
  });
  it.each([{ fiyatlandirma: null }, { kapsamSozlesmesi: null }])("eksik ticari sözleşme açılamaz: %j", async (ek) => {
    const s = await yayinla(ek); await expect(degistir(true, s.id)).rejects.toThrow("fiyat ve kapsam");
  });
  it("gelecek fiyat, taslak ve başka paketin sürümü reddedilir", async () => {
    const s = await yayinla({ fiyatlandirma: { ...fiyat, gecerlilikTarihi: "2099-01-01" } });
    await expect(degistir(true, s.id)).rejects.toThrow("henüz gelmedi");
    const d = await olarak(() => servis.taslakAc(paketId, ilkId));
    await expect(degistir(true, d.id)).rejects.toThrow("yayınlanmış");
    await olarak(() => servis.yayinla(paketId, d.id, d.kilitSurumu));
    const yabanci = await db.platformPaketSurumu.findFirstOrThrow({ where: { paketId: { not: paketId } } });
    await expect(degistir(true, yabanci.id)).rejects.toThrow("bu pakete ait");
  });
  it("açık seçim sürümü, gerekçeyi ve yöneticiyi kaydeder; abonelik değişmez", async () => {
    const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
    await degistir(true, ilkId);
    const r = await olarak(() => servis.satisGetir(paketId));
    expect(r).toMatchObject({ acik: true, kilitSurumu: 2, surum: { id: ilkId }, toplam: 1, kayitlar: [{ kullaniciId: kisi, neden: "Satış durumunun kabul kontrolü", onceki: { acik: false }, yeni: { acik: true, surumId: ilkId, fiyatlandirma: fiyat, kapsamSozlesmesi: kapsam } }] });
    expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).toEqual(once);
  });
  it("yeni yayın satış hedefini değiştirmez; aynı seçim yeni geçmiş oluşturmaz", async () => {
    await yayinla(); const once = await olarak(() => servis.satisGetir(paketId));
    expect(once.surum?.id).toBe(ilkId);
    expect(await degistir(true, ilkId)).toMatchObject({ tekrar: true });
    expect((await olarak(() => servis.satisGetir(paketId))).toplam).toBe(once.toplam);
  });
  it("satışa seçili sürüm API ve doğrudan SQL ile arşivlenemez", async () => {
    const s = await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: ilkId } });
    await expect(olarak(() => servis.arsivle(paketId, s.id, s.kilitSurumu))).rejects.toThrow("satışı durdurun");
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET durum='arsiv',arsivlendi_at=now(),kilit_surumu=kilit_surumu+1 WHERE id=${ilkId}::uuid`).rejects.toThrow("satis_once_durdur");
  });
  it("hedef değiştirme eski satışı atomik değiştirir; durdurma sonrası arşivlenebilir", async () => {
    const kilit = (await olarak(() => servis.satisGetir(paketId))).kilitSurumu;
    await degistir(true, ikinciId);
    await expect(degistir(false, null, kilit)).rejects.toThrow("yeniden onaylayın");
    await degistir(false);
    const s = await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: ikinciId } });
    await olarak(() => servis.arsivle(paketId, s.id, s.kilitSurumu));
    expect(await olarak(() => servis.satisGetir(paketId))).toMatchObject({ acik: false, surum: { id: ikinciId, durum: "arsiv" } });
    await expect(degistir(true, ikinciId)).rejects.toThrow("yayınlanmış");
  });
  it("eski hedef revizyonu onaylanamaz; yetki DB'de tekrar kontrol edilir", async () => {
    const r = await olarak(() => servis.satisGetir(paketId));
    await expect(olarak(() => servis.satisDegistir(paketId, { acik: true, surumId: ilkId, surumKilitSurumu: 1, kilitSurumu: r.kilitSurumu, neden: "Eski sürüm kontrolü" }))).rejects.toThrow("yeniden onaylayın");
    await expect(olarak(() => servis.satisDegistir(paketId, { acik: false, surumId: null, surumKilitSurumu: null, kilitSurumu: r.kilitSurumu, neden: "Pasif yönetici kontrolü" }), pasif)).rejects.toThrow("Aktif platform");
    await expect(olarak(() => servis.satisGetir(paketId), kisi, "mevzuat_editoru")).rejects.toThrow("platform yöneticisi");
  });
  it("kiracı ve doğrudan katalog yazımı satış durumunu veya geçmişi aşamaz", async () => {
    await expect(db.$executeRaw`UPDATE platform_paketler SET satis_acik=true WHERE id=${paketId}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`INSERT INTO platform_paketler(kod,satis_acik,satis_surum_id) VALUES ('hileli_satis',true,${ilkId}::uuid)`).rejects.toThrow("satis_ilk_durum");
    await expect(db.platformPaketSatisGecmisi.deleteMany({ where: { paketId } })).rejects.toThrow();
    await expect(app.platformPaketSatisGecmisi.findMany()).rejects.toThrow();
  });
  it("iki yönetici aynı satış revizyonunu iki kez değiştiremez", async () => {
    const h = (await yayinla()).id, rev = (await olarak(() => servis.satisGetir(paketId))).kilitSurumu;
    const r = await Promise.allSettled([degistir(true, ilkId, rev), degistir(true, h, rev)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await olarak(() => servis.satisGetir(paketId))).kilitSurumu).toBe(rev + 1);
  });
  it("arşiv/yeni satış yarışı açık arşiv sürümü bırakmaz", async () => {
    await degistir(false); const s = await yayinla();
    await Promise.allSettled([degistir(true, s.id), olarak(() => servis.arsivle(paketId, s.id, s.kilitSurumu))]);
    const r = await olarak(() => servis.satisGetir(paketId));
    if (r.acik) expect(r.surum?.durum).toBe("yayinlandi");
    else expect((await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: s.id } })).durum).toBe("arsiv");
  });
  it("geçmiş sayfalanır; boş sayfada toplam korunur", async () => {
    const h = (await yayinla()).id;
    for (let i = 0; i < 26; i++) await degistir(true, i % 2 ? ilkId : h);
    const ilk = await olarak(() => servis.satisGetir(paketId)), ikinci = await olarak(() => servis.satisGetir(paketId, 2)), bos = await olarak(() => servis.satisGetir(paketId, 100));
    expect(ilk.kayitlar).toHaveLength(25); expect(ikinci.kayitlar.length).toBeGreaterThan(0);
    expect(bos).toMatchObject({ toplam: ilk.toplam, kayitlar: [] });
    expect(new Set([...ilk.kayitlar, ...ikinci.kayitlar].map((k) => k.id)).size).toBe(ilk.toplam);
  });
  it("Repeatable Read eski yayın görünümüyle arşiv sürümünü satışa açamaz", async () => {
    await degistir(false); const s = await yayinla();
    await expect(admin.$transaction(async (tx) => {
      const p = await tx.platformPaket.findUniqueOrThrow({ where: { id: paketId } });
      await olarak(() => servis.arsivle(paketId, s.id, s.kilitSurumu));
      await tx.$queryRaw`SELECT platform_paket_satis_degistir(${kisi}::uuid,${paketId}::uuid,true,${s.id}::uuid,${p.satisKilitSurumu}::integer,${s.kilitSurumu}::integer,'Eski yayın görünümü')`;
    }, { isolationLevel: "RepeatableRead" })).rejects.toThrow();
    expect((await olarak(() => servis.satisGetir(paketId))).acik).toBe(false);
  });
  it("Repeatable Read eski kapalı durumla yeni satış sürümünü arşivleyemez", async () => {
    const s = await yayinla();
    await expect(admin.$transaction(async (tx) => {
      await tx.platformPaket.findUniqueOrThrow({ where: { id: paketId } });
      await degistir(true, s.id);
      await tx.platformPaketSurumu.update({ where: { id: s.id }, data: { durum: "arsiv", arsivlendiAt: new Date(), kilitSurumu: { increment: 1 } } });
    }, { isolationLevel: "RepeatableRead" })).rejects.toThrow();
    expect(await olarak(() => servis.satisGetir(paketId))).toMatchObject({ acik: true, surum: { id: s.id, durum: "yayinlandi" } });
  });
});
