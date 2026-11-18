"use client";

import { useEffect } from "react";

/** AI-78: asistanın açıldığı ekranın kayıt türleri (sunucudaki EKRAN_TURLERI ile aynı). */
export type EkranTuru = "cari" | "stok" | "fatura" | "belge" | "gelen_efatura" | "gelen_eirsaliye" | "satin_alma_talebi" | "rapor";

/** CARI-48/AI-78/P-14a: asistanın açıldığı ekranın kaydı; sunucu kimliği o kaydın ekran ucundan rol kontrolüyle doğrular. */
export interface AsistanBaglami {
  tur: EkranTuru;
  /** Kayıt kimliği; raporda katalog kodu. */
  id: string;
  /** Rozet adı (fatura no, cari unvanı…). */
  etiket: string;
  /** P-14a: Açık formdaki kaydedilmemiş taslak veriler (güvenilmeyen istemci taslağı) */
  taslak?: Record<string, unknown>;
  /** P-14a: Doğrudan tetiklenen ekran eylemi kodu (ör. cari_analiz, fatura_fiyat_sapmasi, teklif_revize) */
  eylem?: string;
  /** P-14a: Asistan penceresi açıldığında doğrudan gönderilecek hazır talimat */
  ilkMesaj?: string;
}

export interface EkranEylemi {
  kod: string;
  etiket: string;
  mesaj: string;
  simge?: string;
}

/** P-14a: Ekran bağlamına özel doğrudan tetiklenebilir akıllı eylemler. */
export const EKRAN_EYLEMLERI: Record<EkranTuru, EkranEylemi[]> = {
  cari: [
    { kod: "cari_analiz", etiket: "Bu cariyi analiz et", mesaj: "Bu cariyi analiz et: ödeme performansı, tahsilat riski ve yaşlandırma durumunu çıkar.", simge: "📊" },
    { kod: "tahsilat_riski", etiket: "Tahsilat riskini göster", mesaj: "Bu carinin tahsilat riskini ve açık faturaların beklenen vadelerini göster.", simge: "⚠️" },
    { kod: "cari_ekstre", etiket: "Ekstreyi özetle", mesaj: "Bu carinin son hareketlerini ve açık bakiyesini özetle.", simge: "📄" },
  ],
  fatura: [
    { kod: "fatura_fiyat_sapmasi", etiket: "Fiyat sapmasını açıkla", mesaj: "Bu faturadaki kalemlerin birim fiyatlarını liste ve tavsiye fiyatlarıyla karşılaştırarak fiyat sapmasını açıkla.", simge: "📈" },
    { kod: "fatura_kontrol", etiket: "Bu faturayı denetle", mesaj: "Bu faturayı kontrol et: KDV oranları, kalem tutarları ve tahsilat durumunda anomali var mı?", simge: "🔍" },
    { kod: "fatura_tahsilat", etiket: "Tahsilat durumu", mesaj: "Bu faturanın tahsilat ve kapama geçmişini özetle.", simge: "💳" },
  ],
  belge: [
    { kod: "teklif_revize", etiket: "Bu teklifi revize et", mesaj: "Bu teklifi revize et: yeni bir taslak revizyon oluştur ve parasal değişiklikleri hazırla.", simge: "📝" },
    { kod: "belge_analiz", etiket: "Kalemleri analiz et", mesaj: "Bu belgenin kalemlerini, birim fiyatlarını ve iskonto oranlarını analiz et.", simge: "📊" },
  ],
  stok: [
    { kod: "endeks_karsilastir", etiket: "Fiyat-Endeks analizi", mesaj: "Bu ürünün satış fiyatı seyrini enflasyon ve kur endeksleriyle karşılaştır.", simge: "📈" },
    { kod: "stok_hareket", etiket: "Stok hareketleri", mesaj: "Bu ürünün mevcut stok miktarını, depo dağılımını ve son hareketlerini özetle.", simge: "📦" },
  ],
  gelen_efatura: [
    { kod: "fiyat_karsilastir", etiket: "Alış fiyatlarını kontrol et", mesaj: "Bu gelen faturadaki kalemlerin birim fiyatlarını tedarikçiden geçmiş alışlarımızla karşılaştır.", simge: "🔍" },
    { kod: "efatura_denetle", etiket: "e-Faturayı denetle", mesaj: "Bu faturadaki vergi, tevkifat ve kalem hesaplarını denetle.", simge: "📋" },
  ],
  gelen_eirsaliye: [
    { kod: "eirsaliye_ozet", etiket: "İrsaliyeyi kontrol et", mesaj: "Bu irsaliyenin içeriğini ve açık siparişlerimizle uyumunu kontrol et.", simge: "🚚" },
  ],
  satin_alma_talebi: [
    { kod: "talep_karsilastir", etiket: "Teklifleri karşılaştır", mesaj: "Bu satın alma talebine bağlı tedarikçi tekliflerini fiyat ve teslimat açısından karşılaştır.", simge: "⚖️" },
  ],
  rapor: [
    { kod: "rapor_yorumla", etiket: "Bu raporu yorumla", mesaj: "Bu raporun sonuçlarını yönetici özeti şeklinde yorumla ve kritik sapmaları belirt.", simge: "💡" },
  ],
};

