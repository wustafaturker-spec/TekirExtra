import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { NetgsmAdapter, SmsReddedildi, type NetgsmConfig } from "../pos/netgsm.adapter";
import { hataMetni } from "./ileti-kurallari";
import { smsGunlukTavan, smsParcaSayisi, telefonE164 } from "./sms-kurallari";

/** ILT-10: sağlayıcı arayüzü; yeni sağlayıcı buraya eklenir, çağıranlar değişmez. */
export interface SmsSaglayici { smsGonder(config: NetgsmConfig, telefon: string, mesaj: string): Promise<{ gorevId: string }> }
const SAGLAYICILAR: Record<string, SmsSaglayici> = { netgsm: new NetgsmAdapter() };
export const smsSaglayiciAl = (ad: string): SmsSaglayici | undefined => SAGLAYICILAR[ad];

export interface SmsGirdisi {
  tur: string; telefon: string; mesaj: string;
  /** ILT-05: aynı anahtarla ikinci SMS çıkmaz. */
  anahtar?: string;
  cariId?: string | null;
}

export class SmsGonderilemedi extends HttpException { constructor(mesaj: string) { super(mesaj, HttpStatus.BAD_REQUEST); } }

const istanbulGunBasi = (s = new Date()) => new Date(`${s.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })}T00:00:00+03:00`);

/**
 * ILT-01/10: firmanın SMS çıkışı; firmanın kendi hesabını kullanır. Sonucu belirsiz
 * gönderim otomatik tekrarlanmaz (ikinci SMS ücret ve rahatsızlık demektir). Metin kayda yazılmaz.
 */
@Injectable()
export class SmsService {
  constructor(private readonly prisma: PrismaService) {}

  private kayit(tx: Prisma.TransactionClient, tenantId: string, g: SmsGirdisi, telefon: string, durum: string, hata?: string) {
    return tx.smsGonderim.create({ data: { tenantId, anahtar: g.anahtar ?? null, tur: g.tur, telefon, durum, parca: smsParcaSayisi(g.mesaj), hata: hata ?? null, cariId: g.cariId ?? null }, select: { id: true } });
  }

  /** Anahtar daha önce kullanıldıysa `{ yinelenen: true }` döner. */
  async gonder(g: SmsGirdisi): Promise<{ gorevId: string | null; yinelenen: boolean }> {
    const { tenantId } = aktifBaglam();
    const telefon = telefonE164(g.telefon);
    if (!telefon) throw new SmsGonderilemedi("Geçerli bir Türkiye cep telefonu numarası gereklidir");

    const ayrilan = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Tavan sayımı ile kayıt aynı kilitte: aynı anda iki toplu gönderim sınırı aşamaz.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":sms"}, 0))::text`;
      if (g.anahtar && await tx.smsGonderim.findUnique({ where: { tenantId_anahtar: { tenantId, anahtar: g.anahtar } }, select: { id: true } })) return { yinelenen: true as const };
      const baglanti = await tx.baglanti.findFirst({ where: { aile: "sms", durum: "aktif" }, orderBy: { updatedAt: "desc" }, select: { saglayici: true, sifreliConfig: true } });
      if (!baglanti) {
        await this.kayit(tx, tenantId, g, telefon, "basarisiz", "SMS hesabı yok");
        return { hata: "SMS hesabı bağlı değil; Ayarlar > SMS Ayarları'ndan bağlayın" };
      }
      const bugun = await tx.smsGonderim.count({ where: { createdAt: { gte: istanbulGunBasi() }, durum: { not: "basarisiz" } } });
      if (bugun >= smsGunlukTavan()) {
        await this.kayit(tx, tenantId, g, telefon, "basarisiz", "Günlük SMS tavanı doldu");
        return { hata: `Günlük SMS tavanına (${smsGunlukTavan()}) ulaşıldı` };
      }
      const { id } = await this.kayit(tx, tenantId, g, telefon, "gonderiliyor");
      return { id, baglanti };
    }, { timeout: 15_000 });
    if ("yinelenen" in ayrilan) return { gorevId: null, yinelenen: true };
    if ("hata" in ayrilan) throw new SmsGonderilemedi(ayrilan.hata as string);

    const saglayici = SAGLAYICILAR[ayrilan.baglanti.saglayici];
    const yaz = (data: Prisma.SmsGonderimUpdateInput) => this.prisma.tenantIslem(tenantId, (tx) => tx.smsGonderim.update({ where: { id: ayrilan.id }, data }));
    if (!saglayici) { await yaz({ durum: "basarisiz", hata: `Desteklenmeyen sağlayıcı: ${ayrilan.baglanti.saglayici}` }); throw new SmsGonderilemedi("SMS sağlayıcısı desteklenmiyor"); }
    try {
      const c = JSON.parse(coz(ayrilan.baglanti.sifreliConfig)) as NetgsmConfig;
      const { gorevId } = await saglayici.smsGonder({ kullaniciAdi: c.kullaniciAdi, parola: c.parola, gondericiAdi: c.gondericiAdi, servisAdresi: c.servisAdresi }, telefon, g.mesaj);
      await yaz({ durum: "gonderildi", gorevNo: gorevId });
      return { gorevId, yinelenen: false };
    } catch (hata) {
      // Sağlayıcı açıkça reddetmediyse iletinin çıkıp çıkmadığı bilinemez.
      await yaz({ durum: hata instanceof SmsReddedildi ? "basarisiz" : "belirsiz", hata: hataMetni(hata) });
      throw hata;
    }
  }

  /** ILT-07: firmanın SMS kaydı. */
  async kayitlar(g: { durum?: string; tur?: string; baslangic?: string; bitis?: string; sayfa?: number }) {
    const { tenantId } = aktifBaglam();
    const take = 50, sayfa = Math.max(1, g.sayfa ?? 1);
    const where: Prisma.SmsGonderimWhereInput = { ...(g.durum ? { durum: g.durum } : {}), ...(g.tur ? { tur: g.tur } : {}), ...(g.baslangic || g.bitis ? { createdAt: { ...(g.baslangic ? { gte: new Date(`${g.baslangic}T00:00:00+03:00`) } : {}), ...(g.bitis ? { lte: new Date(`${g.bitis}T23:59:59.999+03:00`) } : {}) } } : {}) };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satirlar, toplam, turler] = await Promise.all([
        tx.smsGonderim.findMany({ where, orderBy: { createdAt: "desc" }, skip: (sayfa - 1) * take, take, select: { id: true, tur: true, telefon: true, durum: true, parca: true, hata: true, createdAt: true, cari: { select: { unvan: true } } } }),
        tx.smsGonderim.count({ where }),
        tx.smsGonderim.findMany({ distinct: ["tur"], select: { tur: true }, orderBy: { tur: "asc" } }),
      ]);
      return { satirlar, toplam, sayfa, sayfaBoyutu: take, turler: turler.map((t) => t.tur) };
    });
  }
}
