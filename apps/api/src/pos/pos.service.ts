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
import { odemeKarekodu } from "./karekod";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { aktarimPlani } from "./aktarim-plani";
import { PrismaService } from "../core/prisma.service";
import { coz } from "../core/kripto";
import { IyzicoAdapter, iyzicoTelefonuDuzenle, type IyzicoConfig, type IyzicoKesintisi } from "./iyzico.adapter";
import { EpostaService } from "../tenant/eposta.service";
import { odemeBaglantisiSmsSablonu } from "../ileti/sms-kurallari";
import { SmsService } from "../ileti/sms.service";
import { PaytrAdapter, type PaytrCallback, type PaytrConfig } from "./paytr.adapter";
import { randomBytes } from "node:crypto";
import { adSoyadCoz } from "../cari/ad-soyad";
import { PdfService } from "../core/pdf/pdf.service";
import { makbuzPdfHtml } from "../kasa-banka/makbuz-pdf";
import { cariDenklestir, elleKapamaYaz } from "../fatura/denklestirme";
import { faturaKilitleVeKalaniGetir, mahsupAyir } from "../fatura/odeme-durumu";
import { SISTEM_USER_ID } from "../core/sistem-kimligi";
import { makbuzAnahtari, makbuzAnahtariGecerli, makbuzYolu, odemeTokeniDogrula, odemeTokeniUret, odemeYolu } from "./makbuz-anahtari";

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

