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
  const plan = { id: "p1", aktif: true, siklik: "aylik", aralik: 1, sonrakiTarih: ilk, bitisTarihi: null, sonUretimTarihi: null, sablonFatura: sablon,
    aciklamaSablonu: null as string | null, notSablonu: null as string | null, faturalananDonem: "bu_donem" };
  let sayac = 0;
  const tx = {
    $queryRaw: vi.fn(async () => [{ kilit: 1 }]),
    tekrarlayanFatura: { findMany: vi.fn(async () => [plan]), update: vi.fn(async () => ({})) },
    fatura: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: `f${++sayac}` })) },
    faturaSatir: { create: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn(async (_t: string, is: (t: typeof tx) => unknown) => is(tx)) };
  const servis = new FaturaService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { servis, tx, ilk, plan, sablon };
}

describe("FTR-44 dönem değişkenleri üretimde", () => {
  it("plan şablonu varsa açıklama/not her dönem için doldurulur", async () => {
    const { servis, tx, plan, ilk } = uretimDuzenegi();
    plan.aciklamaSablonu = "{{AY_ADI}} {{YIL}} danışmanlık";
    plan.notSablonu = "Dönem: {{DONEM_BAS}}-{{DONEM_BIT}}";
    await servis.vadesiGelenleriUret();
    const ay = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    const ilkVeri = (tx.fatura.create.mock.calls[0] as unknown as [{ data: { aciklama: string; notlar: string } }])[0].data;
    expect(ilkVeri.aciklama).toBe(`${ay[ilk.getUTCMonth()]} ${ilk.getUTCFullYear()} danışmanlık`);
    expect(ilkVeri.notlar).toMatch(/^Dönem: 01\.\d\d\.\d{4}-\d\d\.\d\d\.\d{4}$/);
    const ikinci = (tx.fatura.create.mock.calls[1] as unknown as [{ data: { aciklama: string } }])[0].data;
    expect(ikinci.aciklama).toBe(`${ay[(ilk.getUTCMonth() + 1) % 12]} ${ilk.getUTCMonth() === 11 ? ilk.getUTCFullYear() + 1 : ilk.getUTCFullYear()} danışmanlık`);
  });

  it("plan şablonu yoksa şablon faturanın metni kopyalanır", async () => {
    const { servis, tx, sablon } = uretimDuzenegi();
    (sablon as { aciklama: string | null }).aciklama = "Sabit metin {{AY}}";
    await servis.vadesiGelenleriUret();
    expect((tx.fatura.create.mock.calls[0] as unknown as [{ data: { aciklama: string } }])[0].data.aciklama).toBe("Sabit metin {{AY}}");
  });
});

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

describe("FTR-44 plan şeması", () => {
  it("tanımsız değişkeni reddeder, boş metni şablonsuz sayar", async () => {
    const { tekrarlayanFaturaSemasi, tekrarlayanFaturaGuncelleSemasi } = await import("./fatura.semalar");
    const taban = { ad: "Kira", sablonFaturaId: "7f0c2f2e-0d4c-4a8b-9a51-3b1f2a0c9d11", siklik: "aylik", sonrakiTarih: "2026-11-03" };
    const hatali = tekrarlayanFaturaSemasi.safeParse({ ...taban, aciklamaSablonu: "{{AY_ADI}} {{AYY}}" });
    expect(hatali.success).toBe(false);
    expect(hatali.error?.issues[0]?.message).toContain("{{AYY}}");
    const tamam = tekrarlayanFaturaSemasi.parse({ ...taban, aciklamaSablonu: "  {{AY_ADI}} kira  ", notSablonu: "   " });
    expect(tamam).toMatchObject({ aciklamaSablonu: "{{AY_ADI}} kira", notSablonu: null, faturalananDonem: "bu_donem" });
    expect(tekrarlayanFaturaGuncelleSemasi.parse({ aciklamaSablonu: "" })).toEqual({ aciklamaSablonu: null });
  });
});

