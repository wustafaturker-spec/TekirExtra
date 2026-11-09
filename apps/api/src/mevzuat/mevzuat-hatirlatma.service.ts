import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { bugunTR, DONEMSEL_DEGERLER, HATIRLATMA_GUNLERI, VERGI_TAKVIMI_TURU, vergiTakvimBeklenenAnahtarlar, vergiTakvimEksikleri, yayinTakvimi, type TakvimSatiri } from "@tekirextra/shared";
import { createTransport } from "nodemailer";
import { PlatformPrismaService } from "./platform-prisma.service";
import { nabizla } from "../core/nabiz/nabiz";

const ALTI_SAAT_MS = 6 * 60 * 60 * 1000;

/**
 * MVZ-17: dönemsel değerin sıradaki dönem kaydı yayınlanmamışsa platform
 * ekibine e-posta. Eşikler 30/15/7 gün kala ve dönem başladığında; her eşik
 * bir kez gider (`mevzuat_olaylari`'na "hatirlatma" yazılır). Yalnız worker'da
 * ve platform bağlantısı tanımlıysa çalışır; gönderim sistem SMTP'siyledir
 * (kiracının kendi SMTP ayarı değil).
 */
export function hatirlatmaEsigi(s: TakvimSatiri): number | null {
  if (s.kayitVar) return null;
  if (s.kalanGun <= 0) return 0;
  const esikler = HATIRLATMA_GUNLERI.filter((g) => s.kalanGun <= g);
  return esikler.length ? Math.min(...esikler) : null;
}

export const hatirlatmaAnahtari = (s: TakvimSatiri, esik: number) => `${s.tur}/${s.anahtar}/${s.donem}/${esik}`;

@Injectable()
export class MevzuatHatirlatmaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MevzuatHatirlatmaService.name);
  private zamanlayici?: NodeJS.Timeout;

  constructor(private readonly platform: PlatformPrismaService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    setImmediate(() => void nabizla("mevzuat-hatirlatma", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("mevzuat-hatirlatma", () => this.calistir(), ALTI_SAAT_MS), ALTI_SAAT_MS);
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  async calistir(bugun = bugunTR()): Promise<number> {
    try {
      const db = this.platform.db;
      const kayitlar = await db.mevzuatKayit.findMany({ where: { OR: DONEMSEL_DEGERLER.map((d) => ({ tur: d.tur, anahtar: d.anahtar })) }, select: { tur: true, anahtar: true, yururlukBaslangic: true } });
      // VTK-07: yaklaşan vergi dönemlerinin tarihi yayınlanmamışsa aynı e-postayla uyarılır.
      const vergi = await db.mevzuatKayit.findMany({ where: { tur: VERGI_TAKVIMI_TURU, anahtar: { in: vergiTakvimBeklenenAnahtarlar(bugun) }, yururlukBitis: null }, select: { anahtar: true } });
      const takvim = [...yayinTakvimi(kayitlar.map((k) => ({ ...k, yururlukBaslangic: k.yururlukBaslangic.toISOString().slice(0, 10) })), bugun), ...vergiTakvimEksikleri(vergi.map((k) => k.anahtar), bugun)];
      const gonderilecek = takvim.flatMap((s) => { const esik = hatirlatmaEsigi(s); return esik === null ? [] : [{ s, esik, anahtar: hatirlatmaAnahtari(s, esik) }]; });
      if (!gonderilecek.length) return 0;
      const gonderilmis = new Set((await db.mevzuatOlay.findMany({ where: { olay: "hatirlatma" }, select: { detay: true } }))
        .map((o) => (o.detay as { anahtar?: string } | null)?.anahtar).filter(Boolean));
      const yeni = gonderilecek.filter((g) => !gonderilmis.has(g.anahtar));
      if (!yeni.length) return 0;
      const alicilar = (await db.platformKullanici.findMany({ where: { aktif: true }, select: { eposta: true } })).map((k) => k.eposta);
      if (!alicilar.length) { this.logger.warn("Mevzuat hatırlatması: aktif platform kullanıcısı yok"); return 0; }
      const satir = (g: (typeof yeni)[number]) => g.esik === 0
        ? `• ${g.s.ad} — ${g.s.donem} dönemi ${g.s.baslangic} tarihinde başladı, kayıt YOK; kiracılarda ${g.s.etki}.`
        : `• ${g.s.ad} — ${g.s.donem} dönemi ${g.s.baslangic} tarihinde başlıyor (${g.s.kalanGun} gün); kayıt henüz yayınlanmadı.`;
      const transport = createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false });
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>",
        to: alicilar.join(", "),
        subject: yeni.some((g) => g.esik === 0) ? "Mevzuat Merkezi: dönemi başlamış değer yayınlanmadı" : "Mevzuat Merkezi: yaklaşan dönem değerleri",
        text: `Aşağıdaki dönemsel değerlerin yeni dönem kaydı Mevzuat Merkezi'nde yayınlanmadı:\n\n${yeni.map(satir).join("\n")}\n\nPlatform panelinden (Değişiklikler) dayanağıyla hazırlayıp dört göz ilkesiyle yayınlayın.`,
      });
      await db.mevzuatOlay.createMany({ data: yeni.map((g) => ({ olay: "hatirlatma", detay: { anahtar: g.anahtar, kalanGun: g.s.kalanGun, alici: alicilar.length } as Prisma.InputJsonValue })) });
      this.logger.log(JSON.stringify({ event: "mevzuat_reminder_sent", items: yeni.map((g) => g.anahtar) }));
      return yeni.length;
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "mevzuat_reminder_failed", error: hata instanceof Error ? hata.message : String(hata) }));
      return 0;
    }
  }
}
