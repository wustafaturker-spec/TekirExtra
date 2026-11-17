import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, type AsistanSorusu, type Rol } from "@prisma/client";
import { AracYurutucu } from "../ai/ajan/arac-yurutucu";
import { ocrGirdisiOlustur } from "../ai/ai.semalar";
import { AiService } from "../ai/ai.service";
import { dosyaIceriginiDogrula } from "../core/guvenlik/dosya-dogrulama";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { BelgeSonucu } from "./masraf-belge.service";
import { BELGE_AZAMI_BAYT } from "./masraf-belge.kurallari";
import {
  CARI_TIP_ADLARI, cariBilgisiYeterli, cariOzeti, cariTaslagi, cariTipSorusu, sonrakiCariKodu, type CariBelgeTipi, type CariTaslagi,
} from "./cari-belge.kurallari";

const CARI_ARACI = "cari_olustur";
const UZANTI: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Açıklamasız görselde cari bilgisi de yetersizse (fiş de değil, cari kartı da değil). */
export class CariBilgisiYetersizHatasi extends BadRequestException {}

interface CariTipSorusuVerisi { taslak: Omit<CariTaslagi, "kod" | "tip">; uyarilar: string[] }

/**
 * CNL-23: Telegram'a gelen cari bilgi kartı / kartvizit görselinden cari kartı. Sıra: rol (cari_olustur
 * açık mı) → içerik ve virüs denetimi → cari bilgisi okuma → aynı VKN/e-posta varsa yeni kart yok →
 * tür açıklamada yoksa sorulur → cari_olustur onay talebi (kart, kullanıcı onaylayınca açılır).
 * Görsel saklanmaz; okunan bilgiler onay talebinde görünür.
 */
@Injectable()
export class CariBelgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly yurutucu: AracYurutucu,
  ) {}

  private izinli() {
    return new Map(this.yurutucu.izinliAraclar(aktifBaglam().rol as Rol).map((a) => [a.ad, a]));
  }

  yetkiVar(): boolean {
    return this.izinli().has(CARI_ARACI);
  }

  yetkiDenetle(): void {
    if (!this.yetkiVar()) throw new ForbiddenException("Rolünüz ya da paketiniz cari kartı açmaya izin vermiyor; cariyi panelden ekletin.");
  }

  /**
   * @param tip açıklamadan çıkan tür; yoksa sorulur.
   * @param kesin false ise (açıklamasız görselin geri dönüşü) bilgi yetersizse CariBilgisiYetersizHatasi.
   */
  async belgedenCari(dosya: { ad: string; buffer: Buffer }, tip: CariBelgeTipi | undefined, kesin: boolean, kanal: "TELEGRAM" | "WEB" = "TELEGRAM"): Promise<BelgeSonucu> {
    const { tenantId, userId } = aktifBaglam();
    this.yetkiDenetle();
    if (dosya.buffer.length > BELGE_AZAMI_BAYT) throw new BadRequestException("Dosya 6 MB'tan büyük; daha küçük bir fotoğraf gönderin.");
    const girdi = ocrGirdisiOlustur(dosya.buffer);
    if (!girdi) throw new BadRequestException("Bu dosya okunamaz; JPEG, PNG, WebP fotoğraf ya da PDF gönderin.");
    const ad = /\.[a-z0-9]{2,4}$/i.test(dosya.ad) ? dosya.ad : `${dosya.ad}.${UZANTI[girdi.mimeType]}`;
    await dosyaIceriginiDogrula({ originalname: ad, mimetype: girdi.mimeType, buffer: dosya.buffer }, "belge");

    const ocr = await this.ai.cariBilgisiCikar(tenantId, { ...girdi, belgeTipi: "cari_bilgisi" }, kanal);
    const v = ocr.dogrulama.veri;
    if (!ocr.dogrulama.gecerli || !cariBilgisiYeterli(v)) {
      if (!kesin) throw new CariBilgisiYetersizHatasi("Belgede tutar bulunamadı. Fiş değilse açıklamaya “cari aç” yazarak yeniden gönderin.");
      throw new BadRequestException("Görselden firma unvanı ile vergi no, vergi dairesi ya da e-posta okunamadı. Daha net bir fotoğraf gönderin ya da cariyi panelden ekleyin.");
    }
    if (ocr.mevcutCari) {
      const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
      return { sonuc: `Bu cari zaten kayıtlı: ${ocr.mevcutCari.unvan} (${ocr.mevcutCari.kod}). Yeni kart açmadım.\n${panel}/panel/cari/${ocr.mevcutCari.id}` };
    }
    const { kod: _k, tip: _t, ...taslak } = cariTaslagi(v, "", "musteri");
    const uyarilar = ocr.dogrulama.uyarilar.slice(0, 3);
    if (tip) return this.talepAc(taslak, tip, uyarilar);

    const s = cariTipSorusu(taslak);
    const veri: CariTipSorusuVerisi = { taslak, uyarilar };
    const soru = await this.prisma.tenantIslem(tenantId, (tx) => tx.asistanSorusu.create({ data: {
      tenantId, tur: "cari_tip", kaynakId: randomUUID(), userId, soru: s.soru, secenekler: s.secenekler as unknown as Prisma.InputJsonValue, veri: veri as unknown as Prisma.InputJsonValue, serbestYanit: false,
    } }));
    return { sonuc: "", soru: { id: soru.id, soru: soru.soru, secenekler: s.secenekler, serbestYanit: false } };
  }

  /** Tür sorusunun yanıtı. */
  async tipSecildi(soru: AsistanSorusu, kod: string | undefined): Promise<{ sonuc: string; talepId?: string }> {
    if (!kod || !(kod in CARI_TIP_ADLARI)) throw new BadRequestException("Geçersiz seçenek.");
    const veri = soru.veri as unknown as CariTipSorusuVerisi;
    return this.talepAc(veri.taslak, kod as CariBelgeTipi, veri.uyarilar ?? []);
  }

  private async talepAc(taslak: Omit<CariTaslagi, "kod" | "tip">, tip: CariBelgeTipi, uyarilar: string[]): Promise<{ sonuc: string; talepId?: string }> {
    const { tenantId } = aktifBaglam();
    const kodlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({ select: { kod: true } }));
    const girdi: CariTaslagi = { ...taslak, kod: sonrakiCariKodu(kodlar.map((k) => k.kod)), tip };
    const r = await this.yurutucu.yurut({ ad: CARI_ARACI, girdi }, this.izinli(), { kaynak: "asistan" });
    if (r.hata || !r.talep) throw new BadRequestException(`Cari onay talebi açılamadı: ${r.icerik.replace(/^Hata: /, "").slice(0, 200)}`);
    const panel = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/+$/, "");
    return {
      sonuc: [
        `🏢 Cari kartı onayınıza sunuldu (${CARI_TIP_ADLARI[tip]}, kod ${girdi.kod}): ${cariOzeti(taslak)}.`,
        ...uyarilar.map((u) => `⚠️ ${u}`),
        `Onaylayınca kart açılır: ${panel}/panel/ai?talep=${r.talep.id}`,
      ].join("\n"),
      talepId: r.talep.id,
    };
  }
}
