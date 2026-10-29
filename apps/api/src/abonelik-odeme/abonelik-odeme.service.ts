import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AbonelikDurumu, Prisma } from "@prisma/client";
import { createTransport } from "nodemailer";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { PrismaService } from "../core/prisma.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { firmaAlicilari } from "../mevzuat/tahsilat-hatirlatma.service";
import { ABONELIK_SURELERI, abonelikTutari, fiyatPlani, tlYaz, type AbonelikSuresi } from "./abonelik-tutari";
import { SAGLAYICI_ADI, saglayiciKur, type AbonelikOdemeSaglayicisi, type EtkinSaglayici, type OdemeAlicisi } from "./abonelik-saglayici";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";

export type OdemeKaynagi = "panel" | "eposta" | "otomatik";

const tarih = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });

/** "Ayşe Nur Yılmaz" → ad "Ayşe Nur", soyad "Yılmaz"; tek kelimede soyad ad olur (iyzico ikisini de ister). */
export function adSoyadAyir(adSoyad: string): { ad: string; soyad: string } {
  const parca = adSoyad.trim().split(/\s+/).filter(Boolean);
  if (parca.length < 2) return { ad: parca[0] ?? "TekirExtra", soyad: parca[0] ?? "Müşterisi" };
  return { ad: parca.slice(0, -1).join(" "), soyad: parca[parca.length - 1] };
}

