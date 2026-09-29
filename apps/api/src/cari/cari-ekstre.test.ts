import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ekstreAyrintilari, hedefDovizTutari, kurCozucu, type EkstreHareketi } from "./cari-ekstre";
import { ekstrePdfHtml, type EkstreVerisi } from "./cari-ekstre-pdf";

const D = (d: string | number) => new Prisma.Decimal(d);
const hareket = (ek: Partial<EkstreHareketi>): EkstreHareketi => ({
  id: "h1", tip: "borc", tutar: D(100), dovizCinsi: "TRY", kur: D(1), tutarTry: D(100), tarih: new Date("2026-09-10T00:00:00Z"), kaynakTur: "fatura", kaynakRef: "f1", ...ek,
});

describe("ekstre ayrıntıları (CARI-24/25)", () => {
  function tx() {
    return {
      fatura: { findMany: vi.fn().mockResolvedValue([{ id: "f1", no: "M012026000000206", tip: "satis", dovizCinsi: "USD", kur: D("40.6672"), toplamMatrah: D(100), toplamKdv: D(20), genelToplam: D(120) }]) },
      faturaSatir: { findMany: vi.fn().mockResolvedValue([{ faturaId: "f1", miktar: D(9000), birim: "adet", birimFiyat: D("15.125"), iskontoOrani: D(0), matrah: D("136125"), stok: { kod: "SF0101", ad: "SİL FIX" } }]) },
      kasaBankaHareket: { findMany: vi.fn().mockResolvedValue([{ id: "k1", kasa: null, bankaHesap: { ad: "Garanti TL", bankaAdi: "Garanti BBVA" }, posHesap: null, fatura: null }]) },
      cekSenet: { findMany: vi.fn().mockResolvedValue([{ id: "c1", tur: "cek", portfoyNo: "P-1", cekNo: "1234567", banka: "Akbank", vadeTarihi: new Date("2026-12-01T00:00:00Z") }]) },
      krediKartiHareket: { findMany: vi.fn().mockResolvedValue([]) },
      posTahsilat: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  it("fatura, banka ve çek hareketlerine tür, belge no ve ödeme şekli yazar", async () => {
    const t = tx();
    const sonuc = await ekstreAyrintilari(t as never, "t1", [
      hareket({}),
      hareket({ id: "h2", tip: "alacak", kaynakTur: "kasa_banka", kaynakRef: "k1" }),
      hareket({ id: "h3", tip: "alacak", kaynakTur: "cek_senet", kaynakRef: "c1" }),
      hareket({ id: "h4", kaynakTur: "manuel", kaynakRef: null }),
    ], false);
    expect(sonuc.get("h1")).toMatchObject({ hareketTuru: "Satış", belgeNo: "M012026000000206", odemeSekli: null });
    expect(sonuc.get("h1")?.fatura).toBeUndefined();
    expect(sonuc.get("h2")).toMatchObject({ hareketTuru: "Tahsilat", odemeSekli: "Banka · Garanti BBVA (Garanti TL)" });
    expect(sonuc.get("h3")).toMatchObject({ hareketTuru: "Çek/senet alındı", belgeNo: "1234567", odemeSekli: "Çek · Akbank · vade 01.12.2026" });
    expect(sonuc.get("h4")).toMatchObject({ hareketTuru: "Manuel kayıt", belgeNo: null });
    // Standart ekstrede kalemler hiç okunmaz.
    expect(t.faturaSatir.findMany).not.toHaveBeenCalled();
  });

  it("ayrıntılı ekstrede fatura kalemlerini, kurunu ve toplamlarını ekler", async () => {
    const sonuc = await ekstreAyrintilari(tx() as never, "t1", [hareket({})], true);
    expect(sonuc.get("h1")?.fatura).toMatchObject({
      dovizCinsi: "USD", kur: "40.6672", toplamKdv: "20.00", genelToplam: "120.00",
      kalemler: [{ stokKod: "SF0101", miktar: "9000", birimFiyat: "15.125", tutar: "136125.00" }],
    });
  });
});

describe("döviz ekstresi çevirme modu (CARI-26)", () => {
  it("aynı dövizdeki hareketi kendi tutarıyla, diğerini günün kuruyla çevirir", () => {
    const kur = () => D("40");
    expect(hedefDovizTutari({ tutar: D(150), dovizCinsi: "USD", tutarTry: D(6100), tarih: new Date() }, "USD", kur)).toEqual({ tutar: D(150), kur: null });
    const tl = hedefDovizTutari({ tutar: D(4000), dovizCinsi: "TRY", tutarTry: D(4000), tarih: new Date() }, "USD", kur);
    expect(tl.tutar.toFixed(2)).toBe("100.00");
    expect(tl.kur?.toString()).toBe("40");
  });

  it("kuru olmayan günde en fazla 10 gün geriye bakar, elle kur TCMB'nin önüne geçer, yoksa hata verir", async () => {
    const tx = {
      elleKur: { findMany: vi.fn().mockResolvedValue([{ tarih: new Date("2026-09-08T00:00:00Z"), dovizSatis: D("41") }]) },
      tcmbKuru: { findMany: vi.fn().mockResolvedValue([{ tarih: new Date("2026-09-08T00:00:00Z"), dovizSatis: D("40") }, { tarih: new Date("2026-08-01T00:00:00Z"), dovizSatis: D("39") }]) },
    };
    const kur = await kurCozucu(tx as never, "t1", "USD", new Date("2026-08-01T00:00:00Z"), new Date("2026-09-12T00:00:00Z"));
    expect(kur(new Date("2026-09-12T00:00:00Z")).toString()).toBe("41");
    expect(() => kur(new Date("2026-08-20T00:00:00Z"))).toThrow(/kur bulunamadı/);
  });
});

describe("ekstre PDF görünümü (CARI-24/25/26)", () => {
  const veri = (ek: Partial<EkstreVerisi> = {}) => ({
    cari: { id: "c1", kod: "CARI-1", unvan: "KARSEL BOYA", eposta: null, vknTckn: "1234567890", vergiDairesi: "Kadıköy", adres: "Moda Cd. Kadıköy / İstanbul" },
    tur: "ayrintili", baslangic: "2025-10-01", bitis: "2026-09-29",
    devirBakiyesi: "372500.00", donemBorc: "136125.00", donemAlacak: "0.00", donemSonuBakiyesi: "508625.00",
    dovizOzet: [{ dovizCinsi: "TRY", devir: "372500.00", borc: "136125.00", alacak: "0.00", bakiye: "508625.00" }],
    satirlar: [{
      id: "h1", tarih: "2025-10-27", vadeTarihi: "2025-10-27", tip: "borc", hareketTuru: "Satış", belgeNo: "M012025000000206", odemeSekli: null,
      fatura: { dovizCinsi: "USD", kur: "40.6672", kalemler: [{ stokKod: "SF0101", stokAd: "SİL FIX", miktar: "9000", birim: "adet", birimFiyat: "15.125", iskontoOrani: "0.00", tutar: "136125.00" }], toplamMatrah: "136125.00", toplamKdv: "0.00", genelToplam: "136125.00" },
      aciklama: "M012025000000206 nolu fatura hareketi", kaynakTur: "fatura", iptal: false, makbuzYolu: null, odemeYontemi: null,
      dovizCinsi: "TRY", tutar: "136125.00", kur: "1.0000", tutarTry: "136125.00", yuruyenBakiye: "508625.00",
    }],
    ...ek,
  }) as unknown as EkstreVerisi;
  const firma = { unvan: "KA GRUP KİMYASAL", vkn: "1234567801", vergiDairesi: "Zeytinburnu" };

  it("ayrıntılı ekstrede kalemleri, kuru ve B/A yönlü bakiyeyi basar; mutabakat isteğe bağlı", () => {
    const { html, yatay } = ekstrePdfHtml(veri(), firma, { mutabakat: true });
    expect(yatay).toBe(true);
    expect(html).toContain("Ayrıntılı ekstre");
    expect(html).toContain("SF0101 · SİL FIX");
    expect(html).toContain("15,125");
    expect(html).toContain("1 USD = 40,6672 TL");
    expect(html).toContain("508.625,00 <span class=\"yon yon-B\">B</span>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tfoot>");
    expect(html).toContain("29.09.2026 tarihi itibarıyla");
    expect(ekstrePdfHtml(veri(), firma).html).not.toContain("Mutabakat");
  });

  it("döviz ekstresini yatay ve döviz başına bölümle basar", () => {
    const { html, yatay } = ekstrePdfHtml(veri({
      tur: "doviz",
      dovizBolumleri: [{ dovizCinsi: "USD", devir: "0.00", borc: "150.00", alacak: "0.00", bakiye: "150.00", satirlar: [] }],
    } as never), firma);
    expect(yatay).toBe(true);
    expect(html).toContain("USD hesabı");
    expect(html).toContain("Bakiye (USD)");
  });
});
