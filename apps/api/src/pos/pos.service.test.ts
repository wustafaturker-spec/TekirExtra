import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PosService } from "./pos.service";
import { IyzicoAdapter } from "./iyzico.adapter";
import { PaytrAdapter } from "./paytr.adapter";

vi.mock("../core/kripto", () => ({ coz: () => JSON.stringify({ kullaniciAdi: "api", parola: "gizli", servisAdresi: "https://sandbox-api.iyzipay.com" }) }));

// KSB-16: denkleştirmenin veritabanı tarafı kendi testinde; burada akışın çağırdığı sınanır.
vi.mock("../fatura/denklestirme", async (orijinal) => ({
  ...(await orijinal<typeof import("../fatura/denklestirme")>()),
  cariDenklestir: vi.fn(async () => ({ kapamalar: [] })),
  carileriDenklestir: vi.fn(async () => undefined),
  elleKapamaYaz: vi.fn(async () => undefined),
  kaynakKapamalariniCoz: vi.fn(async () => undefined),
  faturaKapamalariniCoz: vi.fn(async () => undefined),
}));


vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
  baglamlaCalistir: (_b: unknown, is: () => Promise<unknown>) => is(),
}));

const D = (v: string | number) => new Prisma.Decimal(v);

function kur(tx: Record<string, unknown>) {
  const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) } as any;
  const bildirimler = { uret: vi.fn().mockResolvedValue({}) };
  const donemKilidi = { tarihDogrula: vi.fn().mockResolvedValue(undefined) };
  return { service: new PosService(prisma, {} as any, {} as any, bildirimler as any, donemKilidi as any), bildirimler };
}

