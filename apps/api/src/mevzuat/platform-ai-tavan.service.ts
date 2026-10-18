import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { istanbulAyBaslangici } from "../ai/ai-zaman";
import { platformAnahtariMi, platformFiyati, platformVarsayilanTavani } from "../ai/saglayici/ai-butce";
import { PlatformPrismaService } from "./platform-prisma.service";

interface OzetSatiri {
  tenant_id: string;
  unvan: string;
  saglayici: string;
  kendi_anahtari: boolean;
  kiraci_butcesi_usd: Prisma.Decimal | null;
  bu_ay_usd: Prisma.Decimal;
  tahmini_cagri: bigint;
  tavan_usd: Prisma.Decimal | null;
}

const sayi = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/**
 * AI-31: platform anahtarıyla çalışan kiracıların aylık yapay zekâ tavanı.
 * Platform rolü kiracı tablolarını okuyamaz; liste veritabanındaki özet
 * işlevinden gelir (unvan, anahtar türü, bütçe, bu ayki maliyet, tavan).
 */
@Injectable()
export class PlatformAiTavanService {
  constructor(private readonly platform: PlatformPrismaService) {}

  async listele() {
    const ay = istanbulAyBaslangici();
    // created_at saat dilimsiz UTC tutulur; ay başı da UTC olarak verilir.
    const ayUtc = ay.toISOString().slice(0, 23).replace("T", " ");
    const satirlar = await this.platform.db.$queryRaw<OzetSatiri[]>`SELECT * FROM platform_ai_kiraci_ozeti(${ayUtc}::timestamp)`;
    const varsayilanTavanUsd = platformVarsayilanTavani();
    const fiyat = platformFiyati();
    return {
      ayBaslangici: ay.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }),
      platformSaglayicisi: process.env.AI_PROVIDER?.toLowerCase() || null,
      varsayilanTavanUsd,
      fiyat,
      kiracilar: satirlar.map((r) => {
        const platformAnahtari = platformAnahtariMi({ saglayici: r.saglayici, apiKey: r.kendi_anahtari ? "kiracı" : null });
        const ozelTavanUsd = sayi(r.tavan_usd);
        return {
          tenantId: r.tenant_id,
          unvan: r.unvan,
          saglayici: r.saglayici,
          platformAnahtari,
          kiraciButcesiUsd: sayi(r.kiraci_butcesi_usd),
          buAyUsd: Number(r.bu_ay_usd),
          tahminiCagri: Number(r.tahmini_cagri),
          ozelTavanUsd,
          uygulananTavanUsd: platformAnahtari ? (ozelTavanUsd ?? varsayilanTavanUsd) : null,
        };
      }),
    };
  }

  /** `null` kiracıya özel tavanı kaldırır; ortam varsayılanı geçerli olur. */
  async tavanYaz(tenantId: string, aylikTavanUsd: number | null) {
    const guncelleyenId = aktifPlatformBaglam().kullaniciId;
    if (aylikTavanUsd === null) {
      await this.platform.db.platformAiTavani.deleteMany({ where: { tenantId } });
      return { tenantId, ozelTavanUsd: null };
    }
    try {
      await this.platform.db.platformAiTavani.upsert({
        where: { tenantId },
        create: { tenantId, aylikTavanUsd, guncelleyenId },
        update: { aylikTavanUsd, guncelleyenId, guncellendiAt: new Date() },
      });
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2003") throw new NotFoundException("Kiracı bulunamadı");
      throw hata;
    }
    return { tenantId, ozelTavanUsd: aylikTavanUsd };
  }
}
