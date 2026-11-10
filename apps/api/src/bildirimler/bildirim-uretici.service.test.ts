import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import { HATA_YERLESME_MS } from "../ebelge/yerlesmis-hata";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }) }));
// EBLG-133: bağlantı ayarı testte düz JSON tutulur.
vi.mock("../core/kripto", () => ({ coz: (metin: string) => metin }));
const vergiOku = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ayar: null, satirlar: [] as unknown[] })) }));
vi.mock("../vergi-takvimi/vergi-takvimi.okuma", () => ({ vergiTakvimiOku: (...a: unknown[]) => vergiOku.fn(...a) }));
const vergiSatiri = (ek: Record<string, unknown>) => ({ yukumluluk: "kdv1", ad: "KDV-1", yil: 2026, ay: 8, sonTarih: "2026-11-28", oncekiSonTarih: null, hesaplanan: 1000, beyanTutari: null, beyanDevreden: null, beyanNotu: null, tutar: 1000, odenen: 0, kalan: 1000, durum: "bekliyor", donemSuruyor: false, uyarilar: [], devredenGiren: null, devredenCikan: null, odemeler: [], ...ek });
// Vade sayısı raporla aynı fonksiyondan gelir (vadesiGecenleriHesapla); testler onu rapor.vadesiGecenler üzerinden ayarlar.
const vadeHesap = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../rapor/rapor.service", () => ({ RaporService: class {}, vadesiGecenleriHesapla: (...a: unknown[]) => vadeHesap.fn(...a) }));

interface TxSecenekleri {
  /** EBLG-133: e-Belge bağlantılarının (düz JSON) ayarları. */
  ebelgeAyarlari?: Record<string, unknown>[];
  /** MVZ-17: dönemsel değer kayıtları; verilmezse içinde bulunulan dönemler kayıtlı sayılır. */
  mevzuatKayitlari?: { tur: string; anahtar: string; yururlukBaslangic: Date }[];
  aktifPersonel?: number;
  duzeltmeler?: unknown[];
  ebelgeler?: unknown[];
  satinAlmaTalepleri?: unknown[];
  personelBelgeleri?: unknown[];
  /** PRS-27: bildirgesi işaretlenmemiş istihdam dönemleri. */
  girisBildirgeleri?: unknown[];
  cikisBildirgeleri?: unknown[];
  izinTalepSayisi?: number;
  avansTalepSayisi?: number;
  onayBekleyenBordro?: number;
  cekSayisi?: number;
  kasaBankaAyarlari?: Record<string, unknown>;
  /** EBLG-63: beyannamesi gelmemiş ihraç kayıtlı faturaların tarihleri. */
  ihracKayitlilar?: { tarih: Date; tip: string }[];
  kritikStok?: number;
  /** KSB-31: bakiye mutabakatı için ekstre satırları ve sistem hareketleri. */
  ekstreSatirlari?: unknown[];
  bankaHareketleri?: unknown[];
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
  /** KSB-10: ekstresi hesaplanacak kredi kartları. */
  kartlar?: unknown[];
  /** KSB-15: çekimi sorunlu Vomsis bağlantıları ve hesap başına bekleyen ekstre satırı. */
  bankaBaglantilari?: unknown[];
  bekleyenEkstre?: { bankaHesapId: string; _count: { _all: number } }[];
  /** MVZ-07: son 30 günde yayınlanan mevzuat değişiklikleri (kiracısız tablo). */
  mevzuatDegisiklikleri?: unknown[];
}

