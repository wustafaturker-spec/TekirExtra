import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }),
  baglamlaCalistir: (_b: unknown, is: () => unknown) => is(),
}));

import { FaturaService } from "./fatura.service";
import { TekrarlayanFaturaZamanlayiciService, istanbulGunu, sonrakiGunlukKontrolMs } from "./tekrarlayan-fatura-zamanlayici.service";

const gun = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Aylık plan, 3 dönemi gecikmiş; fatura.create sayılır. */
function uretimDuzenegi() {
  const sablon = {
    tip: "satis", tarih: gun("2026-01-01"), vadeTarihi: null, cariId: "c1", depoId: "d1", dovizCinsi: "TRY", kur: new Prisma.Decimal(1),
    teslimatAdres: null, teslimatIl: null, teslimatIlce: null, teslimatPostaKodu: null,
    genelIskontoYuzdesi: null, genelIskontoTutari: null, toplamBrut: 0, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: 0,
    toplamKdv: 0, toplamTevkifat: 0, toplamNetKdv: 0, toplamEkVergi: 0, toplamStopaj: 0, genelToplam: 0, aciklama: null, notlar: null, satirlar: [],
  };
  const bugun = new Date(); bugun.setUTCHours(0, 0, 0, 0);
  const ilk = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth() - 2, 1));
  const plan = { id: "p1", aktif: true, siklik: "aylik", aralik: 1, sonrakiTarih: ilk, bitisTarihi: null, sonUretimTarihi: null, sablonFatura: sablon };
  let sayac = 0;
  const tx = {
    $queryRaw: vi.fn(async () => [{ kilit: 1 }]),
    tekrarlayanFatura: { findMany: vi.fn(async () => [plan]), update: vi.fn(async () => ({})) },
    fatura: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: `f${++sayac}` })) },
    faturaSatir: { create: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn(async (_t: string, is: (t: typeof tx) => unknown) => is(tx)) };
  const servis = new FaturaService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { servis, tx, ilk };
}

describe("FTR-43 vadesiGelenleriUret kota sınırı", () => {
  it("kota yoksa gecikmiş tüm dönemleri üretir", async () => {
    const { servis, tx } = uretimDuzenegi();
    const sonuc = await servis.vadesiGelenleriUret();
    expect(sonuc.uretilenAdet).toBe(3);
    expect(sonuc.kotaDoldu).toBe(false);
    expect(tx.fatura.create).toHaveBeenCalledTimes(3);
  });

  it("kota dolunca durur ve plan üretilemeyen dönemde bekler", async () => {
    const { servis, tx, ilk } = uretimDuzenegi();
    const sonuc = await servis.vadesiGelenleriUret({ kalanKota: 1 });
    expect(sonuc).toMatchObject({ uretilenAdet: 1, kotaDoldu: true });
    const bekleyen = new Date(Date.UTC(ilk.getUTCFullYear(), ilk.getUTCMonth() + 1, 1));
    expect(tx.tekrarlayanFatura.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sonrakiTarih: bekleyen, sonUretimTarihi: ilk, aktif: true }),
    }));
  });

  it("kota 0 ise hiç üretmez, plan ilerlemez", async () => {
    const { servis, tx, ilk } = uretimDuzenegi();
    const sonuc = await servis.vadesiGelenleriUret({ kalanKota: 0 });
    expect(sonuc).toMatchObject({ uretilenAdet: 0, kotaDoldu: true });
    expect(tx.fatura.create).not.toHaveBeenCalled();
    expect(tx.tekrarlayanFatura.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sonrakiTarih: ilk }) }));
  });
});

