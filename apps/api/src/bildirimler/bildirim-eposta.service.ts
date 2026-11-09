import { Injectable, Logger, Optional } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "../tenant/eposta.service";
import { SmsService } from "../ileti/sms.service";

const AZAMI_DENEME = 5;
const PARTI_BOYU = 50;

/** "HH:mm" → gün içindeki dakika. */
function dakikaya(saat: string): number {
  const [ss, dd] = saat.split(":").map(Number);
  return ss * 60 + dd;
}

/**
 * Sessiz saat aralığı gece yarısını aşabilir (22:00–07:00); bu yüzden basit
 * "başlangıç ≤ şimdi ≤ bitiş" karşılaştırması yetmez.
 */
export function sessizSaatte(simdiDakika: number, baslangic?: string | null, bitis?: string | null): boolean {
  if (!baslangic || !bitis) return false;
  const bas = dakikaya(baslangic);
  const bit = dakikaya(bitis);
  return bas <= bit ? simdiDakika >= bas && simdiDakika < bit : simdiDakika >= bas || simdiDakika < bit;
}

/**
 * Bekleyen e-posta teslimatlarını gönderir (BLD-06).
 *
 * Kuyruk olarak teslimat tablosunun kendisi kullanılır: durum ve deneme sayısı
 * satırda tutulduğu için süreç yeniden başlasa da gönderilmemiş bildirim
 * kaybolmaz ve aynı bildirim iki kez gönderilmez. Ayrı bir BullMQ kuyruğu bu
 * hacimde ek bir hata yüzeyi olurdu.
 */
@Injectable()
export class BildirimEpostaService {
  private readonly logger = new Logger(BildirimEpostaService.name);

  constructor(private readonly prisma: PrismaService, private readonly eposta: EpostaService, @Optional() private readonly sms?: SmsService) {}

  /**
   * ILT-11: SMS tercihi açık, numarası doğrulanmış kullanıcıya kritik bildirim; firmanın SMS hesabından.
   * En çok bir kez denenir (işaret gönderimden önce yazılır); sessiz saatte beklenir, 24 saatten eskisi gitmez.
   */
  async kritikSmsleriGonder(): Promise<number> {
    if (!this.sms) return 0;
    const { tenantId } = aktifBaglam();
    const tercihler = await this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimTercihi.findMany({ where: { sms: true }, select: { userId: true, tur: true } }));
    if (!tercihler.length) return 0;
    const acik = new Set(tercihler.map((t) => `${t.userId}:${t.tur}`));
    const adaylar = await this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimTeslimati.findMany({
      where: { userId: { in: [...new Set(tercihler.map((t) => t.userId))] }, smsGonderildiAt: null, bildirim: { onem: "kritik", kapandiAt: null, createdAt: { gt: new Date(Date.now() - 86_400_000) } }, kullanici: { telefonDogrulandiAt: { not: null }, telefon: { not: null } } },
      select: { id: true, userId: true, bildirim: { select: { tur: true, baslik: true } }, kullanici: { select: { telefon: true, bildirimAyari: { select: { sessizBaslangic: true, sessizBitis: true } } } } },
      take: PARTI_BOYU,
    }));
    const simdi = new Date(), simdiDakika = simdi.getHours() * 60 + simdi.getMinutes();
    let gonderilen = 0;
    for (const t of adaylar) {
      if (!acik.has(`${t.userId}:${t.bildirim.tur}`) || sessizSaatte(simdiDakika, t.kullanici.bildirimAyari?.sessizBaslangic, t.kullanici.bildirimAyari?.sessizBitis)) continue;
      const { count } = await this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimTeslimati.updateMany({ where: { id: t.id, smsGonderildiAt: null }, data: { smsGonderildiAt: new Date() } }));
      if (count !== 1) continue;
      await this.sms.gonder({ tur: "kritik_bildirim", anahtar: `bld:${t.id}`, telefon: t.kullanici.telefon!, mesaj: `TekirExtra: ${t.bildirim.baslik.slice(0, 120)}` })
        .then(() => { gonderilen += 1; })
        .catch((h: unknown) => this.logger.warn(JSON.stringify({ event: "critical_sms_failed", tenantId, error: h instanceof Error ? h.message : String(h) })));
    }
    return gonderilen;
  }

  async bekleyenleriGonder(): Promise<{ gonderilen: number; ertelenen: number; basarisiz: number }> {
    const { tenantId } = aktifBaglam();
    const bekleyenler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bildirimTeslimati.findMany({
        where: { epostaDurumu: "beklemede", epostaDenemeSayisi: { lt: AZAMI_DENEME }, bildirim: { kapandiAt: null } },
        include: {
          bildirim: { select: { baslik: true, aciklama: true, onem: true, hedefYol: true } },
          kullanici: { select: { id: true, eposta: true, adSoyad: true, bildirimAyari: { select: { sessizBaslangic: true, sessizBitis: true } } } },
        },
        orderBy: { createdAt: "asc" },
        take: PARTI_BOYU,
      }),
    );

    const simdi = new Date();
    const simdiDakika = simdi.getHours() * 60 + simdi.getMinutes();
    let gonderilen = 0;
    let ertelenen = 0;
    let basarisiz = 0;

    for (const teslimat of bekleyenler) {
      const ayar = teslimat.kullanici.bildirimAyari;
      // Sessiz saatte bildirim kaydı durur, e-postası aralık bitince gider (BLD-04).
      if (sessizSaatte(simdiDakika, ayar?.sessizBaslangic, ayar?.sessizBitis)) {
        ertelenen++;
        continue;
      }

      const konu = `TekirExtra — ${teslimat.bildirim.baslik}`;
      const govde = [
        `Merhaba ${teslimat.kullanici.adSoyad},`,
        "",
        teslimat.bildirim.aciklama,
        teslimat.bildirim.hedefYol ? `\nKayda gitmek için: ${(process.env.WEB_TABAN_URL ?? "http://localhost:3100").replace(/\/$/, "")}${teslimat.bildirim.hedefYol}` : "",
        "",
        "Bu bildirimi TekirExtra > Ayarlar > Bildirimler ekranından kapatabilirsiniz.",
      ].join("\n");

      try {
        await this.eposta.iletiGonder({ alici: teslimat.kullanici.eposta, konu, metin: govde });
        await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.bildirimTeslimati.update({
            where: { id: teslimat.id },
            data: { epostaDurumu: "gonderildi", epostaGonderildiAt: new Date(), epostaDenemeSayisi: { increment: 1 }, epostaHatasi: null },
          }),
        );
        gonderilen++;
      } catch (hata) {
        const deneme = teslimat.epostaDenemeSayisi + 1;
        const mesaj = hata instanceof Error ? hata.message : String(hata);
        await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.bildirimTeslimati.update({
            where: { id: teslimat.id },
            data: { epostaDurumu: deneme >= AZAMI_DENEME ? "hata" : "beklemede", epostaDenemeSayisi: deneme, epostaHatasi: mesaj.slice(0, 500) },
          }),
        );
        basarisiz++;
        this.logger.warn(JSON.stringify({ event: "notification_email_failed", teslimatId: teslimat.id, deneme, error: mesaj }));
      }
    }

    return { gonderilen, ertelenen, basarisiz };
  }
}
