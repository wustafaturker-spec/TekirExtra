import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const saglayici = { saglayiciAdi: "gemini", yapilandirilmisUretim: vi.fn() };
vi.mock("../ai/saglayici/kiraci-saglayici", () => ({ kiraciSaglayicisi: vi.fn(async () => ({ saglayici, ozelTalimatlar: null })) }));
const { EkstreEslestirmeService } = await import("./ekstre-eslestirme.service");

const D = (x: number) => new Prisma.Decimal(x);
const cari = (id: string, unvan: string) => ({ id, kod: id, unvan });

function kur(tx: Record<string, unknown>) {
  const prisma = { tenantIslem: (_t: string, fn: (x: unknown) => unknown) => fn(tx) };
  return new EkstreEslestirmeService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never) as any;
}
const bosTx = (ek: Record<string, unknown> = {}) => ({
  cariBankaHesap: { findFirst: vi.fn().mockResolvedValue(null) },
  cariHesap: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  fatura: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  ...ek,
});

describe("ekstre cari önerisi (AI-19)", () => {
  it("açıklamadaki GİB fatura numarasından cariyi bulur", async () => {
    const tx = bosTx({ fatura: { findFirst: vi.fn().mockResolvedValue({ cari: cari("c1", "KAYA LTD") }), findMany: vi.fn() } });
    const r = await kur(tx).cariOner(tx, "t", { aciklama: "EFT SNC2026000000034 ODEMESI", karsiIban: null, karsiUnvan: null });
    expect(r).toEqual({ cari: cari("c1", "KAYA LTD"), kaynak: "fatura_no" });
    expect(tx.fatura.findFirst.mock.calls[0][0].where.no).toBe("SNC2026000000034");
  });

  it("kalanı birebir tutan açık fatura tek caride ise o cari; iki caride ise öneri yok", async () => {
    const f = (cariId: string, toplam: number, odenen = 0) => ({ durum: "kesin", genelToplam: D(toplam), cari: cari(cariId, cariId), kapamalar: odenen ? [{ tutar: D(odenen) }] : [], iadeKapamalari: [] });
    const tutar = { giris: true, mutlak: D(600), doviz: "TRY" };
    const tek = bosTx({ fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([f("c1", 1000, 400), f("c2", 700)]) } });
    expect(await kur(tek).cariOner(tek, "t", { aciklama: "HAVALE", karsiIban: null, karsiUnvan: null }, tutar)).toMatchObject({ kaynak: "tutar", cari: { id: "c1" } });
    const iki = bosTx({ fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([f("c1", 600), f("c2", 600)]) } });
    expect(await kur(iki).cariOner(iki, "t", { aciklama: "HAVALE", karsiIban: null, karsiUnvan: null }, tutar)).toEqual({ cari: null, kaynak: null });
  });

  it("dil modeli yalnız açıklama ve karşı unvanı görür; tek aday çıkarsa öneri, belirsizse yok", async () => {
    saglayici.yapilandirilmisUretim.mockResolvedValueOnce({ karsiTarafAdi: "Karsel Otomotiv", gerekce: "gönderen adı" });
    const tx = bosTx({ cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([cari("c1", "KARSEL OTOTMOTİV VE YEDEK PARÇA"), cari("c2", "KAYA METAL")]) } });
    const s = kur(tx);
    const r = await s.yapayZekaCariOnerisi("t", { aciklama: "FAST KARSEL OTO 4512", karsiUnvan: null });
    expect(r.cari.id).toBe("c1");
    expect(r.gerekce).toContain("Karsel Otomotiv");
    expect(saglayici.yapilandirilmisUretim.mock.calls[0][0].prompt).toContain("FAST KARSEL OTO 4512");

    saglayici.yapilandirilmisUretim.mockResolvedValueOnce({ karsiTarafAdi: "Kaya", gerekce: "" });
    const tx2 = bosTx({ cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([cari("c1", "KAYA METAL"), cari("c2", "KAYA GIDA")]) } });
    expect(await kur(tx2).yapayZekaCariOnerisi("t", { aciklama: "KAYA", karsiUnvan: null })).toBeNull();
  });

  it("sağlayıcı kapalıysa (onay yok) dil modeli çağrılmaz", async () => {
    const { kiraciSaglayicisi } = await import("../ai/saglayici/kiraci-saglayici");
    vi.mocked(kiraciSaglayicisi).mockResolvedValueOnce({ saglayici: { saglayiciAdi: "tanimsiz" } as never, ozelTalimatlar: null });
    saglayici.yapilandirilmisUretim.mockClear();
    expect(await kur(bosTx()).yapayZekaCariOnerisi("t", { aciklama: "X", karsiUnvan: null })).toBeNull();
    expect(saglayici.yapilandirilmisUretim).not.toHaveBeenCalled();
  });
});
