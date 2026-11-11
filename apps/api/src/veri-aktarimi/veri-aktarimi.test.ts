import * as ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { tabloOku } from "./tablo";
import { STOK_SUTUNLARI, stokPlanla } from "./adim-stok";
import { acilisStokPlanla } from "./adim-acilis-stok";
import { kasaBankaPlanla } from "./adim-kasa-banka";
import { acikFaturaPlanla } from "./adim-acik-fatura";
import { CARI_SUTUNLARI } from "../cari/cari-ice-aktarma";

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
async function xlsx(basliklar: string[], ...satirlar: (string | number)[][]): Promise<Buffer> {
  const k = new ExcelJS.Workbook();
  const s = k.addWorksheet("x");
  s.addRow(basliklar);
  for (const r of satirlar) s.addRow(r);
  return Buffer.from(await k.xlsx.writeBuffer());
}
const satir = <T extends string>(no: number, hucreler: Partial<Record<T, string>>) => ({ satir: no, hucreler });
const yok = async () => null;

describe("tablo okuyucu (VAK-03)", () => {
  it("kaynak program başlıklarını tanır, tanınmayanı listeler, elle eşleme ve yok sayma uygular", async () => {
    const b = await xlsx(["Malzeme Kodu", "Malzeme Açıklaması", "Ölçü Birimi", "Raf Yeri", "Özel Kod"], ["M-1", "Vida", "adet", "A1", "X"]);
    const t = await tabloOku(b, STOK_SUTUNLARI);
    expect(t.satirlar[0].hucreler).toEqual({ kod: "M-1", ad: "Vida", birim: "adet" });
    expect(t.taninmayanlar).toEqual(["Raf Yeri", "Özel Kod"]);
    const e = await tabloOku(b, STOK_SUTUNLARI, { "Raf Yeri": "", "özel kod": "barkod" });
    expect(e.taninmayanlar).toEqual([]);
    expect(e.satirlar[0].hucreler.barkod).toBe("X");
  });

  it("Logo/Mikro cari başlıklarını tanır; aynı alana ikinci sütun düşmez", async () => {
    const b = await xlsx(["Cari Hesap Kodu", "Cari Hesap Ünvanı", "Vergi No", "Vergi Numarası"], ["C1", "Örnek A.Ş.", "1234567890", "999"]);
    const t = await tabloOku(b, CARI_SUTUNLARI);
    expect(t.satirlar[0].hucreler).toEqual({ kod: "C1", unvan: "Örnek A.Ş.", vknTckn: "1234567890" });
    expect(t.taninmayanlar).toEqual(["Vergi Numarası"]);
  });
});

describe("stok kartları adımı", () => {
  const tx = (kartlar: unknown[]) => ({ stokKart: { findMany: vi.fn().mockResolvedValue(kartlar) } }) as never;
  it("yeni kart varsayılanları; hareketli kartın birimi değişmez; yalnız farklı alanlar güncellenir", async () => {
    const mevcut = { id: "s1", kod: "A", ad: "Eski", tip: "urun", barkod: null, anaBirim: "adet", kdvOrani: D(20), alisFiyati: null, satisFiyati: D(10), _count: { hareketler: 3 } };
    const p = await stokPlanla(tx([mevcut]), [satir(2, { kod: "A", ad: "Yeni ad", birim: "kg", satisFiyati: "10" }), satir(3, { kod: "B", ad: "Yeni" }), satir(4, { kod: "A" }), satir(5, { kod: "C" })], yok);
    expect(p[0].durum).toBe("hatali");
    expect(p[0].hatalar.join()).toContain("birimi değiştirilemez");
    expect(p[1]).toMatchObject({ durum: "yeni", veri: { tip: "urun", anaBirim: "adet", kdvOrani: 20 } });
    expect(p[2].hatalar.join()).toContain("2. satırda");
    expect(p[3].hatalar.join()).toContain("stok adı zorunludur");
    const g = await stokPlanla(tx([mevcut]), [satir(2, { kod: "A", ad: "Yeni ad", satisFiyati: "10" })], yok);
    expect(g[0]).toMatchObject({ durum: "guncelle", veri: { kod: "A", ad: "Yeni ad" } });
    expect(g[0].veri.satisFiyati).toBeUndefined();
  });
});