/** Bugünün yılı ve yarıyılı için kayıtlı dönemsel değerler (eksik uyarısı üretmez). */
function guncelDonemKayitlari() {
  const bugun = new Date();
  const yil = bugun.getUTCFullYear(), yariBasi = bugun.getUTCMonth() < 6 ? `${yil}-01-01` : `${yil}-07-01`;
  return [
    { tur: "bordro_parametreleri", anahtar: "genel", yururlukBaslangic: new Date(`${yil}-01-01`) },
    { tur: "kanuni_deger", anahtar: "kidem_tavani", yururlukBaslangic: new Date(yariBasi) },
    { tur: "kanuni_deger", anahtar: "tevkifat_alt_siniri", yururlukBaslangic: new Date(`${yil}-01-01`) },
  ];
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
    krediKarti: { findMany: vi.fn().mockResolvedValue(secenek.kartlar ?? []) },
    epostaGonderim: { findMany: vi.fn().mockResolvedValue((secenek as { gonderimler?: unknown[] }).gonderimler ?? []), findFirst: vi.fn().mockResolvedValue((secenek as { tavanEposta?: unknown }).tavanEposta ?? null) },
    smsGonderim: { findFirst: vi.fn().mockResolvedValue(null) },
    baglantiOtomatikIsi: { findMany: vi.fn().mockResolvedValue((secenek as { pazaryeriIsleri?: unknown[] }).pazaryeriIsleri ?? []) },
    baglanti: { findMany: vi.fn(async ({ where }: { where: { aile: string } }) => (where.aile === "ebelge"
      ? (secenek.ebelgeAyarlari ?? []).map((ayar, i) => ({ id: `e${i + 1}`, sifreliConfig: JSON.stringify(ayar) }))
      : secenek.bankaBaglantilari ?? [])) },
    tenant: { findUnique: vi.fn().mockResolvedValue({ vkn: "1234567801" }) },
    bankaEkstreSatir: { groupBy: vi.fn().mockResolvedValue(secenek.bekleyenEkstre ?? []), findMany: vi.fn().mockResolvedValue(secenek.ekstreSatirlari ?? []) },
    kasaBankaHareket: { findMany: vi.fn().mockResolvedValue(secenek.bankaHareketleri ?? []) },
    bankaHesap: { findMany: vi.fn().mockResolvedValue([{ id: "h1", ad: "Ziraat TL", dovizCinsi: "TRY" }]) },
    bankaKrediTaksiti: { findMany: vi.fn().mockResolvedValue([]) },
    cariTeminat: { findMany: vi.fn().mockResolvedValue([]) },
    cariMutabakat: { findMany: vi.fn().mockResolvedValue([]) },
    personelBelgesi: { findMany: vi.fn().mockResolvedValue(secenek.personelBelgeleri ?? []) },
    personelIstihdamDonemi: { findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ("iseGirisBildirgeTarihi" in where ? secenek.girisBildirgeleri : secenek.cikisBildirgeleri) ?? []) },
    personelIzinTalebi: { count: vi.fn().mockResolvedValue(secenek.izinTalepSayisi ?? 0) },
    personelBilgiTalebi: { count: vi.fn(async () => 0) },
    personelAvans: { count: vi.fn().mockResolvedValue(secenek.avansTalepSayisi ?? 0) },
    personelBordro: { count: vi.fn().mockResolvedValue(secenek.onayBekleyenBordro ?? 0) },
    personel: { count: vi.fn().mockResolvedValue(secenek.aktifPersonel ?? 0) },
    personelTatilGunu: { findMany: vi.fn().mockResolvedValue([]) },
    fatura: { findMany: vi.fn().mockResolvedValue(secenek.ihracKayitlilar ?? []) },
    belge: { findMany: vi.fn().mockResolvedValue(secenek.bekleyenIrsaliyeler ?? []) },
    sayim: { count: vi.fn().mockResolvedValue(secenek.taslakSayim ?? 0) },
    maliDonem: { findMany: vi.fn().mockResolvedValue(secenek.donemler ?? []) },
    faturaKapama: { findMany: vi.fn().mockResolvedValue([]) },
    bildirim: { findMany: vi.fn().mockResolvedValue(secenek.yukseltmeAdaylari ?? []), update: bildirimUpdate },
    bildirimTeslimati: { findMany: vi.fn().mockResolvedValue(secenek.mevcutTeslimatlar ?? []), createMany: teslimatCreateMany },
    user: { findMany: vi.fn().mockResolvedValue(secenek.yoneticiler ?? []) },
    $queryRaw: vi.fn().mockResolvedValue([{ sayi: BigInt(secenek.kritikStok ?? 0) }]),
  };
  const prisma = {
    tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)),
    mevzuatDegisiklik: { findMany: vi.fn().mockResolvedValue(secenek.mevzuatDegisiklikleri ?? []) },
    mevzuatKayit: { findMany: vi.fn().mockResolvedValue(secenek.mevzuatKayitlari ?? guncelDonemKayitlari()), findFirst: vi.fn().mockResolvedValue(null) },
  } as never;
  const bildirimler = { uret: vi.fn().mockResolvedValue({ bildirimId: "b1", yeniTeslimat: 1 }), kapatEksikleri: vi.fn().mockResolvedValue(0), taramaEksikleriniKapat: vi.fn() };
  // Toplu kapatma tür tür kapatEksikleri çağrılarına açılır; testler türe göre doğrular.
  bildirimler.taramaEksikleriniKapat.mockImplementation(async (kapsamlar: { tur: string; acikAnahtarlar: string[]; onekler: string[] }[]) => {
    let n = 0; for (const k of kapsamlar) n += await bildirimler.kapatEksikleri(k.tur, k.acikAnahtarlar, k.onekler); return n;
  });
  const rapor = { vadesiGecenler: vi.fn().mockResolvedValue({ alacaklar: [], borclar: [], toplamAlacak: "0.00", toplamBorc: "0.00", alacakSayisi: 0, borcSayisi: 0 }) };
  vadeHesap.fn.mockImplementation((_tx: unknown, _tenantId: string, secenek: unknown) => { expect(secenek).toEqual({ yalnizOzet: true }); return rapor.vadesiGecenler(); });
  const ayarlar = { getir: vi.fn(async (modul: string) => modul === "kasaBanka" ? secenek.kasaBankaAyarlari ?? {} : {}) };
  return { servis: new BildirimUreticiService(prisma, bildirimler as never, rapor as never, ayarlar as never), bildirimler, rapor, tx, teslimatCreateMany, bildirimUpdate };
}

