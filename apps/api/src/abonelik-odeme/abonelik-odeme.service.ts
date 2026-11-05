import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AbonelikDurumu, Prisma } from "@prisma/client";
import { createTransport } from "nodemailer";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { coz, sifrele } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { firmaAlicilari, odemeBaglantisi } from "../mevzuat/tahsilat-hatirlatma.service";
import { ABONELIK_SURELERI, fiyatPlani, tlYaz, type AbonelikSuresi } from "./abonelik-tutari";
import {
  PaytrAbonelikSaglayicisi, SAGLAYICI_ADI, saglayiciKur,
  type AbonelikOdemeSaglayicisi, type EtkinSaglayici, type KayitliKart, type OdemeAlicisi, type OdemeGirdisi,
} from "./abonelik-saglayici";
import { merchantOidCoz, paytrBildirimDogrula, type PaytrBildirim } from "./paytr-direkt";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";
import { fiyatFotografiniDogrula, odemeFiyatFotografi } from "./odeme-fiyat-fotografi";
import { bagliAbonelikTutari, etkinAbonelikPlani } from "../tenant/abonelik-kosullari";
import { etkinFiyatKosullariniBagla } from "../tenant/etkin-fiyat-kosullari";

export type OdemeKaynagi = "panel" | "eposta" | "otomatik";

/** PLT-14: dönem sonundan bu kadar gün önce çekilir; dönem başına en çok bu kadar deneme. */
export const YENILEME_GUN_ONCE = 3;
export const YENILEME_EN_COK_DENEME = 3;

type Tx = Prisma.TransactionClient;
type Deneme = Prisma.AbonelikOdemeDenemesiGetPayload<object>;

