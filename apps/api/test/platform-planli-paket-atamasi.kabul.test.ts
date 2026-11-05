import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { PrismaService } from "../src/core/prisma.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { sifrele } from "../src/core/kripto";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { bagliAbonelikTutari } from "../src/tenant/abonelik-kosullari";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import { gunEkle } from "../src/mevzuat/platform-istatistik-filtre";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(), diger = randomUUID(), tenantIds: string[] = [];
const servis = new PlatformPaketService({ db: platform } as never);
const yonetici = <T>(is: () => Promise<T>, kullaniciId = kisi) => platformBaglamiylaCalistir({ kullaniciId, eposta: "plan@kabul.invalid", rol: "yonetici" }, is);
const abonelik = (id: string) => app.tenantIslem(id, (tx) => tx.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: id } }));
const kayit = (id: string) => admin.platformPaketAtamasi.findUniqueOrThrow({ where: { id } });
const yarin = () => gunEkle(bugunTR(), 1);
let hedef: string, paketId: string, ilkId: string;
const fiyat = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "10", gecerlilikTarihi: "2026-01-01", donemler: ([1, 3, 6, 12] as const).map((aySayisi) => ({ aySayisi, matrah: String(1200 * aySayisi) })) };
const provider = { odemeBaslat: vi.fn(async (g: { denemeId: string }) => ({ token: g.denemeId, odemeSayfasiUrl: "https://kabul.invalid" })),
  kayitliKartlaOde: vi.fn(async () => ({ durum: "bekliyor" })), odemeSonucu: vi.fn(async () => ({ basarili: true, odemeId: randomUUID(), tutar: 1198.8, dovizCinsi: "TRY" })) };