describe("kart ekstresi bildirimi (KSB-10)", () => {
  // Kesim 23, son ödeme 3: 23.09 ekstresinin son ödeme günü 5 Ekim (3 Ekim cumartesi).
  const kart = (odeme?: number) => ({
    id: "kk", ad: "Şirket kartı", sonDortHane: "1234", dovizCinsi: "TRY", limit: 50000, hesapKesimGunu: 23, sonOdemeGunu: 3, asgariOdemeOrani: null, aktif: true, ekstreler: [],
    hareketler: [
      { id: "h1", tip: "harcama", tarih: new Date("2026-09-10"), tutar: 1000, aciklama: "Yakıt", taksitSayisi: 1, geriAlinanHareketId: null, ekstreId: null, taksitler: [] },
      ...(odeme ? [{ id: "h2", tip: "odeme", tarih: new Date("2026-09-25"), tutar: odeme, aciklama: "Ödeme", taksitSayisi: 1, geriAlinanHareketId: null, ekstreId: null, taksitler: [] }] : []),
    ],
  });
  afterEach(() => vi.useRealTimers());

  it("son ödeme gününe 3 gün kala uyarır, asgari ödenmeden geçince kritik bildirir, ödenince üretmez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T09:00:00+03:00"));
    let { servis, bildirimler } = servisKur({ kartlar: [kart()] });
    await servis.tara();
    expect(bildirimler.uret.mock.calls.map(([g]) => g).find((g) => g.birlesimAnahtari.startsWith("vade:kart:"))).toMatchObject({
      onem: "uyari", birlesimAnahtari: "vade:kart:kk:2026-09-23:yaklasiyor", hedefYol: "/panel/kasa-banka/kredi-kartlari?kart=kk",
    });

    vi.setSystemTime(new Date("2026-10-07T09:00:00+03:00"));
    ({ servis, bildirimler } = servisKur({ kartlar: [kart(100)] }));
    await servis.tara();
    expect(bildirimler.uret.mock.calls.map(([g]) => g).find((g) => g.birlesimAnahtari.startsWith("vade:kart:"))).toMatchObject({ onem: "kritik", birlesimAnahtari: "vade:kart:kk:2026-09-23:gecikti" });

    ({ servis, bildirimler } = servisKur({ kartlar: [kart(1000)] }));
    await servis.tara();
    expect(bildirimler.uret.mock.calls.some(([g]) => g.birlesimAnahtari.startsWith("vade:kart:"))).toBe(false);
  });
});

