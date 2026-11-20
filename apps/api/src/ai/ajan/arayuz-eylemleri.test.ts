import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { SenaryoAiProvider } from "../saglayici/mock-ai.provider";
import { AiAjanService } from "./ai-ajan.service";
import { AracYurutucu } from "./arac-yurutucu";
import { arayuzAraclariniSec, arayuzEylemiHazirla, arayuzSonucMetni, type ArayuzBaglami } from "./arayuz-eylemleri";
import { telegramAraclari } from "./telegram-veri-kapisi";

const KIMLIK = { tenantId: "11111111-1111-1111-1111-111111111111", userId: "22222222-2222-2222-2222-222222222222" };
const CARI = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";
const STOK = "8b2e3f40-5c6d-4e7f-9081-92a31b2c3d4e";
const BASKA = "9c3f4051-6d7e-4f80-a192-a3b42c3d4e5f";

function baglam(ek: Partial<ArayuzBaglami> = {}): ArayuzBaglami {
  return {
    uc: { cagir: vi.fn(async (_u: unknown, arg: unknown[]) => { if (arg[0] === BASKA) throw new NotFoundException("yok"); return { id: arg[0], unvan: "Deneme A.Ş.", ad: "Ziraat TL", no: "FTR1" }; }) } as never,
    kayitOku: vi.fn(async (_tur: string, id: string) => { if (id === BASKA || id.endsWith(BASKA)) throw new NotFoundException("yok"); return { id }; }),
    kaynakMetni: "",
    ...ek,
  };
}