describe("FTR-43 zamanlayıcı", () => {
  const faturalar = { vadesiGelenleriUret: vi.fn() };
  const abonelik = { kalanLimit: vi.fn() };
  const bildirimler = { uret: vi.fn(async () => ({ bildirimId: "b", yeniTeslimat: 1 })) };
  const prisma = { tenantIslem: vi.fn(async () => 2) };
  const zamanlayici = () => new TekrarlayanFaturaZamanlayiciService(prisma as never, faturalar as never, abonelik as never, bildirimler as never);

  beforeEach(() => { vi.clearAllMocks(); });

  it("üretim olunca günün toplamıyla tek bilgi bildirimi verir", async () => {
    abonelik.kalanLimit.mockResolvedValue({ kalan: null, limit: null, planAdi: "Kurumsal" });
    faturalar.vadesiGelenleriUret.mockResolvedValue({ uretilenAdet: 1, faturaIds: ["f1"], kotaDoldu: false });
    const simdi = Date.parse("2026-11-06T21:30:00Z"); // İstanbul 07.11 00:30
    const sonuc = await zamanlayici().firmaIcinUret("t1", simdi);
    expect(sonuc).toEqual({ uretilenAdet: 1, kotaDoldu: false });
    expect(faturalar.vadesiGelenleriUret).toHaveBeenCalledWith({ kalanKota: null });
    expect(bildirimler.uret).toHaveBeenCalledTimes(1);
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({
      onem: "bilgi", baslik: "2 tekrarlayan fatura taslağı oluştu",
      birlesimAnahtari: "tekrarlayan-fatura-uretim:2026-11-07", roller: ["yonetici", "muhasebe"],
    }));
  });

  it("kota 0 ise üretimi çağırmaz, uyarı verir", async () => {
    abonelik.kalanLimit.mockResolvedValue({ kalan: 0, limit: 100, planAdi: "Başlangıç" });
    const sonuc = await zamanlayici().firmaIcinUret("t1");
    expect(sonuc).toEqual({ uretilenAdet: 0, kotaDoldu: true });
    expect(faturalar.vadesiGelenleriUret).not.toHaveBeenCalled();
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "uyari", baslik: expect.stringContaining("kotası doldu") }));
  });

  it("kalan kotayı üretime geçirir; dolarsa hem üretim hem kota bildirimi", async () => {
    abonelik.kalanLimit.mockResolvedValue({ kalan: 2, limit: 100, planAdi: "Başlangıç" });
    faturalar.vadesiGelenleriUret.mockResolvedValue({ uretilenAdet: 2, faturaIds: ["a", "b"], kotaDoldu: true });
    await zamanlayici().firmaIcinUret("t1");
    expect(faturalar.vadesiGelenleriUret).toHaveBeenCalledWith({ kalanKota: 2 });
    expect(bildirimler.uret).toHaveBeenCalledTimes(2);
  });

  it("firma hatası yakalanır ve firmaya uyarı bildirimi düşer", async () => {
    abonelik.kalanLimit.mockResolvedValue({ kalan: null, limit: null, planAdi: "Kurumsal" });
    faturalar.vadesiGelenleriUret.mockRejectedValue(new Error("şablon silinmiş"));
    const sonuc = await zamanlayici().firmaIcinUret("t1");
    expect(sonuc.hata).toBe("şablon silinmiş");
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "uyari", aciklama: expect.stringContaining("şablon silinmiş") }));
  });

  it("bildirim hatası üretim sonucunu bozmaz", async () => {
    abonelik.kalanLimit.mockResolvedValue({ kalan: null, limit: null, planAdi: "Kurumsal" });
    faturalar.vadesiGelenleriUret.mockResolvedValue({ uretilenAdet: 1, faturaIds: ["f1"], kotaDoldu: false });
    bildirimler.uret.mockRejectedValueOnce(new Error("db"));
    await expect(zamanlayici().firmaIcinUret("t1")).resolves.toEqual({ uretilenAdet: 1, kotaDoldu: false });
  });

  it("askıdaki firma atlanır, diğer firmalar çalışır", async () => {
    const z = zamanlayici();
    const erisim = { otomasyonDurdu: vi.fn(async (t: string) => t === "askida") };
    (z as unknown as { erisim: typeof erisim }).erisim = erisim;
    vi.spyOn(z as unknown as { tenantIdleriAl: () => Promise<string[]> }, "tenantIdleriAl").mockResolvedValue(["askida", "acik"]);
    const firma = vi.spyOn(z, "firmaIcinUret").mockResolvedValue({ uretilenAdet: 0, kotaDoldu: false });
    await z.calistir();
    expect(erisim.otomasyonDurdu).toHaveBeenCalledWith("askida", "fatura");
    expect(firma).toHaveBeenCalledTimes(1);
    expect(firma).toHaveBeenCalledWith("acik");
  });
});

describe("FTR-43 zaman hesabı", () => {
  it("00:15 İstanbul öncesi aynı gün, sonrası ertesi gün çalışır", () => {
    expect(sonrakiGunlukKontrolMs(Date.parse("2026-11-06T21:10:00Z"))).toBe(5 * 60_000); // 00:10 → 00:15
    expect(sonrakiGunlukKontrolMs(Date.parse("2026-11-06T21:20:00Z"))).toBe(24 * 3_600_000 - 5 * 60_000);
  });
  it("İstanbul gününü UTC gece yarısına göre değil yerel güne göre verir", () => {
    expect(istanbulGunu(Date.parse("2026-11-06T22:00:00Z"))).toEqual({ baslangic: new Date("2026-11-06T21:00:00Z"), anahtar: "2026-11-07" });
  });
});