describe("çek/senet kullanıcı ayarlı vade hatırlatması", () => {
  afterEach(() => vi.useRealTimers());
  it("seçili günü, vade gününü ve gecikeni ayrı tarar; İstanbul gece yarısını esas alır", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T22:00:00Z"));
    const { servis, tx, bildirimler } = servisKur({ cekSayisi: 2, kasaBankaAyarlari: { cekSenetHatirlatmaGun: 3, cekSenetVadeGunuHatirlat: true } });
    await servis.tara();
    const kosullar = tx.cekSenet.count.mock.calls.map(([g]) => g.where);
    expect(kosullar.map((k) => k.vadeTarihi)).toEqual([new Date("2026-10-18"), new Date("2026-10-15"), { lt: new Date("2026-10-15") }]);
    for (const k of kosullar) expect(k).toMatchObject({ tenantId: "t1", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "verildi"] } });
    const girdiler = bildirimler.uret.mock.calls.map(([g]) => g).filter((g) => g.tur === "cek_senet");
    expect(girdiler.map((g) => g.birlesimAnahtari)).toEqual(["cek_senet:2026-10-15:once:3", "cek_senet:2026-10-15:bugun", "cek_senet:2026-10-15:geciken"]);
    expect(girdiler[0].aciklama).toBe("2 evrakın vadesine 3 gün kaldı.");
  });
  it("ön hatırlatma ve vade günü ayrı ayrı kapatılır; geçmiş evrak uyarısı korunur", async () => {
    const { servis, tx, bildirimler } = servisKur({ cekSayisi: 1, kasaBankaAyarlari: { cekSenetHatirlatmaGun: 0, cekSenetVadeGunuHatirlat: false } });
    await servis.tara();
    expect(tx.cekSenet.count).toHaveBeenCalledTimes(1);
    const girdiler = bildirimler.uret.mock.calls.map(([g]) => g).filter((g) => g.tur === "cek_senet");
    expect(girdiler).toHaveLength(1); expect(girdiler[0].baslik).toBe("Vadesi geçmiş çek/senet");
  });
  it("aynı gün tekrar taramada aynı birleştirme anahtarı kullanılır", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const { servis, bildirimler } = servisKur({ cekSayisi: 1 });
    await servis.tara(); await servis.tara();
    const anahtarlar = bildirimler.uret.mock.calls.map(([g]) => g).filter((g) => g.tur === "cek_senet").map((g) => g.birlesimAnahtari);
    expect(anahtarlar.slice(0, 3)).toEqual(anahtarlar.slice(3));
  });
  it("vade günü kapalıyken ön hatırlatma çalışmaya devam eder", async () => {
    const { servis, tx, bildirimler } = servisKur({ cekSayisi: 1, kasaBankaAyarlari: { cekSenetHatirlatmaGun: 1, cekSenetVadeGunuHatirlat: false } });
    await servis.tara(); expect(tx.cekSenet.count).toHaveBeenCalledTimes(2);
    const anahtarlar = bildirimler.uret.mock.calls.map(([g]) => g).filter((g) => g.tur === "cek_senet").map((g) => g.birlesimAnahtari);
    expect(anahtarlar.some((a) => a.endsWith("once:1"))).toBe(true);
    expect(anahtarlar.some((a) => a.endsWith(":bugun"))).toBe(false);
  });
});

