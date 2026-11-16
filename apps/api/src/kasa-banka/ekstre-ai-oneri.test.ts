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
  // KSB-17: firmanın kendi adı son ekstre satırlarından öğrenilir.
  bankaEkstreSatir: { findMany: vi.fn().mockResolvedValue([]) },
  ...ek,
});

describe("ekstre cari önerisi sırası (KSB-17)", () => {
  it("açıklamadaki karşı taraf adı IBAN ve tutar ipuçlarından önce gelir; gerekçe yazılır", async () => {
    const tx = bosTx({
      cariBankaHesap: { findFirst: vi.fn().mockResolvedValue({ cari: cari("iban", "BAŞKA FİRMA") }) },
      cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([cari("c1", "BERKAN İŞ GÜVENLİĞİ TEKSTİL SAN. TİC. LTD. ŞTİ."), cari("c2", "KAYA METAL")]) },
    });
    const r = await kur(tx).cariOner(tx, "t", { aciklama: "Gönderen:BERKAN İŞ GÜVENLİĞİ TEKSTİL SANAYİ TİCARET L", karsiIban: "TR00", karsiUnvan: null }, { giris: true, mutlak: D(100), doviz: "TRY" });
    expect(r.cari?.id).toBe("c1");
    expect(r.kaynak).toBe("aciklama");
    expect(r.gerekce).toContain("“gonderen” alanı");
    expect(tx.cariBankaHesap.findFirst).not.toHaveBeenCalled();
  });

  it("aynı unvanlı iki cari kartı varsa unvandan öneri yapılmaz", async () => {
    const tx = bosTx({ cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([cari("m1", "MELEK TÜRKER"), cari("m2", "MELEK TÜRKER")]) } });
    const r = await kur(tx).cariOner(tx, "t", { aciklama: "MAAŞ - Gönderen: DEMO LTD , Alıcı: MELEK TÜRKER", karsiIban: null, karsiUnvan: null }, { giris: false, mutlak: D(100), doviz: "TRY" });
    expect(r.cari).toBeNull();
  });

  it("açıklamadan ad çıktıysa cari bulunamasa da bunu bildirir (yapay zekâ boşuna çağrılmaz)", async () => {
    const tx = bosTx({ cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([cari("m1", "MELEK TÜRKER"), cari("m2", "MELEK TÜRKER")]) } });
    const r = await kur(tx).cariOner(tx, "t", { aciklama: "MAAŞ - Gönderen: DEMO LTD , Alıcı: MELEK TÜRKER", karsiIban: null, karsiUnvan: null }, { giris: false, mutlak: D(100), doviz: "TRY" });
    expect(r).toMatchObject({ cari: null, adAdayiVar: true });
  });

  it("maaş ödemesinde aynı kişinin personel kartını önerir; maaş değilse yine çekimser (KSB-18)", async () => {
    const kartlar = [{ ...cari("m1", "MELEK TÜRKER"), tip: "musteri" }, { ...cari("p1", "MELEK TÜRKER"), tip: "personel" }];
    const tx = bosTx({ cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue(kartlar) } });
    const maas = await kur(tx).cariOner(tx, "t", { aciklama: "ŞUBAT 2026 MAAŞ ÖDEMESİ - Para Transferi, Gönderen: DEMO LTD , Alıcı: MELEK TÜRKER", karsiIban: null, karsiUnvan: null }, { giris: false, mutlak: D(100), doviz: "TRY" });
    expect(maas.cari).toEqual(cari("p1", "MELEK TÜRKER"));
    expect(maas.gerekce).toContain("maaş ödemesi, personel kartı");
    const kira = await kur(tx).cariOner(tx, "t", { aciklama: "KİRA - Gönderen: DEMO LTD , Alıcı: MELEK TÜRKER", karsiIban: null, karsiUnvan: null }, { giris: false, mutlak: D(100), doviz: "TRY" });
    expect(kira.cari).toBeNull();
  });

  it("maaş açıklamasında ad personel kartlarında yoksa bütün carilerle arar (KSB-18)", async () => {
    const kartlar = [{ ...cari("c1", "AYŞE KAYA"), tip: "musteri" }, { ...cari("p1", "MELEK TÜRKER"), tip: "personel" }];
    const tx = bosTx({ cariHesap: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue(kartlar) } });
    const r = await kur(tx).cariOner(tx, "t", { aciklama: "MAAŞ - Gönderen: DEMO LTD , Alıcı: AYŞE KAYA", karsiIban: null, karsiUnvan: null }, { giris: false, mutlak: D(100), doviz: "TRY" });
    expect(r.cari).toEqual(cari("c1", "AYŞE KAYA"));
    expect(r.gerekce).not.toContain("personel");
  });

  it("ad bulunamazsa eski sıraya (IBAN) düşer", async () => {
    const tx = bosTx({ cariBankaHesap: { findFirst: vi.fn().mockResolvedValue({ cari: cari("iban", "BAŞKA FİRMA") }) } });
    const r = await kur(tx).cariOner(tx, "t", { aciklama: "Gönderen:TANINMAYAN AD", karsiIban: "TR00", karsiUnvan: null }, { giris: true, mutlak: D(100), doviz: "TRY" });
    expect(r).toEqual({ cari: cari("iban", "BAŞKA FİRMA"), kaynak: "iban" });
  });
});

