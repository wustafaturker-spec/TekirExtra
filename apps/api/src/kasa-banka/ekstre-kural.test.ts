import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { kuralAnahtari, kuralBul, type KuralKaydi } from "./ekstre-kural";

const kural = (ek: Partial<KuralKaydi>): KuralKaydi => ({
  id: "k", bankaHesapId: null, anahtar: kuralAnahtari("EFT UCRETI"), yon: "cikis", eslesmeTuru: "masraf",
  cariId: null, masrafKategoriId: "m1", gelirKategoriId: null, hedefKasaId: null, hedefBankaHesapId: null, ...ek,
});
const satir = (aciklama: string, tutar = "-12.50", bankaHesapId = "b1") => ({ bankaHesapId, tutar: new Prisma.Decimal(tutar), aciklama, karsiUnvan: null });

describe("ekstre kuralları (KSB-06)", () => {
  it("aksanı ve büyük/küçük harfi yok sayarak eşleşir", () => {
    expect(kuralAnahtari("EFT Ücreti")).toBe(kuralAnahtari("eft ucreti"));
    expect(kuralBul([kural({})], satir("Giden eft ücreti 12,50"))?.id).toBe("k");
  });

  it("yönü uymayan kuralı uygulamaz", () => {
    expect(kuralBul([kural({})], satir("EFT UCRETI IADESI", "12.50"))).toBeNull();
  });

  it("hesaba özel kural genel kuraldan, uzun anahtar kısadan önce gelir", () => {
    const kurallar = [kural({ id: "genel" }), kural({ id: "ozel", bankaHesapId: "b1" }), kural({ id: "uzun", anahtar: kuralAnahtari("EFT UCRETI BSMV") })];
    expect(kuralBul(kurallar, satir("EFT UCRETI BSMV"))?.id).toBe("ozel");
    expect(kuralBul(kurallar, satir("EFT UCRETI BSMV", "-1", "b2"))?.id).toBe("uzun");
  });

  it("başka hesaba özel kuralı uygulamaz", () => {
    expect(kuralBul([kural({ bankaHesapId: "b9" })], satir("EFT UCRETI"))).toBeNull();
  });
});

describe("ekstre kuralı noktalama", () => {
  it("tire, eğik çizgi ve iki nokta farkını yok sayar", () => {
    const k = kural({ anahtar: kuralAnahtari("EFT ÜCRETİ") });
    expect(kuralBul([k], satir("DENEME-KSB06 EFT-UCRETI/REF:123"))?.id).toBe("k");
  });
});