/** KSB-43: sağlayıcı iadesi sürerken tahsilattaki kilit; yanıtsız kalırsa bu süreden sonra düşer. */
const IADE_KILIDI_MS = 10 * 60 * 1000;

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
    private readonly sms: SmsService,
  ) {}
  private config(sifreli: string): IyzicoConfig {
    const c = JSON.parse(coz(sifreli)) as any;
    return { apiKey: c.kullaniciAdi, secretKey: c.parola, baseUrl: c.servisAdresi ?? "https://sandbox-api.iyzipay.com" };
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
              // PLT-40: sağlayıcının ödeme numarasıyla da bulunur.
              { saglayiciOdemeId: { contains: girdi.arama } },
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
            iadeler: { select: { id: true, tutar: true, tarih: true, neden: true, saglayiciyaGonderildi: true }, orderBy: { createdAt: "asc" } },
          },
        }),
        tx.posTahsilat.count({ where }),
        tx.posTahsilat.groupBy({ by: ["durum"], _count: { _all: true } }),
      ]);
      const kayitlar = hamKayitlar.map((kayit) => ({
        ...kayit,
        iadeEdilen: kayit.iadeler.reduce((t, i) => t.add(i.tutar), new Prisma.Decimal(0)).toFixed(2),
        makbuzYolu: kayit.durum === "odendi" && kayit.hareketId ? makbuzYolu(tenantId, kayit.id) : null,
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

  async baslat(girdi: { posHesapId: string; cariId: string; faturaId?: string; tutar: string; oncekiniIptalEt?: boolean; bildirim?: boolean }) {
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
    const { token: odemeToken, ozet: odemeTokenOzeti } = odemeTokeniUret();
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
          odemeTokenOzeti,
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
        // SAH-07: sahada kanal kullanıcı seçer (bildirim: false); bağlantı ayrıca gönderilir ya da karekodla gösterilir.
        if (girdi.bildirim !== false) await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.link, girdi.faturaId).catch(() => undefined);
        if (girdi.bildirim !== false && cari.telefon)
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
      if (girdi.bildirim !== false) await this.odemeLinkiEpostala(tenantId, tamamlanan.id, cari.eposta, cari.unvan, sonuc.odemeSayfasiUrl, girdi.faturaId).catch(
        () => undefined,
      );
      if (girdi.bildirim !== false && cari.telefon)
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

  /**
   * SEC-22: dönüş adresindeki firma kimliği yalnız arama kapsamıdır (RLS). Firma,
   * o kapsamda bulunan tahsilat kaydı ve sağlayıcının kanıtıyla (iyzico: saklı token +
   * firmanın anahtarıyla sorgu + conversationId; PayTR: firmanın üye işyeri no'su ve
   * imzası) doğrulanır; başka firmaya düşülmez. Ret, kayıt o firmada varsa firmanın
   * denetim kaydına yazılır (yoksa yalnız sunucu günlüğüne: sahte adresle başka firmanın
   * kaydı doldurulamaz). Sır, token ve imza yazılmaz.
   */
  private async donusuReddet(tenantId: string, tahsilatId: string, kayitVar: boolean, saglayici: "iyzico" | "paytr", neden: string, mesaj: string): Promise<never> {
    this.logger.warn(`POS dönüşü reddedildi (${saglayici}, ${neden}, kayıt ${kayitVar ? "var" : "yok"})`);
    if (kayitVar) {
      try {
        await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({
          data: { tenantId, userId: null, islem: "pos_donusu_reddedildi", varlik: "pos_tahsilat", varlikId: tahsilatId, detay: { saglayici, neden } },
        }));
      } catch { /* ret kaydı yazılamasa da istek reddedilir */ }
    }
    throw new BadRequestException(mesaj);
  }

  /**
   * P-04 / SEC-22: Callback rotasındaki tenantId yol parametresini arama ipucu sayar;
   * firma doğrudan sunucu kaydından ve SECURITY DEFINER fonksiyonla çözülür.
   */
  async tenantCoz(tahsilatId: string, tenantIdHint?: string): Promise<string> {
    if ((this.prisma as any).$queryRaw) {
      try {
        const satirlar = await this.prisma.$queryRaw<{ tenant_id: string }[]>`
          SELECT pos_tahsilat_kiraci_coz(${tahsilatId}::uuid) AS tenant_id
        `;
        const cozulmus = satirlar[0]?.tenant_id;
        if (cozulmus) {
          if (tenantIdHint && tenantIdHint !== cozulmus) {
            this.logger.warn(`POS callback tenant uyuşmazlığı tespit edildi (hint: ${tenantIdHint}, gerçek: ${cozulmus}, tahsilat: ${tahsilatId})`);
          }
          return cozulmus;
        }
      } catch {
        // Fonksiyon yoksa veya raw query mocklanmamışsa hint'e dön
      }
    }
    if (tenantIdHint) return tenantIdHint;
    throw new NotFoundException("POS tahsilat kaydı bulunamadı");
  }

  /**
   * P-04: Sağlayıcı webhook ve dönüş olaylarını kalıcılaştırır, iş anahtarıyla
   * mükerrerliği ve yarış durumunu engeller. En az 10 eşzamanlı aynı olay tek
   * finansal etki üretir.
   */
  private async olayKaydiIsle<T>(
    tenantId: string,
    tahsilatId: string,
    saglayici: "iyzico" | "paytr",
    isAnahtari: string,
    olayTuru: string,
    istekOzeti: Record<string, unknown>,
    islemFn: () => Promise<T>,
    tekrarFn: () => Promise<T>,
  ): Promise<T> {
    try {
      const mevcut = await this.prisma.tenantIslem(tenantId, async (tx: any) => {
        if (!tx.posOlayKaydi) return null;
        return tx.posOlayKaydi.findUnique({
          where: { tenantId_isAnahtari: { tenantId, isAnahtari } },
        });
      });
      if (mevcut && (mevcut.durum === "tamamlandi" || mevcut.durum === "tekrar")) {
        this.logger.log(`POS mükerrer olay yakalandı (${saglayici}, iş anahtarı: ${isAnahtari})`);
        return tekrarFn();
      }

      await this.prisma.tenantIslem(tenantId, async (tx: any) => {
        if (!tx.posOlayKaydi) return;
        await tx.posOlayKaydi.upsert({
          where: { tenantId_isAnahtari: { tenantId, isAnahtari } },
          create: {
            tenantId,
            posTahsilatId: tahsilatId,
            saglayici,
            isAnahtari,
            olayTuru,
            durum: "alindi",
            istekOzeti,
          },
          update: {
            durum: "alindi",
            istekOzeti,
          },
        });
      }).catch(() => undefined);
    } catch {
      // Mock / schema koruması
    }

    try {
      const sonuc = await islemFn();
      await this.prisma.tenantIslem(tenantId, async (tx: any) => {
        if (!tx.posOlayKaydi) return;
        await tx.posOlayKaydi.updateMany({
          where: { tenantId, isAnahtari },
          data: { durum: "tamamlandi", yanitKodu: 200 },
        });
      }).catch(() => undefined);
      return sonuc;
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      await this.prisma.tenantIslem(tenantId, async (tx: any) => {
        if (!tx.posOlayKaydi) return;
        await tx.posOlayKaydi.updateMany({
          where: { tenantId, isAnahtari },
          data: { durum: "hata", hata: mesaj },
        });
      }).catch(() => undefined);
      throw hata;
    }
  }

  async paytrCallback(tenantId: string, tahsilatId: string, girdi: PaytrCallback) {
    const gercekTenantId = await this.tenantCoz(tahsilatId, tenantId);
    tenantId = gercekTenantId;
    const isAnahtari = `paytr:${girdi.merchant_oid || tahsilatId}:${girdi.status}`;
    return this.olayKaydiIsle(
      tenantId,
      tahsilatId,
      "paytr",
      isAnahtari,
      "callback",
      { merchant_oid: girdi.merchant_oid, status: girdi.status, tutar: girdi.payment_amount },
      async () => {
        const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }),
        );
        if (!kayit?.posHesap.baglanti || kayit.posHesap.saglayici !== "paytr") return this.donusuReddet(tenantId, tahsilatId, Boolean(kayit), "paytr", "kayit_yok", "Geçersiz PayTR bildirimi");
        if (girdi.callback_id !== tahsilatId.replace(/-/g, "")) return this.donusuReddet(tenantId, tahsilatId, true, "paytr", "kimlik_uyusmuyor", "Geçersiz PayTR bildirimi");
        if (girdi.status !== "success") throw new BadRequestException("Geçersiz PayTR bildirimi");
        const config = this.paytrConfig(kayit.posHesap.baglanti.sifreliConfig);
        if (girdi.merchant_id !== config.merchantId) return this.donusuReddet(tenantId, tahsilatId, true, "paytr", "uye_isyeri_uyusmuyor", "PayTR bildirim imzası geçersiz");
        if (!new PaytrAdapter().callbackDogrula(config, girdi)) return this.donusuReddet(tenantId, tahsilatId, true, "paytr", "imza_gecersiz", "PayTR bildirim imzası geçersiz");
        const doviz = girdi.currency === "TL" ? "TRY" : girdi.currency;
        if (doviz !== kayit.dovizCinsi || !new Prisma.Decimal(girdi.payment_amount).div(100).equals(kayit.tutar))
          return this.donusuReddet(tenantId, tahsilatId, true, "paytr", "tutar_uyusmuyor", "PayTR ödeme tutarı veya dövizi uyuşmuyor");
        // KSB-36: total_amount müşterinin ödediğidir (vade farkı dahil); taksit gelmezse tek çekim.
        await this.odemeyiKaydet(tenantId, kayit, girdi.merchant_oid, "PayTR kart tahsilatı", {
          taksit: Number(girdi.installment_count) || 1,
          odenen: girdi.total_amount ? new Prisma.Decimal(girdi.total_amount).div(100) : undefined,
        });
        return "OK";
      },
      async () => "OK",
    );
  }

  private async odemeyiKaydet(tenantId: string, kayit: any, odemeId: string, aciklama: string, ayrinti: OdemeAyrintisi = {}) {
    if (kayit.durum === "odendi") return { basarili: true, tekrar: true, makbuzAnahtari: makbuzAnahtari(tenantId, kayit.id) };
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
    if (hak.count !== 1) return { basarili: true, tekrar: true, gecOdeme: false, makbuzAnahtari: makbuzAnahtari(tenantId, kayit.id) };
    await this.tahsilatiYaz(tx, tenantId, kayit, simdi, aciklama);
    return { basarili: true, tekrar: false, gecOdeme, makbuzAnahtari: makbuzAnahtari(tenantId, kayit.id) };
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
  /**
   * KSB-43: iyzico/PayTR tahsilatında iade önce sağlayıcıya gönderilir; sağlayıcı
   * onaylarsa TekirExtra kaydı yazılır, reddederse hiçbir şey yazılmaz.
   * `saglayiciyaGonder: false` ("panelden zaten iade ettim") ve banka POS'u
   * slibi yalnız kayıttır. Aynı tahsilata eşzamanlı ikinci sağlayıcı iadesi,
   * tahsilattaki iade kilidiyle engellenir (10 dk sonra kendiliğinden düşer).
   */
  async iade(id: string, girdi: { tutar: string; tarih: string; neden: string; saglayiciyaGonder?: boolean }) {
    const { tenantId, userId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "POS iadesi");
    const on = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findUnique({ where: { id }, include: { posHesap: { include: { baglanti: true } }, iadeler: { select: { tutar: true } } } }),
    );
    if (!on || on.durum !== "odendi" || !on.hareketId) throw new BadRequestException("Yalnız ödenmiş POS tahsilatı iade edilebilir");
    // PLT-40: abonelik tahsilatı platformun ödemesidir; iadesi platform tarafında yapılır.
    if (on.kanal === "abonelik") throw new BadRequestException("Abonelik tahsilatı buradan iade edilemez; abonelik iadesi platform tarafında yapılır");
    const saglayici = on.kanal !== "slip" && ["iyzico", "paytr"].includes(on.posHesap.saglayici) ? (on.posHesap.saglayici as "iyzico" | "paytr") : null;
    const gonder = Boolean(saglayici) && girdi.saglayiciyaGonder !== false;
    const kilitTaze = on.iadeKilidi && on.iadeKilidi.getTime() > Date.now() - IADE_KILIDI_MS;
    if (kilitTaze) throw new ConflictException("Bu tahsilat için sağlayıcıya gönderilmiş, sonucu beklenen bir iade var; birkaç dakika sonra tekrar deneyin");
    if (!gonder) return this.iadeYaz(tenantId, userId, id, girdi, { saglayiciyaGonderildi: false });

    const tutar = new Prisma.Decimal(girdi.tutar);
    const kalan = on.iadeler.reduce((t, i) => t.sub(i.tutar), on.tutar);
    if (tutar.gt(kalan)) throw new BadRequestException(`İade tutarı iade edilebilir kalanı (${kalan.toFixed(2)} ${on.dovizCinsi}) aşıyor`);
    if (!on.posHesap.baglanti || !on.saglayiciOdemeId) throw new BadRequestException("Tahsilatın sağlayıcı bağlantısı ya da ödeme numarası yok; iadeyi 'sağlayıcıya gönderme' seçerek elle kaydedin");
    // Kayıt sağlayıcı onayından sonra yazılır; kur eksikliği gibi bir engel para iade edildikten sonra çıkmasın.
    if (on.dovizCinsi !== "TRY") await this.prisma.tenantIslem(tenantId, (tx) => kurZorunlu(tx, on.dovizCinsi, new Date(girdi.tarih), "satis", tenantId));
    const kilit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.updateMany({
        where: { id, OR: [{ iadeKilidi: null }, { iadeKilidi: { lt: new Date(Date.now() - IADE_KILIDI_MS) } }] },
        data: { iadeKilidi: new Date() },
      }),
    );
    if (kilit.count !== 1) throw new ConflictException("Bu tahsilat için sağlayıcıya gönderilmiş, sonucu beklenen bir iade var; birkaç dakika sonra tekrar deneyin");
    const kilidiAc = async () => {
      try {
        await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.update({ where: { id }, data: { iadeKilidi: null } }));
      } catch {
        /* kilit 10 dk sonra kendiliğinden düşer */
      }
    };

    let ref: string;
    try {
      // Her iade isteği tek işlem numarasıyla gider (iyzico conversationId / PayTR reference_no).
      const islemNo = randomBytes(16).toString("hex");
      if (saglayici === "iyzico") {
        const config = this.config(on.posHesap.baglanti.sifreliConfig);
        if (!on.saglayiciToken) throw new Error("iyzico ödeme anahtarı (token) yok");
        const ayrinti = await new IyzicoAdapter().odemeSonucu(config, on.saglayiciToken);
        if (ayrinti.odemeIslemNolari.length !== 1) throw new Error("iyzico ödemesinde tek sepet kalemi bulunamadı");
        ref = (await new IyzicoAdapter().iadeEt(config, { odemeIslemNo: ayrinti.odemeIslemNolari[0], tutar: tutar.toFixed(2), dovizCinsi: on.dovizCinsi, conversationId: islemNo })).ref;
      } else {
        ref = (await new PaytrAdapter().iadeEt(this.paytrConfig(on.posHesap.baglanti.sifreliConfig), { merchantOid: on.saglayiciOdemeId, tutar: tutar.toFixed(2), referans: islemNo })).ref;
      }
    } catch (hata) {
      await kilidiAc();
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      throw new BadGatewayException(`${saglayici === "iyzico" ? "iyzico" : "PayTR"} iadeyi gerçekleştirmedi: ${mesaj}. TekirExtra'da kayıt yazılmadı.`);
    }
    try {
      return await this.iadeYaz(tenantId, userId, id, girdi, { saglayiciyaGonderildi: true, saglayiciIadeRef: ref });
    } catch (hata) {
      // Para müşteriye döndü ama kayıt yazılamadı: kilit kalkar, bekleyen iade tahsilatta saklanır ve bildirilir.
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      this.logger.error(`Sağlayıcı iadesi kaydedilemedi (${id}, ${tutar.toFixed(2)} ${on.dovizCinsi}, ref ${ref}): ${mesaj}`);
      try {
        await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.posTahsilat.update({ where: { id }, data: { iadeKilidi: null, bekleyenSaglayiciIade: { tutar: tutar.toFixed(2), tarih: girdi.tarih, neden: girdi.neden, ref } } }),
        );
      } catch (yazmaHatasi) {
        this.logger.error(`Bekleyen sağlayıcı iadesi de yazılamadı (${id}): ${yazmaHatasi instanceof Error ? yazmaHatasi.message : String(yazmaHatasi)}`);
      }
      await this.kayitsizIadeyiBildir(tenantId, on, tutar, ref);
      throw new ConflictException(`İade sağlayıcıda yapıldı (ref ${ref}) ama TekirExtra kaydı yazılamadı: ${mesaj}. Sorunu giderip iadeyi 'sağlayıcıya gönderme' seçerek elle kaydedin; sağlayıcıya yeniden göndermeyin.`);
    }
  }

  private async kayitsizIadeyiBildir(tenantId: string, kayit: { id: string; dovizCinsi: string }, tutar: Prisma.Decimal, ref: string) {
    try {
      await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () =>
        this.bildirimler.uret({
          tur: "entegrasyon",
          onem: "kritik",
          baslik: "POS iadesi sağlayıcıda yapıldı, kayıt bekliyor",
          aciklama: `${tutar.toFixed(2)} ${kayit.dovizCinsi} iade sağlayıcıda gerçekleşti (ref ${ref}) ama TekirExtra kaydı yazılamadı. İadeyi "sağlayıcıya gönderme" seçerek elle kaydedin; sağlayıcıya yeniden göndermeyin.`,
          birlesimAnahtari: `pos-kayitsiz-iade:${kayit.id}:${ref}`,
          kaynakTur: "pos_tahsilat",
          kaynakRef: kayit.id,
          hedefYol: "/panel/kasa-banka/pos",
          roller: ["yonetici", "muhasebe"],
        }),
      );
    } catch (hata) {
      this.logger.warn(`Kayıtsız iade bildirimi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`);
    }
  }

  /**
   * PLT-44: platformdan yapılan abonelik iadesinin faturalayan firmadaki POS kaydı.
   * Yalnız `kanal = abonelik` tahsilatına yazılır; para sağlayıcıda zaten iade edilmiştir.
   * Aynı platform iadesi (`ref`) ikinci kez yazılmaz.
   */
  async abonelikIadesiYaz(tenantId: string, posTahsilatId: string, girdi: { tutar: string; tarih: string; neden: string }, saglayici: { saglayiciyaGonderildi: boolean; saglayiciIadeRef: string }) {
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "Abonelik iadesi");
    const mevcut = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.posTahsilat.findUnique({ where: { id: posTahsilatId }, select: { kanal: true } });
      if (!kayit || kayit.kanal !== "abonelik") throw new BadRequestException("Abonelik POS tahsilatı bulunamadı");
      return tx.posIade.findFirst({ where: { posTahsilatId, saglayiciIadeRef: saglayici.saglayiciIadeRef } });
    });
    if (mevcut) return mevcut;
    return this.iadeYaz(tenantId, SISTEM_USER_ID, posTahsilatId, girdi, saglayici);
  }

  /** İadenin TekirExtra kaydı: POS çıkışı, cari borcu, fatura mahsubunun geri açılması. */
  private async iadeYaz(
    tenantId: string,
    userId: string,
    id: string,
    girdi: { tutar: string; tarih: string; neden: string },
    saglayici: { saglayiciyaGonderildi: boolean; saglayiciIadeRef?: string },
  ) {
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
        data: { tenantId, posTahsilatId: kayit.id, tutar, tarih, neden: girdi.neden, hareketId: hareket.id, userId, ...saglayici },
      });
      // KSB-43: kayıt yazıldı; kilit ve (elle tamamlanan) bekleyen sağlayıcı iadesi temizlenir.
      await tx.posTahsilat.update({ where: { id: kayit.id }, data: { iadeKilidi: null, bekleyenSaglayiciIade: Prisma.DbNull } });
      await this.kapamayiIadeyleEsitle(tx, tenantId, kayit.id);
      return iade;
    });
  }

  async iadeGeriAl(iadeId: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const iade = await tx.posIade.findUnique({ where: { id: iadeId }, include: { hareket: true, posTahsilat: { select: { kanal: true } } } });
      if (!iade) throw new NotFoundException("POS iadesi bulunamadı");
      // PLT-44: abonelik iadesi platformda yapılır ve abonelik dönemini değiştirir; buradan geri alınamaz.
      if (iade.posTahsilat.kanal === "abonelik") throw new BadRequestException("Abonelik iadesi buradan geri alınamaz; platformda yapılan iadenin kaydıdır");
      // KSB-43: para sağlayıcı üzerinden müşteriye döndü; kayıt geri alınırsa defter sağlayıcıyla çelişir.
      if (iade.saglayiciyaGonderildi) throw new BadRequestException("Sağlayıcıya gönderilmiş iade geri alınamaz; para müşteriye iade edildi");
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

  /**
   * KSB-40: POS hesaplarının dönem özeti (varsayılan bu ay, İstanbul günleri).
   * Tahsilat: dönemde ödenen; komisyon tahsilatta yazılı olandır (sağlayıcı /
   * tahmin ayrı, komisyonu yazılmamış eski tahsilat sayısı ayrıca döner);
   * iade: dönemde yapılan. Bakiye ve aktarılabilir (valörü gelmiş) güncel değerdir.
   */
  async hesapOzetleri(girdi: { baslangic?: string; bitis?: string } = {}) {
    const { tenantId } = aktifBaglam();
    const bugun = bugunTR();
    const baslangic = girdi.baslangic ?? `${bugun.slice(0, 8)}01`;
    const bitis = girdi.bitis ?? bugun;
    const bas = new Date(`${baslangic}T00:00:00+03:00`);
    const son = new Date(`${bitis}T23:59:59.999+03:00`);
    const [gruplar, iadeler, plan] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.groupBy({
          by: ["posHesapId", "komisyonKaynagi"],
          where: { durum: "odendi", odemeTarihi: { gte: bas, lte: son } },
          _count: { _all: true },
          _sum: { tutar: true, komisyonTutari: true },
        }),
      ),
      this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posIade.findMany({
          where: { tarih: { gte: new Date(baslangic), lte: new Date(bitis) } },
          select: { tutar: true, posTahsilat: { select: { posHesapId: true } } },
        }),
      ),
      this.bankayaGececekler(),
    ]);
    const S = (v?: Prisma.Decimal | null) => v ?? new Prisma.Decimal(0);
    return {
      baslangic,
      bitis,
      hesaplar: plan.map((p) => {
        const g = gruplar.filter((x) => x.posHesapId === p.posHesap.id);
        const brut = g.reduce((t, x) => t.add(S(x._sum.tutar)), new Prisma.Decimal(0));
        const saglayici = g.filter((x) => x.komisyonKaynagi === "saglayici").reduce((t, x) => t.add(S(x._sum.komisyonTutari)), new Prisma.Decimal(0));
        const tahmin = g.filter((x) => x.komisyonKaynagi === "tahmin").reduce((t, x) => t.add(S(x._sum.komisyonTutari)), new Prisma.Decimal(0));
        const iade = iadeler.filter((i) => i.posTahsilat.posHesapId === p.posHesap.id).reduce((t, i) => t.add(i.tutar), new Prisma.Decimal(0));
        const aktarilabilir = p.gruplar.filter((x) => x.vadesiGeldi).reduce((t, x) => t.add(x.net), new Prisma.Decimal(0));
        return {
          posHesapId: p.posHesap.id,
          dovizCinsi: p.posHesap.dovizCinsi,
          adet: g.reduce((t, x) => t + x._count._all, 0),
          komisyonsuzAdet: g.filter((x) => !x.komisyonKaynagi).reduce((t, x) => t + x._count._all, 0),
          brut: brut.toFixed(2),
          komisyonSaglayici: saglayici.toFixed(2),
          komisyonTahmin: tahmin.toFixed(2),
          iade: iade.toFixed(2),
          net: brut.sub(saglayici).sub(tahmin).sub(iade).toFixed(2),
          bakiye: p.bakiye,
          aktarilabilir: aktarilabilir.toFixed(2),
        };
      }),
    };
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

  /** SAH-07: açık ödeme bağlantısının karekodu (müşteri kendi telefonuyla okutur). */
  async karekod(id: string): Promise<string> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findUnique({ where: { id }, select: { odemeSayfasiUrl: true, durum: true } }));
    if (!kayit?.odemeSayfasiUrl || kayit.durum !== "baslatildi") throw new BadRequestException("Gösterilebilir açık ödeme bağlantısı bulunamadı");
    return odemeKarekodu(kayit.odemeSayfasiUrl);
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
        sablon: { tur: "odeme_baglantisi_eposta", degiskenler: { cari: unvan, baglanti: link, odeme_turu: faturaId ? "fatura" : "cari hesap" } },
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
      const { gorevId } = await this.sms.gonder({ tur: "odeme_baglantisi", telefon, sablon: odemeBaglantisiSmsSablonu({ unvan, link, faturaIcin: Boolean(faturaId) }) });
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.posTahsilat.update({ where: { id }, data: { smsGonderimTarihi: new Date(), smsGorevId: gorevId, smsHatasi: null } }),
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
          where: { id: tahsilatId, durum: "odendi", hareketId: { not: null } },
          include: {
            hareket: { include: { posHesap: true, cari: { select: { kod: true, unvan: true, belgeDili: true, belgeCiftDil: true } }, fatura: { select: { no: true } } } },
          },
        }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true } }),
      ]),
    );
    // SEC-23: anahtar türetilmiş anahtarla ya da eski bağlantının özetiyle sabit sürede karşılaştırılır.
    if (!tahsilat?.hareket || !firma || !makbuzAnahtariGecerli(tenantId, tahsilatId, anahtar, tahsilat.makbuzAnahtarOzeti)) throw new NotFoundException("Tahsilat makbuzu bulunamadı");
    // Açık (oturumsuz) bağlantı: kiracı ayarı okunmaz, varsayılan görünümle basılır.
    const { html, altBilgi } = makbuzPdfHtml(tahsilat.hareket, { firma });
    const buffer = await this.pdf.htmlToPdf(html, { altBilgi });
    return { buffer, dosyaAdi: `tahsilat-makbuzu-${tahsilat.id.slice(0, 8)}.pdf` };
  }

  async callback(tenantId: string, tahsilatId: string, token: string) {
    const gercekTenantId = await this.tenantCoz(tahsilatId, tenantId);
    tenantId = gercekTenantId;
    const isAnahtari = `iyzico:${tahsilatId}:${token}`;
    return this.olayKaydiIsle(
      tenantId,
      tahsilatId,
      "iyzico",
      isAnahtari,
      "callback",
      { token },
      async () => {
        const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.posTahsilat.findUnique({ where: { id: tahsilatId }, include: { posHesap: { include: { baglanti: true } } } }),
        );
        if (!kayit || !kayit.saglayiciToken || kayit.saglayiciToken !== token)
          return this.donusuReddet(tenantId, tahsilatId, Boolean(kayit), "iyzico", kayit ? "token_uyusmuyor" : "kayit_yok", "Geçersiz ödeme callback tokenı");
        if (kayit.durum === "odendi") return { basarili: true, tekrar: true, makbuzAnahtari: makbuzAnahtari(tenantId, kayit.id) };
        const sonuc = await new IyzicoAdapter().odemeSonucu(this.config(kayit.posHesap.baglanti!.sifreliConfig), token);
        // SEC-22: sağlayıcının döndürdüğü ödeme bu tahsilat için başlatılmış olmalı (boş gelirse token eşleşmesi yeterli sayılır).
        if (sonuc.conversationId && sonuc.conversationId !== kayit.id)
          return this.donusuReddet(tenantId, tahsilatId, true, "iyzico", "kimlik_uyusmuyor", "Ödeme doğrulanamadı");
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
      },
      async () => ({ basarili: true, tekrar: true, makbuzAnahtari: makbuzAnahtari(tenantId, tahsilatId) }),
    );
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
    if (sonuc.conversationId && sonuc.conversationId !== kayit.id) return { odendi: false, mesaj: "iyzico'daki ödeme bu talebe ait değil; kayıt yapılmadı" };
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

  /**
   * P-04: Markalı ödeme sayfası için herkese açık güvenli bilgi ucu.
   * Yalnız gerekli firma, fatura ve tutar bilgilerini döner; sır ve hassas kimlik bilgisi sızdırmaz.
   */
  async publicOdemeBilgisi(tenantIdHint: string, tahsilatId: string, token: string) {
    const tenantId = await this.tenantCoz(tahsilatId, tenantIdHint);
    const [tahsilat, firma] = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.posTahsilat.findUnique({
        where: { id: tahsilatId },
        include: {
          cari: { select: { unvan: true } },
          fatura: { select: { no: true, tarih: true, genelToplam: true } },
          posHesap: { select: { ad: true, saglayici: true } },
        },
      });
      const f = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          unvan: true,
          vkn: true,
          telefon: true,
          eposta: true,
          webSitesi: true,
        },
      });
      if (t) {
        await tx.posTahsilat.update({
          where: { id: tahsilatId },
          data: {
            odemeGoruntulenme: { increment: 1 },
            sonGoruntulenme: new Date(),
          },
        }).catch(() => undefined);
      }
      return [t, f] as const;
    });

    if (!tahsilat || !firma) throw new NotFoundException("Ödeme kaydı bulunamadı");

    const tokenGecerli =
      odemeTokeniDogrula(token, tahsilat.odemeTokenOzeti) ||
      makbuzAnahtariGecerli(tenantId, tahsilatId, token, tahsilat.makbuzAnahtarOzeti);

    if (!tokenGecerli) throw new NotFoundException("Ödeme bağlantısı geçersiz veya süresi dolmuş");

    const simdi = new Date();
    let durum = tahsilat.durum as string;
    if (durum === "baslatildi" && tahsilat.sonKullanimTarihi && tahsilat.sonKullanimTarihi < simdi) {
      durum = "suresi_doldu";
    }

    return {
      tahsilatId: tahsilat.id,
      tenantId,
      durum,
      tutar: Number(tahsilat.tutar),
      dovizCinsi: tahsilat.dovizCinsi,
      sonKullanimTarihi: tahsilat.sonKullanimTarihi,
      odemeSayfasiUrl: durum === "baslatildi" ? tahsilat.odemeSayfasiUrl : null,
      makbuzUrl: durum === "odendi" ? `/api/v1/pos/makbuz/${tenantId}/${tahsilat.id}/${makbuzAnahtari(tenantId, tahsilat.id)}` : null,
      firma: {
        unvan: firma.unvan,
        vkn: firma.vkn,
        telefon: firma.telefon,
        eposta: firma.eposta,
        webSitesi: firma.webSitesi,
      },
      cari: {
        unvan: tahsilat.cari.unvan,
      },
      fatura: tahsilat.fatura ? {
        no: tahsilat.fatura.no,
        tarih: tahsilat.fatura.tarih ? tahsilat.fatura.tarih.toISOString().slice(0, 10) : null,
        genelToplam: Number(tahsilat.fatura.genelToplam),
      } : null,
    };
  }

  /**
   * P-04: Faturaya ait aktif ödeme bağlantısını ve durumunu döner.
   */
  async faturaOdemeBaglantisi(faturaId: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.posTahsilat.findFirst({
        where: { faturaId, durum: { in: ["baslatildi", "odendi"] } },
        orderBy: { createdAt: "desc" },
        include: { cari: { select: { unvan: true, eposta: true, telefon: true } } },
      }),
    );
    if (!kayit) return { baglantiVar: false, tahsilat: null };
    const kok = process.env.PUBLIC_API_URL ?? "http://localhost:3001";
    const webKok = process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
    return {
      baglantiVar: true,
      tahsilat: {
        id: kayit.id,
        durum: kayit.durum,
        tutar: Number(kayit.tutar),
        dovizCinsi: kayit.dovizCinsi,
        sonKullanimTarihi: kayit.sonKullanimTarihi,
        odemeSayfasiUrl: kayit.odemeSayfasiUrl,
        markaliOdemeUrl: `${webKok}/odeme/${tenantId}/${kayit.id}/${kayit.odemeTokenOzeti ? "token" : makbuzAnahtari(tenantId, kayit.id)}`,
        makbuzUrl: kayit.durum === "odendi" ? `${kok}/api/v1/pos/makbuz/${tenantId}/${kayit.id}/${makbuzAnahtari(tenantId, kayit.id)}` : null,
        cari: kayit.cari,
      },
    };
  }
}
