import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { planOzelligiAcik } from "../core/abonelik-erisim.service";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { BildirimService } from "../bildirimler/bildirim.service";
import { donemMetni } from "./endeks-deposu";
import { endeksVerisi } from "./fiyat-endeks-veri";
import { ARTIS_OLCULERI, artisHesapla, artisSonAyi, gerekenAylar, yeniBedel, type ArtisHesabi } from "./endeks-artis-hesap";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

export const artisKuraliSemasi = z.object({
  kaynakTur: z.enum(["kira", "tekrarlayan_fatura"]),
  kaynakId: z.uuid(),
  seriKodu: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  olcu: z.enum(ARTIS_OLCULERI),
  artisAyi: z.number().int().min(1).max(12),
  ustSinir: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, "Üst sınır yüzde olarak (ör. 25 ya da 25.5)").nullable().default(null),
  aktif: z.boolean().default(true),
}).strict();
export type ArtisKuraliGirdisi = z.infer<typeof artisKuraliSemasi>;

/** İstanbul takviminde bugünün yılı ve ayı. */
function bugunTR(simdi = new Date()) {
  const [y, a] = simdi.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).split("-").map(Number);
  return { yil: y, ay: a };
}

/**
 * Artış ayı ve bir sonraki ay öneri penceresidir: endeks ayın 3'ünde
 * açıklanır, gecikirse ertesi ay da denenir. Pencere dışındaki yıl için
 * öneri üretilmez (kural yıl ortasında açılınca geçmiş artış önerilmez).
 */
export function oneriYili(artisAyi: number, simdi = new Date()): number | null {
  const { yil, ay } = bugunTR(simdi);
  for (const y of [yil, yil - 1]) {
    const bas = y * 12 + artisAyi - 1, bugun = yil * 12 + ay - 1;
    if (bugun >= bas && bugun <= bas + 1) return y;
  }
  return null;
}

/**
 * END-17: kira sözleşmesi ve tekrarlayan faturada endeksli artış. Worker
 * artış ayında öneri üretir ve bildirir; kullanıcı onaylayınca kira matrahı
 * ya da planın fiyat çarpanı güncellenir. Kendiliğinden bedel değişmez.
 */
@Injectable()
export class EndeksArtisService {
  private readonly logger = new Logger(EndeksArtisService.name);
  constructor(private readonly prisma: PrismaService, private readonly bildirimler: BildirimService) {}

  private async planDenetle(tx: Tx, tenantId: string) {
    if (!(await planOzelligiAcik(tx, tenantId, "fiyatEndeksAnalizi"))) throw new ForbiddenException("Fiyat ve endeks analizi abonelik planınızda açık değil.");
  }

  /** Kaynağın bugünkü bedeli: kira matrahı ya da şablon matrahı × çarpan. */
  private async kaynakOku(tx: Tx, k: { kiraSozlesmeId: string | null; tekrarlayanFaturaId: string | null }) {
    if (k.kiraSozlesmeId) {
      const s = await tx.kiraSozlesme.findFirst({ where: { id: k.kiraSozlesmeId }, select: { id: true, baslik: true, matrah: true, dovizCinsi: true, aktif: true } });
      return s ? { tur: "kira" as const, id: s.id, ad: s.baslik, bedel: s.matrah, carpan: null, dovizCinsi: s.dovizCinsi, aktif: s.aktif, adres: "/panel/masraflar/kiralar" } : null;
    }
    const p = await tx.tekrarlayanFatura.findFirst({ where: { id: k.tekrarlayanFaturaId! }, select: { id: true, ad: true, aktif: true, fiyatCarpani: true, fiyatKaynagi: true, sablonFatura: { select: { toplamMatrah: true, dovizCinsi: true } } } });
    return p ? { tur: "tekrarlayan_fatura" as const, id: p.id, ad: p.ad, bedel: p.sablonFatura.toplamMatrah.mul(p.fiyatCarpani).toDecimalPlaces(2), carpan: p.fiyatCarpani, dovizCinsi: p.sablonFatura.dovizCinsi, aktif: p.aktif, fiyatKaynagi: p.fiyatKaynagi, adres: "/panel/fatura/tekrarlayanlar" } : null;
  }

