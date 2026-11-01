import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { kurZorunlu } from "../doviz/kur-coz";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { bugunTR, posAcikTaksitler, posAzamiTaksit } from "@tekirextra/shared";
import { saglayiciKesintiAlanlari, tahminiKomisyonAlanlari, taksitTablosu } from "./taksit";
import { BildirimService } from "../bildirimler/bildirim.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { aktarimPlani } from "./aktarim-plani";
import { PrismaService } from "../core/prisma.service";
import { coz } from "../core/kripto";
import { IyzicoAdapter, iyzicoTelefonuDuzenle, type IyzicoConfig, type IyzicoKesintisi } from "./iyzico.adapter";
import { EpostaService } from "../tenant/eposta.service";
import { NetgsmAdapter, type NetgsmConfig } from "./netgsm.adapter";
import { PaytrAdapter, type PaytrCallback, type PaytrConfig } from "./paytr.adapter";
import { randomBytes } from "node:crypto";
import { adSoyadCoz } from "../cari/ad-soyad";
import { PdfService } from "../core/pdf/pdf.service";
import { makbuzPdfHtml } from "../kasa-banka/makbuz-pdf";
import { cariDenklestir, elleKapamaYaz } from "../fatura/denklestirme";
import { faturaKilitleVeKalaniGetir, mahsupAyir } from "../fatura/odeme-durumu";

/**
 * KSB-07: POS tahsilatı faturayla aynı dövizdedir; kalan kadar mahsup edilir.
 * Ödeme sağlayıcıda zaten gerçekleştiği için fatura bu arada kapanmışsa
 * reddedilmez, tamamı carinin avansı olarak kalır.
 */
async function posFaturaKapamasi(tx: Prisma.TransactionClient, faturaId: string | null, tutar: Prisma.Decimal) {
  if (!faturaId) return {};
  const fatura = await faturaKilitleVeKalaniGetir(tx, faturaId);
  return { faturaKarsiligi: tutar, faturaMahsubu: mahsupAyir(tutar, fatura.kalan).mahsup };
}

/** KSB-36: sağlayıcı yanıtından gelen taksit ve müşterinin ödediği tutar. */
interface OdemeAyrintisi {
  taksit?: number;
  odenen?: Prisma.Decimal;
  /** KSB-37: sağlayıcının bildirdiği kesinti (iyzico). */
  kesinti?: IyzicoKesintisi;
}