describe("açılış stoğu adımı (VAK-04)", () => {
  const kart = (ek: object = {}) => ({ id: "s1", kod: "A", ad: "Ürün", tip: "urun", anaBirim: "adet", takipTipi: "yok", varyantlar: [], ...ek });
  const tx = (k: unknown[], ilk: unknown[] = [], acilis: unknown[] = []) => ({
    stokKart: { findMany: vi.fn().mockResolvedValue(k) },
    depo: { findMany: vi.fn().mockResolvedValue([{ id: "d1", kod: "MRK", varsayilan: true }]) },
    stokHareket: { groupBy: vi.fn().mockResolvedValue(ilk), findMany: vi.fn().mockResolvedValue(acilis) },
  }) as never;

  it("varsayılan depo ve geçiş tarihiyle hareket hazırlar", async () => {
    const p = await acilisStokPlanla(tx([kart()]), [satir(2, { stokKodu: "A", miktar: "5", birimMaliyet: "12,5" })], "2026-10-31", yok);
    expect(p[0]).toMatchObject({ durum: "yeni", hareket: { depoId: "d1", tarih: "2026-10-31" } });
    expect(p[0].hareket!.birimMaliyet.toString()).toBe("12.5");
  });

  it("varyant, seri, önceki hareket ve mevcut açılış kurallarını uygular", async () => {
    const t = tx(
      [kart({ varyantlar: [{ id: "v1", kod: "KIR" }] }), kart({ id: "s2", kod: "S", takipTipi: "seri" }), kart({ id: "s3", kod: "E" }), kart({ id: "s4", kod: "M" })],
      [{ stokId: "s3", _min: { tarih: new Date("2026-10-01") } }],
      [{ stokId: "s4", varyantId: null, depoId: "d1" }],
    );
    const p = await acilisStokPlanla(t, [
      satir(2, { stokKodu: "A", miktar: "1", birimMaliyet: "1" }),
      satir(3, { stokKodu: "S", miktar: "2", birimMaliyet: "1" }),
      satir(4, { stokKodu: "E", miktar: "1", birimMaliyet: "1" }),
      satir(5, { stokKodu: "M", miktar: "1", birimMaliyet: "1" }),
    ], "2026-10-31", yok);
    expect(p[0].hatalar.join()).toContain("Varyant kodu zorunludur");
    expect(p[1].hatalar.join()).toMatch(/Seri no zorunludur.*1 adet/);
    expect(p[2].hatalar.join()).toContain("açılış ondan sonra olamaz");
    expect(p[3].hatalar.join()).toContain("zaten var");
  });
});

describe("kasa/banka açılışları adımı (VAK-05)", () => {
  const tx = (acilislar: unknown[] = []) => ({
    kasa: { findMany: vi.fn().mockResolvedValue([{ id: "k1", ad: "Merkez Kasa", dovizCinsi: "TRY" }]) },
    bankaHesap: { findMany: vi.fn().mockResolvedValue([{ id: "b1", ad: "Ziraat", iban: "TR33 0001 0000 0000 0000 0000 01", hesapNo: "123", dovizCinsi: "USD" }]) },
    kasaBankaHareket: { findMany: vi.fn().mockResolvedValue(acilislar), groupBy: vi.fn().mockResolvedValue([]) },
  }) as never;

  it("IBAN ya da adla eşler; eksi bakiye ve dövizde kur denetimi", async () => {
    const p = await kasaBankaPlanla(tx(), [
      satir(2, { hesap: "merkez kasa", tutar: "-150" }),
      satir(3, { hesap: "TR330001000000000000000001", tutar: "1000" }),
    ], "2026-10-31", yok, async () => false);
    expect(p[0].acilis).toMatchObject({ tur: "kasa", hesapId: "k1", tutar: "-150.00" });
    expect(p[1].hatalar.join()).toContain("TCMB kuru bulunamadı");
  });

  it("açılışı olan hesabı sihirbazdan değiştirmez", async () => {
    const p = await kasaBankaPlanla(tx([{ kasaId: "k1", bankaHesapId: null }]), [satir(2, { hesap: "Merkez Kasa", tutar: "10" })], "2026-10-31", yok, async () => true);
    expect(p[0].hatalar.join()).toContain("açılış fişi zaten var");
  });
});