  async kurallar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.planDenetle(tx, tenantId);
      const [kurallar, kiralar, planlar, seriler] = await Promise.all([
        tx.endeksArtisKurali.findMany({ orderBy: { createdAt: "asc" }, include: { oneriler: { orderBy: { yil: "desc" }, take: 3 } } }),
        tx.kiraSozlesme.findMany({ where: { aktif: true }, select: { id: true, baslik: true, matrah: true, dovizCinsi: true }, orderBy: { baslik: "asc" } }),
        tx.tekrarlayanFatura.findMany({ where: { aktif: true }, select: { id: true, ad: true, fiyatKaynagi: true, fiyatCarpani: true, sablonFatura: { select: { toplamMatrah: true, dovizCinsi: true } } }, orderBy: { ad: "asc" } }),
        tx.endeksSerisi.findMany({ where: { etkin: true, tur: "endeks" }, select: { kod: true, ad: true, sonDonem: true }, orderBy: { sira: "asc" } }),
      ]);
      const satirlar = [];
      for (const k of kurallar) {
        const kaynak = await this.kaynakOku(tx, k);
        // Önizleme: son açıklanan veriyle bu yılın artış ayı hesabı (kayıt yazmaz).
        const { yil } = bugunTR();
        const sonAy = artisSonAyi(yil, k.artisAyi);
        const e = await endeksVerisi(tx, k.seriKodu, gerekenAylar(k.olcu as never, sonAy).at(-1)!, sonAy);
        const h = artisHesapla(k.olcu as never, sonAy, e.degerler, k.ustSinir);
        satirlar.push({
          id: k.id, kaynak, seriKodu: k.seriKodu, olcu: k.olcu, artisAyi: k.artisAyi, ustSinir: k.ustSinir?.toFixed(2) ?? null, aktif: k.aktif,
          onizleme: h ? { yil, sonAy: sonAy.slice(0, 7), oran: h.uygulananOran, yeniBedel: kaynak ? yeniBedel(kaynak.bedel, h.uygulananOran).toFixed(2) : null } : { yil, sonAy: sonAy.slice(0, 7), neden: `${sonAy.slice(0, 7)} için endeks değeri henüz yok.` },
          oneriler: k.oneriler.map((o) => this.oneriCikti(o)),
        });
      }
      return {
        kurallar: satirlar,
        seriler: seriler.map((s) => ({ kod: s.kod, ad: s.ad, sonDonem: s.sonDonem ? donemMetni(s.sonDonem).slice(0, 7) : null })),
        kaynaklar: {
          kira: kiralar.map((k) => ({ id: k.id, ad: k.baslik, bedel: k.matrah.toFixed(2), dovizCinsi: k.dovizCinsi })),
          tekrarlayan: planlar.map((p) => ({ id: p.id, ad: p.ad, bedel: p.sablonFatura.toplamMatrah.mul(p.fiyatCarpani).toFixed(2), dovizCinsi: p.sablonFatura.dovizCinsi, uygun: p.fiyatKaynagi === "sablon" })),
        },
      };
    });
  }

  private oneriCikti(o: { id: string; yil: number; seriKodu: string; olcu: string; sonAy: Date; hesaplananOran: Prisma.Decimal; uygulananOran: Prisma.Decimal; eskiBedel: Prisma.Decimal; yeniBedel: Prisma.Decimal; hesap: Prisma.JsonValue; durum: string; kararAt: Date | null; createdAt: Date }) {
    return { id: o.id, yil: o.yil, seriKodu: o.seriKodu, olcu: o.olcu, sonAy: donemMetni(o.sonAy).slice(0, 7), hesaplananOran: o.hesaplananOran.toFixed(2), uygulananOran: o.uygulananOran.toFixed(2), eskiBedel: o.eskiBedel.toFixed(2), yeniBedel: o.yeniBedel.toFixed(2), hesap: o.hesap, durum: o.durum, kararAt: o.kararAt, olusturuldu: o.createdAt };
  }

  async kuralKaydet(g: ArtisKuraliGirdisi) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.planDenetle(tx, tenantId);
      const seri = await tx.endeksSerisi.findUnique({ where: { kod: g.seriKodu }, select: { tur: true } });
      if (!seri || seri.tur !== "endeks") throw new BadRequestException("Artış kuralı için endeks serisi seçin (kur değil).");
      const bag = g.kaynakTur === "kira" ? { kiraSozlesmeId: g.kaynakId, tekrarlayanFaturaId: null } : { kiraSozlesmeId: null, tekrarlayanFaturaId: g.kaynakId };
      const kaynak = await this.kaynakOku(tx, bag);
      if (!kaynak) throw new NotFoundException(g.kaynakTur === "kira" ? "Kira sözleşmesi bulunamadı" : "Tekrarlayan fatura planı bulunamadı");
      if (kaynak.tur === "tekrarlayan_fatura" && kaynak.fiyatKaynagi !== "sablon") throw new BadRequestException("Bu plan fiyatı güncel fiyat listesinden alıyor; endeksli artış yalnız şablon fiyatlı planlarda kullanılır (liste fiyatı için Fiyat Listeleri › endeks önerisi).");
      const veri = { seriKodu: g.seriKodu, olcu: g.olcu, artisAyi: g.artisAyi, ustSinir: g.ustSinir === null ? null : D(g.ustSinir), aktif: g.aktif };
      const mevcut = await tx.endeksArtisKurali.findFirst({ where: g.kaynakTur === "kira" ? { kiraSozlesmeId: g.kaynakId } : { tekrarlayanFaturaId: g.kaynakId }, select: { id: true } });
      const k = mevcut
        ? await tx.endeksArtisKurali.update({ where: { id: mevcut.id }, data: veri })
        : await tx.endeksArtisKurali.create({ data: { tenantId, ...bag, ...veri } });
      return { id: k.id };
    });
  }

  async oneriler(durum?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.planDenetle(tx, tenantId);
      const liste = await tx.endeksArtisOnerisi.findMany({ where: durum ? { durum } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { kural: true } });
      return Promise.all(liste.map(async (o) => ({ ...this.oneriCikti(o), kaynak: await this.kaynakOku(tx, o.kural) })));
    });
  }

  /** Onay: bedel öneri anındaki değerden değişmişse öneri eskimiştir, uygulanmaz. */
  async karar(id: string, karar: "onaylandi" | "reddedildi") {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.planDenetle(tx, tenantId);
      await tx.$queryRaw`SELECT id FROM endeks_artis_onerileri WHERE id = ${id}::uuid FOR UPDATE`;
      const o = await tx.endeksArtisOnerisi.findFirst({ where: { id }, include: { kural: true } });
      if (!o) throw new NotFoundException("Artış önerisi bulunamadı");
      if (o.durum !== "bekliyor") throw new ConflictException("Bu öneri için karar verilmiş.");
      if (karar === "onaylandi") {
        const kaynak = await this.kaynakOku(tx, o.kural);
        if (!kaynak) throw new NotFoundException("Önerinin bağlı olduğu kayıt bulunamadı");
        const hesap = o.hesap as { eskiCarpan?: string; yeniCarpan?: string };
        if (kaynak.tur === "kira") {
          if (!kaynak.bedel.equals(o.eskiBedel)) throw new ConflictException(`Kira bedeli öneriden sonra değişmiş (${kaynak.bedel.toFixed(2)}); öneri uygulanmadı, reddedip yeni bedeli elle girin.`);
          await tx.kiraSozlesme.update({ where: { id: kaynak.id }, data: { matrah: o.yeniBedel.toDecimalPlaces(2) } });
        } else {
          if (!hesap.eskiCarpan || !kaynak.carpan!.equals(hesap.eskiCarpan)) throw new ConflictException("Planın fiyat çarpanı öneriden sonra değişmiş; öneri uygulanmadı.");
          await tx.tekrarlayanFatura.update({ where: { id: kaynak.id }, data: { fiyatCarpani: D(hesap.yeniCarpan!) } });
        }
      }
      await tx.endeksArtisOnerisi.update({ where: { id }, data: { durum: karar, kararVerenId: userId, kararAt: new Date() } });
      return { id, durum: karar };
    });
  }

  /**
   * Worker: firmanın etkin kurallarında öneri penceresindeki yıl için öneri
   * üretir. Endeks açıklanmamışsa beklenir (sonraki turda tekrar denenir).
   * Dövizli kaynakta da oran bedele uygulanır (bedelin dövizinde).
   */
  async uret(tenantId: string, simdi = new Date()): Promise<number> {
    const yeni: { id: string; ad: string; oran: string; eski: string; yeni: string; doviz: string }[] = [];
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await planOzelligiAcik(tx, tenantId, "fiyatEndeksAnalizi"))) return;
      const kurallar = await tx.endeksArtisKurali.findMany({ where: { aktif: true } });
      for (const k of kurallar) {
        const yil = oneriYili(k.artisAyi, simdi);
        if (yil === null) continue;
        if (await tx.endeksArtisOnerisi.findFirst({ where: { kuralId: k.id, yil }, select: { id: true } })) continue;
        const kaynak = await this.kaynakOku(tx, k);
        if (!kaynak || !kaynak.aktif) continue;
        const sonAy = artisSonAyi(yil, k.artisAyi);
        const e = await endeksVerisi(tx, k.seriKodu, gerekenAylar(k.olcu as never, sonAy).at(-1)!, sonAy);
        const h: ArtisHesabi | null = artisHesapla(k.olcu as never, sonAy, e.degerler, k.ustSinir);
        if (!h) continue;
        const carpan = kaynak.carpan ? kaynak.carpan.mul(D(h.uygulananOran).div(100).add(1)).toDecimalPlaces(8) : null;
        const yeniDeger = yeniBedel(kaynak.bedel, h.uygulananOran);
        const o = await tx.endeksArtisOnerisi.create({ data: {
          tenantId, kuralId: k.id, yil, seriKodu: k.seriKodu, olcu: k.olcu, sonAy: new Date(`${sonAy}T00:00:00.000Z`),
          hesaplananOran: D(h.hesaplananOran), uygulananOran: D(h.uygulananOran), eskiBedel: kaynak.bedel, yeniBedel: yeniDeger,
          hesap: { ...h, seriAdi: e.ad, bazYili: e.bazYili, ...(carpan ? { eskiCarpan: kaynak.carpan!.toFixed(8), yeniCarpan: carpan.toFixed(8) } : {}) } as unknown as Prisma.InputJsonValue,
        } });
        yeni.push({ id: o.id, ad: kaynak.ad, oran: h.uygulananOran, eski: kaynak.bedel.toFixed(2), yeni: yeniDeger.toFixed(2), doviz: kaynak.dovizCinsi });
      }
    });
    for (const o of yeni) {
      try {
        await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.bildirimler.uret({
          tur: "onay", onem: "bilgi",
          baslik: `Endeksli artış önerisi: ${o.ad}`,
          aciklama: `%${o.oran} artışla bedel ${o.eski} → ${o.yeni} ${o.doviz} önerildi. Onaylayınca kayıt güncellenir; onaylanmadan bedel değişmez.`,
          birlesimAnahtari: `endeks-artis:${o.id}`, kaynakTur: "endeks_artis_onerisi", kaynakRef: o.id,
          hedefYol: "/panel/raporlar/endeksli-artislar", roller: ["yonetici", "muhasebe"],
        }));
      } catch (hata) { this.logger.warn(`Artış önerisi bildirimi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`); }
    }
    return yeni.length;
  }
}