describe("PosService (P1-6)", () => {
  it("aynı faturanın açık bağlantısı varken yenisini açmaz", async () => {
    const tx = {
      posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "p1", aktif: true, saglayici: "iyzico", dovizCinsi: "TRY", baglanti: { durum: "aktif" } }) },
      posTahsilat: { findFirst: vi.fn().mockResolvedValue({ id: "eski", tutar: D(100), dovizCinsi: "TRY", createdAt: new Date("2026-10-01T10:00:00Z") }) },
    };
    const { service } = kur(tx);
    await expect(service.baslat({ posHesapId: "p1", cariId: "c1", faturaId: "f1", tutar: "100" })).rejects.toThrow(/açık ödeme bağlantısı var/);
  });

  it("banka POS'unda ödeme bağlantısı açılmaz", async () => {
    const { service } = kur({ posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "p1", aktif: true, saglayici: "banka" }) } });
    await expect(service.baslat({ posHesapId: "p1", cariId: "c1", tutar: "100" })).rejects.toThrow(/Slip gir/);
  });

  it("süresi dolmuş bağlantıya gelen ödemeyi kaydeder, geç ödeme işaretler ve bildirir", async () => {
    const tx = {
      posHesap: { findUnique: vi.fn().mockResolvedValue({ komisyonOrani: D("2"), islemUcreti: D(0), taksitOranlari: [] }) },
      posTahsilat: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() },
      kasaBankaHareket: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
      cariHareket: { create: vi.fn() },
    };
    const { service, bildirimler } = kur(tx);
    const kayit = { id: "t1", durum: "suresi_doldu", makbuzAnahtari: "m", posHesapId: "p1", tutar: D(250), dovizCinsi: "TRY", cariId: "c1", faturaId: null };
    const sonuc = await (service as any).odemeyiKaydet("t1", kayit, "odeme-1", "PayTR kart tahsilatı");
    expect(sonuc).toMatchObject({ tekrar: false, gecOdeme: true });
    expect(tx.posTahsilat.updateMany.mock.calls[0][0]).toMatchObject({ where: { durum: { in: ["baslatildi", "suresi_doldu", "iptal"] } }, data: { durum: "odendi", gecOdeme: true } });
    expect(tx.kasaBankaHareket.create).toHaveBeenCalledOnce();
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "pos-gec-odeme:t1" }));
  });

  describe("KSB-35 taksit", () => {
    function baslatTx(posHesap: Record<string, unknown>) {
      return {
        posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "p1", aktif: true, saglayici: "iyzico", dovizCinsi: "TRY", baglanti: { id: "b1", durum: "aktif", sifreliConfig: "x" }, ...posHesap }) },
        cariHesap: { findUnique: vi.fn().mockResolvedValue({ id: "c1", aktif: true, dovizCinsi: posHesap.dovizCinsi ?? "TRY", eposta: "a@b.com", unvan: "Ali Veli", ad: "Ali", soyad: "Veli", adresler: [{ adres: "Cadde 1", il: "İstanbul" }] }) },
        posTahsilat: { create: vi.fn().mockResolvedValue({ id: "t1" }), update: vi.fn().mockResolvedValue({ id: "t1" }), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "t1" }) },
      };
    }
    it("iyzico formunda yalnız tabloda tanımlı taksitleri açar", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeBaslat").mockResolvedValue({ token: "tok", odemeSayfasiUrl: "https://pay" });
      const { service } = kur(baslatTx({ taksitOranlari: [{ taksit: 6, oran: "5.9" }, { taksit: 3, oran: "3.49" }] }));
      await service.baslat({ posHesapId: "p1", cariId: "c1", tutar: "100" });
      expect(casus.mock.calls[0][1]).toMatchObject({ enabledInstallments: [1, 3, 6] });
      casus.mockRestore();
    });
    it("tablo boşsa ya da hesap dövizliyse tek çekim açar", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeBaslat").mockResolvedValue({ token: "tok", odemeSayfasiUrl: "https://pay" });
      await kur(baslatTx({ taksitOranlari: [] })).service.baslat({ posHesapId: "p1", cariId: "c1", tutar: "100" });
      await kur(baslatTx({ dovizCinsi: "USD", taksitOranlari: [{ taksit: 3, oran: "3" }] })).service.baslat({ posHesapId: "p1", cariId: "c1", tutar: "100" });
      expect(casus.mock.calls.map((c) => (c[1] as { enabledInstallments: number[] }).enabledInstallments)).toEqual([[1], [1]]);
      casus.mockRestore();
    });
  });

  describe("KSB-36 tahsilat komisyonu", () => {
    const hesap = { komisyonOrani: D("1.99"), islemUcreti: D("0.25"), taksitOranlari: [{ taksit: 3, oran: "3.49" }] };
    function odemeTx() {
      return {
        posHesap: { findUnique: vi.fn().mockResolvedValue(hesap) },
        posTahsilat: {
          findUnique: vi.fn().mockResolvedValue({ id: "t1", durum: "baslatildi", saglayiciToken: "tok", makbuzAnahtari: "m", posHesapId: "p1", tutar: D(1000), dovizCinsi: "TRY", cariId: "c1", faturaId: null, posHesap: { baglanti: { sifreliConfig: "x" } } }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
        },
        kasaBankaHareket: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
        cariHareket: { create: vi.fn() },
      };
    }
    it("iyzico'da müşteri vade farkı ödese de tahsilat tutarı yazılır, komisyon taksit oranından tahmin edilir", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: true, odemeId: "pay", tutar: 1060, fiyat: 1000, odenen: 1060, taksit: 3, dovizCinsi: "TRY" } as never);
      const tx = odemeTx();
      await kur(tx).service.callback("t1", "t1", "tok");
      expect(tx.posTahsilat.updateMany.mock.calls[0][0].data).toMatchObject({ durum: "odendi", taksitSayisi: 3, komisyonKaynagi: "tahmin" });
      const d = tx.posTahsilat.updateMany.mock.calls[0][0].data;
      expect([d.odenenTutar.toFixed(2), d.komisyonOrani.toFixed(2), d.komisyonTutari.toFixed(2), d.netTutar.toFixed(2)]).toEqual(["1060.00", "3.49", "35.15", "964.85"]);
      // Cariye ve POS'a vade farkı değil tahsilat tutarı girer.
      expect(tx.kasaBankaHareket.create.mock.calls[0][0].data.tutar.toFixed(2)).toBe("1000.00");
      expect(tx.cariHareket.create.mock.calls[0][0].data.tutar.toFixed(2)).toBe("1000.00");
      casus.mockRestore();
    });
    it("PayTR bildiriminde taksit ve müşterinin ödediği (total_amount) yazılır; tutar payment_amount'tan doğrulanır", async () => {
      const casus = vi.spyOn(PaytrAdapter.prototype, "callbackDogrula").mockReturnValue(true);
      const tx = odemeTx();
      tx.posTahsilat.findUnique.mockResolvedValue({ id: "t1", durum: "baslatildi", makbuzAnahtari: "m", posHesapId: "p1", tutar: D(1000), dovizCinsi: "TRY", cariId: "c1", faturaId: null, posHesap: { saglayici: "paytr", baglanti: { sifreliConfig: "x" } } });
      const sonuc = await kur(tx).service.paytrCallback("t1", "t1", { hash: "h", merchant_oid: "oid", status: "success", total_amount: "106000", payment_amount: "100000", payment_type: "card", currency: "TL", callback_id: "t1", merchant_id: undefined as never, installment_count: "3" });
      expect(sonuc).toBe("OK");
      const d = tx.posTahsilat.updateMany.mock.calls[0][0].data;
      expect([d.taksitSayisi, d.odenenTutar.toFixed(2), d.komisyonTutari.toFixed(2)]).toEqual([3, "1060.00", "35.15"]);
      casus.mockRestore();
    });
    it("sepet tutarı tahsilattan farklıysa ödemeyi doğrulamaz", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: true, odemeId: "pay", tutar: 900, fiyat: 900, odenen: 900, taksit: 1, dovizCinsi: "TRY" } as never);
      const tx = odemeTx();
      await expect(kur(tx).service.callback("t1", "t1", "tok")).rejects.toThrow(/doğrulanamadı/);
      expect(tx.posTahsilat.updateMany.mock.calls[0][0].data).toMatchObject({ durum: "basarisiz" });
      casus.mockRestore();
    });
  });

  describe("iade", () => {
    const tahsilat = (iadeler: { tutar: number; mahsup: number }[]) => ({
      id: "t1", durum: "odendi", tutar: D(1000), dovizCinsi: "TRY", posHesapId: "p1", cariId: "c1", faturaId: "f1",
      posHesap: { ad: "Ziraat POS" },
      hareket: { faturaMahsubu: D(800) },
      iadeler: iadeler.map((i) => ({ tutar: D(i.tutar), hareket: { faturaMahsubu: D(-i.mahsup) } })),
    });
    const iadeTx = (kayit: unknown) => ({
      $queryRaw: vi.fn(),
      posTahsilat: { findUnique: vi.fn().mockResolvedValue(kayit) },
      kasaBankaHareket: { create: vi.fn(async ({ data }) => ({ id: "ih", ...data })) },
      cariHareket: { create: vi.fn() },
      posIade: { create: vi.fn(async ({ data }) => data) },
    });

    it("iade edilebilir kalanı aşan iadeyi reddeder", async () => {
      const { service } = kur(iadeTx(tahsilat([{ tutar: 700, mahsup: 700 }])));
      await expect(service.iade("t1", { tutar: "400", tarih: "2026-10-02", neden: "Ürün iadesi" })).rejects.toThrow(/kalanı \(300.00 TRY\) aşıyor/);
    });

    it("faturaya mahsup edilmiş kısım kadar mahsubu geri açar", async () => {
      const tx = iadeTx(tahsilat([{ tutar: 500, mahsup: 500 }]));
      const { service } = kur(tx);
      await service.iade("t1", { tutar: "400", tarih: "2026-10-02", neden: "Ürün iadesi" });
      // Mahsup 800, önceki iade 500'ünü geri açtı: kalan 300 geri açılır, 100'ü avanstan düşer.
      expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "tediye", kaynakTur: "pos_iade" });
      expect(tx.kasaBankaHareket.create.mock.calls[0][0].data.faturaMahsubu.toFixed(2)).toBe("-300.00");
      expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "borc", kaynakTur: "pos_iade" });
    });
  });
});
