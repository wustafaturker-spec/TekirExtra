import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { IyzicoAdapter } from "../pos/iyzico.adapter";
import { PaytrAdapter } from "../pos/paytr.adapter";
import { AbonelikFaturaService } from "./abonelik-fatura.service";
import { IYZICO_ADRESI, SAGLAYICI_ADI } from "./abonelik-saglayici";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";

interface Hazirlik {
  tenant_id: string; unvan: string; tutar: Prisma.Decimal; iade_toplami: Prisma.Decimal; kaynak: string; saglayici: string | null;
  ay_sayisi: number; saglayici_odeme_id: string | null; ortam: string | null; tekrar: boolean;
}
interface KayitSonucu { iade_id: string; tam_iade: boolean; onceki_donem_sonu: Date | null; yeni_donem_sonu: Date | null; tekrar: boolean }

export interface IadeGirdisi { tutar: string; neden: string; saglayiciyaGonder: boolean; islemAnahtari: string }

const kisalt = (h: unknown) => (h instanceof Error ? h.message : String(h)).slice(0, 500);
const tl = (d: Prisma.Decimal) => Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gun = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });

/** Platform işlevlerinin hata kodlarını HTTP hatasına çevirir. */
function islevHatasi(h: unknown): never {
  const m = kisalt(h);
  if (m.includes("iade_suruyor")) throw new ConflictException("Bu ödeme için sürmekte olan bir iade var; birkaç dakika sonra tekrar deneyin");
  if (m.includes("fazla_iade")) throw new BadRequestException("İade tutarı ödemenin iade edilebilir kalanını aşıyor");
  if (m.includes("odeme_yok")) throw new NotFoundException("Abonelik ödemesi bulunamadı");
  if (m.includes("neden_gerekli")) throw new BadRequestException("İade nedeni gerekli");
  if (m.includes("gecersiz_tutar")) throw new BadRequestException("İade tutarı sıfırdan büyük olmalı");
  throw h;
}

/**
 * PLT-42…46: abonelik ödemesinin platformdan iadesi. Sıra: kilit → sağlayıcıya
 * iade (kartla ödemede) → iade kaydı, dönem ve olay tek transaction'da →
 * faturalayan firmanın kayıtları (başarısızsa worker yeniden dener).
 */
