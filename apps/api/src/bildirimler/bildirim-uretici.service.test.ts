import { describe, expect, it, vi } from "vitest";
import { BildirimUreticiService } from "./bildirim-uretici.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }) }));

interface TxSecenekleri {
  duzeltmeler?: unknown[];
  ebelgeler?: unknown[];
  satinAlmaTalepleri?: unknown[];
  cekSayisi?: number;
  kritikStok?: number;
  taslakSayim?: number;
  donemler?: unknown[];
  yukseltmeAdaylari?: { id: string }[];
  yoneticiler?: { id: string }[];
  mevcutTeslimatlar?: { userId: string }[];
}

function servisKur(secenek: TxSecenekleri = {}) {
  const teslimatCreateMany = vi.fn();
  const bildirimUpdate = vi.fn();
  const tx = {
    duzeltmeKaydi: { findMany: vi.fn().mockResolvedValue(secenek.duzeltmeler ?? []) },
    ebelgeKayit: { findMany: vi.fn().mockResolvedValue(secenek.ebelgeler ?? []) },
    satinAlmaTalebi: { findMany: vi.fn().mockResolvedValue(secenek.satinAlmaTalepleri ?? []) },
    cekSenet: { count: vi.fn().mockResolvedValue(secenek.cekSayisi ?? 0) },
    sayim: { count: vi.fn().mockResolvedValue(secenek.taslakSayim ?? 0) },
    maliDonem: { findMany: vi.fn().mockResolvedValue(secenek.donemler ?? []) },
    bildirim: { findMany: vi.fn().mockResolvedValue(secenek.yukseltmeAdaylari ?? []), update: bildirimUpdate },
    bildirimTeslimati: { findMany: vi.fn().mockResolvedValue(secenek.mevcutTeslimatlar ?? []), createMany: teslimatCreateMany },
    user: { findMany: vi.fn().mockResolvedValue(secenek.yoneticiler ?? []) },
    $queryRaw: vi.fn().mockResolvedValue([{ sayi: BigInt(secenek.kritikStok ?? 0) }]),
  };
  const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as never;
  const bildirimler = { uret: vi.fn().mockResolvedValue({ bildirimId: "b1", yeniTeslimat: 1 }), kapatEksikleri: vi.fn().mockResolvedValue(0) };
  const rapor = { vadesiGecenler: vi.fn().mockResolvedValue({ alacaklar: [], borclar: [], toplamAlacak: "0.00", toplamBorc: "0.00" }) };
  return { servis: new BildirimUreticiService(prisma, bildirimler as never, rapor as never), bildirimler, rapor, tx, teslimatCreateMany, bildirimUpdate };
}

