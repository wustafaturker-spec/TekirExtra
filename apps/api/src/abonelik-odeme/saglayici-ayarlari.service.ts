import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { coz, sifrele } from "../core/kripto";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { BAGLI_SAGLAYICILAR, SAGLAYICI_ADI, SAGLAYICI_ALANLARI, type AbonelikSaglayiciKodu, type EtkinSaglayici, type SaglayiciOrtami } from "./abonelik-saglayici";

export interface SaglayiciKaydi {
  ortam: SaglayiciOrtami;
  etkin: boolean;
  alanlar: Record<string, string | undefined>;
}

/**
 * PLT-11: abonelik ödeme sağlayıcısının erişim bilgileri. Tablo yalnız platform
 * bağlantısına açıktır; kiracı tarafındaki ödeme akışı da bilgileri bu
 * bağlantıdan okur (uygulama rolü gizli anahtarlara erişemez).
 */
@Injectable()
export class SaglayiciAyarlariService {
  private readonly logger = new Logger(SaglayiciAyarlariService.name);

  constructor(private readonly platform: PlatformPrismaService) {}

  /** Platform ekranı: gizli alanların yalnız dolu olup olmadığı döner. */
  async listele() {
    const kayitlar = await this.platform.db.abonelikSaglayiciAyari.findMany();
    return (Object.keys(SAGLAYICI_ALANLARI) as AbonelikSaglayiciKodu[]).map((kod) => {
      const k = kayitlar.find((x) => x.saglayici === kod);
      const config = k ? (JSON.parse(coz(k.sifreliConfig)) as Record<string, string>) : {};
      return {
        saglayici: kod,
        ad: SAGLAYICI_ADI[kod],
        bagli: BAGLI_SAGLAYICILAR.includes(kod),
        ortam: (k?.ortam ?? "test") as SaglayiciOrtami,
        etkin: k?.etkin ?? false,
        guncellendi: k?.updatedAt ?? null,
        // PayTR sonucu mağaza panelinde tanımlı tek adrese bildirir.
        bildirimAdresi: kod === "paytr" ? `${(process.env.PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "")}/api/v1/abonelik-odeme/paytr/bildirim` : null,
        alanlar: SAGLAYICI_ALANLARI[kod].map((a) => ({ ...a, dolu: Boolean(config[a.anahtar]), deger: a.gizli ? undefined : config[a.anahtar] ?? "" })),
      };
    });
  }

  async kaydet(kod: AbonelikSaglayiciKodu, girdi: SaglayiciKaydi) {
    const { kullaniciId } = aktifPlatformBaglam();
    const db = this.platform.db;
    const mevcut = await db.abonelikSaglayiciAyari.findUnique({ where: { saglayici: kod } });
    const eski = mevcut ? (JSON.parse(coz(mevcut.sifreliConfig)) as Record<string, string>) : {};
    const config: Record<string, string> = {};
    for (const alan of SAGLAYICI_ALANLARI[kod]) {
      const yeni = girdi.alanlar[alan.anahtar]?.trim();
      // Gizli alan boş gelirse kayıtlı değer korunur; gizli olmayanı silen bilerek siler.
      const deger = yeni || (alan.gizli ? eski[alan.anahtar] : "");
      if (deger) config[alan.anahtar] = deger;
    }
    if (girdi.etkin) {
      if (!BAGLI_SAGLAYICILAR.includes(kod)) throw new BadRequestException(`${SAGLAYICI_ADI[kod]} abonelik tahsilatı henüz bağlı değil; bilgileri kaydedebilir ama etkinleştiremezsiniz`);
      const eksik = SAGLAYICI_ALANLARI[kod].filter((a) => !config[a.anahtar]).map((a) => a.etiket);
      if (eksik.length) throw new BadRequestException(`Etkinleştirmek için eksik alanlar: ${eksik.join(", ")}`);
    }
    const veri = { ortam: girdi.ortam, etkin: girdi.etkin, sifreliConfig: sifrele(JSON.stringify(config)), guncelleyenId: kullaniciId };
    await db.$transaction([
      // Aynı anda tek sağlayıcı etkin (kısmi benzersiz indeks de korur).
      ...(girdi.etkin ? [db.abonelikSaglayiciAyari.updateMany({ where: { etkin: true, saglayici: { not: kod } }, data: { etkin: false } })] : []),
      db.abonelikSaglayiciAyari.upsert({ where: { saglayici: kod }, create: { saglayici: kod, ...veri }, update: veri }),
    ]);
    await db.mevzuatOlay.create({
      data: {
        kullaniciId,
        olay: "abonelik_saglayicisi_guncellendi",
        detay: { saglayici: kod, ortam: girdi.ortam, etkin: girdi.etkin, degisenAlanlar: Object.keys(girdi.alanlar).filter((a) => girdi.alanlar[a]?.trim()) } as Prisma.InputJsonValue,
      },
    });
    return { mesaj: girdi.etkin ? `${SAGLAYICI_ADI[kod]} etkin; firmalar abonelik ödemesini bununla yapar.` : `${SAGLAYICI_ADI[kod]} bilgileri kaydedildi.` };
  }

  /**
   * Kiracı akışı ve worker için: etkin sağlayıcı yoksa (ya da platform
   * bağlantısı tanımlı değilse) null — o zaman PLT-09 elle tahsilat sürer.
   */
  async etkin(): Promise<EtkinSaglayici | null> {
    if (!process.env.DATABASE_URL_PLATFORM) return null;
    try {
      const k = await this.platform.db.abonelikSaglayiciAyari.findFirst({ where: { etkin: true } });
      if (!k || !BAGLI_SAGLAYICILAR.includes(k.saglayici as AbonelikSaglayiciKodu)) return null;
      return { saglayici: k.saglayici as AbonelikSaglayiciKodu, ortam: k.ortam as SaglayiciOrtami, config: JSON.parse(coz(k.sifreliConfig)) };
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "billing_provider_read_failed", error: hata instanceof Error ? hata.message : String(hata) }));
      return null;
    }
  }
}
