import { describe, expect, it, vi } from "vitest";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import { HATA_YERLESME_MS } from "../ebelge/yerlesmis-hata";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }) }));

interface TxSecenekleri {
  duzeltmeler?: unknown[];
  ebelgeler?: unknown[];
  satinAlmaTalepleri?: unknown[];
  cekSayisi?: number;
  /** EBLG-63: beyannamesi gelmemiş ihraç kayıtlı faturaların tarihleri. */
  ihracKayitlilar?: { tarih: Date }[];
  kritikStok?: number;
  taslakSayim?: number;
  donemler?: unknown[];
  yukseltmeAdaylari?: { id: string }[];
  yoneticiler?: { id: string }[];
  mevcutTeslimatlar?: { userId: string }[];
  bekleyenIrsaliyeler?: { yon: string; tarih: Date; fiiliSevkZamani: Date | null }[];
  /** EBLG-91: alıcının RET ya da kısmi kabul verdiği e-İrsaliyeler. */
  eirsaliyeYanitlari?: unknown[];
  /** EBLG-96: yanıt bekleyen gelen e-İrsaliyeler. */
  gelenIrsaliyeler?: { id: string; belgeNo: string; gonderenUnvan: string; sevkTarihi: Date }[];
}

function servisKur(secenek: TxSecenekleri = {}) {
  const teslimatCreateMany = vi.fn();
  const bildirimUpdate = vi.fn();
  const tx = {
    duzeltmeKaydi: { findMany: vi.fn().mockResolvedValue(secenek.duzeltmeler ?? []) },
    ebelgeKayit: { findMany: vi.fn().mockResolvedValue(secenek.ebelgeler ?? []) },
    eirsaliyeKayit: { findMany: vi.fn().mockResolvedValue(secenek.eirsaliyeYanitlari ?? []) },
    gelenEirsaliye: { findMany: vi.fn().mockResolvedValue(secenek.gelenIrsaliyeler ?? []) },
    satinAlmaTalebi: { findMany: vi.fn().mockResolvedValue(secenek.satinAlmaTalepleri ?? []) },
    cekSenet: { count: vi.fn().mockResolvedValue(secenek.cekSayisi ?? 0) },
    fatura: { findMany: vi.fn().mockResolvedValue(secenek.ihracKayitlilar ?? []) },
    belge: { findMany: vi.fn().mockResolvedValue(secenek.bekleyenIrsaliyeler ?? []) },
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


  it("taze e-Belge hatasını sormaz, yerleşmişi ve reddi sorar (EBLG-46)", async () => {
    // Gönderim ilk denemede düşüp ikincide geçebilir; geri alınamayan e-posta
    // denemeler bitmeden gitmemeli. Ret alıcının nihai kararıdır, beklemez.
    const { servis, tx } = servisKur();

    await servis.tara();

    const kosul = tx.ebelgeKayit.findMany.mock.calls[0][0].where.OR;
    expect(kosul[0].durum).toBe("hata");
    expect(Date.now() - kosul[0].updatedAt.lte.getTime()).toBeGreaterThanOrEqual(HATA_YERLESME_MS);
    expect(kosul[1]).toEqual({ durum: "ret" });
    expect(JSON.stringify(kosul)).not.toContain('"in":["hata","ret"]');
  });

  it("alıcının RET ve kısmi kabul yanıtını irsaliye başına bildirir (EBLG-91)", async () => {
    const { servis, bildirimler, tx } = servisKur({
      eirsaliyeYanitlari: [
        { id: "k1", durum: "ret", hataMesaji: "Miktar yanlış", belgeId: "b1", belge: { no: "GBZ2026000800030", cari: { unvan: "Alıcı A.Ş." } } },
        { id: "k2", durum: "kismi_kabul", hataMesaji: null, belgeId: "b2", belge: { no: "GBZ2026000800031", cari: { unvan: "Alıcı A.Ş." } } },
      ],
    });

    await servis.tara();

    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({
      tur: "ebelge", onem: "kritik", birlesimAnahtari: "ebelge:irsaliye:k1", hedefYol: "/panel/belgeler?odak=b1",
      aciklama: expect.stringContaining("İrsaliyeyi programda iptal edip"),
    }));
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({
      onem: "uyari", birlesimAnahtari: "ebelge:irsaliye:k2", aciklama: expect.stringContaining("kabul ettiği miktarla"),
    }));
    // RET iptal edilince, kısmi kabul kesin faturaya bağlanınca tespit edilmez; bildirim kapanır.
    const kosul = JSON.stringify(tx.eirsaliyeKayit.findMany.mock.calls[0][0].where);
    expect(kosul).toContain('"durum":"ret","belge":{"durum":{"not":"iptal"}}');
    expect(kosul).toContain('"fatura":{"is":{"durum":{"not":"kesin"}}}');
  });

  it("yanıt süresi dolmak üzere olan gelen e-İrsaliyeyi son günle bildirir (EBLG-96)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00+03:00"));
    try {
      const { servis, bildirimler, tx } = servisKur({
        gelenIrsaliyeler: [
          { id: "g1", belgeNo: "TYH2026000000020", gonderenUnvan: "Tedarikçi A.Ş.", sevkTarihi: new Date("2026-09-18T00:00:00Z") },
          { id: "g2", belgeNo: "TYH2026000000021", gonderenUnvan: "Tedarikçi A.Ş.", sevkTarihi: new Date("2026-09-22T00:00:00Z") },
        ],
      });

      await servis.tara();

      const girdiler = bildirimler.uret.mock.calls.map(([g]) => g).filter((g) => g.birlesimAnahtari.startsWith("ebelge:gelen-irsaliye-yanit:"));
      expect(girdiler).toEqual([expect.objectContaining({
        onem: "uyari", birlesimAnahtari: "ebelge:gelen-irsaliye-yanit:g1", aciklama: expect.stringContaining("son gün 25.09.2026"),
        sonTarih: new Date("2026-09-25T23:59:59+03:00"),
      })]);
      // Yanıtlanan, kendi sevkimiz olan ve süresi dolmuş belge taranmaz.
      expect(tx.gelenEirsaliye.findMany.mock.calls[0][0].where).toMatchObject({ durum: "yeni", kendiSevkimiz: false, sevkTarihi: { gte: new Date("2026-09-17T00:00:00Z") } });
    } finally {
      vi.useRealTimers();
    }
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

