import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { PrismaService } from "../src/core/prisma.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { bagliAbonelikTutari, etkinAbonelikPlani } from "../src/tenant/abonelik-kosullari";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import { fiyatFotografiniOku } from "../src/abonelik-odeme/odeme-fiyat-fotografi";
import { PlatformOdemeRaporuService } from "../src/abonelik-odeme/platform-odeme-raporu.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(), diger = randomUUID(), tenantIds: string[] = [];
const servis = new PlatformPaketService({ db: platform } as never);
const yonetici = <T>(is: () => Promise<T>, kullaniciId = kisi) => platformBaglamiylaCalistir({ kullaniciId, eposta: "atama@kabul.invalid", rol: "yonetici" }, is);
const abonelik = (tenantId: string) => app.tenantIslem(tenantId, (tx) => tx.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } }));
let hedef: string, paketId: string, ilkSurumId: string;
const fiyat = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "10", gecerlilikTarihi: "2026-01-01", donemler: ([1, 3, 6, 12] as const).map((aySayisi) => ({ aySayisi, matrah: String(1200 * aySayisi) })) };
async function firma(planKodu = "v1") {
  const id = randomUUID(); tenantIds.push(id);
  await admin.tenant.create({ data: { id, unvan: `Atama ${id}`, vkn: String(8000000000 + tenantIds.length) } });
  await admin.user.create({ data: { tenantId: id, eposta: `${id}@kabul.invalid`, adSoyad: "Atama kabul", parolaHash: "x", rol: "yonetici" } });
  await admin.tenantAbonelik.create({ data: { tenantId: id, planKodu, donemSonu: new Date(Date.now() + 86400000), meta: { kabul: true } } });
  return id;
}
async function onizle(ids: string[], surumId = hedef) {
  return yonetici(() => servis.atamaOnizle({ surumId, tenantIds: ids, uygulamaTarihi: bugunTR(), neden: "Kabul fiyat ataması" }));
}
async function surum(fiyatlandirma = fiyat, yayinla = true) {
  const d = await yonetici(() => servis.taslakAc(paketId, ilkSurumId));
  const g = await yonetici(() => servis.guncelle(paketId, d.id, { ad: "Atanan Profesyonel", aciklama: "Atama kabul", ozellikler: ["Raporlar"], siralama: 20, kilitSurumu: 1, fiyatlandirma }));
  return yayinla ? yonetici(() => servis.yayinla(paketId, g.id, g.kilitSurumu)) : g;
}
beforeAll(async () => {
  for (const id of [kisi, diger]) await admin.platformKullanici.create({ data: { id, eposta: `${id}@kabul.invalid`, adSoyad: "Atama yöneticisi", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  const p = await admin.platformPaket.findUniqueOrThrow({ where: { eskiPlanKodu: "profesyonel" }, include: { surumler: { where: { surumNo: 1 } } } });
  paketId = p.id; ilkSurumId = p.surumler[0].id; hedef = (await surum()).id;
});
afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: { in: [kisi, diger] } } });
  await admin.platformPaketAtamasi.deleteMany({ where: { kullaniciId: { in: [kisi, diger] } } });
  await admin.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await admin.platformKullanici.deleteMany({ where: { id: { in: [kisi, diger] } } });
  await Promise.all([admin.$disconnect(), platform.$disconnect(), app.$disconnect()]);
});

