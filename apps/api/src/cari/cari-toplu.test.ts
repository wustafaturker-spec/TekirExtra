import { describe, expect, it } from "vitest";
import { acikBakiyeVar, ekstreDonemi, topluEkstreSemasi, topluEtiketSemasi, TOPLU_EPOSTA_EN_FAZLA } from "./cari-toplu";

const kimlik = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

describe("CARI-40 toplu işlem", () => {
  it("herhangi bir dövizde kuruşu aşan bakiye açık sayılır", () => {
    expect(acikBakiyeVar(undefined)).toBe(false);
    expect(acikBakiyeVar([{ bakiye: "0.00" }, { bakiye: "-0.004" }])).toBe(false);
    expect(acikBakiyeVar([{ bakiye: "0.00" }, { bakiye: "-12.50" }])).toBe(true);
  });

  it("ekstre e-postası en çok 100 cariye gider, tarih sırası denetlenir", () => {
    const fazla = Array.from({ length: TOPLU_EPOSTA_EN_FAZLA + 1 }, (_, i) => kimlik(i));
    expect(topluEkstreSemasi.safeParse({ cariIdler: fazla }).success).toBe(false);
    expect(topluEkstreSemasi.safeParse({ cariIdler: [kimlik(1)], baslangic: "2026-10-01", bitis: "2026-09-01" }).success).toBe(false);
    expect(topluEkstreSemasi.safeParse({ cariIdler: [kimlik(1)], tur: "doviz" }).success).toBe(false);
    expect(topluEkstreSemasi.safeParse({ cariIdler: [kimlik(1)], tur: "ayrintili", mutabakat: true }).success).toBe(true);
  });

  it("boş seçim reddedilir", () => {
    expect(topluEtiketSemasi.safeParse({ cariIdler: [], etiketId: kimlik(9), islem: "ekle" }).success).toBe(false);
  });

  it("dönem metni", () => {
    expect(ekstreDonemi()).toBe("tüm dönem");
    expect(ekstreDonemi("2026-01-01")).toBe("2026-01-01 - bugün");
  });
});
