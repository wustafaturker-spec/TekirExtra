import { describe, expect, it } from "vitest";
import { adimiOnaylayabilir, kuralSec, kuralSemasi, type KuralSatiri } from "./onay-kurallari";
import { enYuksekIskonto } from "./olculer";

const kural = (ek: Partial<KuralSatiri>): KuralSatiri => ({ id: "k", ad: "K", tutarEsigi: null, iskontoEsigi: null, riskAsimi: false, adimlar: [{ rol: "muhasebe" }], ...ek });

describe("kural seçimi (ONY-01)", () => {
  it("koşullar 've' ile bağlanır; koşulsuz kural her işlemde uyar", () => {
    const k = kural({ tutarEsigi: 10_000, iskontoEsigi: 10 });
    expect(kuralSec([k], { tutarTry: 20_000, iskontoYuzde: 5 })).toBeNull();
    expect(kuralSec([k], { tutarTry: 20_000, iskontoYuzde: 12 })?.nedenler).toHaveLength(2);
    expect(kuralSec([kural({})], { tutarTry: 1 })?.nedenler).toEqual(["bu işlem her zaman onay ister"]);
  });

  it("birden çok kural uyarsa en çok adımlı, eşitse en yüksek eşikli seçilir", () => {
    const a = kural({ id: "a", tutarEsigi: 1_000 });
    const b = kural({ id: "b", tutarEsigi: 50_000 });
    const c = kural({ id: "c", riskAsimi: true, adimlar: [{ rol: "muhasebe" }, { rol: "yonetici" }] });
    expect(kuralSec([a, b], { tutarTry: 60_000 })?.kural.id).toBe("b");
    expect(kuralSec([a, b, c], { tutarTry: 60_000, riskAsimi: true })?.kural.id).toBe("c");
    expect(kuralSec([c], { tutarTry: 60_000, riskAsimi: false })).toBeNull();
  });

  it("şema: işlemde anlamsız koşul ve aynı iki adım reddedilir", () => {
    expect(kuralSemasi.safeParse({ islem: "masraf_onayla", ad: "Masraf", iskontoEsigi: 5, adimlar: [{ rol: "yonetici" }] }).success).toBe(false);
    expect(kuralSemasi.safeParse({ islem: "kasa_banka_odeme", ad: "Ödeme", riskAsimi: true, adimlar: [{ rol: "yonetici" }] }).success).toBe(false);
    expect(kuralSemasi.safeParse({ islem: "fatura_kesinlestir_satis", ad: "Büyük", tutarEsigi: "100000", adimlar: [{ rol: "yonetici" }, { rol: "yonetici" }] }).success).toBe(false);
    expect(kuralSemasi.safeParse({ islem: "fatura_kesinlestir_satis", ad: "Büyük", tutarEsigi: "100000", adimlar: [{ rol: "muhasebe" }, { rol: "yonetici" }] }).success).toBe(true);
  });
});

describe("adım yetkisi ve görev ayrılığı (ONY-04)", () => {
  const talep = { talepEdenId: "u1", oncekiOnaylayanlar: [] as string[] };
  it("rol adımını o rol ve yönetici, kişi adımını yalnız o kişi onaylar", () => {
    expect(adimiOnaylayabilir({ rol: "muhasebe" }, { id: "u2", rol: "muhasebe" }, talep, false).izin).toBe(true);
    expect(adimiOnaylayabilir({ rol: "muhasebe" }, { id: "u3", rol: "yonetici" }, talep, false).izin).toBe(true);
    expect(adimiOnaylayabilir({ rol: "muhasebe" }, { id: "u4", rol: "satis" }, talep, false).izin).toBe(false);
    expect(adimiOnaylayabilir({ kullaniciId: "u5" }, { id: "u3", rol: "yonetici" }, talep, false).izin).toBe(false);
  });
  it("talep eden kendi talebini onaylayamaz (ayar kapalıysa onaylar); aynı kişi iki adımı onaylayamaz", () => {
    expect(adimiOnaylayabilir({ rol: "yonetici" }, { id: "u1", rol: "yonetici" }, talep, false).neden).toContain("görev ayrılığı");
    expect(adimiOnaylayabilir({ rol: "yonetici" }, { id: "u1", rol: "yonetici" }, talep, true).izin).toBe(true);
    expect(adimiOnaylayabilir({ rol: "yonetici" }, { id: "u2", rol: "yonetici" }, { ...talep, oncekiOnaylayanlar: ["u2"] }, false).neden).toContain("iki adımı");
  });
});

describe("iskonto ölçüsü", () => {
  it("satır oranı, satır tutarı ve genel iskontonun en büyüğü", () => {
    const satir = (miktar: number, fiyat: number, oran = 0, tutar = 0) => ({ miktar, birimFiyat: fiyat, iskontoOrani: oran, iskontoTutari: tutar });
    expect(enYuksekIskonto({ genelIskontoYuzdesi: 0, genelIskontoTutari: 0, satirlar: [satir(1, 100, 5), satir(2, 50, 0, 20)] })).toBe(20);
    expect(enYuksekIskonto({ genelIskontoYuzdesi: 0, genelIskontoTutari: 50, satirlar: [satir(1, 200)] })).toBe(25);
    expect(enYuksekIskonto({ genelIskontoYuzdesi: 30, genelIskontoTutari: 0, satirlar: [satir(1, 100, 10)] })).toBe(30);
  });
});