describe("mevzuat bildirimi (MVZ-07)", () => {
  it("yayınlanan değişikliği yönetici ve muhasebeye bir kez duyurur; daha önce duyurulanı yeniden açmaz", async () => {
    const degisiklik = (id: string) => ({ id, no: 3, baslik: "Tevkifat oranları", dayanak: "KDVGUT değişikliği", yururlukBaslangic: new Date("2026-11-01"), _count: { satirlar: 2 } });
    const { servis, bildirimler, tx } = servisKur({ mevzuatDegisiklikleri: [degisiklik("d1"), degisiklik("d2")] });
    tx.bildirim.findMany.mockImplementation(async ({ where }: { where: { birlesimAnahtari?: unknown } }) =>
      where.birlesimAnahtari ? [{ birlesimAnahtari: "mevzuat:degisiklik:d1" }] : []);

    await servis.tara();

    const mevzuat = bildirimler.uret.mock.calls.map(([g]) => g).filter((g: { tur: string }) => g.tur === "mevzuat");
    expect(mevzuat).toEqual([expect.objectContaining({
      birlesimAnahtari: "mevzuat:degisiklik:d2", onem: "bilgi", roller: ["yonetici", "muhasebe"],
      baslik: "Mevzuat güncellendi: Tevkifat oranları", hedefYol: "/panel/ayarlar/mevzuat?degisiklik=d2",
    })]);
    expect(mevzuat[0].aciklama).toContain("yürürlük 01.11.2026");
    // Duyuru taramada kapatılmaz; yalnız MVZ-17 yayın eksiği uyarıları kapanabilir.
    expect(bildirimler.kapatEksikleri.mock.calls.filter(([tur]) => tur === "mevzuat").map(([, , onekler]) => onekler)).toEqual([["mevzuat-eksik:"]]);
  });

  it("dönemi başlamış değer yayınlanmadıysa kritik uyarı; bordro uyarısı yalnız çalışanı olan firmaya (MVZ-17)", async () => {
    const eski = [
      { tur: "bordro_parametreleri", anahtar: "genel", yururlukBaslangic: new Date("2000-01-01") },
      { tur: "kanuni_deger", anahtar: "kidem_tavani", yururlukBaslangic: new Date("2000-01-01") },
      { tur: "kanuni_deger", anahtar: "tevkifat_alt_siniri", yururlukBaslangic: new Date("2000-01-01") },
    ];
    const anahtarlar = async (aktifPersonel: number) => {
      const { servis, bildirimler } = servisKur({ mevzuatKayitlari: eski, aktifPersonel });
      await servis.tara();
      return bildirimler.uret.mock.calls.map(([g]) => g).filter((g: { birlesimAnahtari: string }) => g.birlesimAnahtari.startsWith("mevzuat-eksik:"));
    };
    const calisansiz = await anahtarlar(0);
    expect(calisansiz.map((g: { birlesimAnahtari: string }) => g.birlesimAnahtari.split(":")[2])).toEqual(["kidem_tavani", "tevkifat_alt_siniri"]);
    expect(calisansiz[0]).toMatchObject({ onem: "kritik", roller: ["yonetici", "muhasebe"], hedefYol: "/panel/ayarlar/mevzuat" });
    expect((await anahtarlar(3)).some((g: { birlesimAnahtari: string }) => g.birlesimAnahtari.includes("bordro_parametreleri"))).toBe(true);
  });
});

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


  it("eski vergi listesiyle üretilmiş seçili firma tasarımını bildirir; güncel imzalıyı ve elle yüklenmişi bildirmez (EBLG-133)", async () => {
    const { vergiKodImzasi } = await import("../ebelge/firma-tasarimi/vergi-kodlari");
    const { VARSAYILAN_VERGI_TURLERI } = await import("@tekirextra/shared");
    const guncel = vergiKodImzasi(VARSAYILAN_VERGI_TURLERI);
    const { servis, bildirimler } = servisKur({
      ebelgeAyarlari: [{
        // e-Fatura: imzası farklı → eski; e-Arşiv: imza güncel
        efaturaTasarimi: "TX1234567801-EFATURA-v10", earsivTasarimi: "TX1234567801-EARSIV-v7",
        tasarimVergiImzalari: { "TX1234567801-EFATURA-v10": "stopaj=0003;dahil=0071", "TX1234567801-EARSIV-v7": guncel },
      }, {
        // Elle yüklenmiş tasarım denetlenmez; imzasız firma tasarımı ilk dolum listesiyle sayılır (güncel).
        efaturaTasarimi: "EMSA_EFATURA", earsivTasarimi: "TX1234567801-EARSIV-v6",
      }],
    });

    await servis.tara();

    const uretilen = bildirimler.uret.mock.calls.map((c) => c[0]).filter((g) => g.birlesimAnahtari.startsWith("tasarim-vergi:"));
    expect(uretilen.map((g) => g.birlesimAnahtari)).toEqual(["tasarim-vergi:e1:efatura"]);
    expect(uretilen[0]).toMatchObject({ tur: "ebelge", onem: "uyari", hedefYol: "/panel/ayarlar/entegratorler" });
    expect(bildirimler.kapatEksikleri).toHaveBeenCalledWith("ebelge", expect.arrayContaining(["tasarim-vergi:e1:efatura"]), expect.arrayContaining(["tasarim-vergi:"]));
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
    expect(cekGirdisi).toMatchObject({ onem: "uyari", birlesimAnahtari: expect.stringMatching(/^cek_senet:\d{4}-\d{2}-\d{2}:once:7$/) });
    expect(cekGirdisi.sonTarih).toBeUndefined();
  });

  it("vade özetini rapor motorundan alır — sayı zilde ve raporda aynı olmalıdır", async () => {
    const { servis, bildirimler, rapor } = servisKur();
    rapor.vadesiGecenler.mockResolvedValue({
      alacaklar: [{ faturaId: "f1" }, { faturaId: "f2" }],
      borclar: [{ faturaId: "f3" }],
      toplamAlacak: "18500.00",
      toplamBorc: "4200.00",
      // RPR-17: liste sınırlıdır; sayı bütün faturalardandır.
      alacakSayisi: 230,
      borcSayisi: 1,
    });

    await servis.tara();

    expect(bildirimler.uret).toHaveBeenCalledWith(
      expect.objectContaining({ tur: "vade", aciklama: "230 tahsil edilecek (18500.00 TL), 1 ödenecek (4200.00 TL) fatura vadesini geçti." }),
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
    const { servis, bildirimler } = servisKur({ ihracKayitlilar: [{ tarih: gunOnce(200), tip: "satis" }, { tarih: new Date(), tip: "satis" }] });

    await servis.tara();

    const uretilen = bildirimler.uret.mock.calls.map(([g]) => g as { birlesimAnahtari: string; onem: string; hedefYol: string });
    const gecen = uretilen.find((g) => g.birlesimAnahtari.startsWith("vade:ihrac-kayitli-gecen:"));
    expect(gecen?.onem).toBe("kritik");
    expect(gecen?.hedefYol).toBe("/panel/fatura?ihracKayitli=acik");
    expect(uretilen.some((g) => g.birlesimAnahtari.startsWith("vade:ihrac-kayitli-yaklasan:"))).toBe(false);
  });

  it("ihraç kayıtlı alışı satıştan ayrı bildirir; ihracatçı firmadır (EBLG-114)", async () => {
    const gunOnce = (gun: number) => { const t = new Date(); t.setUTCDate(t.getUTCDate() - gun); return t; };
    const { servis, bildirimler } = servisKur({ ihracKayitlilar: [{ tarih: gunOnce(200), tip: "alis" }] });

    await servis.tara();

    const uretilen = bildirimler.uret.mock.calls.map(([g]) => g as { birlesimAnahtari: string; baslik: string; hedefYol: string });
    const alis = uretilen.find((g) => g.birlesimAnahtari.startsWith("vade:ihrac-kayitli-alis-gecen:"));
    expect(alis?.baslik).toBe("İhraç kayıtlı alışta ihracat süresi doldu");
    expect(alis?.hedefYol).toBe("/panel/fatura?yon=alis&ihracKayitli=acik");
    expect(uretilen.some((g) => g.birlesimAnahtari.startsWith("vade:ihrac-kayitli-gecen:"))).toBe(false);
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

describe("banka entegrasyonu bildirimleri (KSB-15)", () => {
  it("3 ardışık hatayı uyarı, kimlik reddini kritik; bekleyen satırı hesap başına özet olarak bildirir", async () => {
    const { servis, bildirimler } = servisKur({
      bankaBaglantilari: [
        { id: "b1", ardisikHata: 3, sonSenkronHatasi: "Vomsis hareketleri alınamadı: timeout", otomatikDurduNedeni: null },
        { id: "b2", ardisikHata: 1, sonSenkronHatasi: "x", otomatikDurduNedeni: "Vomsis kimlik doğrulaması reddedildi: invalid app key" },
      ],
      bekleyenEkstre: [{ bankaHesapId: "h1", _count: { _all: 7 } }],
    });
    await servis.tara();
    const uretilen = bildirimler.uret.mock.calls.map(([g]) => g);
    expect(uretilen.find((g) => g.birlesimAnahtari === "banka-senkron:b1")).toMatchObject({ tur: "entegrasyon", onem: "uyari" });
    expect(uretilen.find((g) => g.birlesimAnahtari === "banka-senkron:b2")).toMatchObject({ onem: "kritik" });
    expect(uretilen.find((g) => g.birlesimAnahtari === "ekstre-bekleyen:h1")).toMatchObject({ onem: "bilgi", aciklama: "Ziraat TL: 7 ekstre satırı eşleştirme bekliyor." });
    const entegrasyon = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "entegrasyon")!;
    expect(entegrasyon[2]).toEqual(expect.arrayContaining(["banka-senkron:", "ekstre-bekleyen:"]));
  });
});

describe("İK bildirimleri (PRS-15)", () => {
  afterEach(() => vi.useRealTimers());
  it("özlük belgesi süresi kayıt başına; onay bekleyenler tek özet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-04T09:00:00+03:00"));
    const kisi = { id: "p1", personelNo: "PRS-1", ad: "Ali", soyad: "Veli" };
    const { servis, bildirimler } = servisKur({
      personelBelgeleri: [
        { id: "b1", tur: "saglik_raporu", gecerlilikTarihi: new Date("2026-10-20T00:00:00Z"), personel: kisi },
        { id: "b2", tur: "is_sozlesmesi", gecerlilikTarihi: new Date("2026-09-30T00:00:00Z"), personel: kisi },
      ],
      izinTalepSayisi: 2, onayBekleyenBordro: 3,
    });
    await servis.tara();
    const uretilen = bildirimler.uret.mock.calls.map((c) => c[0]).filter((g: { tur: string }) => g.tur === "personel");
    expect(uretilen.map((g: { birlesimAnahtari: string; onem: string }) => [g.birlesimAnahtari, g.onem])).toEqual([
      ["personel:belge:b1:yaklasiyor", "uyari"],
      ["personel:belge:b2:doldu", "kritik"],
      ["personel:onay_bekleyen", "bilgi"],
    ]);
    expect(uretilen[2].aciklama).toContain("2 izin talebi, 3 bordro onay bekliyor");
    expect(bildirimler.kapatEksikleri).toHaveBeenCalledWith("personel", expect.arrayContaining(["personel:onay_bekleyen"]), ["personel:"]);
  });
});