describe("BildirimUreticiService — ihraç kayıtlı süresi (EBLG-63)", () => {
  it("süresi geçeni kritik, yaklaşanı uyarı olarak günlük özetle bildirir", async () => {
    const gunOnce = (gun: number) => { const t = new Date(); t.setUTCDate(t.getUTCDate() - gun); return t; };
    // Son tarih teslimi izleyen ay başı + 3 ay: 200 gün önceki teslimin süresi geçmiştir,
    // bugünkü teslimin süresi ise en az 3 ay sonradır.
    const { servis, bildirimler } = servisKur({ ihracKayitlilar: [{ tarih: gunOnce(200) }, { tarih: new Date() }] });

    await servis.tara();

    const uretilen = bildirimler.uret.mock.calls.map(([g]) => g as { birlesimAnahtari: string; onem: string; hedefYol: string });
    const gecen = uretilen.find((g) => g.birlesimAnahtari.startsWith("vade:ihrac-kayitli-gecen:"));
    expect(gecen?.onem).toBe("kritik");
    expect(gecen?.hedefYol).toBe("/panel/fatura?ihracKayitli=acik");
    expect(uretilen.some((g) => g.birlesimAnahtari.startsWith("vade:ihrac-kayitli-yaklasan:"))).toBe(false);
  });

  it("açık ihraç kayıtlı satış yoksa bildirim açmaz", async () => {
    const { servis, bildirimler } = servisKur();
    await servis.tara();
    expect(bildirimler.uret.mock.calls.some(([g]) => (g as { birlesimAnahtari: string }).birlesimAnahtari.includes("ihrac-kayitli"))).toBe(false);
  });
});

describe("BildirimUreticiService — irsaliye faturalama süresi (EBLG-82)", () => {
  const gunOnce = (gun: number) => new Date(Date.now() - gun * 86_400_000);
  const anahtarlar = (uret: { mock: { calls: unknown[][] } }) =>
    uret.mock.calls.map(([g]) => g as { birlesimAnahtari: string; onem: string; hedefYol: string });

  it("satışta süresi geçeni kritik, yaklaşanı uyarı; alışta geçeni uyarı olarak bildirir", async () => {
    const { servis, bildirimler } = servisKur({
      bekleyenIrsaliyeler: [
        { yon: "satis", tarih: gunOnce(10), fiiliSevkZamani: null },
        { yon: "satis", tarih: gunOnce(6), fiiliSevkZamani: null },
        { yon: "satis", tarih: gunOnce(1), fiiliSevkZamani: null },
        { yon: "alis", tarih: gunOnce(9), fiiliSevkZamani: null },
      ],
    });

    await servis.tara();

    const uretilen = anahtarlar(bildirimler.uret);
    const gecen = uretilen.find((g) => g.birlesimAnahtari.startsWith("vade:irsaliye-fatura-gecen:"));
    expect(gecen?.onem).toBe("kritik");
    expect(gecen?.hedefYol).toBe("/panel/belgeler?tur=irsaliye&yon=satis&faturaBekleyen=1");
    expect(uretilen.find((g) => g.birlesimAnahtari.startsWith("vade:irsaliye-fatura-yaklasan:"))?.onem).toBe("uyari");
    expect(uretilen.find((g) => g.birlesimAnahtari.startsWith("vade:irsaliye-fatura-alis:"))?.onem).toBe("uyari");
  });

  it("süresi içindeki alış irsaliyesi için hatırlatma açmaz", async () => {
    const { servis, bildirimler } = servisKur({ bekleyenIrsaliyeler: [{ yon: "alis", tarih: gunOnce(6), fiiliSevkZamani: null }] });
    await servis.tara();
    expect(anahtarlar(bildirimler.uret).some((g) => g.birlesimAnahtari.includes("irsaliye-fatura"))).toBe(false);
  });
});
