import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { cariDenklestir } from "./denklestirme";

const D = (v: string) => new Prisma.Decimal(v);
const g = (s: string) => new Date(s);

/** Bir carinin denkleştirmede okunan kayıtları; verilmeyenler boştur. */
function islem(veri: {
  baslangic?: Date | null;
  faturalar?: object[];
  elle?: object[];
  kasa?: object[];
  tersler?: object[];
}) {
  return {
    $queryRaw: vi.fn(async () => []),
    cariHesap: { findUnique: vi.fn(async () => ({ denklestirmeBaslangic: veri.baslangic ?? null })), update: vi.fn() },
    fatura: { findMany: vi.fn(async () => veri.faturalar ?? []) },
    faturaKapama: { findMany: vi.fn(async () => veri.elle ?? []), deleteMany: vi.fn(), createMany: vi.fn() },
    kasaBankaHareket: {
      findMany: vi.fn(async (a: { where: { kaynakTur: unknown } }) => (a.where.kaynakTur === "ters_kayit" ? veri.tersler ?? [] : veri.kasa ?? [])),
    },
    krediKartiHareket: { findMany: vi.fn(async () => []) },
    cekSenet: { findMany: vi.fn(async () => []) },
    posTahsilat: { findMany: vi.fn(async () => []) },
  };
}

const fatura = (id: string, vade: string, toplam: string, ek: object = {}) => ({
  id, no: id.toUpperCase(), tip: "satis", tarih: g("2026-09-01"), vadeTarihi: g(vade), createdAt: g("2026-09-01"), dovizCinsi: "TRY", genelToplam: D(toplam), ...ek,
});
const tahsilat = (id: string, tutar: string, ek: object = {}) => ({
  id, tip: "tahsilat", tutar: D(tutar), dovizCinsi: "TRY", tarih: g("2026-10-01"), createdAt: g("2026-10-12"), faturaId: null, fatura: null, ...ek,
});

describe("cariDenklestir (KSB-16)", () => {
  it("bağlanmamış tahsilatı vadesi en erken faturadan başlayarak dağıtır ve otomatik kapamaları baştan yazar", async () => {
    const tx = islem({ faturalar: [fatura("f2", "2026-10-30", "300"), fatura("f1", "2026-10-10", "200")], kasa: [tahsilat("h1", "350")] });
    await cariDenklestir(tx as never, "t1", "c1");
    expect(tx.faturaKapama.deleteMany).toHaveBeenCalledWith({ where: { cariId: "c1", otomatik: true } });
    const yazilan = tx.faturaKapama.createMany.mock.calls[0][0].data.map((k: { faturaId: string; tutar: Prisma.Decimal }) => [k.faturaId, k.tutar.toFixed(2)]);
    expect(yazilan).toEqual([["f1", "200.00"], ["f2", "150.00"]]);
  });

  it("elle kapama sabittir: faturanın kalanından ve ödemenin tutarından düşülür", async () => {
    const tx = islem({
      faturalar: [fatura("f1", "2026-10-10", "200"), fatura("f2", "2026-10-30", "300")],
      elle: [{ faturaId: "f2", tutar: D("300"), iadeFaturaId: null, kasaBankaHareketId: "h1" }],
      kasa: [tahsilat("h1", "400", { faturaId: "f2", fatura: { dovizCinsi: "TRY" } })],
    });
    const { kapamalar } = await cariDenklestir(tx as never, "t1", "c1");
    // 400'ün 300'ü f2'ye elle bağlı; artan 100 vadesi erken f1'e gider.
    expect(kapamalar.map((k) => [k.faturaId, k.tutar.toFixed(2)])).toEqual([["f1", "100.00"]]);
  });

  it("ters kaydedilen tahsilat dağıtılmaz", async () => {
    const tx = islem({ faturalar: [fatura("f1", "2026-10-10", "200")], kasa: [tahsilat("h1", "200")], tersler: [{ kaynakRef: "h1", tutar: D("200") }] });
    const { kapamalar } = await cariDenklestir(tx as never, "t1", "c1");
    expect(kapamalar).toEqual([]);
  });

  it("göçten önce girilmiş ödeme otomatik dağıtılmaz; 'tumu' ile dağıtılır ve başlangıç kalkar", async () => {
    const veri = { baslangic: g("2026-10-11T17:00:00Z"), faturalar: [fatura("f1", "2026-10-10", "200")], kasa: [tahsilat("h1", "200", { createdAt: g("2026-09-15") })] };
    expect((await cariDenklestir(islem(veri) as never, "t1", "c1")).kapamalar).toEqual([]);
    const tx = islem(veri);
    expect((await cariDenklestir(tx as never, "t1", "c1", { tumu: true })).kapamalar).toHaveLength(1);
    expect(tx.cariHesap.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { denklestirmeBaslangic: null } });
  });

  it("farklı dövizdeki ödeme ve faturayı birbirine kapatmaz", async () => {
    const tx = islem({ faturalar: [fatura("f1", "2026-10-10", "200", { dovizCinsi: "USD" })], kasa: [tahsilat("h1", "5000")] });
    expect((await cariDenklestir(tx as never, "t1", "c1")).kapamalar).toEqual([]);
  });

  it("önizlemede hiçbir şey yazmaz", async () => {
    const tx = islem({ faturalar: [fatura("f1", "2026-10-10", "200")], kasa: [tahsilat("h1", "200")] });
    const { kapamalar } = await cariDenklestir(tx as never, "t1", "c1", { onizleme: true });
    expect(kapamalar).toHaveLength(1);
    expect(tx.faturaKapama.deleteMany).not.toHaveBeenCalled();
    expect(tx.faturaKapama.createMany).not.toHaveBeenCalled();
  });
});
