import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { EkstreEslestirmeService } from "./ekstre-eslestirme.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));
vi.mock("../doviz/kur-coz", () => ({ kurZorunlu: vi.fn(async () => new Prisma.Decimal("30")) }));

const D = (d: string) => new Prisma.Decimal(d);
const satir = (ek: Record<string, unknown> = {}) => ({
  id: "s1", bankaHesapId: "b1", tarih: new Date("2026-10-01"), tutar: D("1000"), aciklama: "EFT ANADOLU KIMYA", dekontNo: "D1",
  karsiIban: null, karsiUnvan: null, durum: "beklemede", eslesmeTuru: null, bankaHesap: { ad: "Ziraat", dovizCinsi: "TRY" }, _count: { hareketler: 0 }, ...ek,
});

function hazirla(baslangic = satir(), sahiplenilen = 1) {
  let sayac = 0;
  const tx = {
    bankaEkstreSatir: {
      findUnique: vi.fn().mockResolvedValue(baslangic),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "s1" }),
      updateMany: vi.fn().mockResolvedValue({ count: sahiplenilen }),
      update: vi.fn().mockResolvedValue({ id: "s1" }),
    },
    kasaBankaHareket: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(async ({ data }) => ({ id: `h${++sayac}`, ...data })),
    },
    masrafKategori: { findFirst: vi.fn().mockResolvedValue({ id: "mk1", ad: "Banka masrafları" }) },
    masraf: { create: vi.fn(), deleteMany: vi.fn() },
    masrafOdeme: { deleteMany: vi.fn() },
    gelirKaydi: { deleteMany: vi.fn() },
    cariHareket: { deleteMany: vi.fn() },
    ekstreKurali: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const kasaBanka = {
    hareketOlustur: vi.fn(async (_tx: unknown, _t: string, g: { tutar: string; faturaId: string | null }) => ({ id: `fis-${g.faturaId ?? "avans"}`, tutar: g.tutar })),
    virmanKurallariniDenetle: vi.fn().mockResolvedValue("TRY"),
    virmanOlustur: vi.fn().mockResolvedValue({ gidis: { id: "gidis" }, gelis: { id: "gelis" } }),
  };
  const donemKilidi = { tarihDogrula: vi.fn() };
  const service = new EkstreEslestirmeService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, kasaBanka as any, {} as any, donemKilidi as any);
  return { tx, kasaBanka, donemKilidi, service };
}