export const EKRAN_TURU_ADI: Record<EkranTuru, string> = {
  cari: "cari", stok: "stok kartı", fatura: "fatura", belge: "belge", gelen_efatura: "gelen e-Fatura",
  gelen_eirsaliye: "gelen e-İrsaliye", satin_alma_talebi: "satın alma talebi", rapor: "rapor",
};

/** AI-80: ekrana göre hazır öneriler; tıklanınca metin mesaj kutusuna gelir. */
export const EKRAN_ONERILERI: Record<EkranTuru | "genel", string[]> = {
  genel: ["Bugün dikkat etmem gerekenler neler?", "Vadesi geçen alacakları en büyükten sırala", "Onayımı bekleyen işler var mı?", "Bu ayın gelir–gider özeti"],
  cari: ["Bu carinin ekstresini özetle", "Tahsilat riski nedir?", "Açık faturaları ve vadeleri", "Son 5 işlemini göster"],
  stok: ["Bu ürünün stok durumu ve son hareketleri", "Son alış fiyatları ve tedarikçiler", "Satış fiyatı önerisi"],
  fatura: ["Bu faturayı kontrol et", "Benzer faturaları bul", "Bu faturanın tahsilat durumu"],
  belge: ["Bu belgeyi özetle", "Faturaya dönüştürmek için ne gerekiyor?", "Müşteriye e-postayla gönder"],
  gelen_efatura: ["Bu faturayı kontrol et, işlenebilir mi?", "Denetim uyarılarını açıkla", "Bu tedarikçiden son alış fiyatları"],
  gelen_eirsaliye: ["Bu irsaliyeyi özetle", "Yanıt süresi ne zaman doluyor?"],
  satin_alma_talebi: ["Bu talebi özetle", "Teklifleri karşılaştır", "Bütçe durumu ne?"],
  rapor: ["Bu raporu yorumla", "En çok değişen kalemler hangileri?"],
};

export const ASISTAN_AC_OLAYI = "tekir-asistan-ac";

/** P-14a: Asistanı ekrandan açar; doğrudan ekran eylemi, taslak verisi veya ilk mesaj eklenebilir. */
export function asistaniAc(
  baglam?: AsistanBaglami,
  secenekler?: { eylem?: string; ilkMesaj?: string; taslak?: Record<string, unknown> },
) {
  const birlesik: AsistanBaglami | undefined = baglam
    ? {
        ...baglam,
        ...(secenekler?.taslak ? { taslak: secenekler.taslak } : {}),
        ...(secenekler?.eylem ? { eylem: secenekler.eylem } : {}),
        ...(secenekler?.ilkMesaj ? { ilkMesaj: secenekler.ilkMesaj } : {}),
      }
    : undefined;
  window.dispatchEvent(new CustomEvent<AsistanBaglami | undefined>(ASISTAN_AC_OLAYI, { detail: birlesik }));
}

/*
 * AI-78: ekranlar açık kayıtlarını bildirir; asistan hangi düğmeden açılırsa
 * açılsın en son bildirilen kaydı bağlam olarak alır. Ekran kapanınca kayıt
 * silinir (başka ekranın kaydı silinmez).
 */
let sonKayit: AsistanBaglami | null = null;

export function ekranKaydi(): AsistanBaglami | null {
  return sonKayit;
}

export function useEkranKaydi(kayit: AsistanBaglami | null | undefined) {
  const anahtar = kayit ? `${kayit.tur}:${kayit.id}:${kayit.etiket}` : "";
  useEffect(() => {
    if (!kayit) return;
    const bu = { ...kayit };
    sonKayit = bu;
    return () => {
      if (sonKayit && sonKayit.tur === bu.tur && sonKayit.id === bu.id) sonKayit = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kayıt içeriği anahtarla izlenir
  }, [anahtar]);
}
