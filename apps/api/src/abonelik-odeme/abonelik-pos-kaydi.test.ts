import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../fatura/odeme-durumu", () => ({
  faturaKilitleVeKalaniGetir: vi.fn(async () => ({ id: "f1", no: null, durum: "kesin", cariId: "c1", kalan: new Prisma.Decimal("14385.60") })),
}));

import { AbonelikFaturaService } from "./abonelik-fatura.service";

const D = (v: string) => new Prisma.Decimal(v);
const pos = { id: "pos1", saglayici: "iyzico", dovizCinsi: "TRY", komisyonOrani: D("3.49"), islemUcreti: D("0.25"), taksitOranlari: null };
const kesintiYaniti = {
  basarili: true, odemeId: "38614000", fiyat: 14385.6, odenen: 14385.6, taksit: 1, odemeIslemNolari: ["PTX-1"], dovizCinsi: "TRY",
  kesinti: { saglayiciKomisyonu: "502.06", saglayiciUcreti: "0.25", isyerineGecenKalemleri: ["13883.29"], kartMarkasi: "MASTER_CARD", kartAilesi: "Paraf", kartTuru: "CREDIT_CARD", kartBin: "552608", kartSon4: "0006", provizyonKodu: "PRV1", hostReferansi: "H1" },
};

function kur(o: { odemeKaynak?: string; deneme?: Record<string, unknown> | null; etkin?: Record<string, unknown> | null; ayar?: Record<string, unknown>; ayrintiHata?: boolean } = {}) {
  const olusturulan: Record<string, unknown>[] = [];
  const tx = {
    posHesap: { findUnique: vi.fn(async () => pos), findUniqueOrThrow: vi.fn(async () => pos) },
    posTahsilat: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { olusturulan.push(data); return { id: "pt1", ...data }; }) },
    abonelikOdemeDenemesi: { findFirst: vi.fn(async () => (o.deneme === undefined ? { saglayici: "iyzico", ortam: "test", saglayiciOdemeId: "38614000" } : o.deneme)) },
    abonelikOdemesi: { findUniqueOrThrow: vi.fn(async () => ({ kaynak: o.odemeKaynak ?? "saglayici", createdAt: new Date("2026-11-01T14:04:00Z") })) },
    kasaBankaHareket: { findFirst: vi.fn(async () => ({ id: "h1", posHesapId: "pos1", cariId: "c1", faturaId: "f1", tutar: D("14385.60"), posHesap: { saglayici: "iyzico" } })) },
    $queryRaw: vi.fn(async () => []),
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    abonelikFaturasi: {
      findFirst: vi.fn(async () => ({ odemeId: "o1", odeyenTenantId: "odeyen", faturalayanTenantId: "faturalayan", durum: "taslak" })),
      findMany: vi.fn(async () => [{ odemeId: "o1", odeyenTenantId: "odeyen", tahsilatHareketId: "h1" }]),
      update: vi.fn(async () => ({})),
    },
    abonelikFaturaAyari: { findUnique: vi.fn(async () => ({ kartHesapTur: "pos", kartHesapId: "pos1", elleHesapTur: "banka", elleHesapId: "b1", ...o.ayar })) },
  };
  const kasa = { hareketOlustur: vi.fn(async () => ({ id: "h1" })) };
  const fatura = { kesinlesinceCalistir: vi.fn() };
  const saglayicilar = { etkin: vi.fn(async () => (o.etkin === undefined ? { saglayici: "iyzico", ortam: "test", config: { apiKey: "a", secretKey: "s" } } : o.etkin)) };
  const s = new AbonelikFaturaService(prisma as never, {} as never, fatura as never, {} as never, kasa as never, saglayicilar as never);
  const odemeAyrintisi = vi.fn(async () => { if (o.ayrintiHata) throw new Error("iyzico kapalı"); return kesintiYaniti; });
  s.iyzico = { odemeAyrintisi } as never;
  return { s, tx, prisma, kasa, olusturulan, odemeAyrintisi };
}

