import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PosService } from "./pos.service";
import { IyzicoAdapter } from "./iyzico.adapter";
import { PaytrAdapter } from "./paytr.adapter";

vi.mock("../core/kripto", () => ({
  coz: () => JSON.stringify({ kullaniciAdi: "api", parola: "gizli", servisAdresi: "https://sandbox-api.iyzipay.com" }),
}));

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

// SEC-23: makbuz bağlantı sırrı.
process.env.MAKBUZ_ANAHTAR_SIRLARI = `v1:${"ab".repeat(32)}`;

const D = (v: string | number) => new Prisma.Decimal(v);

function kur(tx: Record<string, unknown>) {
  const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) } as any;
  const bildirimler = { uret: vi.fn().mockResolvedValue({}) };
  const donemKilidi = { tarihDogrula: vi.fn().mockResolvedValue(undefined) };
  return { service: new PosService(prisma, {} as any, {} as any, bildirimler as any, donemKilidi as any, {} as any), bildirimler };
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
    const kayit = { id: "t1", durum: "suresi_doldu", posHesapId: "p1", tutar: D(250), dovizCinsi: "TRY", cariId: "c1", faturaId: null };
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
          findUnique: vi.fn().mockResolvedValue({ id: "t1", durum: "baslatildi", saglayiciToken: "tok", posHesapId: "p1", tutar: D(1000), dovizCinsi: "TRY", cariId: "c1", faturaId: null, posHesap: { baglanti: { sifreliConfig: "x" } } }),
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
      tx.posTahsilat.findUnique.mockResolvedValue({ id: "t1", durum: "baslatildi", posHesapId: "p1", tutar: D(1000), dovizCinsi: "TRY", cariId: "c1", faturaId: null, posHesap: { saglayici: "paytr", baglanti: { sifreliConfig: "x" } } });
      const sonuc = await kur(tx).service.paytrCallback("t1", "t1", { hash: "h", merchant_oid: "oid", status: "success", total_amount: "106000", payment_amount: "100000", payment_type: "card", currency: "TL", callback_id: "t1", merchant_id: undefined as never, installment_count: "3" });
      expect(sonuc).toBe("OK");
      const d = tx.posTahsilat.updateMany.mock.calls[0][0].data;
      expect([d.taksitSayisi, d.odenenTutar.toFixed(2), d.komisyonTutari.toFixed(2)]).toEqual([3, "1060.00", "35.15"]);
      casus.mockRestore();
    });
    it("KSB-37: iyzico kesintisini bildirince komisyon sağlayıcıdan yazılır; incelemedeki ödeme bildirilir", async () => {
      const kesinti = { isyerineGecenKalemleri: ["964.85"], saglayiciKomisyonu: "34.9", saglayiciUcreti: "0.25", kartSon4: "0008", fraudDurumu: 0 };
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: true, odemeId: "pay", tutar: 1000, fiyat: 1000, odenen: 1000, taksit: 1, dovizCinsi: "TRY", kesinti } as never);
      const tx = odemeTx();
      const { service, bildirimler } = kur(tx);
      await service.callback("t1", "t1", "tok");
      const d = tx.posTahsilat.updateMany.mock.calls[0][0].data;
      expect([d.komisyonKaynagi, d.komisyonTutari.toFixed(2), d.netTutar.toFixed(2), d.kartSon4, d.fraudDurumu]).toEqual(["saglayici", "35.15", "964.85", "0008", 0]);
      expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "pos-fraud-inceleme:t1" }));
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

  it("SEC-23: makbuz yanlış anahtarla açılmaz; anahtar sorguda aranmaz, türetilmiş ya da eski özetle doğrulanır", async () => {
    const tahsilat = { id: "t1", hareket: { id: "h1" }, makbuzAnahtarOzeti: null };
    const tx = { posTahsilat: { findFirst: vi.fn().mockResolvedValue(tahsilat) }, tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "F" }) } };
    const { service } = kur(tx);
    await expect(service.makbuzPdf("t1", "t1", "0".repeat(64))).rejects.toThrow(/bulunamadı/);
    expect(tx.posTahsilat.findFirst.mock.calls[0][0].where).toEqual({ id: "t1", durum: "odendi", hareketId: { not: null } });
  });

  describe("SEC-22 dönüş çağrısında firma ve kayıt doğrulaması", () => {
    const kayit = (o: Record<string, unknown> = {}) => ({ id: "t1", durum: "baslatildi", saglayiciToken: "tok", posHesapId: "p1", tutar: D(1000), dovizCinsi: "TRY", cariId: "c1", faturaId: null, posHesap: { saglayici: "iyzico", baglanti: { sifreliConfig: "x" } }, ...o });
    const txKur = (k: unknown) => ({ posTahsilat: { findUnique: vi.fn().mockResolvedValue(k), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: vi.fn() } });

    it("iyzico ödemesi başka tahsilat için başlatılmışsa (conversationId) kaydedilmez, ret firmanın denetim kaydına yazılır", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: true, odemeId: "pay", conversationId: "baska-tahsilat", tutar: 1000, fiyat: 1000, odenen: 1000, taksit: 1, dovizCinsi: "TRY" } as never);
      const tx = txKur(kayit());
      await expect(kur(tx).service.callback("t1", "t1", "tok")).rejects.toThrow(/doğrulanamadı/);
      expect(tx.posTahsilat.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "t1", userId: null, islem: "pos_donusu_reddedildi", varlikId: "t1", detay: { saglayici: "iyzico", neden: "kimlik_uyusmuyor" } }) });
      casus.mockRestore();
    });

    it("token uyuşmazsa denetim kaydı yazılır; kayıt o firmada yoksa (sahte firma adresi) yazılmaz ve sağlayıcıya gidilmez", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu");
      const tx = txKur(kayit());
      await expect(kur(tx).service.callback("t1", "t1", "sahte")).rejects.toThrow(/tokenı/);
      expect(tx.auditLog.create.mock.calls[0][0].data.detay).toEqual({ saglayici: "iyzico", neden: "token_uyusmuyor" });
      const yok = txKur(null);
      await expect(kur(yok).service.callback("t2", "t1", "tok")).rejects.toThrow(/tokenı/);
      expect(yok.auditLog.create).not.toHaveBeenCalled();
      expect(casus).not.toHaveBeenCalled();
      expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain("sahte");
      casus.mockRestore();
    });

    it("PayTR'de başka üye işyeri ve geçersiz imza reddedilir ve nedenleriyle kaydedilir", async () => {
      const paytrKayit = kayit({ posHesap: { saglayici: "paytr", baglanti: { sifreliConfig: "x" } } });
      const govde = { hash: "h", merchant_oid: "oid", status: "success", total_amount: "100000", payment_amount: "100000", payment_type: "card", currency: "TL", callback_id: "t1", installment_count: "1" };
      const tx = txKur(paytrKayit);
      await expect(kur(tx).service.paytrCallback("t1", "t1", { ...govde, merchant_id: "baska-isyeri" } as never)).rejects.toThrow(/imzası/);
      const casus = vi.spyOn(PaytrAdapter.prototype, "callbackDogrula").mockReturnValue(false);
      await expect(kur(tx).service.paytrCallback("t1", "t1", { ...govde, merchant_id: undefined } as never)).rejects.toThrow(/imzası/);
      expect(tx.auditLog.create.mock.calls.map((c) => c[0].data.detay.neden)).toEqual(["uye_isyeri_uyusmuyor", "imza_gecersiz"]);
      expect(tx.posTahsilat.updateMany).not.toHaveBeenCalled();
      casus.mockRestore();
    });
  });

  describe("KSB-43 sağlayıcıya iade", () => {
    const odenmis = (saglayici: "iyzico" | "paytr", ek: Record<string, unknown> = {}) => ({
      id: "t1", durum: "odendi", tutar: D(1000), dovizCinsi: "TRY", posHesapId: "p1", cariId: "c1", faturaId: null, hareketId: "h0", kanal: "baglanti",
      saglayiciToken: "tok", saglayiciOdemeId: saglayici === "iyzico" ? "38611970" : "OID1", iadeKilidi: null,
      posHesap: { ad: `${saglayici} POS`, saglayici, baglanti: { sifreliConfig: "x" } },
      hareket: { faturaMahsubu: null }, iadeler: [], ...ek,
    });
    const tx = (kayit: unknown) => ({
      $queryRaw: vi.fn(),
      posTahsilat: { findUnique: vi.fn().mockResolvedValue(kayit), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      kasaBankaHareket: { create: vi.fn(async ({ data }) => ({ id: "ih", ...data })) },
      cariHareket: { create: vi.fn() },
      posIade: { create: vi.fn(async ({ data }) => data) },
    });
    it("iyzico'ya kalem işlem numarasıyla iade gönderir, onaydan sonra kaydı yazar", async () => {
      const sonuc = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ odemeIslemNolari: ["PTX-1"] } as never);
      const iade = vi.spyOn(IyzicoAdapter.prototype, "iadeEt").mockResolvedValue({ ref: "HOST-9", tutar: "400.00" });
      const t = tx(odenmis("iyzico"));
      await kur(t).service.iade("t1", { tutar: "400", tarih: "2026-11-01", neden: "Müşteri iadesi" });
      expect(iade.mock.calls[0][1]).toMatchObject({ odemeIslemNo: "PTX-1", tutar: "400.00", dovizCinsi: "TRY" });
      expect(t.posIade.create.mock.calls[0][0].data).toMatchObject({ saglayiciyaGonderildi: true, saglayiciIadeRef: "HOST-9" });
      expect(t.posTahsilat.updateMany.mock.calls[0][0].data).toHaveProperty("iadeKilidi");
      sonuc.mockRestore(); iade.mockRestore();
    });
    it("sağlayıcı reddederse hiçbir kayıt yazmaz, kilidi kaldırır", async () => {
      const sonuc = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ odemeIslemNolari: ["PTX-1"] } as never);
      const iade = vi.spyOn(IyzicoAdapter.prototype, "iadeEt").mockRejectedValue(new Error("Refund amount exceeds"));
      const t = tx(odenmis("iyzico"));
      await expect(kur(t).service.iade("t1", { tutar: "400", tarih: "2026-11-01", neden: "Müşteri iadesi" })).rejects.toThrow(/iadeyi gerçekleştirmedi: Refund amount exceeds/);
      expect(t.kasaBankaHareket.create).not.toHaveBeenCalled();
      expect(t.posIade.create).not.toHaveBeenCalled();
      expect(t.posTahsilat.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { iadeKilidi: null } });
      sonuc.mockRestore(); iade.mockRestore();
    });
    it("PayTR'ye sipariş numarasıyla iade gönderir", async () => {
      const iade = vi.spyOn(PaytrAdapter.prototype, "iadeEt").mockResolvedValue({ ref: "R1" });
      const t = tx(odenmis("paytr"));
      await kur(t).service.iade("t1", { tutar: "250.5", tarih: "2026-11-01", neden: "Müşteri iadesi" });
      expect(iade.mock.calls[0][1]).toMatchObject({ merchantOid: "OID1", tutar: "250.50" });
      expect(t.posIade.create.mock.calls[0][0].data).toMatchObject({ saglayiciyaGonderildi: true, saglayiciIadeRef: "R1" });
      iade.mockRestore();
    });
    it("'sağlayıcıya gönderme' seçilirse sağlayıcı çağrılmaz, iade elle işaretlenir", async () => {
      const iade = vi.spyOn(IyzicoAdapter.prototype, "iadeEt");
      const t = tx(odenmis("iyzico"));
      await kur(t).service.iade("t1", { tutar: "400", tarih: "2026-11-01", neden: "Panelden iade edildi", saglayiciyaGonder: false });
      expect(iade).not.toHaveBeenCalled();
      expect(t.posIade.create.mock.calls[0][0].data).toMatchObject({ saglayiciyaGonderildi: false });
      iade.mockRestore();
    });
    it("PLT-40: abonelik tahsilatı iade edilemez; sağlayıcı çağrılmaz", async () => {
      const iade = vi.spyOn(IyzicoAdapter.prototype, "iadeEt");
      const t = tx(odenmis("iyzico", { kanal: "abonelik" }));
      await expect(kur(t).service.iade("t1", { tutar: "400", tarih: "2026-11-01", neden: "Müşteri iadesi" })).rejects.toThrow(/abonelik iadesi platform tarafında/);
      expect(iade).not.toHaveBeenCalled();
      expect(t.posIade.create).not.toHaveBeenCalled();
      iade.mockRestore();
    });
    it("sürmekte olan bir sağlayıcı iadesi varken ikinci iadeyi reddeder", async () => {
      const iade = vi.spyOn(IyzicoAdapter.prototype, "iadeEt");
      const t = tx(odenmis("iyzico", { iadeKilidi: new Date() }));
      await expect(kur(t).service.iade("t1", { tutar: "400", tarih: "2026-11-01", neden: "Müşteri iadesi" })).rejects.toThrow(/sonucu beklenen bir iade var/);
      // Kilit yarışında başka istek önce davrandıysa da sağlayıcıya gitmez.
      const t2 = tx(odenmis("iyzico"));
      t2.posTahsilat.updateMany.mockResolvedValue({ count: 0 });
      await expect(kur(t2).service.iade("t1", { tutar: "400", tarih: "2026-11-01", neden: "Müşteri iadesi" })).rejects.toThrow(/sonucu beklenen bir iade var/);
      expect(iade).not.toHaveBeenCalled();
      iade.mockRestore();
    });
    it("sağlayıcı onaylayıp kayıt yazılamazsa bekleyen iadeyi saklar ve kritik bildirim üretir", async () => {
      const iade = vi.spyOn(PaytrAdapter.prototype, "iadeEt").mockResolvedValue({ ref: "R1" });
      const t = tx(odenmis("paytr"));
      t.kasaBankaHareket.create.mockRejectedValue(new Error("db kesildi"));
      const { service, bildirimler } = kur(t);
      await expect(service.iade("t1", { tutar: "100", tarih: "2026-11-01", neden: "Müşteri iadesi" })).rejects.toThrow(/sağlayıcıda yapıldı \(ref R1\)/);
      expect(t.posTahsilat.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ bekleyenSaglayiciIade: expect.objectContaining({ ref: "R1", tutar: "100.00" }) }) }));
      expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "kritik" }));
      iade.mockRestore();
    });
    it("sağlayıcıya gönderilmiş iade geri alınamaz", async () => {
      const t = { posIade: { findUnique: vi.fn().mockResolvedValue({ id: "i1", saglayiciyaGonderildi: true, tarih: new Date(), hareket: {}, posTahsilat: { kanal: "baglanti" } }) } };
      await expect(kur(t).service.iadeGeriAl("i1", "Yanlış girildi")).rejects.toThrow(/geri alınamaz/);
    });
    it("PLT-44: platformdan yapılan abonelik iadesi POS ekranından geri alınamaz", async () => {
      const t = { posIade: { findUnique: vi.fn().mockResolvedValue({ id: "i1", saglayiciyaGonderildi: false, tarih: new Date(), hareket: {}, posTahsilat: { kanal: "abonelik" } }) } };
      await expect(kur(t).service.iadeGeriAl("i1", "Yanlış girildi")).rejects.toThrow(/Abonelik iadesi buradan geri alınamaz/);
    });
  });

  describe("KSB-38 sağlayıcıdan sorgulama", () => {
    function sorguTx(ek: Record<string, unknown> = {}) {
      return {
        posHesap: { findUnique: vi.fn().mockResolvedValue({ komisyonOrani: D("2"), islemUcreti: D(0), taksitOranlari: [] }) },
        posTahsilat: {
          findUnique: vi.fn().mockResolvedValue({ id: "t1", durum: "suresi_doldu", saglayiciToken: "tok", posHesapId: "p1", tutar: D(500), dovizCinsi: "TRY", cariId: "c1", faturaId: null, posHesap: { saglayici: "iyzico", baglanti: { sifreliConfig: "x" } }, ...ek }),
          findMany: vi.fn().mockResolvedValue([{ id: "t1" }, { id: "t2" }]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
        },
        kasaBankaHareket: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
        cariHareket: { create: vi.fn() },
      };
    }
    it("ödenmemiş talebin durumuna dokunmaz", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: false, tutar: 0, fiyat: 0, odenen: 0, taksit: 1, dovizCinsi: "TRY" } as never);
      const tx = sorguTx();
      const s = await kur(tx).service.saglayicidanSorgula("t1");
      expect(s.odendi).toBe(false);
      expect(tx.posTahsilat.updateMany).not.toHaveBeenCalled();
      expect(tx.posTahsilat.update.mock.calls[0][0].data).toHaveProperty("saglayiciSorguTarihi");
      casus.mockRestore();
    });
    it("sağlayıcı hata dönerse ödenmedi der, durumu değiştirmez", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockRejectedValue(new Error("Token bulunamadı"));
      const tx = sorguTx();
      await expect(kur(tx).service.saglayicidanSorgula("t1")).resolves.toMatchObject({ odendi: false, mesaj: expect.stringContaining("Token bulunamadı") });
      expect(tx.posTahsilat.updateMany).not.toHaveBeenCalled();
      casus.mockRestore();
    });
    it("ödenmiş çıkarsa tahsilatı geç ödeme olarak kaydeder", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: true, odemeId: "pay", tutar: 500, fiyat: 500, odenen: 500, taksit: 1, dovizCinsi: "TRY" } as never);
      const tx = sorguTx();
      const { service, bildirimler } = kur(tx);
      await expect(service.saglayicidanSorgula("t1")).resolves.toMatchObject({ odendi: true });
      expect(tx.posTahsilat.updateMany.mock.calls[0][0].data).toMatchObject({ durum: "odendi", gecOdeme: true });
      expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "pos-gec-odeme:t1" }));
      casus.mockRestore();
    });
    it("tutarı uyuşmayan ödemeyi kaydetmez", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({ basarili: true, odemeId: "pay", tutar: 400, fiyat: 400, odenen: 400, taksit: 1, dovizCinsi: "TRY" } as never);
      const tx = sorguTx();
      await expect(kur(tx).service.saglayicidanSorgula("t1")).resolves.toMatchObject({ odendi: false });
      expect(tx.posTahsilat.updateMany).not.toHaveBeenCalled();
      casus.mockRestore();
    });
    it("PayTR talebi sorgulanmaz", async () => {
      const tx = sorguTx({ posHesap: { saglayici: "paytr", baglanti: { sifreliConfig: "x" } } });
      await expect(kur(tx).service.saglayicidanSorgula("t1")).rejects.toThrow(/PayTR ödemeleri sorgulanamaz/);
    });
    it("worker yalnız uygun iyzico taleplerini sınırlı sayıda seçer, birinin hatası diğerini durdurmaz", async () => {
      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu")
        .mockRejectedValueOnce(new Error("ağ"))
        .mockResolvedValueOnce({ basarili: true, odemeId: "pay", tutar: 500, fiyat: 500, odenen: 500, taksit: 1, dovizCinsi: "TRY" } as never);
      const tx = sorguTx();
      const sayi = await kur(tx).service.bekleyenleriSorgula("t1", 5);
      expect(sayi).toBe(1);
      const sorgu = tx.posTahsilat.findMany.mock.calls[0][0];
      expect(sorgu.take).toBe(5);
      expect(sorgu.where).toMatchObject({ durum: { in: ["baslatildi", "suresi_doldu", "iptal"] }, hareketId: null, posHesap: { saglayici: "iyzico", baglanti: { durum: "aktif" } } });
      casus.mockRestore();
    });
  });

  describe("KSB-40 hesap özeti", () => {
    it("dönem tahsilatını, komisyonu kaynağına göre, iadeyi ve valörü gelmiş aktarılabiliri özetler", async () => {
      const tx = {
        posTahsilat: {
          groupBy: vi.fn().mockResolvedValue([
            { posHesapId: "p1", komisyonKaynagi: "saglayici", _count: { _all: 2 }, _sum: { tutar: D(1000), komisyonTutari: D("30.50") } },
            { posHesapId: "p1", komisyonKaynagi: "tahmin", _count: { _all: 1 }, _sum: { tutar: D(500), komisyonTutari: D(10) } },
            { posHesapId: "p1", komisyonKaynagi: null, _count: { _all: 1 }, _sum: { tutar: D(200), komisyonTutari: null } },
            { posHesapId: "p2", komisyonKaynagi: "tahmin", _count: { _all: 1 }, _sum: { tutar: D(99), komisyonTutari: D(1) } },
          ]),
        },
        posIade: { findMany: vi.fn().mockResolvedValue([{ tutar: D(50), posTahsilat: { posHesapId: "p1" } }]) },
      };
      const { service } = kur(tx);
      vi.spyOn(service, "bankayaGececekler").mockResolvedValue([
        { posHesap: { id: "p1", dovizCinsi: "TRY" }, bakiye: "1200.00", gruplar: [{ vadesiGeldi: true, net: "700.00" }, { vadesiGeldi: false, net: "400.00" }] },
      ] as never);
      const s = await service.hesapOzetleri({ baslangic: "2026-10-01", bitis: "2026-10-31" });
      expect(s.hesaplar).toEqual([{ posHesapId: "p1", dovizCinsi: "TRY", adet: 4, komisyonsuzAdet: 1, brut: "1700.00", komisyonSaglayici: "30.50", komisyonTahmin: "10.00", iade: "50.00", net: "1609.50", bakiye: "1200.00", aktarilabilir: "700.00" }]);
      // Dönem İstanbul günüyle sınırlanır.
      expect(tx.posTahsilat.groupBy.mock.calls[0][0].where.odemeTarihi.gte.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    });
  });

  describe("iade", () => {
    const tahsilat = (iadeler: { tutar: number; mahsup: number }[]) => ({
      id: "t1", durum: "odendi", tutar: D(1000), dovizCinsi: "TRY", posHesapId: "p1", cariId: "c1", faturaId: "f1", hareketId: "h0", kanal: "slip",
      posHesap: { ad: "Ziraat POS", saglayici: "banka" },
      hareket: { faturaMahsubu: D(800) },
      iadeler: iadeler.map((i) => ({ tutar: D(i.tutar), hareket: { faturaMahsubu: D(-i.mahsup) } })),
    });
    const iadeTx = (kayit: unknown) => ({
      $queryRaw: vi.fn(),
      posTahsilat: { findUnique: vi.fn().mockResolvedValue(kayit), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
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

    it("KSB-41: iade komisyona dokunmaz; POS'tan iade tutarı kadar çıkar, masraf açılmaz", async () => {
      const tx = {
        ...iadeTx({ ...tahsilat([]), komisyonTutari: D("35.15"), netTutar: D("964.85"), komisyonKaynagi: "saglayici" }),
        posTahsilat: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
        masraf: { create: vi.fn() },
        masrafKategori: { upsert: vi.fn() },
      };
      tx.posTahsilat.findUnique.mockResolvedValue({ ...tahsilat([]), komisyonTutari: D("35.15"), netTutar: D("964.85"), komisyonKaynagi: "saglayici" });
      const { service } = kur(tx);
      await service.iade("t1", { tutar: "1000", tarih: "2026-10-02", neden: "Tam iade" });
      expect(tx.kasaBankaHareket.create.mock.calls[0][0].data.tutar.toFixed(2)).toBe("1000.00");
      for (const c of [...tx.posTahsilat.update.mock.calls, ...tx.posTahsilat.updateMany.mock.calls])
        expect(Object.keys(c[0].data)).not.toEqual(expect.arrayContaining(["komisyonTutari"]));
      expect(tx.masraf.create).not.toHaveBeenCalled();
    });
  });

  describe("P-04 kalıcı olay kaydı, eşzamanlılık ve markalı ödeme", () => {
    it("en az 10 eşzamanlı aynı iyzico callback olayında tek finansal etki üretilir, diğer 9 çağrı tekrar olarak sonuçlanır", async () => {
      let tahsilatDurumu = "baslatildi";
      let hareketSayisi = 0;

      const kayit = {
        id: "t1",
        durum: "baslatildi",
        saglayiciToken: "tok-10",
        posHesapId: "p1",
        tutar: D(500),
        dovizCinsi: "TRY",
        cariId: "c1",
        faturaId: null,
        posHesap: {
          id: "p1",
          saglayici: "iyzico",
          baglanti: { sifreliConfig: "x" },
          komisyonOrani: D(2),
          islemUcreti: D(0),
          taksitOranlari: [],
        },
      };

      const olaylar = new Map<string, any>();

      const tx = {
        posTahsilat: {
          findUnique: vi.fn(async () => ({ ...kayit, durum: tahsilatDurumu })),
          updateMany: vi.fn(async (arg: any) => {
            if (arg.where.durum?.in?.includes(tahsilatDurumu) && tahsilatDurumu !== "odendi") {
              tahsilatDurumu = "odendi";
              return { count: 1 };
            }
            return { count: 0 };
          }),
          update: vi.fn(async () => ({})),
        },
        posHesap: {
          findUnique: vi.fn(async () => kayit.posHesap),
        },
        posOlayKaydi: {
          findUnique: vi.fn(async ({ where }: any) => olaylar.get(where.tenantId_isAnahtari.isAnahtari) ?? null),
          upsert: vi.fn(async ({ create, update, where }: any) => {
            const key = where.tenantId_isAnahtari.isAnahtari;
            const obj = { ...(olaylar.get(key) ?? create), ...update };
            olaylar.set(key, obj);
            return obj;
          }),
          updateMany: vi.fn(async ({ where, data }: any) => {
            const obj = olaylar.get(where.isAnahtari);
            if (obj) Object.assign(obj, data);
            return { count: 1 };
          }),
        },
        kasaBankaHareket: {
          create: vi.fn(async () => {
            hareketSayisi++;
            return { id: `h-${hareketSayisi}` };
          }),
        },
        cariHareket: {
          create: vi.fn(async () => ({ id: "c-h1" })),
        },
        tenant: {
          findUnique: vi.fn(async () => ({ unvan: "Test Firma", vkn: "1234567890" })),
        },
      };

      const casus = vi.spyOn(IyzicoAdapter.prototype, "odemeSonucu").mockResolvedValue({
        basarili: true,
        odemeId: "pay-10",
        conversationId: "t1",
        tutar: 500,
        fiyat: 500,
        odenen: 500,
        taksit: 1,
        dovizCinsi: "TRY",
      } as never);

      const { service } = kur(tx);

      // 10 eşzamanlı callback isteği
      const sonuclar = await Promise.all(
        Array.from({ length: 10 }).map(() => service.callback("t1", "t1", "tok-10")),
      );

      // Bütün çağrılar başarılı dönmelidir
      expect(sonuclar).toHaveLength(10);
      for (const s of sonuclar) {
        expect(s.basarili).toBe(true);
      }

      // Yalnızca 1 çağrı asıl işlemi yapmalı, diğer 9 çağrı tekrar olmalıdır
      const tekrarlar = sonuclar.filter((s) => s.tekrar);
      const ilkIslemler = sonuclar.filter((s) => !s.tekrar);

      expect(ilkIslemler).toHaveLength(1);
      expect(tekrarlar).toHaveLength(9);

      // Kasa banka hareket sayısı kesinlikle 1 olmalıdır (tek finansal etki)
      expect(hareketSayisi).toBe(1);
      expect(tx.kasaBankaHareket.create).toHaveBeenCalledTimes(1);
      expect(tx.cariHareket.create).toHaveBeenCalledTimes(1);

      casus.mockRestore();
    });

    it("tenantCoz: veritabanı fonksiyonu farklı kiracı döndüğünde yol parametresindeki hint yerine gerçek kiracıyı kullanır", async () => {
      const tx = {
        posTahsilat: { findUnique: vi.fn() },
      };
      const prisma = {
        tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)),
        $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: "gercek-tenant-uuid" }]),
      } as any;
      const s = new PosService(prisma, {} as any, {} as any, { uret: vi.fn() } as any, {} as any, {} as any);

      const cozulmus = await s.tenantCoz("tahsilat-uuid", "saldirgan-tenant-hint");
      expect(cozulmus).toBe("gercek-tenant-uuid");
    });

    it("publicOdemeBilgisi: geçerli token ile firma ve fatura bilgilerini güvenli döner, sayaç artar", async () => {
      const { token, ozet } = await import("./makbuz-anahtari").then((m) => m.odemeTokeniUret());
      const tx = {
        posTahsilat: {
          findUnique: vi.fn().mockResolvedValue({
            id: "t1",
            durum: "baslatildi",
            tutar: D(1250),
            dovizCinsi: "TRY",
            sonKullanimTarihi: new Date(Date.now() + 86400000),
            odemeTokenOzeti: ozet,
            odemeSayfasiUrl: "https://sandbox-checkout.com/pay",
            cari: { unvan: "Müşteri Ltd." },
            fatura: { no: "FTR2026001", tarih: new Date("2026-11-18"), genelToplam: D(1250) },
            posHesap: { ad: "Sanal POS", saglayici: "iyzico" },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        tenant: {
          findUnique: vi.fn().mockResolvedValue({
            unvan: "Tekir Örnek Firma A.Ş.",
            vkn: "9876543210",
            telefon: "02120000000",
            eposta: "muhasebe@ornekfirma.com",
            webSitesi: "https://ornekfirma.com",
          }),
        },
      };

      const { service } = kur(tx);
      const bilgi = await service.publicOdemeBilgisi("t1", "t1", token);

      expect(bilgi.tutar).toBe(1250);
      expect(bilgi.durum).toBe("baslatildi");
      expect(bilgi.firma.unvan).toBe("Tekir Örnek Firma A.Ş.");
      expect(bilgi.cari.unvan).toBe("Müşteri Ltd.");
      expect(bilgi.fatura?.no).toBe("FTR2026001");
      expect(bilgi.odemeSayfasiUrl).toBe("https://sandbox-checkout.com/pay");
      expect(tx.posTahsilat.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ odemeGoruntulenme: { increment: 1 } }) }),
      );
    });

    it("publicOdemeBilgisi: geçersiz token 404 fırlatır", async () => {
      const tx = {
        posTahsilat: {
          findUnique: vi.fn().mockResolvedValue({
            id: "t1",
            durum: "baslatildi",
            tutar: D(100),
            dovizCinsi: "TRY",
            odemeTokenOzeti: "farkli-ozet",
            makbuzAnahtarOzeti: null,
            cari: { unvan: "M" },
            fatura: null,
            posHesap: { ad: "POS", saglayici: "iyzico" },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        tenant: {
          findUnique: vi.fn().mockResolvedValue({ unvan: "F" }),
        },
      };

      const { service } = kur(tx);
      await expect(service.publicOdemeBilgisi("t1", "t1", "yanlis-token")).rejects.toThrow(/geçersiz veya süresi dolmuş/);
    });
  });
});
