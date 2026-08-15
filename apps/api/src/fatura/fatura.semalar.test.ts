import { describe, expect, it } from "vitest";
import { faturaOlusturSemasi, faturaGuncelleSemasi } from "./fatura.semalar";

const satir = { stokId: "00000000-0000-0000-0000-000000000001", miktar: "2", birimFiyat: "100", iskontoOrani: "10", kdvOrani: "20" };
const temel = { tip: "satis", tarih: "2026-08-14", cariId: "00000000-0000-0000-0000-000000000002", satirlar: [satir] };

describe("fatura finansal doğrulamaları", () => {
  it("oranların yüzde 100'ü aşmasına izin vermez", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, iskontoOrani: "101" }] });
    expect(sonuc.success).toBe(false);
  });

  it("tevkifat payı paydadan büyükse reddeder", () => {
    const sonuc = faturaOlusturSemasi.safeParse({ ...temel, satirlar: [{ ...satir, tevkifatPay: 6, tevkifatPayda: 5 }] });
    expect(sonuc.success).toBe(false);
  });

  it("güncellemede de aşırı genel iskontoyu reddeder", () => {
    const sonuc = faturaGuncelleSemasi.safeParse({ satirlar: [satir], genelIskontoTutari: "201" });
    expect(sonuc.success).toBe(false);
  });
});
