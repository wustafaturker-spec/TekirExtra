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
import {
  BELGE_AZAMI_BAYT, kategoriAdlaBul, kategoriSorusu, masrafTaslagi, odemeSorusu, tamamlamaPlani, type FistenOkunan, type MasrafTaslagi, type TamamlamaPlani,
} from "./masraf-belge.kurallari";

const TASLAK_ARACI = "masraf_taslagi_olustur";
const UZANTI: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

interface KategoriSorusuVerisi { taslak: MasrafTaslagi; uyarilar: string[]; ekId: string; kategoriler: Array<{ id: string; ad: string }>; okunan?: FistenOkunan }
interface OdemeSorusuVerisi { masrafId: string; hesaplar: Array<{ id: string; ad: string }>; tur: "kasa" | "kart"; arac?: TamamlamaPlani["arac"] }
export interface SoruOzeti { id: string; soru: string; secenekler: Secenek[]; serbestYanit: boolean }
export interface BelgeSonucu { sonuc: string; masrafId?: string; talepId?: string; soru?: SoruOzeti }

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

  async belgedenMasraf(dosya: { ad: string; buffer: Buffer }, not: string | null, kanal: "TELEGRAM" | "WEB" = "TELEGRAM"): Promise<BelgeSonucu> {
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
    const ek = await this.ekler.yukle("ai_sohbet", await this.ajan.belgeOturumKimligi(kanal), yuklenen);

    const ocr = await this.ai.fisFaturaOcrTara(tenantId, { ...girdi, belgeTipi: "fis_fatura" });
    if (!ocr.dogrulama.gecerli || ocr.dogrulama.hatalar.length || !(ocr.dogrulama.veri.genelToplam > 0)) {
      throw new BadRequestException(`Belgeden tutar güvenle okunamadı${ocr.dogrulama.hatalar.length ? ` (${ocr.dogrulama.hatalar.join("; ").slice(0, 200)})` : ""}. Daha net bir fotoğraf gönderin ya da panelden girin.`);
    }
    const { taslak, uyarilar } = masrafTaslagi(ocr.dogrulama.veri, ocr.eslesenCari?.id ?? null, not);
    const v = ocr.dogrulama.veri;
    const okunan: FistenOkunan = { plaka: v.plaka ?? null, litre: v.litre ?? null, odemeSekli: v.odemeSekli ?? null, kartSonDort: v.kartSonDort ?? null };
    uyarilar.push(...ocr.dogrulama.uyarilar.slice(0, 3));
    const kategoriler = await this.kategoriler();
    if (!kategoriler.length) throw new BadRequestException("Firmada etkin masraf kategorisi yok; önce panelden kategori tanımlayın.");
    const kategoriId = await this.kategoriBul(taslak, ocr.onerilenMasrafKategorisi, kategoriler);
    if (kategoriId) return this.taslakAc(taslak, kategoriId, ek.id, uyarilar, okunan);

    const s = kategoriSorusu(taslak, kategoriler);
    const veri: KategoriSorusuVerisi = { taslak, uyarilar, ekId: ek.id, kategoriler: kategoriler.slice(0, 5), okunan };
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

  private async taslakAc(t: MasrafTaslagi, kategoriId: string, ekId: string, uyarilar: string[], okunan: FistenOkunan = {}): Promise<BelgeSonucu> {
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
    // CNL-21/22: plaka, ödeme şekli ve kart son dört hanesi firmanın kayıtlarıyla eşleştirilir.
    const plan = await this.planHazirla(okunan, t, kategori?.ad ?? "");
    const satirlar = [
      `🧾 Masraf taslağı açıldı: ${t.saticiUnvan ?? "satıcı okunamadı"} · ${t.tarih ? t.tarih.split("-").reverse().join(".") : "bugün"} · ${tutar} (KDV %${t.kdvOrani}) · ${kategori?.ad ?? "kategori"}.`,
      ...uyarilar.map((u) => `⚠️ ${u}`),
      ...plan.notlar.map((n) => `ℹ️ ${n}`),
    ];
    if (plan.soru) {
      const s = odemeSorusu(t, plan.soru, okunan.kartSonDort);
      const veri: OdemeSorusuVerisi = { masrafId: masraf.id, hesaplar: plan.soru.hesaplar, tur: plan.soru.tur, ...(plan.arac ? { arac: plan.arac } : {}) };
      const { tenantId, userId } = aktifBaglam();
      const soru = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.create({ data: {
        tenantId, tur: "masraf_odeme", kaynakId: masraf.id, userId, soru: s.soru, secenekler: s.secenekler as unknown as Prisma.InputJsonValue, veri: veri as unknown as Prisma.InputJsonValue, serbestYanit: false,
      } }));
      return { sonuc: satirlar.join("\n"), masrafId: masraf.id, soru: { id: soru.id, soru: soru.soru, secenekler: s.secenekler, serbestYanit: false } };
    }
    const talep = await this.tamamlamaTalebi(masraf.id, plan);
    satirlar.push(talep
      ? `✅ Tek dokunuşla tamamlamak için onay talebi açıldı (${talep.ozet}): ${panel}/panel/ai?talep=${talep.id}`
      : `Kontrol edip panelden onaylayın: ${panel}${masraf.adres ?? "/panel/masraflar"}`);
    return { sonuc: satirlar.join("\n"), masrafId: masraf.id, ...(talep ? { talepId: talep.id } : {}) };
  }

  private async planHazirla(okunan: FistenOkunan, t: MasrafTaslagi, kategoriAdi: string): Promise<TamamlamaPlani> {
    if (!okunan.plaka && !okunan.odemeSekli) return { notlar: [] };
    const { tenantId } = aktifBaglam();
    const [kartlar, kasalar, araclar] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.krediKarti.findMany({ select: { id: true, ad: true, sonDortHane: true, dovizCinsi: true, aktif: true } }),
      tx.kasa.findMany({ select: { id: true, ad: true, dovizCinsi: true, aktif: true } }),
      okunan.plaka ? tx.arac.findMany({ select: { id: true, plaka: true, aktif: true } }) : Promise.resolve([]),
    ]));
    return tamamlamaPlani(okunan, { cariBagli: !!t.cariId, dovizCinsi: t.dovizCinsi, kategoriAdi }, kartlar.map((k) => ({ ...k, dovizCinsi: String(k.dovizCinsi) })), kasalar.map((k) => ({ ...k, dovizCinsi: String(k.dovizCinsi) })), araclar);
  }

  /** CNL-22: onay + ödeme + araç bağı tek onay talebi; panelde onaylanınca çalışır. Yapılacak bir şey yoksa null. */
  private async tamamlamaTalebi(masrafId: string, plan: Pick<TamamlamaPlani, "odeme" | "arac">): Promise<{ id: string; ozet: string } | null> {
    if (!plan.odeme && !plan.arac) return null;
    const girdi = {
      masrafId,
      ...(plan.odeme ? { odeme: { tur: plan.odeme.tur, hesapId: plan.odeme.hesapId } } : {}),
      ...(plan.arac ? { arac: { aracId: plan.arac.aracId, kategori: plan.arac.kategori, ...(plan.arac.litre ? { litre: plan.arac.litre } : {}) } } : {}),
    };
    const r = await this.yurutucu.yurut({ ad: "masraf_tamamla", girdi }, this.izinli(), { kaynak: "asistan" });
    if (r.hata || !r.talep) {
      this.logger.warn(`Masraf tamamlama talebi açılamadı: ${r.icerik.slice(0, 120)}`);
      return null;
    }
    const ozet = [plan.odeme ? `ödeme: ${plan.odeme.ad}` : null, plan.arac ? `araç: ${plan.arac.plaka}${plan.arac.litre ? ` ${plan.arac.litre} L` : ""}` : null].filter(Boolean).join(", ");
    return { id: r.talep.id, ozet };
  }

  /** CNL-22: belirsiz ödeme hesabı sorusunun yanıtı; seçimle tamamlama onay talebi açılır. */
  async odemeSecildi(soru: AsistanSorusu, kod: string | undefined): Promise<{ sonuc: string; talepId?: string }> {
    const veri = soru.veri as unknown as OdemeSorusuVerisi;
    const secilen = kod?.startsWith("h") ? veri.hesaplar[Number(kod.slice(1))] : undefined;
    if (kod !== "sirket_degil" && !secilen) throw new BadRequestException("Geçersiz seçenek.");
    const plan = { ...(secilen ? { odeme: { tur: veri.tur, hesapId: secilen.id, ad: secilen.ad } } : {}), ...(veri.arac ? { arac: veri.arac } : {}) };
    const talep = await this.tamamlamaTalebi(veri.masrafId, plan);
    const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
    if (!talep) return { sonuc: "Not alındı; ödemeyi panelde masrafın “Öde” düğmesinden seçebilirsiniz." };
    return { sonuc: `Onay talebi açıldı (${talep.ozet}); panelde tek dokunuşla onaylayın: ${panel}/panel/ai?talep=${talep.id}`, talepId: talep.id };
  }

  /** CNL-10: kategori sorusunun yanıtı; seçilen kategori satıcının sonraki belgelerinde kendiliğinden kullanılır. */
  async kategoriSecildi(soru: AsistanSorusu, kod: string | undefined, metin: string | undefined): Promise<BelgeSonucu> {
    const veri = soru.veri as unknown as KategoriSorusuVerisi;
    let kategoriId: string | null = kod?.startsWith("kat") ? veri.kategoriler[Number(kod.slice(3))]?.id ?? null : null;
    if (!kategoriId) {
      const tum = await this.kategoriler();
      kategoriId = kategoriAdlaBul(metin, tum);
      if (!kategoriId) throw new BadRequestException(`“${metin ?? ""}” ile tek bir kategori eşleşmedi; kategori adını tam yazın ya da düğmeden seçin.`);
    }
    return this.taslakAc(veri.taslak, kategoriId, veri.ekId, veri.uyarilar, veri.okunan ?? {});
  }
}
