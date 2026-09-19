import { describe, expect, it } from "vitest";
import { faturaOlusturSemasi, faturaGuncelleSemasi } from "./fatura.semalar";

// UUID'ler zod'un sürüm/varyant kontrolünden geçmek zorunda; geçersiz bir kimlik
// her safeParse'ı baştan düşürdüğü için asıl sınanan kural hiç çalışmaz.
const satir = { stokId: "11111111-1111-4111-8111-111111111111", miktar: "2", birimFiyat: "100", iskontoOrani: "10", kdvOrani: "20" };
const temel = { tip: "satis", tarih: "2026-08-14", cariId: "22222222-2222-4222-8222-222222222222", satirlar: [satir] };

/** Doğrulama hatalarının hangi alanda toplandığını okunur biçimde verir. */
const hataYollari = (sonuc: ReturnType<typeof faturaOlusturSemasi.safeParse>) =>
  sonuc.success ? [] : sonuc.error.issues.map((h) => h.path.join("."));

describe("fatura finansal doğrulamaları", () => {
  it("geçerli faturayı kabul eder", () => {
    expect(faturaOlusturSemasi.safeParse(temel).success).toBe(true);
  });

  it("oranların yüzde 100'ü aşmasına izin vermez", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, iskontoOrani: "101" }] });
    expect(sonuc.success).toBe(false);
  });

  it("dövizli faturada kur 1 kabul etmez (EBLG-57)", () => {
    const doviz = { ...temel, dovizCinsi: "EUR" };
    expect(hataYollari(faturaOlusturSemasi.safeParse(doviz))).toEqual(["kur"]);
    expect(hataYollari(faturaOlusturSemasi.safeParse({ ...doviz, kur: "1" }))).toEqual(["kur"]);
    expect(faturaOlusturSemasi.safeParse({ ...doviz, kur: "47.85" }).success).toBe(true);
    expect(hataYollari(faturaGuncelleSemasi.safeParse({ dovizCinsi: "USD" }))).toEqual(["kur"]);
    expect(faturaGuncelleSemasi.safeParse({ aciklama: "yalnız not" }).success).toBe(true);
  });

  it("güncellemede de aşırı genel iskontoyu reddeder", () => {
    const sonuc = faturaGuncelleSemasi.safeParse({ satirlar: [satir], genelIskontoTutari: "201" });
    expect(sonuc.success).toBe(false);
  });
});

describe("GİB senaryo doğrulamaları (FTR-17, FTR-18)", () => {
  it("KDV sıfır satırda istisna kodu ister", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, kdvOrani: "0" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.gibIstisnaKodu"]);
  });

  it("KDV sıfır satırı istisna koduyla kabul eder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, kdvOrani: "0", gibIstisnaKodu: "351" }] });
    expect(sonuc.success).toBe(true);
  });

  it("KDV'li satırda istisna koduna izin vermez", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, gibIstisnaKodu: "351" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.gibIstisnaKodu"]);
  });

  it("liste dışı istisna kodunu reddeder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, kdvOrani: "0", gibIstisnaKodu: "999" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.gibIstisnaKodu"]);
  });

  it("tek oranlı tevkifat kodunu oransız kabul eder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, tevkifatKodu: "601" }] });
    expect(sonuc.success).toBe(true);
  });

  it("tek oranlı kodda yanlış oranı reddeder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, tevkifatKodu: "601", tevkifatOrani: "9/10" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.tevkifatOrani"]);
  });

  it("650 kodunda oran seçilmesini ister", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, tevkifatKodu: "650" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.tevkifatOrani"]);
  });

  it("650 kodunu listedeki oranla kabul eder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, tevkifatKodu: "650", tevkifatOrani: "5/10" }] });
    expect(sonuc.success).toBe(true);
  });

  it("liste dışı tevkifat kodunu reddeder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, tevkifatKodu: "699" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.tevkifatKodu"]);
  });

  it("KDV sıfır satırda tevkifata izin vermez", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, kdvOrani: "0", gibIstisnaKodu: "351", tevkifatKodu: "601" }] });
    expect(hataYollari(sonuc)).toEqual(["satirlar.0.tevkifatKodu"]);
  });
});

describe("e-Fatura profili (FTR-19)", () => {
  it("profili isteğe bağlı bırakır", () => {
    expect(faturaOlusturSemasi.safeParse(temel).success).toBe(true);
  });

  it("ticari profili kabul eder", () => {
    expect(faturaOlusturSemasi.safeParse({ ...temel, efaturaProfili: "ticari" }).success).toBe(true);
  });

  it("liste dışı profili reddeder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, efaturaProfili: "eticaret" });
    expect(hataYollari(sonuc)).toEqual(["efaturaProfili"]);
  });
});