describe("SGK bildirge süreleri (PRS-27)", () => {
  afterEach(() => vi.useRealTimers());
  it("işe giriş son günü başlangıçtan bir gün önce, çıkış 10 gün sonra; kayıt başına, gecikince kritik", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T09:00:00+03:00"));
    const kisi = { id: "p1", personelNo: "PRS-1", ad: "Ali", soyad: "Veli" };
    const { servis, bildirimler, tx } = servisKur({
      girisBildirgeleri: [
        { id: "i1", baslangicTarihi: new Date("2026-10-20T00:00:00Z"), personel: kisi },
        { id: "i2", baslangicTarihi: new Date("2026-10-01T00:00:00Z"), personel: kisi },
      ],
      cikisBildirgeleri: [{ id: "i3", baslangicTarihi: new Date("2026-01-01T00:00:00Z"), bitisTarihi: new Date("2026-10-01T00:00:00Z"), personel: kisi }],
    });
    await servis.tara();
    const uretilen = bildirimler.uret.mock.calls.map((c) => c[0]).filter((g: { birlesimAnahtari: string }) => g.birlesimAnahtari.startsWith("personel:sgk-"));
    expect(uretilen.map((g: { birlesimAnahtari: string; onem: string; sonTarih?: Date }) => [g.birlesimAnahtari, g.onem, g.sonTarih?.toISOString() ?? null])).toEqual([
      ["personel:sgk-giris:i1:bekliyor", "uyari", "2026-10-19T20:59:59.000Z"],
      ["personel:sgk-giris:i2:gecikti", "kritik", null],
      ["personel:sgk-cikis:i3:bekliyor", "uyari", "2026-10-11T20:59:59.000Z"],
    ]);
    expect(uretilen[0].aciklama).toContain("son günü 19.10.2026");
    expect(uretilen[0].roller).toEqual(["yonetici", "muhasebe", "ik"]);
    // 30 günden eski gecikmeler sorgu sınırında elenir.
    const sorgular = tx.personelIstihdamDonemi.findMany.mock.calls.map(([a]: [{ where: Record<string, { gte?: Date }> }]) => a.where);
    expect(sorgular[0].baslangicTarihi.gte?.toISOString().slice(0, 10)).toBe("2026-09-09");
    expect(sorgular[1].bitisTarihi.gte?.toISOString().slice(0, 10)).toBe("2026-08-29");
  });
});

