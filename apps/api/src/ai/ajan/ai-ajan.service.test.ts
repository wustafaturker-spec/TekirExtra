import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { istekBaglami } from "../../core/istek-baglami";
import { SenaryoAiProvider } from "../saglayici/mock-ai.provider";
import { TanimsizAiProvider } from "../saglayici/tanimsiz-ai.provider";
import type { AiAracliYanit } from "../saglayici/ai-provider.interface";
import { AJAN_ARACLARI, aracTanimi } from "./araclar";
import { AiAjanService } from "./ai-ajan.service";
import { AracYurutucu } from "./arac-yurutucu";

const KIMLIK = { tenantId: "11111111-1111-1111-1111-111111111111", userId: "22222222-2222-2222-2222-222222222222" };
const CARI_ID = "3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12";
const BELGE_ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";

function kur(yanitlar: AiAracliYanit[], secenek: { yetkiliMi?: (ad: string) => boolean; ucSonucu?: (yol: string, arg: unknown[]) => unknown } = {}) {
  const tx = {
    user: { findFirst: vi.fn().mockResolvedValue({ adSoyad: "Ayşe Satış" }) },
    ajanOturumu: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "oturum-1", userId: KIMLIK.userId }),
      update: vi.fn(),
    },
    ajanMesajGecmisi: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const uc = {
    yetkiliMi: vi.fn((u: { yol: string }) => (secenek.yetkiliMi ? secenek.yetkiliMi(u.yol) : true)),
    cagir: vi.fn(async (u: { yol: string }, arg: unknown[]) => secenek.ucSonucu?.(u.yol, arg) ?? {}),
  };
  const onay = { olustur: vi.fn(async (g: { arac: string; ozet: string }) => ({ id: "talep-1", arac: g.arac, ozet: g.ozet, durum: "bekliyor" })) };
  const saglayici = new SenaryoAiProvider(yanitlar);
  const service = new AiAjanService(prisma as never, new AracYurutucu(uc as never, onay as never));
  service.saglayiciBul = async () => ({ saglayici, ozelTalimatlar: null });
  const calistir = (mesaj: string, rol = "satis") => istekBaglami.run({ deger: { ...KIMLIK, rol: rol as never } }, () => service.mesajiIsle(mesaj));
  return { service, tx, uc, onay, saglayici, calistir };
}

