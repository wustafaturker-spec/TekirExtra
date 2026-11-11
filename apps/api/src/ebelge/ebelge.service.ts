import { GelenXmlDeposu, gelenXmlOku, gelenXmlYaz } from "./gelen-xml-deposu.service";
import { stokKartiBul, tedarikciKodlariniOgren } from "./stok-eslesme";
import { belgeNetMatrahlari, fiyatKarsilastir, yilOnce } from "./fiyat-analizi";
import { earsivIptalGecenGun } from "./earsiv-iptal-suresi";
import { faturaIrsaliyeAdaylari } from "../belgeler/irsaliye-eslesme";
import { gonderenCariSec, tedarikciCariBulVeyaOlustur } from "../cari/tedarikci-cari";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  forwardRef,
} from "@nestjs/common";
import { BelgeDurum, EarsivGonderimSekli, EbelgeTur, GelenEbelgeDurum, Prisma } from "@prisma/client";
import type { BelgeDurumSonuc, EntegratorConfig, GelenAliciYaniti, GelenBelge, GonderimSonuc } from "@tekirextra/baglanti";
import { bugunTR, faturaGecikmeUyarilari, ihracKayitliKoduBul, IRSALIYE_FATURA_GUN_SAYISI, irsaliyeSevkGunu, type FirmaEbelgeBilgisi, IHRACAT_POSTA_KUTUSU, birimTanindiMi, firmaEbelgeEksikleri, gibBelgeNoMu, ublAdresi, YURT_DISI_IADE_ENGELI, MUKELLEF_TURU_KAMU, YOLCU_BERABER_POSTA_KUTUSU, ibanNormalize, kamuEngelleri, kamuSenaryosuMu, sgkEngelleri, sgkFaturasiMi, SGK_VKN, sarjEngelleri, sarjPlakaNormalize, idisEngelleri, idisNormalize, ytbBelgesiMi, ytbEngelleri, ytbNormalize, type SarjTuru, type SevkiyatYontemi, sevkiyatEksikleri, sevkiyatSorulurMu, ebelgeKanali, ebelgeUygulamalariCoz, ebelgeKanalEngelleri, uygulamaAcik, type EbelgeUygulamalari, type DovizKodu, dovizKoduMu, type KodTablosu, type TevkifatKodu, VARSAYILAN_KOD_TABLOSU } from "@tekirextra/shared";
import { ebelgeUygulamalariCozTenant } from "./ebelge-uygulamalari.service";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { BildirimService } from "../bildirimler/bildirim.service";
import { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { MetricsService } from "../core/observability/metrics.service";
import { BelgelerService } from "../belgeler/belgeler.service";
import { PrismaService } from "../core/prisma.service";
import { FaturaService } from "../fatura/fatura.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { UblOkumaHatasi, faturaUblOku, type UblFatura, type UblSatir } from "./ubl-oku";
import { gelenFaturaGirdisi, gelenFaturaHesabi, gelenFaturaTipi, tutarDenetimi, type GelenSatirEslesmesi } from "./gelen-fatura";
import { belgeKodTablosu, firmaTevkifatTablosu } from "../fatura/tevkifat-tablosu";
import { MevzuatService } from "../mevzuat/mevzuat.service";
import { adSoyadCoz } from "../cari/ad-soyad";
import { durumAciklamasi } from "./durum-aciklamasi";
import { MukellefListesiService } from "./mukellef-listesi.service";
import { takiliRezervasyonKosulu, takiliRezervasyonMu } from "./takili-rezervasyon";
import { vknTcknKabulEdilebilirMi } from "./vkn-kabulu";
import { SON_EBELGE_DURUMLARI, durumSorgusuEngeli } from "./durum-sorgusu";
import { faturaSorguKosulu, faturaSorguSureleriniOku } from "./fatura-sorgu-kosulu";
import { entegratorIptalBildirimi } from "./entegrator-iptal-bildirimi";
import { belgeNoyuUbleYaz, faturaUblUret } from "./xml-uretec";
import { IHRACAT_DEGIL, ihracatOzeti } from "./ihracat-bilgisi";
import { ebelgeGonderilebilirTipMi, iadeOzeti } from "./iade-bilgisi";
import { tasiyiciAdresiniBagla, tasiyiciCariBul, tasiyiciCariOzeti } from "./tasiyici-cari";
import { internetSatisOzeti } from "./internet-satis-bilgisi";
import { yolcuBeraberiOzeti } from "./yolcu-beraberi-bilgisi";
import { kanuniDegerOku } from "../mevzuat/kanuni-deger";
import { onDenetimCalistir } from "./on-denetim";
import { gelenDenetimCalistir } from "./gelen-denetim";
import { ON_DENETIM_KURAL_ADLARI, onDenetimAnahtari, type OnDenetimBulgusu } from "@tekirextra/shared";

/** EBLG-143: ön denetimin canlıya alındığı gün; ölçümde öncesi/sonrası ayrımı. */
export const ON_DENETIM_BASLANGIC = "2026-10-20";

/** Onay ekranında satırın hangi ipucuyla eşleştiği. */
/** EBLG-144: her çekimde denetimi tamamlanan eski bekleyen belge sayısı. */
const GELEN_DENETIM_TAMAMLAMA = 50;
/** Büyük XML gövdesi yoğun diskte varsayılan 5 sn'yi aşıp çekimi düşürüyordu. */
const GELEN_BELGE_ISLEM_SURESI_MS = 30_000;

/** EBLG-141/150: ön denetim kararının bağlandığı kayıt — giden fatura ya da gelen belge. */
export type OnDenetimHedefi = { faturaId: string } | { gelenEbelgeId: string };

export type EslesmeKaynagi =
  | "alici_urun_kodu"
  | "barkod"
  | "tedarikci_urun_kodu"
  | "uretici_urun_kodu"
  | "ad"
  | null;

const YEDI_GUN_MS = 7 * 24 * 60 * 60 * 1_000;

/** Ekrandaki "Yenile" düğmesinin kiracı başına asgari aralığı (EBLG-11). */
// Kullanım anında okunur: modül yüklenirken `.env` henüz yüklenmemiş olur.
const elleTazelemeAralikMs = () => Number(process.env.EBLG_ELLE_TAZELEME_ARALIK_MS || 60 * 60 * 1_000);

/** Anı Türkiye takvimindeki güne indirger (YYYY-AA-GG). */
const istanbulGunu = (an: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(an);

/**
 * Fatura tarihi bugün ya da en çok 7 gün önce olmalı. Karşılaştırma **gün**
 * üzerinden yapılır: fatura tarihi UTC gün başı olarak saklandığı için anlık
 * karşılaştırma, Türkiye'de gece yarısı ile 03:00 arasında kesilen bugünkü
 * faturayı "gelecek tarihli" sayıp gönderimi durduruyordu.
 */
export function gonderimTarihiGecerliMi(tarih: Date, simdi = new Date()): boolean {
  const bugun = istanbulGunu(simdi);
  const gun = tarih.toISOString().slice(0, 10);
  if (gun > bugun) return false;
  const enEski = new Date(`${bugun}T00:00:00Z`).getTime() - YEDI_GUN_MS;
  return new Date(`${gun}T00:00:00Z`).getTime() >= enEski;
}

/** EBLG-58: satış iadesinin, alışın ve proformanın faturasını biz kesmeyiz. */
const TIP_GONDERILEMEZ =
  "Yalnızca satış ve alış iade faturaları e-belge olarak gönderilir; satış iadesinin faturasını müşteri keser.";

/**
 * Gönderimin ve önizlemenin (L) ortak ön koşulları. Türe özel eksik varsa ya
 * da belge gönderilebilecek durumda değilse durdurur; türe özel özetleri döner.
 */
/**
 * EBLG-78: YTB kuralına giden girdi. Fatura ve satır alanları tek yerde
 * toplanır; sihirbaz ile gönderim aynı girdiyi üretir.
 */
function ytbGirdisi(fatura: {
  ytbNo: string | null;
  ytbTarihi: Date | null;
  satirlar: { kdvOrani: unknown; gibIstisnaKodu: string | null; ytbHarcamaTipi: string | null; ytbMakineAdi: string | null; ytbMakineId: string | null; ytbMakineSiraNo: string | null }[];
}) {
  return {
    ytbNo: fatura.ytbNo,
    ytbTarihi: fatura.ytbTarihi,
    satirlar: fatura.satirlar.map((satir, index) => ({
      sira: index + 1,
      harcamaTipi: satir.ytbHarcamaTipi,
      makineAdi: satir.ytbMakineAdi,
      makineId: satir.ytbMakineId,
      makineSiraNo: satir.ytbMakineSiraNo,
      kdvOrani: Number(satir.kdvOrani),
      gibIstisnaKodu: satir.gibIstisnaKodu,
    })),
  };
}

/**
 * EBLG-114: gelen `IHRACKAYITLI` faturanın ihraç kayıtlı kodu. Tanımsız kodla
 * gelen belge işlenmez: kodsuz işlenirse KDV yeniden cariye eklenirdi.
 */
function gelenIhracKayitliKodu(ubl: Pick<UblFatura, "faturaTipKodu" | "istisnaKodlari">, kodTablosu: KodTablosu = VARSAYILAN_KOD_TABLOSU): string | null {
  if (ubl.faturaTipKodu.toUpperCase() !== "IHRACKAYITLI") return null;
  const kod = ubl.istisnaKodlari.find((k) => ihracKayitliKoduBul(k, kodTablosu.ihracKayitli));
  if (!kod) {
    throw new BadRequestException(
      `Belge ihraç kayıtlı ama tanınan bir ihraç kayıtlı kodu taşımıyor (${ubl.istisnaKodlari.join(", ") || "kod yok"}); faturaya işlenemez`,
    );
  }
  return kod;
}

/**
 * EBLG-115…119: gelen belgeden oluşacak faturanın girdisi, işlemeyi durduran
 * engeller ve belge toplamlarıyla karşılaştırma. Onay ekranı (eşleşmesiz) ve
 * onay (eşleşmeli) aynı hesabı görür.
 */
function gelenDenetle(ubl: UblFatura, tablolar: { tevkifat: readonly TevkifatKodu[]; kod: KodTablosu }, eslesme: (siraNo: number) => GelenSatirEslesmesi | undefined = () => undefined) {
  const { girdi, engeller, bilinmeyenler } = gelenFaturaGirdisi(ubl, eslesme, tablolar.tevkifat, tablolar.kod);
  let ihracKayitliKodu: string | null = null;
  try {
    ihracKayitliKodu = gelenIhracKayitliKodu(ubl, tablolar.kod);
  } catch (hata) {
    engeller.push(hata instanceof Error ? hata.message : String(hata));
  }
  const denetim = tutarDenetimi(ubl, gelenFaturaHesabi(girdi, Boolean(ihracKayitliKodu), tablolar.tevkifat, tablolar.kod.vergiTurleri), Boolean(ihracKayitliKodu), tablolar.kod.vergiTurleri);
  return { girdi, engeller, denetim, ihracKayitliKodu, bilinmeyenler };
}

/**
 * Gelen belgenin liste özeti; kayıt anında XML'den çıkarılıp tabloya yazılır.
 * Liste XML'e dokunmaz: yüzlerce belgenin gömülü tasarım ve eklerle MB'larca
 * XML'ini her çağrıda ayrıştırmak API'yi bellek yetersizliğinden düşürüyordu.
 */
function gelenOzeti(xml: string) {
  try {
    const ubl = faturaUblOku(xml);
    return { satirSayisi: ubl.satirlar.length, genelToplam: ubl.toplamlar.genelToplam.toFixed(2), dovizCinsi: ubl.dovizCinsi, okunabilir: true, odemeHesaplari: ubl.odemeHesaplari };
  } catch {
    return { satirSayisi: 0, genelToplam: null, dovizCinsi: null, okunabilir: false, odemeHesaplari: [] };
  }
}

function gonderimKosullariniDenetle(
  fatura: Parameters<typeof ihracatOzeti>[0] & Parameters<typeof internetSatisOzeti>[0] & Parameters<typeof iadeOzeti>[0] & Parameters<typeof yolcuBeraberiOzeti>[0] & {
    durum: string;
    cari: { vknTckn: string | null };
    ihracKayitliKodu?: string | null;
  },
  /** EBLG-80: yurt dışı satışın ihracat mı e-Arşiv istisna mı olacağı buna bağlı. */
  efaturaAcik: boolean | null,
) {
  if (fatura.durum !== "kesin") {
    throw new BadRequestException("Yalnızca kesinleşmiş faturalar gönderilebilir");
  }
  if (!ebelgeGonderilebilirTipMi(fatura.tip)) throw new BadRequestException(TIP_GONDERILEMEZ);
  // Yolcu beraberi işareti ihracat kanalını ezer: yolcunun kendi ülkesindeki
  // adresi belgeyi ihracat faturası yapmaz, satış yurt içinde yapılmıştır.
  const yolcu = yolcuBeraberiOzeti(fatura);
  const ihracat = yolcu.yolcuBeraberi ? IHRACAT_DEGIL : ihracatOzeti(fatura, { efaturaAcik });
  const internet = internetSatisOzeti(fatura);
  const iade = iadeOzeti(fatura);
  if (iade.iade && ihracat.yurtDisi) throw new BadRequestException(YURT_DISI_IADE_ENGELI);
  const engeller = [...ihracat.engeller, ...internet.engeller, ...iade.engeller, ...yolcu.engeller].map((e) => e.mesaj);
  if (yolcu.yolcuBeraberi && fatura.ihracKayitliKodu) {
    engeller.push("Yolcu beraberi satışta ihraç kayıtlı işareti bulunamaz");
  }
  // EBLG-60: ihraç kayıtlı satış yurt içindeki ihracatçıya yapılır; alıcı yurt
  // dışındaysa belge ihracat faturasıdır, ikisi birden olamaz.
  if (ihracat.yurtDisi && fatura.ihracKayitliKodu) {
    engeller.push("Alıcı yurt dışında; ihraç kayıtlı satış yurt içindeki ihracatçıya kesilir. Faturadaki ihraç kayıtlı işaretini kaldırın");
  }
  if (engeller.length) {
    throw new BadRequestException(engeller.join("; "));
  }
  // Yolcu beraberinde alıcı Gümrük Bakanlığı'dır; genel carinin VKN'si aranmaz.
  // Yurt dışı alıcının Türk VKN'si olmaz (EBLG-80); e-Arşiv'de 2222222222 yazılır.
  if (!ihracat.yurtDisi && !yolcu.yolcuBeraberi && !fatura.cari.vknTckn) {
    throw new BadRequestException("Alıcının geçerli bir VKN/TCKN bilgisi olmalıdır");
  }
  if (!gonderimTarihiGecerliMi(fatura.tarih)) {
    throw new BadRequestException("Fatura tarihi bugün veya en fazla 7 gün önce olmalıdır");
  }
  return { ihracat, internet, iade, yolcu };
}


/** Gelen kutusu listesinin sütunları; XML bilerek seçilmez. */
const GELEN_LISTE_SECIMI = {
  id: true, uuid: true, belgeNo: true, gonderenVkn: true, gonderenUnvan: true, tarih: true, profilId: true,
  durum: true, yanit: true, yanitGerekce: true, faturaId: true,
  satirSayisi: true, genelToplam: true, dovizCinsi: true, okunabilir: true, denetimUyariSayisi: true,
  fatura: { select: { id: true, no: true, durum: true } },
} as const satisfies Prisma.GelenEbelgeSelect;

@Injectable()
export class EbelgeService {
  private readonly logger = new Logger(EbelgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilarService: BaglantilarService,
    @Inject(forwardRef(() => FaturaService))
    private readonly faturaService: FaturaService,
    private readonly mukellefListesi: MukellefListesiService,
    private readonly metrics: MetricsService,
    private readonly bildirimler: BildirimService,
    private readonly ayarlar: AyarlarService,
    private readonly belgeler: BelgelerService,
    @Optional() private readonly mevzuat?: MevzuatService,
    @Optional() private readonly xmlDepo?: GelenXmlDeposu,
  ) {}

  /** MVZ-11/12: gelen belgenin tarihindeki merkezi tablolar (karşı tarafın belgesi: firmanın gizledikleri de tanınır). */
  private async gelenTablolari(tarih: string) {
    const [tevkifat, kod] = await Promise.all([firmaTevkifatTablosu({ mevzuat: this.mevzuat }, tarih), belgeKodTablosu(this.mevzuat, tarih)]);
    return { tevkifat, kod };
  }

  // ─── E-BELGE GÖNDERİMİ (EBLG-01/02/06/07) ──────────────────────────────────

  /**
   * EBLG-76: sihirbazda seçilen sevkiyat yolunu faturaya yazar. `irsaliye`
   * seçilen e-İrsaliyeleri faturaya bağlar (belgeye `DespatchDocumentReference`
   * olarak gider), `fatura_once` sonradan kesilecek irsaliyeyi bekler,
   * `irsaliye_yerine` ise fiili sevk anını saklar — o faturada hiç irsaliye
   * düzenlenmez, belge ibareyi kendisi taşır.
   */
  async sevkiyatBaglantisiniKaydet(faturaId: string, secim: { yontem: SevkiyatYontemi; irsaliyeIds: string[]; fiiliSevkZamani?: string | null }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { cariId: true, tip: true, durum: true, ebelge: { select: { durum: true } } } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "kesin" || fatura.tip !== "satis") throw new BadRequestException("Sevkiyat bağlantısı yalnız kesinleşmiş satış faturasında düzenlenebilir");
      if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum)) throw new ConflictException("Gönderilmiş faturanın sevkiyat bağlantısı değiştirilemez");
      const ids = secim.yontem === "irsaliye" ? [...new Set(secim.irsaliyeIds)] : [];
      if (secim.yontem !== "irsaliye" && secim.irsaliyeIds.length) throw new BadRequestException("İrsaliye yalnız \"e-İrsaliye düzenlendi\" yolunda seçilebilir");
      if (secim.yontem === "irsaliye" && !ids.length) throw new BadRequestException("Bu satışa ait en az bir gönderilmiş e-İrsaliye seçin");
      const sevkZamani = secim.yontem === "irsaliye_yerine" ? new Date(secim.fiiliSevkZamani ?? "") : null;
      if (secim.yontem === "irsaliye_yerine" && (!sevkZamani || Number.isNaN(sevkZamani.getTime()))) {
        throw new BadRequestException("İrsaliye yerine geçen faturada fiili sevk tarihi ve saati zorunludur");
      }
      const belgeler = await tx.belge.findMany({ where: { id: { in: ids }, tenantId, cariId: fatura.cariId, tur: "irsaliye", yon: "satis", OR: [{ durum: "onaylandi", faturaId: null }, { faturaId }] }, include: { eirsaliye: true } });
      if (belgeler.length !== ids.length || belgeler.some((b) => !b.no || !b.eirsaliye || !["iletildi", "kabul", "kismi_kabul"].includes(b.eirsaliye.durum))) throw new BadRequestException("Yalnız aynı müşteriye gönderilmiş e-İrsaliyeler seçilebilir");
      // Yol değiştiyse önceki bağlantılar çözülür; irsaliye başka faturaya
      // bağlanabilsin diye kaydı silmeden yalnız bağı kaldırıyoruz. Bağlama ve
      // çözme FTR-26 yolundan geçer: irsaliye "kapandı"/"onaylı" olur, kesin
      // faturada sipariş rezervi de izlenir.
      const oncekiler = await tx.belge.findMany({ where: { tenantId, faturaId, tur: "irsaliye", id: { notIn: ids }, eirsaliye: { isNot: null } }, select: { id: true } });
      for (const onceki of oncekiler) await this.belgeler.irsaliyeBaginiKaldirTx(tx, tenantId, onceki.id);
      if (ids.length) await this.belgeler.irsaliyeBaglaTx(tx, tenantId, faturaId, ids);
      await tx.fatura.update({ where: { id: faturaId }, data: { sevkiyatYontemi: secim.yontem, fiiliSevkZamani: sevkZamani } });
    });
  }

  /** Gönderim öncesi wizard önizlemesi. Fatura kesinleşmiş olabilir ancak
   * bu çağrı e-belge kaydı oluşturmaz ve dış sisteme belge göndermez; yalnızca
   * mükellefiyet/bağlantı kontrolünü yapar. */
  /** EBLG-113: sihirbazda yazılan taşıyıcı VKN'sinin eşleştiği cari kartı. */
  async tasiyiciCari(vkn: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => ({ cari: tasiyiciCariOzeti(await tasiyiciCariBul(tx, vkn)) }));
  }

  async wizardBilgisi(faturaId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        include: {
          cari: { include: { adresler: true } },
          satirlar: {
            select: {
              id: true,
              miktar: true,
              birim: true,
              ihracatKapCinsi: true,
              ihracatKapNo: true,
              ihracatKapAdet: true,
              idisEtiketNo: true,
              sarjUniteSeriNo: true,
              kdvOrani: true,
              gibIstisnaKodu: true,
              // EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri.
              ytbHarcamaTipi: true,
              ytbMakineAdi: true,
              ytbMakineId: true,
              ytbMakineSiraNo: true,
              stok: { select: { kod: true, ad: true, tip: true, gtipKodu: true, mensei: true } },
            },
          },
          ebelge: { select: { id: true, durum: true, tur: true, entegratorRef: true, updatedAt: true } },
          iadeReferanslari: true,
        },
      });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "kesin") throw new BadRequestException("e-Fatura wizard'ı yalnızca kesinleşmiş faturalar için açılabilir");
      if (!ebelgeGonderilebilirTipMi(fatura.tip)) throw new BadRequestException(TIP_GONDERILEMEZ);
      if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum) && !takiliRezervasyonMu(fatura.ebelge)) {
        throw new BadRequestException("Bu fatura için zaten e-belge gönderim süreci başlatılmış");
      }
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { saglayici: true, sifreliConfig: true } });
      if (!baglanti) return { gonderilebilir: false, neden: "Aktif bir e-belge entegratör bağlantısı bulunamadı.", faturaNo: fatura.no, cari: fatura.cari.unvan };
      // Kural gönderim adımıyla aynıdır (EBLG-47), sihirbaz gönderilebilir olanı
      // gönderilemez göstermesin.
      const testOrtami = Boolean((JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).testOrtami);
      // İhracatta alıcının VKN'si yoktur; belgeye GİB'in yurt dışı alıcı
      // sabiti yazılır, kart üzerindeki kimlik hiç kullanılmaz.
      const yolcu = yolcuBeraberiOzeti(fatura);
      const internet = internetSatisOzeti(fatura);
      const iade = iadeOzeti(fatura);
      const firma = await tx.tenant.findUnique({ where: { id: tenantId } });
      // EBLG-76/77: sevkiyat yalnız firma e-İrsaliye mükellefiyse sorulur.
      const sevkiyatSorulur = sevkiyatSorulurMu(fatura);
      const uygulamalar = firma
        ? await ebelgeUygulamalariCozTenant(tx, firma)
        : ebelgeUygulamalariCoz({ elle: { efatura: null, earsiv: null, eirsaliye: null }, liste: { efatura: false, eirsaliye: false, guncel: false } });
      // EBLG-80: yurt dışı satışın türü firmanın e-Fatura kullanımına bağlıdır.
      const ihracat = yolcu.yolcuBeraberi ? IHRACAT_DEGIL : ihracatOzeti(fatura, { efaturaAcik: uygulamalar.efatura.acik });
      const mukellefiyet = { mukellef: uygulamalar.eirsaliye.acik, kaynak: uygulamalar.eirsaliye.kaynak };
      const irsaliyeAdaylari = sevkiyatSorulur && mukellefiyet.mukellef ? await tx.belge.findMany({
        where: { tenantId, cariId: fatura.cariId, tur: "irsaliye", yon: "satis", OR: [{ durum: "onaylandi", faturaId: null }, { faturaId }], eirsaliye: { is: { durum: { in: ["iletildi", "kabul", "kismi_kabul"] } } } },
        orderBy: { tarih: "desc" }, take: 50, select: { id: true, no: true, tarih: true, faturaId: true, fiiliSevkZamani: true },
      }).then((adaylar) => adaylar.map(({ fiiliSevkZamani, ...a }) => ({ ...a, sevkGunu: irsaliyeSevkGunu({ fiiliSevkZamani, tarih: a.tarih }) }))) : [];
      // EBLG-82: fatura irsaliyenin faturalama süresinden sonra düzenlendiyse
      // sihirbaz uyarır (engel değil). Bağlı her irsaliye sayılır — kâğıt
      // irsaliyeden dönüşen fatura da, sihirbazda seçilen e-İrsaliye de.
      // MVZ-13: faturalama süresi Mevzuat Merkezi'nden (fatura tarihindeki).
      const irsaliyeFaturaGunSayisi = await kanuniDegerOku(tx, "irsaliye_fatura_gun", fatura.tarih, IRSALIYE_FATURA_GUN_SAYISI);
      const bagliIrsaliyeler = fatura.tip === "satis"
        ? await tx.belge.findMany({ where: { tenantId, faturaId: fatura.id, tur: "irsaliye" }, select: { no: true, tarih: true, fiiliSevkZamani: true } })
        : [];
      const irsaliyeGecikmeleri = faturaGecikmeUyarilari({
        faturaTarihi: fatura.tarih.toISOString().slice(0, 10),
        yon: "satis",
        irsaliyeler: bagliIrsaliyeler.map((i) => ({ no: i.no, sevkGunu: irsaliyeSevkGunu(i) })),
        gunSayisi: irsaliyeFaturaGunSayisi,
      });
      // Gönderimdeki sayımın aynısı (bkz. `belgeUblHazirla`): bağlı irsaliyenin
      // belge durumuna bakılmaz, yalnız e-İrsaliyesinin gitmiş olmasına.
      const bagliIrsaliyeSayisi = sevkiyatSorulur && fatura.sevkiyatYontemi === "irsaliye"
        ? await tx.belge.count({ where: { tenantId, faturaId: fatura.id, tur: "irsaliye", yon: "satis", eirsaliye: { is: { durum: { in: ["iletildi", "kabul", "kismi_kabul"] } } } } })
        : 0;
      // Yolcu beraberi satış genel bir cariye kesilir; o carinin VKN'si yoktur.
      // Kimlik kontrolü bu yüzden satış faturasında durdurucu değil, eksik
      // olarak bildirilir: işaret konursa belge zaten Bakanlığa gider.
      const vknYok = !vknTcknKabulEdilebilirMi(fatura.cari.vknTckn, testOrtami);
      const yolcuOlabilir = fatura.tip === "satis" && !ihracat.yurtDisi;
      if (iade.iade && ihracat.yurtDisi) {
        return { gonderilebilir: false, neden: YURT_DISI_IADE_ENGELI, faturaNo: fatura.no, cari: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, saglayici: baglanti.saglayici };
      }
      if (!ihracat.yurtDisi && vknYok && !(yolcuOlabilir && (yolcu.yolcuBeraberi || !fatura.cari.vknTckn))) {
        return { gonderilebilir: false, neden: "Alıcının geçerli bir VKN/TCKN bilgisi olmalıdır.", faturaNo: fatura.no, cari: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, saglayici: baglanti.saglayici };
      }
      if (!gonderimTarihiGecerliMi(fatura.tarih)) {
        return { gonderilebilir: false, neden: "Fatura tarihi bugün veya en fazla 7 gün önce olmalıdır.", faturaNo: fatura.no, cari: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, saglayici: baglanti.saglayici };
      }
      // EBLG-62: firma adresi eksikse sihirbaz ilk adımda durur.
      const firmaEksigi = firma ? firmaEbelgeEksikleri(firma) : [];
      if (firmaEksigi.length) {
        return { gonderilebilir: false, neden: firmaEksigi.join("; "), faturaNo: fatura.no, cari: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, saglayici: baglanti.saglayici };
      }
      // KAMU senaryosu: liste türü sihirbazda kanal kararından önce okunur.
      // Harcama birimi faturada yoksa kartın varsayılanı, o da yoksa alıcının
      // kendisi önerilir (genel bütçeli kurumda iki VKN aynıdır).
      const listeTuru = ihracat.yurtDisi || yolcu.yolcuBeraberi ? undefined : await this.mukellefListesi.listeTuru(fatura.cari.vknTckn);
      const kamuMu = !ihracat.yurtDisi && !yolcu.yolcuBeraberi && kamuSenaryosuMu({ listeTuru, kartIsareti: fatura.cari.kamuIdaresi });
      const kamuHesaplari = kamuMu
        ? await tx.bankaHesap.findMany({
            where: { tenantId, aktif: true, dovizCinsi: "TRY", iban: { not: null } },
            orderBy: { ad: "asc" },
            select: { id: true, ad: true, bankaAdi: true, iban: true },
          })
        : [];
      const kamuBilgisi = kamuMu
        ? {
            harcamaBirimiVkn: fatura.kamuHarcamaBirimiVkn ?? fatura.cari.harcamaBirimiVkn ?? fatura.cari.vknTckn,
            harcamaBirimiAdi: fatura.kamuHarcamaBirimiAdi ?? fatura.cari.harcamaBirimiAdi ?? fatura.cari.unvan,
            iban: fatura.kamuIban ?? kamuHesaplari[0]?.iban ?? null,
          }
        : undefined;
      // Şarj faturası (EBLG-71): tip satırdaki stok kartından türemiştir;
      // sihirbaz plakayı, şarj süresini ve ESU raporlarını toplar.
      const sarjTuru = fatura.senaryo === "sarj" || fatura.senaryo === "sarjanlik" ? (fatura.senaryo as SarjTuru) : null;
      const sarjBilgisi = sarjTuru
        ? {
            turu: sarjTuru,
            plaka: fatura.sarjPlaka ?? null,
            baslangic: fatura.sarjBaslangic ? fatura.sarjBaslangic.toISOString().slice(0, 16) : null,
            bitis: fatura.sarjBitis ? fatura.sarjBitis.toISOString().slice(0, 16) : null,
            esuRaporlari: ((fatura.sarjEsuRaporlari as { raporId: string; tarih: string }[] | null) ?? []),
            satirlar: fatura.satirlar.map((satir, index) => ({ sira: index + 1, stok: satir.stok.ad, uniteSeriNo: satir.sarjUniteSeriNo })),
          }
        : undefined;
      // SGK faturası: karar alıcının VKN'sinden gelir. Sabit alanların
      // (grup, Kurum'daki kod ve ad) varsayılanı firma kartındadır; dosya no
      // ve dönem her faturada sihirbazda girilir (EBLG-70).
      const sgkMu = sgkFaturasiMi(fatura.cari.vknTckn) && fatura.tip === "satis";
      const sgkBilgisi = sgkMu
        ? {
            ilaveFaturaTipi: fatura.sgkIlaveFaturaTipi ?? firma?.sgkIlaveFaturaTipi ?? null,
            mukellefKodu: fatura.sgkMukellefKodu ?? firma?.sgkMukellefKodu ?? null,
            mukellefAdi: fatura.sgkMukellefAdi ?? firma?.sgkMukellefAdi ?? null,
            dosyaNo: fatura.sgkDosyaNo ?? null,
            donemBaslangic: fatura.sgkDonemBaslangic ? fatura.sgkDonemBaslangic.toISOString().slice(0, 10) : null,
            donemBitis: fatura.sgkDonemBitis ? fatura.sgkDonemBitis.toISOString().slice(0, 10) : null,
          }
        : undefined;
      // EBLG-134: engel değil; belgeyi durdurmaz, uyarı ve bilgi olarak gösterilir.
      const ebelgeAyari = this.ayarlar ? await this.ayarlar.getir("ebelge", tx) : {};
      const onDenetim = await onDenetimCalistir(tx, tenantId, faturaId, {
        yurtDisi: ihracat.yurtDisi,
        esikler: { fiyatYuzde: ebelgeAyari.onDenetimFiyatYuzde as number | undefined, kurYuzde: ebelgeAyari.onDenetimKurYuzde as number | undefined },
      });
      return {
        // Bağlantı, kimlik ve tarih kontrolleri geçti. Türe özel eksikler
        // (ihracat, internet satışı) kendi listelerinde döner: değerleri
        // sihirbazda girilir, gönderim aynı kuralı kaydettikten sonra yeniden
        // uygular ve eksikse belgeyi göndermez.
        gonderilebilir: true,
        faturaNo: fatura.no,
        cari: fatura.cari.unvan,
        vknTckn: fatura.cari.vknTckn,
        saglayici: baglanti.saglayici,
        mevcutEbelge: fatura.ebelge,
        cariId: fatura.cariId,
        onDenetim,
        // EBLG-77: sihirbaz kanalı ve kapalı yordamları buna göre gösterir.
        uygulamalar,
        sevkiyat: {
          ...mukellefiyet,
          gerekli: sevkiyatSorulur,
          yontem: fatura.sevkiyatYontemi,
          fiiliSevkZamani: fatura.fiiliSevkZamani?.toISOString() ?? null,
          adaylar: irsaliyeAdaylari,
          irsaliyeFaturaGunSayisi,
          gecikmeler: irsaliyeGecikmeleri,
          // Gönder ucu kuyruğa almadan önce bunlara bakar; yoksa eksik belge
          // kuyrukta düşer ve kullanıcı önce "gönderildi" görür.
          engeller: sevkiyatEksikleri({
            sorulur: sevkiyatSorulur,
            mukellef: mukellefiyet.mukellef,
            yontem: fatura.sevkiyatYontemi,
            irsaliyeSayisi: bagliIrsaliyeSayisi,
            fiiliSevkZamani: fatura.fiiliSevkZamani,
          }).map((mesaj) => ({ mesaj })),
        },
        earsivGonderimSekli: fatura.earsivGonderimSekli,
        // EBLG-60: faturada işaretlenir; sihirbaz yalnız gösterir.
        ihracKayitliKodu: fatura.ihracKayitliKodu,
        // İhracat faturasında kanal sorulmaz, alıcının ülkesinden gelir; sihirbaz
        // kararı gerekçesiyle gösterir ve türe özel alanları toplar (EBLG-53).
        ihracat: ihracat.ihracat
          ? {
              ulkeKodu: ihracat.ulkeKodu,
              ulkeAdi: ihracat.ulkeAdi,
              teslimTarihi: fatura.ihracatTeslimTarihi,
              teslimSarti: fatura.ihracatTeslimSarti,
              tasimaSekli: fatura.ihracatTasimaSekli,
              beyannameNo: fatura.gumrukBeyannameNo,
              // EBLG-103: kap bilgisi kalem bazında girilir.
              satirlar: fatura.satirlar.map((satir, index) => ({
                id: satir.id,
                sira: index + 1,
                stokAdi: satir.stok.ad,
                miktar: Number(satir.miktar),
                birim: satir.birim,
                kapCinsi: satir.ihracatKapCinsi,
                kapNo: satir.ihracatKapNo,
                kapAdet: satir.ihracatKapAdet,
              })),
              engeller: ihracat.engeller,
              menseiEksikleri: ihracat.menseiEksikleri,
            }
          : undefined,
        // EBLG-80: yurt dışı alıcıya e-Arşiv istisna; gümrük alanları istenmez.
        yurtDisiEarsiv: ihracat.yurtDisiEarsiv
          ? { ulkeKodu: ihracat.ulkeKodu, ulkeAdi: ihracat.ulkeAdi, engeller: ihracat.engeller }
          : undefined,
        // TCKN'li alıcıda e-Arşiv'e yazılacak ad/soyad; kartta yoksa tahmin
        // edildiği sihirbazda gösterilir (CARI-21).
        aliciAdi: fatura.cari.vknTckn?.length === 11 ? adSoyadCoz(fatura.cari) : undefined,
        // İnternet satışı alan grubu yalnız e-Arşiv kanalında belgeye yazılır;
        // işaret ve alanlar sihirbazda toplanır (EBLG-56).
        internetSatisi: {
          isaretli: internet.internetSatisi,
          webAdresi: fatura.internetWebAdresi,
          odemeSekli: fatura.internetOdemeSekli,
          odemeTarihi: fatura.internetOdemeTarihi,
          odemeAracisi: fatura.internetOdemeAracisi,
          tasiyiciUnvan: fatura.internetTasiyiciUnvan,
          tasiyiciVkn: fatura.internetTasiyiciVkn,
          gonderiTarihi: fatura.internetGonderiTarihi,
          siparisNo: fatura.siparisNo,
          siparisTarihi: fatura.siparisTarihi,
          // Malın gideceği adres kartta var mı; sihirbaz eksikleri bununla üretir.
          teslimatAdresiVar: internet.teslimatAdresiVar,
          engeller: internet.engeller,
        },
        // İade faturasında iade edilen faturalar (EBLG-58). Adaylar aynı
        // tedarikçinin, iadeden önce kesinleşmiş ve GİB numaralı alış
        // faturalarıdır; listede olmayan fatura sihirbazda elle girilir.
        iade: iade.iade
          ? {
              referanslar: iade.referanslar,
              adaylar: (
                await tx.fatura.findMany({
                  where: { cariId: fatura.cariId, tip: "alis", durum: "kesin", no: { not: null }, tarih: { lte: fatura.tarih } },
                  orderBy: { tarih: "desc" },
                  take: 50,
                  select: { id: true, no: true, tarih: true, genelToplam: true, dovizCinsi: true },
                })
              ).filter((aday) => gibBelgeNoMu(aday.no)),
              engeller: iade.engeller,
            }
          : undefined,
        // KAMU senaryosu: harcama birimi ve IBAN sihirbazın Bilgiler adımında
        // seçilir; gönderim aynı kuralı faturadaki değerlerle yeniden uygular.
        kamu: kamuBilgisi
          ? {
              kaynak: listeTuru === MUKELLEF_TURU_KAMU ? ("liste" as const) : ("kart" as const),
              ...kamuBilgisi,
              hesaplar: kamuHesaplari,
              engeller: kamuEngelleri(kamuBilgisi),
            }
          : undefined,
        // SGK faturası: ilave fatura tipi, Kurum'daki kod/ad, dosya no ve dönem
        // sihirbazın Bilgiler adımında toplanır; gönderim aynı kuralı
        // faturadaki değerlerle yeniden uygular.
        sgk: sgkBilgisi ? { ...sgkBilgisi, engeller: sgkEngelleri(sgkBilgisi) } : undefined,
        // Şarj faturası: plaka, şarj süresi ve ESU raporları sihirbazda
        // girilir; ünite seri numarası satırda durur ve burada yalnız eksikse
        // uyarılır (EBLG-71).
        sarj: sarjBilgisi ? { ...sarjBilgisi, engeller: sarjEngelleri(sarjBilgisi) } : undefined,
        // İDİS: sevkiyat no ve etiket no fatura formunda girilir; sihirbaz
        // yalnız eksikleri gösterir (EBLG-72).
        idis: fatura.idisSevkiyatNo
          ? {
              sevkiyatNo: fatura.idisSevkiyatNo,
              engeller: idisEngelleri({
                sevkiyatNo: fatura.idisSevkiyatNo,
                satirlar: fatura.satirlar.map((satir, index) => ({ sira: index + 1, etiketNo: satir.idisEtiketNo })),
              }),
            }
          : undefined,
        // Yatırım teşvik (EBLG-78): YTB no/tarihi fatura başlığında, harcama
        // tipi ve makine bilgileri satırlarda girilir; sihirbaz yalnız
        // eksikleri gösterir. İDİS'teki düzenin aynısı.
        ytb: ytbBelgesiMi(fatura.ytbNo)
          ? {
              ytbNo: fatura.ytbNo,
              ytbTarihi: fatura.ytbTarihi ? fatura.ytbTarihi.toISOString().slice(0, 10) : null,
              engeller: ytbEngelleri(ytbGirdisi(fatura)),
            }
          : undefined,
        // Yolcu beraberi (tax-free): işaret sihirbazda konur, yolcu bilgisi
        // faturaya yazılır. Aracı kurum firma kartındaki varsayılandan gelir.
        yolcuBeraberi: yolcuOlabilir
          ? {
              isaretli: yolcu.yolcuBeraberi,
              aliciVknEksik: vknYok,
              yolcu: yolcu.bilgi?.yolcu ?? {},
              araciKurum: yolcu.bilgi?.araciKurum?.vkn
                ? yolcu.bilgi.araciKurum
                : { vkn: firma?.araciKurumVkn ?? null, etiket: firma?.araciKurumEtiket ?? null, unvan: firma?.araciKurumUnvan ?? null },
              engeller: yolcu.engeller,
            }
          : undefined,
        // Kartta adres yoksa belgeye şehir uydurulmaz, alanlar "-" gider
        // (EBLG-55); belgeyi durdurmaz ama sihirbazda söylenir.
        adresEksik: ublAdresi(fatura.cari.adresler).eksik,
        // Birimi GİB kod listesinde karşılığı olmayan satırlar belgeye "adet"
        // olarak gider; sessiz kalmasın diye sihirbazda söylenir.
        birimUyarilari: fatura.satirlar
          .map((satir, index) => ({ sira: index + 1, stok: satir.stok.ad, birim: satir.birim }))
          .filter((satir) => !birimTanindiMi(satir.birim)),
        not: yolcu.yolcuBeraberi
          ? "Yolcu beraberi satış: belge Gümrük Bakanlığı'na gider, gümrük çıkışında onaylanır ve KDV iadesini aracı kurum yapar. Satış iptali/iadesi ayrıca GİB'in Tax-Free Satış İptal/İade Bildirim Portalı'ndan bildirilmelidir."
          : sarjTuru
          ? "Belge şarj faturası olarak düzenlenir: satırdaki hizmet kartı şarj hizmeti/ünitesi olduğu için tip SARJ ya da SARJANLIK'tır; plaka ve şarj süresi belgeye yazılır."
          : fatura.idisSevkiyatNo
          ? "Sevkiyat numarası girildiği için belge İnşaat Demiri İzleme Sistemi (İDİS) profiliyle gider; her satırda etiket numarası bulunmalıdır."
          : sgkMu
          ? "Alıcı Sosyal Güvenlik Kurumu olduğu için belge SGK tipiyle ve Temel Fatura senaryosuyla düzenlenir: ilave fatura tipi, Kurum'daki mükellef kodu/adı, dosya no ve dönem belgeye yazılır."
          : kamuMu
          ? "Alıcı kamu idaresi olduğu için belge KAMU senaryosuyla düzenlenir: ödemeyi yapacak harcama birimi ve ödemenin yapılacağı IBAN belgeye yazılır."
          : ihracat.ihracat
          ? "Alıcı yurt dışı olduğu için belge ihracat faturası olarak düzenlenir: mükellefiyet sorgulanmaz, belge Ticaret Bakanlığı'nın posta kutusuna gider ve satırlar KDV'den istisna yazılır."
          : ihracat.yurtDisiEarsiv
          ? "Alıcı yurt dışı; belge e-Arşiv istisna faturası olarak düzenlenir (hizmet satışı ya da firma e-Fatura kullanmıyor): alıcı kimliği 2222222222 yazılır, satırlar 301 (mal) / 302 (hizmet) ile KDV'den istisnadır."
          : "Mükellefiyet kontrolü gönderim onayında tekrar doğrulanır.",
      };
    });
  }

  /**
   * Sihirbazda seçilen e-Arşiv teslim şeklini faturaya yazar (EBLG-26).
   * Gönderim kuyruktan yürüdüğü için UBL seçimi faturadan okur; kanal e-Fatura
   * çıkarsa değer kullanılmaz.
   */
  async earsivGonderimSekliniKaydet(faturaId: string, sekil: EarsivGonderimSekli) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.update({ where: { id: faturaId }, data: { earsivGonderimSekli: sekil } }),
    );
  }

  /**
   * Sihirbazda girilen ihracat alanlarını faturaya yazar (EBLG-53). Gönderim
   * kuyruktan yürüdüğü için UBL bu değerleri faturadan okur; belge ihracat
   * olarak düzenlenmezse alanlar kullanılmaz.
   */
  async ihracatBilgisiniKaydet(
    faturaId: string,
    bilgi: {
      teslimTarihi?: Date | null;
      teslimSarti?: string | null;
      tasimaSekli?: string | null;
      satirlar?: { id: string; kapCinsi?: string | null; kapNo?: string | null; kapAdet?: number | null }[];
    },
  ) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.fatura.update({
        where: { id: faturaId },
        data: {
          ihracatTeslimTarihi: bilgi.teslimTarihi ?? null,
          ihracatTeslimSarti: bilgi.teslimSarti ?? null,
          ihracatTasimaSekli: bilgi.tasimaSekli ?? null,
        },
      });
      // EBLG-103: kap bilgisi kalem bazındadır; satır başka faturanınsa yazılmaz.
      for (const satir of bilgi.satirlar ?? []) {
        const sonuc = await tx.faturaSatir.updateMany({
          where: { id: satir.id, faturaId },
          data: {
            ihracatKapCinsi: satir.kapCinsi || null,
            ihracatKapNo: satir.kapNo?.trim() || null,
            ihracatKapAdet: satir.kapAdet ?? null,
          },
        });
        if (sonuc.count !== 1) throw new BadRequestException("Kap bilgisi girilen satır bu faturaya ait değil");
      }
    });
  }

  /**
   * Gümrük beyanname bilgisini faturaya işler (EBLG-54).
   *
   * Beyanname numarası gümrük çıkışı kapandıktan sonra, belge çoktan
   * gönderilmişken belli olur. Karar (2026-09-18): numara yalnız kayda işlenir,
   * gönderilmiş belge GİB'e yeniden gönderilmez — imzalanıp iletilmiş e-Fatura
   * zaten değiştirilemez, gümrük eşleşmesi fatura UUID'si üzerinden yürür.
   * Numara gönderimden önce girilmişse belgeye `CUST_INV` referansı olarak gider.
   */
  async gumrukBeyannamesiniKaydet(faturaId: string, bilgi: { no: string | null; tarih?: Date | null }) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { id: true, durum: true } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "kesin") throw new BadRequestException("Gümrük beyanname bilgisi yalnızca kesinleşmiş faturaya işlenir");
      await tx.fatura.update({
        where: { id: faturaId },
        data: { gumrukBeyannameNo: bilgi.no?.trim() || null, gumrukBeyannameTarihi: bilgi.tarih ?? null },
      });
    });
  }

  /**
   * Sihirbazda seçilen iade referanslarını yazar (EBLG-58); öncekilerin yerini
   * alır. Listeden seçilen faturanın numarası ve tarihi istemciden değil kendi
   * kaydından okunur, ve yalnız aynı tedarikçinin kesinleşmiş alış faturası
   * seçilebilir. Elle girilen numara olduğu gibi (büyük harfle) saklanır.
   */
  /**
   * Yolcu beraberi (tax-free) işareti ve yolcu bilgisi faturaya yazılır; işaret
   * kalkınca kayıt tümüyle silinir.
   */
  async yolcuBeraberiniKaydet(
    faturaId: string,
    secim: { isaretli: boolean; yolcu?: Prisma.InputJsonObject; araciKurum?: Prisma.InputJsonObject },
  ) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.fatura.updateMany({
        where: { id: faturaId, durum: "kesin" },
        data: { yolcuBeraberi: secim.isaretli ? { yolcu: secim.yolcu ?? {}, araciKurum: secim.araciKurum ?? {} } : Prisma.DbNull },
      });
      if (sonuc.count !== 1) throw new NotFoundException("Kesinleşmiş fatura bulunamadı");
    });
  }

  /** KAMU senaryosu: sihirbazda seçilen harcama birimi ve IBAN faturaya yazılır. */
  async kamuBilgisiniKaydet(faturaId: string, bilgi: { harcamaBirimiVkn?: string | null; harcamaBirimiAdi?: string | null; iban?: string | null }) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.fatura.updateMany({
        where: { id: faturaId, durum: "kesin" },
        data: {
          kamuHarcamaBirimiVkn: bilgi.harcamaBirimiVkn?.trim() || null,
          kamuHarcamaBirimiAdi: bilgi.harcamaBirimiAdi?.trim() || null,
          kamuIban: bilgi.iban ? ibanNormalize(bilgi.iban) : null,
        },
      });
      if (sonuc.count !== 1) throw new NotFoundException("Kesinleşmiş fatura bulunamadı");
    });
  }

  /** Şarj faturası: sihirbazda girilen plaka, şarj süresi ve ESU raporları faturaya yazılır. */
  async sarjBilgisiniKaydet(faturaId: string, bilgi: {
    plaka?: string | null; baslangic?: string | null; bitis?: string | null;
    esuRaporlari?: { raporId: string; tarih: string }[] | null;
  }) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.fatura.updateMany({
        where: { id: faturaId, durum: "kesin" },
        data: {
          sarjPlaka: bilgi.plaka ? sarjPlakaNormalize(bilgi.plaka) : null,
          sarjBaslangic: bilgi.baslangic ? new Date(`${bilgi.baslangic}:00.000Z`) : null,
          sarjBitis: bilgi.bitis ? new Date(`${bilgi.bitis}:00.000Z`) : null,
          sarjEsuRaporlari: bilgi.esuRaporlari?.length ? bilgi.esuRaporlari : Prisma.DbNull,
        },
      });
      if (sonuc.count !== 1) throw new NotFoundException("Kesinleşmiş fatura bulunamadı");
    });
  }

  /** SGK faturası: sihirbazda girilen grup, kod/ad, dosya no ve dönem faturaya yazılır. */
  async sgkBilgisiniKaydet(faturaId: string, bilgi: {
    ilaveFaturaTipi?: string | null; mukellefKodu?: string | null; mukellefAdi?: string | null;
    dosyaNo?: string | null; donemBaslangic?: string | null; donemBitis?: string | null;
  }) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.fatura.updateMany({
        where: { id: faturaId, durum: "kesin" },
        data: {
          sgkIlaveFaturaTipi: bilgi.ilaveFaturaTipi?.trim() || null,
          sgkMukellefKodu: bilgi.mukellefKodu?.trim() || null,
          sgkMukellefAdi: bilgi.mukellefAdi?.trim() || null,
          sgkDosyaNo: bilgi.dosyaNo?.trim() || null,
          sgkDonemBaslangic: bilgi.donemBaslangic ? new Date(`${bilgi.donemBaslangic}T00:00:00.000Z`) : null,
          sgkDonemBitis: bilgi.donemBitis ? new Date(`${bilgi.donemBitis}T00:00:00.000Z`) : null,
        },
      });
      if (sonuc.count !== 1) throw new NotFoundException("Kesinleşmiş fatura bulunamadı");
    });
  }

  async iadeReferanslariniKaydet(
    faturaId: string,
    referanslar: { kaynakFaturaId?: string | null; belgeNo?: string | null; tarih?: Date | null }[],
  ) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { id: true, tip: true, cariId: true } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.tip !== "alis_iade") throw new BadRequestException("İade referansı yalnız alış iade faturasına girilir");

      const kaynakIdleri = referanslar.map((r) => r.kaynakFaturaId).filter((id): id is string => Boolean(id));
      const kaynaklar = new Map(
        (await tx.fatura.findMany({
          where: { id: { in: kaynakIdleri }, cariId: fatura.cariId, tip: "alis", durum: "kesin" },
          select: { id: true, no: true, tarih: true },
        })).map((k) => [k.id, k]),
      );
      const satirlar = referanslar.map((ref, index) => {
        if (ref.kaynakFaturaId) {
          const kaynak = kaynaklar.get(ref.kaynakFaturaId);
          if (!kaynak?.no) throw new BadRequestException(`${index + 1}. referans bu tedarikçinin kesinleşmiş bir alış faturası değil`);
          return { kaynakFaturaId: kaynak.id, belgeNo: kaynak.no, tarih: kaynak.tarih };
        }
        const belgeNo = ref.belgeNo?.trim().toLocaleUpperCase("tr-TR");
        if (!belgeNo || !ref.tarih) throw new BadRequestException(`${index + 1}. referansın numarası ve tarihi girilmelidir`);
        return { kaynakFaturaId: null, belgeNo, tarih: ref.tarih };
      });
      if (new Set(satirlar.map((s) => s.belgeNo)).size !== satirlar.length) {
        throw new BadRequestException("Aynı fatura birden çok kez girilmiş");
      }

      await tx.faturaIadeReferansi.deleteMany({ where: { faturaId } });
      if (satirlar.length) {
        await tx.faturaIadeReferansi.createMany({
          data: satirlar.map((s, index) => ({ ...s, tenantId, faturaId, sira: index + 1 })),
        });
      }
    });
  }

  /**
   * Sihirbazda girilen internet satışı bilgisini faturaya yazar (EBLG-56).
   * İşaret kaldırılırsa alanlar da temizlenir; belgede "internet satışı" yazıp
   * ödeme bilgisi taşımayan bir kayıt kalmasın.
   */
  async internetSatisiniKaydet(
    faturaId: string,
    bilgi: {
      internetSatisi: boolean;
      webAdresi?: string | null;
      odemeSekli?: string | null;
      odemeTarihi?: Date | null;
      odemeAracisi?: string | null;
      tasiyiciUnvan?: string | null;
      tasiyiciVkn?: string | null;
      gonderiTarihi?: Date | null;
    },
  ) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.update({
        where: { id: faturaId },
        data: bilgi.internetSatisi
          ? {
              internetSatisi: true,
              internetWebAdresi: bilgi.webAdresi?.trim() || null,
              internetOdemeSekli: bilgi.odemeSekli ?? null,
              internetOdemeTarihi: bilgi.odemeTarihi ?? null,
              internetOdemeAracisi: bilgi.odemeAracisi?.trim() || null,
              internetTasiyiciUnvan: bilgi.tasiyiciUnvan?.trim() || null,
              internetTasiyiciVkn: bilgi.tasiyiciVkn?.trim() || null,
              internetGonderiTarihi: bilgi.gonderiTarihi ?? null,
            }
          : {
              internetSatisi: false,
              internetWebAdresi: null,
              internetOdemeSekli: null,
              internetOdemeTarihi: null,
              internetOdemeAracisi: null,
              internetTasiyiciUnvan: null,
              internetTasiyiciVkn: null,
              internetGonderiTarihi: null,
            },
      }),
    );
  }

  /**
   * Belgenin kanalını belirler ve gönderilecek UBL'i üretir. Gönderim ile
   * sihirbaz önizlemesi (L) aynı işlevi çağırır: önizlenen belge, gönderilecek
   * belgenin kendisidir.
   */
  private async belgeUblHazirla(
    adapter: ReturnType<BaglantilarService["adapterCoz"]>,
    hazirlik: {
      saglayici: string;
      cfg: EntegratorConfig;
      fatura: Parameters<typeof faturaUblUret>[0];
      tenant: { unvan: string; vkn: string; eirsaliyeMukellefi?: boolean | null } & FirmaEbelgeBilgisi;
      /** EBLG-77: firmanın kendi e-belge mükellefiyetleri; kanal kararı buna bağlı. */
      uygulamalar: EbelgeUygulamalari;
      ihracat: ReturnType<typeof ihracatOzeti>;
      internet: ReturnType<typeof internetSatisOzeti>;
      iade: ReturnType<typeof iadeOzeti>;
      yolcu: ReturnType<typeof yolcuBeraberiOzeti>;
    },
  ) {
    // EBLG-62: satıcı adresi belgede zorunlu; uydurma adresle belge kesilmez.
    const firmaEksigi = firmaEbelgeEksikleri(hazirlik.tenant);
    if (firmaEksigi.length) throw new BadRequestException(firmaEksigi.join("; "));
    // Kanal kararı lokal listeden verilir; gönderim başına entegratöre tam
    // liste sorulması bloklanma sebebiydi (EBLG-10). Alıcı yurt dışıysa liste
    // hiç sorulmaz: ihracat faturası e-Fatura kanalından, alıcının değil
    // Ticaret Bakanlığı'nın kutusuna gider (tasarım belgesi §3.1 adım 1).
    /*
     * EBLG-77: kanal kararında **satıcının kapsamı alıcınınkinden önce gelir.**
     * e-Fatura uygulamasına kayıtlı olmayan firma, alıcı mükellef olsa bile
     * e-Fatura kesemez; belge e-Arşiv'e düşer. İki uygulama da kapalıysa
     * fatura e-belge olarak hiç gönderilmez, kağıda basılır.
     */
    const uygulamalar = hazirlik.uygulamalar;
    // Alıcı listesi yalnız e-Fatura açıkken sorulur: e-Arşiv kullanıcısında
    // alıcının mükellefiyeti kanalı değiştirmez, liste de indirilmez.
    // EBLG-80: yurt dışı alıcıya e-Arşiv istisna kesilirken de liste sorulmaz.
    const mukellefiyet = !uygulamaAcik(uygulamalar, "efatura") || hazirlik.ihracat.yurtDisiEarsiv
      ? { eFaturaMukellefi: false, postaKutusu: undefined }
      : hazirlik.ihracat.ihracat
        ? { eFaturaMukellefi: true, postaKutusu: IHRACAT_POSTA_KUTUSU }
        // Yolcu beraberi de Bakanlığa gider, ama ihracatın kutusuna değil: aynı
        // VKN'nin yolcu beraberi için ayrı posta kutusu etiketi vardır.
        : hazirlik.yolcu.yolcuBeraberi
          ? { eFaturaMukellefi: true, postaKutusu: YOLCU_BERABER_POSTA_KUTUSU }
          : await this.mukellefListesi.kanalBelirle(hazirlik.saglayici, hazirlik.cfg, hazirlik.fatura.cari.vknTckn!, "efatura", hazirlik.fatura.cari.efaturaPostaKutusu);
    const kanalEngelleri = ebelgeKanalEngelleri({ uygulamalar, aliciEfaturaMukellefi: mukellefiyet.eFaturaMukellefi });
    if (kanalEngelleri.length) throw new BadRequestException(kanalEngelleri.join(" "));
    if (mukellefiyet.eFaturaMukellefi && uygulamaAcik(uygulamalar, "efatura") && !mukellefiyet.postaKutusu) {
      throw new BadRequestException("Alıcı e-Fatura mükellefi ancak GİB posta kutusu (alias) bulunamadı");
    }
    // Yolcu beraberi yalnız e-Fatura kanalında tanımlıdır. İhracat e-Faturası
    // da öyledir, ama e-Fatura kullanmayan firmada yurt dışı satış zaten
    // e-Arşiv istisna yoluna düşer (EBLG-80); buraya ihracat olarak gelmez.
    if (!uygulamaAcik(uygulamalar, "efatura") && (hazirlik.ihracat.ihracat || hazirlik.yolcu.yolcuBeraberi)) {
      throw new BadRequestException(hazirlik.ihracat.ihracat
        ? "Firmanın e-Fatura durumu bilinmeden ihracat faturası kesilemez"
        : "Yolcu beraberi faturası yalnız e-Fatura mükellefi firmada düzenlenebilir");
    }
    const tur: EbelgeTur = ebelgeKanali({ uygulamalar, aliciEfaturaMukellefi: mukellefiyet.eFaturaMukellefi }) === "efatura" ? "efatura" : "earsiv";
    /*
     * EBLG-76: sevkiyat denetimi. Kural firma e-İrsaliye mükellefiyse işler ve
     * e-Arşiv'e düşen belgede de aynıdır — irsaliye yükümlülüğü alıcının
     * mükellefiyetine değil satıcınınkine bağlıdır.
     */
    const { tenantId } = aktifBaglam();
    const sevkiyat = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const irsaliyeler = hazirlik.fatura.sevkiyatYontemi === "irsaliye"
        ? await tx.belge.findMany({ where: { tenantId, faturaId: hazirlik.fatura.id, tur: "irsaliye", yon: "satis", eirsaliye: { is: { durum: { in: ["iletildi", "kabul", "kismi_kabul"] } } } }, select: { no: true, tarih: true }, orderBy: { tarih: "asc" } })
        : [];
      // FTR-31: faturaya bağlı zincir belgelerinin müşteri referansları.
      const bagliReferanslar = await tx.belge.findMany({
        where: { tenantId, faturaId: hazirlik.fatura.id },
        select: { siparisNo: true, talepNo: true },
        orderBy: { tarih: "asc" },
      });
      return { irsaliyeler, bagliReferanslar, mukellef: hazirlik.uygulamalar.eirsaliye.acik };
    });
    const sevkiyatEngelleri = sevkiyatEksikleri({
      sorulur: sevkiyatSorulurMu(hazirlik.fatura),
      mukellef: sevkiyat.mukellef,
      yontem: hazirlik.fatura.sevkiyatYontemi,
      irsaliyeSayisi: sevkiyat.irsaliyeler.length,
      fiiliSevkZamani: hazirlik.fatura.fiiliSevkZamani,
    });
    if (sevkiyatEngelleri.length) throw new BadRequestException(sevkiyatEngelleri.join(" "));

    // KAMU senaryosu: alıcı listede KAMU türündeyse ya da kartında işaretliyse.
    // Kamu idaresi e-Fatura mükellefidir; e-Arşiv'e düşen belge KAMU olamaz.
    const kamu = !hazirlik.ihracat.yurtDisi && !hazirlik.yolcu.yolcuBeraberi && kamuSenaryosuMu({
      listeTuru: "kamu" in mukellefiyet && mukellefiyet.kamu ? MUKELLEF_TURU_KAMU : undefined,
      kartIsareti: hazirlik.fatura.cari.kamuIdaresi,
    });
    let kamuBilgisi: { harcamaBirimiVkn: string; harcamaBirimiAdi: string; iban: string } | undefined;
    if (kamu) {
      if (tur !== "efatura") {
        throw new BadRequestException("Alıcı kamu idaresi olarak işaretli ama GİB e-Fatura listesinde yok; KAMU senaryosu yalnız e-Fatura ile gönderilir");
      }
      const f = hazirlik.fatura;
      const engeller = kamuEngelleri({ harcamaBirimiVkn: f.kamuHarcamaBirimiVkn, harcamaBirimiAdi: f.kamuHarcamaBirimiAdi, iban: f.kamuIban });
      if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
      kamuBilgisi = { harcamaBirimiVkn: f.kamuHarcamaBirimiVkn!.trim(), harcamaBirimiAdi: f.kamuHarcamaBirimiAdi!.trim(), iban: f.kamuIban! };
    }

    // SGK faturası: alıcının VKN'si SGK'nınki ise belge SGK tipiyle gider ve
    // ek alanları eksiksiz olmalıdır. SGK e-Fatura mükellefidir; e-Arşiv'e
    // düşen bir belge SGK olamaz.
    if (sgkFaturasiMi(hazirlik.fatura.cari.vknTckn) && hazirlik.fatura.tip === "satis") {
      if (tur !== "efatura") {
        throw new BadRequestException(`Alıcı SGK (VKN ${SGK_VKN}) ancak GİB e-Fatura listesinde bulunamadı; SGK faturası yalnız e-Fatura ile gönderilir`);
      }
      const f = hazirlik.fatura;
      const engeller = sgkEngelleri({
        ilaveFaturaTipi: f.sgkIlaveFaturaTipi,
        mukellefKodu: f.sgkMukellefKodu,
        mukellefAdi: f.sgkMukellefAdi,
        dosyaNo: f.sgkDosyaNo,
        donemBaslangic: f.sgkDonemBaslangic?.toISOString(),
        donemBitis: f.sgkDonemBitis?.toISOString(),
      });
      if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
    }

    // Şarj faturası (EBLG-71) ve İDİS belgesi (EBLG-72): eksik alanla belge
    // şematrondan döner, gönderim burada durur.
    const sarjSenaryosu = hazirlik.fatura.senaryo === "sarj" || hazirlik.fatura.senaryo === "sarjanlik"
      ? (hazirlik.fatura.senaryo as SarjTuru) : null;
    if (sarjSenaryosu) {
      const f = hazirlik.fatura;
      const engeller = sarjEngelleri({
        turu: sarjSenaryosu,
        plaka: f.sarjPlaka,
        baslangic: f.sarjBaslangic?.toISOString(),
        bitis: f.sarjBitis?.toISOString(),
        esuRaporlari: (f.sarjEsuRaporlari as { raporId: string; tarih: string }[] | null) ?? [],
        satirlar: f.satirlar.map((satir, index) => ({ sira: index + 1, uniteSeriNo: satir.sarjUniteSeriNo })),
      });
      if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
    }
    if (idisNormalize(hazirlik.fatura.idisSevkiyatNo)) {
      const engeller = idisEngelleri({
        sevkiyatNo: hazirlik.fatura.idisSevkiyatNo,
        satirlar: hazirlik.fatura.satirlar.map((satir, index) => ({ sira: index + 1, etiketNo: satir.idisEtiketNo })),
      });
      if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
    }
    // EBLG-78: yatırım teşvik kuralları kanal belli olduktan sonra denetlenir;
    // e-Arşiv'e düşen belgede tipler YTB önekli gider.
    if (ytbBelgesiMi(hazirlik.fatura.ytbNo)) {
      const engeller = ytbEngelleri({ ...ytbGirdisi(hazirlik.fatura), tur });
      if (engeller.length) throw new BadRequestException(engeller.map((e) => e.mesaj).join("; "));
    }

    // Otomatik numaralandıran seride UBL'e tam numara değil yalnızca seri
    // öneki yazılır; numarayı entegratör atar ve yanıtta döndürür (EBLG-16).
    // Önek kanala göre seçilir: GİB e-Fatura ile e-Arşiv serilerinin aynı
    // olmasına izin vermez, aynı önekle giden e-Arşiv belgesi şematronda
    // reddedilir. Kanal ancak mükellefiyet sorgusundan sonra bilindiği için
    // eksik önek burada, gönderimden hemen önce yakalanır.
    const seriOneki = tur === "earsiv" ? hazirlik.cfg.earsivSeriOneki : hazirlik.cfg.belgeSeriOneki;
    if (adapter.belgeNoAtar && tur === "earsiv" && hazirlik.cfg.belgeSeriOneki && !seriOneki) {
      throw new BadRequestException(
        "Alıcı e-Fatura mükellefi değil, belge e-Arşiv olarak düzenlenecek. Ayarlar > Entegratörler ekranında e-Fatura serisinden farklı bir e-Arşiv seri öneki tanımlayın.",
      );
    }
    const saglayiciNumaralandirir = Boolean(adapter.belgeNoAtar && seriOneki);
    const ublFatura = saglayiciNumaralandirir
      ? { ...hazirlik.fatura, no: seriOneki! }
      : hazirlik.fatura;

    // Profil belge kanalına göre değişir: e-Arşiv'de GİB `EARSIVFATURA` bekler,
    // e-Fatura profili (temel/ticari) yalnız e-Fatura kanalında geçerlidir.
    const xml = faturaUblUret(
      ublFatura,
      hazirlik.tenant,
      {
        // MVZ-11: istisna/özel matrah/ihraç kayıtlı açıklamaları belge tarihindeki merkezi listeden.
        kodTablosu: await belgeKodTablosu(this.mevzuat, ublFatura.tarih.toISOString().slice(0, 10)),
        tur,
        ihracat: hazirlik.ihracat.ublBilgisi,
        yurtDisiEarsiv: hazirlik.ihracat.yurtDisiEarsiv,
        internetSatisi: hazirlik.internet.ublBilgisi,
        iadeReferanslari: hazirlik.iade.iade ? hazirlik.iade.referanslar : undefined,
        irsaliyeReferanslari: sevkiyat.irsaliyeler.filter((i): i is { no: string; tarih: Date } => Boolean(i.no)),
        bagliReferanslar: sevkiyat.bagliReferanslar,
        kamu: kamuBilgisi,
        yolcuBeraberi: hazirlik.yolcu.bilgi,
      },
    );
    return { mukellefiyet, tur, ublFatura, saglayiciNumaralandirir, xml };
  }

  /**
   * Sihirbazın son adımı (L): belgeyi gönderilecek hâliyle üretir ve
   * entegratörün önizleme ucundan geçirir. Kayıt, rezervasyon ya da numara
   * oluşturmaz; önizleme ucu olmayan entegratörde yalnız kanal kararını döner.
   */
  async onizle(faturaId: string) {
    const { tenantId } = aktifBaglam();
    const hazirlik = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        include: {
          satirlar: { include: { stok: { select: { kod: true, ad: true, tip: true, gtipKodu: true, mensei: true, kdvOrani: true } }, varyant: { select: { kod: true, ad: true, nitelikler: true } } } },
          cari: { include: { adresler: true } },
          iadeReferanslari: true,
        },
      });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException("Tenant bulunamadı");
      // EBLG-77: kanal kararı firmanın kendi mükellefiyetiyle başlar.
      const uygulamalar = await ebelgeUygulamalariCozTenant(tx, tenant);
      const ozetler = gonderimKosullariniDenetle(fatura, uygulamalar.efatura.acik);
      await tasiyiciAdresiniBagla(tx, ozetler.internet);
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
      if (!baglanti) throw new BadRequestException("Aktif bir e-belge entegratör bağlantısı bulunamadı.");
      return { fatura, tenant, uygulamalar, saglayici: baglanti.saglayici, cfg: JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig, ...ozetler };
    });

    const adapter = this.baglantilarService.adapterCoz(hazirlik.saglayici);
    const { tur, xml, ublFatura, mukellefiyet } = await this.belgeUblHazirla(adapter, hazirlik);
    const kimlik = {
      tur,
      profil: /<cbc:ProfileID>([^<]*)</.exec(xml)?.[1],
      tip: /<cbc:InvoiceTypeCode>([^<]*)</.exec(xml)?.[1],
    };
    if (!adapter.belgeOnizle) return { ...kimlik, destekleniyor: false as const };
    this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "belgeOnizle", saglayici: hazirlik.saglayici });
    const sonuc = await adapter.belgeOnizle(hazirlik.cfg, {
      uuid: hazirlik.fatura.id,
      belgeNo: ublFatura.no || "TASLAK",
      xml,
      tur,
      aliciPostaKutusu: mukellefiyet.postaKutusu,
    });
    return { ...kimlik, destekleniyor: true as const, ...sonuc };
  }

  async gonder(faturaId: string) {
    const { tenantId } = aktifBaglam();
    // Önce veritabanında tekil bir gönderim rezervasyonu oluşturulur. Böylece
    // çift tıklama/iki sekme aynı UUID'yi entegratöre iki kez gönderemez.
    const hazirlik = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        include: {
          satirlar: { include: { stok: { select: { kod: true, ad: true, tip: true, gtipKodu: true, mensei: true, kdvOrani: true } }, varyant: { select: { kod: true, ad: true, nitelikler: true } } } },
          cari: { include: { adresler: true } },
          ebelge: true,
          iadeReferanslari: true,
        },
      });

      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException("Tenant bulunamadı");
      // EBLG-77: kanal kararı firmanın kendi mükellefiyetiyle başlar.
      const uygulamalar = await ebelgeUygulamalariCozTenant(tx, tenant);
      const { ihracat, internet, iade, yolcu } = gonderimKosullariniDenetle(fatura, uygulamalar.efatura.acik);
      await tasiyiciAdresiniBagla(tx, internet);
      if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum) && !takiliRezervasyonMu(fatura.ebelge)) {
        throw new ConflictException("Bu fatura için e-belge gönderim süreci zaten başlatılmış");
      }

      // 2. Aktif e-belge bağlantısını bul
      const baglanti = await tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      });

      if (!baglanti) {
        throw new BadRequestException(
          "Aktif bir e-belge entegratör bağlantısı bulunamadı. Lütfen ayarlardan aktifleştirin.",
        );
      }

      const baglantiConfig = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
      // Test bağlantısında kontrol hanesi aranmaz (EBLG-47); gönderen de alıcı da
      // o ortamda sentetik kimlik taşır, üretimde kural aynen sürer.
      const testOrtami = Boolean(baglantiConfig.testOrtami);
      if (!vknTcknKabulEdilebilirMi(tenant.vkn, testOrtami)) {
        throw new BadRequestException("Gönderen firmanın geçerli bir VKN/TCKN bilgisi olmalıdır");
      }
      if (!ihracat.yurtDisi && !yolcu.yolcuBeraberi && !vknTcknKabulEdilebilirMi(fatura.cari.vknTckn, testOrtami)) {
        throw new BadRequestException("Alıcının geçerli bir VKN/TCKN bilgisi olmalıdır");
      }

      let rezervasyon: { id: string };
      // Mevcut kaydın yeniden denenmesi mi, ilk gönderim mi? Yeniden denemede
      // belge sağlayıcıda çoktan oluşmuş olabilir (EBLG-17). Yarım kalmış
      // rezervasyon da yeniden denemedir (EBLG-37); kilit `updatedAt`'i
      // tazelediği için iki eşzamanlı deneme aynı kaydı alamaz.
      const yenidenDeneme = Boolean(fatura.ebelge);
      if (fatura.ebelge) {
        const kilit = await tx.ebelgeKayit.updateMany({
          where: { id: fatura.ebelge.id, OR: [{ durum: { in: ["hata", "ret"] } }, takiliRezervasyonKosulu()] },
          data: { durum: "kuyrukta", entegratorRef: null, hataMesaji: null },
        });
        if (kilit.count !== 1) {
          throw new ConflictException("Bu fatura için başka bir gönderim işlemi devam ediyor");
        }
        rezervasyon = { id: fatura.ebelge.id };
      } else {
        try {
          rezervasyon = await tx.ebelgeKayit.create({
            data: { tenantId, faturaId, tur: "earsiv", durum: "kuyrukta", hataMesaji: null },
            select: { id: true },
          });
        } catch (hata) {
          if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
            throw new ConflictException("Bu fatura için başka bir gönderim işlemi devam ediyor");
          }
          throw hata;
        }
      }

      return {
        fatura,
        tenant,
        uygulamalar,
        rezervasyonId: rezervasyon.id,
        yenidenDeneme,
        saglayici: baglanti.saglayici,
        cfg: baglantiConfig,
        ihracat,
        internet,
        iade,
        yolcu,
      };
    });

    const adapter = this.baglantilarService.adapterCoz(hazirlik.saglayici);
    try {
      if (hazirlik.yenidenDeneme && !adapter.belgeAra) {
        throw new ServiceUnavailableException(
          "Sağlayıcı önceki belgeyi arama desteği sunmuyor; mükerrer gönderim riski nedeniyle yeniden gönderim durduruldu",
        );
      }
      const { mukellefiyet, tur, ublFatura, saglayiciNumaralandirir, xml } = await this.belgeUblHazirla(adapter, hazirlik);

      // Yeniden denemede önce sağlayıcıya sorulur: önceki denemede ağ çağrısı
      // başarılı olup kalıcılaştırma düşmüş olabilir. Belge oradaysa yeniden
      // gönderilmez, benimsenir — aksi hâlde aynı satış için ikinci belge
      // düzenlenmiş olur (EBLG-17).
      let mevcutBelge: GonderimSonuc | undefined;
      if (hazirlik.yenidenDeneme && adapter.belgeAra) {
        this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "belgeAra", saglayici: hazirlik.saglayici });
        try {
          mevcutBelge = await adapter.belgeAra(hazirlik.cfg, hazirlik.fatura.id, tur);
        } catch (hata) {
          // Sorgu çalışmazsa mükerrer belge ihtimalini eleyemeyiz. Körlemesine
          // göndermek aynı satış için ikinci belge düzenlemek olur; bu yüzden
          // gönderim durdurulur ve sebep açıkça söylenir. Sebep erişimdir,
          // belge değil: kuyruk bu hatayı yeniden dener.
          const sebep = hata instanceof Error ? hata.message : "bilinmeyen hata";
          throw new ServiceUnavailableException(
            `Belgenin entegratörde zaten oluşup oluşmadığı kontrol edilemedi, mükerrer gönderim riski nedeniyle durduruldu: ${sebep}`,
          );
        }
        if (mevcutBelge) {
          this.logger.warn(JSON.stringify({
            event: "ebelge_mevcut_belge_benimsendi",
            faturaId,
            belgeRef: mevcutBelge.belgeRef,
            belgeNo: mevcutBelge.belgeNo,
          }));
        }
      }

      const gonderimResult = mevcutBelge ?? await adapter.belgeGonder(hazirlik.cfg, {
        uuid: hazirlik.fatura.id,
        belgeNo: ublFatura.no || "TASLAK",
        xml,
        tur,
        aliciPostaKutusu: mukellefiyet.postaKutusu,
      });
      const durum: BelgeDurum = gonderimResult.basarili ? "iletildi" : "hata";

      await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.cariHesap.update({
          where: { id: hazirlik.fatura.cariId },
          data: { eFaturaMukellefi: mukellefiyet.eFaturaMukellefi, mukellefiyetSorguZamani: new Date() },
        });
        await tx.ebelgeKayit.update({
          where: { id: hazirlik.rezervasyonId },
          data: { tur, durum, entegratorRef: gonderimResult.belgeRef || null, hataMesaji: gonderimResult.hataMesaji || null },
        });
        // Entegratörün attığı numara faturanın resmî numarasıdır; kesinleşmede
        // boş bırakılmıştı. Cari hareketin açıklaması geriye dönük
        // düzeltilmez: hareketler ekle-sil olarak tasarlanmıştır (uygulama
        // rolünün `cari_hareketler` üzerinde UPDATE yetkisi yoktur) ve bağ
        // zaten `kaynakRef` üzerinden fatura kimliğiyle kurulur.
        if (gonderimResult.basarili && saglayiciNumaralandirir && gonderimResult.belgeNo) {
          await tx.fatura.update({
            where: { id: faturaId },
            data: { no: gonderimResult.belgeNo },
          });
        }
        if (gonderimResult.basarili) {
          // Sağlayıcı numaralandırıyorsa gönderilen XML'de yalnız seri öneki
          // vardı; arşiv düzenlenen belgeyi tutmalı, o yüzden numara geri yazılır.
          const arsivXml =
            saglayiciNumaralandirir && gonderimResult.belgeNo
              ? belgeNoyuUbleYaz(xml, gonderimResult.belgeNo)
              : xml;
          await tx.ebelgeArsiv.upsert({
            where: { ebelgeId: hazirlik.rezervasyonId },
            create: { tenantId, ebelgeId: hazirlik.rezervasyonId, xmlIcerik: arsivXml, pdfDosyaUrl: `/panel/fatura/${faturaId}/pdf` },
            update: { xmlIcerik: arsivXml },
          });
        }
      });

      return {
        basarili: gonderimResult.basarili,
        durum,
        tur,
        ebelgeRef: gonderimResult.belgeRef,
        hataMesaji: gonderimResult.hataMesaji,
        kalici: gonderimResult.kalici ?? false,
      };
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "e-Belge gönderimi sırasında beklenmeyen hata";
      await this.prisma.tenantIslem(tenantId, (tx) => tx.ebelgeKayit.update({
        where: { id: hazirlik.rezervasyonId },
        data: { durum: "hata", hataMesaji: mesaj },
      }));
      throw hata;
    }
  }

  // ─── DURUM SORGULAMA (EBLG-03/06) ──────────────────────────────────────────

  /** Elle durum sorgusu kuyruğa alınmadan önce kalıcı engelleri söyler (EBLG-38). */
  async durumSorgusuKontrol(faturaId: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeKayit.findUnique({ where: { faturaId }, select: { durum: true, entegratorRef: true } }),
    );
    const engel = durumSorgusuEngeli(kayit);
    if (engel) throw new BadRequestException(engel);
  }

  async durumSorgula(faturaId: string) {
    const { tenantId } = aktifBaglam();

    // EBLG-155: entegratör çağrısı süresince veritabanı işlemi açık tutulmaz.
    const { ebelge, baglanti } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const ebelge = await tx.ebelgeKayit.findUnique({
        where: { faturaId },
      });

      if (!ebelge) throw new NotFoundException("Faturaya ait e-belge kaydı bulunamadı");
      if (!ebelge.entegratorRef) {
        throw new BadRequestException("Gönderimi yapılmamış belgenin durumu sorgulanamaz");
      }

      // Son duruma ulaşmış belge için entegratöre gidilmez; iptal edilmiş belge
      // sorguyla "iletildi"ye geri dönmemeli (EBLG-39).
      if (SON_EBELGE_DURUMLARI.includes(ebelge.durum)) {
        return { ebelge, baglanti: null };
      }

      const baglanti = await tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      });
      if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
      return { ebelge, baglanti };
    });
    if (!baglanti) return ebelge;

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

    // Entegratöre ulaşılamazsa kayda dokunulmaz, kullanıcıya söylenir:
    // geçici kesinti belgeyi hatalı göstermemeli (EBLG-39).
    this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "durumSorgula", saglayici: baglanti.saglayici });
    const entegratorRef = ebelge.entegratorRef!;
    const sonuc = await this.entegratordenOku(() => adapter.durumSorgula(cfg, entegratorRef));
    return this.prisma.tenantIslem(tenantId, (tx) => this.durumSonucunuYaz(tx, ebelge, sonuc));
  }

  /**
   * Durum sonucunu kayda yazar. `sonDurumSorguAt` yazılır ki zamanlanmış toplu
   * tarama aynı zarfı iki saat dolmadan tekrar sormasın (EBLG-14).
   *
   * Sağlayıcıda iptal edilmiş e-Arşiv belgesi (ör. entegratör portalından)
   * kayıtta `iptal` olur (EBLG-39). Fatura kendiliğinden iptal edilmez: stok ve
   * cari ters hareketleri kullanıcının kararıdır, muhasebeye haber verilir.
   */
  private async durumSonucunuYaz(
    tx: Prisma.TransactionClient,
    kayit: { id: string; faturaId: string; durum: string; aliciYanitNotu: string | null },
    sonuc: BelgeDurumSonuc,
  ) {
    // Tanınmayan sağlayıcı durumu `kuyrukta` sayılır; belgenin gerçekte nerede
    // beklediği (ör. NES taslağı) yalnız ham addan anlaşılır.
    if (sonuc.durum === "kuyrukta") {
      this.logger.log(JSON.stringify({ event: "ebelge_kuyrukta", faturaId: kayit.faturaId, hamDurum: sonuc.hamDurum ?? null, detay: sonuc.detay ?? null }));
    }
    const guncel = await tx.ebelgeKayit.update({
      where: { id: kayit.id },
      data: {
        durum: sonuc.iptalEdilmis ? "iptal" : sonuc.durum,
        entegratorDurumu: sonuc.hamDurum ?? null,
        ...durumAciklamasi(sonuc, kayit.aliciYanitNotu),
        sonDurumSorguAt: new Date(),
      },
    });
    if (sonuc.iptalEdilmis && kayit.durum !== "iptal") {
      const fatura = await tx.fatura.findUnique({ where: { id: kayit.faturaId }, select: { no: true, durum: true } });
      if (fatura && fatura.durum !== "iptal") {
        await this.bildirimler.uret(entegratorIptalBildirimi(kayit.faturaId, fatura.no));
      }
    }
    return guncel;
  }

  /**
   * Bekleyen zarfların durumunu toplu sorgular (EBLG-14).
   *
   * Önceki kurgu her bekleyen fatura için ayrı iş açıyordu; sağlayıcı kılavuzu
   * bunu açıkça yasaklıyor ("84 tekil çağrı yapılmamalıdır"). Burada zarflar
   * adaptörün toplu metoduna verilir, son duruma ulaşmış kayıtlar zaten
   * seçilmez ve her sorgudan sonra `sonDurumSorguAt` işaretlenir; böylece aynı
   * zarf iki saat dolmadan yeniden sorulmaz.
   */
  async durumlariTopluSorgula(): Promise<{ sorgulanan: number; guncellenen: number; atlanan: number }> {
    const { tenantId } = aktifBaglam();

    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }),
    );
    if (!baglanti) return { sorgulanan: 0, guncellenen: 0, atlanan: 0 };

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    // EBLG-40: temel e-Fatura alıcıya ulaşınca, ticari yanıt süresi ve e-Arşiv
    // iptal süresi dolunca otomatik sorgu durur; elle sorgu açık kalır.
    const sureler = faturaSorguSureleriniOku({
      ...(this.ayarlar ? await this.ayarlar.getir("ebelge") : {}),
      // MVZ-13: e-Arşiv iptal süresi kiracı ayarı değil, merkezi kanuni değerdir.
      earsivIptalGunSayisi: await kanuniDegerOku(this.prisma, "earsiv_iptal_gun", bugunTR(), 8),
    });

    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeKayit.findMany({
        where: faturaSorguKosulu(tenantId, Date.now(), sureler),
        select: { id: true, faturaId: true, durum: true, entegratorRef: true, aliciYanitNotu: true },
        take: 500,
      }),
    );
    if (kayitlar.length === 0) return { sorgulanan: 0, guncellenen: 0, atlanan: 0 };

    const refKayit = new Map(kayitlar.map((k) => [k.entegratorRef!, k]));
    // e-Arşiv referansları zarf sorgusuna girmez; ayrı servisin tekil durum
    // metodunu kullanırlar.
    const zarflar = [...refKayit.keys()].filter((ref) => !ref.startsWith("EARSIV:"));
    const digerleri = [...refKayit.keys()].filter((ref) => ref.startsWith("EARSIV:"));

    // Entegratöre ulaşılamayan zarfa ya da belgeye dokunulmaz, sonraki turda
    // yeniden sorulur; çağrı hatası belgeyi `hata`ya taşıyıp takipten
    // düşürmemeli (EBLG-39). Bir çağrının düşmesi diğerlerini de durdurmaz.
    const sonuclar: BelgeDurumSonuc[] = [];
    const oku = async (islem: () => Promise<BelgeDurumSonuc[]>) => {
      try {
        sonuclar.push(...(await islem()));
      } catch (hata) {
        this.logger.warn(JSON.stringify({ event: "ebelge_durum_sorgusu_atlandi", tenantId, hata: hata instanceof Error ? hata.message : String(hata) }));
      }
    };
    if (zarflar.length > 0) {
      if (adapter.durumSorgulaToplu) {
        this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "durumSorgulaToplu", saglayici: baglanti.saglayici }, Math.ceil(zarflar.length / 20));
        await oku(() => adapter.durumSorgulaToplu!(cfg, zarflar));
      } else {
        for (const ref of zarflar) {
          this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "durumSorgula", saglayici: baglanti.saglayici });
          await oku(async () => [await adapter.durumSorgula(cfg, ref)]);
        }
      }
    }
    for (const ref of digerleri) {
      this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "durumSorgula", saglayici: baglanti.saglayici });
      await oku(async () => [await adapter.durumSorgula(cfg, ref)]);
    }

    let guncellenen = 0;
    for (const sonuc of sonuclar) {
      const kayit = refKayit.get(sonuc.belgeRef);
      if (!kayit) continue;
      await this.prisma.tenantIslem(tenantId, (tx) => this.durumSonucunuYaz(tx, kayit, sonuc));
      guncellenen += 1;
    }

    this.metrics.increment("ebelge_durum_toplu_sorgu_total", {}, 1);
    return { sorgulanan: refKayit.size, guncellenen, atlanan: refKayit.size - guncellenen };
  }

  // ─── GİB MÜKELLEF LİSTESİ (EBLG-10) ────────────────────────────────────────

  /**
   * Aktif bağlantının kimlik bilgileriyle global mükellef listesini tazeler.
   * Liste kiracıdan bağımsız olduğundan hangi kiracının hesabıyla indirildiği
   * sonucu değiştirmez; kayıt hangi sağlayıcıdan geldiğini saklar.
   */
  async mukellefListesiSenkronEt() {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }),
    );
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    return this.mukellefListesi.senkronEt(baglanti.saglayici, cfg);
  }

  mukellefSenkronVaktiGeldi() {
    return this.mukellefListesi.senkronVaktiGeldi();
  }

  mukellefListesiDurumu() {
    return this.mukellefListesi.durum();
  }

  /**
   * Elle tazelemenin saatlik sınırı (EBLG-11). Kılavuz son kullanıcı ekranının
   * doğrudan bu API üzerinde çalıştırılmamasını istiyor; buton kalıyor ama
   * kiracı başına saatte bir kez geçiyor.
   */
  async elleTazelemeIzniAl(): Promise<void> {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const [kayit, baglanti] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.ebelgeGelenKursor.findUnique({ where: { tenantId } }),
        tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { id: true } }),
      ]),
    );
    // EBLG-98: bağlantı pasifken iş kuyruğa girip boşa düşüyordu; kullanıcı
    // "tazelendi" sanıyordu. Sebep burada söylenir.
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı yok; gelen kutusu tazelenemez. Bağlantıyı Ayarlar > Entegratörler'den etkinleştirin");
    if (kayit?.sonTetiklemeAt && simdi.getTime() - kayit.sonTetiklemeAt.getTime() < elleTazelemeAralikMs()) {
      const kalanDk = Math.ceil((elleTazelemeAralikMs() - (simdi.getTime() - kayit.sonTetiklemeAt.getTime())) / 60_000);
      const aralikDk = Math.round(elleTazelemeAralikMs() / 60_000);
      throw new BadRequestException(`Gelen belge kutusu ${aralikDk === 60 ? "saatte" : `${aralikDk} dakikada`} bir tazelenebilir; ${kalanDk} dakika sonra tekrar deneyin`);
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeGelenKursor.upsert({
        where: { tenantId },
        // Kursörü ileri almaz; yalnız tetikleme anını işaretler. İlk kayıtta
        // çekim penceresini `gelenKursoruOku` belirler.
        create: { tenantId, sonCekimAt: kayit?.sonCekimAt ?? this.ilkGelenPenceresi(), sonTetiklemeAt: simdi },
        update: { sonTetiklemeAt: simdi },
      }),
    );
  }

  private ilkGelenPenceresi(): Date {
    const pencere = new Date();
    pencere.setDate(pencere.getDate() - Number(process.env.EBLG_ILK_GELEN_PENCERE_GUN || 7));
    return pencere;
  }

  // ─── GELEN E-BELGE KUTUSU (EBLG-05/06) ─────────────────────────────────────

  /**
   * Gelen belgeleri kursörün bıraktığı yerden çeker (EBLG-11) ve **yalnızca
   * gelen kutusuna** yazar (EBLG-05). Fatura üretilmez — bu, kullanıcı onayıyla
   * {@link gelenOnayla} üzerinden olur. Tekrar çekimde aynı belge
   * `[tenantId, uuid]` teklik kısıtıyla yinelenmez.
   *
   * Kursör, sağlayıcının "sorgulanan tarih aralıkları kesinlikle tekrar tekrar
   * sorgulanmamalıdır" kuralının karşılığıdır: her tarama yalnızca son çekimden
   * bu yana açılan aralığı ister. Adaptörü zarf düzeyinde çekim yapabilen
   * sağlayıcılarda fatura ve alıcı yanıtı tek çağrı ailesiyle alınır (EBLG-12).
   */
  async gelenBelgeleriCek() {
    const { tenantId } = aktifBaglam();

    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      }),
    );

    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

    const bitis = new Date();
    const baslangic = await this.gelenKursoruOku(tenantId);

    let yeniBelgeSayisi = 0;
    let toplamCekilen = 0;
    const yeniIdler: string[] = [];
    const alinamayanlar: { uuid: string; belgeNo: string; mesaj: string }[] = [];

    // Her belge indirildiği anda yazılır ve bırakılır: gelen XML'ler eklerle
    // MB'larca olabiliyor; uzun pencerede hepsini bellekte toplamak worker'ı
    // düşürüyor, kursör de ilerlemediği için pencere her seferinde büyüyordu.
    const kaydet = async (b: GelenBelge) => {
      toplamCekilen += 1;
      // Profil bilgisi kabul/ret düğmesini belirlediği için çekimde okunur;
      // bozuk XML çekimi düşürmesin — belge yine de kutuya girsin.
      let profilId: string | null = null;
      try {
        profilId = faturaUblOku(b.xml).profilId;
      } catch {
        profilId = null;
      }

      const oncesi = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.findUnique({
          where: { tenantId_uuid: { tenantId, uuid: b.uuid } },
          select: { id: true },
        }),
      );

      const xmlKaydi = await gelenXmlYaz(this.xmlDepo, tenantId, b.uuid, b.xml);
      const kaydedilen = await this.prisma.tenantIslem(tenantId, async (tx) => {
        const k = await tx.gelenEbelge.upsert({
          where: { tenantId_uuid: { tenantId, uuid: b.uuid } },
          create: {
            tenantId,
            uuid: b.uuid,
            belgeNo: b.belgeNo,
            gonderenVkn: b.gonderenVkn,
            gonderenUnvan: b.gonderenUnvan,
            tarih: b.tarih,
            profilId,
            ...xmlKaydi,
            ...gelenOzeti(b.xml),
          },
          // Yalnızca entegratör tarafındaki gövde tazelenir; durum/yanıt
          // bizim iş akışımıza ait olduğu için korunur.
          update: { ...xmlKaydi, profilId, ...gelenOzeti(b.xml) },
          select: { id: true },
        });
        // EBLG-34: belge portalda ya da başka bir yerde yanıtlanmışsa karar
        // yanıtı olmayan kayda yazılır; yerel kararın üzerine yazılmaz.
        if (b.yanit) await this.yanitBenimse(tx, tenantId, b.uuid, b.yanit);
        return k;
      }, { timeout: GELEN_BELGE_ISLEM_SURESI_MS });

      if (!oncesi) {
        yeniBelgeSayisi += 1;
        yeniIdler.push(kaydedilen.id);
      }
    };
    // EBLG-154: tek belgenin hatası kendinden sonra gelenleri bekletmesin.
    const belgeHatasi = (h: { uuid: string; belgeNo: string; mesaj: string }) => {
      alinamayanlar.push(h);
      this.metrics.increment("ebelge_gelen_belge_hatasi_total", { saglayici: baglanti.saglayici });
      this.logger.warn(JSON.stringify({ event: "gelen_belge_alinamadi", tenantId, uuid: h.uuid, belgeNo: h.belgeNo, hata: h.mesaj }));
    };
    const isle = async (b: GelenBelge) => {
      try { await kaydet(b); }
      catch (hata) { belgeHatasi({ uuid: b.uuid, belgeNo: b.belgeNo, mesaj: hata instanceof Error ? hata.message : String(hata) }); }
    };
    const bilinen = async (uuid: string) => Boolean(await this.prisma.tenantIslem(tenantId, (tx) => tx.gelenEbelge.findUnique({ where: { tenantId_uuid: { tenantId, uuid } }, select: { id: true } })));

    let yanitlar: GelenAliciYaniti[] = [];
    if (adapter.gelenZarflariCek) {
      this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "gelenZarflariCek", saglayici: baglanti.saglayici });
      const zarflar = await adapter.gelenZarflariCek(cfg, { baslangic, bitis });
      for (const b of zarflar.belgeler) await isle(b);
      yanitlar = zarflar.yanitlar;
    } else {
      this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "gelenBelgeleriCek", saglayici: baglanti.saglayici });
      // Akış desteklemeyen sağlayıcı belgeleri dizide döndürür.
      for (const b of await adapter.gelenBelgeleriCek(cfg, baslangic, isle, { bilinen, belgeHatasi })) await isle(b);
    }

    // EBLG-144: yeni belgelerin kural denetimi (liste rozeti); hata çekimi düşürmez.
    // Özellikten önce gelmiş, henüz denetlenmemiş bekleyen belgeler her çekimde
    // en yeniden 50'şer tamamlanır (belge başına ~0,2 sn).
    let eskiler: { id: string }[] = [];
    try {
      eskiler = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.findMany({
          where: { durum: "beklemede", denetimAt: null, okunabilir: true, id: { notIn: yeniIdler } },
          orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
          take: GELEN_DENETIM_TAMAMLAMA,
          select: { id: true },
        }),
      );
    } catch (hata) {
      this.logger.warn(JSON.stringify({ event: "gelen_denetim_tamamlanamadi", hata: hata instanceof Error ? hata.message : String(hata) }));
    }
    for (const id of [...yeniIdler, ...eskiler.map((e) => e.id)]) await this.gelenDenetimSakla(id);

    const islenenYanit = await this.aliciYanitlariniIsle(tenantId, yanitlar);

    // Kursör yalnızca eksiksiz çekimde ilerletilir; alınamayan belge varken aralık
    // yeniden istenir, çünkü kayıp belge tekrar sorgudan daha kötüdür.
    if (alinamayanlar.length) {
      await this.gelenTaramasiniIsaretle(tenantId, baslangic);
      await this.bildirimler.uret({
        tur: "ebelge", onem: "kritik", baslik: "Gelen e-Fatura alınamadı",
        aciklama: `${alinamayanlar.length} belge kutuya alınamadı (${alinamayanlar.slice(0, 5).map((a) => a.belgeNo).join(", ")}${alinamayanlar.length > 5 ? "…" : ""}). Son hata: ${alinamayanlar[0].mesaj.slice(0, 200)}. Diğer belgeler işlendi; her taramada yeniden denenir.`,
        birlesimAnahtari: `ebelge-gelen-hata:${tenantId}`, kaynakTur: "gelen_ebelge", kaynakRef: tenantId, hedefYol: "/panel/fatura/gelen-kutusu", roller: ["yonetici", "muhasebe"],
      }).catch((hata: unknown) => this.logger.warn(JSON.stringify({ event: "gelen_hata_bildirimi_yazilamadi", tenantId, hata: String(hata) })));
    } else {
      await this.gelenKursoruYaz(tenantId, bitis);
      await this.bildirimler.kapatEksikleri("ebelge", [], ["ebelge-gelen-hata:"]).catch((hata: unknown) => this.logger.warn(JSON.stringify({ event: "gelen_hata_bildirimi_kapatilamadi", tenantId, hata: String(hata) })));
    }
    this.metrics.increment("ebelge_gelen_cekim_total", { result: alinamayanlar.length ? "partial" : "success" });
    this.metrics.set("ebelge_gelen_kursor_yasi_saniye", (Date.now() - baslangic.getTime()) / 1000);

    return {
      toplamCekilen,
      yeniBelgeSayisi,
      alinamayanBelge: alinamayanlar.length,
      islenenAliciYaniti: islenenYanit,
    };
  }

  /**
   * Gelen belge kursörünü okur. Kursör yoksa ilk tarama için makul bir pencere
   * açılır: 30 gün geriye gitmek günlük dilimlerde 30 liste çağrısı demek olur
   * ve tam da kaçınmaya çalıştığımız yığılmayı ilk çalıştırmada üretirdi.
   */
  private async gelenKursoruOku(tenantId: string): Promise<Date> {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeGelenKursor.findUnique({ where: { tenantId } }),
    );
    return kayit ? kayit.sonCekimAt : this.ilkGelenPenceresi();
  }

  /** Kursör yerinde kalır; yalnız denemenin zamanı yazılır ki planlayıcı saatlik aralığı korusun. */
  private async gelenTaramasiniIsaretle(tenantId: string, baslangic: Date): Promise<void> {
    const sonTaramaAt = new Date();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.ebelgeGelenKursor.upsert({ where: { tenantId }, create: { tenantId, sonCekimAt: baslangic, sonTaramaAt }, update: { sonTaramaAt } }));
  }

  private async gelenKursoruYaz(tenantId: string, an: Date): Promise<void> {
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeGelenKursor.upsert({
        where: { tenantId },
        create: { tenantId, sonCekimAt: an },
        update: { sonCekimAt: an },
      }),
    );
  }

  /**
   * Alıcının *bizim kestiğimiz* faturaya verdiği kabul/ret yanıtını işler
   * (EBLG-13). Yanıt faturanın kendi UUID'siyle, o tutmazsa fatura numarasıyla
   * eşlenir. Kayıt `durum` alanına dokunulmaz: o alan zarfın GİB durumudur,
   * alıcının kararı ayrı eksendir.
   */
  private async aliciYanitlariniIsle(tenantId: string, yanitlar: GelenAliciYaniti[]): Promise<number> {
    let islenen = 0;
    for (const yanit of yanitlar) {
      const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
        const fatura = yanit.faturaUuid
          ? await tx.fatura.findFirst({ where: { tenantId, id: yanit.faturaUuid }, select: { id: true } })
          : null;
        const hedefFaturaId = fatura?.id
          ?? (yanit.faturaNo
            ? (await tx.fatura.findFirst({ where: { tenantId, no: yanit.faturaNo }, select: { id: true } }))?.id
            : undefined);
        if (!hedefFaturaId) return null;
        return tx.ebelgeKayit.findUnique({ where: { faturaId: hedefFaturaId }, select: { id: true, aliciYanitRef: true } });
      });
      // Bize ait olmayan bir belgeye atıf yapan yanıt sessizce atlanır; gelen
      // kutusundaki başkasının faturasına verdiğimiz yanıt da buraya düşebilir.
      if (!kayit) continue;
      if (kayit.aliciYanitRef === yanit.uuid) continue;

      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.ebelgeKayit.update({
          where: { id: kayit.id },
          data: {
            aliciYaniti: yanit.yanit,
            aliciYanitZamani: yanit.tarih,
            aliciYanitNotu: yanit.gerekce?.slice(0, 500) ?? null,
            aliciYanitRef: yanit.uuid,
          },
        }),
      );
      islenen += 1;
      this.metrics.increment("ebelge_alici_yanit_total", { yanit: yanit.yanit });

      // Ret, iade faturası kesilmesini gerektirdiği için sahiplenilmesi gereken
      // bir olaydır; kabul bilgilendirmedir ve bildirim üretmez (EBLG-13).
      if (yanit.yanit === "ret") {
        await this.bildirimler.uret({
          tur: "ebelge",
          onem: "kritik",
          baslik: "Alıcı faturayı reddetti",
          aciklama: `${yanit.faturaNo ?? "Fatura"} için ret yanıtı geldi${yanit.gerekce ? `: ${yanit.gerekce}` : ""}. İade faturası kesilmesi gerekebilir.`,
          birlesimAnahtari: `ebelge-ret:${yanit.uuid}`,
          kaynakTur: "fatura",
          kaynakRef: kayit.id,
          hedefYol: "/panel/fatura?ebelge=ret",
          roller: ["yonetici", "muhasebe"],
        });
      }
    }
    return islenen;
  }

  /**
   * Manuel XML fatura yükleme: UBL XML'i doğrular, alıcı VKN/TCKN bilgisinin
   * mevcut kiracı (şirket) VKN'si ile eşleştiğini kontrol eder ve gelen kutusuna yazar.
   */
  async gelenXmlYukle(xmlIcerik: string) {
    const { tenantId } = aktifBaglam();

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(xmlIcerik);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof UblOkumaHatasi
          ? `Yüklenen XML okunamadı: ${hata.message}`
          : "Yüklenen XML geçerli bir UBL-TR faturası değil",
      );
    }

    const tenant = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { vkn: true } }),
    );

    if (tenant?.vkn && ubl.alici.vknTckn && ubl.alici.vknTckn !== tenant.vkn) {
      throw new BadRequestException(
        `Fatura alıcı VKN/TCKN (${ubl.alici.vknTckn}) bilgisi, firmanızın VKN (${tenant.vkn}) bilgisi ile eşleşmiyor. Farklı bir firmaya kesilmiş faturalar yüklenemez.`,
      );
    }

    const tarih = new Date(ubl.tarih);
    const gecerliTarih = Number.isNaN(tarih.getTime()) ? new Date() : tarih;

    const xmlKaydi = await gelenXmlYaz(this.xmlDepo, tenantId, ubl.uuid, xmlIcerik);
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.upsert({
        where: { tenantId_uuid: { tenantId, uuid: ubl.uuid } },
        create: {
          tenantId,
          uuid: ubl.uuid,
          belgeNo: ubl.belgeNo,
          gonderenVkn: ubl.gonderen.vknTckn,
          gonderenUnvan: ubl.gonderen.unvan,
          tarih: gecerliTarih,
          profilId: ubl.profilId,
          ...xmlKaydi,
          ...gelenOzeti(xmlIcerik),
        },
        update: { ...xmlKaydi, profilId: ubl.profilId, ...gelenOzeti(xmlIcerik) },
      }),
    );
    await this.gelenDenetimSakla(kayit.id);

    return {
      id: kayit.id,
      uuid: kayit.uuid,
      belgeNo: kayit.belgeNo,
      gonderenVkn: kayit.gonderenVkn,
      gonderenUnvan: kayit.gonderenUnvan,
      aliciVkn: ubl.alici.vknTckn,
      profilId: kayit.profilId,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      durum: kayit.durum,
    };
  }

  /**
   * Gelen kutusu ekranı: sayfa sayfa okunur, arama ve süzgeç veritabanında uygulanır,
   * sayaçlar ve toplamlar seçilen süzgeçle hesaplanır (rapor V-2; bütün kutuyu dönen eski `GET /ebelge/gelen` kaldırıldı).
   * Taslak faturası silinen belgeler yeniden onaya düşer (bkz. kayitTazele).
   * Durum sayaçları durum süzgecinden bağımsızdır: "Onay bekleyen" her zaman gerçek sayıyı gösterir.
   */
  async gelenSayfa(g: { durum?: GelenEbelgeDurum; arama?: string; uyarili?: boolean; baslangic?: string; bitis?: string; imlec?: string; adet?: number }) {
    const { tenantId } = aktifBaglam();
    const adet = Math.min(Math.max(g.adet ?? 50, 1), 200);
    const aranan = g.arama?.trim();
    // ILIKE Türkçe İ/ı'yı eşlemez; yazılan, büyük ve küçük biçim ayrı aranır.
    const bicimler = aranan ? [...new Set([aranan, aranan.toLocaleUpperCase("tr-TR"), aranan.toLocaleLowerCase("tr-TR")])] : [];
    const ortak: Prisma.GelenEbelgeWhereInput = {
      ...(g.uyarili ? { denetimUyariSayisi: { gt: 0 } } : {}),
      ...(g.baslangic || g.bitis ? { tarih: { ...(g.baslangic ? { gte: new Date(g.baslangic) } : {}), ...(g.bitis ? { lte: new Date(g.bitis) } : {}) } } : {}),
      ...(bicimler.length ? { OR: bicimler.flatMap((b) => [{ belgeNo: { contains: b, mode: "insensitive" as const } }, { gonderenUnvan: { contains: b, mode: "insensitive" as const } }, { gonderenVkn: { contains: b } }]) } : {}),
    };
    const where: Prisma.GelenEbelgeWhereInput = { ...ortak, ...(g.durum ? { durum: g.durum } : {}) };
    const { kayitlar, toplam, durumlar } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.gelenEbelge.updateMany({ where: { durum: "islendi", faturaId: null }, data: { durum: "beklemede" } });
      const [kayitlar, toplam, durumlar] = await Promise.all([
        tx.gelenEbelge.findMany({
          where,
          orderBy: [{ tarih: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: adet + 1,
          ...(g.imlec ? { cursor: { id: g.imlec }, skip: 1 } : {}),
          select: GELEN_LISTE_SECIMI,
        }),
        tx.gelenEbelge.aggregate({ where, _count: { _all: true }, _sum: { genelToplam: true, satirSayisi: true } }),
        tx.gelenEbelge.groupBy({ by: ["durum"], where: ortak, _count: { _all: true } }),
      ]);
      return { kayitlar, toplam, durumlar };
    });
    const sayfa = kayitlar.slice(0, adet);
    await this.gelenOzetleriniTamamla(tenantId, sayfa);
    const sayi = (d: GelenEbelgeDurum) => durumlar.find((x) => x.durum === d)?._count._all ?? 0;
    return {
      kayitlar: sayfa.map((k) => this.gelenSatiri(k)),
      sonrakiImlec: kayitlar.length > adet ? sayfa[adet - 1].id : null,
      ozet: {
        adet: toplam._count._all,
        toplamTutar: (toplam._sum.genelToplam ?? new Prisma.Decimal(0)).toFixed(2),
        kalem: toplam._sum.satirSayisi ?? 0,
        beklemede: sayi("beklemede"), islendi: sayi("islendi"), reddedildi: sayi("reddedildi"),
      },
    };
  }

  /** Özeti henüz yazılmamış (göçten önce gelmiş) belgeler birer birer tamamlanır; aynı anda yalnız bir XML bellekte durur. */
  private async gelenOzetleriniTamamla(tenantId: string, kayitlar: { id: string; okunabilir: boolean | null; satirSayisi: number | null; genelToplam: Prisma.Decimal | null; dovizCinsi: string | null }[]) {
    for (const k of kayitlar.filter((x) => x.okunabilir === null)) {
      const ozet = await this.prisma.tenantIslem(tenantId, async (tx) => {
        const xml = await tx.gelenEbelge.findUnique({ where: { id: k.id }, select: { xmlIcerik: true, xmlAnahtar: true, xmlOzet: true } });
        const hesap = gelenOzeti(xml ? await gelenXmlOku(xml, this.xmlDepo) : "");
        await tx.gelenEbelge.update({ where: { id: k.id }, data: hesap });
        return hesap;
      });
      Object.assign(k, { ...ozet, genelToplam: ozet.genelToplam === null ? null : new Prisma.Decimal(ozet.genelToplam) });
    }
  }

  private gelenSatiri(k: Prisma.GelenEbelgeGetPayload<{ select: typeof GELEN_LISTE_SECIMI }>) {
      return {
        id: k.id,
        uuid: k.uuid,
        belgeNo: k.belgeNo,
        gonderenVkn: k.gonderenVkn,
        gonderenUnvan: k.gonderenUnvan,
        tarih: k.tarih.toISOString().slice(0, 10),
        profilId: k.profilId,
        durum: k.durum,
        yanit: k.yanit,
        yanitGerekce: k.yanitGerekce,
        faturaId: k.faturaId,
        fatura: k.fatura,
        satirSayisi: k.satirSayisi ?? 0,
        genelToplam: k.genelToplam ? k.genelToplam.toFixed(2) : null,
        dovizCinsi: k.dovizCinsi ?? "TRY",
        okunabilir: k.okunabilir ?? false,
        /** EBLG-144: son kural denetimindeki uyarı sayısı; null = henüz denetlenmedi. */
        denetimUyari: k.denetimUyariSayisi,
      };
  }

  /**
   * Onay ekranının verisi: ayrıştırılmış belge + her satır için otomatik stok
   * eşleştirme önerisi (S-01: barkod → tedarikçi ürün kodu → ad).
   */
  /** Yalnız okur: eşleştirme kullanıcıdan, fiyat ve tarih saklanan UBL'den gelir. */
  async gelenFiyatAnalizi(id: string, eslesmeler: { siraNo: number; stokId: string; varyantId?: string | null }[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.gelenEbelge.findFirst({ where: { id, tenantId } });
      if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");
      let ubl: UblFatura;
      try { ubl = faturaUblOku(await gelenXmlOku(kayit, this.xmlDepo)); }
      catch { throw new BadRequestException("Belgenin XML'i okunamadı"); }
      if (["IADE", "TEVKIFATIADE", "OZELMATRAH"].includes(ubl.faturaTipKodu))
        throw new BadRequestException("İade ve özel matrah belgeleri fiyat analizine dahil değildir");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ubl.tarih) || !Number.isFinite(new Date(ubl.tarih).getTime()))
        throw new BadRequestException("Belge tarihi geçersiz");
      if (ubl.toplamlar.belgeArtirimi > 0 || ubl.toplamlar.belgeIskontosu < 0 ||
        ubl.satirlar.some((s) => !Number.isFinite(s.matrah) || s.matrah < 0))
        throw new BadRequestException("Belge tutarları fiyat karşılaştırmasına uygun değil");
      if (new Set(ubl.satirlar.map((s) => s.siraNo)).size !== ubl.satirlar.length)
        throw new BadRequestException("Belgede tekrar eden satır numarası var");
      const netler = belgeNetMatrahlari(ubl.satirlar.map((s) => s.matrah), ubl.toplamlar.belgeIskontosu);
      const toplam = netler.reduce((t, s) => t.plus(s), new Prisma.Decimal(0));
      if (toplam.minus(String(ubl.toplamlar.matrah)).abs().greaterThan(Math.max(0.05, ubl.satirlar.length * 0.01)))
        throw new BadRequestException("Satır net tutarları belge matrahıyla tutarsız; önce belgeyi kontrol edin");
      const cariler = await tx.cariHesap.findMany({ where: { tenantId, vknTckn: kayit.gonderenVkn,
        tip: { in: ["tedarikci", "her_ikisi"] } }, select: { id: true } });
      const cari = cariler.length === 1 ? cariler[0] : null;
      const uyari = cariler.length > 1 ? "Gönderen VKN ile birden çok tedarikçi kartı var; aynı tedarikçi karşılaştırması yapılmadı." : null;
      const satirlar = [];
      for (const e of eslesmeler) {
        const i = ubl.satirlar.findIndex((s) => s.siraNo === e.siraNo);
        if (i < 0) throw new BadRequestException("Eşleştirilen satır belgede yok");
        const s = ubl.satirlar[i];
        const stok = await tx.stokKart.findFirst({ where: { id: e.stokId, tenantId },
          select: { id: true, kod: true, ad: true, varyantlar: { select: { id: true } } } });
        if (!stok || (stok.varyantlar.length > 0 && !e.varyantId) ||
          (e.varyantId && !stok.varyantlar.some((v) => v.id === e.varyantId)))
          throw new BadRequestException("Ürün/varyant eşleştirmesini kontrol edin");
        if (!Number.isFinite(s.miktar) || s.miktar <= 0 || new Prisma.Decimal(netler[i]).lessThanOrEqualTo(0)) {
          satirlar.push({ siraNo: s.siraNo, ad: s.ad, stokAd: stok.ad, analiz: null, uyari: "Pozitif miktar ve net fiyat yok; bedelsiz/geçersiz satır karşılaştırılmadı." });
          continue;
        }
        const gecmis = await tx.faturaSatir.findMany({
          where: { tenantId, stokId: stok.id, varyantId: e.varyantId ?? null,
            fatura: { tenantId, tip: "alis", durum: "kesin", ozelMatrahKodu: null,
              tarih: { gte: new Date(yilOnce(ubl.tarih, 2)), lt: new Date(ubl.tarih) },
              ...(kayit.faturaId ? { id: { not: kayit.faturaId } } : {}) } },
          select: { miktar: true, matrah: true, birim: true, fatura: {
            select: { id: true, no: true, tarih: true, createdAt: true, dovizCinsi: true, cariId: true, cari: { select: { unvan: true } } } } },
          orderBy: [{ fatura: { tarih: "desc" } }, { fatura: { createdAt: "desc" } }, { faturaId: "asc" }, { id: "asc" }], take: 2001,
        });
        satirlar.push({ siraNo: s.siraNo, ad: s.ad, stokAd: stok.ad, uyari: uyari ?? null,
          analiz: fiyatKarsilastir({ tarih: ubl.tarih, miktar: String(s.miktar), matrah: netler[i],
            birim: s.birim, doviz: ubl.dovizCinsi, cariId: uyari ? null : cari?.id ?? null, kesildi: gecmis.length > 2000,
            gecmis: gecmis.slice(0, 2000).map((g) => ({ miktar: g.miktar.toString(), matrah: g.matrah.toString(),
              birim: g.birim, doviz: g.fatura.dovizCinsi, tarih: g.fatura.tarih.toISOString().slice(0, 10),
              kayitAt: g.fatura.createdAt.toISOString(),
              faturaId: g.fatura.id, no: g.fatura.no, cariId: g.fatura.cariId, unvan: g.fatura.cari.unvan })) }) });
      }
      return { belgeId: id, belgeTarihi: ubl.tarih, satirlar,
        aciklama: "Belge gününden önceki kesin alışlar. Aynı ürün/varyant, birim ve döviz; yıllık artış iki ardışık 12 aylık miktar ağırlıklı ortalama farkıdır (enflasyondan arındırılmamıştır)." };
    }, { timeout: 30_000 });
  }

  async gelenGetir(id: string) {
    const { tenantId } = aktifBaglam();

    await this.kayitTazele(tenantId, id);
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({
        where: { id },
        include: { fatura: { select: { id: true, no: true, durum: true } } },
      }),
    );
    if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");

    const kayitXml = await gelenXmlOku(kayit, this.xmlDepo);
    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(kayitXml);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof UblOkumaHatasi
          ? `Belgenin XML'i okunamadı: ${hata.message}`
          : "Belgenin XML'i okunamadı",
      );
    }

    // MVZ-12: belge tarihindeki merkezi tablo; firmanın gizledikleri de tanınır.
    const { girdi: oneri, engeller, denetim, bilinmeyenler } = gelenDenetle(ubl, await this.gelenTablolari(ubl.tarih));
    // Aynı VKN'li birden çok cari varsa belgenin yönüne uygun olanı.
    const { cari: secilenCari, uyari: cariUyarisi } = await this.prisma.tenantIslem(tenantId, (tx) =>
      gonderenCariSec(tx, tenantId, kayit.gonderenVkn, oneri.tip === "satis_iade" ? "musteri" : "tedarikci"),
    );
    const cari = secilenCari ? { id: secilenCari.id, kod: secilenCari.kod, unvan: secilenCari.unvan, karaListe: secilenCari.karaListe } : null;

    const satirlar = await this.eslesmeOner(tenantId, ubl.satirlar, cari?.id ?? null);
    // EBLG-144: geçmiş değişmiş olabilir; açılışta önerilen eşleşmelerle yeniden hesaplanır.
    const aliDenetimi = await this.gelenDenetimSakla(id, satirlar
      .filter((x) => x.onerilenStokId)
      .map((x) => ({ siraNo: x.siraNo, stokId: x.onerilenStokId as string, varyantId: x.onerilenVaryantId })));

    // SAT-13: faturada adı geçen irsaliyelerin bizdeki karşılığı (işlerken bağlanır).
    const irsaliyeEslesmesi = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const nolar = ubl.irsaliyeler.map((i) => i.no);
      if (!cari) return nolar.map((no) => ({ no, durum: "yok" as const, irsaliyeNo: null }));
      const { eslesen, bulunamayan } = await faturaIrsaliyeAdaylari(tx, tenantId, cari.id, nolar);
      return [
        ...eslesen.map((e) => ({ no: e.tedarikciNo, durum: e.faturaId && e.faturaId !== kayit.faturaId ? "baska_faturada" as const : "bulundu" as const, irsaliyeNo: e.no })),
        ...bulunamayan.map((b) => ({ no: b.no, durum: b.durum, irsaliyeNo: null })),
      ];
    });

    // MVZ-10: merkezde karşılığı olmayan kod/oran platform ekibine iletilir; hata belgeyi etkilemez.
    for (const b of bilinmeyenler) await this.mevzuat?.bilinmeyenBildir(b).catch((hata: unknown) => this.logger.warn(JSON.stringify({ event: "mevzuat_bilinmeyen_kod_kaydedilemedi", hata: hata instanceof Error ? hata.message : String(hata) })));

    return {
      id: kayit.id,
      uuid: kayit.uuid,
      irsaliyeEslesmesi,
      /** EBLG-119: iade belgesi satış iadesi olarak işlenir. */
      faturaTipi: oneri.tip,
      /** EBLG-115: belge / sistem / fark tablosu ve işlemeyi durduran engeller. */
      tutarDenetimi: denetim,
      engeller,
      belgeNo: kayit.belgeNo,
      gonderenVkn: kayit.gonderenVkn,
      gonderenUnvan: kayit.gonderenUnvan,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      profilId: kayit.profilId ?? ubl.profilId,
      durum: kayit.durum,
      yanit: kayit.yanit,
      yanitGerekce: kayit.yanitGerekce,
      faturaId: kayit.faturaId,
      fatura: kayit.fatura,
      /** Kabul/ret yalnızca ticari faturada anlamlı (EBLG-06). */
      yanitGerekiyor: (kayit.profilId ?? ubl.profilId) === "TICARIFATURA",
      cari,
      /** Bulunan cari belgenin yönüne uygun tipte değilse işleme engeli. */
      cariUyarisi,
      dovizCinsi: ubl.dovizCinsi,
      belgeToplamlari: {
        satirToplami: ubl.toplamlar.satirToplami.toFixed(2),
        iskontoToplami: ubl.toplamlar.iskontoToplami.toFixed(2),
        matrah: ubl.toplamlar.matrah.toFixed(2),
        kdv: ubl.toplamlar.kdv.toFixed(2),
        genelToplam: ubl.toplamlar.genelToplam.toFixed(2),
      },
      satirlar,
      /** EBLG-144…149: gelen alış denetçisi; hesaplanamadıysa null. */
      onDenetim: aliDenetimi,
      xmlIcerik: kayitXml,
    };
  }

  /**
   * EBLG-05 onay kapısı: eşleştirilmiş satırlarla taslak **alış** faturası
   * üretir. Her satır bir stok kartına bağlanmak zorundadır — kesinleştirmede
   * satır başına stok hareketi yazılıyor ve `FaturaSatir.stokId` zorunlu.
   */
  async gelenOnayla(
    id: string,
    girdi: {
      satirEslesmeleri: { siraNo: number; stokId: string; varyantId?: string | null }[];
      yeniCariOnay?: boolean;
      onDenetimOnayi?: { anahtarlar: string[]; gerekce?: string };
    },
  ) {
    const { tenantId } = aktifBaglam();

    const kayit = await this.kayitTazele(tenantId, id);
    if (kayit.durum === "islendi") {
      throw new ConflictException("Bu belge zaten faturaya işlenmiş");
    }
    if (kayit.durum === "reddedildi") {
      throw new BadRequestException("Reddedilen belge faturaya işlenemez");
    }

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(await gelenXmlOku(kayit, this.xmlDepo));
    } catch {
      throw new BadRequestException("Belgenin XML'i okunamadı; faturaya işlenemez");
    }
    if (ubl.satirlar.length === 0) {
      throw new BadRequestException("Belgede fatura satırı bulunamadı");
    }

    // Tüm satırlar eşleşmeden fatura üretilmez (S-01).
    const eslesme = new Map(girdi.satirEslesmeleri.map((e) => [e.siraNo, e.stokId]));
    const varyantlar = new Map(girdi.satirEslesmeleri.map((e) => [e.siraNo, e.varyantId ?? null]));
    const eksik = ubl.satirlar.filter((s) => !eslesme.get(s.siraNo));
    if (eksik.length > 0) {
      throw new BadRequestException(
        `Şu satırlar bir stok kartıyla eşleştirilmedi: ${eksik
          .map((s) => `${s.siraNo}. ${s.ad}`)
          .join(", ")}`,
      );
    }

    // Eşleştirilen kartlar gerçekten bu kiracıya ait mi?
    const stokIdler = [...new Set([...eslesme.values()])];
    const stoklar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({ where: { id: { in: stokIdler } }, select: { id: true } }),
    );
    if (stoklar.length !== stokIdler.length) {
      throw new BadRequestException("Eşleştirilen stok kartlarından biri bulunamadı");
    }

    // EBLG-114: ihraç kayıtlı gelen faturada KDV hesaplanır ama ödenmez; kod
    // alış faturasına geçer ve KDV cariye/genel toplama girmez.
    // EBLG-115…119: kur, belge iskontosu, tevkifat ve özel matrah belgeden
    // gelir; oluşacak fatura belge toplamlarını tutmuyorsa işlenmez.
    const { girdi: belgeGirdisi, engeller, denetim, ihracKayitliKodu } = gelenDenetle(ubl, await this.gelenTablolari(ubl.tarih), (sira) => {
      const stokId = eslesme.get(sira);
      return stokId ? { stokId, varyantId: varyantlar.get(sira) } : undefined;
    });
    if (engeller.length > 0) {
      throw new BadRequestException(`Belge faturaya işlenemez: ${engeller.join("; ")}`);
    }
    if (!denetim.gecerli) {
      throw new BadRequestException(
        `Oluşacak fatura belgenin tutarlarını tutmuyor (tolerans ${denetim.tolerans.toFixed(2)} ${ubl.dovizCinsi}): ${denetim.asanlar
          .map((f) => `${f.ad} belge ${f.belge.toFixed(2)}, sistem ${f.sistem.toFixed(2)}`)
          .join("; ")}. Belgeyi reddedin ya da faturayı elle girin.`,
      );
    }
    const tip = belgeGirdisi.tip;

    // EBLG-150: kural uyarıları kullanıcının eşleştirmesiyle yeniden hesaplanır ve onay ister.
    const aliDenetimi = await this.gelenDenetimSakla(id, girdi.satirEslesmeleri);
    const onDenetimKarari = await this.onDenetimOnayiDenetle({ gelenEbelgeId: id }, aliDenetimi?.bulgular ?? [], girdi.onDenetimOnayi);

    const { cari: mevcutCari, uyari: cariUyarisi } = await this.prisma.tenantIslem(tenantId, (tx) =>
      gonderenCariSec(tx, tenantId, kayit.gonderenVkn, tip === "satis_iade" ? "musteri" : "tedarikci"),
    );

    if (!mevcutCari && !girdi.yeniCariOnay) {
      throw new BadRequestException(
        `Gönderen firma (${kayit.gonderenUnvan} - VKN: ${kayit.gonderenVkn}) sisteminizde kayıtlı bir cari hesap değil. Lütfen yeni cari hesap açılmasını onaylayın.`,
      );
    }
    if (cariUyarisi) throw new BadRequestException(cariUyarisi);

    const cariId = await this.gonderenCariBulVeyaOlustur(
      tenantId,
      kayit.gonderenVkn,
      kayit.gonderenUnvan,
      tip === "satis_iade" ? "musteri" : "tedarikci",
    );

    // EBLG-115: tolerans içindeki kuruş farkı faturanın notunda kalır.
    const kurusFarklari = denetim.satirlar.filter((f) => f.fark !== 0);
    const fatura = await this.faturaService.olustur({
      tip,
      no: kayit.belgeNo,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      vadeTarihi: ubl.vadeTarihi ?? null,
      cariId,
      dovizCinsi: belgeGirdisi.dovizCinsi as DovizKodu,
      kur: belgeGirdisi.kur,
      genelIskontoYuzdesi: "0",
      genelIskontoTutari: belgeGirdisi.genelIskontoTutari,
      aciklama: `Gelen e-Fatura ${kayit.belgeNo} — ${kayit.gonderenUnvan}`,
      notlar: kurusFarklari.length
        ? `Belge ile kuruş farkı (${ubl.dovizCinsi}): ${kurusFarklari.map((f) => `${f.ad} ${f.fark > 0 ? "+" : ""}${f.fark.toFixed(2)}`).join(", ")}`
        : null,
      ihracKayitliKodu,
      ozelMatrahKodu: belgeGirdisi.ozelMatrahKodu,
      ozelMatrahTutari: belgeGirdisi.ozelMatrahTutari,
      ozelMatrahOrani: belgeGirdisi.ozelMatrahOrani,
      satirlar: belgeGirdisi.satirlar.map((s) => ({
        stokId: s.stokId,
        varyantId: s.varyantId,
        miktar: s.miktar,
        birim: s.birim,
        birimFiyat: s.birimFiyat,
        iskontoOrani: s.iskontoOrani,
        kdvOrani: s.kdvOrani,
        tevkifatKodu: s.tevkifatKodu,
        tevkifatOrani: s.tevkifatOrani,
        gibIstisnaKodu: null,
        // EBLG-120: KDV dışı vergiler; davranış servis tarafında merkezden çözülür.
        ekVergiler: s.ekVergiler,
      })),
    }, { gelenBelge: true });

    try {
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.gelenEbelge.update({
          where: { id },
          data: { durum: "islendi", faturaId: fatura.id },
        });
        // EBLG-119: iade belgesinin dayandığı faturalar; bizim kesin satış
        // faturamızla eşleşen bağlanır (satış iadesi maliyeti STK-26).
        if (tip === "satis_iade" && ubl.iadeReferanslari.length > 0) {
          const kaynaklar = await tx.fatura.findMany({
            where: { cariId, tip: "satis", durum: "kesin", no: { in: ubl.iadeReferanslari.map((r) => r.no) } },
            select: { id: true, no: true, tarih: true },
          });
          const tekil = [...new Map(ubl.iadeReferanslari.map((r) => [r.no, r])).values()];
          await tx.faturaIadeReferansi.createMany({
            data: tekil.map((r, index) => {
              const kaynak = kaynaklar.find((k) => k.no === r.no);
              return { tenantId, faturaId: fatura.id, sira: index + 1, kaynakFaturaId: kaynak?.id ?? null, belgeNo: r.no, tarih: kaynak?.tarih ?? new Date(r.tarih ?? kayit.tarih.toISOString().slice(0, 10)) };
            }),
          });
        }
      });
    } catch (hata) {
      // Bağ kurulamadıysa taslak ortada kalmasın: geri al ve hatayı yükselt.
      await this.faturaService.sil(fatura.id).catch(() => undefined);
      throw hata;
    }
    if (onDenetimKarari) await this.onDenetimKarariYaz({ gelenEbelgeId: id }, onDenetimKarari);

    // STK-23: bağlanan satırın satıcı kodu (varyant ya da kart düzeyinde) öğrenilir; hata faturayı geri almaz.
    // İade belgesindeki kod müşterinindir, satıcı kodu değildir.
    if (tip === "alis") await this.prisma.tenantIslem(tenantId, (tx) =>
      tedarikciKodlariniOgren(tx, tenantId, cariId, ubl.satirlar.map((s) => ({ saticiUrunKodu: s.saticiUrunKodu, stokId: eslesme.get(s.siraNo) as string, varyantId: varyantlar.get(s.siraNo) }))),
    ).catch((hata: unknown) => this.logger.warn(JSON.stringify({ event: "tedarikci_varyant_kodu_ogrenilemedi", gelenEbelgeId: id, hata: hata instanceof Error ? hata.message : String(hata) })));

    // SAT-13: faturada adı geçen irsaliyeler (DespatchDocumentReference)
    // bizdeki alış irsaliyelerine bağlanır; sorun faturayı geri almaz, söylenir.
    const irsaliyeBagi = ubl.irsaliyeler.length > 0
      ? await this.belgeler.gelenFaturaIrsaliyeleriniBagla(fatura.id, cariId, ubl.irsaliyeler.map((i) => i.no)).catch((hata: unknown) => ({
          baglanan: [], bulunamayan: [], farklar: [], gecikmeler: [], baglamaHatasi: hata instanceof Error ? hata.message : "İrsaliyeler bağlanamadı",
        }))
      : null;

    return {
      gelenEbelgeId: id,
      faturaId: fatura.id,
      irsaliyeNolari: ubl.irsaliyeler.map((i) => i.no),
      irsaliyeBagi,
      faturaTipi: tip,
      belgeToplami: ubl.toplamlar.genelToplam.toFixed(2),
      hesaplananToplam: fatura.genelToplam,
      /** EBLG-115: tolerans içi farklar (aşanlar işlemeyi zaten durdurur). */
      tutarDenetimi: denetim,
    };
  }

  /**
   * Oluşturulan taslak alış faturasını siler ve gelen e-belgeyi
   * tekrar 'beklemede' durumuna getirerek yeniden stok eşleştirmesi yapılmasına olanak tanır.
   */
  async gelenTaslakIptalEt(id: string) {
    const { tenantId } = aktifBaglam();

    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({
        where: { id },
        include: { fatura: true },
      }),
    );

    if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");
    if (!kayit.faturaId || !kayit.fatura) {
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.update({
          where: { id },
          data: { durum: "beklemede", faturaId: null },
        }),
      );
      return { basarili: true, mesaj: "Belge tekrar onaya düştü" };
    }

    if (kayit.fatura.durum === "kesin") {
      throw new BadRequestException(
        "Kesinleşmiş alış faturası iptal edilemez; öncelikle faturanın durumunu taslağa çekin veya silin.",
      );
    }

    const faturaId = kayit.faturaId;
    await this.faturaService.sil(faturaId);

    return {
      basarili: true,
      gelenEbelgeId: id,
      mesaj: "Taslak fatura silindi ve belge tekrar onaya düştü",
    };
  }

  /**
   * EBLG-06: ticari faturaya kabul/ret yanıtı gönderir. Temel faturada yanıt
   * kavramı yoktur; ret gerekçe ister ve belgeyi işlenemez hale getirir.
   */
  /**
   * EBLG-34: entegratörde verilmiş kararı, yerelde yanıtı olmayan kayda
   * yazar. Ret yalnız bekleyen belgeyi kapatır; faturaya işlenmiş belgenin
   * durumu korunur. Yerel kararın üzerine yazılmaz.
   */
  private async yanitBenimse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    uuid: string,
    yanit: { karar: "kabul" | "ret"; not?: string },
  ) {
    const kosul = { tenantId, uuid, yanit: null };
    if (yanit.karar === "ret") {
      await tx.gelenEbelge.updateMany({ where: { ...kosul, durum: "beklemede" }, data: { durum: "reddedildi" } });
    }
    await tx.gelenEbelge.updateMany({
      where: kosul,
      data: { yanit: yanit.karar, yanitGerekce: yanit.not ?? null, yanitZamani: new Date() },
    });
  }

  async gelenYanitGonder(
    id: string,
    girdi: { yanit: "kabul" | "ret"; gerekce?: string | null },
  ) {
    const { tenantId } = aktifBaglam();

    const kayit = await this.kayitTazele(tenantId, id);
    if (kayit.yanit) {
      throw new ConflictException(
        `Bu belgeye zaten '${kayit.yanit}' yanıtı gönderilmiş`,
      );
    }
    if (kayit.profilId !== "TICARIFATURA") {
      throw new BadRequestException(
        "Kabul/ret yanıtı yalnızca ticari fatura (TICARIFATURA) profilinde gönderilebilir",
      );
    }
    if (girdi.yanit === "ret") {
      if (!girdi.gerekce?.trim()) {
        throw new BadRequestException("Ret yanıtı için gerekçe zorunludur");
      }
      if (kayit.durum === "islendi") {
        throw new BadRequestException(
          "Faturaya işlenmiş belge reddedilemez; önce oluşan taslak faturayı silin",
        );
      }
    }

    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }),
    );
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

    // EBLG-34: belge portalda ya da aynı hesabı kullanan başka bir yerde
    // yanıtlanmış olabilir; fatura taraması kursörle ilerlediği için önceden
    // içe aktarılmış belge bunu ancak burada öğrenir. Sorgu yapılamazsa
    // gönderim sürer — mükerrer yanıtı entegratör kendisi reddeder.
    const mevcut = adapter.gelenYanitDurumu
      ? await adapter.gelenYanitDurumu(cfg, kayit.uuid).catch(() => null)
      : null;
    if (mevcut) {
      await this.prisma.tenantIslem(tenantId, (tx) => this.yanitBenimse(tx, tenantId, kayit.uuid, mevcut));
      throw new ConflictException(
        `Bu belgeye entegratörde zaten '${mevcut.karar}' yanıtı verilmiş; kayıt güncellendi`,
      );
    }

    const sonuc = await adapter.yanitGonder(cfg, kayit.uuid, girdi.yanit, girdi.gerekce ?? undefined, {
      gonderenVkn: kayit.gonderenVkn || "",
      xml: (await gelenXmlOku(kayit, this.xmlDepo)) || "",
    });
    if (!sonuc.basarili) {
      throw new BadRequestException(
        sonuc.hataMesaji ?? "Yanıt entegratöre iletilemedi",
      );
    }

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.update({
        where: { id },
        data: {
          yanit: girdi.yanit,
          yanitGerekce: girdi.gerekce?.trim() || null,
          yanitZamani: new Date(),
          ...(girdi.yanit === "ret" ? { durum: "reddedildi" as GelenEbelgeDurum } : {}),
        },
      }),
    );
  }

  /**
   * e-Arşiv belgesini entegratörde iptal eder ve kaydı iptal olarak işaretler.
   * Fatura iptalinin **kendi işleminin içinden** çağrılır: bir başarısızlık
   * burada hata fırlatır ve çağıranın işlemi geri alınır, böylece "bizde
   * iptal, entegratörde canlı" belge kalmaz.
   *
   * GİB raporuna girmiş belge iptal edilmez — o noktadan sonra iptal bildirimi
   * raporlama üzerinden yürür ve uygulamanın doğrulayamayacağı bir süreçtir.
   */
  /**
   * e-Belgesi entegratöre hiç ulaşmamış kesin fatura (kayıt "hata", numara ve
   * entegratör referansı yok) iptal edilebilir. GİB'de karşılığı olmadığı için
   * entegratöre iptal gönderilmez; ama önceki denemede ağ çağrısı başarılı
   * olup kalıcılaştırma düşmüş olabilir (EBLG-17), bu yüzden önce sağlayıcıya
   * sorulur. Belge oradaysa ya da sorulamıyorsa iptal durur — körlemesine
   * iptal, GİB'de canlı duran bir belgeyi bizde iptal göstermek olurdu.
   */
  async gitmemisBelgeyiKapat(
    tx: Prisma.TransactionClient,
    fatura: { id: string },
    ebelge: { id: string; tur: EbelgeTur },
  ): Promise<void> {
    await this.entegratoreUlasmadiginiDogrula(tx, fatura, ebelge, "fatura iptal edilemez", "iptal durduruldu");
    await tx.ebelgeKayit.update({ where: { id: ebelge.id }, data: { durum: "iptal" } });
  }

  /**
   * Belgenin entegratörde oluşmadığını sağlayıcıya sorarak doğrular; oluşmuşsa
   * ya da sorulamıyorsa hata fırlatır. Gitmemiş belgenin iptali (EBLG-81) ve
   * taslağa geri alınması (FTR-29) bunu kullanır.
   */
  async entegratoreUlasmadiginiDogrula(
    tx: Prisma.TransactionClient,
    fatura: { id: string },
    ebelge: { tur: EbelgeTur },
    engel: string,
    durdu: string,
  ): Promise<void> {
    const { tenantId } = aktifBaglam();
    const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
    if (!baglanti) throw new BadRequestException(`Aktif e-belge bağlantısı bulunamadı; belgenin entegratöre ulaşmadığı doğrulanamadan ${engel}`);
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.belgeAra) throw new BadRequestException(`Aktif entegratörde belge sorgusu yok; belgenin entegratöre ulaşmadığı doğrulanamadan ${engel}`);
    this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "belgeAra", saglayici: baglanti.saglayici });
    let mevcut: GonderimSonuc | undefined;
    try {
      mevcut = await adapter.belgeAra(cfg, fatura.id, ebelge.tur);
    } catch (hata) {
      const sebep = hata instanceof Error ? hata.message : "bilinmeyen hata";
      throw new ServiceUnavailableException(`Belgenin entegratörde oluşup oluşmadığı kontrol edilemedi, ${durdu}: ${sebep}`);
    }
    if (mevcut) {
      throw new ConflictException(`Belge entegratörde oluşmuş${mevcut.belgeNo ? ` (${mevcut.belgeNo})` : ""}; önce e-Belge durumunu sorgulayın, fatura numarasını alsın`);
    }
  }

  async earsivBelgesiniIptalEt(
    tx: Prisma.TransactionClient,
    fatura: { id: string; no: string | null; tarih: Date; genelToplam: Prisma.Decimal },
    ebelge: { id: string; entegratorRef: string | null; createdAt?: Date | null },
  ): Promise<void> {
    const { tenantId } = aktifBaglam();
    const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı; e-Arşiv belgesi iptal edilemez");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.earsivIptal) throw new BadRequestException("Aktif entegratör e-Arşiv iptalini desteklemiyor");
    if (!fatura.no) throw new BadRequestException("Numarasız e-Arşiv belgesi iptal edilemez");
    let raporlandi = false;

    // İptali sınırlayan şey raporlanma değil süredir: e-Arşiv raporu günlük
    // gidiyor, belge ertesi gün raporlanmış oluyor ama iptal hakkı sürüyor.
    // MVZ-13: süre Mevzuat Merkezi'nden, fatura tarihindeki değer (yoksa 8 gün).
    // Süre fatura tarihi ile gönderim gününden sonrakinden, takvim günüyle işler.
    const gunSayisi = await kanuniDegerOku(tx, "earsiv_iptal_gun", fatura.tarih, 8);
    const gunFarki = earsivIptalGecenGun(fatura.tarih, ebelge.createdAt);
    if (gunFarki > gunSayisi) {
      throw new BadRequestException(
        `${fatura.no} numaralı e-Arşiv faturasının ${gunSayisi} günlük iptal süresi geçmiş (${gunFarki} gün); düzeltme için iade faturası düzenleyin.`,
      );
    }

    if (ebelge.entegratorRef) {
      this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "durumSorgula", saglayici: baglanti.saglayici });
      const durum = await this.entegratordenOku(() => adapter.durumSorgula(cfg, ebelge.entegratorRef!));
      // Belge sağlayıcıda zaten iptalse istenen sonuç gerçekleşmiş demektir;
      // ikinci iptal çağrısı hata döndürür ("iptal edilebilir belgeler
      // arasında yok") ve kullanıcı bunu gerçek bir arıza sanır. Kaydı
      // eşitleyip sessizce çıkıyoruz.
      if (durum.iptalEdilmis) {
        this.logger.warn(JSON.stringify({ event: "earsiv_zaten_iptal", faturaId: fatura.id, belgeNo: fatura.no }));
        await tx.ebelgeKayit.update({ where: { id: ebelge.id }, data: { durum: "iptal", hataMesaji: null } });
        return;
      }
      // Raporlanmış olmak iptali engellemez ama iptalin de GİB'e bildirilmesi
      // gerekir; bu iş muhasebede olduğu için bildirimle haber verilir.
      if (durum.raporlandi) raporlandi = true;
    }

    this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "earsivIptal", saglayici: baglanti.saglayici });
    const sonuc = await this.entegratordenOku(() =>
      adapter.earsivIptal!(cfg, { faturaNo: fatura.no!, toplamTutar: fatura.genelToplam.toFixed(2), iptalTarihi: new Date() }),
    );
    if (!sonuc.basarili) throw new BadRequestException(sonuc.mesaj || "e-Arşiv iptali entegratöre bildirilemedi");
    await tx.ebelgeKayit.update({ where: { id: ebelge.id }, data: { durum: "iptal", hataMesaji: null } });

    if (raporlandi) {
      await this.bildirimler.uret({
        tur: "ebelge",
        onem: "uyari",
        baslik: `${fatura.no} iptal edildi, GİB'e raporlanmıştı`,
        aciklama: "Fatura GİB e-Arşiv raporuna girdikten sonra iptal edildi; iptalin raporlanması muhasebe tarafında takip edilmelidir.",
        birlesimAnahtari: `earsiv-iptal-raporlu:${fatura.id}`,
        kaynakTur: "fatura",
        kaynakRef: fatura.id,
        hedefYol: `/panel/fatura?fatura=${fatura.id}`,
        roller: ["muhasebe", "yonetici"],
      });
    }
  }

  async earsivIptalBildir(faturaId: string, girdi: { iptalTarihi: Date; sube?: string }) {
    const { tenantId } = aktifBaglam();
    const veri = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, include: { ebelge: true } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "iptal") throw new BadRequestException("e-Arşiv iptal bildirimi için fatura önce TekirExtra'da iptal edilmelidir");
      if (!fatura.no || fatura.ebelge?.tur !== "earsiv") throw new BadRequestException("Faturaya bağlı bir e-Arşiv kaydı bulunamadı");
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
      if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
      return { fatura, baglanti };
    });
    const cfg = JSON.parse(coz(veri.baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(veri.baglanti.saglayici);
    if (!adapter.earsivIptal) throw new BadRequestException("Aktif entegratör e-Arşiv iptal bildirimini desteklemiyor");
    // Bu uç, bildirimi düşen kaydı kurtarmak için. Belge entegratörde zaten
    // iptalse yapılacak iş kaydı eşitlemekten ibaret.
    const ref = veri.fatura.ebelge?.entegratorRef;
    if (ref) {
      const durum = await this.entegratordenOku(() => adapter.durumSorgula(cfg, ref));
      if (durum.iptalEdilmis) {
        await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.ebelgeKayit.update({ where: { id: veri.fatura.ebelge!.id }, data: { durum: "iptal", hataMesaji: null } }),
        );
        return { basarili: true, mesaj: "Belge entegratörde zaten iptal edilmiş; kayıt eşitlendi" };
      }
    }
    const sonuc = await this.entegratordenOku(() => adapter.earsivIptal!(cfg, { faturaNo: veri.fatura.no!, toplamTutar: veri.fatura.genelToplam.toFixed(2), iptalTarihi: girdi.iptalTarihi, sube: girdi.sube }));
    if (!sonuc.basarili) throw new BadRequestException(sonuc.mesaj || "e-Arşiv iptali entegratöre bildirilemedi");
    return sonuc;
  }

  /**
   * Entegratör hatasını kullanıcıya taşır. Adaptörler yetki ve istek hatalarını
   * okunur mesaja çeviriyor (eksik NES scope'unun adı gibi); sarmalanmadığında
   * bu mesaj 500'e dönüşüp "Beklenmeyen sunucu hatası" olarak kayboluyordu
   * (e-Arşiv raporları, 2026-09-10).
   */
  private async entegratordenOku<T>(islem: () => Promise<T>): Promise<T> {
    try {
      return await islem();
    } catch (hata) {
      if (hata instanceof HttpException) throw hata;
      throw new BadGatewayException(hata instanceof Error ? hata.message : "Entegratör çağrısı başarısız");
    }
  }

  async earsivRaporListele(baslangic: Date, bitis: Date) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }));
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.earsivRaporListele) throw new BadRequestException("Aktif entegratör e-Arşiv raporlarını desteklemiyor");
    return this.entegratordenOku(() => adapter.earsivRaporListele!(cfg, baslangic, bitis));
  }

  async earsivRaporDurum(uuid: string) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }));
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.earsivRaporDurum) throw new BadRequestException("Aktif entegratör e-Arşiv rapor durumunu desteklemiyor");
    return this.entegratordenOku(() => adapter.earsivRaporDurum!(cfg, uuid));
  }

  /**
   * Rapor bölümünün GİB'e bildirilen tutarı (EBLG-07). NES listede tutar
   * vermediği için ekran bunu satır bazında ister; liste her bölüm için
   * döküm çağırmaz (çağrı disiplini, EBLG-15).
   */
  async earsivRaporTutari(uuid: string) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }),
    );
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.earsivRaporTutari) throw new BadRequestException("Aktif entegratör rapor tutarını listede veriyor; ayrı döküm sorgusu yok");
    this.metrics.increment("ebelge_entegrator_cagri_total", { metot: "earsivRaporTutari", saglayici: baglanti.saglayici });
    return this.entegratordenOku(() => adapter.earsivRaporTutari!(cfg, uuid));
  }

  // ─── GELEN BELGE YARDIMCILARI ──────────────────────────────────────────────

  /**
   * Kaydı okur; oluşan taslak fatura sonradan silinmişse (FK SET NULL ile
   * `faturaId` boşalır) belgeyi tekrar onaylanabilir hale getirir — aksi hâlde
   * ortada faturası olmayan "işlendi" kaydı kilitli kalırdı.
   */
  private async kayitTazele(tenantId: string, id: string) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({ where: { id } }),
    );
    if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");

    if (kayit.durum === "islendi" && !kayit.faturaId) {
      return this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.update({ where: { id }, data: { durum: "beklemede" } }),
      );
    }
    return kayit;
  }

  /**
   * Satır başına otomatik stok eşleştirme. Sıra, en güvenilir ipucundan en
   * zayıfına doğrudur: bizim ürün kodumuz → barkod → tedarikçinin bizde kayıtlı
   * ürün kodu (STK-18) → üretici kodu → birebir ad.
   */
  private async eslesmeOner(
    tenantId: string,
    satirlar: UblSatir[],
    cariId: string | null,
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = [];

      for (const s of satirlar) {
        const { stokId, varyantId, kaynak } = await stokKartiBul(tx, tenantId, s, cariId);

        const stok = stokId
          ? await tx.stokKart.findUnique({
              where: { id: stokId },
              select: {
                id: true, kod: true, ad: true, anaBirim: true, kdvOrani: true,
                // Varyantlı kartta satırın varyantı ekranda seçilir.
                varyantlar: { where: { aktif: true }, orderBy: { kod: "asc" }, select: { id: true, kod: true, ad: true } },
              },
            })
          : null;

        sonuc.push({
          siraNo: s.siraNo,
          ad: s.ad,
          saticiUrunKodu: s.saticiUrunKodu ?? null,
          aliciUrunKodu: s.aliciUrunKodu ?? null,
          ureticiUrunKodu: s.ureticiUrunKodu ?? null,
          barkod: s.barkod ?? null,
          miktar: s.miktar.toFixed(3),
          birim: s.birim,
          birimFiyat: s.birimFiyat.toFixed(4),
          iskontoOrani: s.iskontoOrani.toFixed(2),
          iskontoTutari: s.iskontoTutari.toFixed(2),
          kdvOrani: s.kdvOrani.toFixed(2),
          kdvTutari: s.kdvTutari.toFixed(2),
          matrah: s.matrah.toFixed(2),
          onerilenStokId: stok?.id ?? null,
          onerilenVaryantId: stok ? varyantId : null,
          onerilenStok: stok
            ? {
                id: stok.id,
                kod: stok.kod,
                ad: stok.ad,
                anaBirim: stok.anaBirim,
                kdvOrani: stok.kdvOrani.toFixed(2),
                varyantlar: stok.varyantlar,
              }
            : null,
          eslesmeKaynagi: kaynak,
        });
      }

      return sonuc;
    });
  }

  /** Gönderen VKN'siyle cari bulur; yoksa tedarikçi (iade belgesinde müşteri) carisi açar. */
  private async gonderenCariBulVeyaOlustur(
    tenantId: string,
    vkn: string,
    unvan: string,
    tip: "tedarikci" | "musteri" = "tedarikci",
  ): Promise<string> {
    return this.prisma.tenantIslem(tenantId, (tx) => tedarikciCariBulVeyaOlustur(tx, tenantId, vkn, unvan, tip));
  }

  /**
   * Manuel XML e-Fatura / e-Arşiv Yükleme (UBL-TR 1.2 XML Ayrıştırma & Taslak Gelen Belge Kaydı)
   */
  async xmlYukleVeParseEt(xmlIcerik: string) {
    const { tenantId } = aktifBaglam();

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(xmlIcerik);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof UblOkumaHatasi
          ? `Yüklenen XML dosyası ayrıştırılamadı: ${hata.message}`
          : "Yüklenen XML dosyası geçerli bir UBL-TR e-Fatura formatında değil",
      );
    }

    // Gelen e-Belge tablosuna taslak olarak kaydet (varsa güncelle, yoksa ekle)
    const xmlKaydi = await gelenXmlYaz(this.xmlDepo, tenantId, ubl.uuid, xmlIcerik);
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.gelenEbelge.findFirst({
        where: { tenantId, uuid: ubl.uuid },
      });

      if (mevcut) {
        return tx.gelenEbelge.update({
          where: { id: mevcut.id },
          data: {
            ...xmlKaydi,
            belgeNo: ubl.belgeNo,
            gonderenVkn: ubl.gonderen.vknTckn,
            gonderenUnvan: ubl.gonderen.unvan,
            tarih: new Date(ubl.tarih),
            profilId: ubl.profilId,
            ...gelenOzeti(xmlIcerik),
          },
        });
      }

      return tx.gelenEbelge.create({
        data: {
          tenantId,
          uuid: ubl.uuid,
          belgeNo: ubl.belgeNo,
          gonderenVkn: ubl.gonderen.vknTckn,
          gonderenUnvan: ubl.gonderen.unvan,
          tarih: new Date(ubl.tarih),
          profilId: ubl.profilId,
          ...xmlKaydi,
          ...gelenOzeti(xmlIcerik),
          durum: "beklemede",
        },
      });
    });

    return {
      gelenEbelgeId: kayit.id,
      uuid: kayit.uuid,
      belgeNo: kayit.belgeNo,
      gonderenUnvan: kayit.gonderenUnvan,
      gonderenVkn: kayit.gonderenVkn,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      toplamTutar: ubl.toplamlar.genelToplam.toFixed(2),
      dovizCinsi: ubl.dovizCinsi,
      satirSayisi: ubl.satirlar.length,
      mesaj: "XML e-Fatura başarıyla içeri aktarıldı ve gelen kutusuna eklendi.",
    };
  }

  // ─── ÖN DENETİM KARARI VE SUSTURMA (EBLG-141) ─────────────────────────

  /**
   * Gönderimden önce: her uyarı ya bu istekteki onayda ya da bu faturanın
   * önceki bir kararında (yeniden gönderim) bulunmalıdır. Kaydedilecek yeni
   * kararı döner; onay gerekmiyorsa null.
   */
  async onDenetimOnayiDenetle(
    hedef: OnDenetimHedefi,
    bulgular: OnDenetimBulgusu[],
    onay?: { anahtarlar: string[]; gerekce?: string },
  ): Promise<{ bulgular: { kod: string; satir: number | null; mesaj: string }[]; gerekce: string | null } | null> {
    const uyarilar = bulgular.filter((b) => b.duzey === "uyari");
    if (!uyarilar.length) return null;
    const { tenantId } = aktifBaglam();
    // Gelen belgede önceki karar: taslağı iptal edilip yeniden işlenen belge.
    const onceki = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.onDenetimKarari.findMany({ where: { tenantId, ...hedef }, select: { bulgular: true } }));
    const onaylanan = new Set([
      ...(onay?.anahtarlar ?? []),
      ...onceki.flatMap((k) => (k.bulgular as { kod: string; satir: number | null }[]).map((b) => onDenetimAnahtari({ kod: b.kod as OnDenetimBulgusu["kod"], satir: b.satir ?? undefined }))),
    ]);
    const eksik = uyarilar.filter((b) => !onaylanan.has(onDenetimAnahtari(b)));
    if (eksik.length) {
      throw new BadRequestException(
        "gelenEbelgeId" in hedef
          ? `Gelen alış denetiminde onaylanmamış ${eksik.length} uyarı var; uyarıları görüp "Uyarıları gördüm" ile işleyin. ${eksik.map((b) => b.mesaj).join(" ")}`
          : `Ön denetimde onaylanmamış ${eksik.length} uyarı var; e-Belge sihirbazında uyarıları görüp "Uyarıları gördüm" ile gönderin. ${eksik.map((b) => b.mesaj).join(" ")}`,
      );
    }
    // Uyarıların hepsi önceki kararlardaysa (yeniden gönderim) yeni kayıt açılmaz.
    if (!onay) return null;
    return {
      bulgular: uyarilar.map((b) => ({ kod: b.kod, satir: b.satir ?? null, mesaj: b.mesaj })),
      gerekce: onay.gerekce?.trim() || null,
    };
  }

  async onDenetimKarariYaz(hedef: OnDenetimHedefi, karar: { bulgular: { kod: string; satir: number | null; mesaj: string }[]; gerekce: string | null }) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.onDenetimKarari.create({ data: { tenantId, ...hedef, userId: userId ?? null, bulgular: karar.bulgular, gerekce: karar.gerekce } }));
  }

  // ─── GELEN ALIŞ DENETÇİSİ (EBLG-144…150) ──────────────────────────────

  /**
   * Gelen belgenin kural denetimi; sonuç belgeyle saklanır (liste rozeti).
   * Eşleştirme verilmezse satırlar `stokKartiBul` önerisiyle eşlenir. Belge
   * okunamazsa ya da denetim düşerse null döner: denetçi işlemeyi kendisi
   * engellemez, engeller EBLG-115 kapısındadır.
   */
  async gelenDenetimSakla(
    id: string,
    eslesmeler?: { siraNo: number; stokId: string; varyantId?: string | null }[],
  ): Promise<{ bulgular: OnDenetimBulgusu[]; susturulan: number; cariId: string | null } | null> {
    const { tenantId } = aktifBaglam();
    try {
      const ayar = this.ayarlar ? await this.ayarlar.getir("ebelge") : {};
      const satinAlma = this.ayarlar ? await this.ayarlar.getir("satin_alma") : {};
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        const kayit = await tx.gelenEbelge.findUnique({ where: { id }, select: { id: true, gonderenVkn: true, faturaId: true, xmlIcerik: true, xmlAnahtar: true, xmlOzet: true } });
        if (!kayit) return null;
        let ubl: UblFatura;
        try { ubl = faturaUblOku(await gelenXmlOku(kayit, this.xmlDepo)); } catch { return null; }
        const tip = gelenFaturaTipi(ubl);
        const { cari } = await gonderenCariSec(tx, tenantId, kayit.gonderenVkn, tip === "satis_iade" ? "musteri" : "tedarikci");
        const harita = new Map<number, { stokId: string; varyantId?: string | null }>();
        if (eslesmeler) {
          for (const e of eslesmeler) harita.set(e.siraNo, e);
        } else {
          for (const s of ubl.satirlar) {
            const { stokId, varyantId } = await stokKartiBul(tx, tenantId, s, cari?.id ?? null);
            if (stokId) harita.set(s.siraNo, { stokId, varyantId });
          }
        }
        const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { sifreliConfig: true } });
        const testOrtami = baglanti ? Boolean((JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).testOrtami) : false;
        const sonuc = await gelenDenetimCalistir(tx, tenantId, kayit, ubl, (sira) => harita.get(sira), {
          fiyatYuzde: Number(ayar.gelenFiyatYuzde ?? 25),
          siparisToleransYuzde: Number(satinAlma.fiyatToleransYuzde ?? 1),
          testOrtami,
        }, this.xmlDepo);
        await tx.gelenEbelge.update({
          where: { id },
          data: {
            denetimBulgulari: sonuc.bulgular as unknown as Prisma.InputJsonValue,
            denetimUyariSayisi: sonuc.bulgular.filter((b) => b.duzey === "uyari").length,
            denetimAt: new Date(),
          },
        });
        return { ...sonuc, cariId: cari?.id ?? null };
      }, { timeout: 30_000 });
    } catch (hata) {
      this.logger.warn(JSON.stringify({ event: "gelen_denetim_hesaplanamadi", gelenEbelgeId: id, hata: hata instanceof Error ? hata.message : String(hata) }));
      return null;
    }
  }

  /** Fatura detayında: kim, ne zaman, hangi uyarıları geçti. */
  async onDenetimKararlari(faturaId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kararlar = await tx.onDenetimKarari.findMany({ where: { tenantId, faturaId }, orderBy: { createdAt: "desc" } });
      const kullanicilar = await tx.user.findMany({
        where: { id: { in: kararlar.map((k) => k.userId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, adSoyad: true },
      });
      return kararlar.map((k) => ({
        id: k.id,
        zaman: k.createdAt,
        kullanici: kullanicilar.find((u) => u.id === k.userId)?.adSoyad ?? null,
        gerekce: k.gerekce,
        bulgular: k.bulgular,
      }));
    });
  }

  /**
   * EBLG-143: ön denetimin etkisi. Gönderilen = entegratöre ulaşmış (kuyrukta
   * ya da hata değil); sorunlu = GİB/alıcı reddi ya da iptal. Ay, kaydın ilk
   * gönderim ayıdır (İstanbul). Gösterilip düzeltilen bulgular saklanmadığı
   * için ölçülmez; yalnız onaylanarak geçilen uyarılar sayılır.
   */
  async onDenetimOlcumu(aySayisi = 6) {
    const { tenantId } = aktifBaglam();
    const ay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7);
    const simdi = new Date();
    const baslangicAyi = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth() - (aySayisi - 1), 1));
    // Ay sınırı İstanbul saatine göre; UTC ayın başından 3 saat önce başlatılır.
    const baslangic = new Date(baslangicAyi.getTime() - 3 * 3_600_000);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kayitlar, tumKararlar, gelenBelgeler] = await Promise.all([
        tx.ebelgeKayit.findMany({
          where: { tenantId, createdAt: { gte: baslangic } },
          select: { faturaId: true, createdAt: true, durum: true, aliciYaniti: true, fatura: { select: { durum: true } } },
        }),
        tx.onDenetimKarari.findMany({ where: { tenantId, createdAt: { gte: baslangic } }, select: { faturaId: true, gelenEbelgeId: true, bulgular: true } }),
        // EBLG-150: gelen yön; belge sayısı denetlenmiş belgelerden.
        tx.gelenEbelge.findMany({ where: { tenantId, createdAt: { gte: baslangic }, denetimAt: { not: null } }, select: { denetimUyariSayisi: true } }),
      ]);
      const kararlar = tumKararlar.flatMap((k) => (k.faturaId ? [{ faturaId: k.faturaId, bulgular: k.bulgular }] : []));
      const gelenKurallar = new Map<string, number>();
      for (const k of tumKararlar.filter((x) => x.gelenEbelgeId)) {
        for (const b of k.bulgular as { kod: string }[]) gelenKurallar.set(b.kod, (gelenKurallar.get(b.kod) ?? 0) + 1);
      }
      const sorunlu = (k: (typeof kayitlar)[number]) => k.durum === "ret" || k.durum === "iptal" || k.aliciYaniti === "ret" || k.fatura.durum === "iptal";
      const gonderilmis = kayitlar.filter((k) => k.durum !== "kuyrukta" && k.durum !== "hata");
      const kararli = new Set(kararlar.map((k) => k.faturaId));
      const sorunluFaturalar = new Set(gonderilmis.filter(sorunlu).map((k) => k.faturaId));

      const aylar = new Map<string, { gonderilen: number; sorunlu: number; uyariIleGonderilen: number }>();
      for (let i = 0; i < aySayisi; i++) {
        aylar.set(ay(new Date(Date.UTC(baslangicAyi.getUTCFullYear(), baslangicAyi.getUTCMonth() + i, 15))), { gonderilen: 0, sorunlu: 0, uyariIleGonderilen: 0 });
      }
      const toplam = { once: { gonderilen: 0, sorunlu: 0 }, sonra: { gonderilen: 0, sorunlu: 0 } };
      const ozellikBasi = new Date(`${ON_DENETIM_BASLANGIC}T00:00:00+03:00`);
      for (const k of gonderilmis) {
        const satir = aylar.get(ay(k.createdAt));
        const donem = k.createdAt >= ozellikBasi ? toplam.sonra : toplam.once;
        donem.gonderilen++;
        if (sorunlu(k)) donem.sorunlu++;
        if (!satir) continue;
        satir.gonderilen++;
        if (sorunlu(k)) satir.sorunlu++;
        if (kararli.has(k.faturaId)) satir.uyariIleGonderilen++;
      }

      const kurallar = new Map<string, { gecilen: number; sonradanSorunlu: number }>();
      for (const k of kararlar) {
        for (const b of k.bulgular as { kod: string }[]) {
          const satir = kurallar.get(b.kod) ?? { gecilen: 0, sonradanSorunlu: 0 };
          satir.gecilen++;
          if (sorunluFaturalar.has(k.faturaId)) satir.sonradanSorunlu++;
          kurallar.set(b.kod, satir);
        }
      }
      const oran = (t: { gonderilen: number; sorunlu: number }) => (t.gonderilen ? Math.round((t.sorunlu / t.gonderilen) * 1000) / 10 : null);
      return {
        ozellikBaslangici: ON_DENETIM_BASLANGIC,
        aylar: [...aylar.entries()].map(([a, v]) => ({ ay: a, ...v, sorunluOrani: oran(v) })),
        once: { ...toplam.once, oran: oran(toplam.once) },
        sonra: { ...toplam.sonra, oran: oran(toplam.sonra) },
        kurallar: [...kurallar.entries()]
          .map(([kod, v]) => ({ kod, kural: ON_DENETIM_KURAL_ADLARI[kod as OnDenetimBulgusu["kod"]] ?? kod, ...v }))
          .sort((a, b) => b.gecilen - a.gecilen),
        gelen: {
          denetlenen: gelenBelgeler.length,
          uyarili: gelenBelgeler.filter((g) => (g.denetimUyariSayisi ?? 0) > 0).length,
          uyariylaIslenen: new Set(tumKararlar.map((k) => k.gelenEbelgeId).filter(Boolean)).size,
          kurallar: [...gelenKurallar.entries()]
            .map(([kod, gecilen]) => ({ kod, kural: ON_DENETIM_KURAL_ADLARI[kod as OnDenetimBulgusu["kod"]] ?? kod, gecilen }))
            .sort((a, b) => b.gecilen - a.gecilen),
        },
      };
    });
  }

  async onDenetimSusturmalari() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.onDenetimSusturma.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
      const cariler = await tx.cariHesap.findMany({ where: { tenantId, id: { in: kayitlar.map((k) => k.cariId) } }, select: { id: true, unvan: true } });
      const kullanicilar = await tx.user.findMany({
        where: { id: { in: kayitlar.map((k) => k.userId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, adSoyad: true },
      });
      return kayitlar.map((k) => ({
        id: k.id,
        cariId: k.cariId,
        cari: cariler.find((c) => c.id === k.cariId)?.unvan ?? null,
        kod: k.kod,
        kural: ON_DENETIM_KURAL_ADLARI[k.kod as OnDenetimBulgusu["kod"]] ?? k.kod,
        kullanici: kullanicilar.find((u) => u.id === k.userId)?.adSoyad ?? null,
        zaman: k.createdAt,
      }));
    });
  }

  async onDenetimSustur(cariId: string, kod: OnDenetimBulgusu["kod"]) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findFirst({ where: { id: cariId, tenantId }, select: { id: true } });
      if (!cari) throw new NotFoundException("Cari bulunamadı");
      return tx.onDenetimSusturma.upsert({
        where: { tenantId_cariId_kod: { tenantId, cariId, kod } },
        create: { tenantId, cariId, kod, userId: userId ?? null },
        update: {},
        select: { id: true },
      });
    });
  }

  async onDenetimSusturmaKaldir(id: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) => tx.onDenetimSusturma.deleteMany({ where: { id, tenantId } }));
    if (!silinen.count) throw new NotFoundException("Susturma bulunamadı");
  }
}