describe("banka bakiye farkı bildirimi (KSB-31)", () => {
  const D = (v: number) => new Prisma.Decimal(v);
  it("banka bakiyesi sistemle tutmuyorsa hesap başına uyarır; bekleyen satırla açıklanan farkı saymaz", async () => {
    const { servis, bildirimler } = servisKur({
      // Banka: 1.000 giriş + 500 giriş (bekliyor) → gün sonu 1.500. Sistem: yalnız 800 tahsilat.
      ekstreSatirlari: [
        { tarih: new Date("2026-10-23T00:00:00Z"), tutar: D(1000), bakiye: D(1000), durum: "eslesti" },
        { tarih: new Date("2026-10-23T00:00:00Z"), tutar: D(500), bakiye: D(1500), durum: "beklemede" },
      ],
      bankaHareketleri: [{ tarih: new Date("2026-10-23T00:00:00Z"), tip: "tahsilat", tutar: D(800) }],
    });
    await servis.tara();
    const uyari = bildirimler.uret.mock.calls.map(([g]) => g).find((g) => g.birlesimAnahtari === "banka-bakiye-farki:h1");
    expect(uyari).toMatchObject({ tur: "entegrasyon", onem: "uyari", baslik: "Banka bakiyesi sistemle tutmuyor" });
    // Fark 700; 500'ü bekleyen satırla açıklanır, açıklanamayan 200.
    expect(uyari.aciklama).toContain("açıklanamayan fark 200,00 TRY");
    const entegrasyon = bildirimler.kapatEksikleri.mock.calls.find(([tur]) => tur === "entegrasyon")!;
    expect(entegrasyon[2]).toEqual(expect.arrayContaining(["banka-bakiye-farki:"]));
  });

  it("bakiye tutuyorsa (ya da fark bekleyen satırlarla açıklanıyorsa) uyarmaz", async () => {
    const { servis, bildirimler } = servisKur({
      ekstreSatirlari: [{ tarih: new Date("2026-10-23T00:00:00Z"), tutar: D(1000), bakiye: D(1000), durum: "beklemede" }],
      bankaHareketleri: [],
    });
    await servis.tara();
    expect(bildirimler.uret.mock.calls.some(([g]) => g.birlesimAnahtari.startsWith("banka-bakiye-farki:"))).toBe(false);
  });
});

