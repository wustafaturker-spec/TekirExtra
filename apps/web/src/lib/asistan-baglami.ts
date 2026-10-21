"use client";

import { useEffect } from "react";

/** AI-78: asistanın açıldığı ekranın kayıt türleri (sunucudaki EKRAN_TURLERI ile aynı). */
export type EkranTuru = "cari" | "stok" | "fatura" | "belge" | "gelen_efatura" | "gelen_eirsaliye" | "satin_alma_talebi" | "rapor";

/** CARI-48/AI-78: asistanın açıldığı ekranın kaydı; sunucu kimliği o kaydın ekran ucundan rol kontrolüyle doğrular. */
export interface AsistanBaglami {
  tur: EkranTuru;
  /** Kayıt kimliği; raporda katalog kodu. */
  id: string;
  /** Rozet adı (fatura no, cari unvanı…). */
  etiket: string;
}

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

/** Asistanı her ekrandan açar; bağlam verilmezse ekranın bildirdiği kayıt (yoksa genel sohbet) kullanılır. */
export function asistaniAc(baglam?: AsistanBaglami) {
  window.dispatchEvent(new CustomEvent<AsistanBaglami | undefined>(ASISTAN_AC_OLAYI, { detail: baglam }));
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