describe("kontrollü katalog fiyat ataması — gerçek PostgreSQL", () => {
  it("önizleme kalıcıdır, aboneliği değiştirmez; toplu onay yalnız bağı/fiyatı günceller", async () => {
    const ids = [await firma(), await firma("profesyonel")], once = await Promise.all(ids.map(abonelik));
    const p = await onizle(ids);
    expect(await Promise.all(ids.map(abonelik))).toEqual(once);
    expect(p.kayitlar[0].donemler[0].sonra?.toplam).toBe("1320.00");
    expect(await admin.platformPaketAtamasi.findUnique({ where: { id: p.id } })).toMatchObject({ uygulandiAt: null });
    const r = await yonetici(() => servis.atamaUygula(p.id));
    expect(r).toMatchObject({ tekrar: false, firmaAdedi: 2 });
    for (let i = 0; i < ids.length; i++) {
      const a = await abonelik(ids[i]);
      expect(a).toMatchObject({ paketSurumId: hedef, planKodu: once[i].planKodu, donemSonu: once[i].donemSonu, durum: once[i].durum, meta: once[i].meta });
      expect(a.paketKosullari).toMatchObject({ kaynak: "katalog_atamasi", limitler: etkinAbonelikPlani(once[i]).limitler });
      expect(bagliAbonelikTutari(a, 1)?.toplam.toFixed(2)).toBe("1320.00");
    }
    expect(await admin.mevzuatOlay.count({ where: { kullaniciId: kisi, olay: "firma_paket_fiyati_atandi", detay: { path: ["atamaId"], equals: p.id } } })).toBe(2);
    expect(await yonetici(() => servis.atamaUygula(p.id))).toMatchObject({ tekrar: true, firmaAdedi: 2 });
    expect(await admin.mevzuatOlay.count({ where: { olay: "firma_paket_fiyati_atandi", detay: { path: ["atamaId"], equals: p.id } } })).toBe(2);
  });
  it("eşzamanlı aynı onay ikinci atama veya olay oluşturmaz", async () => {
    const p = await onizle([await firma()]);
    const rs = await Promise.all([yonetici(() => servis.atamaUygula(p.id)), yonetici(() => servis.atamaUygula(p.id))]);
    expect(rs.map((r) => r.tekrar).sort()).toEqual([false, true]);
    expect(await admin.mevzuatOlay.count({ where: { olay: "firma_paket_fiyati_atandi", detay: { path: ["atamaId"], equals: p.id } } })).toBe(1);
  });
  it("aynı kaynağa ait iki önizlemeden yalnız biri uygulanır; v1 ad değişimi fiyatı sıfırlamaz", async () => {
    const id = await firma(), p = await onizle([id]), q = await onizle([id]);
    await yonetici(() => servis.atamaUygula(p.id));
    await expect(yonetici(() => servis.atamaUygula(q.id))).rejects.toThrow("Yeni bir atama önizlemesi");
    await platform.$queryRaw`SELECT platform_abonelik_guncelle(${id}::uuid,'profesyonel',NULL,'Kanonik kod kabul')::text`;
    expect((await abonelik(id)).paketSurumId).toBe(hedef);
    expect(bagliAbonelikTutari(await abonelik(id), 1)?.toplam.toFixed(2)).toBe("1320.00");
  });
  it("kaynak değişirse toplu atamanın tamamı geri alınır", async () => {
    const ids = [await firma(), await firma()], p = await onizle(ids), once = await abonelik(ids[0]);
    await admin.tenantAbonelik.update({ where: { tenantId: ids[1] }, data: { faturaEpostasi: "degisti@kabul.invalid" } });
    await expect(yonetici(() => servis.atamaUygula(p.id))).rejects.toThrow("Yeni bir atama önizlemesi");
    expect(await abonelik(ids[0])).toEqual(once);
    expect((await admin.platformPaketAtamasi.findUniqueOrThrow({ where: { id: p.id } })).uygulandiAt).toBeNull();
  });
  it("süresi dolan, başka yöneticiye ait ve yetkisi kaldırılan onayı reddeder", async () => {
    const p = await onizle([await firma()]);
    await expect(yonetici(() => servis.atamaUygula(p.id), diger)).rejects.toThrow("size ait");
    await admin.platformPaketAtamasi.update({ where: { id: p.id }, data: { sonOnayAt: new Date(0) } });
    await expect(yonetici(() => servis.atamaUygula(p.id))).rejects.toThrow("onay süresi");
    const q = await onizle([await firma()]);
    await admin.platformKullanici.update({ where: { id: kisi }, data: { aktif: false } });
    try { await expect(yonetici(() => servis.atamaUygula(q.id))).rejects.toThrow("aktif"); }
    finally { await admin.platformKullanici.update({ where: { id: kisi }, data: { aktif: true } }); }
  });
  it("arşivlenen hedefin önizlemesi uygulanmaz", async () => {
    const s = await surum(), p = await onizle([await firma()], s.id);
    await yonetici(() => servis.arsivle(paketId, s.id, s.kilitSurumu));
    await expect(yonetici(() => servis.atamaUygula(p.id))).rejects.toThrow("hedef sürüm");
  });
  it("satır kilidini beklerken onay süresi dolarsa uygulamaz", async () => {
    const id = await firma(), p = await onizle([id]);
    await admin.$executeRaw`UPDATE platform_paket_atamalari SET son_onay_at=clock_timestamp()+interval '2 seconds' WHERE id=${p.id}::uuid`;
    let hazir!: () => void;
    const kilitlendi = new Promise<void>((r) => { hazir = r; });
    const tut = admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenant_abonelikleri WHERE tenant_id=${id}::uuid FOR UPDATE`;
      hazir();
      await tx.$queryRaw`SELECT pg_sleep(2.5)::text`;
    });
    await kilitlendi;
    await expect(yonetici(() => servis.atamaUygula(p.id))).rejects.toThrow("onay süresi");
    await tut;
    expect((await abonelik(id)).paketSurumId).toBe(ilkSurumId);
  });
  it("farklı planı, bilinmeyen kodu, askıyı ve yinelenen firmayı reddeder", async () => {
    for (const kod of ["baslangic", "kurumsal", "bilinmeyen"]) await expect(onizle([await firma(kod)])).rejects.toThrow("kayıtlı fiyatı");
    const id = await firma();
    await expect(onizle([id, id])).rejects.toThrow("farklı 1–25");
    await admin.tenantAbonelik.update({ where: { tenantId: id }, data: { durum: "askida" } });
    await expect(onizle([id])).rejects.toThrow("kayıtlı fiyatı");
  });
  it("ileri/geçmiş uygulama tarihi ve henüz geçerli olmayan fiyat reddedilir", async () => {
    const id = await firma();
    for (const uygulamaTarihi of ["2000-01-01", "9999-01-01"]) await expect(yonetici(() => servis.atamaOnizle({ surumId: hedef, tenantIds: [id], uygulamaTarihi, neden: "Tarih kabul kontrolü" }))).rejects.toThrow("bugünün");
    const s = await surum({ ...fiyat, gecerlilikTarihi: "9999-01-01" });
    await expect(onizle([id], s.id)).rejects.toThrow("henüz gelmedi");
  });
  it("mevcut fiyat dönemini kaldıran sürüme atama yapılamaz", async () => {
    const s = await surum({ ...fiyat, donemler: fiyat.donemler.slice(0, 1) });
    await expect(onizle([await firma()], s.id)).rejects.toThrow("tüm fiyat dönemlerini");
  });
  it("doğrudan bağ/atama kaydı yazımı, app rolünün işlev/rapor erişimi engellenir", async () => {
    const id = await firma(), p = await onizle([id]);
    await expect(app.tenantIslem(id, (tx) => tx.tenantAbonelik.update({ where: { tenantId: id }, data: { paketSurumId: hedef } }))).rejects.toThrow("degistirilemez");
    await expect(platform.$executeRaw`UPDATE platform_paket_atamalari SET uygulandi_at=now() WHERE id=${p.id}::uuid`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT platform_paket_atama_uygula(${kisi}::uuid,${p.id}::uuid)`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM platform_paket_atamalari`).rejects.toThrow();
    await yonetici(() => servis.atamaUygula(p.id));
    await expect(app.tenantIslem(id, (tx) => tx.tenantAbonelik.update({ where: { tenantId: id }, data: { paketSurumId: ilkSurumId } }))).rejects.toThrow("degistirilemez");
  });
  it("panel, yenileme ve yeni girişim atanan fiyatı; eski girişim eski fotoğrafı korur", async () => {
    const id = await firma();
    const odeme = new AbonelikOdemeService(app, { etkin: async () => ({ saglayici: "iyzico", ortam: "test", config: {} }) } as never, { db: { mevzuatOlay: { create: vi.fn() } } } as never, { unut: vi.fn() } as never);
    odeme.saglayiciUret = () => ({ odemeBaslat: async (g: { denemeId: string }) => ({ token: g.denemeId, odemeSayfasiUrl: "https://kabul.invalid" }) }) as never;
    const eski = await odeme.baslat(id, 1, "panel", null), p = await onizle([id]);
    const eskiKayit = await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: eski.denemeId } });
    await yonetici(() => servis.atamaUygula(p.id));
    expect(await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: eski.denemeId } })).toEqual(eskiKayit);
    const yeni = await odeme.baslat(id, 1, "eposta", null);
    const d = await admin.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: yeni.denemeId } });
    expect(fiyatFotografiniOku(d.fiyatFotografi)).toMatchObject({ kaynak: "katalog_atamasi", paketSurumId: hedef, toplam: "1320.00" });
    const durum = await odeme.durum(id);
    expect(durum.secenekler.find((x) => x.aySayisi === 1)?.toplam).toBe("1320.00");
    const rapor = await new PlatformOdemeRaporuService({ db: platform } as never).yaklasan(7);
    expect(rapor.kayitlar.find((x) => x.tenantId === id)?.beklenen?.toplam).toBe("1320.00");
  });
});
