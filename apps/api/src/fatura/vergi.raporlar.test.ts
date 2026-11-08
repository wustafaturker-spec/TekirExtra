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

function calistir(kod: string, girdi: { filtreler?: Record<string, string>; gruplama?: string } = {}, ek: { gelirler?: unknown[]; kesintiler?: unknown[] } = {}) {
  const findMany = vi.fn().mockResolvedValue(SATIRLAR);
  const gelirKaydi = { findMany: vi.fn().mockResolvedValue(ek.gelirler ?? []) };
  const pazaryeriKesinti = { findMany: vi.fn().mockResolvedValue(ek.kesintiler ?? []) };
  const tanim = raporTanimiAl(kod)!;
  return { sonuc: tanim.calistir({ filtreler: { baslangic: "2026-09-01", bitis: "2026-10-31", ...girdi.filtreler }, gruplama: girdi.gruplama }, { tenantId: "t1", tx: { faturaSatir: { findMany }, gelirKaydi, pazaryeriKesinti } as never }), findMany, gelirKaydi, pazaryeriKesinti };
}

const GELIR = { id: "g1", tarih: new Date("2026-10-02T00:00:00Z"), belgeNo: "DK-1", brutTutar: D(1000), stopajOrani: D(10), stopajTutari: D(100), dovizCinsi: "USD", kur: D(40), kategori: { ad: "Temettü" }, cari: null };
const KESINTI = { id: "k1", tarih: new Date("2026-10-03T00:00:00Z"), tutar: D(12.5), dovizCinsi: "TRY", siparisNo: "S-1", baglanti: { saglayici: "trendyol", pazaryeriCari: { id: "c9", unvan: "Trendyol" } }, hareket: { kur: D(1) }, hakedis: null };

describe("Bizden kesilen stopaj: fatura dışı kaynaklar (GLR-06)", () => {
  it("gelir ve pazaryeri stopajını kovaya ekler, TL'yi belge kuruyla hesaplar, bilinmeyen matrahı boş bırakır", async () => {
    const satirlar = await calistir("vergi.kdv-disi-ozet", { gruplama: "vergi" }, { gelirler: [GELIR], kesintiler: [KESINTI] }).sonuc;
    const bul = (vergi: string) => satirlar.find((s) => s.kova === "Bizden kesilen stopaj" && String(s.vergi).startsWith(vergi));
    expect(bul("GELIR")).toMatchObject({ tutar: "4000.00", matrah: "40000.00" });
    expect(bul("ETICARET")).toMatchObject({ tutar: "12.50", matrah: null });
  });

  it("ayrıntıda kaynak ekranına bağlanır, ürün kimliği boş kalır", async () => {
    const satirlar = await calistir("vergi.kdv-disi-ayrinti", {}, { gelirler: [GELIR] }).sonuc;
    expect(satirlar.find((s) => s.faturaNo === "DK-1")).toMatchObject({ faturaYolu: "/panel/gelirler", stokId: null, cari: "—", oran: "%10" });
  });

  it("başka kova seçilince fatura dışı kaynaklar sorulmaz", async () => {
    const { sonuc, gelirKaydi } = calistir("vergi.kdv-disi-ayrinti", { filtreler: { kova: "tahsil" } }, { gelirler: [GELIR] });
    await sonuc;
    expect(gelirKaydi.findMany).not.toHaveBeenCalled();
  });

  it("pazaryerinde yalnız kaydedilmiş kesintiyi okur", async () => {
    const { sonuc, pazaryeriKesinti } = calistir("vergi.kdv-disi-ayrinti");
    await sonuc;
    expect(pazaryeriKesinti.findMany.mock.calls[0][0].where).toMatchObject({ sinif: "stopaj", durum: { in: ["giderlesti", "hakediste_kaydedildi"] } });
  });
});

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
