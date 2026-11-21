import { BadRequestException, Injectable } from "@nestjs/common";
import { AI_OZELLIK_ADLARI, AI_OZELLIK_ANAHTARLARI, aiOzellikAnahtariMi } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { platformOnbelleginiSifirla } from "../ai/ozellik-kapisi";
import { PlatformPrismaService } from "./platform-prisma.service";

/**
 * AI-109: platform geneli yapay zekâ acil durdurması. Değişiklik ve olay kaydı birlikte
 * yazılır (eski → yeni, neden). Bu süreçte hemen, öteki süreçlerde en geç önbellek
 * süresinde (15 sn) etkili olur; bekleyen onay ve kuyruktaki iş silinmez.
 */
@Injectable()
export class PlatformAiOzellikService {
  constructor(private readonly platform: PlatformPrismaService) {}

  async listele() {
    const satirlar = await this.platform.db.platformAiOzellikDurumu.findMany({ include: { guncelleyen: { select: { adSoyad: true } } } });
    const harita = new Map(satirlar.map((s) => [s.ozellik, s]));
    return {
      ozellikler: AI_OZELLIK_ANAHTARLARI.map((anahtar) => {
        const s = harita.get(anahtar);
        return {
          anahtar, ...AI_OZELLIK_ADLARI[anahtar],
          durduruldu: s?.durduruldu ?? false, neden: s?.neden ?? null,
          guncellendiAt: s?.guncellendiAt.toISOString() ?? null, guncelleyen: s?.guncelleyen?.adSoyad ?? null,
        };
      }),
    };
  }

  async yaz(ozellik: string, durduruldu: boolean, neden: string | null) {
    if (!aiOzellikAnahtariMi(ozellik)) throw new BadRequestException("Tanınmayan yapay zekâ özelliği.");
    if (durduruldu && !neden) throw new BadRequestException("Durdurma nedeni yazın.");
    const guncelleyenId = aktifPlatformBaglam().kullaniciId;
    const db = this.platform.db;
    const eski = await db.platformAiOzellikDurumu.findUnique({ where: { ozellik }, select: { durduruldu: true, neden: true } });
    await db.$transaction([
      db.platformAiOzellikDurumu.upsert({
        where: { ozellik },
        create: { ozellik, durduruldu, neden, guncelleyenId },
        update: { durduruldu, neden, guncelleyenId, guncellendiAt: new Date() },
      }),
      db.mevzuatOlay.create({
        data: { kullaniciId: guncelleyenId, olay: durduruldu ? "ai_ozellik_durduruldu" : "ai_ozellik_acildi", detay: { ozellik, eski: eski ? { durduruldu: eski.durduruldu, neden: eski.neden } : null, yeni: { durduruldu, neden } } },
      }),
    ]);
    platformOnbelleginiSifirla();
    return this.listele();
  }
}