describe("asistan araç döngüsü (AI-05)", () => {
  it("sağlayıcı tanımsızsa asistan kapalıdır ve hiçbir şey yazmaz", async () => {
    const k = kur([]);
    k.service.saglayiciBul = async () => ({ saglayici: new TanimsizAiProvider(), ozelTalimatlar: null });
    const y = await k.calistir("merhaba");
    expect(y.asistanKapali).toBe(true);
    expect(k.tx.ajanMesajGecmisi.create).not.toHaveBeenCalled();
  });

  it("okuma aracını çalıştırır, sonucu modele verir ve son yanıtı kaydeder", async () => {
    const k = kur(
      [
        { metin: "", aracCagrilari: [{ id: "c1", ad: "cari_ara", girdi: { arama: "Yılmaz" } }] },
        { metin: "Yılmaz Ticaret bakiyesi 10.000,00 TL.", aracCagrilari: [] },
      ],
      { ucSonucu: (yol) => (yol === "GET /cari" ? { kayitlar: [{ id: CARI_ID, kod: "C1", unvan: "Yılmaz Ticaret", bakiyeler: [{ dovizCinsi: "TRY", bakiye: "10000.00" }], izinliEylemler: ["x"] }] } : {}) },
    );
    const y = await k.calistir("Yılmaz bakiyesi");
    expect(y.cevap).toBe("Yılmaz Ticaret bakiyesi 10.000,00 TL.");
    expect(k.uc.cagir).toHaveBeenCalledWith(expect.objectContaining({ yol: "GET /cari" }), ["Yılmaz", undefined, "10", undefined], expect.objectContaining({ kaynak: "asistan", arac: "cari_ara" }));
    const ikinciTur = k.saglayici.girdiler[1].mesajlar;
    const sonuc = ikinciTur.find((m) => m.rol === "arac_sonucu");
    expect(sonuc && "icerik" in sonuc && sonuc.icerik).toContain("Yılmaz Ticaret");
    // Gereksiz alanlar modele gitmez.
    expect(sonuc && "icerik" in sonuc && sonuc.icerik).not.toContain("izinliEylemler");
    expect(k.tx.ajanMesajGecmisi.create).toHaveBeenCalledTimes(2);
  });

  it("rolün ekranda giremediği uçların araçları modele sunulmaz", async () => {
    const k = kur([{ metin: "tamam", aracCagrilari: [] }], { yetkiliMi: (yol) => yol.startsWith("GET ") });
    await k.calistir("merhaba");
    const sunulan = k.saglayici.girdiler[0].araclar.map((a) => a.ad);
    expect(sunulan).toContain("cari_ara");
    expect(sunulan).not.toContain("belge_onayla");
    expect(sunulan).not.toContain("belge_taslagi_olustur");
  });

  it("modelin sunulmamış bir aracı çağırması çalıştırılmaz, hata olarak döner", async () => {
    const k = kur(
      [
        { metin: "", aracCagrilari: [{ id: "c1", ad: "fatura_kesinlestir", girdi: { faturaId: BELGE_ID } }] },
        { metin: "Yetkiniz yok.", aracCagrilari: [] },
      ],
      { yetkiliMi: (yol) => yol.startsWith("GET ") },
    );
    const y = await k.calistir("faturayı kesinleştir");
    expect(k.onay.olustur).not.toHaveBeenCalled();
    expect(y.araclar).toEqual([{ ad: "fatura_kesinlestir", sinif: "bilinmiyor", basarili: false }]);
  });

  it("onaya tabi araç işlem yapmaz; talep açar ve modele işlemin yapılmadığını söyler", async () => {
    const k = kur(
      [
        { metin: "", aracCagrilari: [{ id: "c1", ad: "belge_onayla", girdi: { belgeId: BELGE_ID } }] },
        { metin: "Teklif onayınıza sunuldu.", aracCagrilari: [] },
      ],
      { ucSonucu: (yol) => (yol === "GET /belgeler/:id" ? { tur: "teklif", no: null, cari: { unvan: "Kaya Ltd" }, genelToplam: "1200", dovizCinsi: "TRY", durum: "taslak" } : {}) },
    );
    const y = await k.calistir("teklifi onayla");
    expect(k.uc.cagir).not.toHaveBeenCalledWith(expect.objectContaining({ yol: "POST /belgeler/:id/onayla" }), expect.anything(), expect.anything());
    expect(k.onay.olustur).toHaveBeenCalledWith(expect.objectContaining({ arac: "belge_onayla", parametreler: { belgeId: BELGE_ID }, kaynak: "asistan", oturumId: "oturum-1" }));
    expect(k.onay.olustur.mock.calls[0][0].ozet).toContain("Kaya Ltd");
    expect(y.onayTalepleri.map((t) => t.id)).toEqual(["talep-1"]);
    const sonuc = k.saglayici.girdiler[1].mesajlar.find((m) => m.rol === "arac_sonucu");
    expect(sonuc && "icerik" in sonuc && sonuc.icerik).toContain("YAPILMADI");
  });

  it("kesik yazılmış araç adında doğru adı önerir", async () => {
    const k = kur([
      { metin: "", aracCagrilari: [{ id: "c1", ad: "belge_taslagi_olust", girdi: {} }] },
      { metin: "Tamam.", aracCagrilari: [] },
    ]);
    await k.calistir("teklif");
    const sonuc = k.saglayici.girdiler[1].mesajlar.find((m) => m.rol === "arac_sonucu");
    expect(sonuc && "icerik" in sonuc && sonuc.icerik).toContain('"belge_taslagi_olustur" aracını kastettiysen');
  });

  it("geçersiz parametre aracı çalıştırmaz, doğrulama hatasını modele döner", async () => {
    const k = kur([
      { metin: "", aracCagrilari: [{ id: "c1", ad: "cari_getir", girdi: { cariId: "yok" } }] },
      { metin: "Cari bulunamadı.", aracCagrilari: [] },
    ]);
    await k.calistir("cariyi getir");
    expect(k.uc.cagir).not.toHaveBeenCalled();
    const sonuc = k.saglayici.girdiler[1].mesajlar.find((m) => m.rol === "arac_sonucu");
    expect(sonuc && "hata" in sonuc && sonuc.hata).toBe(true);
  });

  it("araç çağırmadan işlem yapıldı diyen yanıtı bir kez düzelttirir, yine uydurursa göstermez", async () => {
    const k = kur([
      { metin: "Teklif taslağı oluşturuldu: /panel/belge/a1b2c3d4-e5f6-7890-1234-567890abcdef", aracCagrilari: [] },
      { metin: "Teklif hazırlandı.", aracCagrilari: [] },
    ]);
    const y = await k.calistir("teklif hazırla");
    expect(k.saglayici.girdiler).toHaveLength(2);
    const duzeltme = k.saglayici.girdiler[1].mesajlar.at(-1);
    expect(duzeltme && "metin" in duzeltme && duzeltme.metin).toContain("[Sistem denetimi]");
    expect(y.cevap).toContain("doğrulanamadı");
    expect(y.cevap).not.toContain("a1b2c3d4");
  });

  it("düzeltme isteğinden sonra aracı çağıran model normal devam eder", async () => {
    const k = kur([
      { metin: "Onayınıza sunuldu.", aracCagrilari: [] },
      { metin: "", aracCagrilari: [{ id: "c1", ad: "belge_onayla", girdi: { belgeId: BELGE_ID } }] },
      { metin: "Teklif onayınıza sunuldu.", aracCagrilari: [] },
    ], { ucSonucu: () => ({ tur: "teklif", cari: { unvan: "Kaya" }, genelToplam: "1", dovizCinsi: "TRY", durum: "taslak" }) });
    const y = await k.calistir("onayla");
    expect(y.cevap).toBe("Teklif onayınıza sunuldu.");
    expect(y.onayTalepleri).toHaveLength(1);
  });

  it("içeriksiz model yanıtını yeniden dener", async () => {
    const k = kur([
      { metin: "", aracCagrilari: [] },
      { metin: "", aracCagrilari: [{ id: "c1", ad: "masraf_kategorileri", girdi: {} }] },
      { metin: "Kategoriler listelendi.", aracCagrilari: [] },
    ], { ucSonucu: () => [] });
    const y = await k.calistir("kategoriler");
    expect(y.cevap).toBe("Kategoriler listelendi.");
    expect(y.araclar).toHaveLength(1);
  });

  it("tur sınırında durur, sonsuz araç döngüsüne girmez", async () => {
    const dongu = Array.from({ length: 20 }, () => ({ metin: "", aracCagrilari: [{ id: "c", ad: "masraf_kategorileri", girdi: {} }] }));
    const k = kur(dongu, { ucSonucu: () => [] });
    const y = await k.calistir("döngü");
    expect(k.saglayici.girdiler.length).toBe(8);
    expect(y.cevap).toContain("tamamlanamadı");
  });
});