describe("BLD-11 tarama tek işlemde", () => {
  it("14 dedektör tek okuma işleminde çalışır; yalnız yükseltme ayrı işlem açar", async () => {
    const { servis } = servisKur();
    const prisma = (servis as unknown as { prisma: { tenantIslem: ReturnType<typeof vi.fn> } }).prisma;
    prisma.tenantIslem.mockClear();
    await servis.tara();
    // 1: dedektörlerin ortak işlemi, 1: yükseltme (yazma).
    expect(prisma.tenantIslem).toHaveBeenCalledTimes(2);
    expect(prisma.tenantIslem.mock.calls[0][2]).toEqual({ timeout: 60_000 });
  });
});

describe("BildirimUreticiService — vergi takvimi (VTK-12)", () => {
  afterEach(() => { vi.useRealTimers(); vergiOku.fn.mockReset(); vergiOku.fn.mockResolvedValue({ ayar: null, satirlar: [] }); });
  const tara = async (bugun: string, satir: Record<string, unknown>) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(`${bugun}T09:00:00Z`));
    vergiOku.fn.mockResolvedValue({ ayar: {}, satirlar: [vergiSatiri(satir)] });
    const { servis } = servisKur() as unknown as { servis: { vergiTakvimi(): Promise<{ onem: string; birlesimAnahtari: string; tur: string }[]> } };
    return servis.vergiTakvimi();
  };
  it("yediden uzakta uyarmaz; 7 ve 2 gün eşikleri ayrı anahtardır", async () => {
    expect(await tara("2026-11-20", {})).toHaveLength(0);
    expect((await tara("2026-11-21", {}))[0]).toMatchObject({ tur: "donem", onem: "uyari", birlesimAnahtari: "vergi-takvimi:kdv1:2026-8:2026-11-28:7" });
    expect((await tara("2026-11-26", {}))[0]?.birlesimAnahtari).toBe("vergi-takvimi:kdv1:2026-8:2026-11-28:2");
  });
  it("gecikince kritik; takip başlamamış geçmiş kalem bildirim üretmez", async () => {
    expect((await tara("2026-12-01", { durum: "gecikti" }))[0]).toMatchObject({ onem: "kritik", birlesimAnahtari: "vergi-takvimi:kdv1:2026-8:2026-11-28:gecikti" });
    expect(await tara("2026-12-01", { durum: "bekliyor" })).toHaveLength(0);
  });
  it("uzatmada anahtar yeni tarihe kurulur; kalanı olmayan ve tarihsiz kalem üretmez", async () => {
    expect((await tara("2026-12-03", { sonTarih: "2026-12-05" }))[0]?.birlesimAnahtari).toContain(":2026-12-05:2");
    expect(await tara("2026-11-27", { kalan: 0, durum: "odendi" })).toHaveLength(0);
    expect(await tara("2026-11-27", { sonTarih: null })).toHaveLength(0);
  });
});

describe("BildirimUreticiService — firma SMTP uyarısı (ILT-15)", () => {
  it("tavana takılan kanal için yöneticiye uyarı üretir, kayıt yoksa üretmez (ILT-14)", async () => {
    const tavan = (tavanEposta: unknown) => (servisKur({ tavanEposta } as never) as unknown as { servis: { iletiTavanUyarilari(): Promise<{ birlesimAnahtari: string; aciklama: string }[]> } }).servis.iletiTavanUyarilari();
    expect(await tavan(null)).toEqual([]);
    expect((await tavan({ hataMesaji: "Günlük e-posta tavanı doldu" }))[0]).toMatchObject({ birlesimAnahtari: "ileti-tavan:eposta" });
  });
  const tara = (gonderimler: unknown[]) => (servisKur({ gonderimler } as never) as unknown as { servis: { epostaSmtpHatalari(): Promise<{ birlesimAnahtari: string; aciklama: string }[]> } }).servis.epostaSmtpHatalari();
  const kotu = { durum: "basarisiz", hataMesaji: "Invalid login" };
  it("son üç gönderim de başarısızsa uyarır", async () => {
    expect((await tara([kotu, kotu, kotu]))[0]).toMatchObject({ birlesimAnahtari: "eposta-smtp:firma" });
    expect((await tara([kotu, kotu, kotu]))[0]?.aciklama).toContain("Invalid login");
  });
  it("üçten azsa ya da arada başarılı varsa uyarmaz", async () => {
    expect(await tara([kotu, kotu])).toHaveLength(0);
    expect(await tara([{ durum: "gonderildi", hataMesaji: null }, kotu, kotu])).toHaveLength(0);
  });
});
