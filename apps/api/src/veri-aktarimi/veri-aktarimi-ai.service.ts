import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import * as ExcelJS from "exceljs";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { kiraciSaglayicisi } from "../ai/saglayici/kiraci-saglayici";
import { CARI_SUTUNLARI } from "../cari/cari-ice-aktarma";
import { ACIK_FATURA_SUTUNLARI } from "./adim-acik-fatura";
import { ACILIS_STOK_SUTUNLARI } from "./adim-acilis-stok";
import { KASA_BANKA_SUTUNLARI } from "./adim-kasa-banka";
import { STOK_SUTUNLARI } from "./adim-stok";
import { type Adim } from "./adim";
import { hucreMetni, tabloOku, type SutunTanimi } from "./tablo";

const SUTUNLAR: Record<Adim, readonly SutunTanimi[]> = {
  cari: CARI_SUTUNLARI,
  stok: STOK_SUTUNLARI,
  acilis_stok: ACILIS_STOK_SUTUNLARI,
  kasa_banka: KASA_BANKA_SUTUNLARI,
  acik_fatura: ACIK_FATURA_SUTUNLARI,
};

export interface AiKolonOnerisi {
  baslik: string;
  anahtar: string | null;
  alanBaslik: string | null;
  guven: number;
  gerekce: string;
}

const aiOneriSemasi = z.object({
  oneriler: z.array(
    z.object({
      baslik: z.string().describe("Dosyadaki sütun başlığı"),
      anahtar: z.string().describe("Eşleşen hedef alan anahtarı veya boş string"),
      guven: z.number().min(0).max(100).describe("0-100 arası güven skoru"),
      gerekce: z.string().describe("Eşleme gerekçesi"),
    }),
  ),
});

/**
 * Hassas verileri (VKN, TCKN, IBAN, e-posta, telefon) AI modeline göndermeden önce maskeler.
 */
export function ornekDegeriMaskele(deger: string): string {
  const temiz = deger.trim();
  if (!temiz) return "";

  // IBAN
  if (/^TR\d{2}/i.test(temiz.replace(/\s+/g, ""))) {
    const s = temiz.replace(/\s+/g, "");
    return `TR** **** **** **** **** **${s.slice(-4)}`;
  }

  // Telefon (başında 0 ya da +90 olan veya 10-13 haneli cep numarası) - VKN/TCKN'den önce kontrol edilir
  if (/^(\+90|0)?5\d{9}$/.test(temiz.replace(/[\s().-]/g, ""))) {
    const rakamlar = temiz.replace(/\D/g, "");
    return `***${rakamlar.slice(-4)}`;
  }

  // TCKN (11 hane) veya VKN (10 hane)
  if (/^\d{10,11}$/.test(temiz)) {
    return `******${temiz.slice(-4)}`;
  }

  // E-posta
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(temiz)) {
    const [yerel, alan] = temiz.split("@");
    return `${yerel[0]}***@${alan}`;
  }

  // Normal metinler için en fazla 40 karakter
  return temiz.slice(0, 40);
}

/**
 * İlk 5 satıra saplanmadan, dosyadaki çeşitli dolu satırlardan maskelenmiş 3-5 örnek toplar.
 */
export function ornekleriTopla(
  sayfa: ExcelJS.Worksheet,
  sutunNo: number,
  azamiAdet = 4,
): string[] {
  const ornekler: string[] = [];
  const benzersiz = new Set<string>();
  const toplamSatir = sayfa.rowCount;
  if (toplamSatir <= 1) return [];

  // Farklı satırlardan örnek almak için adımlı tarama (stratified sampling)
  const adimAraligi = Math.max(1, Math.floor((toplamSatir - 1) / (azamiAdet * 3)));

  for (let r = 2; r <= toplamSatir && ornekler.length < azamiAdet; r += adimAraligi) {
    const hucre = sayfa.getRow(r).getCell(sutunNo);
    const metin = hucreMetni(hucre.value);
    if (metin && !benzersiz.has(metin)) {
      benzersiz.add(metin);
      ornekler.push(ornekDegeriMaskele(metin));
    }
  }

  // Yeterli örnek bulunamadıysa baştan dolu olanları topla
  if (ornekler.length < azamiAdet) {
    for (let r = 2; r <= Math.min(toplamSatir, 50) && ornekler.length < azamiAdet; r++) {
      const hucre = sayfa.getRow(r).getCell(sutunNo);
      const metin = hucreMetni(hucre.value);
      if (metin && !benzersiz.has(metin)) {
        benzersiz.add(metin);
        ornekler.push(ornekDegeriMaskele(metin));
      }
    }
  }

  return ornekler;
}

/**
 * Deterministik format/tip kontrolü (Kural 5):
 * Modelin önerdiği anahtarın veri tipiyle örnek değerler çelişiyorsa güveni düşürür veya reddeder.
 */
