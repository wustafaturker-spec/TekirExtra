import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAKET_MODUL_KODLARI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { KayitService } from "../src/tenant/kayit.service";
import { bagliAbonelikTutari, etkinAbonelikPlani } from "../src/tenant/abonelik-kosullari";
import { odemeFiyatFotografi } from "../src/abonelik-odeme/odeme-fiyat-fotografi";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const yoneticiId = randomUUID();
const platformPaket = new PlatformPaketService({ db: platform } as never);
const kayit = new KayitService(app as never, { dogrulamaGonder: async () => undefined } as never);
const fiyatlandirma = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: [{ aySayisi: 1 as const, matrah: "123.45" }] };
const kapsam: PaketKapsamSozlesmesi = { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: {
  kullanici: { sinir: 7, uyariYuzdesi: 80 }, cari: { sinir: 80, uyariYuzdesi: 80 }, stok: { sinir: 120, uyariYuzdesi: 80 }, aylikFatura: { sinir: 60, uyariYuzdesi: 80 },
} };
/** Kayıt GİB sözlüğünden il + ilçe + daire üçlüsü ister (seed migration'ı). */
const firmaKimligi = { kisiTuru: "tuzel" as const, il: "Adana", ilce: "Ceyhan", vergiDairesi: "Ceyhan Vergi Dairesi Müdürlüğü", vergiDairesiKodu: "01201" };
let paketId: string;
let planKodu: string;

const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: yoneticiId, eposta: "kayit-kabul@invalid.test", rol: "yonetici" }, is);

beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: yoneticiId, eposta: `${yoneticiId}@invalid.test`, adSoyad: "Kayıt kabul", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  planKodu = `kayit_${randomUUID().slice(0, 8)}`;
  const paket = await yonetici(() => platformPaket.olustur({
    kod: planKodu, ad: "Kayıt kabul paketi", aciklama: "Eski plana bağlı olmayan self servis satış",
    ozellikler: ["Kayıt kabul"], siralama: 10, fiyatlandirma, kapsamSozlesmesi: kapsam,
  }));
  paketId = paket.id;
  const surum = await yonetici(() => platformPaket.yayinla(paketId, paket.surum.id, paket.surum.kilitSurumu));
  const durum = await yonetici(() => platformPaket.satisGetir(paketId));
  await yonetici(() => platformPaket.satisDegistir(paketId, { acik: true, surumId: surum.id, kilitSurumu: durum.kilitSurumu, surumKilitSurumu: surum.kilitSurumu, neden: "Yeni kayıt kabul senaryosu" }));
});

afterAll(async () => {
  if (paketId) {
    const durum = await yonetici(() => platformPaket.satisGetir(paketId));
    if (durum.acik) await yonetici(() => platformPaket.satisDegistir(paketId, { acik: false, surumId: null, kilitSurumu: durum.kilitSurumu, surumKilitSurumu: null, neden: "Kayıt kabul senaryosu kapatıldı" }));
  }
  // Firma and sale audit rows intentionally remain until the isolated test DB is dropped.
  await Promise.all([admin.$disconnect(), platform.$disconnect(), app.$disconnect()]);
});

