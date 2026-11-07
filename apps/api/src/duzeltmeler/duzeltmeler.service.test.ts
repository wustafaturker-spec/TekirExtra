import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { HATA_YERLESME_MS } from "../ebelge/yerlesmis-hata";
import { DuzeltmelerService, OKUMA_ESZAMANLI, sinirlayici, TARAMA_SINIRI } from "./duzeltmeler.service";

const tutarlilik = vi.hoisted(() => vi.fn());
const degisenKartlar = vi.hoisted(() => vi.fn());
vi.mock("../stok/stok-tutarlilik.service", () => ({ stokTutarlilikHesapla: tutarlilik, degisenStokKartlari: degisenKartlar }));

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
    tx.duzeltmeKaydi.updateMany.mockResolvedValue({ count: 1 });
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
    expect(tx.duzeltmeKaydi.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "duzeltme-1", durum: "acik", tekillikAnahtari: "ESLESMEMIS_EKSTRE:banka_ekstre_satiri:satir-1" }, data: expect.objectContaining({ durum: "cozuldu", tekillikAnahtari: null }) }));
    expect(tx.duzeltmeOlayi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ olayTuru: "otomatik_cozum" }) }));
  });

  it("BLD-13: sınıra ulaşan kaynağın kayıtları o turda otomatik çözülmez, diğer kaynaklarınki çözülür", async () => {
    const satirlar = Array.from({ length: TARAMA_SINIRI }, (_, i) => ({ id: `satir-${i}`, aciklama: "Havale", tutar: { toString: () => "1" } }));
    tx.bankaEkstreSatir.findMany.mockResolvedValue(satirlar);
    tx.duzeltmeKaydi.findMany.mockResolvedValue([
      { id: "gorulmeyen-ekstre", tekillikAnahtari: "ESLESMEMIS_EKSTRE:banka_ekstre_satiri:satir-9999", durum: "acik", nedenKodu: "ESLESMEMIS_EKSTRE" },
      { id: "biten-masraf", tekillikAnahtari: "ODEME_BAGLANTISI_YOK:masraf:m1", durum: "acik", nedenKodu: "ODEME_BAGLANTISI_YOK" },
    ]);

    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara());

    expect(sonuc.kesikKaynaklar).toEqual(["banka_ekstre"]);
    expect(sonuc.otomatikCozulen).toBe(1);
    expect(tx.duzeltmeKaydi.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.duzeltmeKaydi.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "biten-masraf" }) }));
    expect(tx.bankaEkstreSatir.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: TARAMA_SINIRI }));
  });

  it("BLD-15: stok değişim anı verilmezse tam, verilirse değişen + açık kayıtlı kartlarla artımlı denetler", async () => {
    await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara());
    expect(tutarlilik).toHaveBeenLastCalledWith(tx, undefined);

    const sonra = new Date("2026-11-07T08:00:00Z");
    degisenKartlar.mockResolvedValue(["kart-1", "kart-2"]);
    tx.duzeltmeKaydi.findMany.mockImplementation(async (a: { where: { nedenKodu?: { in?: string[] } } }) =>
      a.where.nedenKodu?.in?.length === 2 ? [{ kaynakRef: "kart-2" }, { kaynakRef: "kart-acik" }] : []);
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara({ stokDegisimSonrasi: sonra }));
    expect(degisenKartlar).toHaveBeenCalledWith(tx, sonra);
    expect(tutarlilik).toHaveBeenLastCalledWith(tx, ["kart-1", "kart-2", "kart-acik"]);
    expect(sonuc.stokDenetimi).toEqual({ tur: "artimli", kart: 3 });
  });

  it("BLD-16: okuma ile yazma arasında kullanıcının kapattığı kayıt otomatik çözülmez, olay yazılmaz", async () => {
    tx.duzeltmeKaydi.findMany.mockResolvedValue([{ id: "d1", tekillikAnahtari: "NEGATIF_STOK:stok_depo_bakiyesi:b1", durum: "acik", nedenKodu: "NEGATIF_STOK" }]);
    tx.duzeltmeKaydi.updateMany.mockResolvedValue({ count: 0 });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara());
    expect(sonuc.otomatikCozulen).toBe(0);
    expect(tx.duzeltmeOlayi.create).not.toHaveBeenCalled();
  });

  it("BLD-16: okumalar ayrı kısa işlemlerde, aynı anda en çok OKUMA_ESZAMANLI; yazma ayrı işlemde", async () => {
    let anlik = 0; let enCok = 0;
    const yavas = (sonuc: unknown) => async () => { anlik++; enCok = Math.max(enCok, anlik); await new Promise((r) => setTimeout(r, 5)); anlik--; return sonuc; };
    for (const m of [tx.bankaEkstreSatir, tx.masraf, tx.krediKartiHareket, tx.posTahsilat, tx.ebelgeKayit, tx.stokDepoBakiye, tx.sayim, tx.cekSenet, tx.fatura]) m.findMany.mockImplementation(yavas([]));
    tx.bankaEkstreSatir.findMany.mockImplementation(yavas([{ id: "s1", aciklama: "x", tutar: { toString: () => "1" } }]));
    prisma.tenantIslem.mockClear();
    await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.tara());
    expect(enCok).toBeLessThanOrEqual(OKUMA_ESZAMANLI);
    expect(enCok).toBeGreaterThan(1);
    // 13 okuma + bilinen anahtar + 1 yazma parçası + mevcut kayıtlar = 16 ayrı işlem
    expect(prisma.tenantIslem).toHaveBeenCalledTimes(16);
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

describe("BLD-16 sınırlayıcı", () => {
  it("aynı anda en çok n iş yürütür; boşalan yer arada gelen işe kaptırılmaz", async () => {
    const sira = sinirlayici(2);
    let anlik = 0; let enCok = 0;
    const is = () => sira(async () => { anlik++; enCok = Math.max(enCok, anlik); await Promise.resolve(); await new Promise((r) => setTimeout(r, 1)); anlik--; return 1; });
    const ilk = Array.from({ length: 5 }, is);
    await new Promise((r) => setTimeout(r, 2));
    const sonra = Array.from({ length: 5 }, is);
    expect((await Promise.all([...ilk, ...sonra])).length).toBe(10);
    expect(enCok).toBe(2);
  });
});
