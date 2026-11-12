import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Prisma, type AsistanSorusu, type Rol } from "@prisma/client";
import { AiAjanService } from "../ai/ajan/ai-ajan.service";
import { AracYurutucu } from "../ai/ajan/arac-yurutucu";
import { ocrGirdisiOlustur } from "../ai/ai.semalar";
import { AiService } from "../ai/ai.service";
import { dosyaIceriginiDogrula } from "../core/guvenlik/dosya-dogrulama";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EklerService, type YuklenenDosya } from "../ekler/ekler.service";
import type { Secenek } from "./asistan-soru.kurallari";
import { BELGE_AZAMI_BAYT, kategoriAdlaBul, kategoriSorusu, masrafTaslagi, type MasrafTaslagi } from "./masraf-belge.kurallari";

const TASLAK_ARACI = "masraf_taslagi_olustur";
const UZANTI: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

interface KategoriSorusuVerisi { taslak: MasrafTaslagi; uyarilar: string[]; ekId: string; kategoriler: Array<{ id: string; ad: string }> }
export interface BelgeSonucu { sonuc: string; masrafId?: string; soru?: { id: string; soru: string; secenekler: Secenek[]; serbestYanit: boolean } }

/**
 * CNL-16: fiş/fatura görselinden masraf taslağı. Sıra: rol (taslak açabiliyor mu) → içerik ve virüs
 * denetimi → sohbet eki → OCR → kategori. Kategori satıcının önceki masraflarından ya da OCR'ın
 * önerdiği adın tek eşleşmesinden gelir; belirsizse tahmin edilmez, sorulur (CNL-09). Taslak
 * asistanın taslak aracıyla açılır (kesinleştirilmez, ödenmez); görsel masrafa ek olur.
 */
@Injectable()
export class MasrafBelgeService {
  private readonly logger = new Logger(MasrafBelgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly ekler: EklerService,
    private readonly yurutucu: AracYurutucu,
    private readonly ajan: AiAjanService,
  ) {}

  private izinli() {
    return new Map(this.yurutucu.izinliAraclar(aktifBaglam().rol as Rol).map((a) => [a.ad, a]));
  }

  /** Rol, özel rol ve paket masraf taslağına izin veriyor mu? Dosya indirilmeden önce sorulur. */
  yetkiDenetle(): void {
    if (!this.izinli().has(TASLAK_ARACI)) throw new ForbiddenException("Rolünüz ya da paketiniz masraf taslağı açmaya izin vermiyor; belgeyi panelden yükleyin.");
  }