describe("yeni firma kaydında açık katalog satışı — gerçek PostgreSQL", () => {
  it("yalnız açık sürümü gösterir, seçilen fiyat/kapsamı aboneliğe sabitler ve eski kimlikle sahte seçimi reddeder", async () => {
    const teklifler = await kayit.acikSatisPaketleri();
    expect(teklifler).toHaveLength(1);
    expect(teklifler[0]).toMatchObject({ planKodu, paketAdi: "Kayıt kabul paketi", denemeGunSayisi: 0 });
    expect(teklifler[0].kosullar).toMatchObject({
      semaSurumu: 2, kaynak: "katalog_atamasi", planKodu,
      fiyatlandirma: { paraBirimi: "TRY", kdvOrani: "20", donemler: [{ aySayisi: 1, matrah: "123.45" }] },
      limitler: { kullanici: 7, cari: 80, stok: 120, aylikFatura: 60 }, kapsamSozlesmesi: kapsam,
    });
    await expect(kayit.kaydet({ ...firmaKimligi, unvan: "Paket seçimi hatası AŞ", vkn: String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)), yoneticiEposta: `${randomUUID()}@invalid.test`, yoneticiAdSoyad: "Kabul Kullanıcı", parola: "GucluParola2026", paketSurumId: randomUUID() })).rejects.toThrow("satıştan kalkmış");
    const sonuc = await kayit.kaydet({
      ...firmaKimligi, unvan: "Açık katalogla kayıt AŞ", vkn: String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)),
      yoneticiEposta: `${randomUUID()}@invalid.test`, yoneticiAdSoyad: "Kabul Kullanıcı", parola: "GucluParola2026",
      paketSurumId: teklifler[0].surumId,
    });
    const abonelik = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: sonuc.tenantId } });
    expect(abonelik).toMatchObject({ planKodu, paketSurumId: teklifler[0].surumId, paketKosullari: teklifler[0].kosullar, durum: "aktif", donemBaslangici: null, donemSonu: null });
    expect(etkinAbonelikPlani(abonelik)).toMatchObject({ kod: planKodu, ad: "Kayıt kabul paketi", aylikFiyat: 123.45, limitler: { kullanici: 7, cari: 80, stok: 120, aylikFatura: 60 } });
    const tutar = bagliAbonelikTutari(abonelik, 1)!;
    expect([tutar.matrah.toFixed(2), tutar.kdv.toFixed(2), tutar.toplam.toFixed(2)]).toEqual(["123.45", "24.69", "148.14"]);
    expect(odemeFiyatFotografi(tutar)).toMatchObject({ semaSurumu: 2, kaynak: "katalog_atamasi", planKodu, planAdi: "Kayıt kabul paketi", paketSurumId: teklifler[0].surumId });
    expect(await admin.authKimlik.findFirst({ where: { tenantId: sonuc.tenantId } })).not.toBeNull();
    const appOffer = await app.$queryRaw<{ surumId: string }[]>`SELECT surum_id AS "surumId" FROM abonelik_acik_satis_bagi()`;
    expect(appOffer).toEqual([{ surumId: teklifler[0].surumId }]);
  });

  it("yeni satış sürümünün deneme süresi yalnız sonraki firmaya uygulanır ve yayınlandıktan sonra korunur", async () => {
    const onceki = await admin.tenantAbonelik.findFirstOrThrow({ where: { planKodu } });
    const satis = await yonetici(() => platformPaket.satisGetir(paketId));
    const taslak = await yonetici(() => platformPaket.taslakAc(paketId, satis.surum!.id));
    expect(taslak.denemeGunSayisi).toBe(0);
    const guncel = await yonetici(() => platformPaket.guncelle(paketId, taslak.id, {
      ad: taslak.ad, aciklama: taslak.aciklama, ozellikler: taslak.ozellikler as string[], siralama: taslak.siralama,
      kilitSurumu: taslak.kilitSurumu, fiyatlandirma, kapsamSozlesmesi: kapsam, denemeGunSayisi: 14,
    }));
    const yayin = await yonetici(() => platformPaket.yayinla(paketId, guncel.id, guncel.kilitSurumu));
    await expect(admin.platformPaketSurumu.update({ where: { id: yayin.id }, data: { denemeGunSayisi: 15 } })).rejects.toThrow();
    await yonetici(() => platformPaket.satisDegistir(paketId, { acik: true, surumId: yayin.id, kilitSurumu: satis.kilitSurumu, surumKilitSurumu: yayin.kilitSurumu, neden: "Yeni kayıtlara 14 gün deneme" }));
    expect((await kayit.acikSatisPaketleri())[0]).toMatchObject({ surumId: yayin.id, denemeGunSayisi: 14 });
    const sonuc = await kayit.kaydet({ ...firmaKimligi, unvan: "Deneme katalog kabul AŞ", vkn: String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)), yoneticiEposta: `${randomUUID()}@invalid.test`, yoneticiAdSoyad: "Deneme Kullanıcı", parola: "GucluParola2026", paketSurumId: yayin.id });
    const abonelik = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: sonuc.tenantId } });
    expect(abonelik).toMatchObject({ durum: "deneme", paketSurumId: yayin.id });
    expect(abonelik.donemSonu!.getTime() - abonelik.donemBaslangici!.getTime()).toBe(14 * 86_400_000);
    expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { id: onceki.id } })).toEqual(onceki);
    const kopya = await yonetici(() => platformPaket.taslakAc(paketId, yayin.id));
    expect(kopya.denemeGunSayisi).toBe(14);
    const korunan = await yonetici(() => platformPaket.guncelle(paketId, kopya.id, {
      ad: kopya.ad, aciklama: kopya.aciklama, ozellikler: kopya.ozellikler as string[], siralama: kopya.siralama,
      kilitSurumu: kopya.kilitSurumu, fiyatlandirma, kapsamSozlesmesi: kapsam,
    }));
    expect(korunan.denemeGunSayisi).toBe(14);
  });
});