const odeme = new AbonelikOdemeService(app, { etkin: async () => ({ saglayici: "iyzico", ortam: "test", config: {} }) } as never, { db: { mevzuatOlay: { create: vi.fn() } } } as never, { unut: vi.fn() } as never);
odeme.saglayiciUret = () => provider as never;
vi.spyOn(odeme as never, "posta").mockResolvedValue(undefined as never);
async function firma() {
  const id = randomUUID(); tenantIds.push(id);
  await admin.tenant.create({ data: { id, unvan: `Planlı atama ${id}`, vkn: String(9000000000 + tenantIds.length) } });
  await admin.user.create({ data: { tenantId: id, eposta: `${id}@kabul.invalid`, adSoyad: "Planlı kabul", parolaHash: "x", rol: "yonetici" } });
  await admin.tenantAbonelik.create({ data: { tenantId: id, planKodu: "v1", donemSonu: new Date(Date.now() + 2 * 86400000) } });
  return id;
}
async function surum(gecerlilikTarihi = fiyat.gecerlilikTarihi) {
  const d = await yonetici(() => servis.taslakAc(paketId, ilkId));
  const g = await yonetici(() => servis.guncelle(paketId, d.id, { ad: "Planlı Profesyonel", aciklama: "Planlı fiyat kabulü", ozellikler: ["Rapor"], siralama: 20, kilitSurumu: 1, fiyatlandirma: { ...fiyat, gecerlilikTarihi } }));
  return yonetici(() => servis.yayinla(paketId, g.id, g.kilitSurumu));
}
async function onizle(ids: string[], tur: "tarih" | "donem_sonu" = "tarih", surumId = hedef) {
  return yonetici(() => servis.atamaOnizle({ surumId, tenantIds: ids, uygulamaTuru: tur, uygulamaTarihi: tur === "tarih" ? yarin() : null, neden: "Planlı fiyat kabul kontrolü" }));
}
async function planla(ids: string[], tur: "tarih" | "donem_sonu" = "tarih", surumId = hedef) {
  const p = await onizle(ids, tur, surumId); await yonetici(() => servis.atamaUygula(p.id)); return p;
}
// Üretim işlevlerinde saat atlatma parametresi yoktur; yalnız test sahibi vadeyi geçmişe alır.
const vadesiGeldi = (id: string) => admin.platformPaketAtamasi.update({ where: { id }, data: { uygulanacakAt: new Date(Date.now() - 1000) } });
beforeAll(async () => {
  process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "c".repeat(64);
  for (const id of [kisi, diger]) await admin.platformKullanici.create({ data: { id, eposta: `${id}@kabul.invalid`, adSoyad: "Plan yöneticisi", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  const p = await admin.platformPaket.findUniqueOrThrow({ where: { eskiPlanKodu: "profesyonel" }, include: { surumler: { where: { surumNo: 1 } } } });
  paketId = p.id; ilkId = p.surumler[0].id; hedef = (await surum()).id;
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
describe("planlı katalog fiyat ataması — gerçek PostgreSQL", () => {
  it("Türkiye 00.00 zamanını kaydeder; onay planlar, vadesi gelmeyen abone değişmez", async () => {
    const id = await firma(), once = await abonelik(id), p = await onizle([id]);
    expect(new Date(p.uygulanacakAt!).toISOString()).toBe(`${bugunTR()}T21:00:00.000Z`);
    expect(await yonetici(() => servis.atamaUygula(p.id))).toMatchObject({ durum: "planlandi", tekrar: false });
    expect(await yonetici(() => servis.atamaUygula(p.id))).toMatchObject({ durum: "planlandi", tekrar: true });
    await servis.planliAtamalariIsle(); expect(await abonelik(id)).toEqual(once);
    expect((await kayit(p.id)).uygulandiAt).toBeNull();
  });
  it("dönem sonunu tam anıyla sunucudan alır; birden fazla firmayı reddeder", async () => {
    const id = await firma(), a = await abonelik(id), p = await onizle([id], "donem_sonu");
    expect(new Date(p.uygulanacakAt!).toISOString()).toBe(a.donemSonu!.toISOString());
    await expect(onizle([id, await firma()], "donem_sonu")).rejects.toThrow("tek firma");
    await admin.tenantAbonelik.update({ where: { tenantId: id }, data: { donemSonu: null } });
    await expect(onizle([id], "donem_sonu")).rejects.toThrow("geçerli bir dönem sonu");
  });
  it("aynı vadeyi iki worker işlerse tek atama ve tek denetim olayı oluşur", async () => {
    const ids = [await firma(), await firma()], once = await Promise.all(ids.map(abonelik)), p = await planla(ids);
    await vadesiGeldi(p.id); await Promise.all([servis.planliAtamalariIsle(), servis.planliAtamalariIsle()]);
    expect((await kayit(p.id)).uygulandiAt).not.toBeNull();
    for (let i = 0; i < ids.length; i++) {
      const a = await abonelik(ids[i]); expect(a.paketSurumId).toBe(hedef); expect(a.donemSonu).toEqual(once[i].donemSonu);
      expect(bagliAbonelikTutari(a, 1)?.toplam.toFixed(2)).toBe("1320.00");
    }
    expect(await admin.mevzuatOlay.count({ where: { olay: "firma_paket_fiyati_atandi", detay: { path: ["atamaId"], equals: p.id } } })).toBe(2);
    expect(await admin.platformPaketAtamaFirmasi.count({ where: { atamaId: p.id } })).toBe(0);
  });
  it("kaynak değişirse tüm grup incelemeye alınır, eski fiyatla yeni ödeme açılmaz", async () => {
    const ids = [await firma(), await firma()], p = await planla(ids);
    await admin.tenantAbonelik.update({ where: { tenantId: ids[1] }, data: { faturaEpostasi: "degisti@kabul.invalid" } });
    await vadesiGeldi(p.id); await servis.planliAtamalariIsle();
    expect(await kayit(p.id)).toMatchObject({ uygulandiAt: null, engelNedeni: "atama_kaynak_degisti" });
    for (const id of ids) { expect((await abonelik(id)).paketSurumId).toBe(ilkId); await expect(odeme.baslat(id, 1, "panel", null)).rejects.toThrow("Planlı fiyat geçişi"); }
    await yonetici(() => servis.planIptal(p.id, "Yeniden inceleme için iptal"), diger);
    await expect(odeme.baslat(ids[0], 1, "panel", null)).resolves.toHaveProperty("denemeId");
  });
  it("arşivlenen hedef uygulama anında reddedilir", async () => {
    const s = await surum(), p = await planla([await firma()], "tarih", s.id);
    await yonetici(() => servis.arsivle(paketId, s.id, s.kilitSurumu));
    await vadesiGeldi(p.id); await servis.planliAtamalariIsle();
    expect((await kayit(p.id)).engelNedeni).toBe("atama_hedef_degisti");
  });
  it("onaylayanın yetkisi kaldırılırsa plan durur; başka yönetici iptal edebilir", async () => {
    const p = await planla([await firma()]); await vadesiGeldi(p.id);
    await admin.platformKullanici.update({ where: { id: kisi }, data: { aktif: false } });
    try {
      await servis.planliAtamalariIsle(); expect((await kayit(p.id)).engelNedeni).toBe("atama_yetki");
      await expect(yonetici(() => servis.planIptal(p.id, "Yetki değişikliği sonrası iptal"), diger)).resolves.toMatchObject({ tekrar: false });
    } finally { await admin.platformKullanici.update({ where: { id: kisi }, data: { aktif: true } }); }
  });
  it("iptal tekrarında yeni olay oluşmaz; iptal edilmiş plan uygulanmaz", async () => {
    const id = await firma(), p = await planla([id]);
    await yonetici(() => servis.planIptal(p.id, "Müşteriyle tekrar görüşülecek"));
    expect(await yonetici(() => servis.planIptal(p.id, "Tekrarlanan iptal isteği"))).toMatchObject({ tekrar: true });
    await vadesiGeldi(p.id); await servis.planliAtamalariIsle(); expect((await abonelik(id)).paketSurumId).toBe(ilkId);
    expect(await admin.mevzuatOlay.count({ where: { olay: "firma_paket_atamasi_iptal", detay: { path: ["atamaId"], equals: p.id } } })).toBe(1);
  });
  it("çakışan plan ve hemen atama reddedilir; iptalden sonra yeni plan onaylanır", async () => {
    const id = await firma(), p = await planla([id]), q = await onizle([id]);
    await expect(yonetici(() => servis.atamaUygula(q.id))).rejects.toThrow("bekleyen bir plan");
    const hemen = await yonetici(() => servis.atamaOnizle({ surumId: hedef, tenantIds: [id], uygulamaTarihi: bugunTR(), neden: "Hemen atama kontrolü" }));
    await expect(yonetici(() => servis.atamaUygula(hemen.id))).rejects.toThrow("bekleyen bir plan");
    await yonetici(() => servis.planIptal(p.id, "Yeni plan için iptal"));
    await expect(yonetici(() => servis.atamaUygula(q.id))).resolves.toMatchObject({ durum: "planlandi" });
  });
  it("erken otomatik çekim sayaç tüketmeden bekler; uygulamadan sonra yeni fiyatla açılır", async () => {
    const id = await firma();
    await admin.abonelikKarti.create({ data: { tenantId: id, saglayici: "iyzico", ortam: "test", sifreliAnahtarlar: sifrele('{}'), aySayisi: 1 } });
    const p = await planla([id], "donem_sonu"), once = await admin.abonelikKarti.findUniqueOrThrow({ where: { tenantId: id } });
    expect(await odeme.otomatikYenile(id)).toBe("atlandi");
    expect(await admin.abonelikKarti.findUniqueOrThrow({ where: { tenantId: id } })).toEqual(once);
    await vadesiGeldi(p.id); await expect(odeme.baslat(id, 1, "eposta", null)).rejects.toThrow("Planlı fiyat geçişi");
    await servis.planliAtamalariIsle(); expect(await odeme.otomatikYenile(id)).toBe("bekliyor");
    const d = await admin.abonelikOdemeDenemesi.findFirstOrThrow({ where: { tenantId: id, kaynak: "otomatik" } });
    expect(d.toplam.toFixed(2)).toBe("1320.00"); expect(d.fiyatFotografi).toMatchObject({ kaynak: "katalog_atamasi", paketSurumId: hedef });
  });
  it("eski girişim sonuçlanabilir; değişen dönem planı incelemeye taşır", async () => {
    const id = await firma(), d = await odeme.baslat(id, 1, "panel", null), p = await planla([id], "donem_sonu");
    await vadesiGeldi(p.id);
    await expect(odeme.callback(id, d.denemeId, d.denemeId)).resolves.toMatchObject({ tekrar: false });
    await servis.planliAtamalariIsle(); expect((await kayit(p.id)).engelNedeni).toBe("atama_kaynak_degisti");
    const o = await admin.abonelikOdemesi.findFirstOrThrow({ where: { tenantId: id } });
    expect(o.tutar.toFixed(2)).toBe("1198.80");
  });
  it("uygulama günü gelmemiş hedef fiyatı planlanabilir ama erkenden uygulanamaz", async () => {
    const s = await surum(yarin()), id = await firma(), p = await planla([id], "tarih", s.id);
    await vadesiGeldi(p.id); await servis.planliAtamalariIsle();
    expect((await kayit(p.id)).engelNedeni).toBe("atama_fiyat_henuz_gecerli_degil");
  });
  it("geçersiz tarih aralığı, süresi dolmuş onay ve değişen kaynak planlanmaz", async () => {
    const id = await firma();
    for (const uygulamaTarihi of [bugunTR(), gunEkle(bugunTR(), 367)]) await expect(yonetici(() => servis.atamaOnizle({ surumId: hedef, tenantIds: [id], uygulamaTuru: "tarih", uygulamaTarihi, neden: "Tarih sınırı kontrolü" }))).rejects.toThrow("366 gün");
    const p = await onizle([id]);
    await admin.platformPaketAtamasi.update({ where: { id: p.id }, data: { sonOnayAt: new Date(0) } });
    await expect(yonetici(() => servis.atamaUygula(p.id))).rejects.toThrow("onay süresi");
    const q = await onizle([id]); await admin.tenantAbonelik.update({ where: { tenantId: id }, data: { durum: "askida" } });
    await expect(yonetici(() => servis.atamaUygula(q.id))).rejects.toThrow("Yeni bir atama önizlemesi");
  });
  it("iptal/worker yarışı tek sonuç verir; uygulanmış atama iptal edilemez", async () => {
    const id = await firma(), p = await planla([id]); await vadesiGeldi(p.id);
    await Promise.allSettled([yonetici(() => servis.planIptal(p.id, "Yarış kontrolü iptali")), servis.planliAtamalariIsle()]);
    const k = await kayit(p.id); expect(Boolean(k.iptalAt)).not.toBe(Boolean(k.uygulandiAt));
    expect((await abonelik(id)).paketSurumId).toBe(k.uygulandiAt ? hedef : ilkId);
    if (k.uygulandiAt) await expect(yonetici(() => servis.planIptal(p.id, "Geç kalmış iptal"))).rejects.toThrow("kapanmış");
  });
  it("geçici hata diğer planları aç bırakmaz; geri alınan atama sonraki taramada uygulanır", async () => {
    const p = await planla([await firma()]), q = await planla([await firma()]); await vadesiGeldi(p.id); await vadesiGeldi(q.id);
    const casus = vi.spyOn(servis as never, "atamaOlayi").mockRejectedValueOnce(new Error("Geçici denetim yazma hatası") as never);
    try { await expect(servis.planliAtamalariIsle()).rejects.toThrow("yeniden denenecek"); }
    finally { casus.mockRestore(); }
    const ks = await Promise.all([kayit(p.id), kayit(q.id)]); expect(ks.filter((k) => k.uygulandiAt)).toHaveLength(1);
    await servis.planliAtamalariIsle(); expect((await kayit(p.id)).uygulandiAt).not.toBeNull(); expect((await kayit(q.id)).uygulandiAt).not.toBeNull();
  });
  it("plan listesi toplamı boş sayfada korur; editör ve DB yazma sınırları uygulanır", async () => {
    const r = await yonetici(() => servis.planliAtamalar({ sayfa: 1, surumId: hedef })) as { toplam: number };
    expect(r.toplam).toBeGreaterThan(0);
    expect(await yonetici(() => servis.planliAtamalar({ sayfa: 100000, surumId: hedef }))).toMatchObject({ toplam: r.toplam, kayitlar: [] });
    await platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "editor@kabul.invalid", rol: "mevzuat_editoru" }, async () => {
      await expect(servis.planliAtamalar({ sayfa: 1 })).rejects.toThrow("yöneticisi");
      await expect(servis.planIptal(randomUUID(), "Editör iptal denemesi")).rejects.toThrow("yöneticisi");
    });
    await expect(platform.$executeRaw`UPDATE platform_paket_atamalari SET uygulanacak_at=clock_timestamp()`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT platform_paket_plan_isle(${randomUUID()}::uuid)`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM platform_paket_atama_firmalari`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT abonelik_planli_atama_bekle(true)`).rejects.toThrow("Kiraci baglami");
  });
});
