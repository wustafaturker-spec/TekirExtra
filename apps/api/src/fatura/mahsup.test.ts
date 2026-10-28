import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { mahsupYaz, otomatikMahsupUygula } from "./mahsup";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const fatura = (id: string, tip: string, toplam: string, ek: { doviz?: string; vade?: string; kapama?: { tutar: string; otomatik: boolean }[] } = {}) => ({
  id, no: id.toUpperCase(), tip, tarih: new Date(ek.vade ?? "2026-10-01"), vadeTarihi: new Date(ek.vade ?? "2026-10-01"), createdAt: new Date("2026-10-01"),
  dovizCinsi: ek.doviz ?? "TRY", genelToplam: D(toplam), kapamalar: (ek.kapama ?? []).map((k) => ({ tutar: D(k.tutar), otomatik: k.otomatik })), iadeKapamalari: [],
});

function islem(faturalar: ReturnType<typeof fatura>[]) {
  const yazilan: { mahsup: unknown[]; kapama: { faturaId: string; tutar: Prisma.Decimal; kaynakTutari?: Prisma.Decimal }[] } = { mahsup: [], kapama: [] };
  const tx = {
    fatura: { findMany: vi.fn(async () => faturalar) },
    cariMahsup: { create: vi.fn(async ({ data }: { data: { tutar: Prisma.Decimal } }) => { yazilan.mahsup.push(data); return { id: "m1", ...data }; }) },
    faturaKapama: { createMany: vi.fn(async ({ data }: { data: typeof yazilan.kapama }) => { yazilan.kapama.push(...data); return { count: data.length }; }) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { tx: tx as never, yazilan };
}
const girdi = (satirlar: { faturaId: string; tutar: string; karsilik?: string }[], dovizCinsi = "TRY") => ({
  tenantId: "t", cariId: "c", userId: "u", tarih: new Date("2026-10-28"), dovizCinsi, aciklama: null, otomatik: false,
  satirlar: satirlar.map((s) => ({ faturaId: s.faturaId, tutar: D(s.tutar), karsilik: s.karsilik ? D(s.karsilik) : undefined })),
});

describe("alış–satış mahsubu kaydı (KSB-25)", () => {
  it("iki taraf eşitse mahsup ve iki taraftaki kapamalar yazılır", async () => {
    const t = islem([fatura("s1", "satis", "1000"), fatura("a1", "alis", "600")]);
    await mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "600" }, { faturaId: "a1", tutar: "600" }]));
    expect(t.yazilan.kapama.map((k) => [k.faturaId, k.tutar.toFixed(2)])).toEqual([["s1", "600.00"], ["a1", "600.00"]]);
  });

  it("taraflar eşit değilse, tek taraf seçildiyse ya da tutar faturanın açığını aşarsa reddedilir", async () => {
    const t = islem([fatura("s1", "satis", "1000"), fatura("s2", "satis", "100"), fatura("a1", "alis", "600")]);
    await expect(mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "500" }, { faturaId: "a1", tutar: "600" }]))).rejects.toThrow(/eşit olmalı/);
    await expect(mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "50" }, { faturaId: "s2", tutar: "50" }]))).rejects.toThrow(/en az bir satış tarafı/);
    await expect(mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "700" }, { faturaId: "a1", tutar: "700" }]))).rejects.toThrow(/en çok 600.00/);
    expect(t.yazilan.kapama).toHaveLength(0);
  });

  it("otomatik kapamalar sınırı daraltmaz (yeniden dağılır), elle kapamalar daraltır", async () => {
    const t = islem([fatura("s1", "satis", "1000", { kapama: [{ tutar: "900", otomatik: true }] }), fatura("a1", "alis", "600", { kapama: [{ tutar: "100", otomatik: false }] })]);
    await expect(mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "600" }, { faturaId: "a1", tutar: "600" }]))).rejects.toThrow(/en çok 500.00/);
    await mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "500" }, { faturaId: "a1", tutar: "500" }]));
    expect(t.yazilan.kapama).toHaveLength(2);
  });

  it("farklı dövizli fatura karşılık ister; karşılık mahsup dövizinde toplanır", async () => {
    const t = islem([fatura("s1", "satis", "100", { doviz: "USD" }), fatura("a1", "alis", "5000")]);
    await expect(mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "100" }, { faturaId: "a1", tutar: "4000" }]))).rejects.toThrow(/karşılık tutarını girin/);
    await mahsupYaz(t.tx, girdi([{ faturaId: "s1", tutar: "100", karsilik: "4000" }, { faturaId: "a1", tutar: "4000" }]));
    expect(t.yazilan.kapama.find((k) => k.faturaId === "s1")?.kaynakTutari?.toFixed(2)).toBe("4000.00");
  });

  it("otomatik mahsup döviz başına açık tutarların küçüğü kadar vade sırasıyla kapatır", async () => {
    const t = islem([
      fatura("s1", "satis", "300", { vade: "2026-10-01", kapama: [{ tutar: "100", otomatik: true }] }),
      fatura("s2", "satis", "500", { vade: "2026-10-05" }),
      fatura("a1", "alis", "400", { vade: "2026-10-03" }),
      fatura("u1", "satis", "50", { doviz: "USD" }),
    ]);
    await otomatikMahsupUygula(t.tx, "t", "c");
    expect(t.yazilan.mahsup).toHaveLength(1);
    expect(t.yazilan.kapama.map((k) => [k.faturaId, k.tutar.toFixed(2)])).toEqual([["s1", "200.00"], ["s2", "200.00"], ["a1", "400.00"]]);
  });
});