describe("araç kaydı (AI-03/AI-06)", () => {
  it("silme aracı yoktur; her aracın sınıfı vardır, onaya tabi olanlar özet üretir", () => {
    expect(AJAN_ARACLARI.length).toBeGreaterThan(20);
    for (const a of AJAN_ARACLARI) {
      expect(a.ad).not.toMatch(/(^|_)sil(_|$)/);
      expect(a.uc.yol).not.toMatch(/^DELETE /);
      expect(["okuma", "taslak", "onay"]).toContain(a.sinif);
      if (a.sinif === "onay") expect(a.ozetle).toBeTypeOf("function");
    }
  });

  it("kesinleştiren, gönderen, para ve kart değiştiren, iptal eden araçlar onaya tabidir", () => {
    const onayli = new Set(AJAN_ARACLARI.filter((a) => a.sinif === "onay").map((a) => a.ad));
    for (const ad of ["belge_onayla", "fatura_kesinlestir", "belge_eposta_gonder", "fatura_eposta_gonder", "ebelge_gonder", "cari_ekstre_eposta", "kasa_banka_hareketi_kaydet", "cari_olustur", "cari_guncelle", "stok_karti_olustur", "stok_karti_guncelle", "belge_iptal", "fatura_iptal"]) {
      expect(onayli.has(ad), ad).toBe(true);
    }
    for (const a of AJAN_ARACLARI.filter((x) => x.sinif !== "onay")) expect(a.uc.yol, a.ad).not.toMatch(/onayla|kesinlestir|gonder|iptal|hareketler|^POST \/cari$|^POST \/stok$|^PATCH /);
  });

  it("her araç sağlayıcıların anladığı JSON şemasına çevrilir", () => {
    for (const a of AJAN_ARACLARI) {
      const t = aracTanimi(a);
      expect(t.girdiSemasi.type, a.ad).toBe("object");
      expect(JSON.stringify(t.girdiSemasi)).not.toMatch(/additionalProperties|\$schema|anyOf/);
    }
    expect(aracTanimi(AJAN_ARACLARI.find((a) => a.ad === "belge_onayla")!).aciklama).toContain("ONAY GEREKİR");
  });

  it("gelir-giderde bitişi kullanıcı istemedikçe bugüne çeker", async () => {
    const gg = AJAN_ARACLARI.find((a) => a.ad === "gelir_gider")!;
    const cagrilar: unknown[][] = [];
    const uc = { cagir: async (_u: unknown, arg: unknown[]) => { cagrilar.push(arg); return { uyarilar: [] }; } };
    const b = { uc: uc as never, kaynak: "asistan" as const, arac: gg.ad };
    const sonuc = (await gg.calistir(b, gg.girdi.parse({ baslangic: "2026-01-01", bitis: "2999-12-31" }))) as { uyarilar: string[] };
    expect(cagrilar[0][1]).not.toBe("2999-12-31");
    expect(sonuc.uyarilar[0]).toContain("bugüne");
    await gg.calistir(b, gg.girdi.parse({ baslangic: "2026-01-01", bitis: "2999-12-31", ileriTarihDahil: true }));
    expect(cagrilar[1][1]).toBe("2999-12-31");
  });

  it("başka dövizdeki liste fiyatını ürün kuruyla çevirtir ve liste iskontosunu uygular", async () => {
    const taslak = AJAN_ARACLARI.find((a) => a.ad === "belge_taslagi_olustur")!;
    const cagrilar: Array<{ yol: string; arg: unknown[] }> = [];
    const uc = {
      cagir: async (u: { yol: string }, arg: unknown[]) => {
        cagrilar.push({ yol: u.yol, arg });
        if (u.yol === "GET /stok/:id") return { ad: "Bez", kdvOrani: "10", anaBirim: "adet" };
        if (u.yol === "GET /doviz-kurlari") return { kurlar: { USD: 40 } };
        if (u.yol === "GET /stok/:id/tavsiye-fiyat") {
          return arg[6] ? { birimFiyat: 15.2, cevrilebilir: true, kaynakDoviz: "USD", iskontoOrani: 5 } : { birimFiyat: 0.38, cevrilebilir: false, kaynakDoviz: "USD", iskontoOrani: 5 };
        }
        if (u.yol === "POST /belgeler") return { id: BELGE_ID };
        return {};
      },
    };
    await taslak.calistir({ uc: uc as never, kaynak: "asistan", arac: taslak.ad }, taslak.girdi.parse({ tur: "teklif", cariId: CARI_ID, tarih: "2026-10-13", satirlar: [{ stokId: CARI_ID, miktar: 1000 }] }));
    expect(cagrilar.find((c) => c.yol === "GET /doviz-kurlari")!.arg).toEqual(["2026-10-13", "alis"]);
    const satir = (cagrilar.find((c) => c.yol === "POST /belgeler")!.arg[0] as { satirlar: Array<Record<string, string>> }).satirlar[0];
    expect(satir).toMatchObject({ birimFiyat: "15.2000", iskontoOrani: "5" });
  });

  it("çevrilemeyen fiyatı yazmaz, fiyatı kullanıcıdan istetir", async () => {
    const taslak = AJAN_ARACLARI.find((a) => a.ad === "belge_taslagi_olustur")!;
    const uc = {
      cagir: async (u: { yol: string }) => {
        if (u.yol === "GET /stok/:id") return { ad: "Bez", kdvOrani: "10", anaBirim: "adet" };
        if (u.yol === "GET /doviz-kurlari") return { kurlar: { USD: 40 } };
        if (u.yol === "GET /stok/:id/tavsiye-fiyat") return { birimFiyat: 0.38, cevrilebilir: false, kaynakDoviz: "USD" };
        throw new Error("belge açılmamalı");
      },
    };
    await expect(taslak.calistir({ uc: uc as never, kaynak: "asistan", arac: taslak.ad }, taslak.girdi.parse({ tur: "teklif", cariId: CARI_ID, satirlar: [{ stokId: CARI_ID, miktar: 1 }] }))).rejects.toThrow(/birim fiyatı kullanıcıdan/);
  });

  it("taslak araç satırı karttaki KDV ve birimle, fiyat yoksa fiyat önerisiyle doldurur", async () => {
    const taslak = AJAN_ARACLARI.find((a) => a.ad === "belge_taslagi_olustur")!;
    const cagrilar: Array<{ yol: string; arg: unknown[] }> = [];
    const uc = {
      cagir: async (u: { yol: string }, arg: unknown[]) => {
        cagrilar.push({ yol: u.yol, arg });
        if (u.yol === "GET /stok/:id") return { ad: "A4 Kağıt", kdvOrani: "10", anaBirim: "koli" };
        if (u.yol === "GET /stok/:id/tavsiye-fiyat") return { birimFiyat: 125.5 };
        if (u.yol === "POST /belgeler") return { id: BELGE_ID, durum: "taslak" };
        return {};
      },
    };
    const g = z.object({}).passthrough().parse({ tur: "teklif", cariId: CARI_ID, satirlar: [{ stokId: CARI_ID, miktar: 5 }] });
    const sonuc = await taslak.calistir({ uc: uc as never, kaynak: "asistan", arac: taslak.ad }, taslak.girdi.parse(g));
    const govde = cagrilar.find((c) => c.yol === "POST /belgeler")!.arg[0] as { satirlar: Array<Record<string, string>>; durum?: string; kur: string };
    expect(govde.satirlar[0]).toMatchObject({ kdvOrani: "10", birim: "koli", birimFiyat: "125.5000", miktar: "5" });
    expect(govde.kur).toBe("1");
    expect(sonuc).toMatchObject({ id: BELGE_ID, adres: `/panel/belgeler?odak=${BELGE_ID}` });
  });
});
