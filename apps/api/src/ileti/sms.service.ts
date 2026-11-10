import { HttpException, HttpStatus, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { SmsReddedildi, type NetgsmConfig } from "../pos/netgsm.adapter";
import { smsSaglayiciAl } from "./sms-saglayici";
import { hataMetni, IletiSiniriAsildi, istanbulAyBasi, istanbulGunBasi, TEKRAR_PENCERESI_MS, TEKRAR_SINIRI_ADET, tavanIhlali, tekrarIhlali } from "./ileti-kurallari";
import { PlatformIletiService } from "./platform-ileti.service";
import { IletiSablonService } from "./ileti-sablon.service";
import { varsayilanSablon, type SablonIstegi } from "./ileti-sablonlari";
import { smsParcaSayisi, telefonE164 } from "./sms-kurallari";

export type SmsGirdisi = SmsIcerigi & SmsOrtak;
/** Hazır metin ya da ILT-09 şablonu. */
type SmsIcerigi = { mesaj: string; sablon?: undefined } | { sablon: SablonIstegi; mesaj?: undefined };
interface SmsOrtak {
  tur: string; telefon: string;
  /** ILT-05: aynı anahtarla ikinci SMS çıkmaz. */
  anahtar?: string;
  cariId?: string | null;
  /** ILT-14: kullanıcının başlatmadığı ileti; aynı alıcıya saatlik tekrar sınırı uygulanır. */
  otomatik?: boolean;
}

export class SmsGonderilemedi extends HttpException { constructor(mesaj: string) { super(mesaj, HttpStatus.BAD_REQUEST); } }

/**
 * ILT-01/10: firmanın SMS çıkışı; firmanın kendi hesabını kullanır. Sonucu belirsiz
 * gönderim otomatik tekrarlanmaz (ikinci SMS ücret ve rahatsızlık demektir). Metin kayda yazılmaz.
 */
@Injectable()
export class SmsService {
  constructor(private readonly prisma: PrismaService, private readonly ileti: PlatformIletiService, @Optional() private readonly sablonlar?: IletiSablonService) {}

  private kayit(tx: Prisma.TransactionClient, tenantId: string, g: SmsOrtak & { mesaj: string }, telefon: string, durum: string, hata?: string) {
    return tx.smsGonderim.create({ data: { tenantId, anahtar: g.anahtar ?? null, tur: g.tur, telefon, durum, parca: smsParcaSayisi(g.mesaj), hata: hata ?? null, cariId: g.cariId ?? null }, select: { id: true } });
  }

  /** Anahtar daha önce kullanıldıysa `{ yinelenen: true }` döner. */
  async gonder(ham: SmsGirdisi): Promise<{ gorevId: string | null; yinelenen: boolean }> {
    const { tenantId } = aktifBaglam();
    const g: SmsOrtak & { mesaj: string } = { ...ham, mesaj: ham.sablon ? (this.sablonlar ? await this.sablonlar.uret(ham.sablon, tenantId) : varsayilanSablon(ham.sablon)).metin : ham.mesaj };
    const telefon = telefonE164(g.telefon);
    if (!telefon) throw new SmsGonderilemedi("Geçerli bir Türkiye cep telefonu numarası gereklidir");

    const tavan = await this.ileti.tavan(tenantId, "sms");
    const simdi = new Date(), sayilan = { durum: { not: "basarisiz" } };
    const ayrilan = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Tavan sayımı ile kayıt aynı kilitte: aynı anda iki toplu gönderim sınırı aşamaz.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":sms"}, 0))::text`;
      if (g.anahtar && await tx.smsGonderim.findUnique({ where: { tenantId_anahtar: { tenantId, anahtar: g.anahtar } }, select: { id: true } })) return { yinelenen: true as const };
      const baglanti = await tx.baglanti.findFirst({ where: { aile: "sms", durum: "aktif" }, orderBy: { updatedAt: "desc" }, select: { saglayici: true, sifreliConfig: true } });
      if (!baglanti) {
        await this.kayit(tx, tenantId, g, telefon, "basarisiz", "SMS hesabı yok");
        return { hata: "SMS hesabı bağlı değil; Ayarlar > SMS Ayarları'ndan bağlayın" };
      }
      if (g.otomatik && await tx.smsGonderim.count({ where: { telefon, tur: g.tur, ...sayilan, createdAt: { gte: new Date(simdi.getTime() - TEKRAR_PENCERESI_MS) } } }) >= TEKRAR_SINIRI_ADET) return { tekrar: true as const };
      const gunluk = await tx.smsGonderim.count({ where: { ...sayilan, createdAt: { gte: istanbulGunBasi(simdi) } } });
      const aylik = await tx.smsGonderim.count({ where: { ...sayilan, createdAt: { gte: istanbulAyBasi(simdi) } } });
      const ihlal = tavanIhlali("sms", { gunluk, aylik }, tavan);
      if (ihlal) {
        await this.kayit(tx, tenantId, { ...g, anahtar: undefined }, telefon, "basarisiz", ihlal.kayit);
        return { ihlal };
      }
      const { id } = await this.kayit(tx, tenantId, g, telefon, "gonderiliyor");
      return { id, baglanti };
    }, { timeout: 15_000 });
    if ("yinelenen" in ayrilan) return { gorevId: null, yinelenen: true };
    if ("tekrar" in ayrilan) throw tekrarIhlali();
    if ("ihlal" in ayrilan && ayrilan.ihlal) throw new IletiSiniriAsildi(ayrilan.ihlal.mesaj, ayrilan.ihlal.neden);
    if ("hata" in ayrilan) throw new SmsGonderilemedi(ayrilan.hata as string);

    const saglayici = smsSaglayiciAl(ayrilan.baglanti.saglayici);
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