@Injectable()
export class PlatformAbonelikIadeService {
  private readonly logger = new Logger(PlatformAbonelikIadeService.name);
  iyzico = new IyzicoAdapter();
  paytr = new PaytrAdapter();

  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly saglayicilar: SaglayiciAyarlariService,
    private readonly fatura: AbonelikFaturaService,
  ) {}

  async iadeEt(odemeId: string, g: IadeGirdisi) {
    const { kullaniciId, eposta } = aktifPlatformBaglam();
    const db = this.platform.db;
    const [o] = await db.$queryRaw<Hazirlik[]>`SELECT * FROM platform_abonelik_iade_hazirla(${odemeId}::uuid, ${g.islemAnahtari})`.catch(islevHatasi);
    if (!o) throw new NotFoundException("Abonelik ödemesi bulunamadı");
    if (o.tekrar) return { mesaj: "Bu iade daha önce kaydedildi.", tekrar: true };

    const tutar = new Prisma.Decimal(g.tutar);
    const kilidiAc = () => db.$queryRaw`SELECT platform_abonelik_iade_kilidi_ac(${odemeId}::uuid)`.catch((h) => this.logger.warn(JSON.stringify({ event: "subscription_refund_unlock_failed", odemeId, error: kisalt(h) })));
    const gonder = o.kaynak === "saglayici" && g.saglayiciyaGonder;
    let ref: string | null = null;
    try {
      const kalan = new Prisma.Decimal(o.tutar).sub(o.iade_toplami);
      if (tutar.gt(kalan)) throw new BadRequestException(`İade tutarı iade edilebilir kalanı (${tl(kalan)} TL) aşıyor`);
      if (gonder) ref = await this.saglayiciyaIadeEt(o, tutar, g.islemAnahtari);
    } catch (h) {
      await kilidiAc();
      throw h;
    }

    let sonuc: KayitSonucu;
    try {
      sonuc = await db.$transaction(async (tx) => {
        const [r] = await tx.$queryRaw<KayitSonucu[]>`
          SELECT * FROM platform_abonelik_iade_kaydet(${odemeId}::uuid, ${tutar.toFixed(2)}::numeric, ${g.neden}, ${kullaniciId}::uuid, ${eposta}, ${Boolean(ref)}, ${ref}, ${g.islemAnahtari})`;
        if (!r.tekrar) {
          await tx.mevzuatOlay.create({
            data: { kullaniciId, olay: "abonelik_odemesi_iade_edildi", detay: { odemeId, tenantId: o.tenant_id, tutar: tutar.toFixed(2), tamIade: r.tam_iade, saglayiciyaGonderildi: Boolean(ref), ref, neden: g.neden } as Prisma.InputJsonValue },
          });
        }
        return r;
      });
    } catch (h) {
      if (!ref) {
        await kilidiAc();
        islevHatasi(h);
      }
      // Para sağlayıcıda iade edildi; kilit bırakılmaz ki aynı iade tekrar gönderilmesin.
      this.logger.error(JSON.stringify({ event: "subscription_refund_unrecorded", odemeId, tutar: tutar.toFixed(2), ref, error: kisalt(h) }));
      throw new ConflictException(`İade sağlayıcıda yapıldı (ref ${ref}) ama kayıt yazılamadı: ${kisalt(h)}. Sağlayıcıya yeniden göndermeyin; sorun giderilince "sağlayıcıya gönderme" seçeneğiyle aynı tutarı kaydedin.`);
    }
    if (sonuc.tekrar) return { mesaj: "Bu iade daha önce kaydedildi.", tekrar: true };

    // PLT-44: faturalayan firmanın kayıtları; başarısızsa worker yeniden dener.
    await this.fatura.iadeyiIsle(sonuc.iade_id, o.tenant_id).catch((h) => this.logger.warn(JSON.stringify({ event: "subscription_refund_billing_deferred", iadeId: sonuc.iade_id, error: kisalt(h) })));
    const saglayiciAdi = o.saglayici ? SAGLAYICI_ADI[o.saglayici as keyof typeof SAGLAYICI_ADI] ?? o.saglayici : null;
    return {
      mesaj: [
        `${tl(tutar)} TL ${sonuc.tam_iade ? "tam iade" : "kısmi iade"} kaydedildi`,
        ref ? `; para ${saglayiciAdi} üzerinden iade edildi (ref ${ref})` : o.kaynak === "saglayici" ? "; sağlayıcıya gönderilmedi" : "; havale iadesini bankadan yapın",
        sonuc.yeni_donem_sonu && sonuc.onceki_donem_sonu ? `. Dönem sonu ${gun(sonuc.onceki_donem_sonu)} → ${gun(sonuc.yeni_donem_sonu)}.` : ".",
      ].join(""),
      tamIade: sonuc.tam_iade,
      yeniDonemSonu: sonuc.yeni_donem_sonu,
      ref,
    };
  }

  /** PLT-42: parayı ödemenin alındığı sağlayıcıdan iade eder; ref döner. */
  private async saglayiciyaIadeEt(o: Hazirlik, tutar: Prisma.Decimal, anahtar: string): Promise<string> {
    const etkin = await this.saglayicilar.etkin();
    const adi = SAGLAYICI_ADI[o.saglayici as keyof typeof SAGLAYICI_ADI] ?? o.saglayici ?? "sağlayıcı";
    if (!o.saglayici_odeme_id || !etkin || etkin.saglayici !== o.saglayici || (o.ortam && etkin.ortam !== o.ortam)) {
      throw new BadRequestException(`Ödeme ${adi}${o.ortam ? ` (${o.ortam === "canli" ? "canlı" : "test"} ortam)` : ""} ile alınmış; bu sağlayıcı/ortam şu an etkin değil. Parayı ${adi} panelinden iade edip "sağlayıcıya gönderme" seçeneğiyle kaydedin.`);
    }
    try {
      if (etkin.saglayici === "iyzico") {
        const config = { apiKey: etkin.config.apiKey, secretKey: etkin.config.secretKey, baseUrl: IYZICO_ADRESI[etkin.ortam] };
        const ayrinti = await this.iyzico.odemeAyrintisi(config, o.saglayici_odeme_id);
        const islemNo = ayrinti.odemeIslemNolari[0];
        if (!islemNo) throw new Error("ödemenin işlem numarası okunamadı");
        return (await this.iyzico.iadeEt(config, { odemeIslemNo: islemNo, tutar: tutar.toFixed(2), dovizCinsi: "TRY", conversationId: anahtar })).ref;
      }
      const config = { merchantId: etkin.config.magazaId, merchantKey: etkin.config.merchantKey, merchantSalt: etkin.config.merchantSalt };
      return (await this.paytr.iadeEt(config, { merchantOid: o.saglayici_odeme_id, tutar: tutar.toFixed(2), referans: anahtar.replace(/[^A-Za-z0-9]/g, "").slice(0, 64) })).ref;
    } catch (h) {
      throw new BadGatewayException(`${adi} iadeyi gerçekleştirmedi: ${kisalt(h)}`);
    }
  }
}