export function tipUyumlulugunuDogrula(anahtar: string, ornekler: string[]): { gecerli: boolean; gerekceEk?: string } {
  if (!ornekler.length) return { gecerli: true };

  // Sayısal / Tutar / Miktar alanları
  const sayisalAlanlar = new Set(["bakiye", "tutar", "miktar", "birimMaliyet", "alisFiyati", "satisFiyati", "riskLimiti", "iskontoOrani", "kdvOrani"]);
  if (sayisalAlanlar.has(anahtar)) {
    const sayiMi = ornekler.some((o) => /^[-+]?\d+([.,]\d+)?$/.test(o.replace(/\s+/g, "")));
    if (!sayiMi) {
      return { gecerli: false, gerekceEk: "Örnek değerler sayısal formatta değil" };
    }
  }

  // Tarih alanları
  const tarihAlanlari = new Set(["tarih", "vade", "belgeTarihi", "sonKullanmaTarihi", "acilisTarihi"]);
  if (tarihAlanlari.has(anahtar)) {
    const tarihMi = ornekler.some((o) => /^\d{4}-\d{2}-\d{2}$/.test(o) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(o));
    if (!tarihMi) {
      return { gecerli: false, gerekceEk: "Örnek değerler geçerli tarih formatında değil" };
    }
  }

  // Kimlik / Vergi alanları
  if (anahtar === "vknTckn") {
    // Maskelenmiş veya maskelenmemiş rakamlar
    const kimlikMi = ornekler.some((o) => o.includes("******") || /^\d{10,11}$/.test(o));
    if (!kimlikMi) {
      return { gecerli: false, gerekceEk: "Örnek değerler VKN/TCKN biçiminde görünmüyor" };
    }
  }

  return { gecerli: true };
}