describe("BildirimUreticiService.tara", () => {
  it("dış sistem kaynaklı düzeltmeyi entegrasyon, kendi kaydımızı düzeltme bildirimi yapar", async () => {
    const { servis, bildirimler } = servisKur({
      duzeltmeler: [
        { id: "d1", tur: "pos", onem: "kritik", aciklama: "POS tahsilatı finans hareketi üretmedi.", onerilenEylem: "Hareketi oluşturun.", sonTarih: null },
        { id: "d2", tur: "masraf", onem: "kritik", aciklama: "Masraf belgesiz.", onerilenEylem: null, sonTarih: null },
      ],
    });

    await servis.tara();

    expect(bildirimler.uret).toHaveBeenCalledWith(
      expect.objectContaining({ tur: "entegrasyon", birlesimAnahtari: "duzeltme:d1", kaynakRef: "d1", onem: "kritik" }),
    );
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ tur: "duzeltme", birlesimAnahtari: "duzeltme:d2" }));
  });

  it("kritik bildirime son tarih verir, uyarı seviyesine vermez", async () => {
    const { servis, bildirimler } = servisKur({ cekSayisi: 3 });
    await servis.tara();

    const cekGirdisi = bildirimler.uret.mock.calls.map(([girdi]) => girdi).find((girdi) => girdi.tur === "cek_senet");
    expect(cekGirdisi).toMatchObject({ onem: "uyari", birlesimAnahtari: expect.stringMatching(/^cek_senet:\d{4}-\d{2}-\d{2}$/) });
    expect(cekGirdisi.sonTarih).toBeUndefined();
  });

  it("vade özetini rapor motorundan alır — sayı zilde ve raporda aynı olmalıdır", async () => {
    const { servis, bildirimler, rapor } = servisKur();
    rapor.vadesiGecenler.mockResolvedValue({
      alacaklar: [{ faturaId: "f1" }, { faturaId: "f2" }],
      borclar: [{ faturaId: "f3" }],
      toplamAlacak: "18500.00",
      toplamBorc: "4200.00",
    });

    await servis.tara();

    expect(bildirimler.uret).toHaveBeenCalledWith(
      expect.objectContaining({ tur: "vade", aciklama: "2 tahsil edilecek (18500.00 TL), 1 ödenecek (4200.00 TL) fatura vadesini geçti." }),
    );
  });

  it("toplu olayları günlük özet olarak üretir; hiç olay yoksa bildirim açmaz", async () => {
    const { servis, bildirimler } = servisKur({ kritikStok: 0, taslakSayim: 0 });
    const sonuc = await servis.tara();

    expect(bildirimler.uret).not.toHaveBeenCalled();
    expect(sonuc.uretilen).toBe(0);
  });

  it("her tür için yalnız bu taramada bulunan anahtarları açık bırakır", async () => {
    const { servis, bildirimler } = servisKur({ kritikStok: 4 });
    await servis.tara();

    const stokCagrisi = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "stok");
    expect(stokCagrisi?.[1]).toEqual([expect.stringMatching(/^stok_kritik:/)]);
    const vadeCagrisi = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "vade");
    expect(vadeCagrisi?.[1]).toEqual([]);
  });

  it("kapatmayı taramanın kendi anahtarlarıyla sınırlar; olay bildirimleri açık kalır", async () => {
    // Alıcı reddi ve raporlanmış iptal taramada bulunmaz; önek dışında kalmalı.
    const { servis, bildirimler } = servisKur();
    await servis.tara();

    const ebelgeCagrisi = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "ebelge");
    const onekler: string[] = ebelgeCagrisi?.[2];
    expect(onekler).toEqual(expect.arrayContaining(["ebelge:", "earsiv-entegrator-iptal:"]));
    for (const olay of ["ebelge-ret:u1", "earsiv-iptal-raporlu:f1"]) {
      expect(onekler.some((onek) => olay.startsWith(onek))).toBe(false);
    }
    const entegrasyonCagrisi = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "entegrasyon");
    expect((entegrasyonCagrisi?.[2] as string[]).some((onek) => "kira-kur-eksik:k1".startsWith(onek))).toBe(false);
  });

  it("onay bekleyen satın alma talebini tutara göre onaylayabilecek rollere bildirir (SAT-07)", async () => {
    const { servis, bildirimler } = servisKur({
      satinAlmaTalepleri: [
        { id: "t1", no: "STL2026000001", tahminiToplam: "10000.00", talepEden: { adSoyad: "Depo Sorumlusu" } },
        { id: "t2", no: "STL2026000002", tahminiToplam: "40000.00", talepEden: { adSoyad: "Depo Sorumlusu" } },
      ],
    });

    await servis.tara();

    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ tur: "satin_alma", birlesimAnahtari: "satin_alma:talep:t1", roller: ["muhasebe", "yonetici"] }));
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "satin_alma:talep:t2", roller: ["yonetici"] }));
    const cagri = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "satin_alma");
    expect(cagri?.[1]).toEqual(["satin_alma:talep:t1", "satin_alma:talep:t2"]);
    // SAT-11: üçlü eşleştirme farkı da bu türe düştüğü için "duzeltme:" öneki de kapatılır
    expect(cagri?.[2]).toEqual(["duzeltme:", "satin_alma:"]);
  });

  it("entegratörde iptal edilmiş belgeyi fatura kesin kaldıkça hatırlatır (EBLG-39)", async () => {
    const { servis, bildirimler } = servisKur({
      ebelgeler: [{ id: "e1", durum: "iptal", hataMesaji: "Belge NES'te iptal edilmiş", faturaId: "f9", fatura: { no: "SNC2026000000009", durum: "kesin", cari: { unvan: "Alıcı" } } }],
    });

    await servis.tara();

    expect(bildirimler.uret).toHaveBeenCalledWith(
      expect.objectContaining({ tur: "ebelge", onem: "uyari", birlesimAnahtari: "earsiv-entegrator-iptal:f9", kaynakRef: "f9" }),
    );
    expect(bildirimler.uret).not.toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "ebelge:e1" }));
    const ebelgeCagrisi = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "ebelge");
    expect(ebelgeCagrisi?.[1]).toEqual(["earsiv-entegrator-iptal:f9"]);
  });
});

describe("BildirimUreticiService yükseltme", () => {
  it("sahiplenilmemiş kritik bildirimi yöneticiye taşır ve bir kez işaretler", async () => {
    const { servis, teslimatCreateMany, bildirimUpdate, tx } = servisKur({
      yukseltmeAdaylari: [{ id: "b9" }],
      yoneticiler: [{ id: "yon1" }, { id: "yon2" }],
      mevcutTeslimatlar: [{ userId: "yon1" }],
    });

    const sonuc = await servis.tara();

    expect(sonuc.yukseltilen).toBe(1);
    expect(teslimatCreateMany).toHaveBeenCalledWith({ data: [{ tenantId: "t1", bildirimId: "b9", userId: "yon2" }] });
    expect(bildirimUpdate).toHaveBeenCalledWith({ where: { id: "b9" }, data: { yukseltildiAt: expect.any(Date) } });
    // Aday sorgusu sahiplenilmiş teslimatı olan bildirimleri dışlamalıdır.
    expect(tx.bildirim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          onem: "kritik",
          yukseltildiAt: null,
          teslimatlar: { none: { durum: { in: ["ustlenildi", "aksiyon_alindi", "yoksayildi"] } } },
        }),
      }),
    );
  });
});