describe("FTR-45 kur ve güncel fiyat", () => {
  /** Tek dönemi gecikmiş plan; döviz, kur kayıtları ve fiyat kaynağı ayarlanabilir. */
  function duzenek(o: { doviz?: string; tip?: string; tcmb?: { dovizCinsi: string; dovizAlis: number; dovizSatis: number }[]; fiyatKaynagi?: string } = {}) {
    const bugun = new Date(); bugun.setUTCHours(0, 0, 0, 0);
    const sablon = {
      tip: o.tip ?? "satis", tarih: gun("2026-01-01"), vadeTarihi: null, cariId: "c1", depoId: "d1", dovizCinsi: o.doviz ?? "TRY", kur: new Prisma.Decimal(30),
      teslimatAdres: null, teslimatIl: null, teslimatIlce: null, teslimatPostaKodu: null, genelIskontoYuzdesi: null, genelIskontoTutari: null,
      toplamBrut: 0, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: 0, toplamKdv: 0, toplamTevkifat: 0, toplamNetKdv: 0, toplamEkVergi: 0, toplamStopaj: 0, genelToplam: 0,
      aciklama: null, notlar: null, satirlar: [],
    };
    const plan = { id: "p1", ad: "Plan", aktif: true, siklik: "aylik", aralik: 1, sonrakiTarih: bugun, bitisTarihi: null, sonUretimTarihi: null, sablonFatura: sablon,
      aciklamaSablonu: null, notSablonu: null, faturalananDonem: "bu_donem", fiyatKaynagi: o.fiyatKaynagi ?? "sablon" };
    const tcmb = (o.tcmb ?? []).map((k) => ({ ...k, tarih: bugun, kaynak: "TCMB_XML", alindiAt: bugun, dovizAlis: new Prisma.Decimal(k.dovizAlis), dovizSatis: new Prisma.Decimal(k.dovizSatis) }));
    const uretilen = { id: "f1", tip: o.tip ?? "satis", dovizCinsi: o.doviz ?? "TRY", kur: new Prisma.Decimal(1), tarih: bugun, cariId: "c1", satirlar: [
      { id: "s1", stokId: "k1", varyantId: null, birimFiyat: new Prisma.Decimal(100), stok: { kod: "K1", ad: "Danışmanlık" } },
      { id: "s2", stokId: "k2", varyantId: null, birimFiyat: new Prisma.Decimal(50), stok: { kod: "K2", ad: "Bakım" } },
    ] };
    const tx = {
      $queryRaw: vi.fn(async () => [{ kilit: 1 }]),
      tekrarlayanFatura: { findMany: vi.fn(async () => [plan]), update: vi.fn(async () => ({})) },
      fatura: { findFirst: vi.fn(async () => null), create: vi.fn(async (a: { data: { kur: unknown } }) => { uretilen.kur = a.data.kur as Prisma.Decimal; return { id: "f1" }; }), findUniqueOrThrow: vi.fn(async () => uretilen) },
      faturaSatir: { create: vi.fn() },
      elleKur: { findMany: vi.fn(async () => []) },
      tcmbKuru: { findMany: vi.fn(async (a: { where: { dovizCinsi: { in: string[] } } }) => tcmb.filter((k) => a.where.dovizCinsi.in.includes(k.dovizCinsi))) },
    };
    const prisma = { tenantIslem: vi.fn(async (_t: string, is: (t: typeof tx) => unknown) => is(tx)) };
    const stok = { kaynakFiyatBul: vi.fn() };
    const servis = new FaturaService(prisma as never, stok as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const guncelle = vi.spyOn(servis, "guncelle").mockResolvedValue({} as never);
    return { servis, tx, plan, stok, guncelle, bugun };
  }

  it("TL belgede şablon kuru korunur", async () => {
    const { servis, tx } = duzenek();
    await servis.vadesiGelenleriUret();
    expect(String((tx.fatura.create.mock.calls[0] as unknown as [{ data: { kur: unknown } }])[0].data.kur)).toBe("30");
  });

  it("dövizli satışta günün döviz alış kuru yazılır", async () => {
    const { servis, tx } = duzenek({ doviz: "USD", tcmb: [{ dovizCinsi: "USD", dovizAlis: 42.1, dovizSatis: 42.3 }] });
    const sonuc = await servis.vadesiGelenleriUret();
    expect(sonuc.uretilenAdet).toBe(1);
    expect(String((tx.fatura.create.mock.calls[0] as unknown as [{ data: { kur: unknown } }])[0].data.kur)).toBe("42.1");
  });

  it("dövizli alışta döviz satış kuru yazılır", async () => {
    const { servis, tx } = duzenek({ doviz: "USD", tip: "alis", tcmb: [{ dovizCinsi: "USD", dovizAlis: 42.1, dovizSatis: 42.3 }] });
    await servis.vadesiGelenleriUret();
    expect(String((tx.fatura.create.mock.calls[0] as unknown as [{ data: { kur: unknown } }])[0].data.kur)).toBe("42.3");
  });

  it("kur yoksa üretmez, plan bekler ve kursuz olarak döner", async () => {
    const { servis, tx, bugun } = duzenek({ doviz: "EUR" });
    const sonuc = await servis.vadesiGelenleriUret();
    expect(sonuc.uretilenAdet).toBe(0);
    expect(sonuc.kursuzlar).toEqual([{ planId: "p1", ad: "Plan", dovizCinsi: "EUR", tarih: bugun.toISOString().slice(0, 10) }]);
    expect(tx.tekrarlayanFatura.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sonrakiTarih: bugun }) }));
  });

  it("şablon fiyatlı planda güncelleme yapılmaz", async () => {
    const { servis, guncelle, stok } = duzenek();
    await servis.vadesiGelenleriUret();
    expect(stok.kaynakFiyatBul).not.toHaveBeenCalled();
    expect(guncelle).not.toHaveBeenCalled();
  });

  it("güncel fiyat: değişen satır güncellenir, bulunamayan şablonda kalır ve uyarılır", async () => {
    const { servis, guncelle, stok } = duzenek({ fiyatKaynagi: "guncel" });
    stok.kaynakFiyatBul.mockImplementation(async (_tx: unknown, g: { stokId: string }) => g.stokId === "k1"
      ? { birimFiyat: 120, kaynakDoviz: "TRY", fiyatKaynagi: "fiyat_listesi" }
      : { birimFiyat: 0, kaynakDoviz: "TRY", fiyatKaynagi: "kart" });
    const sonuc = await servis.vadesiGelenleriUret();
    expect(guncelle).toHaveBeenCalledWith("f1", {}, { birimFiyatlari: new Map([["s1", "120.0000"]]) });
    expect(sonuc.fiyatUyarilari).toEqual([{ planId: "p1", ad: "Plan", faturaId: "f1", sorunlar: ["K2 Bakım: güncel fiyat tanımlı değil"] }]);
  });

  it("güncel fiyat: kaynak dövizi belgeye kurla çevrilir", async () => {
    const { servis, guncelle, stok } = duzenek({ fiyatKaynagi: "guncel", tcmb: [{ dovizCinsi: "USD", dovizAlis: 40, dovizSatis: 41 }] });
    stok.kaynakFiyatBul.mockResolvedValue({ birimFiyat: 2.5, kaynakDoviz: "USD", fiyatKaynagi: "urun" });
    await servis.vadesiGelenleriUret();
    // 2,5 USD × 40 (satışta döviz alış) = 100 TL: s1 zaten 100, yalnız s2 değişir.
    expect(guncelle).toHaveBeenCalledWith("f1", {}, { birimFiyatlari: new Map([["s2", "100.0000"]]) });
  });

  it("güncelleme hatası taslağı bozmaz, uyarıya döner", async () => {
    const { servis, guncelle, stok } = duzenek({ fiyatKaynagi: "guncel" });
    stok.kaynakFiyatBul.mockResolvedValue({ birimFiyat: 999, kaynakDoviz: "TRY", fiyatKaynagi: "urun" });
    guncelle.mockRejectedValue(new Error("Dönem kilitli"));
    const sonuc = await servis.vadesiGelenleriUret();
    expect(sonuc.uretilenAdet).toBe(1);
    expect(sonuc.fiyatUyarilari[0]?.sorunlar[0]).toContain("Dönem kilitli");
  });
});

