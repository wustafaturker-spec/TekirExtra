import { Injectable, Optional } from "@nestjs/common";
import type { BildirimTuru, DuzeltmeTuru } from "@prisma/client";
import { bugunTR, DONEMSEL_DEGERLER, yayinTakvimi, EIRSALIYE_YANIT_GUN_SAYISI, MUHTELIF_MUSTERI_VKN, eirsaliyeYanitSuresi, gunEkleTR, IHRAC_KAYITLI_UYARI_GUNU, IRSALIYE_FATURA_GUN_SAYISI, irsaliyeFaturaSuresi, irsaliyeSevkGunu, type Rol, ihracKayitliSonTarih } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { ENTEGRATOR_IPTAL_ANAHTAR_ONEKI, entegratorIptalBildirimi } from "../ebelge/entegrator-iptal-bildirimi";
import { yerlesmisHataKosulu } from "../ebelge/yerlesmis-hata";
import { VARSAYILAN_ONAY_ESIGI, onaylayabilecekRoller } from "../satin-alma/satin-alma.hesap";
import { RaporService } from "../rapor/rapor.service";
import { ekstreOzeti } from "../kasa-banka/kart-ekstre";
import { kartEkstreleriniOku } from "../kasa-banka/kart-ekstre-oku";
import { BildirimService, type BildirimGirdisi } from "./bildirim.service";
import { TEMINAT_TURU_ADLARI, TEMINAT_UYARI_GUNU, type TeminatTuru } from "../cari/cari-teminat";
import { bakiyeFarklari, mutabakatItirazBildirimi, type DovizBakiyesi } from "../cari/cari-mutabakat";
import { iseGirisSonTarihi, istenCikisSonTarihi } from "../personel/sgk-kodlari";
import { kanuniDegerOku } from "../mevzuat/kanuni-deger";
import { MevzuatService } from "../mevzuat/mevzuat.service";
import { coz } from "../core/kripto";
import { belgeKodTablosu } from "../fatura/tevkifat-tablosu";
import { tasarimVergiKodlariEski, vergiKodImzasi, VERGILI_TASARIM_TURLERI } from "../ebelge/firma-tasarimi/vergi-kodlari";
import { TASARIM_ALANI } from "../tenant/belge-tasarimlari.service";
import type { EntegratorConfig } from "@tekirextra/baglanti";

const gunEkle = (t: Date, gun: number) => new Date(t.getTime() + gun * 86_400_000);

const KRITIK_SLA_SAATI = 24;
/** KSB-10: kart ekstresinin son ödeme gününe bu kadar gün kala hatırlatılır. */
const KART_UYARI_GUNU = 3;

/** Türe göre hedef roller — bildirim, işi yapan rolün önüne düşmelidir. */
const HEDEF_ROLLER: Record<BildirimTuru, Rol[]> = {
  duzeltme: ["yonetici", "muhasebe"],
  ebelge: ["yonetici", "muhasebe"],
  vade: ["yonetici", "muhasebe"],
  cek_senet: ["yonetici", "muhasebe"],
  stok: ["yonetici", "depo"],
  donem: ["yonetici", "muhasebe"],
  entegrasyon: ["yonetici", "muhasebe"],
  satin_alma: ["yonetici", "muhasebe"],
  personel: ["yonetici", "muhasebe", "ik"],
  mevzuat: ["yonetici", "muhasebe"],
  // AI-04: onay talebi yalnız isteyen kullanıcıya düşer (kullaniciIdler).
  yapay_zeka: [],
};

/**
 * Düzeltme türünü bildirim türüne çevirir: dış sistemden gelen istisnalar
 * kullanıcı için "entegrasyon sorunu", kendi kayıtlarımızdakiler "düzeltme".
 */
const DUZELTME_TUR_ESLEMESI: Record<DuzeltmeTuru, BildirimTuru> = {
  banka_ekstre: "entegrasyon",
  kredi_karti: "entegrasyon",
  pos: "entegrasyon",
  masraf: "duzeltme",
  ebelge: "ebelge",
  stok: "stok",
  cek_senet: "cek_senet",
  fatura_cari: "duzeltme",
  satin_alma: "satin_alma",
};

/**
 * Taramanın her türde ürettiği anahtar önekleri. Kapatma yalnız bunlarla
 * sınırlıdır: aynı türde olay anında üretilen bildirimler (alıcı reddi
 * `ebelge-ret:`, raporlanmış iptal `earsiv-iptal-raporlu:`, kira kuru
 * `kira-kur-eksik:`) taramada bulunmadığı için her turda kapanıyordu.
 * Düzeltme kayıtları eşlemeye göre birçok türe düşer, `duzeltme:` her türdedir.
 */
const TARAMA_ONEKLERI: Record<BildirimTuru, string[]> = {
  duzeltme: ["duzeltme:"],
  ebelge: ["duzeltme:", "ebelge:", ENTEGRATOR_IPTAL_ANAHTAR_ONEKI, "tasarim-vergi:"],
  vade: ["duzeltme:", "vade:"],
  cek_senet: ["duzeltme:", "cek_senet:"],
  stok: ["duzeltme:", "stok_kritik:", "stok_sayim:"],
  donem: ["duzeltme:", "donem:"],
  entegrasyon: ["duzeltme:", "banka-senkron:", "ekstre-bekleyen:"],
  satin_alma: ["duzeltme:", "satin_alma:"],
  personel: ["personel:"],
  // MVZ-07: duyurular ("mevzuat:") taramada kapatılmaz; MVZ-17 yayın eksiği uyarısı ("mevzuat-eksik:") yayınlanınca kapanır.
  mevzuat: ["mevzuat-eksik:"],
  // AI-04: talep bildirimleri taramada değil, talep karara bağlanınca kapanır.
  yapay_zeka: [],
};

function gunAnahtari(tarih = new Date()): string {
  return tarih.toISOString().slice(0, 10);
}

/**
 * Kaynak modülleri tarayıp bildirim üretir (BLD-08).
 *
 * İki desen vardır. **Kayıt bazlı** olaylar (kritik düzeltme, hatalı e-belge,
 * kapanmayan dönem) sahiplenilmesi gereken tekil istisnalardır; her kayıt kendi
 * bildirimini alır. **Toplu** olaylar (vadesi geçen faturalar, kritik stok)
 * yüzlerce satır üretebileceği için günlük özet olarak bildirilir; kullanıcı
 * bağlantıdan filtrelenmiş listeye gider. Aksi hâlde ilk tarama zilin altına
 * yüzlerce kayıt boşaltır ve bildirim merkezi ilk günde okunmaz hâle gelirdi.
 */