describe("ekstre cari önerisi (AI-19)", () => {
  const oner = async (tx: any, aciklama: string) => {
    const s = kur(tx), satir = { aciklama, karsiIban: null, karsiUnvan: null };
    return s.cariOner(tx, "t", satir, undefined, await s.faturaReferanslari(tx, "t", satir));
  };
  it("açıklamadaki GİB fatura numarasından cariyi bulur", async () => {
    const tx = bosTx({ fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([{ id: "f1", cari: cari("c1", "KAYA LTD") }]) } });
    const r = await oner(tx, "EFT SNC2026000000034 ODEMESI");
    expect(r).toEqual({ cari: cari("c1", "KAYA LTD"), kaynak: "fatura_no" });
    expect(tx.fatura.findMany.mock.calls[0][0].where).toMatchObject({ no: { in: ["SNC2026000000034"] }, durum: "kesin" });
  });

  it("KSB-44: ETTN ayrı sinyaldir; giden faturada kimlik, gelen faturada gelen e-Belge UUID'si", async () => {
    const ettn = "3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12";
    const giden = bosTx({ gelenEbelge: { findMany: vi.fn().mockResolvedValue([]) }, fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValueOnce([{ id: ettn, cari: cari("c1", "KAYA LTD") }]) } });
    expect(await oner(giden, `ODEME ${ettn.toUpperCase()}`)).toEqual({ cari: cari("c1", "KAYA LTD"), kaynak: "ettn" });
    expect(giden.fatura.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: [ettn] }, durum: "kesin" });

    const gelen = bosTx({
      gelenEbelge: { findMany: vi.fn().mockResolvedValue([{ faturaId: "fa" }]) },
      fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "fa", cari: cari("c2", "TEDARIKCI") }]) },
    });
    expect(await oner(gelen, `ETTN ${ettn}`)).toEqual({ cari: cari("c2", "TEDARIKCI"), kaynak: "ettn" });
    expect(gelen.gelenEbelge.findMany.mock.calls[0][0].where.uuid.in).toEqual([ettn, ettn.toUpperCase()]);
  });

  it("KSB-44: ETTN fatura numarasından önce gelir; numaralar farklı carilere çıkarsa cari seçilmez", async () => {
    const ettn = "3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12";
    const ikisi = bosTx({ gelenEbelge: { findMany: vi.fn().mockResolvedValue([]) }, fatura: { findFirst: vi.fn(), findMany: vi.fn()
      .mockResolvedValueOnce([{ id: ettn, cari: cari("c1", "A") }])
      .mockResolvedValueOnce([{ id: "f9", cari: cari("c2", "B") }]) } });
    expect(await oner(ikisi, `${ettn} SNC2026000000034`)).toMatchObject({ kaynak: "ettn", cari: { id: "c1" } });
    const celiski = bosTx({ fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValueOnce([{ id: "f1", cari: cari("c1", "A") }, { id: "f2", cari: cari("c2", "B") }]).mockResolvedValue([]) } });
    expect(await oner(celiski, "SNC2026000000034 ABC2026000000035")).toMatchObject({ cari: null });
  });

  it("KSB-44: referans yoksa veritabanına fatura sorgusu atılmaz", async () => {
    const tx = bosTx();
    expect(await kur(tx).faturaReferanslari(tx, "t", { aciklama: "KART 4543600012345678", karsiUnvan: null })).toEqual([]);
    expect(tx.fatura.findMany).not.toHaveBeenCalled();
  });

  it("kalanı birebir tutan açık fatura tek caride ise o cari; iki caride ise öneri yok", async () => {
    const f = (cariId: string, toplam: number, odenen = 0) => ({ durum: "kesin", genelToplam: D(toplam), cari: cari(cariId, cariId), kapamalar: odenen ? [{ tutar: D(odenen) }] : [], iadeKapamalari: [] });
    const tutar = { giris: true, mutlak: D(600), doviz: "TRY" };
    const tek = bosTx({ fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([f("c1", 1000, 400), f("c2", 700)]) } });
    expect(await kur(tek).cariOner(tek, "t", { aciklama: "HAVALE", karsiIban: null, karsiUnvan: null }, tutar)).toMatchObject({ kaynak: "tutar", cari: { id: "c1" } });
    const iki = bosTx({ fatura: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([f("c1", 600), f("c2", 600)]) } });
    expect(await kur(iki).cariOner(iki, "t", { aciklama: "HAVALE", karsiIban: null, karsiUnvan: null }, tutar)).toEqual({ cari: null, kaynak: null, adAdayiVar: false });
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