describe("PLT-39/40 abonelik kart tahsilatı POS işlem listesine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kartla ödeme POS hesabına tahsil edilince hareketle bağlı, iyzico kesintili POS kaydı açılır", async () => {
    const { s, olusturulan, odemeAyrintisi, prisma } = kur();
    await s.faturaKesinlesti("faturalayan", "f1");
    expect(odemeAyrintisi).toHaveBeenCalledWith({ apiKey: "a", secretKey: "s", baseUrl: "https://sandbox-api.iyzipay.com" }, "38614000");
    expect(olusturulan).toHaveLength(1);
    expect(olusturulan[0]).toMatchObject({
      tenantId: "faturalayan", posHesapId: "pos1", cariId: "c1", faturaId: "f1", kanal: "abonelik", durum: "odendi", hareketId: "h1",
      saglayiciOdemeId: "38614000", kartBin: "552608", kartSon4: "0006", provizyonKodu: "PRV1", komisyonKaynagi: "saglayici",
      odemeTarihi: new Date("2026-11-01T14:04:00Z"),
    });
    expect((olusturulan[0].komisyonTutari as Prisma.Decimal).toFixed(2)).toBe("502.31");
    expect((olusturulan[0].netTutar as Prisma.Decimal).toFixed(2)).toBe("13883.29");
    expect(prisma.abonelikFaturasi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "tahsil_edildi", tahsilatHareketId: "h1" }) }));
  });

  it("iyzico'ya ulaşılamazsa kayıt yine açılır, komisyon POS oranlarıyla tahmini olur", async () => {
    const { s, olusturulan } = kur({ ayrintiHata: true });
    await s.faturaKesinlesti("faturalayan", "f1");
    expect(olusturulan[0]).toMatchObject({ kanal: "abonelik", saglayiciOdemeId: "38614000", komisyonKaynagi: "tahmin" });
    expect((olusturulan[0].komisyonTutari as Prisma.Decimal).toFixed(2)).toBe("502.31");
    expect(olusturulan[0].kartSon4).toBeUndefined();
  });

  it("ortam ya da sağlayıcı uyuşmazsa iyzico'ya gidilmez (PayTR: tahmini komisyon)", async () => {
    const a = kur({ etkin: { saglayici: "iyzico", ortam: "canli", config: {} } });
    await a.s.faturaKesinlesti("faturalayan", "f1");
    expect(a.odemeAyrintisi).not.toHaveBeenCalled();
    const b = kur({ deneme: { saglayici: "paytr", ortam: "test", saglayiciOdemeId: "OID" } });
    await b.s.faturaKesinlesti("faturalayan", "f1");
    expect(b.odemeAyrintisi).not.toHaveBeenCalled();
    expect(b.olusturulan[0]).toMatchObject({ saglayiciOdemeId: "OID", komisyonKaynagi: "tahmin" });
  });

  it("elle ödeme ya da POS olmayan hesap POS kaydı açmaz", async () => {
    const elle = kur({ odemeKaynak: "elle" });
    await elle.s.faturaKesinlesti("faturalayan", "f1");
    expect(elle.olusturulan).toHaveLength(0);
    const banka = kur({ ayar: { kartHesapTur: "banka", kartHesapId: "b1" } });
    await banka.s.faturaKesinlesti("faturalayan", "f1");
    expect(banka.olusturulan).toHaveLength(0);
    expect(banka.kasa.hareketOlustur).toHaveBeenCalledWith(expect.anything(), "faturalayan", expect.objectContaining({ bankaHesapId: "b1" }));
  });
});

describe("PLT-41 eksik POS kayıtlarının tamamlanması", () => {
  it("POS hesabına yazılmış, POS kaydı olmayan kartlı tahsilat için kayıt açar; elle ödemeyi atlar", async () => {
    const { s, olusturulan } = kur();
    expect(await s.eksikPosKayitlariniTamamla("faturalayan")).toBe(1);
    expect(olusturulan[0]).toMatchObject({ hareketId: "h1", kanal: "abonelik", cariId: "c1", faturaId: "f1", komisyonKaynagi: "saglayici" });
    const elle = kur({ odemeKaynak: "elle" });
    expect(await elle.s.eksikPosKayitlariniTamamla("faturalayan")).toBe(0);
  });

  it("hareket artık POS kaydına bağlıysa (yarış) ikinci kayıt açılmaz", async () => {
    const { s, tx, olusturulan } = kur();
    tx.kasaBankaHareket.findFirst.mockResolvedValueOnce({ id: "h1", posHesapId: "pos1", cariId: "c1", faturaId: "f1", tutar: D("1"), posHesap: { saglayici: "iyzico" } }).mockResolvedValueOnce(null as never);
    expect(await s.eksikPosKayitlariniTamamla("faturalayan")).toBe(0);
    expect(olusturulan).toHaveLength(0);
  });
});
