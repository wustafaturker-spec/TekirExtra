import { describe, expect, it } from "vitest";
import { odemeSozuOlusturSemasi, odemeSozuRevizeSemasi, odemeSozuIptalSemasi, odemeSozuListeSemasi } from "./odeme-sozu.semalar";
import { tahsilatAyariSemasi } from "./tahsilat-erisim";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const g = { cariId: id, faturaId: id, dovizCinsi: "TRY", tutar: "1000.00", sozTarihi: "2026-10-20", aciklama: "Telefon sözü", istekAnahtari: id };
describe("F02 istek sınırı", () => {
  it("kanonik gövdeyi kabul eder, UUID normalleştirir ve notu kırpar", () => {
    expect(odemeSozuOlusturSemasi.parse({ ...g, cariId: id.toUpperCase(), aciklama: "  Not var  " })).toMatchObject({ cariId: id, aciklama: "Not var" });
  });
  it.each(["0.00", "-1.00", "1.001", "01.00", "1e3", "NaN", "10000000000000.00", 10])("geçersiz tutar %s", (tutar) => {
    expect(odemeSozuOlusturSemasi.safeParse({ ...g, tutar }).success).toBe(false);
  });
  it.each(["2026-02-30", "2026-13-01", "2026-10-20T00:00:00Z", "20.10.2026"])("geçersiz tarih %s", (sozTarihi) => {
    expect(odemeSozuOlusturSemasi.safeParse({ ...g, sozTarihi }).success).toBe(false);
  });
  it.each([{ tenantId: id }, { verildigiZaman: "2026-10-01" }, { gerceklesen: "1000" }, { surum: 1 }])("sunucu alanını reddeder %j", (ek) => {
    expect(odemeSozuOlusturSemasi.safeParse({ ...g, ...ek }).success).toBe(false);
  });
  it("geçersiz döviz ve uzun not reddedilir", () => {
    expect(odemeSozuOlusturSemasi.safeParse({ ...g, dovizCinsi: "ZZZ" }).success).toBe(false);
    expect(odemeSozuOlusturSemasi.safeParse({ ...g, aciklama: "a".repeat(2001) }).success).toBe(false);
  });
  it("revizyon hedefi değiştiremez ve gerekçesiz olamaz", () => {
    const r = { tutar: "900.00", sozTarihi: g.sozTarihi, aciklama: "Yeni söz", istekAnahtari: id, beklenenSurum: 1, gerekce: "Tarih değişti" };
    expect(odemeSozuRevizeSemasi.safeParse(r).success).toBe(true);
    expect(odemeSozuRevizeSemasi.safeParse({ ...r, faturaId: id }).success).toBe(false);
    expect(odemeSozuRevizeSemasi.safeParse({ ...r, gerekce: " " }).success).toBe(false);
  });
  it.each([0, -1, 1.5, "1"])("iptal sürümü %s geçersiz", (beklenenSurum) => {
    expect(odemeSozuIptalSemasi.safeParse({ beklenenSurum, gerekce: "İptal" }).success).toBe(false);
  });
  it("liste için cari zorunlu, bilinmeyen filtreler reddedilir", () => {
    expect(odemeSozuListeSemasi.safeParse({}).success).toBe(false);
    expect(odemeSozuListeSemasi.safeParse({ cariId: id, adet: 10 }).success).toBe(false);
  });
  it("mod varsayılanı kapalı; bozuk veya gelecek sürüm açılmaz", () => {
    expect(tahsilatAyariSemasi.parse({})).toEqual({ surum: 1, mod: "kapali" });
    expect(tahsilatAyariSemasi.safeParse({ surum: 2, mod: "acik" }).success).toBe(false);
    expect(tahsilatAyariSemasi.safeParse({ mod: "acik", bilinmeyen: true }).success).toBe(false);
  });
});