/**
 * PLT-12/13: abonelik bedelinin ödeme sağlayıcısıyla tahsili. Ödeme her zaman
 * sağlayıcının 3D sayfasında yapılır; sonuç sağlayıcıdan ikinci kez sorgulanır
 * ve tek bir işlemde dönemi uzatır. Kart verisi TekirExtra'ya gelmez.
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

  /** Panel: süre seçenekleri ve ödeme geçmişi. Etkin sağlayıcı yoksa ya da plan fiyatsızsa ödeme düğmesi çıkmaz. */
  async durum(tenantId: string) {
    const ayar = await this.ayarlar.etkin();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const abonelik = await tx.tenantAbonelik.findUnique({ where: { tenantId } });
      const planKodu = abonelik?.planKodu ?? "v1";
      const secenekler = ABONELIK_SURELERI.map((a) => abonelikTutari(planKodu, a)).filter((t) => t !== null);
      const [odemeler, basarisiz] = await Promise.all([
        tx.abonelikOdemesi.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, aySayisi: true, tutar: true, matrah: true, kdv: true, kaynak: true, saglayici: true, yeniDonemSonu: true } }),
        tx.abonelikOdemeDenemesi.findMany({ where: { durum: "basarisiz" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, createdAt: true, aySayisi: true, toplam: true, hataMesaji: true, kaynak: true } }),
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
        odemeler,
        basarisizDenemeler: basarisiz,
      };
    });
  }

  /**
   * Ödeme girişimini açar ve sağlayıcının ödeme sayfasının adresini döner.
   * `kullaniciId` panelde ödeyen yöneticidir; e-posta bağlantısında boştur
   * (alıcı bilgisi ilk aktif yöneticiden alınır).
   */
  async baslat(tenantId: string, aySayisi: AbonelikSuresi, kaynak: OdemeKaynagi, kullaniciId: string | null, ip?: string) {
    const ayar = await this.ayarlar.etkin();
    if (!ayar) throw new BadRequestException("Çevrim içi ödeme açık değil; ödeme için TekirExtra ekibiyle iletişime geçin");
    const { deneme, alici, firmaUnvani, aciklama } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const [abonelik, firma] = await Promise.all([
        tx.tenantAbonelik.findUnique({ where: { tenantId } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true, vkn: true, adres: true, il: true, telefon: true } }),
      ]);
      if (!firma) throw new NotFoundException("Firma bulunamadı");
      const tutar = abonelikTutari(abonelik?.planKodu ?? "v1", aySayisi);
      if (!tutar) throw new BadRequestException("Bu plan için çevrim içi ödeme yok; TekirExtra ekibiyle iletişime geçin");
      const kisi = await tx.user.findFirst({
        where: kullaniciId ? { id: kullaniciId } : { aktif: true, rol: "yonetici" },
        orderBy: { createdAt: "asc" },
        select: { adSoyad: true, eposta: true },
      });
      if (!kisi) throw new ForbiddenException("Firmada aktif yönetici yok");
      const deneme = await tx.abonelikOdemeDenemesi.create({
        data: {
          tenantId, saglayici: ayar.saglayici, ortam: ayar.ortam, kaynak, planKodu: tutar.planKodu, aySayisi,
          matrah: tutar.matrah, kdv: tutar.kdv, toplam: tutar.toplam, baslatanUserId: kullaniciId,
        },
      });
      const kimlik = /^\d{11}$/.test(firma.vkn) ? firma.vkn : "11111111111"; // iyzico TCKN biçimi ister; VKN'li firmada yer tutucu
      const alici: OdemeAlicisi = {
        ...adSoyadAyir(kisi.adSoyad), eposta: abonelik?.faturaEpostasi || kisi.eposta, telefon: firma.telefon, kimlikNo: kimlik,
        adres: firma.adres?.trim() || "Türkiye", il: firma.il?.trim() || "İstanbul", ip,
      };
      return { deneme, alici, firmaUnvani: (abonelik?.faturalandirmaUnvani || firma.unvan).trim(), aciklama: `TekirExtra ${tutar.planAdi} abonelik (${aySayisi} ay)` };
    });

    const kok = process.env.PUBLIC_API_URL ?? "http://localhost:3001";
    try {
      const sonuc = await this.saglayiciUret(ayar).odemeBaslat({
        denemeId: deneme.id, aciklama, toplam: Number(deneme.toplam), firmaUnvani, alici,
        callbackUrl: `${kok}/api/v1/abonelik-odeme/${ayar.saglayici}/callback/${tenantId}/${deneme.id}`,
      });
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.abonelikOdemeDenemesi.update({ where: { id: deneme.id }, data: { saglayiciToken: sonuc.token, odemeSayfasiUrl: sonuc.odemeSayfasiUrl } }),
      );
      return { denemeId: deneme.id, odemeSayfasiUrl: sonuc.odemeSayfasiUrl };
    } catch (hata) {
      const mesaj = (hata instanceof Error ? hata.message : String(hata)).slice(0, 500);
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.abonelikOdemeDenemesi.update({ where: { id: deneme.id }, data: { durum: "basarisiz", hataMesaji: mesaj, sonuclandiAt: new Date() } }),
      );
      this.logger.error(JSON.stringify({ event: "billing_payment_start_failed", tenantId, denemeId: deneme.id, error: mesaj }));
      throw new BadGatewayException(`${SAGLAYICI_ADI[ayar.saglayici]} ödeme sayfası açılamadı; biraz sonra yeniden deneyin`);
    }
  }

  /**
   * Sağlayıcının yönlendirmesi: token girişimin token'ıyla eşleşmeli, sonuç
   * sağlayıcıdan sorgulanır, tutar ve döviz girişimle aynı olmalıdır.
   * Tekrarlanan bildirim ödemeyi ikinci kez saymaz.
   */
  async callback(tenantId: string, denemeId: string, token: string) {
    const deneme = await this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikOdemeDenemesi.findUnique({ where: { id: denemeId } }));
    if (!deneme || !deneme.saglayiciToken || deneme.saglayiciToken !== token) throw new BadRequestException("Geçersiz ödeme bildirimi");
    if (deneme.durum === "odendi") return { tekrar: true, yeniDonemSonu: await this.donemSonu(tenantId) };
    const ayar = await this.ayarlar.etkin();
    // Girişim açıldıktan sonra sağlayıcı değiştiyse sonuç yine girişimin sağlayıcısından sorgulanmalı.
    if (!ayar || ayar.saglayici !== deneme.saglayici) throw new BadRequestException("Ödemenin sağlayıcısı artık etkin değil; TekirExtra ekibiyle iletişime geçin");
    const sonuc = await this.saglayiciUret(ayar).odemeSonucu(token);
    if (!sonuc.basarili || !new Prisma.Decimal(sonuc.tutar).equals(deneme.toplam) || sonuc.dovizCinsi !== "TRY" || !sonuc.odemeId) {
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.abonelikOdemeDenemesi.updateMany({
          where: { id: deneme.id, durum: "baslatildi" },
          data: { durum: "basarisiz", hataMesaji: sonuc.basarili ? "Sağlayıcının bildirdiği tutar ya da döviz girişimle uyuşmuyor" : "Ödeme sağlayıcıda tamamlanmadı", sonuclandiAt: new Date() },
        }),
      );
      throw new BadRequestException("Ödeme doğrulanamadı");
    }
    return this.odemeyiKaydet(tenantId, deneme.id, sonuc.odemeId);
  }

  /**
   * Tek işlemde: girişim ödendi, dönem eski dönem sonundan uzar (dönem kaymaz),
   * abonelik geçmişine yazılır; ödeme nedeniyle askıdaki firma açılır.
   */
  async odemeyiKaydet(tenantId: string, denemeId: string, odemeId: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM abonelik_odeme_denemeleri WHERE id = ${denemeId}::uuid FOR UPDATE`;
      const deneme = await tx.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: denemeId } });
      if (deneme.durum === "odendi") return { tekrar: true as const };
      await tx.tenantAbonelik.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
      const [eski] = await tx.$queryRaw<{ plan_kodu: string; durum: string; aski_nedeni: string | null; donem_sonu: Date | null }[]>`
        SELECT plan_kodu, durum::text AS durum, aski_nedeni, donem_sonu FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const askiKalkar = eski.durum === "askida" && eski.aski_nedeni === "odeme";
      const [yeni] = await tx.$queryRaw<{ donem_sonu: Date }[]>`
        UPDATE tenant_abonelikleri SET
          donem_baslangici = COALESCE(donem_baslangici, now()),
          donem_sonu = COALESCE(donem_sonu, now()) + make_interval(months => ${deneme.aySayisi}::int),
          durum = CASE WHEN ${askiKalkar} THEN 'aktif'::"AbonelikDurumu" ELSE durum END,
          aski_nedeni = CASE WHEN ${askiKalkar} THEN NULL ELSE aski_nedeni END,
          updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid
        RETURNING donem_sonu`;
      const saglayiciAdi = SAGLAYICI_ADI[deneme.saglayici as keyof typeof SAGLAYICI_ADI] ?? deneme.saglayici;
      const odeme = await tx.abonelikOdemesi.create({
        data: {
          tenantId, aySayisi: deneme.aySayisi, tutar: deneme.toplam, matrah: deneme.matrah, kdv: deneme.kdv,
          kaynak: "saglayici", saglayici: deneme.saglayici, not: `${saglayiciAdi} ödeme no ${odemeId}`,
          oncekiDonemSonu: eski.donem_sonu, yeniDonemSonu: yeni.donem_sonu,
        },
      });
      await tx.abonelikOdemeDenemesi.update({ where: { id: denemeId }, data: { durum: "odendi", saglayiciOdemeId: odemeId, abonelikOdemesiId: odeme.id, sonuclandiAt: new Date(), hataMesaji: null } });
      await tx.abonelikDegisikligi.create({
        data: {
          tenantId, oncekiPlan: eski.plan_kodu, yeniPlan: eski.plan_kodu, oncekiDurum: eski.durum as AbonelikDurumu, yeniDurum: (askiKalkar ? "aktif" : eski.durum) as AbonelikDurumu,
          neden: `Ödeme alındı (${saglayiciAdi}): ${deneme.aySayisi} ay, ${tlYaz(deneme.toplam)} TL (KDV dahil); dönem sonu ${tarih(yeni.donem_sonu)}${askiKalkar ? "; ödeme nedeniyle askı kalktı" : ""}`,
        },
      });
      return { tekrar: false as const, deneme, yeniDonemSonu: yeni.donem_sonu, askiKalkti: askiKalkar };
    });
    if (sonuc.tekrar) return { tekrar: true, yeniDonemSonu: await this.donemSonu(tenantId) };
    this.erisim.unut(tenantId);
    await this.sonrasi(tenantId, sonuc.deneme, sonuc.yeniDonemSonu, sonuc.askiKalkti).catch((hata) =>
      this.logger.error(JSON.stringify({ event: "billing_payment_after_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) })),
    );
    return { tekrar: false, yeniDonemSonu: sonuc.yeniDonemSonu, askiKalkti: sonuc.askiKalkti };
  }

  /** E-posta bağlantısı sayfası: firma adı, plan, dönem sonu ve süre seçenekleri. */
  async baglantiOzeti(tenantId: string) {
    const ayar = await this.ayarlar.etkin();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [abonelik, firma] = await Promise.all([
        tx.tenantAbonelik.findUnique({ where: { tenantId } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
      ]);
      if (!firma) throw new NotFoundException("Firma bulunamadı");
      const planKodu = abonelik?.planKodu ?? "v1";
      return {
        unvan: firma.unvan.trim(),
        planAdi: fiyatPlani(planKodu)?.ad ?? planKodu,
        donemSonu: abonelik?.donemSonu ?? null,
        acik: Boolean(ayar),
        secenekler: ayar ? ABONELIK_SURELERI.map((a) => abonelikTutari(planKodu, a)).filter((t) => t !== null) : [],
      };
    });
  }

  private async donemSonu(tenantId: string) {
    return (await this.prisma.tenantIslem(tenantId, (tx) => tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { donemSonu: true } })))?.donemSonu ?? null;
  }

  /** Platform olay kaydı + makbuz e-postası (fatura e-postası ve aktif yöneticiler). */
  private async sonrasi(tenantId: string, deneme: { id: string; saglayici: string; aySayisi: number; matrah: Prisma.Decimal; kdv: Prisma.Decimal; toplam: Prisma.Decimal; kaynak: string }, yeniDonemSonu: Date, askiKalkti: boolean) {
    if (process.env.DATABASE_URL_PLATFORM) {
      await this.platform.db.mevzuatOlay.create({
        data: { olay: "abonelik_odemesi_alindi", detay: { tenantId, kaynak: "saglayici", saglayici: deneme.saglayici, odemeKaynagi: deneme.kaynak, denemeId: deneme.id, aySayisi: deneme.aySayisi, tutar: Number(deneme.toplam), yeniDonemSonu, askiKalkti } as Prisma.InputJsonValue },
      });
    }
    const { unvan, alicilar } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const [firma, abonelik, yoneticiler] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }),
        tx.tenantAbonelik.findUnique({ where: { tenantId }, select: { faturaEpostasi: true } }),
        tx.user.findMany({ where: { aktif: true, rol: "yonetici" }, select: { eposta: true }, orderBy: { eposta: "asc" } }),
      ]);
      return { unvan: firma?.unvan.trim() ?? "", alicilar: firmaAlicilari({ fatura_epostasi: abonelik?.faturaEpostasi ?? null, yonetici_epostalari: yoneticiler.map((y) => y.eposta) }) };
    });
    if (!alicilar.length) return;
    const transport = createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false });
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>",
      to: alicilar.join(", "),
      subject: "TekirExtra abonelik ödemeniz alındı",
      text: [
        "Merhaba,",
        "",
        `${unvan} firmasının TekirExtra abonelik ödemesi alındı.`,
        "",
        `Süre: ${deneme.aySayisi} ay`,
        `Tutar (KDV hariç): ${tlYaz(deneme.matrah)} TL`,
        `KDV: ${tlYaz(deneme.kdv)} TL`,
        `Toplam: ${tlYaz(deneme.toplam)} TL`,
        `Yeni dönem sonu: ${tarih(yeniDonemSonu)}`,
        ...(askiKalkti ? ["", "Ödeme beklendiği için askıya alınan aboneliğiniz yeniden etkin."] : []),
        "",
        "Bu e-posta ödeme makbuzu yerine geçer; faturanız ayrıca gönderilecektir.",
      ].join("\n"),
    });
  }
}