describe("açık faturalar adımı (VAK-06)", () => {
  const tx = (acilislar: unknown[] = []) => ({
    cariHesap: { findMany: vi.fn().mockResolvedValue([{ id: "c1", kod: "M1", unvan: "Müşteri", vknTckn: "1234567890", dovizCinsi: "TRY" }, { id: "c2", kod: "M2", unvan: "Toplamlı", vknTckn: null, dovizCinsi: "TRY" }]) },
    cariHareket: { findMany: vi.fn().mockResolvedValue(acilislar) },
  }) as never;
  const kur = async () => D("41.5");

  it("Borç = cari bize borçlu; VKN ile eşler; dövizde kur bulur", async () => {
    const p = await acikFaturaPlanla(tx(), [
      satir(2, { cari: "1234567890", yon: "Borç", belgeNo: "F1", belgeTarihi: "15.10.2026", vade: "14.11.2026", tutar: "1180" }),
      satir(3, { cari: "M1", yon: "Alacak", belgeNo: "F2", belgeTarihi: "2026-10-20", tutar: "100", doviz: "USD" }),
    ], "2026-10-31", kur);
    expect(p[0].hareket).toMatchObject({ cariId: "c1", tip: "borc", vade: "2026-11-14", aciklama: "Açık fatura F1 (2026-10-15)" });
    expect(p[1].hareket).toMatchObject({ tip: "alacak", dovizCinsi: "USD", vade: "2026-10-20" });
    expect(p[1].hareket!.kur.toString()).toBe("41.5");
  });

  it("toplam açılışlı cari, daha önce aktarılmış belge, geçişten sonraki belge reddedilir", async () => {
    const t = tx([{ cariId: "c2", aciklama: "Açılış bakiyesi (Excel)" }, { cariId: "c1", aciklama: "Açık fatura F1 (2026-10-15)" }]);
    const p = await acikFaturaPlanla(t, [
      satir(2, { cari: "M2", yon: "Borç", belgeNo: "X", belgeTarihi: "01.10.2026", tutar: "1" }),
      satir(3, { cari: "M1", yon: "Borç", belgeNo: "F1", belgeTarihi: "15.10.2026", tutar: "1" }),
      satir(4, { cari: "M1", yon: "Borç", belgeNo: "F9", belgeTarihi: "05.11.2026", tutar: "1" }),
    ], "2026-10-31", kur);
    expect(p[0].hatalar.join()).toContain("toplam açılış bakiyesi var");
    expect(p[1].hatalar.join()).toContain("daha önce aktarılmış");
    expect(p[2].hatalar.join()).toContain("geçiş tarihinden");
  });
});

describe("paket kotası (VAK-09)", () => {
  it("kotayı aşan yeni kart satırları hatalı işaretlenir; güncellemeler etkilenmez; kota okunamazsa dokunulmaz", async () => {
    const { VeriAktarimiService } = await import("./veri-aktarimi.service");
    const kur = (kalanLimit: () => Promise<unknown>) => new VeriAktarimiService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, { kalanLimit } as never) as unknown as {
      kalanKota(a: string): Promise<{ kalan: number; limit: number; planAdi: string } | null>;
      kotayiUygula<T>(s: T[], k: unknown, ad: string): T[];
    };
    const satirlar = () => [
      { satir: 2, durum: "yeni", etiket: "A", aciklama: "", hatalar: [] as string[], uyarilar: [] },
      { satir: 3, durum: "guncelle", etiket: "B", aciklama: "", hatalar: [] as string[], uyarilar: [] },
      { satir: 4, durum: "yeni", etiket: "C", aciklama: "", hatalar: [] as string[], uyarilar: [] },
    ];
    const s = kur(async () => ({ kalan: 1, limit: 100, planAdi: "Başlangıç" }));
    const sonuc = s.kotayiUygula(satirlar(), await s.kalanKota("stok"), "stok kartı");
    expect(sonuc.map((x) => x.durum)).toEqual(["yeni", "guncelle", "hatali"]);
    expect(sonuc[2].hatalar[0]).toContain("en çok 100 stok kartı");
    const sinirsiz = kur(async () => ({ kalan: null, limit: null, planAdi: "Kurumsal" }));
    expect(await sinirsiz.kalanKota("stok")).toBeNull();
    const askida = kur(async () => { throw new Error("Abonelik askıya alınmış"); });
    expect(askida.kotayiUygula(satirlar(), await askida.kalanKota("cari"), "cari kart").map((x) => x.durum)).toEqual(["yeni", "guncelle", "yeni"]);
  });
});