const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";
/** Ödemesi gelebilecek (sağlayıcıda para çekilebilecek) talep durumları. */
const ODENEBILIR_DURUMLAR = ["baslatildi", "suresi_doldu", "iptal"] as const;

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly eposta: EpostaService,
    private readonly pdf: PdfService,
    private readonly bildirimler: BildirimService,
    private readonly donemKilidi: DonemKilidiService,
  ) {}
  private config(sifreli: string): IyzicoConfig {
    const c = JSON.parse(coz(sifreli)) as any;
    return { apiKey: c.kullaniciAdi, secretKey: c.parola, baseUrl: c.servisAdresi ?? "https://sandbox-api.iyzipay.com" };
  }
  private netgsmConfig(sifreli: string): NetgsmConfig {
    const c = JSON.parse(coz(sifreli)) as any;
    return { kullaniciAdi: c.kullaniciAdi, parola: c.parola, gondericiAdi: c.gondericiAdi, servisAdresi: c.servisAdresi };
  }
  private paytrConfig(sifreli: string): PaytrConfig {
    const c = JSON.parse(coz(sifreli)) as any;
    return { merchantId: c.magazaId, merchantKey: c.kullaniciAdi, merchantSalt: c.parola };
  }

  async listele(girdi: {
    durum?: "baslatildi" | "odendi" | "basarisiz" | "iptal" | "suresi_doldu";
    arama?: string;
    posHesapId?: string;
    sayfa: number;
    adet: number;
  }) {
    const { tenantId } = aktifBaglam();
    const where: Prisma.PosTahsilatWhereInput = {
      durum: girdi.durum,
      posHesapId: girdi.posHesapId,
      ...(girdi.arama
        ? {
            OR: [
              { cari: { unvan: { contains: girdi.arama, mode: "insensitive" } } },
              { cari: { kod: { contains: girdi.arama, mode: "insensitive" } } },
              { fatura: { no: { contains: girdi.arama, mode: "insensitive" } } },
              { hataMesaji: { contains: girdi.arama, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.posTahsilat.updateMany({
        where: { durum: "baslatildi", sonKullanimTarihi: { lt: new Date() } },
        data: { durum: "suresi_doldu" },
      });
      const [hamKayitlar, toplam, durumlar] = await Promise.all([
        tx.posTahsilat.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (girdi.sayfa - 1) * girdi.adet,
          take: girdi.adet,
          include: {
            posHesap: { select: { id: true, ad: true, saglayici: true } },
            cari: { select: { id: true, kod: true, unvan: true } },
            fatura: { select: { id: true, no: true } },
            iadeler: { select: { id: true, tutar: true, tarih: true, neden: true }, orderBy: { createdAt: "asc" } },
          },
        }),
        tx.posTahsilat.count({ where }),
        tx.posTahsilat.groupBy({ by: ["durum"], _count: { _all: true } }),
      ]);
      const kayitlar = hamKayitlar.map((kayit) => ({
        ...kayit,
        iadeEdilen: kayit.iadeler.reduce((t, i) => t.add(i.tutar), new Prisma.Decimal(0)).toFixed(2),
        makbuzYolu: kayit.durum === "odendi" && kayit.hareketId ? `/pos/makbuz/${tenantId}/${kayit.id}/${kayit.makbuzAnahtari}` : null,
      }));
      return {
        kayitlar,
        toplam,
        sayfa: girdi.sayfa,
        adet: girdi.adet,
        durumOzetleri: Object.fromEntries(durumlar.map((x) => [x.durum, x._count._all])),
      };
    });
  }

  async baslat(girdi: { posHesapId: string; cariId: string; faturaId?: string; tutar: string; oncekiniIptalEt?: boolean }) {
    const { tenantId } = aktifBaglam();
    const tutar = new Prisma.Decimal(girdi.tutar);
    const kaynak = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posHesap.findUnique({ where: { id: girdi.posHesapId }, include: { baglanti: true } }),
    );
    if (kaynak?.saglayici === "banka")
      throw new BadRequestException("Banka POS'unda ödeme bağlantısı yoktur; çekilen slibi 'Slip gir' ile kaydedin");
    // P1-6: aynı faturaya ikinci açık bağlantı açılmaz; müşteri ikisini de öderse çift tahsilat olur.
    if (girdi.faturaId) {
      const acik = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.findFirst({
          where: {
            faturaId: girdi.faturaId,
            durum: "baslatildi",
            OR: [{ sonKullanimTarihi: null }, { sonKullanimTarihi: { gt: new Date() } }],
          },
          select: { id: true, tutar: true, dovizCinsi: true, createdAt: true },
        }),
      );
      if (acik && !girdi.oncekiniIptalEt)
        throw new ConflictException(
          `Bu faturanın ${acik.createdAt.toLocaleDateString("tr-TR")} tarihli ${acik.tutar.toFixed(2)} ${acik.dovizCinsi} tutarlı açık ödeme bağlantısı var. Mevcut bağlantıyı iptal edip yenisini oluşturabilirsiniz.`,
        );
      if (acik) await this.iptal(acik.id, "Aynı fatura için yeni ödeme bağlantısı oluşturuldu");
    }
    if (
      !kaynak ||
      !kaynak.aktif ||
      !["iyzico", "paytr"].includes(kaynak.saglayici) ||
      !kaynak.baglanti ||
      kaynak.baglanti.durum !== "aktif"
    )
      throw new BadRequestException("Aktif bağlantılı POS hesabı bulunamadı");
    const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findUnique({ where: { id: girdi.cariId }, include: { adresler: { take: 1 } } }),
    );
    if (!cari) throw new NotFoundException("Cari hesap bulunamadı");
    if (!cari.aktif) throw new BadRequestException("Pasif cari hesaba ödeme talebi oluşturulamaz");
    if (cari.dovizCinsi !== kaynak.dovizCinsi) throw new BadRequestException("Cari hesap ve POS hesabı para birimleri aynı olmalıdır");
    if (!cari.eposta) throw new BadRequestException("Ödeme bağlantısı için carinin e-posta adresi zorunludur");
    if (kaynak.saglayici === "iyzico" && !cari.adresler[0])
      throw new BadRequestException("iyzico ödemesi için carinin en az bir adresi zorunludur");
    if (girdi.faturaId) {
      const f = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findFirst({ where: { id: girdi.faturaId, cariId: cari.id } }));
      if (!f || f.durum !== "kesin" || !["satis", "alis_iade"].includes(f.tip))
        throw new BadRequestException("Yalnızca kesinleşmiş satış faturası tahsil edilebilir");
      if (f.dovizCinsi !== kaynak.dovizCinsi) throw new BadRequestException("Fatura ve POS hesabı para birimleri aynı olmalıdır");
    }
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.create({
        data: {
          tenantId,
          posHesapId: kaynak.id,
          cariId: cari.id,
          faturaId: girdi.faturaId,
          tutar,
          dovizCinsi: kaynak.dovizCinsi,
          sonKullanimTarihi: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          makbuzAnahtari: randomBytes(32).toString("hex"),
        },
      }),
    );
    const callbackKoku = process.env.PUBLIC_API_URL ?? "http://localhost:3001";
    const adres = cari.adresler[0];
    const { ad, soyad } = adSoyadCoz(cari); // CARI-21: karttaki ad/soyad, yoksa unvandan tahmin
    try {
      if (kaynak.saglayici === "paytr") {
        if (
          !process.env.PUBLIC_API_URL ||
          !callbackKoku.startsWith("https://") ||
          /localhost|127\.0\.0\.1|:\d+(?:\/|$)/i.test(callbackKoku)
        )
          throw new BadRequestException("PayTR için portsuz, herkese açık HTTPS PUBLIC_API_URL tanımlanmalıdır");
        const sonuc = await new PaytrAdapter().linkOlustur(this.paytrConfig(kaynak.baglanti.sifreliConfig), {
          ad: girdi.faturaId ? "Fatura tahsilati" : "Cari hesap tahsilati",
          tutarKurus: Number(tutar.mul(100).toFixed(0)),
          dovizCinsi: kaynak.dovizCinsi,
          eposta: cari.eposta,
          callbackUrl: `${callbackKoku}/api/v1/pos/paytr/callback/${tenantId}/${kayit.id}`,
          callbackId: kayit.id.replace(/-/g, ""),
          azamiTaksit: posAzamiTaksit(taksitTablosu(kaynak.taksitOranlari)),
        });
        const tamamlanan = await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.id, odemeSayfasiUrl: sonuc.link } }),
        );
        await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.link, girdi.faturaId).catch(() => undefined);
        if (cari.telefon)
          await this.odemeLinkiSmsGonder(tenantId, tamamlanan.id, cari.telefon, cari.unvan, sonuc.link, girdi.faturaId).catch(
            () => undefined,
          );
        return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUniqueOrThrow({ where: { id: tamamlanan.id } }));
      }
      const sonuc = await new IyzicoAdapter().odemeBaslat(this.config(kaynak.baglanti.sifreliConfig), {
        locale: "tr",
        conversationId: kayit.id,
        price: Number(tutar),
        paidPrice: Number(tutar),
        currency: kaynak.dovizCinsi,
        basketId: girdi.faturaId ?? kayit.id,
        paymentGroup: "PRODUCT",
        // KSB-35: yalnız komisyonu tanımlı taksitler açılır; tablo boşsa tek çekim.
        enabledInstallments: kaynak.dovizCinsi === "TRY" ? posAcikTaksitler(taksitTablosu(kaynak.taksitOranlari)) : [1],
        callbackUrl: `${callbackKoku}/api/v1/pos/iyzico/callback/${tenantId}/${kayit.id}`,
        buyer: {
          id: cari.id,
          name: ad,
          surname: soyad,
          identityNumber: cari.vknTckn ?? "11111111111",
          email: cari.eposta,
          gsmNumber: iyzicoTelefonuDuzenle(cari.telefon),
          registrationAddress: adres.adres,
          city: adres.il ?? "İstanbul",
          country: adres.ulke ?? "Türkiye",
          zipCode: adres.postaKodu ?? undefined,
        },
        billingAddress: {
          contactName: cari.unvan,
          address: adres.adres,
          city: adres.il ?? "İstanbul",
          country: adres.ulke ?? "Türkiye",
          zipCode: adres.postaKodu ?? undefined,
        },
        basketItems: [
          {
            id: girdi.faturaId ?? kayit.id,
            name: girdi.faturaId ? "Fatura tahsilatı" : "Cari hesap tahsilatı",
            category1: "Tahsilat",
            itemType: "VIRTUAL",
            price: Number(tutar),
          },
        ],
      });
      const tamamlanan = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.update({ where: { id: kayit.id }, data: { saglayiciToken: sonuc.token, odemeSayfasiUrl: sonuc.odemeSayfasiUrl } }),
      );
      await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(
        () => undefined,
      );
      if (cari.telefon)
        await this.odemeLinkiSmsGonder(tenantId, tamamlanan.id, cari.telefon, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(
          () => undefined,
        );
      return this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUniqueOrThrow({ where: { id: tamamlanan.id } }));
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "Ödeme başlatılamadı";
      const saglayiciHatasi = !(hata instanceof HttpException);
      const yapilandirmaHatasi = /api bilgileri|api key|unauthor|kimlik|credential|merchant|şifre|parola/i.test(mesaj);
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.posTahsilat.update({ where: { id: kayit.id }, data: { durum: "basarisiz", hataMesaji: mesaj } });
        if (saglayiciHatasi && yapilandirmaHatasi)
          await tx.baglanti.update({ where: { id: kaynak.baglanti!.id }, data: { durum: "hata", sonSenkronHatasi: mesaj } });
      });
      if (hata instanceof HttpException) throw hata;
      throw new BadGatewayException(
        `${kaynak.saglayici} ödeme bağlantısı oluşturulamadı: ${mesaj}. POS bağlantı bilgilerini ve seçilen ortamı kontrol edin.`,
      );
    }
  }

  async paytrCallback(tenantId: string, tahsilatId: string, girdi: PaytrCallback) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }),
    );
    if (
      !kayit?.posHesap.baglanti ||
      kayit.posHesap.saglayici !== "paytr" ||
      girdi.callback_id !== tahsilatId.replace(/-/g, "") ||
      girdi.status !== "success"
    )
      throw new BadRequestException("Geçersiz PayTR bildirimi");
    const config = this.paytrConfig(kayit.posHesap.baglanti.sifreliConfig);
    if (girdi.merchant_id !== config.merchantId || !new PaytrAdapter().callbackDogrula(config, girdi))
      throw new BadRequestException("PayTR bildirim imzası geçersiz");
    const doviz = girdi.currency === "TL" ? "TRY" : girdi.currency;
    if (doviz !== kayit.dovizCinsi || !new Prisma.Decimal(girdi.payment_amount).div(100).equals(kayit.tutar))
      throw new BadRequestException("PayTR ödeme tutarı veya dövizi uyuşmuyor");
    // KSB-36: total_amount müşterinin ödediğidir (vade farkı dahil); taksit gelmezse tek çekim.
    await this.odemeyiKaydet(tenantId, kayit, girdi.merchant_oid, "PayTR kart tahsilatı", {
      taksit: Number(girdi.installment_count) || 1,
      odenen: girdi.total_amount ? new Prisma.Decimal(girdi.total_amount).div(100) : undefined,
    });
    return "OK";
  }

  private async odemeyiKaydet(tenantId: string, kayit: any, odemeId: string, aciklama: string, ayrinti: OdemeAyrintisi = {}) {
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true, makbuzAnahtari: kayit.makbuzAnahtari };
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => this.odenmisSay(tx, tenantId, kayit, odemeId, aciklama, ayrinti));
    if (sonuc.gecOdeme) await this.gecOdemeyiBildir(tenantId, kayit);
    return sonuc;
  }

  /**
   * Sağlayıcının doğruladığı ödemeyi kaydeder. Bağlantı bu arada süresi
   * dolmuş ya da iptal edilmiş olsa bile para sağlayıcıda çekildiği için
   * tahsilat yazılır ve "geç ödeme" olarak işaretlenir (P1-6).
   */
  private async odenmisSay(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kayit: {
      id: string;
      durum: string;
      makbuzAnahtari: string;
      posHesapId: string;
      tutar: Prisma.Decimal;
      dovizCinsi: any;
      cariId: string;
      faturaId: string | null;
    },
    odemeId: string,
    aciklama: string,
    ayrinti: OdemeAyrintisi = {},
  ) {
    const simdi = new Date();
    const gecOdeme = kayit.durum !== "baslatildi";
    // KSB-36: komisyon ödeme anındaki taksit tablosundan tahmin edilir ve tahsilatta saklanır.
    const hesap = await tx.posHesap.findUnique({ where: { id: kayit.posHesapId }, select: { komisyonOrani: true, islemUcreti: true, taksitOranlari: true } });
    const komisyon = {
      ...(hesap ? tahminiKomisyonAlanlari(kayit.tutar, hesap, ayrinti.taksit, ayrinti.odenen) : {}),
      // KSB-37: sağlayıcı kesintiyi bildirdiyse tahminin yerine geçer.
      ...(ayrinti.kesinti ? saglayiciKesintiAlanlari(kayit.tutar, ayrinti.kesinti) : {}),
    };
    const hak = await tx.posTahsilat.updateMany({
      where: { id: kayit.id, durum: { in: [...ODENEBILIR_DURUMLAR] }, hareketId: null },
      data: { durum: "odendi", saglayiciOdemeId: odemeId, odemeTarihi: simdi, hataMesaji: null, gecOdeme, ...komisyon },
    });
    if (hak.count !== 1) return { basarili: true, tekrar: true, gecOdeme: false, makbuzAnahtari: kayit.makbuzAnahtari };
    await this.tahsilatiYaz(tx, tenantId, kayit, simdi, aciklama);
    return { basarili: true, tekrar: false, gecOdeme, makbuzAnahtari: kayit.makbuzAnahtari };
  }

  /** POS tahsilatının kasa/banka hareketini ve cari alacağını yazar (bağlantı ödemesi ve slip ortak). */
  private async tahsilatiYaz(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kayit: { id: string; posHesapId: string; tutar: Prisma.Decimal; dovizCinsi: any; cariId: string; faturaId: string | null },
    tarih: Date,
    aciklama: string,
  ) {
    const kur = kayit.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : await kurZorunlu(tx, kayit.dovizCinsi, tarih, "alis", tenantId);
    const tutarTry = kayit.tutar.mul(kur).toDecimalPlaces(2);
    const hareket = await tx.kasaBankaHareket.create({
      data: {
        tenantId,
        posHesapId: kayit.posHesapId,
        tip: "tahsilat",
        tutar: kayit.tutar,
        dovizCinsi: kayit.dovizCinsi,
        kur,
        tutarTry,
        tarih,
        cariId: kayit.cariId,
        faturaId: kayit.faturaId,
        ...(await posFaturaKapamasi(tx, kayit.faturaId, kayit.tutar)),
        aciklama,
        kaynakTur: "pos_tahsilat",
        kaynakRef: kayit.id,
      },
    });
    await tx.cariHareket.create({
      data: {
        tenantId,
        cariId: kayit.cariId,
        tip: "alacak",
        tutar: kayit.tutar,
        dovizCinsi: kayit.dovizCinsi,
        kur,
        tutarTry,
        tarih,
        aciklama,
        kaynakTur: "pos_tahsilat",
        kaynakRef: kayit.id,
      },
    });
    await tx.posTahsilat.update({ where: { id: kayit.id }, data: { hareketId: hareket.id } });
    // KSB-16: faturaya düşen kısım elle kapama; artanı carinin diğer açıklarına vadeyle dağılır.
    if (kayit.faturaId && hareket.faturaMahsubu) await elleKapamaYaz(tx, { tenantId, cariId: kayit.cariId, faturaId: kayit.faturaId, tutar: hareket.faturaMahsubu, kaynak: { kasaBankaHareketId: hareket.id } });
    await cariDenklestir(tx, tenantId, kayit.cariId);
    return hareket;
  }

  private async gecOdemeyiBildir(tenantId: string, kayit: { id: string; tutar: Prisma.Decimal; dovizCinsi: string; durum: string }) {
    try {
      await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () =>
        this.bildirimler.uret({
          tur: "entegrasyon",
          onem: "uyari",
          baslik: "Süresi dolmuş/iptal edilmiş ödeme bağlantısından tahsilat geldi",
          aciklama: `${kayit.durum === "iptal" ? "İptal edilmiş" : "Süresi dolmuş"} bir ödeme bağlantısı müşteri tarafından ödendi; ${kayit.tutar.toFixed(2)} ${kayit.dovizCinsi} tahsilat kaydedildi. Aynı borç için başka bir ödeme alındıysa fazla tahsilatı iade edin.`,
          birlesimAnahtari: `pos-gec-odeme:${kayit.id}`,
          kaynakTur: "pos_tahsilat",
          kaynakRef: kayit.id,
          hedefYol: "/panel/kasa-banka/pos",
          roller: ["yonetici", "muhasebe"],
        }),
      );
    } catch (hata) {
      this.logger.warn(`Geç ödeme bildirimi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
  }

  /** KSB-37: iyzico ödemeyi dolandırıcılık incelemesine aldı; para inceleme sonuçlanana kadar aktarılmayabilir. */
  private async fraudIncelemesiniBildir(tenantId: string, kayit: { id: string; tutar: Prisma.Decimal; dovizCinsi: string }) {
    try {
      await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () =>
        this.bildirimler.uret({
          tur: "entegrasyon",
          onem: "uyari",
          baslik: "iyzico ödemeyi incelemeye aldı",
          aciklama: `${kayit.tutar.toFixed(2)} ${kayit.dovizCinsi} tutarlı kart tahsilatı iyzico dolandırıcılık incelemesinde. Tahsilat kaydedildi; inceleme reddedilirse iyzico ödemeyi iptal eder, o durumda tahsilatı iade olarak kaydedin. Mal/hizmet teslimini inceleme sonuçlanana kadar bekletmeniz önerilir.`,
          birlesimAnahtari: `pos-fraud-inceleme:${kayit.id}`,
          kaynakTur: "pos_tahsilat",
          kaynakRef: kayit.id,
          hedefYol: "/panel/kasa-banka/pos",
          roller: ["yonetici", "muhasebe"],
        }),
      );
    } catch (hata) {
      this.logger.warn(`Fraud inceleme bildirimi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
  }

  // ─── İPTAL, SLİP, İADE, AKTARIM PLANI (P1-6) ─────────────────────────────

  /** Açık ödeme bağlantısını iptal eder; müşteri yine öderse tahsilat geç ödeme olarak kaydedilir. */
  async iptal(id: string, neden: string) {
    const { tenantId } = aktifBaglam();
    const hak = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.updateMany({ where: { id, durum: "baslatildi" }, data: { durum: "iptal", iptalNedeni: neden } }),
    );
    if (hak.count !== 1) throw new BadRequestException("Yalnız ödeme bekleyen bağlantı iptal edilebilir");
    return { iptal: true };
  }

  /** Süresi dolan açık bağlantıları kapatır; worker saatlik çağırır, liste de çağırır. */
  async suresiDolanlariKapat(tenantId: string) {
    return this.prisma.tenantIslem(
      tenantId,
      async (tx) =>
        (
          await tx.posTahsilat.updateMany({
            where: { durum: "baslatildi", sonKullanimTarihi: { lt: new Date() } },
            data: { durum: "suresi_doldu" },
          })
        ).count,
    );
  }

  /** Banka POS'unda çekilen slibi tahsilat olarak kaydeder. */
  async slipGir(girdi: {
    posHesapId: string;
    cariId: string;
    faturaId?: string | null;
    tutar: string;
    tarih: string;
    slipNo?: string | null;
    aciklama?: string | null;
    taksitSayisi?: number;
  }) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "POS slip tahsilatı");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const pos = await tx.posHesap.findUnique({ where: { id: girdi.posHesapId } });
      if (!pos || !pos.aktif || pos.saglayici !== "banka") throw new BadRequestException("Aktif banka POS'u bulunamadı");
      const cari = await tx.cariHesap.findFirst({ where: { id: girdi.cariId, aktif: true } });
      if (!cari) throw new BadRequestException("Aktif cari hesap bulunamadı");
      if (girdi.faturaId) {
        const f = await tx.fatura.findFirst({ where: { id: girdi.faturaId, cariId: cari.id } });
        if (!f || f.durum !== "kesin" || !["satis", "alis_iade"].includes(f.tip))
          throw new BadRequestException("Yalnızca carinin kesinleşmiş satış faturası tahsil edilebilir");
        if (f.dovizCinsi !== pos.dovizCinsi) throw new BadRequestException("Fatura ve POS hesabı para birimleri aynı olmalıdır");
      }
      const tarih = new Date(girdi.tarih);
      const kayit = await tx.posTahsilat.create({
        data: {
          tenantId,
          posHesapId: pos.id,
          cariId: cari.id,
          faturaId: girdi.faturaId || null,
          tutar: new Prisma.Decimal(girdi.tutar),
          dovizCinsi: pos.dovizCinsi,
          durum: "odendi",
          kanal: "slip",
          ...tahminiKomisyonAlanlari(new Prisma.Decimal(girdi.tutar), pos, pos.dovizCinsi === "TRY" ? girdi.taksitSayisi : 1),
          slipNo: girdi.slipNo || null,
          odemeTarihi: tarih,
          makbuzAnahtari: randomBytes(32).toString("hex"),
        },
      });
      await this.tahsilatiYaz(
        tx,
        tenantId,
        kayit,
        tarih,
        girdi.aciklama?.trim() || `${pos.ad} kart tahsilatı${girdi.slipNo ? ` (slip ${girdi.slipNo})` : ""}`,
      );
      return tx.posTahsilat.findUniqueOrThrow({ where: { id: kayit.id } });
    });
  }

  /** Yanlış girilmiş slibi geri alır (açık dönemde; iadesi olan slip geri alınmaz). */
  async slipGeriAl(id: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.posTahsilat.findUnique({ where: { id }, include: { hareket: true, _count: { select: { iadeler: true } } } });
      if (!kayit || kayit.kanal !== "slip" || kayit.durum !== "odendi" || !kayit.hareket)
        throw new BadRequestException("Yalnız kaydedilmiş banka POS slibi geri alınabilir");
      if (kayit._count.iadeler) throw new BadRequestException("İadesi olan slip geri alınamaz; önce iadeleri geri alın");
      await this.donemKilidi.tarihDogrula(tenantId, kayit.hareket.tarih, "slip geri alma", tx);
      const cariler = await tx.cariHareket.findMany({ where: { kaynakTur: "pos_tahsilat", kaynakRef: id } });
      await tx.posTahsilat.update({ where: { id }, data: { durum: "iptal", iptalNedeni: neden, hareketId: null } });
      await tx.cariHareket.deleteMany({ where: { id: { in: cariler.map((c) => c.id) } } });
      await tx.kasaBankaHareket.delete({ where: { id: kayit.hareket.id } });
      await cariDenklestir(tx, tenantId, kayit.cariId);
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          islem: "pos_slip_geri_alindi",
          varlik: "pos",
          varlikId: id,
          detay: JSON.parse(JSON.stringify({ neden, hareket: kayit.hareket, cariHareketleri: cariler })),
        },
      });
      return { geriAlindi: true };
    });
  }

  /**
   * Ödenmiş tahsilatın tam/kısmi iadesi: POS hesabından tediye, cariye borç;
   * faturaya mahsup edilmiş kısım geri açılır. İade sağlayıcı/banka
   * panelinden ayrıca yapılır.
   */
  async iade(id: string, girdi: { tutar: string; tarih: string; neden: string }) {
    const { tenantId, userId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "POS iadesi");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM pos_tahsilatlari WHERE id = ${id}::uuid FOR UPDATE`;
      const kayit = await tx.posTahsilat.findUnique({
        where: { id },
        include: { hareket: true, posHesap: true, iadeler: { include: { hareket: true } } },
      });
      if (!kayit || kayit.durum !== "odendi" || !kayit.hareket)
        throw new BadRequestException("Yalnız ödenmiş POS tahsilatı iade edilebilir");
      const tutar = new Prisma.Decimal(girdi.tutar);
      const iadeEdilen = kayit.iadeler.reduce((t, i) => t.add(i.tutar), new Prisma.Decimal(0));
      const kalan = kayit.tutar.sub(iadeEdilen);
      if (tutar.gt(kalan))
        throw new BadRequestException(`İade tutarı iade edilebilir kalanı (${kalan.toFixed(2)} ${kayit.dovizCinsi}) aşıyor`);
      const tarih = new Date(girdi.tarih);
      // Faturaya mahsup edilmiş kısım (önceki iadelerin geri açtığı düşülerek) kadar mahsup geri açılır.
      const mahsupKalan = (kayit.hareket.faturaMahsubu ?? new Prisma.Decimal(0)).add(
        kayit.iadeler.reduce((t, i) => t.add(i.hareket.faturaMahsubu ?? 0), new Prisma.Decimal(0)),
      );
      const geriAcilan = Prisma.Decimal.min(tutar, Prisma.Decimal.max(mahsupKalan, 0));
      const kur = kayit.dovizCinsi === "TRY" ? new Prisma.Decimal(1) : await kurZorunlu(tx, kayit.dovizCinsi, tarih, "satis", tenantId);
      const tutarTry = tutar.mul(kur).toDecimalPlaces(2);
      const aciklama = `${kayit.posHesap.ad} kart iadesi — ${girdi.neden}`.slice(0, 500);
      const hareket = await tx.kasaBankaHareket.create({
        data: {
          tenantId,
          posHesapId: kayit.posHesapId,
          tip: "tediye",
          tutar,
          dovizCinsi: kayit.dovizCinsi,
          kur,
          tutarTry,
          tarih,
          cariId: kayit.cariId,
          faturaId: kayit.faturaId,
          ...(kayit.faturaId ? { faturaKarsiligi: tutar.negated(), faturaMahsubu: geriAcilan.negated() } : {}),
          aciklama,
          kaynakTur: "pos_iade",
          kaynakRef: kayit.id,
        },
      });
      await tx.cariHareket.create({
        data: {
          tenantId,
          cariId: kayit.cariId,
          tip: "borc",
          tutar,
          dovizCinsi: kayit.dovizCinsi,
          kur,
          tutarTry,
          tarih,
          aciklama,
          kaynakTur: "pos_iade",
          kaynakRef: hareket.id,
        },
      });
      const iade = await tx.posIade.create({
        data: { tenantId, posTahsilatId: kayit.id, tutar, tarih, neden: girdi.neden, hareketId: hareket.id, userId },
      });
      await this.kapamayiIadeyleEsitle(tx, tenantId, kayit.id);
      return iade;
    });
  }

  async iadeGeriAl(iadeId: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const iade = await tx.posIade.findUnique({ where: { id: iadeId }, include: { hareket: true } });
      if (!iade) throw new NotFoundException("POS iadesi bulunamadı");
      await this.donemKilidi.tarihDogrula(tenantId, iade.tarih, "POS iadesini geri alma", tx);
      if (iade.hareket.ekstreSatirId) throw new BadRequestException("İade banka ekstresine bağlı; önce ekstre eşleşmesini geri alın");
      const cariler = await tx.cariHareket.findMany({ where: { kaynakTur: "pos_iade", kaynakRef: iade.hareketId } });
      await tx.posIade.delete({ where: { id: iadeId } });
      await tx.cariHareket.deleteMany({ where: { id: { in: cariler.map((c) => c.id) } } });
      await tx.kasaBankaHareket.delete({ where: { id: iade.hareketId } });
      await this.kapamayiIadeyleEsitle(tx, tenantId, iade.posTahsilatId);
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          islem: "pos_iadesi_geri_alindi",
          varlik: "pos",
          varlikId: iade.posTahsilatId,
          detay: JSON.parse(JSON.stringify({ neden, iade, cariHareketleri: cariler })),
        },
      });
      return { geriAlindi: true };
    });
  }

  /**
   * KSB-16: iade ödemenin faturaya düşen kısmını geri açar; elle kapama
   * tahsilatın mahsubu eksi iadelerin geri açtığı kadar olur. İadenin
   * carideki etkisi (borç) denkleştirmede tahsilattan düşülür.
   */
  private async kapamayiIadeyleEsitle(tx: Prisma.TransactionClient, tenantId: string, tahsilatId: string) {
    const kayit = await tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { hareket: true, iadeler: { include: { hareket: true } } } });
    if (!kayit?.hareket) return;
    if (kayit.faturaId) {
      const net = kayit.iadeler.reduce((t, i) => t.add(i.hareket.faturaMahsubu ?? 0), kayit.hareket.faturaMahsubu ?? new Prisma.Decimal(0));
      await elleKapamaYaz(tx, { tenantId, cariId: kayit.cariId, faturaId: kayit.faturaId, tutar: net, kaynak: { kasaBankaHareketId: kayit.hareket.id } });
    }
    await cariDenklestir(tx, tenantId, kayit.cariId);
  }

  /** Her aktif POS hesabı için bankaya geçecek tutarlar, valör tarihine göre. */
  async bankayaGececekler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesaplar = await tx.posHesap.findMany({
        where: { aktif: true },
        orderBy: { ad: "asc" },
        include: { varsayilanBankaHesap: { select: { id: true, ad: true } } },
      });
      const bakiyeler = await tx.kasaBankaHareket.groupBy({
        by: ["posHesapId", "tip"],
        where: { posHesapId: { in: hesaplar.map((h) => h.id) } },
        _sum: { tutar: true },
      });
      const tahsilatlar = await tx.posTahsilat.findMany({
        where: { posHesapId: { in: hesaplar.map((h) => h.id) }, durum: "odendi", odemeTarihi: { not: null } },
        orderBy: { odemeTarihi: "desc" },
        take: 2000,
        select: { id: true, posHesapId: true, odemeTarihi: true, tutar: true, komisyonTutari: true, iadeler: { select: { tutar: true } } },
      });
      const bugun = bugunTR();
      return hesaplar.map((h) => {
        const bakiye = bakiyeler
          .filter((g) => g.posHesapId === h.id)
          .reduce(
            (t, g) => (g.tip === "tahsilat" || g.tip === "virman_gelis" ? t.add(g._sum.tutar ?? 0) : t.sub(g._sum.tutar ?? 0)),
            new Prisma.Decimal(0),
          );
        const plan = aktarimPlani(
          bakiye,
          tahsilatlar
            .filter((t) => t.posHesapId === h.id)
            .map((t) => ({ id: t.id, odemeTarihi: t.odemeTarihi!, net: t.iadeler.reduce((k, i) => k.sub(i.tutar), t.tutar), komisyon: t.komisyonTutari })),
          h,
          bugun,
        );
        return {
          posHesap: {
            id: h.id,
            ad: h.ad,
            saglayici: h.saglayici,
            dovizCinsi: h.dovizCinsi,
            valorGun: h.valorGun,
            komisyonOrani: h.komisyonOrani.toFixed(2),
            varsayilanBankaHesap: h.varsayilanBankaHesap,
          },
          bakiye: bakiye.toFixed(2),
          ...plan,
        };
      });
    });
  }

  async epostaYenidenGonder(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findUnique({ where: { id }, include: { cari: { select: { eposta: true, unvan: true } } } }),
    );
    if (!kayit?.odemeSayfasiUrl || !kayit.cari.eposta || kayit.durum !== "baslatildi")
      throw new BadRequestException("Gönderilebilir ödeme bağlantısı veya cari e-postası bulunamadı");
    await this.odemeLinkiEpostala(tenantId, kayit.id, kayit.cari.eposta, kayit.cari.unvan, kayit.odemeSayfasiUrl, kayit.faturaId);
    return { basarili: true };
  }

  async smsYenidenGonder(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findUnique({ where: { id }, include: { cari: { select: { telefon: true, unvan: true } } } }),
    );
    if (!kayit?.odemeSayfasiUrl || !kayit.cari.telefon || kayit.durum !== "baslatildi")
      throw new BadRequestException("Gönderilebilir ödeme bağlantısı veya cari telefonu bulunamadı");
    await this.odemeLinkiSmsGonder(tenantId, kayit.id, kayit.cari.telefon, kayit.cari.unvan, kayit.odemeSayfasiUrl, kayit.faturaId);
    return { basarili: true };
  }

  async yenidenDene(id: string) {
    const { tenantId } = aktifBaglam();
    const eski = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id } }));
    if (!eski || !["basarisiz", "suresi_doldu"].includes(eski.durum))
      throw new BadRequestException("Yalnız başarısız veya süresi dolmuş talep yeniden denenebilir");
    return this.baslat({
      posHesapId: eski.posHesapId,
      cariId: eski.cariId,
      faturaId: eski.faturaId ?? undefined,
      tutar: eski.tutar.toFixed(2),
    });
  }

  private async odemeLinkiEpostala(tenantId: string, id: string, alici: string, unvan: string, link: string, faturaId?: string | null) {
    try {
      await this.eposta.iletiGonder({
        alici,
        konu: `TekirExtra — ${faturaId ? "fatura" : "cari hesap"} ödeme bağlantısı`,
        metin: `Merhaba ${unvan},\n\nGüvenli kart ödeme bağlantınız:\n${link}\n\nKart bilgileriniz TekirExtra tarafından görüntülenmez veya saklanmaz.`,
      });
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.update({ where: { id }, data: { epostaGonderimTarihi: new Date(), epostaHatasi: null } }),
      );
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "E-posta gönderilemedi";
      await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { epostaHatasi: mesaj } }));
      throw hata;
    }
  }

  private async odemeLinkiSmsGonder(tenantId: string, id: string, telefon: string, unvan: string, link: string, faturaId?: string | null) {
    try {
      const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.baglanti.findFirst({ where: { aile: "sms", saglayici: "netgsm", durum: "aktif" }, orderBy: { updatedAt: "desc" } }),
      );
      if (!baglanti) throw new Error("Aktif Netgsm SMS bağlantısı bulunamadı");
      const mesaj = `Sayin ${unvan}, ${faturaId ? "fatura" : "cari hesap"} odeme baglantiniz: ${link}`;
      const sonuc = await new NetgsmAdapter().smsGonder(this.netgsmConfig(baglanti.sifreliConfig), telefon, mesaj);
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.update({ where: { id }, data: { smsGonderimTarihi: new Date(), smsGorevId: sonuc.gorevId, smsHatasi: null } }),
      );
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "SMS gönderilemedi";
      await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { smsHatasi: mesaj } }));
      throw hata;
    }
  }

  async makbuzPdf(tenantId: string, tahsilatId: string, anahtar: string) {
    const [tahsilat, firma] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.posTahsilat.findFirst({
          where: { id: tahsilatId, makbuzAnahtari: anahtar, durum: "odendi", hareketId: { not: null } },
          include: {
            hareket: { include: { posHesap: true, cari: { select: { kod: true, unvan: true, belgeDili: true, belgeCiftDil: true } }, fatura: { select: { no: true } } } },
          },
        }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true } }),
      ]),
    );
    if (!tahsilat?.hareket || !firma) throw new NotFoundException("Tahsilat makbuzu bulunamadı");
    // Açık (oturumsuz) bağlantı: kiracı ayarı okunmaz, varsayılan görünümle basılır.
    const { html, altBilgi } = makbuzPdfHtml(tahsilat.hareket, { firma });
    const buffer = await this.pdf.htmlToPdf(html, { altBilgi });
    return { buffer, dosyaAdi: `tahsilat-makbuzu-${tahsilat.id.slice(0, 8)}.pdf` };
  }

  async callback(tenantId: string, tahsilatId: string, token: string) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }),
    );
    if (!kayit || !kayit.saglayiciToken || kayit.saglayiciToken !== token) throw new BadRequestException("Geçersiz ödeme callback tokenı");
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true, makbuzAnahtari: kayit.makbuzAnahtari };
    const sonuc = await new IyzicoAdapter().odemeSonucu(this.config(kayit.posHesap.baglanti!.sifreliConfig), token);
    // KSB-36: vade farkı müşteriye yansıtılmışsa ödenen sepet tutarından büyüktür; sepet tutarı tahsilata eşit olmalı.
    if (!sonuc.basarili || !this.iyzicoUyusur(kayit, sonuc)) {
      // Süresi dolmuş/iptal talebin durumu korunur; yalnız açık talep başarısız sayılır.
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.updateMany({
          where: { id: kayit.id, durum: "baslatildi" },
          data: { durum: "basarisiz", hataMesaji: "Sağlayıcı ödeme doğrulaması başarısız" },
        }),
      );
      throw new BadRequestException("Ödeme doğrulanamadı");
    }
    return this.iyzicoOdemesiniKaydet(tenantId, kayit, sonuc);
  }

  /** iyzico'nun doğruladığı ödemeyi yazar (callback ve KSB-38 sorgusu ortak). */
  private async iyzicoOdemesiniKaydet(
    tenantId: string,
    kayit: Parameters<PosService["odenmisSay"]>[2] & { dovizCinsi: string },
    sonuc: Awaited<ReturnType<IyzicoAdapter["odemeSonucu"]>>,
  ) {
    const kayitSonucu = await this.prisma.tenantIslem(tenantId, (tx) =>
      this.odenmisSay(tx, tenantId, kayit, sonuc.odemeId ?? "", "iyzico kart tahsilatı", { taksit: sonuc.taksit, odenen: new Prisma.Decimal(sonuc.odenen), kesinti: sonuc.kesinti }),
    );
    if (kayitSonucu.gecOdeme) await this.gecOdemeyiBildir(tenantId, kayit);
    if (!kayitSonucu.tekrar && sonuc.kesinti?.fraudDurumu === 0) await this.fraudIncelemesiniBildir(tenantId, kayit);
    return kayitSonucu;
  }

  /** iyzico yanıtı tahsilatla uyuşuyor mu: sepet tutarı eşit, ödenen ondan küçük değil, döviz aynı (KSB-36). */
  private iyzicoUyusur(kayit: { tutar: Prisma.Decimal; dovizCinsi: string }, sonuc: Awaited<ReturnType<IyzicoAdapter["odemeSonucu"]>>) {
    const fiyat = new Prisma.Decimal(sonuc.fiyat);
    return fiyat.equals(kayit.tutar) && !new Prisma.Decimal(sonuc.odenen).lt(fiyat) && sonuc.dovizCinsi === kayit.dovizCinsi;
  }

  /** KSB-38: kullanıcının "Sağlayıcıdan sorgula" düğmesi. */
  async saglayicidanSorgula(id: string) {
    const { tenantId } = aktifBaglam();
    return this.sorgula(tenantId, id);
  }

  /**
   * KSB-38: bildirimi gelmemiş iyzico talebini sağlayıcıdan sorgular. Ödenmemiş
   * çıkarsa talebin durumu değişmez (müşteri hâlâ ödeyebilir); ödenmişse callback
   * ile aynı akış işler (tekrar koruması ve geç ödeme kuralı dahil).
   */
  private async sorgula(tenantId: string, id: string): Promise<{ odendi: boolean; mesaj: string }> {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findUnique({ where: { id }, include: { posHesap: { include: { baglanti: true } } } }),
    );
    if (!kayit) throw new NotFoundException("POS tahsilatı bulunamadı");
    if (kayit.posHesap.saglayici === "paytr")
      throw new BadRequestException("PayTR ödemeleri sorgulanamaz: Link API ödeme öncesinde sorgulanabilir bir sipariş numarası vermez, ödeme PayTR bildirimiyle kaydedilir");
    if (kayit.durum === "odendi") return { odendi: true, mesaj: "Tahsilat zaten ödendi olarak kayıtlı" };
    if (kayit.posHesap.saglayici !== "iyzico" || !(ODENEBILIR_DURUMLAR as readonly string[]).includes(kayit.durum) || !kayit.saglayiciToken || !kayit.posHesap.baglanti)
      throw new BadRequestException("Bu talep sağlayıcıdan sorgulanamaz");
    await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { saglayiciSorguTarihi: new Date() } }));
    let sonuc: Awaited<ReturnType<IyzicoAdapter["odemeSonucu"]>>;
    try {
      sonuc = await new IyzicoAdapter().odemeSonucu(this.config(kayit.posHesap.baglanti.sifreliConfig), kayit.saglayiciToken);
    } catch (hata) {
      return { odendi: false, mesaj: `iyzico'da tamamlanmış ödeme bulunamadı (${hata instanceof Error ? hata.message : String(hata)})` };
    }
    if (!sonuc.basarili) return { odendi: false, mesaj: "iyzico'da tamamlanmış ödeme yok; müşteri henüz ödememiş" };
    if (!this.iyzicoUyusur(kayit, sonuc)) {
      this.logger.warn(`iyzico sorgusu tahsilatla uyuşmadı: ${id}`);
      return { odendi: false, mesaj: "iyzico ödemesi tahsilat tutarı ya da dövizi ile uyuşmuyor; iyzico panelinden kontrol edin" };
    }
    const s = await this.iyzicoOdemesiniKaydet(tenantId, kayit, sonuc);
    return { odendi: true, mesaj: s.tekrar ? "Tahsilat zaten ödendi olarak kayıtlı" : "iyzico'da ödeme bulundu, tahsilat kaydedildi" };
  }

  /**
   * KSB-38 (worker): son 8 günde açılmış, bildirimi gelmemiş iyzico taleplerini
   * tek tek ve sınırlı sayıda sorgular. Yeni açılmış talep (10 dk) callback'i
   * bekler; aynı talep 30 dakikadan sık sorgulanmaz, en eski sorgulanan öne alınır.
   */
  async bekleyenleriSorgula(tenantId: string, sinir = 20): Promise<number> {
    const simdi = Date.now();
    const adaylar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findMany({
        where: {
          durum: { in: [...ODENEBILIR_DURUMLAR] },
          hareketId: null,
          saglayiciToken: { not: null },
          createdAt: { gte: new Date(simdi - 8 * 24 * 60 * 60 * 1000), lt: new Date(simdi - 10 * 60 * 1000) },
          posHesap: { saglayici: "iyzico", baglanti: { durum: "aktif" } },
          OR: [{ saglayiciSorguTarihi: null }, { saglayiciSorguTarihi: { lt: new Date(simdi - 30 * 60 * 1000) } }],
        },
        orderBy: [{ saglayiciSorguTarihi: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
        take: sinir,
        select: { id: true },
      }),
    );
    let odenen = 0;
    for (const a of adaylar) {
      try {
        if ((await this.sorgula(tenantId, a.id)).odendi) odenen++;
      } catch (hata) {
        this.logger.warn(`iyzico durum sorgusu başarısız (${a.id}): ${hata instanceof Error ? hata.message : String(hata)}`);
      }
    }
    return odenen;
  }
}