describe("arayüz eylemi doğrulaması (AI-114)", () => {
  it("sayfaya_git: izinli yol yönlendirilir; dış adres ve yetki dışı kayıt reddedilir", async () => {
    expect(await arayuzEylemiHazirla("sayfaya_git", { yol: "/panel/fatura?yon=satis" }, baglam())).toMatchObject({ eylem: { tur: "sayfaya_git", yol: "/panel/fatura?yon=satis" } });
    expect(await arayuzEylemiHazirla("sayfaya_git", { yol: "https://kotu.example/panel/x" }, baglam())).toMatchObject({ hata: expect.stringContaining("izinli değil") });
    expect(await arayuzEylemiHazirla("sayfaya_git", { yol: `/panel/cari/${BASKA}` }, baglam())).toMatchObject({ hata: expect.stringContaining("yetkisi yok") });
  });

  it("suzgec_uygula: ekran durumu gerekir; tanımsız alan ve yetki dışı hesap reddedilir", async () => {
    expect(await arayuzEylemiHazirla("suzgec_uygula", { suzgecler: [{ alan: "durum", deger: "kesin" }] }, baglam())).toMatchObject({ hata: expect.stringContaining("önce sayfaya_git") });
    const durum = { ekran: "kasa_banka_hareketleri" as const };
    expect(await arayuzEylemiHazirla("suzgec_uygula", { suzgecler: [{ alan: "tutar", deger: "5" }] }, baglam({ durum }))).toMatchObject({ hata: expect.stringContaining("süzgeci değil") });
    expect(await arayuzEylemiHazirla("suzgec_uygula", { suzgecler: [{ alan: "hesap", deger: `kasa:${BASKA}` }] }, baglam({ durum }))).toMatchObject({ hata: expect.stringContaining("yetki dışı") });
    expect(await arayuzEylemiHazirla("suzgec_uygula", { suzgecler: [{ alan: "baslangic", deger: "2026-10-01" }, { alan: "bitis", deger: "2026-10-31" }, { alan: "arama", deger: "" }] }, baglam({ durum })))
      .toEqual({ eylem: { tur: "suzgec_uygula", ekran: "kasa_banka_hareketleri", suzgecler: { baslangic: "2026-10-01", bitis: "2026-10-31", arama: "" } }, ozet: expect.stringContaining("başlangıç=2026-10-01") });
  });

  it("kayit_vurgula: okunamayan kimlik düşer; hiçbiri okunmazsa hata", async () => {
    const durum = { ekran: "faturalar" as const };
    expect(await arayuzEylemiHazirla("kayit_vurgula", { idler: [CARI, BASKA] }, baglam({ durum }))).toMatchObject({ eylem: { idler: [CARI] } });
    expect(await arayuzEylemiHazirla("kayit_vurgula", { idler: [BASKA] }, baglam({ durum }))).toMatchObject({ hata: expect.any(String) });
    expect(await arayuzEylemiHazirla("kayit_vurgula", { idler: [CARI] }, baglam({ durum: { ekran: "masraflar" } }))).toMatchObject({ hata: expect.stringContaining("vurgulanamaz") });
  });

  it("formu_doldur: açık form gerekir; tutar kaynakta yoksa reddedilir; ürün ve cari yetkiyle okunur", async () => {
    const formsuz = { ekran: "faturalar" as const };
    expect(await arayuzEylemiHazirla("formu_doldur", { alanlar: [{ alan: "aciklama", deger: "x" }] }, baglam({ durum: formsuz }))).toMatchObject({ hata: expect.stringContaining("kesinleşmiş belge") });
    const durum = { ekran: "faturalar" as const, form: "fatura" as const };
    const uydurma = await arayuzEylemiHazirla("formu_doldur", { satirlar: [{ stokId: STOK, miktar: 2, birimFiyat: 1500 }] }, baglam({ durum, kaynakMetni: "kalemleri geçen siparişteki gibi doldur" }));
    expect(uydurma).toMatchObject({ hata: expect.stringContaining("1500 tutarı") });
    const kaynakli = await arayuzEylemiHazirla("formu_doldur", { alanlar: [{ alan: "cariId", deger: CARI }, { alan: "aciklama", deger: "Kasım\nhizmeti" }], satirlar: [{ stokId: STOK, miktar: 2, birimFiyat: 1500, kdvOrani: 20 }] }, baglam({ durum, kaynakMetni: '{"birimFiyat":"1500.00"}' }));
    expect(kaynakli).toEqual({ eylem: { tur: "formu_doldur", form: "fatura", alanlar: { cariId: CARI, aciklama: "Kasım hizmeti" }, satirlar: [{ stokId: STOK, miktar: 2, birimFiyat: 1500, kdvOrani: 20 }] }, ozet: expect.stringContaining("1 kalem") });
    expect(await arayuzEylemiHazirla("formu_doldur", { satirlar: [{ stokId: BASKA, miktar: 1 }] }, baglam({ durum }))).toMatchObject({ hata: expect.stringContaining("ürünü bulunamadı") });
    expect(await arayuzEylemiHazirla("formu_doldur", { alanlar: [{ alan: "genelToplam", deger: 5 }] }, baglam({ durum }))).toMatchObject({ hata: expect.stringContaining("alanı değil") });
    expect(await arayuzEylemiHazirla("formu_doldur", { satirlar: [{ stokId: STOK, miktar: 1 }] }, baglam({ durum: { ekran: "masraflar", form: "masraf" } }))).toMatchObject({ hata: expect.stringContaining("kalem almaz") });
  });

  it("tarayıcı sonuçları modele kısa not olur", () => {
    expect(arayuzSonucMetni([{ tur: "suzgec_uygula", sonuc: "geri_alindi" }])).toContain("suzgec_uygula: kullanıcı geri aldı");
    expect(arayuzSonucMetni([])).toBe("");
  });
});