describe("FTR-45 zamanlayıcı uyarıları", () => {
  it("kursuz plan ve fiyat sorunu ayrı uyarı bildirimleri üretir", async () => {
    const faturalar = { vadesiGelenleriUret: vi.fn(async () => ({ uretilenAdet: 0, faturaIds: [], kotaDoldu: false,
      kursuzlar: [{ planId: "p1", ad: "Kira", dovizCinsi: "EUR", tarih: "2026-11-06" }],
      fiyatUyarilari: [{ planId: "p2", ad: "Bakım", faturaId: "f9", sorunlar: ["K2 Bakım: güncel fiyat tanımlı değil"] }] })) };
    const bildirimler = { uret: vi.fn(async () => ({ bildirimId: "b", yeniTeslimat: 1 })) };
    const z = new TekrarlayanFaturaZamanlayiciService({} as never, faturalar as never, { kalanLimit: vi.fn(async () => ({ kalan: null, limit: null, planAdi: "K" })) } as never, bildirimler as never);
    await z.firmaIcinUret("t1");
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "tekrarlayan-fatura-kur:p1:2026-11-06", hedefYol: "/panel/ayarlar/doviz-kurlari" }));
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "tekrarlayan-fatura-fiyat:f9", hedefYol: "/panel/fatura?ac=f9", aciklama: expect.stringContaining("K2 Bakım") }));
  });
});