const tarih = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
const apiKoku = () => (process.env.PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const kisalt = (h: unknown) => (h instanceof Error ? h.message : String(h)).slice(0, 500);

/** "Ayşe Nur Yılmaz" → ad "Ayşe Nur", soyad "Yılmaz"; tek kelimede soyad ad olur (iyzico ikisini de ister). */
export function adSoyadAyir(adSoyad: string): { ad: string; soyad: string } {
  const parca = adSoyad.trim().split(/\s+/).filter(Boolean);
  if (parca.length < 2) return { ad: parca[0] ?? "TekirExtra", soyad: parca[0] ?? "Müşterisi" };
  return { ad: parca.slice(0, -1).join(" "), soyad: parca[parca.length - 1] };
}

/**
 * PLT-12/13/14: abonelik bedelinin ödeme sağlayıcısıyla tahsili. Elle ödeme
 * sağlayıcının 3D sayfasında (iyzico) ya da PayTR'a doğrudan giden kart
 * formunda yapılır; sonuç sağlayıcıdan doğrulanır ve tek bir işlemde dönemi
 * uzatır. Otomatik yenileme sağlayıcıda saklanan kartla çeker. Kart verisi
 * TekirExtra'ya gelmez.
 */
@Injectable()
export class AbonelikOdemeService {
  private readonly logger = new Logger(AbonelikOdemeService.name);
  /** Testlerde sahte sağlayıcı verilir. */
  saglayiciUret: (ayar: EtkinSaglayici) => AbonelikOdemeSaglayicisi = saglayiciKur;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ayarlar: SaglayiciAyarlariService,
    private readonly platform: PlatformPrismaService,
    private readonly erisim: AbonelikErisimService,
  ) {}

  private async fiyatliAbonelik(tx: Tx, tenantId: string) {
    return etkinFiyatKosullariniBagla(tx, tenantId, await tx.tenantAbonelik.findUnique({ where: { tenantId } }));
  }
  /** Panel: süre seçenekleri, kayıtlı kart ve ödeme geçmişi. Etkin sağlayıcı yoksa ya da plan fiyatsızsa ödeme düğmesi çıkmaz. */
  async durum(tenantId: string) {
    const ayar = await this.ayarlar.etkin();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const abonelik = await this.fiyatliAbonelik(tx, tenantId);
      const planKodu = abonelik?.planKodu ?? "v1";
      const secenekler = ABONELIK_SURELERI.map((a) => bagliAbonelikTutari(abonelik ?? { planKodu }, a)).filter((t) => t !== null);
      const [odemeler, basarisiz, kart] = await Promise.all([
        tx.abonelikOdemesi.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, aySayisi: true, tutar: true, matrah: true, kdv: true, kaynak: true, saglayici: true, yeniDonemSonu: true, fatura: { select: { durum: true, faturaNo: true } } } }),
        tx.abonelikOdemeDenemesi.findMany({ where: { durum: "basarisiz" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, createdAt: true, aySayisi: true, toplam: true, hataMesaji: true, kaynak: true } }),
        tx.abonelikKarti.findUnique({ where: { tenantId } }),
      ]);
      const neden = !ayar
        ? "Çevrim içi ödeme henüz açık değil; ödeme için TekirExtra ekibiyle iletişime geçin."
        : !secenekler.length
          ? `${fiyatPlani(planKodu)?.ad ?? "Bu"} planı için ödeme teklifle yapılır; TekirExtra ekibiyle iletişime geçin.`
          : null;
      return {
        etkin: Boolean(ayar && secenekler.length),
        saglayici: ayar ? SAGLAYICI_ADI[ayar.saglayici] : null,
        testOrtami: ayar?.ortam === "test",
        neden,
        donemSonu: abonelik?.donemSonu ?? null,
        secenekler: secenekler.map((t) => ({ aySayisi: t.aySayisi, matrah: t.matrah.toFixed(2), kdv: t.kdv.toFixed(2), toplam: t.toplam.toFixed(2) })),
        kart: kart
          ? {
              saglayici: SAGLAYICI_ADI[kart.saglayici as keyof typeof SAGLAYICI_ADI] ?? kart.saglayici,
              son4: kart.son4, marka: kart.kartMarkasi, otomatikYenileme: kart.otomatikYenileme, aySayisi: kart.aySayisi,
              // Kart başka sağlayıcıya ya da ortama aitse yenileme çalışmaz; yeni kartla ödeme gerekir.
              gecerli: Boolean(ayar && ayar.saglayici === kart.saglayici && ayar.ortam === kart.ortam),
              sonHata: kart.sonHata, sonDeneme: kart.sonDenemeAt,
            }
          : null,
        odemeler,
        basarisizDenemeler: basarisiz,
      };
    });
  }

  /** Sağlayıcıya giden alıcı ve tutar bilgisi; elle, e-posta ve otomatik ödemede aynı kural. */
  private async girdiKur(tx: Tx, tenantId: string, deneme: Deneme, ayar: EtkinSaglayici, ip?: string | null): Promise<OdemeGirdisi> {
    const fiyat = deneme.fiyatFotografi == null ? null : fiyatFotografiniDogrula(deneme.fiyatFotografi, deneme);
    const [abonelik, firma, kart] = await Promise.all([
      this.fiyatliAbonelik(tx, tenantId),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, adres: true, il: true, telefon: true } }),
      tx.abonelikKarti.findUnique({ where: { tenantId } }),
    ]);
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const kisi = await tx.user.findFirst({
      where: deneme.baslatanUserId ? { id: deneme.baslatanUserId } : { aktif: true, rol: "yonetici" },
      orderBy: { createdAt: "asc" },
      select: { adSoyad: true, eposta: true },
    });
    if (!kisi) throw new ForbiddenException("Firmada aktif yönetici yok");
    const alici: OdemeAlicisi = {
      ...adSoyadAyir(kisi.adSoyad), eposta: abonelik?.faturaEpostasi || kisi.eposta, telefon: firma.telefon,
      kimlikNo: /^\d{11}$/.test(firma.vkn) ? firma.vkn : "11111111111", // iyzico TCKN biçimi ister; VKN'li firmada yer tutucu
      adres: firma.adres?.trim() || "Türkiye", il: firma.il?.trim() || "İstanbul", ip: ip ?? undefined,
    };
    const ayniSaglayici = kart && kart.saglayici === ayar.saglayici && kart.ortam === ayar.ortam;
    return {
      tenantId, denemeId: deneme.id, toplam: deneme.toplam.toFixed(2),
      aciklama: `TekirExtra ${fiyat?.planAdi ?? fiyatPlani(deneme.planKodu)?.ad ?? deneme.planKodu} abonelik (${deneme.aySayisi} ay)`,
      firmaUnvani: (abonelik?.faturalandirmaUnvani || firma.unvan).trim(), alici, apiKok: apiKoku(),
      kartKaydet: deneme.kartKaydet,
      mevcutKart: ayniSaglayici ? (JSON.parse(coz(kart.sifreliAnahtarlar)) as Record<string, string>) : undefined,
    };
  }

  private async denemeAc(tx: Tx, tenantId: string, ayar: EtkinSaglayici, aySayisi: AbonelikSuresi, kaynak: OdemeKaynagi, kullaniciId: string | null, kartKaydet: boolean) {
    const [plan] = await tx.$queryRaw<{ bekle: boolean }[]>`SELECT abonelik_planli_atama_bekle(${kaynak === "otomatik"}) AS bekle`;
    if (plan.bekle) throw new BadRequestException("Planlı fiyat geçişi bekleniyor. Geçiş tamamlandıktan veya yönetici planı inceledikten sonra yeniden deneyin.");
    const abonelik = await this.fiyatliAbonelik(tx, tenantId);
    const tutar = bagliAbonelikTutari(abonelik ?? { planKodu: "v1" }, aySayisi);
    if (!tutar) throw new BadRequestException("Bu plan için çevrim içi ödeme yok; TekirExtra ekibiyle iletişime geçin");
    return tx.abonelikOdemeDenemesi.create({
      data: {
        tenantId, saglayici: ayar.saglayici, ortam: ayar.ortam, kaynak, planKodu: tutar.planKodu, aySayisi,
        matrah: tutar.matrah, kdv: tutar.kdv, toplam: tutar.toplam, baslatanUserId: kullaniciId, kartKaydet,
        fiyatFotografi: odemeFiyatFotografi(tutar),
      },
    });
  }

  private basarisizSay(tenantId: string, denemeId: string, hata: string) {
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.abonelikOdemeDenemesi.updateMany({ where: { id: denemeId, durum: "baslatildi" }, data: { durum: "basarisiz", hataMesaji: hata.slice(0, 500), sonuclandiAt: new Date() } }),
    );
  }

  /**
   * Ödeme girişimini açar ve ödeyenin gideceği adresi döner. `kullaniciId`
   * panelde ödeyen yöneticidir; e-posta bağlantısında boştur (alıcı bilgisi
   * ilk aktif yöneticiden alınır). `kartKaydet` PLT-14 otomatik yenilemeyi açar.
   */
  async baslat(tenantId: string, aySayisi: AbonelikSuresi, kaynak: OdemeKaynagi, kullaniciId: string | null, ip?: string, kartKaydet = false) {
    const ayar = await this.ayarlar.etkin();
    if (!ayar) throw new BadRequestException("Çevrim içi ödeme açık değil; ödeme için TekirExtra ekibiyle iletişime geçin");
    const { deneme, girdi } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const deneme = await this.denemeAc(tx, tenantId, ayar, aySayisi, kaynak, kullaniciId, kartKaydet);
      return { deneme, girdi: await this.girdiKur(tx, tenantId, deneme, ayar, ip) };
    });
    try {
      const sonuc = await this.saglayiciUret(ayar).odemeBaslat(girdi);
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.abonelikOdemeDenemesi.update({ where: { id: deneme.id }, data: { saglayiciToken: sonuc.token, odemeSayfasiUrl: sonuc.odemeSayfasiUrl } }),
      );
      return { denemeId: deneme.id, odemeSayfasiUrl: sonuc.odemeSayfasiUrl };
    } catch (hata) {
      await this.basarisizSay(tenantId, deneme.id, kisalt(hata));
      this.logger.error(JSON.stringify({ event: "billing_payment_start_failed", tenantId, denemeId: deneme.id, error: kisalt(hata) }));
      throw new BadGatewayException(`${SAGLAYICI_ADI[ayar.saglayici]} ödeme sayfası açılamadı; biraz sonra yeniden deneyin`);
    }
  }

  /** Girişim + girişimin sağlayıcısı; sağlayıcı sonradan değiştiyse ödeme bu yoldan doğrulanamaz. */
  private async denemeVeAyar(tenantId: string, denemeId: string, token: string) {
    const deneme = await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikOdemeDenemesi.findUnique({ where: { id: denemeId } }));
    if (!deneme || !deneme.saglayiciToken || deneme.saglayiciToken !== token) throw new BadRequestException("Geçersiz ödeme bağlantısı");
    const ayar = await this.ayarlar.etkin();
    if (!ayar || ayar.saglayici !== deneme.saglayici) throw new BadRequestException("Ödemenin sağlayıcısı artık etkin değil; TekirExtra ekibiyle iletişime geçin");
    return { deneme, ayar };
  }

  /**
   * iyzico'nun yönlendirmesi: token girişimin token'ıyla eşleşmeli, sonuç
   * sağlayıcıdan sorgulanır, tutar ve döviz girişimle aynı olmalıdır.
   * Tekrarlanan bildirim ödemeyi ikinci kez saymaz.
   */
  async callback(tenantId: string, denemeId: string, token: string) {
    const { deneme, ayar } = await this.denemeVeAyar(tenantId, denemeId, token);
    if (deneme.durum === "odendi") return { tekrar: true, yeniDonemSonu: await this.donemSonu(tenantId), kartKaydedildi: false };
    const saglayici = this.saglayiciUret(ayar);
    if (!saglayici.odemeSonucu) throw new BadRequestException("Geçersiz ödeme bildirimi");
    const sonuc = await saglayici.odemeSonucu(token);
    if (!sonuc.basarili || !new Prisma.Decimal(sonuc.tutar).equals(deneme.toplam) || sonuc.dovizCinsi !== "TRY" || !sonuc.odemeId) {
      await this.basarisizSay(tenantId, deneme.id, sonuc.basarili ? "Sağlayıcının bildirdiği tutar ya da döviz girişimle uyuşmuyor" : "Ödeme sağlayıcıda tamamlanmadı");
      throw new BadRequestException("Ödeme doğrulanamadı");
    }
    return this.odemeyiKaydet(tenantId, deneme.id, sonuc.odemeId, deneme.kartKaydet ? sonuc.kart : undefined);
  }

  /** PayTR kart formu: gizli alanlar formu açan tarayıcının IP'siyle imzalanır. */
  async paytrForm(tenantId: string, denemeId: string, token: string, ip: string) {
    const { deneme, ayar } = await this.denemeVeAyar(tenantId, denemeId, token);
    if (deneme.durum !== "baslatildi") return { durum: deneme.durum, alanlar: null };
    const saglayici = this.saglayiciUret(ayar);
    if (!(saglayici instanceof PaytrAbonelikSaglayicisi)) throw new BadRequestException("Geçersiz ödeme bağlantısı");
    const girdi = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.abonelikOdemeDenemesi.update({ where: { id: denemeId }, data: { odeyenIp: ip.slice(0, 45) } });
      return this.girdiKur(tx, tenantId, deneme, ayar, ip);
    });
    return { durum: deneme.durum, alanlar: saglayici.formAlanlari(girdi, ip, token), firmaUnvani: girdi.firmaUnvani, aciklama: girdi.aciklama, toplam: girdi.toplam, kartKaydet: deneme.kartKaydet, testOrtami: ayar.ortam === "test" };
  }

  /** PayTR dönüş sayfası: sonuç bildirimle gelir, kullanıcı daha önce dönebilir. */
  async paytrSonuc(tenantId: string, denemeId: string, token: string) {
    const deneme = await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikOdemeDenemesi.findUnique({ where: { id: denemeId } }));
    if (!deneme || deneme.saglayiciToken !== token) throw new BadRequestException("Geçersiz ödeme bağlantısı");
    return { durum: deneme.durum, hata: deneme.hataMesaji, yeniDonemSonu: deneme.durum === "odendi" ? await this.donemSonu(tenantId) : null };
  }

  /**
   * PayTR'ın bildirim adresi (mağaza panelinde tanımlı, tek adres). İmza
   * doğrulanır; aynı sipariş için tekrar gelen bildirim yalnız "OK" alır.
   * Geçersiz bildirim hata fırlatır (PayTR yeniden dener).
   */
  async paytrBildirim(b: PaytrBildirim): Promise<void> {
    const kimlik = merchantOidCoz(String(b?.merchant_oid ?? ""));
    if (!kimlik) throw new BadRequestException("Geçersiz PayTR bildirimi");
    const ayar = await this.ayarlar.etkin();
    if (!ayar || ayar.saglayici !== "paytr") throw new BadRequestException("PayTR etkin değil");
    const saglayici = this.saglayiciUret(ayar);
    if (!(saglayici instanceof PaytrAbonelikSaglayicisi)) throw new BadRequestException("PayTR etkin değil");
    if (!paytrBildirimDogrula(saglayici.config, b)) throw new BadRequestException("PayTR bildirim imzası geçersiz");
    const { tenantId, denemeId } = kimlik;
    const deneme = await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikOdemeDenemesi.findUnique({ where: { id: denemeId } }));
    if (!deneme || deneme.saglayici !== "paytr") throw new BadRequestException("PayTR bildirimi bilinmeyen siparişe ait");
    if (deneme.durum !== "baslatildi") return; // tekrar gelen bildirim
    if (b.status !== "success") {
      await this.basarisizSay(tenantId, denemeId, `PayTR: ${b.failed_reason_msg ?? "ödeme onaylanmadı"}${b.failed_reason_code ? ` (${b.failed_reason_code})` : ""}`);
      if (deneme.kaynak === "otomatik") await this.yenilemeBasarisiz(tenantId, b.failed_reason_msg ?? "PayTR ödemeyi onaylamadı");
      return;
    }
    if (String(b.total_amount) !== deneme.toplam.mul(100).toFixed(0)) {
      await this.basarisizSay(tenantId, denemeId, "PayTR'ın bildirdiği tutar girişimle uyuşmuyor");
      return;
    }
    let kart: KayitliKart | undefined;
    if (deneme.kartKaydet && b.utoken) {
      kart = (await saglayici.kaydedilenKart(String(b.utoken)).catch((hata) => {
        this.logger.error(JSON.stringify({ event: "billing_card_list_failed", tenantId, error: kisalt(hata) }));
        return null;
      })) ?? undefined;
    }
    await this.odemeyiKaydet(tenantId, denemeId, String(b.merchant_oid), kart);
  }

  /**
   * Tek işlemde: girişim ödendi, dönem eski dönem sonundan uzar (dönem kaymaz),
   * abonelik geçmişine yazılır; ödeme nedeniyle askıdaki firma açılır. Kart
   * kaydı istendiyse ve sağlayıcı kartı döndürdüyse otomatik yenileme açılır.
   */
  async odemeyiKaydet(tenantId: string, denemeId: string, odemeId: string, kart?: KayitliKart) {
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM abonelik_odeme_denemeleri WHERE id = ${denemeId}::uuid FOR UPDATE`;
      const deneme = await tx.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: denemeId } });
      if (deneme.durum === "odendi") return { tekrar: true as const };
      if (deneme.fiyatFotografi != null) fiyatFotografiniDogrula(deneme.fiyatFotografi, deneme);
      await tx.tenantAbonelik.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
      const [eski] = await tx.$queryRaw<{ plan_kodu: string; durum: string; aski_nedeni: string | null; donem_sonu: Date | null }[]>`
        SELECT plan_kodu, durum::text AS durum, aski_nedeni, donem_sonu FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const askiKalkar = eski.durum === "askida" && eski.aski_nedeni === "odeme";
      const denemeBiter = eski.durum === "deneme";
      const [yeni] = await tx.$queryRaw<{ donem_sonu: Date }[]>`
        UPDATE tenant_abonelikleri SET
          donem_baslangici = CASE WHEN ${denemeBiter} THEN GREATEST(COALESCE(donem_sonu,now()),now()) ELSE COALESCE(donem_baslangici, now()) END,
          donem_sonu = (CASE WHEN ${denemeBiter} THEN GREATEST(COALESCE(donem_sonu,now()),now()) ELSE COALESCE(donem_sonu, now()) END) + make_interval(months => ${deneme.aySayisi}::int),
          durum = CASE WHEN ${askiKalkar || denemeBiter} THEN 'aktif'::"AbonelikDurumu" ELSE durum END,
          aski_nedeni = CASE WHEN ${askiKalkar} THEN NULL ELSE aski_nedeni END,
          updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid
        RETURNING donem_sonu`;
      const saglayiciAdi = SAGLAYICI_ADI[deneme.saglayici as keyof typeof SAGLAYICI_ADI] ?? deneme.saglayici;
      const odeme = await tx.abonelikOdemesi.create({
        data: {
          tenantId, aySayisi: deneme.aySayisi, tutar: deneme.toplam, matrah: deneme.matrah, kdv: deneme.kdv,
          kaynak: "saglayici", saglayici: deneme.saglayici,
          fiyatFotografi: deneme.fiyatFotografi === null ? Prisma.DbNull : deneme.fiyatFotografi as Prisma.InputJsonValue,
          not: `${saglayiciAdi} ödeme no ${odemeId}${deneme.kaynak === "otomatik" ? " (otomatik yenileme)" : ""}`,
          oncekiDonemSonu: eski.donem_sonu, yeniDonemSonu: yeni.donem_sonu,
        },
      });
      await tx.abonelikOdemeDenemesi.update({ where: { id: denemeId }, data: { durum: "odendi", saglayiciOdemeId: odemeId, abonelikOdemesiId: odeme.id, sonuclandiAt: new Date(), hataMesaji: null } });
      await tx.abonelikDegisikligi.create({
        data: {
          tenantId, oncekiPlan: eski.plan_kodu, yeniPlan: eski.plan_kodu, oncekiDurum: eski.durum as AbonelikDurumu, yeniDurum: (askiKalkar || denemeBiter ? "aktif" : eski.durum) as AbonelikDurumu,
          neden: `Ödeme alındı (${saglayiciAdi}${deneme.kaynak === "otomatik" ? ", otomatik yenileme" : ""}): ${deneme.aySayisi} ay, ${tlYaz(deneme.toplam)} TL (KDV dahil); dönem sonu ${tarih(yeni.donem_sonu)}${askiKalkar ? "; ödeme nedeniyle askı kalktı" : ""}`,
        },
      });
      if (kart) {
        const veri = {
          saglayici: deneme.saglayici, ortam: deneme.ortam, sifreliAnahtarlar: sifrele(JSON.stringify(kart.anahtarlar)),
          son4: kart.son4?.slice(-4) ?? null, kartMarkasi: kart.marka?.slice(0, 40) ?? null, otomatikYenileme: true, aySayisi: deneme.aySayisi,
          odeyenIp: deneme.odeyenIp, kaydedenUserId: deneme.baslatanUserId, yenilemeDonemSonu: null, denemeSayisi: 0, sonDenemeAt: null, sonHata: null,
        };
        await tx.abonelikKarti.upsert({ where: { tenantId }, create: { tenantId, ...veri }, update: veri });
      } else if (deneme.kaynak === "otomatik") {
        await tx.abonelikKarti.updateMany({ where: { tenantId }, data: { sonHata: null } });
      }
      return { tekrar: false as const, deneme, yeniDonemSonu: yeni.donem_sonu, askiKalkti: askiKalkar };
    });
    if (sonuc.tekrar) return { tekrar: true, yeniDonemSonu: await this.donemSonu(tenantId), kartKaydedildi: false };
    this.erisim.unut(tenantId);
    await this.sonrasi(tenantId, sonuc.deneme, sonuc.yeniDonemSonu, sonuc.askiKalkti, Boolean(kart)).catch((hata) =>
      this.logger.error(JSON.stringify({ event: "billing_payment_after_failed", tenantId, error: kisalt(hata) })),
    );
    return { tekrar: false, yeniDonemSonu: sonuc.yeniDonemSonu, askiKalkti: sonuc.askiKalkti, kartKaydedildi: Boolean(kart) };
  }

  /**
   * PLT-14 (worker): dönem sonundan 3 gün önce kayıtlı kartla çeker. Günde en
   * çok bir, dönem başına en çok üç deneme; deneme hakkı kart satırında atomik
   * alınır (aynı anda iki çekim olmaz). Askıdaki ve iptaldeki firma aday listesine
   * hiç girmez. Bekleyen (sonucu bildirimle gelecek) otomatik girişim varken yenisi açılmaz.
   */
  async otomatikYenile(tenantId: string): Promise<"odendi" | "bekliyor" | "basarisiz" | "atlandi"> {
    const ayar = await this.ayarlar.etkin();
    if (!ayar) return "atlandi";
    const hazir = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const [plan] = await tx.$queryRaw<{ bekle: boolean }[]>`SELECT abonelik_planli_atama_bekle(true) AS bekle`;
      if (plan.bekle) return null;
      const [abonelik, kart] = await Promise.all([this.fiyatliAbonelik(tx, tenantId), tx.abonelikKarti.findUnique({ where: { tenantId } })]);
      if (!abonelik?.donemSonu || !kart?.otomatikYenileme || (abonelik.durum !== "aktif" && abonelik.durum !== "deneme")) return null;
      if (kart.saglayici !== ayar.saglayici || kart.ortam !== ayar.ortam) {
        await tx.abonelikKarti.update({ where: { tenantId }, data: { sonHata: "Kayıtlı kart artık kullanılmayan bir sağlayıcıya ait; panelden yeni kartla ödeyin" } });
        return null;
      }
      const bekleyen = await tx.abonelikOdemeDenemesi.count({ where: { kaynak: "otomatik", durum: "baslatildi", createdAt: { gt: new Date(Date.now() - 2 * 86_400_000) } } });
      if (bekleyen) return null;
      const alinan = await tx.$executeRaw`
        UPDATE abonelik_kartlari SET
          deneme_sayisi = CASE WHEN yenileme_donem_sonu IS DISTINCT FROM ${abonelik.donemSonu} THEN 1 ELSE deneme_sayisi + 1 END,
          yenileme_donem_sonu = ${abonelik.donemSonu},
          son_deneme_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND otomatik_yenileme
          AND (yenileme_donem_sonu IS DISTINCT FROM ${abonelik.donemSonu}
               OR (deneme_sayisi < ${YENILEME_EN_COK_DENEME} AND (son_deneme_at IS NULL OR son_deneme_at < now() - interval '23 hours')))`;
      if (!alinan) return null;
      const deneme = await this.denemeAc(tx, tenantId, ayar, kart.aySayisi as AbonelikSuresi, "otomatik", null, false).catch(() => null);
      if (!deneme) {
        await tx.abonelikKarti.update({ where: { tenantId }, data: { sonHata: "Planın çevrim içi fiyatı yok; otomatik yenileme yapılamadı" } });
        return null;
      }
      await tx.abonelikOdemeDenemesi.update({ where: { id: deneme.id }, data: { odeyenIp: kart.odeyenIp } });
      const girdi = await this.girdiKur(tx, tenantId, deneme, ayar, kart.odeyenIp);
      return { deneme, girdi, anahtarlar: JSON.parse(coz(kart.sifreliAnahtarlar)) as Record<string, string> };
    });
    if (!hazir) return "atlandi";
    const { deneme, girdi, anahtarlar } = hazir;
    await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikOdemeDenemesi.update({ where: { id: deneme.id }, data: { saglayiciToken: "otomatik" } }));
    const sonuc = await this.saglayiciUret(ayar).kayitliKartlaOde(girdi, anahtarlar);
    if (sonuc.durum === "odendi") {
      await this.odemeyiKaydet(tenantId, deneme.id, sonuc.odemeId);
      return "odendi";
    }
    if (sonuc.durum === "bekliyor") return "bekliyor";
    await this.basarisizSay(tenantId, deneme.id, sonuc.hata);
    await this.yenilemeBasarisiz(tenantId, sonuc.hata);
    return "basarisiz";
  }

  /** Başarısız otomatik çekim: kart satırına yazılır, yöneticilere ödeme bağlantılı e-posta gider. */
  private async yenilemeBasarisiz(tenantId: string, hata: string) {
    const { unvan, alicilar, plan, kart, donemSonu } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.abonelikKarti.updateMany({ where: { tenantId }, data: { sonHata: hata.slice(0, 500) } });
      return this.alicilar(tx, tenantId);
    });
    this.logger.warn(JSON.stringify({ event: "billing_auto_renewal_failed", tenantId, error: hata }));
    if (!alicilar.length) return;
    const baglanti = odemeBaglantisi({ tenant_id: tenantId, plan_kodu: plan }, true);
    const kalan = kart ? YENILEME_EN_COK_DENEME - kart.denemeSayisi : 0;
    await this.posta(alicilar, "TekirExtra aboneliğiniz otomatik yenilenemedi", [
      "Merhaba,",
      "",
      `${unvan} firmasının TekirExtra aboneliği kayıtlı karttan otomatik yenilenemedi${kart?.son4 ? ` (kart **** ${kart.son4})` : ""}.`,
      `Neden: ${hata}`,
      `Dönem sonu: ${donemSonu ? tarih(donemSonu) : "—"}`,
      "",
      kalan > 0 ? `Yarın yeniden denenecek (kalan deneme: ${kalan}). Beklemeden ödemek için:` : "Otomatik deneme hakkı doldu. Kesintisiz kullanım için ödemenizi şu bağlantıdan yapın:",
      baglanti ?? "Panelde Ayarlar › Abonelik sayfası",
    ]).catch((h) => this.logger.error(JSON.stringify({ event: "billing_auto_renewal_mail_failed", tenantId, error: kisalt(h) })));
  }

  /** PLT-14: firma otomatik yenilemeyi açar/kapatır ve süresini seçer. */
  async otomatikYenilemeAyarla(tenantId: string, acik: boolean, aySayisi?: AbonelikSuresi) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kart = await tx.abonelikKarti.findUnique({ where: { tenantId } });
      if (!kart) throw new BadRequestException("Kayıtlı kart yok; önce kartınızı kaydederek ödeme yapın");
      await tx.abonelikKarti.update({ where: { tenantId }, data: { otomatikYenileme: acik, ...(aySayisi ? { aySayisi } : {}), ...(acik ? { sonHata: null } : {}) } });
      return { mesaj: acik ? `Otomatik yenileme açık: dönem sonundan ${YENILEME_GUN_ONCE} gün önce ${aySayisi ?? kart.aySayisi} aylık çekilir.` : "Otomatik yenileme kapatıldı; kart kayıtlı kalır." };
    });
  }

  /** PLT-14: kart sağlayıcıdan silinir (silinemezse de TekirExtra'dan kaldırılır, otomatik çekim durur). */
  async kartKaldir(tenantId: string) {
    const kart = await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikKarti.findUnique({ where: { tenantId } }));
    if (!kart) throw new BadRequestException("Kayıtlı kart yok");
    const ayar = await this.ayarlar.etkin();
    let saglayicidaSilindi = false;
    if (ayar && ayar.saglayici === kart.saglayici && ayar.ortam === kart.ortam) {
      try {
        await this.saglayiciUret(ayar).kartSil(JSON.parse(coz(kart.sifreliAnahtarlar)));
        saglayicidaSilindi = true;
      } catch (hata) {
        this.logger.warn(JSON.stringify({ event: "billing_card_delete_failed", tenantId, error: kisalt(hata) }));
      }
    }
    await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikKarti.delete({ where: { tenantId } }));
    return { mesaj: saglayicidaSilindi ? "Kart kaldırıldı; otomatik yenileme kapandı." : "Kart TekirExtra'dan kaldırıldı ve otomatik çekim durdu; ödeme kuruluşundaki kayıt silinemedi, gerekirse onlardan silinmesini isteyin." };
  }

  /** E-posta bağlantısı sayfası: firma adı, plan, dönem sonu ve süre seçenekleri. */
  async baglantiOzeti(tenantId: string) {
    const ayar = await this.ayarlar.etkin();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [abonelik, firma] = await Promise.all([
        this.fiyatliAbonelik(tx, tenantId),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
      ]);
      if (!firma) throw new NotFoundException("Firma bulunamadı");
      const planKodu = abonelik?.planKodu ?? "v1";
      return {
        unvan: firma.unvan.trim(),
        planAdi: abonelik?.paketSurumId ? etkinAbonelikPlani(abonelik).ad : fiyatPlani(planKodu)?.ad ?? planKodu,
        donemSonu: abonelik?.donemSonu ?? null,
        acik: Boolean(ayar),
        secenekler: ayar ? ABONELIK_SURELERI.map((a) => bagliAbonelikTutari(abonelik ?? { planKodu }, a)).filter((t) => t !== null) : [],
      };
    });
  }

  private async donemSonu(tenantId: string) {
    return (await this.prisma.tenantIslem(tenantId, (tx) => tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { donemSonu: true } })))?.donemSonu ?? null;
  }

  private async alicilar(tx: Tx, tenantId: string) {
    const [firma, abonelik, yoneticiler, kart] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
      tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { faturaEpostasi: true, planKodu: true, donemSonu: true } }),
      tx.user.findMany({ where: { aktif: true, rol: "yonetici" }, select: { eposta: true }, orderBy: { eposta: "asc" } }),
      tx.abonelikKarti.findUnique({ where: { tenantId }, select: { son4: true, denemeSayisi: true } }),
    ]);
    return {
      unvan: firma?.unvan.trim() ?? "", plan: abonelik?.planKodu ?? "v1", donemSonu: abonelik?.donemSonu ?? null, kart,
      alicilar: firmaAlicilari({ fatura_epostasi: abonelik?.faturaEpostasi ?? null, yonetici_epostalari: yoneticiler.map((y) => y.eposta) }),
    };
  }

  private async posta(alicilar: string[], konu: string, satirlar: string[]) {
    const transport = createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false });
    await transport.sendMail({ from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>", to: alicilar.join(", "), subject: konu, text: satirlar.join("\n") });
  }

  /** Platform olay kaydı + makbuz e-postası (fatura e-postası ve aktif yöneticiler). */
  private async sonrasi(tenantId: string, deneme: Deneme, yeniDonemSonu: Date, askiKalkti: boolean, kartKaydedildi: boolean) {
    if (process.env.DATABASE_URL_PLATFORM) {
      await this.platform.db.mevzuatOlay.create({
        data: { olay: "abonelik_odemesi_alindi", detay: { tenantId, kaynak: "saglayici", saglayici: deneme.saglayici, odemeKaynagi: deneme.kaynak, denemeId: deneme.id, aySayisi: deneme.aySayisi, tutar: Number(deneme.toplam), yeniDonemSonu, askiKalkti, kartKaydedildi } as Prisma.InputJsonValue },
      });
    }
    const { unvan, alicilar } = await this.prisma.tenantIslem(tenantId, (tx) => this.alicilar(tx, tenantId));
    if (!alicilar.length) return;
    await this.posta(alicilar, deneme.kaynak === "otomatik" ? "TekirExtra aboneliğiniz otomatik yenilendi" : "TekirExtra abonelik ödemeniz alındı", [
      "Merhaba,",
      "",
      `${unvan} firmasının TekirExtra abonelik ödemesi alındı${deneme.kaynak === "otomatik" ? " (kayıtlı karttan otomatik yenileme)" : ""}.`,
      "",
      `Süre: ${deneme.aySayisi} ay`,
      `Tutar (KDV hariç): ${tlYaz(deneme.matrah)} TL`,
      `KDV: ${tlYaz(deneme.kdv)} TL`,
      `Toplam: ${tlYaz(deneme.toplam)} TL`,
      `Yeni dönem sonu: ${tarih(yeniDonemSonu)}`,
      ...(askiKalkti ? ["", "Ödeme beklendiği için askıya alınan aboneliğiniz yeniden etkin."] : []),
      ...(kartKaydedildi ? ["", `Kartınız ödeme kuruluşunda kaydedildi; abonelik dönem sonundan ${YENILEME_GUN_ONCE} gün önce otomatik yenilenir. Panelde Ayarlar › Abonelik'ten kapatabilirsiniz.`] : []),
      "",
      "Bu e-posta ödeme makbuzu yerine geçer; faturanız ayrıca gönderilecektir.",
    ]);
  }
}