describe("arayüz eylemleri asistan döngüsünde (AI-114)", () => {
  function kur(yanitlar: ConstructorParameters<typeof SenaryoAiProvider>[0]) {
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue({ adSoyad: "Ayşe" }) },
      ajanOturumu: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "oturum-1", userId: KIMLIK.userId }), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      ajanMesajGecmisi: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "m" }), update: vi.fn() },
    };
    const uc = { yetkiliMi: vi.fn(() => true), cagir: vi.fn(async (_u: unknown, arg: unknown[]) => ({ id: arg[0], no: "SNC2026000000001" })) };
    const saglayici = new SenaryoAiProvider(yanitlar);
    const service = new AiAjanService({ tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) } as never, new AracYurutucu(uc as never, {} as never), uc as never);
    service.saglayiciBul = async () => ({ saglayici, ozelTalimatlar: null });
    service.duzeltmeSaglayicisiBul = async () => saglayici;
    const calistir = (ekran?: Record<string, unknown>, kanal: "WEB" | "TELEGRAM" = "WEB") =>
      istekBaglami.run({ deger: { ...KIMLIK, rol: "yonetici" as never } }, () => service.mesajiIsle("Kesin satış faturaları sayfasını aç", undefined, ekran as never, [], { kanal }));
    return { tx, saglayici, calistir };
  }

  it("web: eylem yanıtla döner, kayda yalnız özeti yazılır; model sonucu adresle görür", async () => {
    const k = kur([
      { metin: "", aracCagrilari: [{ id: "c1", ad: "sayfaya_git", girdi: { yol: "/panel/fatura?yon=satis&durum=kesin" } }] },
      { metin: "Kesin satış faturalarını açtım: /panel/fatura?yon=satis&durum=kesin", aracCagrilari: [] },
    ]);
    const y = await k.calistir();
    expect(y.arayuzEylemleri).toEqual([{ tur: "sayfaya_git", yol: "/panel/fatura?yon=satis&durum=kesin", ozet: "/panel/fatura?yon=satis&durum=kesin açılacak" }]);
    expect(y.cevap).toContain("açtım");
    const kayit = k.tx.ajanMesajGecmisi.create.mock.calls.find(([a]) => a.data.rol === "assistant")![0];
    expect(kayit.data.aracCagrisi.arayuzEylemleri).toEqual([{ tur: "sayfaya_git", ozet: "/panel/fatura?yon=satis&durum=kesin açılacak" }]);
  });

  it("Telegram ve MCP arayüz araçlarını görmez", async () => {
    const uc = { yetkiliMi: () => true };
    const yurutucu = new AracYurutucu(uc as never, {} as never);
    expect(yurutucu.izinliAraclar("yonetici").some((a) => a.sinif === "arayuz")).toBe(false);
    expect(telegramAraclari(yurutucu.izinliAraclar("yonetici")).some((a) => a.sinif === "arayuz")).toBe(false);
    expect(yurutucu.izinliAraclar("yonetici", { arayuz: true }).filter((a) => a.sinif === "arayuz").map((a) => a.ad)).toEqual(["sayfaya_git", "suzgec_uygula", "sekme_ac", "kayit_vurgula", "formu_doldur"]);
  });

  it("önceki turun tarayıcı sonucu sistem talimatına girer", async () => {
    const k = kur([{ metin: "Tamam.", aracCagrilari: [] }]);
    await k.calistir({ arayuzSonuclari: [{ tur: "formu_doldur", sonuc: "alan_yok" }] });
    expect(k.saglayici.girdiler[0]!.sistemRol).toContain("formu_doldur: alan bulunamadı, uygulanmadı");
  });
});

describe("arayüz araçlarının sunulması (AI-114 düzeltmesi)", () => {
  const araclar = ["sayfaya_git", "suzgec_uygula", "sekme_ac", "kayit_vurgula", "formu_doldur", "fatura_ara"].map((ad) => ({ ad, sinif: ad === "fatura_ara" ? "okuma" : "arayuz" }));
  const adlar = (g: Parameters<typeof arayuzAraclariniSec>[1]) => arayuzAraclariniSec(araclar, g).map((a) => a.ad);
  it("bağlam ve yönlendirme isteği yoksa yalnız iş araçları sunulur (yetkisiz istekte yönlendirmeye kaçmasın)", () => {
    expect(adlar({ mesaj: "Kasa ve banka bakiyelerini göster." })).toEqual(["fatura_ara"]);
    expect(adlar({ mesaj: "FTR2026000000123 numaralı faturayı sil." })).toEqual(["fatura_ara"]);
  });
  it("açık yönlendirme isteğinde sayfaya_git, liste ekranında süzgeç/sekme/vurgu, açık formda form doldurma", () => {
    expect(adlar({ mesaj: "Beni faturalar sayfasına götür" })).toEqual(["sayfaya_git", "fatura_ara"]);
    expect(adlar({ mesaj: "Bu faturayı aç" })).toContain("sayfaya_git");
    expect(adlar({ mesaj: "Ekim hareketlerini göster", durum: { ekran: "kasa_banka_hareketleri" } })).toEqual(["suzgec_uygula", "sekme_ac", "kayit_vurgula", "fatura_ara"]);
    expect(adlar({ mesaj: "Formu doldur", durum: { ekran: "faturalar", form: "fatura" } })).toContain("formu_doldur");
  });
});
