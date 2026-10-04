import { describe, expect, it } from "vitest";
import { bordroHesapla } from "./bordro-hesaplama";
import { donemUcreti, nettenBrute } from "./ucret-donemi";

const t = (iso: string) => new Date(`${iso}T00:00:00Z`);
const u = (iso: string, tip: string, tutar: number) => ({ yururlukTarihi: t(iso), tip, tutar });
const tamAy = [{ baslangicTarihi: t("2025-01-01"), bitisTarihi: null }];
const p = { asgariUcretBrut: 30000, sgkTavan: 225000, sgkIsciOrani: 14, issizlikIsciOrani: 1, sgkIsverenOrani: 20.75, issizlikIsverenOrani: 2, damgaVergisiOrani: 0.759, gelirVergisiDilimleri: [{ ustSinir: 100000, oran: 15 }, { ustSinir: null, oran: 20 }] };

describe("dönem ücreti (PRS-06)", () => {
  it("ay başında geçerli ücret; sonraki zam etkilemez", () => {
    expect(donemUcreti([u("2025-01-01", "net", 30000), u("2026-11-01", "net", 36000)], tamAy, 2026, 10)).toEqual({ tip: "net", aylik: 30000 });
    expect(donemUcreti([u("2025-01-01", "net", 30000), u("2026-10-01", "net", 36000)], tamAy, 2026, 10)).toEqual({ tip: "net", aylik: 36000 });
  });
  it("ay içi zam istihdam günlerine bölünür (Eylül 30 gün: 15 + 15)", () => {
    expect(donemUcreti([u("2025-01-01", "brut", 30000), u("2026-09-16", "brut", 36000)], tamAy, 2026, 9)).toEqual({ tip: "brut", aylik: 33000 });
  });
  it("net ve brüt aynı ayda karışamaz; kayıt yoksa hata", () => {
    expect(() => donemUcreti([u("2025-01-01", "net", 30000), u("2026-09-16", "brut", 40000)], tamAy, 2026, 9)).toThrow(/net ve brüt/);
    expect(() => donemUcreti([u("2026-12-01", "net", 30000)], tamAy, 2026, 9)).toThrow(/ücret kaydı yok/);
  });
});

describe("netten brüte (PRS-06)", () => {
  const g = { primGunu: 30, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 };
  it("asgari ücret neti asgari brüte döner", () => {
    expect(nettenBrute(p, 25500, g)).toBe(30000);
  });
  it("bulunan brütün neti hedefi kuruşu kuruşuna tutar; kümülatif matrah arttıkça brüt artar", () => {
    const b1 = nettenBrute(p, 50000, g);
    expect(Number(bordroHesapla(p, { ...g, brutUcret: b1 }).netUcret)).toBeCloseTo(50000, 2);
    const b2 = nettenBrute(p, 50000, { ...g, oncekiKumulatifMatrah: 500000, oncekiAsgariKumulatifMatrah: 200000 });
    expect(b2).toBeGreaterThan(b1);
    expect(Number(bordroHesapla(p, { ...g, oncekiKumulatifMatrah: 500000, oncekiAsgariKumulatifMatrah: 200000, brutUcret: b2 }).netUcret)).toBeCloseTo(50000, 2);
  });
});
