import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { HATA_YERLESME_MS } from "../ebelge/yerlesmis-hata";
import { DuzeltmelerService } from "./duzeltmeler.service";

const tutarlilik = vi.hoisted(() => vi.fn());
vi.mock("../stok/stok-tutarlilik.service", () => ({ stokTutarlilikHesapla: tutarlilik }));

describe("DuzeltmelerService", () => {
  const tx = {
    bankaEkstreSatir: { findMany: vi.fn() },
    masraf: { findMany: vi.fn() },
    krediKartiHareket: { findMany: vi.fn() },
    posTahsilat: { findMany: vi.fn() },
    ebelgeKayit: { findMany: vi.fn() },
    stokDepoBakiye: { findMany: vi.fn() },
    sayim: { findMany: vi.fn() },
    cekSenet: { findMany: vi.fn() },
    fatura: { findMany: vi.fn() },
    faturaKapama: { findMany: vi.fn().mockResolvedValue([]) },
    duzeltmeKaydi: { upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    duzeltmeOlayi: { create: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn(async (_tenantId: string, is: (istemci: typeof tx) => unknown) => is(tx)) };
  let service: DuzeltmelerService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.bankaEkstreSatir.findMany.mockResolvedValue([]);
    tx.masraf.findMany.mockResolvedValue([]);
    tx.krediKartiHareket.findMany.mockResolvedValue([]);
    tx.posTahsilat.findMany.mockResolvedValue([]);
    tx.ebelgeKayit.findMany.mockResolvedValue([]);
    tx.stokDepoBakiye.findMany.mockResolvedValue([]);
    tx.sayim.findMany.mockResolvedValue([]);
    tx.cekSenet.findMany.mockResolvedValue([]);
    tx.fatura.findMany.mockResolvedValue([]);
    tx.duzeltmeKaydi.findMany.mockResolvedValue([]);
    tx.duzeltmeKaydi.upsert.mockResolvedValue({});
    tutarlilik.mockResolvedValue({ farklar: [], dagitilmamis: [], kartSayisi: 0 });
    service = new DuzeltmelerService(prisma as never, { getir: vi.fn().mockResolvedValue({ miktarToleransYuzde: 1, fiyatToleransYuzde: 1 }) } as never);
  });

  it("aynı kaynak için deterministik tekillik anahtarıyla upsert yapar", async () => {
    tx.bankaEkstreSatir.findMany.mockResolvedValue([{ id: "satir-1", aciklama: "Havale", tutar: { toString: () => "1250" } }]);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.tara(),
    );

    expect(sonuc).toMatchObject({ taranan: 1, bulunan: 1, otomatikCozulen: 0 });
    expect(tx.duzeltmeKaydi.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_tekillikAnahtari: { tenantId: "tenant-1", tekillikAnahtari: "ESLESMEMIS_EKSTRE:banka_ekstre_satiri:satir-1" } },
    }));
  });

  it("taze e-Belge hatasını değil, yalnız yerleşmiş hatayı sorgular (EBLG-46)", async () => {
    await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara());

    const kosul = tx.ebelgeKayit.findMany.mock.calls[0][0].where.OR[0];
    expect(kosul.durum).toBe("hata");
    expect(Date.now() - kosul.updatedAt.lte.getTime()).toBeGreaterThanOrEqual(HATA_YERLESME_MS);
  });

  it("kaynakta artık bulunmayan açık kaydı otomatik çözer", async () => {
    tx.duzeltmeKaydi.findMany.mockResolvedValue([{ id: "duzeltme-1", tekillikAnahtari: "ESLESMEMIS_EKSTRE:banka_ekstre_satiri:satir-1", durum: "acik" }]);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.tara(),
    );

    expect(sonuc.otomatikCozulen).toBe(1);
    expect(tx.duzeltmeKaydi.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "duzeltme-1" }, data: expect.objectContaining({ durum: "cozuldu", tekillikAnahtari: null }) }));
    expect(tx.duzeltmeOlayi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ olayTuru: "otomatik_cozum" }) }));
  });

  it("fark içeren taslak sayımı onaysız sayım bulgusu olarak açar", async () => {
    tx.sayim.findMany.mockResolvedValue([{ id: "sayim-1", tarih: new Date(), aciklama: null, depo: { ad: "Merkez" }, kalemler: [{ sistemMiktar: new Prisma.Decimal(10), fiiliMiktar: new Prisma.Decimal(8) }] }]);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.tara(),
    );

    expect(sonuc).toMatchObject({ taranan: 1, bulunan: 1 });
    expect(tx.duzeltmeKaydi.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_tekillikAnahtari: { tenantId: "tenant-1", tekillikAnahtari: "SAYIM_FARKI_ONAYSIZ:stok_sayim:sayim-1" } },
    }));
  });

  it("bakiye–hareket farkını kart başına tek kritik kayıt, varyantsız hareketi uyarı olarak açar (STK-39)", async () => {
    tutarlilik.mockResolvedValue({
      farklar: [
        { tur: "kart", stokId: "stok-1", kod: "HM-001", ad: "Hammadde", fark: "100.000" },
        { tur: "depo", stokId: "stok-1", kod: "HM-001", ad: "Hammadde", fark: "100.000" },
      ],
      dagitilmamis: [{ stokId: "stok-2", kod: "SF0101", ad: "Gömlek", miktar: "-500.000" }],
      kartSayisi: 2,
    });

    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara());

    expect(sonuc).toMatchObject({ bulunan: 2 });
    expect(tx.duzeltmeKaydi.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_tekillikAnahtari: { tenantId: "tenant-1", tekillikAnahtari: "STOK_BAKIYE_FARKI:stok_tutarlilik:stok-1" } },
      create: expect.objectContaining({ onem: "kritik", aciklama: expect.stringContaining("kart toplamı (+100), depo bakiyesi") }),
    }));
    expect(tx.duzeltmeKaydi.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_tekillikAnahtari: { tenantId: "tenant-1", tekillikAnahtari: "VARYANTSIZ_HAREKET:stok_tutarlilik:stok-2" } },
      create: expect.objectContaining({ onem: "uyari" }),
    }));
  });

  it("atama seçeneklerini aktif yönetici ve muhasebe kullanıcılarıyla sınırlar", async () => {
    tx.user.findMany.mockResolvedValue([{ id: "user-1", adSoyad: "Ayşe Yönetici", eposta: "ayse@example.com" }]);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.secenekler(),
    );

    expect(sonuc).toHaveLength(1);
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { aktif: true, rol: { in: ["yonetici", "muhasebe"] } },
    }));
  });

  it("salt okunur listesinde rolün erişemediği masraf ve e-belge kaynaklarını dışlar", async () => {
    tx.duzeltmeKaydi.count.mockResolvedValue(0); tx.duzeltmeKaydi.findMany.mockResolvedValue([]);

    await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "salt_okunur" },
      () => service.listele({ sayfa: 1, limit: 25 }),
    );

    expect(tx.duzeltmeKaydi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tur: { in: ["banka_ekstre", "kredi_karti", "pos", "stok", "cek_senet", "fatura_cari"] } },
    }));
  });

  it("kritik türleri toplu yoksaymaya izin vermez", async () => {
    tx.duzeltmeKaydi.findMany.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", tur: "stok", durum: "acik" }]);

    await expect(baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.topluYoksay(["11111111-1111-4111-8111-111111111111"], "Kontrol edildi"),
    )).rejects.toThrow("yalnız banka ekstresi");
    expect(tx.duzeltmeKaydi.updateMany).not.toHaveBeenCalled();
  });

  it("banka ekstresi bulgularını gerekçesiyle toplu yoksayar ve olay geçmişi yazar", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    tx.duzeltmeKaydi.findMany.mockResolvedValue([{ id, tur: "banka_ekstre", durum: "incelemede" }]);
    tx.duzeltmeKaydi.updateMany.mockResolvedValue({ count: 1 }); tx.duzeltmeOlayi.createMany.mockResolvedValue({ count: 1 });

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.topluYoksay([id], "Mükerrer hareket doğrulandı"),
    );

    expect(sonuc).toEqual({ guncellenen: 1 });
    expect(tx.duzeltmeKaydi.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "yoksayildi", tekillikAnahtari: null }) }));
    expect(tx.duzeltmeOlayi.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ olayTuru: "toplu_yoksayma", aciklama: "Mükerrer hareket doğrulandı" })] }));
  });

  it("kapanmış kaydın durumunu yeniden açmaz", async () => {
    tx.duzeltmeKaydi.findUnique.mockResolvedValue({ id: "duzeltme-1", durum: "cozuldu" });

    await expect(baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.durumDegistir("duzeltme-1", "incelemede"),
    )).rejects.toThrow("Kapanmış düzeltme kaydının durumu değiştirilemez");
    expect(tx.duzeltmeKaydi.update).not.toHaveBeenCalled();
  });
});