describe("EkstreEslestirmeService (KSB-06)", () => {
  it("cariye birden çok faturaya dağıtır, artanı avans fişi yapar ve hepsini satıra bağlar", async () => {
    const { tx, kasaBanka, service } = hazirla();

    await service.eslestir("s1", { tur: "cari", cariId: "c1", dagitim: [{ faturaId: "f1", tutar: "600" }, { faturaId: "f2", tutar: "300" }] });

    expect(kasaBanka.hareketOlustur.mock.calls.map((c) => [c[2].faturaId, c[2].tutar])).toEqual([["f1", "600.00"], ["f2", "300.00"], [null, "100.00"]]);
    expect(tx.kasaBankaHareket.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["fis-f1", "fis-f2", "fis-avans"] } }, data: { ekstreSatirId: "s1" } });
  });

  it("tamamı faturaya dağıtılınca sıfır tutarlı avans fişi üretmez", async () => {
    const { kasaBanka, service } = hazirla();

    await service.eslestir("s1", { tur: "cari", cariId: "c1", dagitim: [{ faturaId: "f1", tutar: "1000.00" }] });

    expect(kasaBanka.hareketOlustur).toHaveBeenCalledTimes(1);
  });

  it("dağıtım ekstre tutarını aşarsa reddeder", async () => {
    const { service } = hazirla();
    await expect(service.eslestir("s1", { tur: "cari", cariId: "c1", dagitim: [{ faturaId: "f1", tutar: "1200" }] })).rejects.toThrow("aşamaz");
  });

  it("satırı başka işlem sahiplendiyse kayıt üretmez", async () => {
    const { kasaBanka, service } = hazirla(satir(), 0);
    await expect(service.eslestir("s1", { tur: "cari", cariId: "c1", dagitim: [] })).rejects.toBeInstanceOf(ConflictException);
    expect(kasaBanka.hareketOlustur).not.toHaveBeenCalled();
  });

  it("çıkışı KDV'siz masraf kaydı ve tediye olarak işler, istenirse kural kaydeder", async () => {
    const { tx, service } = hazirla(satir({ tutar: D("-12.50"), aciklama: "EFT UCRETI" }));

    await service.eslestir("s1", { tur: "masraf", kategoriId: "mk1", kdvOrani: "0", kural: { anahtar: "eft ücreti", tumHesaplar: true } });

    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "tediye", tutar: D("12.50"), kaynakTur: "masraf" });
    expect(tx.masraf.create.mock.calls[0][0].data).toMatchObject({ kategoriId: "mk1", matrah: D("12.50"), kdvTutari: D("0"), toplam: D("12.50"), odemeDurumu: "odendi", hareketId: "h1" });
    expect(tx.ekstreKurali.create.mock.calls[0][0].data).toMatchObject({ bankaHesapId: null, anahtar: "eft ucreti", yon: "cikis", eslesmeTuru: "masraf", masrafKategoriId: "mk1" });
  });

  it("girişi masraf olarak işlemez", async () => {
    const { service } = hazirla();
    await expect(service.eslestir("s1", { tur: "masraf", kategoriId: "mk1", kdvOrani: "0" })).rejects.toThrow("para çıkışı");
  });

  it("virmanda yalnız bu hesabın bacağını satıra bağlar", async () => {
    const { tx, kasaBanka, service } = hazirla(satir({ tutar: D("-5000") }));

    await service.eslestir("s1", { tur: "virman", karsiKasaId: "k1" });

    expect(kasaBanka.virmanKurallariniDenetle.mock.calls[0][0]).toMatchObject({ kaynakBankaHesapId: "b1", hedefKasaId: "k1", tutar: "5000.00" });
    expect(tx.kasaBankaHareket.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["gidis"] } }, data: { ekstreSatirId: "s1" } });
  });

  it("mevcut fişlerin toplamı satırı tutmazsa bağlamaz", async () => {
    const { tx, service } = hazirla();
    tx.kasaBankaHareket.findMany.mockResolvedValueOnce([{ id: "m1", bankaHesapId: "b1", ekstreSatirId: null, kaynakTur: "manuel", tip: "tahsilat", tutar: D("900") }]);
    await expect(service.eslestir("s1", { tur: "mevcut_fis", hareketIdleri: ["m1"] })).rejects.toThrow("eşit olmalı");
  });

  it("mevcut fiş eşleşmesini geri alınca fişi silmez, yalnız bağı çözer", async () => {
    const { tx, service } = hazirla(satir({ durum: "eslesti", eslesmeTuru: "mevcut_fis", _count: { hareketler: 1 } }));
    tx.kasaBankaHareket.findMany.mockResolvedValueOnce([{ id: "m1", kaynakTur: "manuel", krediKartiOdemesi: null }]);

    await service.geriAl("s1");

    expect(tx.kasaBankaHareket.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["m1"] } }, data: { ekstreSatirId: null } });
    expect(tx.kasaBankaHareket.deleteMany).not.toHaveBeenCalled();
  });

  it("masraf eşleşmesini geri alınca masrafı ve fişi siler", async () => {
    const { tx, service } = hazirla(satir({ durum: "eslesti", eslesmeTuru: "masraf", tutar: D("-12.50"), _count: { hareketler: 1 } }));
    tx.kasaBankaHareket.findMany.mockResolvedValueOnce([{ id: "h1", kaynakTur: "masraf", krediKartiOdemesi: null }]);

    await service.geriAl("s1");

    expect(tx.masraf.deleteMany).toHaveBeenCalledWith({ where: { hareketId: { in: ["h1"] } } });
    expect(tx.kasaBankaHareket.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["h1"] } } });
    expect(tx.bankaEkstreSatir.update.mock.calls.at(-1)[0].data).toMatchObject({ durum: "beklemede", eslesmeTuru: null });
  });
});