  async belgedenMasraf(dosya: { ad: string; buffer: Buffer }, not: string | null): Promise<BelgeSonucu> {
    const { tenantId, userId } = aktifBaglam();
    this.yetkiDenetle();
    if (dosya.buffer.length > BELGE_AZAMI_BAYT) throw new BadRequestException("Dosya 6 MB'tan büyük; daha küçük bir fotoğraf gönderin.");
    const girdi = ocrGirdisiOlustur(dosya.buffer);
    if (!girdi) throw new BadRequestException("Bu dosya okunamaz; JPEG, PNG, WebP fotoğraf ya da PDF gönderin.");
    // Uzantısız ad (Telegram fotoğrafı) içerikten tespit edilen türün uzantısını alır; verilen uzantı
    // içerikle uyuşmazsa içerik denetimi reddeder.
    const ad = /\.[a-z0-9]{2,4}$/i.test(dosya.ad) ? dosya.ad : `${dosya.ad}.${UZANTI[girdi.mimeType]}`;
    const yuklenen: YuklenenDosya = { originalname: ad, mimetype: girdi.mimeType, size: dosya.buffer.length, buffer: dosya.buffer };
    // Model sağlayıcısına dosya gitmeden önce içerik imzası ve virüs taraması.
    await dosyaIceriginiDogrula(yuklenen, "belge");
    const ek = await this.ekler.yukle("ai_sohbet", await this.ajan.telegramOturumKimligi(), yuklenen);

    const ocr = await this.ai.fisFaturaOcrTara(tenantId, { ...girdi, belgeTipi: "fis_fatura" });
    if (!ocr.dogrulama.gecerli || ocr.dogrulama.hatalar.length || !(ocr.dogrulama.veri.genelToplam > 0)) {
      throw new BadRequestException(`Belgeden tutar güvenle okunamadı${ocr.dogrulama.hatalar.length ? ` (${ocr.dogrulama.hatalar.join("; ").slice(0, 200)})` : ""}. Daha net bir fotoğraf gönderin ya da panelden girin.`);
    }
    const { taslak, uyarilar } = masrafTaslagi(ocr.dogrulama.veri, ocr.eslesenCari?.id ?? null, not);
    uyarilar.push(...ocr.dogrulama.uyarilar.slice(0, 3));
    const kategoriler = await this.kategoriler();
    if (!kategoriler.length) throw new BadRequestException("Firmada etkin masraf kategorisi yok; önce panelden kategori tanımlayın.");
    const kategoriId = await this.kategoriBul(taslak, ocr.onerilenMasrafKategorisi, kategoriler);
    if (kategoriId) return this.taslakAc(taslak, kategoriId, ek.id, uyarilar);

    const s = kategoriSorusu(taslak, kategoriler);
    const veri: KategoriSorusuVerisi = { taslak, uyarilar, ekId: ek.id, kategoriler: kategoriler.slice(0, 5) };
    const soru = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.create({ data: {
      tenantId, tur: "masraf_kategori", kaynakId: ek.id, userId, soru: s.soru, secenekler: s.secenekler as unknown as Prisma.InputJsonValue, veri: veri as unknown as Prisma.InputJsonValue, serbestYanit: true,
    } }));
    return { sonuc: "", soru: { id: soru.id, soru: soru.soru, secenekler: s.secenekler, serbestYanit: true } };
  }

  /** Etkin kategoriler, son 180 günde en çok kullanılandan başlayarak. */
  private async kategoriler(): Promise<Array<{ id: string; ad: string }>> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [liste, kullanim] = await Promise.all([
        tx.masrafKategori.findMany({ where: { aktif: true }, select: { id: true, ad: true }, orderBy: { ad: "asc" } }),
        tx.masraf.groupBy({ by: ["kategoriId"], where: { createdAt: { gte: new Date(Date.now() - 180 * 86_400_000) } }, _count: { _all: true } }),
      ]);
      const sayi = new Map(kullanim.map((k) => [k.kategoriId, k._count._all]));
      return [...liste].sort((a, b) => (sayi.get(b.id) ?? 0) - (sayi.get(a.id) ?? 0));
    });
  }

  /** CNL-10: aynı satıcının (VKN, yoksa unvan) son masrafının kategorisi; sonra OCR önerisinin tek eşleşmesi. */
  private async kategoriBul(t: MasrafTaslagi, oneri: string | null, kategoriler: Array<{ id: string; ad: string }>): Promise<string | null> {
    const { tenantId } = aktifBaglam();
    const etkin = new Set(kategoriler.map((k) => k.id));
    const kosul = t.vknTckn ? { vknTckn: t.vknTckn } : t.saticiUnvan ? { saticiUnvan: { equals: t.saticiUnvan, mode: "insensitive" as const } } : null;
    if (kosul) {
      const onceki = await this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.findMany({ where: kosul, select: { kategoriId: true }, orderBy: { createdAt: "desc" }, take: 5 }));
      const bulunan = onceki.find((m) => etkin.has(m.kategoriId));
      if (bulunan) return bulunan.kategoriId;
    }
    return kategoriAdlaBul(oneri, kategoriler);
  }

  private async taslakAc(t: MasrafTaslagi, kategoriId: string, ekId: string, uyarilar: string[]): Promise<BelgeSonucu> {
    const r = await this.yurutucu.yurut({ ad: TASLAK_ARACI, girdi: { ...t, kategoriId } }, this.izinli(), { kaynak: "asistan" });
    if (r.hata) throw new BadRequestException(`Masraf taslağı açılamadı: ${r.icerik.replace(/^Hata: /, "").slice(0, 200)}`);
    const masraf = JSON.parse(r.icerik) as { id: string; adres?: string };
    // Görsel masrafın ekine kopyalanır; kopyalanamazsa taslak yine geçerlidir (görsel sohbet ekinde kalır).
    try {
      const { ek, icerik } = await this.ekler.indir(ekId);
      await this.ekler.yukle("masraf", masraf.id, { originalname: ek.dosyaAdi, mimetype: ek.mimeTip, size: icerik.length, buffer: icerik });
    } catch (hata) {
      this.logger.warn(`Fiş görseli masrafa eklenemedi: ${hata instanceof Error ? hata.name : "bilinmeyen"}`);
    }
    const kategori = await this.prisma.tenantIslem(aktifBaglam().tenantId, (tx) => tx.masrafKategori.findUnique({ where: { id: kategoriId }, select: { ad: true } }));
    const tutar = `${t.toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t.dovizCinsi === "TRY" ? "TL" : t.dovizCinsi}`;
    const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
    const satirlar = [
      `🧾 Masraf taslağı açıldı: ${t.saticiUnvan ?? "satıcı okunamadı"} · ${t.tarih ? t.tarih.split("-").reverse().join(".") : "bugün"} · ${tutar} (KDV %${t.kdvOrani}) · ${kategori?.ad ?? "kategori"}.`,
      ...uyarilar.map((u) => `⚠️ ${u}`),
      `Kontrol edip panelden onaylayın: ${panel}${masraf.adres ?? "/panel/masraflar"}`,
    ];
    return { sonuc: satirlar.join("\n"), masrafId: masraf.id };
  }

  /** CNL-10: kategori sorusunun yanıtı; seçilen kategori satıcının sonraki belgelerinde kendiliğinden kullanılır. */
  async kategoriSecildi(soru: AsistanSorusu, kod: string | undefined, metin: string | undefined): Promise<string> {
    const veri = soru.veri as unknown as KategoriSorusuVerisi;
    let kategoriId: string | null = kod?.startsWith("kat") ? veri.kategoriler[Number(kod.slice(3))]?.id ?? null : null;
    if (!kategoriId) {
      const tum = await this.kategoriler();
      kategoriId = kategoriAdlaBul(metin, tum);
      if (!kategoriId) throw new BadRequestException(`“${metin ?? ""}” ile tek bir kategori eşleşmedi; kategori adını tam yazın ya da düğmeden seçin.`);
    }
    return (await this.taslakAc(veri.taslak, kategoriId, veri.ekId, veri.uyarilar)).sonuc;
  }
}