@Injectable()
export class VeriAktarimiAiService {
  private readonly logger = new Logger(VeriAktarimiAiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * P-13: Veri göçünde tanınmayan sütunlar için yapay zekâ kolon önerisi üretir.
   * Yalnızca `tablo.ts` sözlüğünün tanımadığı kolonlar için model çağrılır.
   */
  async kolonOnerisiUret(
    adim: Adim,
    buffer: Buffer,
    mevcutEslemeler: Record<string, string> = {},
  ): Promise<{ oneriler: AiKolonOnerisi[]; taninmayanSayisi: number; onerilenSayisi: number }> {
    const sutunlar = SUTUNLAR[adim];
    if (!sutunlar) {
      throw new Error(`Geçersiz aktarım adımı: ${adim}`);
    }

    // 1. Tabloyu mevcut sözlük ve eşlemelerle oku
    const okunan = await tabloOku(buffer, sutunlar, mevcutEslemeler);
    const taninmayanlar = okunan.taninmayanlar;

    // Tanınmayan sütun yoksa AI çağırmaya gerek yok (maliyet ve gecikme freni)
    if (!taninmayanlar.length) {
      return { oneriler: [], taninmayanSayisi: 0, onerilenSayisi: 0 };
    }

    // 2. Excel çalışma sayfasını aç ve tanınmayan sütunlar için örnekler topla
    const kitap = new ExcelJS.Workbook();
    await kitap.xlsx.load(buffer as unknown as ArrayBuffer);
    const sayfa = kitap.worksheets[0];
    if (!sayfa) {
      return { oneriler: [], taninmayanSayisi: taninmayanlar.length, onerilenSayisi: 0 };
    }

    // Başlıkların sütun indekslerini bul
    const baslikSutunHaritasi = new Map<string, number>();
    sayfa.getRow(1).eachCell({ includeEmpty: false }, (hucre, no) => {
      const b = hucreMetni(hucre.value);
      if (b) baslikSutunHaritasi.set(b, no);
    });

    const sutunOrnekleri: Array<{ baslik: string; ornekler: string[] }> = [];
    for (const t of taninmayanlar) {
      const no = baslikSutunHaritasi.get(t);
      const ornekler = no ? ornekleriTopla(sayfa, no, 4) : [];
      sutunOrnekleri.push({ baslik: t, ornekler });
    }

    // 3. Kullanılabilir hedef alanları belirle (zaten eşlenmiş alanları hariç tutabiliriz)
    const kullanilanAnahtarlar = new Set(
      okunan.basliklar.map((b) => b.anahtar).filter(Boolean) as string[],
    );
    const adayAlanlar = sutunlar.map((s) => ({
      anahtar: s.anahtar,
      baslik: s.baslik,
      aciklama: s.aciklama,
      ornek: s.ornek,
      kullanildi: kullanilanAnahtarlar.has(s.anahtar),
    }));

    // 4. Kiracı sağlayıcısını çöz
    const { tenantId } = aktifBaglam();
    const { saglayici } = await kiraciSaglayicisi(this.prisma, tenantId, {
      ozellik: "asistan",
      ekonomikModel: true, // Hızlı ve ekonomik model yeterlidir
    });

    const prompt = `Sen bir kurumsal ERP ve veri aktarım uzmanısın. Kullanıcı TekirExtra sistemine "${adim}" adımı için Excel yükledi.
Aşağıda TekirExtra hedef alanları ve dosyada tanınmayan sütun başlıkları (örnek maskelenmiş değerleriyle birlikte) verilmiştir.
Tanınmayan sütunları hedef alanlarla eşleştir.

HEDEF ALANLAR:
${adayAlanlar.map((a) => `- ${a.anahtar} (${a.baslik}): ${a.aciklama} [Örnek: ${a.ornek}] ${a.kullanildi ? "(zaten başka sütuna eşli)" : ""}`).join("\n")}

TANIMNAYAN SÜTUNLAR VE MASKELENMİŞ ÖRNEKLER:
${sutunOrnekleri.map((s) => `- Sütun: "${s.baslik}" -> Örnekler: [${s.ornekler.join(", ") || "boş"}]`).join("\n")}

KURALLAR:
1. Yalnızca hedef alanlar listesindeki "anahtar" değerlerinden birini seç. Uygun eşleşme yoksa anahtar olarak "" (boş string) dön.
2. Güven skorunu 0-100 arasında ver (100 = kesin eşleşme, 50 = zayıf tahmin).
3. Gerekçeyi Türkçe ve kısa yaz (örn. "Logo Cari kodu ile eşleşiyor", "Örnek veriler vergi numarası formatında").
4. Aynı hedef alana ("anahtar") birden fazla sütun atama; en iyi uyanı seç.
5. Kullanıcı bu önerileri onaylamadan hiçbir veri sisteme kaydedilmeyecektir.`;

    let yanit: z.infer<typeof aiOneriSemasi>;
    try {
      yanit = await saglayici.yapilandirilmisUretim(
        {
          sistemRol: "ERP veri aktarım ve kolon eşleme uzmanı.",
          prompt,
          dusunmeKapali: true,
        },
        aiOneriSemasi,
      );
    } catch (err) {
      this.logger.warn(`AI kolon önerisi alınamadı: ${err instanceof Error ? err.message : String(err)}`);
      return { oneriler: [], taninmayanSayisi: taninmayanlar.length, onerilenSayisi: 0 };
    }

    // 5. Deterministik Filtreleme ve Çakışma Yönetimi
    const gecerliAlanlar = new Map(sutunlar.map((s) => [s.anahtar, s.baslik]));
    const nihaiOneriler: AiKolonOnerisi[] = [];
    const atanmisAnahtarlar = new Map<string, { baslik: string; guven: number; indeks: number }>();

    for (const oneri of yanit.oneriler) {
      const sutunBilgisi = sutunOrnekleri.find((s) => s.baslik === oneri.baslik);
      const ornekler = sutunBilgisi?.ornekler ?? [];

      let anahtar = oneri.anahtar.trim();
      let guven = Math.max(0, Math.min(100, Math.round(oneri.guven)));
      let gerekce = oneri.gerekce;

      // Geçerli bir anahtar mı?
      if (!anahtar || !gecerliAlanlar.has(anahtar)) {
        anahtar = "";
        guven = 0;
      } else {
        // Tip/Format doğrulaması (deterministik kural)
        const tipKontrol = tipUyumlulugunuDogrula(anahtar, ornekler);
        if (!tipKontrol.gecerli) {
          guven = Math.min(guven, 30);
          gerekce += ` (Uyarı: ${tipKontrol.gerekceEk})`;
        }
      }

      // Çakışma kontrolü: Aynı alana birden çok öneri geldiyse daha yüksek güvenli olanı tut
      if (anahtar && atanmisAnahtarlar.has(anahtar)) {
        const onceki = atanmisAnahtarlar.get(anahtar)!;
        if (guven > onceki.guven) {
          // Önceki öneriyi boşa çıkar
          nihaiOneriler[onceki.indeks].anahtar = null;
          nihaiOneriler[onceki.indeks].alanBaslik = null;
          nihaiOneriler[onceki.indeks].guven = 0;
          nihaiOneriler[onceki.indeks].gerekce += " (Daha yüksek güvenli başka bir sütun eşlendi)";
          atanmisAnahtarlar.set(anahtar, { baslik: oneri.baslik, guven, indeks: nihaiOneriler.length });
        } else {
          // Şimdiki öneriyi boşa çıkar
          anahtar = "";
          guven = 0;
          gerekce += " (Bu alan başka bir sütuna daha yüksek güvenle eşlendi)";
        }
      } else if (anahtar) {
        atanmisAnahtarlar.set(anahtar, { baslik: oneri.baslik, guven, indeks: nihaiOneriler.length });
      }

      nihaiOneriler.push({
        baslik: oneri.baslik,
        anahtar: anahtar || null,
        alanBaslik: anahtar ? gecerliAlanlar.get(anahtar) ?? null : null,
        guven,
        gerekce,
      });
    }

    const onerilenSayisi = nihaiOneriler.filter((o) => Boolean(o.anahtar)).length;
    return {
      oneriler: nihaiOneriler,
      taninmayanSayisi: taninmayanlar.length,
      onerilenSayisi,
    };
  }
}