@Injectable()
export class BildirimUreticiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bildirimler: BildirimService,
    private readonly rapor: RaporService,
    private readonly ayarlar?: AyarlarService,
    @Optional() private readonly mevzuat?: MevzuatService,
  ) {}

  async tara(): Promise<{ uretilen: number; yeniTeslimat: number; kapanan: number; yukseltilen: number }> {
    const girdiler = [
      ...(await this.duzeltmeKayitlari()),
      ...(await this.ebelgeHatalari()),
      ...(await this.tasarimVergiKodlari()),
      ...(await this.eirsaliyeYanitlari()),
      ...(await this.gelenEirsaliyeYanitSureleri()),
      ...(await this.vadeOzetleri()),
      ...(await this.stokOzetleri()),
      ...(await this.donemKontrolleri()),
      ...(await this.satinAlmaOnaylari()),
      ...(await this.bankaEntegrasyonu()),
      ...(await this.personelBildirimleri()),
      ...(await this.mevzuatDegisiklikleri()),
      ...(await this.mevzuatYayinEksikleri()),
    ];

    let yeniTeslimat = 0;
    for (const girdi of girdiler) yeniTeslimat += (await this.bildirimler.uret(girdi)).yeniTeslimat;

    // Yalnız bu taramada gerçekten bakılan türler kapatılır; bakılmayan bir
    // türün kayıtları "artık tespit edilmiyor" sanılıp kapanmamalıdır.
    const taranan: BildirimTuru[] = ["duzeltme", "ebelge", "vade", "cek_senet", "stok", "donem", "entegrasyon", "satin_alma", "personel", "mevzuat"];
    let kapanan = 0;
    for (const tur of taranan) {
      const anahtarlar = girdiler.filter((g) => g.tur === tur).map((g) => g.birlesimAnahtari);
      kapanan += await this.bildirimler.kapatEksikleri(tur, anahtarlar, TARAMA_ONEKLERI[tur]);
    }

    return { uretilen: girdiler.length, yeniTeslimat, kapanan, yukseltilen: await this.yukselt() };
  }

  /**
   * PRS-15 (P2-2): İK bildirimleri.
   * - Özlük belgesi (kayıt başına): geçerlilik sonuna 30 gün kala uyarı, geçince
   *   kritik. Belge yenilenince (tarih ileri alınınca) ya da silinince kapanır.
   *   İşten ayrılan personelin belgeleri sorulmaz.
   * - Onay bekleyen işler (günlük özet, tek anahtar): izin, avans ve bordro
   *   onayları; hepsi işlenince kapanır.
   */
  private async personelBildirimleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const sinir = new Date(`${bugun}T00:00:00.000Z`);
    sinir.setUTCDate(sinir.getUTCDate() + 30);
    // PRS-27: son tarihi 30 günden eski gecikmiş bildirge bildirim üretmez (ekranda "gecikti" kalır).
    const gecikmeSiniri = new Date(`${bugun}T00:00:00.000Z`);
    gecikmeSiniri.setUTCDate(gecikmeSiniri.getUTCDate() - 30);
    const [belgeler, izin, avans, bilgi, bordro, girisler, cikislar] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.personelBelgesi.findMany({
        where: { gecerlilikTarihi: { not: null, lte: sinir }, personel: { durum: { not: "isten_ayrildi" } } },
        include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } },
        orderBy: { gecerlilikTarihi: "asc" }, take: 100,
      }),
      tx.personelIzinTalebi.count({ where: { durum: "talep" } }),
      tx.personelAvans.count({ where: { durum: "talep" } }),
      tx.personelBilgiTalebi.count({ where: { durum: "bekliyor" } }),
      tx.personelBordro.count({ where: { durum: "onay_bekliyor" } }),
      tx.personelIstihdamDonemi.findMany({
        where: { iseGirisBildirgeTarihi: null, baslangicTarihi: { gte: gunEkle(gecikmeSiniri, 1) }, personel: { durum: { not: "taslak" } } },
        include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } }, orderBy: { baslangicTarihi: "asc" }, take: 100,
      }),
      tx.personelIstihdamDonemi.findMany({
        where: { istenCikisBildirgeTarihi: null, bitisTarihi: { not: null, gte: gunEkle(gecikmeSiniri, -10) }, personel: { durum: { not: "taslak" } } },
        include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } }, orderBy: { bitisTarihi: "asc" }, take: 100,
      }),
    ]));
    const BELGE_ADI: Record<string, string> = { kimlik: "Kimlik", is_sozlesmesi: "İş sözleşmesi", diploma: "Diploma", sertifika: "Sertifika", saglik_raporu: "Sağlık raporu", adli_sicil: "Adli sicil kaydı", ikametgah: "İkametgâh", askerlik: "Askerlik belgesi", sgk_bildirgesi: "SGK bildirgesi", diger: "Belge" };
    const girdiler: BildirimGirdisi[] = belgeler.map((b) => {
      const bitis = b.gecerlilikTarihi!.toISOString().slice(0, 10);
      const doldu = bitis < bugun;
      const kalan = Math.round((Date.parse(bitis) - Date.parse(bugun)) / 86_400_000);
      return {
        tur: "personel", onem: doldu ? "kritik" : "uyari",
        baslik: doldu ? "Özlük belgesinin süresi doldu" : "Özlük belgesinin süresi doluyor",
        aciklama: `${b.personel.ad} ${b.personel.soyad} (${b.personel.personelNo}) — ${BELGE_ADI[b.tur] ?? "Belge"}: geçerlilik ${bitis.split("-").reverse().join(".")}${doldu ? "; yenisini alıp yükleyin" : kalan === 0 ? " (bugün)" : ` (${kalan} gün kaldı)`}.`,
        birlesimAnahtari: `personel:belge:${b.id}:${doldu ? "doldu" : "yaklasiyor"}`,
        kaynakTur: "personel_belgesi", kaynakRef: b.id, hedefYol: `/panel/personel/${b.personel.id}`,
        roller: HEDEF_ROLLER.personel,
        ...(doldu ? {} : { sonTarih: new Date(`${bitis}T23:59:59+03:00`) }),
      };
    });
    const bildirge = (tur: "giris" | "cikis", d: (typeof girisler)[number]): BildirimGirdisi => {
      const son = (tur === "giris" ? iseGirisSonTarihi(d.baslangicTarihi) : istenCikisSonTarihi(d.bitisTarihi!)).toISOString().slice(0, 10);
      const gecikti = son < bugun;
      const ad = tur === "giris" ? "İşe giriş" : "İşten çıkış";
      const tarih = (tur === "giris" ? d.baslangicTarihi : d.bitisTarihi!).toISOString().slice(0, 10).split("-").reverse().join(".");
      return {
        tur: "personel", onem: gecikti ? "kritik" : "uyari",
        baslik: gecikti ? `${ad} bildirgesi gecikti` : `${ad} bildirgesi verilmeli`,
        aciklama: `${d.personel.ad} ${d.personel.soyad} (${d.personel.personelNo}) — ${tur === "giris" ? "işe giriş" : "çıkış"} ${tarih}; SGK bildirgesinin son günü ${son.split("-").reverse().join(".")}. Verildiyse SGK ekranından işaretleyin.`,
        birlesimAnahtari: `personel:sgk-${tur}:${d.id}:${gecikti ? "gecikti" : "bekliyor"}`,
        kaynakTur: "personel_istihdam", kaynakRef: d.id, hedefYol: `/panel/personel/sgk?sekme=${tur}`,
        roller: HEDEF_ROLLER.personel,
        ...(gecikti ? {} : { sonTarih: new Date(`${son}T23:59:59+03:00`) }),
      };
    };
    girdiler.push(...girisler.map((d) => bildirge("giris", d)), ...cikislar.map((d) => bildirge("cikis", d)));
    const parcalar = [izin && `${izin} izin talebi`, avans && `${avans} avans talebi`, bilgi && `${bilgi} bilgi güncelleme talebi`, bordro && `${bordro} bordro`].filter(Boolean);
    if (parcalar.length) {
      girdiler.push({
        tur: "personel", onem: "bilgi",
        baslik: "Onay bekleyen İK işlemleri",
        aciklama: `${parcalar.join(", ")} onay bekliyor. Hazırlayan kişi kendi kaydını onaylayamaz; başka bir yetkili onaylamalı.`,
        birlesimAnahtari: "personel:onay_bekleyen",
        kaynakTur: "personel", hedefYol: bordro ? "/panel/personel/bordrolar" : izin ? "/panel/personel/izinler" : avans ? "/panel/personel/avanslar" : "/panel/personel/bilgi-talepleri",
        roller: HEDEF_ROLLER.personel,
      });
    }
    return girdiler;
  }

  /**
   * Son tarihi geçmiş kritik bildirimi kimse sahiplenmediyse yöneticiye taşır
   * (BLD-05). Yükseltme bir kez yapılır; `yukseltildiAt` bunu işaretler.
   */
  private async yukselt(): Promise<number> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const adaylar = await tx.bildirim.findMany({
        where: {
          onem: "kritik",
          kapandiAt: null,
          yukseltildiAt: null,
          sonTarih: { lt: new Date() },
          teslimatlar: { none: { durum: { in: ["ustlenildi", "aksiyon_alindi", "yoksayildi"] } } },
        },
        select: { id: true },
      });
      if (!adaylar.length) return 0;

      const yoneticiler = await tx.user.findMany({ where: { rol: "yonetici", aktif: true }, select: { id: true } });
      for (const bildirim of adaylar) {
        const mevcut = await tx.bildirimTeslimati.findMany({ where: { bildirimId: bildirim.id }, select: { userId: true } });
        const teslimEdilen = new Set(mevcut.map((t) => t.userId));
        const eksikler = yoneticiler.filter((y) => !teslimEdilen.has(y.id));
        if (eksikler.length) {
          await tx.bildirimTeslimati.createMany({
            data: eksikler.map((y) => ({ tenantId, bildirimId: bildirim.id, userId: y.id })),
          });
        }
        await tx.bildirim.update({ where: { id: bildirim.id }, data: { yukseltildiAt: new Date() } });
      }
      return adaylar.length;
    });
  }

  private sla(onem: BildirimGirdisi["onem"]): Date | undefined {
    if (onem !== "kritik") return undefined;
    const sonTarih = new Date();
    sonTarih.setHours(sonTarih.getHours() + KRITIK_SLA_SAATI);
    return sonTarih;
  }

  /**
   * SAT-07: onay bekleyen her satın alma talebi, tutarına göre onaylayabilecek
   * rollere bildirilir; karara bağlanınca ya da geri çekilince tespit edilmez ve
   * bildirim kapanır.
   */
  /**
   * MVZ-07: platform ekibinin son 30 günde yayınladığı mevzuat değişiklikleri.
   * Her değişiklik kiracıya bir kez duyurulur: daha önce üretilmiş (kapatılmış
   * olsa bile) bildirim yeniden açılmaz.
   */
  private async mevzuatDegisiklikleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const degisiklikler = await this.prisma.mevzuatDegisiklik.findMany({
      where: { durum: "yayinlandi", yayinZamani: { gte: gunEkle(new Date(), -30) } },
      select: { id: true, no: true, baslik: true, dayanak: true, yururlukBaslangic: true, _count: { select: { satirlar: true } } },
      orderBy: { yayinZamani: "asc" },
    });
    if (!degisiklikler.length) return [];
    const anahtar = (id: string) => `mevzuat:degisiklik:${id}`;
    const mevcut = new Set((await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bildirim.findMany({ where: { birlesimAnahtari: { in: degisiklikler.map((d) => anahtar(d.id)) } }, select: { birlesimAnahtari: true } }),
    )).map((b) => b.birlesimAnahtari));
    return degisiklikler.filter((d) => !mevcut.has(anahtar(d.id))).map((d) => ({
      tur: "mevzuat" as const,
      onem: "bilgi" as const,
      baslik: `Mevzuat güncellendi: ${d.baslik}`,
      aciklama: `${d._count.satirlar} kalem · yürürlük ${d.yururlukBaslangic.toLocaleDateString("tr-TR", { timeZone: "UTC" })} · dayanak: ${d.dayanak}`,
      birlesimAnahtari: anahtar(d.id),
      kaynakTur: "mevzuat_degisiklik",
      kaynakRef: d.id,
      hedefYol: `/panel/ayarlar/mevzuat?degisiklik=${d.id}`,
      roller: HEDEF_ROLLER.mevzuat,
    }));
  }

  /**
   * MVZ-17: dönemi başladığı hâlde Mevzuat Merkezi'nde yeni dönem kaydı
   * yayınlanmamış değer (2027 bordro parametreleri, kıdem tavanı…). Kiracı
   * düzeltemez; ilgili hesabın neden yapılamadığını önceden söyler. Bordro
   * uyarısı yalnız çalışanı olan firmaya gider. Kayıt yayınlanınca kapanır.
   */
  private async mevzuatYayinEksikleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.mevzuatKayit.findMany({
      where: { OR: DONEMSEL_DEGERLER.map((d) => ({ tur: d.tur, anahtar: d.anahtar })) },
      select: { tur: true, anahtar: true, yururlukBaslangic: true },
    });
    const eksikler = yayinTakvimi(kayitlar.map((k) => ({ ...k, yururlukBaslangic: k.yururlukBaslangic.toISOString().slice(0, 10) })), bugunTR())
      .filter((s) => s.durum === "eksik");
    if (!eksikler.length) return [];
    const calisanVar = eksikler.some((s) => s.tur === "bordro_parametreleri")
      && (await this.prisma.tenantIslem(tenantId, (tx) => tx.personel.count({ where: { aktif: true } }))) > 0;
    return eksikler.filter((s) => s.tur !== "bordro_parametreleri" || calisanVar).map((s) => ({
      tur: "mevzuat" as const,
      onem: "kritik" as const,
      baslik: `${s.donem} ${s.ad} henüz yayınlanmadı`,
      aciklama: `Yeni dönem ${new Date(`${s.baslangic}T00:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "UTC" })} tarihinde başladı; değer Mevzuat Merkezi'nde yayınlanana kadar ${s.etki}. Platform ekibine iletildi.`,
      birlesimAnahtari: `mevzuat-eksik:${s.tur}:${s.anahtar}:${s.donem}`,
      kaynakTur: "mevzuat_kayit",
      kaynakRef: `${s.tur}/${s.anahtar}`,
      hedefYol: "/panel/ayarlar/mevzuat",
      roller: HEDEF_ROLLER.mevzuat,
    }));
  }

  private async satinAlmaOnaylari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const ayar = this.ayarlar ? await this.ayarlar.getir("satin_alma") : {};
    const esik = Number(ayar.onayEsigi ?? VARSAYILAN_ONAY_ESIGI);
    const talepler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.satinAlmaTalebi.findMany({
        where: { durum: "onay_bekliyor" },
        select: { id: true, no: true, tahminiToplam: true, talepEden: { select: { adSoyad: true } } },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    );
    return talepler.map((t) => ({
      tur: "satin_alma" as const,
      onem: "uyari" as const,
      baslik: "Satın alma talebi onay bekliyor",
      aciklama: `${t.no} · ${t.talepEden.adSoyad} · ${Number(t.tahminiToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`,
      birlesimAnahtari: `satin_alma:talep:${t.id}`,
      kaynakTur: "satin_alma_talebi",
      kaynakRef: t.id,
      hedefYol: `/panel/satin-alma/talepler?talep=${t.id}`,
      roller: onaylayabilecekRoller(Number(t.tahminiToplam), esik),
    }));
  }

  private async duzeltmeKayitlari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.duzeltmeKaydi.findMany({
        where: { durum: { in: ["acik", "incelemede", "beklemede"] }, OR: [{ onem: "kritik" }, { sonTarih: { lt: new Date() } }] },
        select: { id: true, tur: true, onem: true, aciklama: true, onerilenEylem: true, sonTarih: true },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    );
    return kayitlar.map((kayit) => {
      const gecikti = Boolean(kayit.sonTarih && kayit.sonTarih < new Date());
      const tur = DUZELTME_TUR_ESLEMESI[kayit.tur];
      return {
        tur,
        onem: kayit.onem === "kritik" ? "kritik" : "uyari",
        baslik: gecikti && kayit.onem !== "kritik" ? "Düzeltme kaydı SLA süresini aştı" : "Kritik düzeltme gerekli",
        aciklama: kayit.onerilenEylem ? `${kayit.aciklama} ${kayit.onerilenEylem}` : kayit.aciklama,
        birlesimAnahtari: `duzeltme:${kayit.id}`,
        kaynakTur: "duzeltme",
        kaynakRef: kayit.id,
        hedefYol: "/panel/islemler",
        sonTarih: kayit.sonTarih ?? this.sla(kayit.onem === "kritik" ? "kritik" : "uyari"),
        roller: HEDEF_ROLLER[tur],
      };
    });
  }

  private async ebelgeHatalari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeKayit.findMany({
        // Taze `hata` bildirim doğurmaz (EBLG-46): gönderim işi düşünce kayıt
        // hemen `hata` yazılır ama kuyruk birkaç kez daha dener, ikinci
        // denemede geçen gönderim de arada `hata` görünür — bildirim geri
        // alınamadığı için denemeler bitene kadar beklenir. `ret` alıcının
        // nihai kararıdır, yeniden denenmez, bu yüzden hemen bildirilir.
        where: { OR: [yerlesmisHataKosulu(), { durum: "ret" }, { durum: "iptal", fatura: { durum: "kesin" } }] },
        select: { id: true, durum: true, hataMesaji: true, faturaId: true, fatura: { select: { no: true, durum: true, cari: { select: { unvan: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    );
    // EBLG-39: entegratörde iptal edilmiş belge, fatura iptal edilene kadar
    // hatırlatılır; fatura iptal edilince tespit edilmez ve bildirim kapanır.
    const iptaller = kayitlar
      .filter((kayit) => kayit.durum === "iptal" && kayit.fatura.durum === "kesin")
      .map((kayit) => entegratorIptalBildirimi(kayit.faturaId, kayit.fatura.no));
    return [...iptaller, ...kayitlar.filter((kayit) => kayit.durum !== "iptal").map((kayit) => ({
      tur: "ebelge" as const,
      onem: "kritik" as const,
      baslik: kayit.durum === "ret" ? "e-Belge reddedildi" : "e-Belge gönderimi hata verdi",
      aciklama: `${kayit.fatura.no ?? "Numarasız fatura"} · ${kayit.fatura.cari.unvan} — ${kayit.hataMesaji ?? "Entegratör hata ayrıntısı bildirmedi."}`,
      birlesimAnahtari: `ebelge:${kayit.id}`,
      kaynakTur: "ebelge",
      kaynakRef: kayit.faturaId,
      hedefYol: "/panel/fatura?ebelge=hata",
      sonTarih: this.sla("kritik"),
      roller: HEDEF_ROLLER.ebelge,
    }))];
  }

  /**
   * EBLG-133: seçili firma tasarımı (XSLT) bugünkü Mevzuat vergi listesinden
   * farklı bir listeyle üretilmiş: yeni stopaj ya da KDV matrahına dahil kod
   * belgede yanlış yerde/işaretle basılır. Firma tasarımı yeniden oluşturulup
   * seçilince kapanır.
   */
  private async tasarimVergiKodlari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const [baglantilar, firma] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.baglanti.findMany({ where: { aile: "ebelge", durum: "aktif" }, select: { id: true, sifreliConfig: true } }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { vkn: true } }),
    ]));
    if (!baglantilar.length || !firma) return [];
    const imza = vergiKodImzasi((await belgeKodTablosu(this.mevzuat, bugunTR())).vergiTurleri);
    const girdiler: BildirimGirdisi[] = [];
    for (const b of baglantilar) {
      let cfg: EntegratorConfig;
      try { cfg = JSON.parse(coz(b.sifreliConfig)) as EntegratorConfig; } catch { continue; }
      for (const tur of VERGILI_TASARIM_TURLERI) {
        const secili = cfg[TASARIM_ALANI[tur]];
        if (!tasarimVergiKodlariEski(secili, firma.vkn, cfg.tasarimVergiImzalari, imza)) continue;
        girdiler.push({
          tur: "ebelge",
          onem: "uyari",
          baslik: `${tur === "earsiv" ? "e-Arşiv" : "e-Fatura"} tasarımı vergi kodları güncel değil`,
          aciklama: `Seçili tasarım (${secili}) Mevzuat Merkezi'ndeki vergi türü listesi değişmeden önce üretildi; yeni stopaj ya da KDV matrahına dahil vergi kodu belgede yanlış sırada veya işaretle basılabilir. Entegratörler ekranında firma tasarımını yeniden oluşturun.`,
          birlesimAnahtari: `tasarim-vergi:${b.id}:${tur}`,
          kaynakTur: "baglanti",
          kaynakRef: b.id,
          hedefYol: "/panel/ayarlar/entegratorler",
          roller: HEDEF_ROLLER.ebelge,
        });
      }
    }
    return girdiler;
  }

  /**
   * EBLG-91: alıcının e-İrsaliyeye verdiği RET ya da kısmi kabul (mali
   * müşavir, 2026-09-24). Stok ve sipariş kendiliğinden değişmez — stok
   * hareketi irsaliyede değil faturada doğar; kullanıcı yönlendirilir. RET
   * irsaliye iptal edilince, kısmi kabul irsaliye kesin faturaya bağlanınca
   * tespit edilmez ve bildirim kapanır.
   */
  private async eirsaliyeYanitlari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.eirsaliyeKayit.findMany({
        where: {
          OR: [
            { durum: "ret", belge: { durum: { not: "iptal" } } },
            { durum: "kismi_kabul", belge: { durum: { not: "iptal" }, OR: [{ faturaId: null }, { fatura: { is: { durum: { not: "kesin" } } } }] } },
          ],
        },
        select: { id: true, durum: true, hataMesaji: true, belgeId: true, belge: { select: { no: true, cari: { select: { unvan: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    );
    return kayitlar.map((kayit) => {
      const ret = kayit.durum === "ret";
      const onem = ret ? ("kritik" as const) : ("uyari" as const);
      return {
        tur: "ebelge" as const,
        onem,
        baslik: ret ? "Alıcı e-İrsaliyeyi reddetti" : "Alıcı e-İrsaliyeyi kısmen kabul etti",
        aciklama: `${kayit.belge.no ?? "Numarasız irsaliye"} · ${kayit.belge.cari.unvan} — ${ret
          ? "Belge GİB'de geçersiz oldu. İrsaliyeyi programda iptal edip doğru bilgilerle yenisini düzenleyin."
          : "Faturayı alıcının kabul ettiği miktarla kesin."}${kayit.hataMesaji ? ` Alıcı notu: ${kayit.hataMesaji}` : ""}`,
        birlesimAnahtari: `ebelge:irsaliye:${kayit.id}`,
        kaynakTur: "belge",
        kaynakRef: kayit.belgeId,
        hedefYol: `/panel/belgeler?odak=${kayit.belgeId}`,
        sonTarih: this.sla(onem),
        roller: HEDEF_ROLLER.ebelge,
      };
    });
  }

  /**
   * EBLG-96: gelen e-İrsaliyeye yanıt fiilî sevkten itibaren 7 gün içinde
   * verilir; süresinde yanıtlanmayan belge tam teslim alınmış sayılır (GİB
   * SSS 57). Son 2 gün kala belge başına uyarı; yanıt verilince ya da süre
   * dolunca tespit edilmez ve bildirim kapanır. Son tarih süre sonudur, her
   * taramada aynı hesaplandığı için tazelenmez.
   */
  private async gelenEirsaliyeYanitSureleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEirsaliye.findMany({
        where: { durum: "yeni", kendiSevkimiz: false, sevkTarihi: { gte: new Date(`${gunEkleTR(-EIRSALIYE_YANIT_GUN_SAYISI)}T00:00:00Z`) } },
        select: { id: true, belgeNo: true, gonderenUnvan: true, sevkTarihi: true },
        take: 200,
      }),
    );
    return kayitlar.flatMap((kayit) => {
      const sure = eirsaliyeYanitSuresi({ sevkGunu: kayit.sevkTarihi.toISOString().slice(0, 10), bugun });
      if (!sure.yaklasiyor) return [];
      const sonGun = sure.sonGun.split("-").reverse().join(".");
      return [{
        tur: "ebelge" as const,
        onem: "uyari" as const,
        baslik: "Gelen e-İrsaliyenin yanıt süresi doluyor",
        aciklama: `${kayit.belgeNo} · ${kayit.gonderenUnvan} — yanıt için son gün ${sonGun}. Süresinde yanıt verilmezse mal tam teslim alınmış sayılır; eksik ya da hatalı teslimatı bu tarihe kadar bildirin.`,
        birlesimAnahtari: `ebelge:gelen-irsaliye-yanit:${kayit.id}`,
        kaynakTur: "gelen_eirsaliye",
        kaynakRef: kayit.id,
        hedefYol: "/panel/ebelge/irsaliye-gelen",
        sonTarih: new Date(`${sure.sonGun}T23:59:59+03:00`),
        roller: HEDEF_ROLLER.ebelge,
      }];
    });
  }

  /**
   * KSB-15: otomatik çekimi 3 kez üst üste başarısız olan ya da kimlik
   * reddiyle durmuş Vomsis bağlantısı (bağlantı başına) ve eşleştirme
   * bekleyen ekstre satırları (banka hesabı başına özet). Anahtarlar güne
   * bağlı değildir: sayı değişince metin güncellenir, sorun kalkınca kapanır.
   */
  private async bankaEntegrasyonu(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const [baglantilar, bekleyenler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.baglanti.findMany({
        where: { aile: "banka", saglayici: "vomsis", durum: "aktif", OR: [{ ardisikHata: { gte: 3 } }, { otomatikDurduNedeni: { not: null } }] },
        select: { id: true, ardisikHata: true, sonSenkronHatasi: true, otomatikDurduNedeni: true },
      }),
      tx.bankaEkstreSatir.groupBy({ by: ["bankaHesapId"], where: { durum: "beklemede" }, _count: { _all: true } }),
    ]));
    const hesapAdlari = bekleyenler.length
      ? new Map((await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaHesap.findMany({ where: { id: { in: bekleyenler.map((b) => b.bankaHesapId) } }, select: { id: true, ad: true } }))).map((h) => [h.id, h.ad]))
      : new Map<string, string>();
    return [
      ...baglantilar.map((b): BildirimGirdisi => ({
        tur: "entegrasyon",
        onem: b.otomatikDurduNedeni ? "kritik" : "uyari",
        baslik: b.otomatikDurduNedeni ? "Banka hareketlerinin otomatik çekimi durdu" : "Banka hareketleri çekilemiyor",
        aciklama: b.otomatikDurduNedeni
          ? `${b.otomatikDurduNedeni}. Vomsis bilgilerini düzeltip "Hareketleri çek" ile deneyin; başarılı çekimde otomatik çekim yeniden başlar.`
          : `Son ${b.ardisikHata} çekim başarısız oldu: ${b.sonSenkronHatasi ?? "bilinmeyen hata"}. Ekstre satırları güncel olmayabilir.`,
        birlesimAnahtari: `banka-senkron:${b.id}`,
        kaynakTur: "baglanti",
        kaynakRef: b.id,
        hedefYol: "/panel/ayarlar/banka-baglantilari",
        roller: HEDEF_ROLLER.entegrasyon,
      })),
      ...bekleyenler.map((b): BildirimGirdisi => ({
        tur: "entegrasyon",
        onem: "bilgi",
        baslik: "Eşleştirme bekleyen banka hareketi var",
        aciklama: `${hesapAdlari.get(b.bankaHesapId) ?? "Banka hesabı"}: ${b._count._all} ekstre satırı eşleştirme bekliyor.`,
        birlesimAnahtari: `ekstre-bekleyen:${b.bankaHesapId}`,
        kaynakTur: "banka_hesap",
        kaynakRef: b.bankaHesapId,
        hedefYol: `/panel/kasa-banka/ekstre?bankaHesapId=${b.bankaHesapId}`,
        roller: HEDEF_ROLLER.entegrasyon,
      })),
    ];
  }

  private async vadeOzetleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const gun = gunAnahtari();
    const girdiler: BildirimGirdisi[] = [];

    // Vade tanımı rapor motorundan gelir; aynı sayı iki yerde ayrı hesaplanırsa
    // kullanıcı zilde ve raporda farklı rakam görür.
    const vadesiGecenler = await this.rapor.vadesiGecenler();
    const alacak = vadesiGecenler.alacakSayisi;
    const borc = vadesiGecenler.borcSayisi;
    if (alacak || borc) {
      girdiler.push({
        tur: "vade",
        onem: "uyari",
        baslik: "Vadesi geçen fatura var",
        aciklama: `${alacak} tahsil edilecek (${vadesiGecenler.toplamAlacak} TL), ${borc} ödenecek (${vadesiGecenler.toplamBorc} TL) fatura vadesini geçti.`,
        birlesimAnahtari: `vade:${gun}`,
        hedefYol: "/panel/fatura?odeme=acik",
        roller: HEDEF_ROLLER.vade,
      });
    }

    const ayar = this.ayarlar ? await this.ayarlar.getir("kasaBanka") : {};
    const erkenGun = typeof ayar.cekSenetHatirlatmaGun === "number" && Number.isInteger(ayar.cekSenetHatirlatmaGun) &&
      ayar.cekSenetHatirlatmaGun >= 0 && ayar.cekSenetHatirlatmaGun <= 90 ? ayar.cekSenetHatirlatmaGun : 7;
    const vadeGunuAcik = ayar.cekSenetVadeGunuHatirlat !== false;
    // PostgreSQL DATE alanları UTC gün başlangıcıyla, iş günü İstanbul tarihiyle karşılaştırılır.
    const cekGunu = bugunTR();
    const bugun = new Date(`${cekGunu}T00:00:00Z`);
    const erkenTarih = gunEkle(bugun, erkenGun);
    const [erken, bugunku, geciken] = await this.prisma.tenantIslem(tenantId, (tx) => {
      const where = { tenantId, durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "verildi"] as const } };
      return Promise.all([
        erkenGun > 0 ? tx.cekSenet.count({ where: { ...where, durum: { in: [...where.durum.in] }, vadeTarihi: erkenTarih } }) : 0,
        vadeGunuAcik ? tx.cekSenet.count({ where: { ...where, durum: { in: [...where.durum.in] }, vadeTarihi: bugun } }) : 0,
        tx.cekSenet.count({ where: { ...where, durum: { in: [...where.durum.in] }, vadeTarihi: { lt: bugun } } }),
      ]);
    });
    for (const grup of [
      { adet: erken, baslik: "Vadesi yaklaşan çek/senet", aciklama: `${erken} evrakın vadesine ${erkenGun} gün kaldı.`, anahtar: `once:${erkenGun}`, onem: "uyari" as const },
      { adet: bugunku, baslik: "Bugün vadeli çek/senet", aciklama: `${bugunku} evrakın vade günü bugün.`, anahtar: "bugun", onem: "uyari" as const },
      { adet: geciken, baslik: "Vadesi geçmiş çek/senet", aciklama: `${geciken} sonuçlanmamış evrakın vadesi geçti.`, anahtar: "geciken", onem: "uyari" as const },
    ]) {
      if (!grup.adet) continue;
      girdiler.push({ tur: "cek_senet", onem: grup.onem, baslik: grup.baslik, aciklama: grup.aciklama,
        birlesimAnahtari: `cek_senet:${cekGunu}:${grup.anahtar}`,
        hedefYol: "/panel/kasa-banka/cek-senet", roller: HEDEF_ROLLER.cek_senet });
    }

    girdiler.push(...(await this.kartEkstreUyarilari()));
    girdiler.push(...(await this.krediTaksitUyarilari()));
    girdiler.push(...(await this.teminatSureUyarilari()));
    girdiler.push(...(await this.mutabakatItirazlari()));
    girdiler.push(...(await this.ihracKayitliOzetleri(gun)));
    girdiler.push(...(await this.irsaliyeFaturaOzetleri(gun)));
    return girdiler;
  }

  /**
   * KSB-10: son kesilen kart ekstresi. Son ödeme günü yaklaşırken uyarı,
   * asgari ödenmeden geçince kritik bildirim; anahtar duruma göre ayrıldığı
   * için "yaklaşıyor"dan "gecikti"ye geçiş yeni bildirimdir. Ekstre ödenince
   * tarama onu artık üretmez ve bildirim kapanır (`vade:` öneki).
   */
  private async kartEkstreUyarilari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const kartlar = await this.prisma.tenantIslem(tenantId, (tx) => kartEkstreleriniOku(tx, bugun));
    const girdiler: BildirimGirdisi[] = [];
    for (const { kart, donemler } of kartlar) {
      const ekstre = ekstreOzeti(donemler).sonKesilen;
      if (!ekstre || ekstre.kalan.lte(0)) continue;
      const kartAdi = `${kart.ad} •••• ${kart.sonDortHane}`;
      const sonOdeme = ekstre.sonOdemeTarihi.split("-").reverse().join(".");
      const para = (d: { toFixed: (n: number) => string }) => `${Number(d.toFixed(2)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${kart.dovizCinsi}`;
      const ortak = { tur: "vade" as const, kaynakTur: "kredi_karti_ekstre", kaynakRef: kart.id, hedefYol: `/panel/kasa-banka/kredi-kartlari?kart=${kart.id}`, roller: HEDEF_ROLLER.vade };
      if (ekstre.durum === "gecikti") {
        girdiler.push({
          ...ortak, onem: "kritik", baslik: "Kart ekstresi gecikti",
          aciklama: `${kartAdi} ekstresinin son ödeme günü ${sonOdeme} geçti; asgari ödemeden ${para(ekstre.asgariKalan)} eksik, toplam kalan ${para(ekstre.kalan)}. Gecikme faizi işler.`,
          birlesimAnahtari: `vade:kart:${kart.id}:${ekstre.kesimTarihi}:gecikti`,
        });
      } else if (ekstre.durum === "bekliyor" || ekstre.durum === "kismi") {
        const kalanGun = Math.round((Date.parse(ekstre.sonOdemeTarihi) - Date.parse(bugun)) / 86_400_000);
        if (kalanGun > KART_UYARI_GUNU) continue;
        girdiler.push({
          ...ortak, onem: "uyari", baslik: "Kart ekstresinin son ödeme günü yaklaşıyor",
          aciklama: `${kartAdi}: ${para(ekstre.kalan)} ekstre borcunun son ödeme günü ${sonOdeme}${kalanGun === 0 ? " (bugün)" : ` (${kalanGun} gün kaldı)`}; asgari ${para(ekstre.asgariKalan)}.`,
          birlesimAnahtari: `vade:kart:${kart.id}:${ekstre.kesimTarihi}:yaklasiyor`,
          sonTarih: new Date(`${ekstre.sonOdemeTarihi}T23:59:59+03:00`),
        });
      }
    }
    return girdiler;
  }

  /**
   * CARI-39: iade edilmemiş teminatın bitişine 30 gün kala uyarı, bitiş geçince
   * kritik bildirim (süresi geçen teminat artık risk limitine eklenmez). Kayıt
   * başınadır — teminat sayısı azdır ve her biri yenileme/iade işi doğurur.
   * İade edilince ya da süre uzatılınca tarama üretmez, bildirim kapanır (`vade:`).
   */
  private async teminatSureUyarilari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const sinir = new Date(`${bugun}T00:00:00.000Z`);
    sinir.setUTCDate(sinir.getUTCDate() + TEMINAT_UYARI_GUNU);
    const teminatlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariTeminat.findMany({
      where: { durum: "aktif", bitisTarihi: { not: null, lte: sinir } },
      include: { cari: { select: { id: true, kod: true, unvan: true } } },
      orderBy: { bitisTarihi: "asc" },
      take: 100,
    }));
    return teminatlar.map((t): BildirimGirdisi => {
      const bitis = t.bitisTarihi!.toISOString().slice(0, 10);
      const doldu = bitis < bugun;
      const kalanGun = Math.round((Date.parse(bitis) - Date.parse(bugun)) / 86_400_000);
      const ad = TEMINAT_TURU_ADLARI[t.tur as TeminatTuru] ?? "Teminat";
      const tutar = `${Number(t.tutar.toFixed(2)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${t.dovizCinsi === "TRY" ? "TL" : t.dovizCinsi}`;
      return {
        tur: "vade",
        onem: doldu ? "kritik" : "uyari",
        baslik: doldu ? "Teminatın süresi doldu" : "Teminatın süresi doluyor",
        aciklama: `${t.cari.unvan} (${t.cari.kod}) — ${ad}${t.belgeNo ? ` ${t.belgeNo}` : ""}, ${tutar}: bitiş ${bitis.split("-").reverse().join(".")}${doldu ? "; artık risk limitine eklenmiyor. Yenilenmesini isteyin ya da iade edin" : kalanGun === 0 ? " (bugün)" : ` (${kalanGun} gün kaldı); yenilenmesini isteyin`}.`,
        birlesimAnahtari: `vade:teminat:${t.id}:${doldu ? "doldu" : "yaklasiyor"}`,
        kaynakTur: "cari_teminat",
        kaynakRef: t.id,
        hedefYol: `/panel/cari/${t.cari.id}`,
        roller: HEDEF_ROLLER.vade,
        ...(doldu ? {} : { sonTarih: new Date(`${bitis}T23:59:59+03:00`) }),
      };
    });
  }

  /**
   * CARI-42: karşı tarafın portaldan itiraz ettiği, henüz kapatılmamış
   * mutabakat. Portal yanıtında anında da üretilir; aynı anahtar olduğu için
   * çift kayıt olmaz, itiraz kapatılınca tarama üretmez ve bildirim kapanır.
   */
  private async mutabakatItirazlari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const itirazlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariMutabakat.findMany({
      where: { durum: "itiraz", itirazKapandiAt: null },
      include: { cari: { select: { kod: true, unvan: true } } },
      orderBy: { yanitAt: "asc" },
      take: 100,
    }));
    return itirazlar.map((k) => mutabakatItirazBildirimi({
      id: k.id, cariId: k.cariId, cari: k.cari, mutabakatTarihi: k.mutabakatTarihi, yanitlayanAd: k.yanitlayanAd,
      farklar: bakiyeFarklari(k.bakiyeler as unknown as DovizBakiyesi[], (k.karsiBakiyeler as unknown as DovizBakiyesi[] | null) ?? []),
    }));
  }

  /**
   * KRD-04: ödenmemiş kredi taksiti; vadeye 3 gün kala uyarı, vadesi geçince
   * kritik. Anahtar taksit başınadır; ödenince tarama kapatır (`vade:` öneki).
   */
  private async krediTaksitUyarilari(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const sinir = new Date(`${bugun}T00:00:00.000Z`);
    sinir.setUTCDate(sinir.getUTCDate() + KART_UYARI_GUNU);
    const taksitler = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaKrediTaksiti.findMany({
      where: { islemId: null, vadeTarihi: { lte: sinir }, kredi: { durum: "aktif" } },
      include: { kredi: { select: { id: true, ad: true, dovizCinsi: true } } },
      orderBy: { vadeTarihi: "asc" },
      take: 100,
    }));
    return taksitler.map((t): BildirimGirdisi => {
      const vade = t.vadeTarihi.toISOString().slice(0, 10);
      const gecikti = vade < bugun;
      const tutar = `${Number(t.anapara.add(t.faiz).add(t.bsmv).add(t.kkdf).toFixed(2)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${t.kredi.dovizCinsi}`;
      const kalanGun = Math.round((Date.parse(vade) - Date.parse(bugun)) / 86_400_000);
      return {
        tur: "vade",
        onem: gecikti ? "kritik" : "uyari",
        baslik: gecikti ? "Kredi taksiti gecikti" : "Kredi taksitinin vadesi yaklaşıyor",
        aciklama: `${t.kredi.ad} ${t.sira}. taksit (${tutar}) vadesi ${vade.split("-").reverse().join(".")}${gecikti ? " geçti; banka tahsil ettiyse ödemeyi işleyin" : kalanGun === 0 ? " (bugün)" : ` (${kalanGun} gün kaldı)`}.`,
        birlesimAnahtari: `vade:kredi:${t.id}:${gecikti ? "gecikti" : "yaklasiyor"}`,
        kaynakTur: "banka_kredisi",
        kaynakRef: t.kredi.id,
        hedefYol: `/panel/kasa-banka/krediler?kredi=${t.kredi.id}`,
        roller: HEDEF_ROLLER.vade,
        ...(gecikti ? {} : { sonTarih: new Date(`${vade}T23:59:59+03:00`) }),
      };
    });
  }

  /**
   * EBLG-82: fatura teslimden itibaren 7 gün içinde düzenlenir (VUK 231/5).
   * Satışta süresi dolan kritik, dolmak üzere olan uyarıdır. Alışta faturayı
   * tedarikçi keser; bizim için hatırlatmadır, yalnız süre dolunca ve uyarı
   * önemiyle çıkar. Kesin faturaya bağlanan irsaliye faturalanmış sayılır;
   * liste olayıdır, günlük özet üretilir (`vade:` öneki taramanın kapatması için).
   */
  private async irsaliyeFaturaOzetleri(gun: string): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const bekleyenler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.findMany({
        where: {
          tur: "irsaliye",
          durum: { in: ["onaylandi", "kapandi"] },
          OR: [{ faturaId: null }, { fatura: { is: { durum: { not: "kesin" } } } }],
          // EBLG-95: muhtelif irsaliyenin faturası müşterilere ayrı ayrı kesilir; takibe girmez.
          cari: { OR: [{ vknTckn: null }, { vknTckn: { not: MUHTELIF_MUSTERI_VKN } }] },
        },
        select: { yon: true, tarih: true, fiiliSevkZamani: true },
      }),
    );
    if (bekleyenler.length === 0) return [];
    // MVZ-13: faturalama süresi Mevzuat Merkezi'nden.
    const gunSayisi = await kanuniDegerOku(this.prisma, "irsaliye_fatura_gun", bugunTR(), IRSALIYE_FATURA_GUN_SAYISI);
    const bugun = bugunTR();
    const sure = (b: (typeof bekleyenler)[number]) => irsaliyeFaturaSuresi({ sevkGunu: irsaliyeSevkGunu(b), bugun, gunSayisi });
    const satis = bekleyenler.filter((b) => b.yon === "satis").map(sure);
    const alisGecen = bekleyenler.filter((b) => b.yon === "alis").map(sure).filter((s) => s.gecti).length;
    const satisGecen = satis.filter((s) => s.gecti).length;
    const satisYaklasan = satis.filter((s) => s.yaklasiyor).length;

    const girdiler: BildirimGirdisi[] = [];
    if (satisGecen) {
      girdiler.push({
        tur: "vade",
        onem: "kritik",
        baslik: "İrsaliyenin faturalama süresi doldu",
        aciklama: `${satisGecen} satış irsaliyesi ${gunSayisi} gün içinde faturalanmadı. Süresinde düzenlenmeyen fatura hiç düzenlenmemiş sayılır ve özel usulsüzlük cezası doğar; faturayı hemen düzenleyin.`,
        birlesimAnahtari: `vade:irsaliye-fatura-gecen:${gun}`,
        hedefYol: "/panel/belgeler?tur=irsaliye&yon=satis&faturaBekleyen=1",
        roller: HEDEF_ROLLER.vade,
      });
    }
    if (satisYaklasan) {
      girdiler.push({
        tur: "vade",
        onem: "uyari",
        baslik: "İrsaliyenin faturalama süresi doluyor",
        aciklama: `${satisYaklasan} satış irsaliyesinin ${gunSayisi} günlük faturalama süresi önümüzdeki günlerde doluyor.`,
        birlesimAnahtari: `vade:irsaliye-fatura-yaklasan:${gun}`,
        hedefYol: "/panel/belgeler?tur=irsaliye&yon=satis&faturaBekleyen=1",
        roller: HEDEF_ROLLER.vade,
      });
    }
    if (alisGecen) {
      girdiler.push({
        tur: "vade",
        onem: "uyari",
        baslik: "Tedarikçiden fatura gelmedi",
        aciklama: `${alisGecen} alış irsaliyesinin faturası ${gunSayisi} gün içinde gelmedi. Tedarikçiden faturayı isteyin; geldiyse irsaliyeyi faturaya bağlayın.`,
        birlesimAnahtari: `vade:irsaliye-fatura-alis:${gun}`,
        hedefYol: "/panel/belgeler?tur=irsaliye&yon=alis&faturaBekleyen=1",
        roller: HEDEF_ROLLER.vade,
      });
    }
    return girdiler;
  }

  /**
   * EBLG-63: ihraç kaydıyla satılan malın süresinde ihraç edildiğini gösteren
   * çıkış beyannamesi ihracatçıdan gelmediyse uyarır. EBLG-114: ihraç kayıtlı
   * alışta ihracatçı firmadır; beyanname girilmemiş alışlar ayrı bildirimle
   * izlenir. Liste olayıdır, günlük özet üretilir; anahtar `vade:` önekiyle
   * başlar ki tarama kapatabilsin. Süresi geçen kritik sayılır: tecil edilen
   * KDV'nin ödenmesi gündeme gelir.
   */
  private async ihracKayitliOzetleri(gun: string): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const aciklar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where: { ihracKayitliKodu: { not: null }, durum: "kesin", gumrukBeyannameNo: null, tip: { in: ["satis", "alis"] } },
        select: { tarih: true, tip: true },
      }),
    );
    const bugun = gunAnahtari();
    const sinir = new Date();
    sinir.setDate(sinir.getDate() + IHRAC_KAYITLI_UYARI_GUNU);
    const uyariSiniri = gunAnahtari(sinir);

    const girdiler: BildirimGirdisi[] = [];
    for (const yon of ["satis", "alis"] as const) {
      const sonTarihler = aciklar.filter((f) => f.tip === yon).map((f) => ihracKayitliSonTarih(f.tarih));
      const gecen = sonTarihler.filter((s) => s < bugun).length;
      const yaklasan = sonTarihler.filter((s) => s >= bugun && s <= uyariSiniri).length;
      const satis = yon === "satis";
      const hedefYol = satis ? "/panel/fatura?ihracKayitli=acik" : "/panel/fatura?yon=alis&ihracKayitli=acik";
      const anahtar = satis ? "ihrac-kayitli" : "ihrac-kayitli-alis";
      if (gecen) {
        girdiler.push({
          tur: "vade",
          onem: "kritik",
          baslik: satis ? "İhraç kayıtlı satışta süre doldu" : "İhraç kayıtlı alışta ihracat süresi doldu",
          aciklama: satis
            ? `${gecen} ihraç kayıtlı satışın ihracat süresi geçti ve çıkış beyannamesi işlenmedi. İhracatçıdan beyannameyi isteyin; gerçekleşmediyse tecil edilen KDV için mali müşavirinize danışın.`
            : `${gecen} ihraç kayıtlı alışta malın ihraç süresi geçti ve gümrük beyannamesi işlenmedi. İhraç edildiyse beyannameyi alış faturasına girin; edilmediyse ödenmeyen KDV firmadan aranır, mali müşavirinize danışın.`,
          birlesimAnahtari: `vade:${anahtar}-gecen:${gun}`,
          hedefYol,
          roller: HEDEF_ROLLER.vade,
        });
      }
      if (yaklasan) {
        girdiler.push({
          tur: "vade",
          onem: "uyari",
          baslik: satis ? "İhraç kayıtlı satışta süre doluyor" : "İhraç kayıtlı alışta ihracat süresi doluyor",
          aciklama: satis
            ? `${yaklasan} ihraç kayıtlı satışın ihracat süresi önümüzdeki ${IHRAC_KAYITLI_UYARI_GUNU} gün içinde doluyor; çıkış beyannamesi henüz işlenmedi.`
            : `${yaklasan} ihraç kayıtlı alışta malı ihraç etmeniz gereken süre önümüzdeki ${IHRAC_KAYITLI_UYARI_GUNU} gün içinde doluyor; gümrük beyannamesi henüz işlenmedi.`,
          birlesimAnahtari: `vade:${anahtar}-yaklasan:${gun}`,
          hedefYol,
          roller: HEDEF_ROLLER.vade,
        });
      }
    }
    return girdiler;
  }

  private async stokOzetleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const gun = gunAnahtari();
    const [kritikStok, taslakSayim] = await this.prisma.tenantIslem(tenantId, async (tx) => [
      await tx.$queryRaw<{ sayi: bigint }[]>`
        SELECT count(*)::bigint AS sayi FROM "stok_kartlari"
        WHERE "tenant_id" = ${tenantId}::uuid AND "aktif" = true
          AND "kritik_seviye" IS NOT NULL AND "mevcut_miktar" <= "kritik_seviye"`,
      await tx.sayim.count({ where: { durum: "taslak" } }),
    ]);
    const kritikSayisi = Number(kritikStok[0]?.sayi ?? 0);

    const girdiler: BildirimGirdisi[] = [];
    if (kritikSayisi) {
      girdiler.push({
        tur: "stok",
        onem: "uyari",
        baslik: "Kritik seviyeye düşen stok",
        aciklama: `${kritikSayisi} stok kartı kritik seviyenin altında veya seviyesinde.`,
        birlesimAnahtari: `stok_kritik:${gun}`,
        hedefYol: "/panel/stok",
        roller: HEDEF_ROLLER.stok,
      });
    }
    if (taslakSayim) {
      girdiler.push({
        tur: "stok",
        onem: "uyari",
        baslik: "Onaysız stok sayımı",
        aciklama: `${taslakSayim} sayım taslak durumda; onaylanmadan stok miktarlarına yansımaz.`,
        birlesimAnahtari: `stok_sayim:${gun}`,
        hedefYol: "/panel/stok/sayim",
        roller: HEDEF_ROLLER.stok,
      });
    }
    return girdiler;
  }

  private async donemKontrolleri(): Promise<BildirimGirdisi[]> {
    const { tenantId } = aktifBaglam();
    const donemler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.maliDonem.findMany({
        where: { durum: "acik", kontroller: { some: { basarili: false } } },
        select: { id: true, yil: true, ay: true, kontroller: { where: { basarili: false }, select: { aciklama: true } } },
        orderBy: [{ yil: "desc" }, { ay: "desc" }],
        take: 12,
      }),
    );
    return donemler.map((donem) => ({
      tur: "donem" as const,
      onem: "uyari" as const,
      baslik: `${String(donem.ay).padStart(2, "0")}/${donem.yil} dönemi kapanmaya hazır değil`,
      aciklama: donem.kontroller.map((kontrol) => kontrol.aciklama).join(" · "),
      birlesimAnahtari: `donem:${donem.yil}-${donem.ay}`,
      kaynakTur: "mali_donem",
      kaynakRef: donem.id,
      hedefYol: "/panel/donem-kapatma",
      roller: HEDEF_ROLLER.donem,
    }));
  }
}
