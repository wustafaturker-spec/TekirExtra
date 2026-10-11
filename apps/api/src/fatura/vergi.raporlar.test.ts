import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { raporTanimiAl } from "../core/raporlar/rapor-kayit";
import { RaporlarService } from "../core/raporlar/raporlar.service";
import "./vergi.raporlar";

const baglam = vi.hoisted(() => ({ rol: "muhasebe" }));
vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: baglam.rol }) }));

const D = (d: number | string) => new Prisma.Decimal(d);
const otv = (tutar: string, matrah = "1000.00") => ({ kod: "0074", ad: "ÖTV IV. Liste", hesap: "oran", oran: "25", birimTutar: null, matrah, tutar, stopaj: false, kdvMatrahinaDahil: true });
const stopaj = (tutar: string) => ({ kod: "0003", ad: "Gelir Vergisi Stopajı", hesap: "oran", oran: "20", birimTutar: null, matrah: "500.00", tutar, stopaj: true, kdvMatrahinaDahil: false });
const maktu = { kod: "0071", ad: "ÖTV I. Liste", hesap: "birim", oran: null, birimTutar: "12.5", matrah: null, tutar: "300.00", stopaj: false, kdvMatrahinaDahil: true, anaBirim: "lt", katsayi: "12" };
const satir = (id: string, tip: string, tarih: string, ekVergiler: unknown[], ek: Record<string, unknown> = {}) => ({
  matrah: D(1000), birim: "adet", ekVergiler, stok: { kod: "STK", ad: "Ürün" },
  fatura: { id, no: id.toUpperCase(), tarih: new Date(`${tarih}T00:00:00Z`), tip, kur: D(1), dovizCinsi: "TRY", cari: { id: "c1", unvan: "Müşteri A" }, ...ek },
});

const SATIRLAR = [
  satir("s1", "satis", "2026-09-10", [otv("250.00")]),
  // Dövizli satış: 100 EUR ÖTV × 40 = 4.000 TL
  satir("s2", "satis", "2026-10-05", [otv("100.00", "400.00")], { kur: D(40), dovizCinsi: "EUR" }),
  satir("s3", "satis", "2026-10-06", [stopaj("100.00")]),
  satir("a1", "alis", "2026-10-07", [otv("50.00", "200.00"), stopaj("40.00")], { cari: { id: "c2", unvan: "Tedarikçi B" } }),
  satir("a2", "alis", "2026-10-08", [maktu], { cari: { id: "c2", unvan: "Tedarikçi B" } }),
];

function calistir(kod: string, girdi: { filtreler?: Record<string, string>; gruplama?: string } = {}) {
  const findMany = vi.fn().mockResolvedValue(SATIRLAR);
  const tanim = raporTanimiAl(kod)!;
  return { sonuc: tanim.calistir({ filtreler: { baslangic: "2026-09-01", bitis: "2026-10-31", ...girdi.filtreler }, gruplama: girdi.gruplama }, { tenantId: "t1", tx: { faturaSatir: { findMany } } as never }), findMany };
}

describe("KDV dışı vergiler raporu (RPR-09)", () => {
  it("yalnız kesin satış/alış faturalarının vergili satırlarını dönemle sorar", async () => {
    const { sonuc, findMany } = calistir("vergi.kdv-disi-ayrinti", { filtreler: { cariId: "c2" } });
    await sonuc;
    const where = findMany.mock.calls[0][0].where;
    expect(where.fatura).toMatchObject({ durum: "kesin", tip: { in: ["satis", "alis"] }, cariId: "c2" });
    expect(where.OR).toEqual([{ ekVergiTutari: { gt: 0 } }, { stopajTutari: { gt: 0 } }]);
  });

  it("dört kovayı ayırır, dövizliyi fatura kuruyla TL'ye çevirir ve dönem toplamı verir", async () => {
    const satirlar = await calistir("vergi.kdv-disi-ozet", { gruplama: "vergi" }).sonuc;
    const bul = (kova: string, vergi: string) => satirlar.find((s) => s.kova === kova && String(s.vergi).startsWith(vergi));
    expect(bul("Tahsil edilen", "0074")).toMatchObject({ faturaSayisi: 2, tutar: "4250.00", matrah: "17000.00" });
    expect(bul("Bizden kesilen stopaj", "0003")).toMatchObject({ tutar: "100.00" });
    expect(bul("Ödenen", "0074")).toMatchObject({ tutar: "50.00" });
    expect(bul("Ödenen", "0071")).toMatchObject({ tutar: "300.00" });
    expect(bul("Kestiğimiz stopaj", "0003")).toMatchObject({ tutar: "40.00" });
  });

  it("ay kırılımında ayları ayrı, en altta dönem toplamını verir", async () => {
    const satirlar = await calistir("vergi.kdv-disi-ozet").sonuc;
    const tahsil = satirlar.filter((s) => s.kova === "Tahsil edilen");
    expect(tahsil.map((s) => [s.grup, s.tutar])).toEqual([["2026-09", "250.00"], ["2026-10", "4000.00"], ["Dönem toplamı", "4250.00"]]);
    expect(satirlar.at(-1)!.grup).toBe("Dönem toplamı");
  });

  it("ayrıntıda belge dövizi + TL, oran ya da birim başı tutar ve fatura bağlantısı", async () => {
    const satirlar = await calistir("vergi.kdv-disi-ayrinti").sonuc;
    expect(satirlar.find((s) => s.faturaNo === "S2")).toMatchObject({ tutar: "100.00", dovizCinsi: "EUR", tutarTl: "4000.00", oran: "%25", faturaYolu: "/panel/fatura/yeni?ac=s2" });
    expect(satirlar.find((s) => s.faturaNo === "A2")).toMatchObject({ oran: "12,5 TL / lt", kova: "Ödenen" });
  });

  it("kova ve vergi kodu filtresi uygular", async () => {
    const satirlar = await calistir("vergi.kdv-disi-ayrinti", { filtreler: { kova: "odenen", vergiKodu: "0074" } }).sonuc;
    expect(satirlar.map((s) => s.faturaNo)).toEqual(["A1"]);
  });

  it("yalnız yönetici, muhasebe ve mali müşavir görür ve çalıştırır", async () => {
    const servis = new RaporlarService({ tenantIslem: vi.fn() } as never, {} as never);
    baglam.rol = "satis";
    expect(servis.listele("vergi")).toEqual([]);
    await expect(servis.calistir("vergi.kdv-disi-ozet", { filtreler: { baslangic: "2026-10-01", bitis: "2026-10-31" } })).rejects.toThrow(ForbiddenException);
    baglam.rol = "mali_musavir";
    expect(servis.listele("vergi").map((r) => r.kod)).toEqual(["vergi.kdv-disi-ozet", "vergi.kdv-disi-ayrinti"]);
    baglam.rol = "muhasebe";
  });
});
