import { vknGecerliMi, tcknGecerliMi } from "@tekirextra/shared";
import { FisFaturaOcrSonuc, CariIletisimCikarim } from "./ai.semalar";

export interface DogrulamaSonucu<T> {
  gecerli: boolean;
  veri: T;
  uyarilar: string[];
  hatalar: string[];
}


/**
 * Fiş / Fatura Çıkarımının Matematiksel ve Mantıksal Çapraz Doğrulaması
 */
export function fisFaturaDogrula(cikti: FisFaturaOcrSonuc): DogrulamaSonucu<FisFaturaOcrSonuc> {
  const uyarilar: string[] = [];
  const hatalar: string[] = [];
  const duzeltilmisVeri = { ...cikti };

  // 1. Matematiksel Sağlama: Matrah + KDV = Toplam Kontrolü (1 TL tolerans / yuvarlama payı)
  const hesaplananToplam = Math.round((duzeltilmisVeri.toplamMatrah + duzeltilmisVeri.toplamKdv) * 100) / 100;
  const genelToplam = Math.round(duzeltilmisVeri.genelToplam * 100) / 100;
  const fark = Math.abs(hesaplananToplam - genelToplam);

  if (fark > 0.05) {
    uyarilar.push(
      `Matematiksel uyumsuzluk: Toplam Matrah (${duzeltilmisVeri.toplamMatrah}) + KDV (${duzeltilmisVeri.toplamKdv}) = ${hesaplananToplam}, ancak Genel Toplam = ${genelToplam} (Fark: ${fark.toFixed(2)})`
    );
  }

  // 2. VKN/TCKN Doğrulaması
  if (duzeltilmisVeri.saticiVknTckn) {
    const vkn = duzeltilmisVeri.saticiVknTckn;
    if (vkn.length === 10) {
      if (!vknGecerliMi(vkn)) {
        uyarilar.push(`Satıcı VKN (${vkn}) biçimi veya kontrol hanesi hatalı görünüyor.`);
      }
    } else if (vkn.length === 11) {
      if (!tcknGecerliMi(vkn)) {
        uyarilar.push(`Satıcı TCKN (${vkn}) algoritma denetiminden geçemedi.`);
      }
    }
  } else {
    uyarilar.push("Satıcı VKN / TCKN tespit edilemedi; cari otomatik eşleşmeyebilir.");
  }

  // 3. Tarih Geçerlilik Kontrolü
  if (duzeltilmisVeri.tarih) {
    const belgeTarihi = new Date(duzeltilmisVeri.tarih);
    const simdi = new Date();
    if (belgeTarihi > simdi) {
      uyarilar.push(`Belge tarihi (${duzeltilmisVeri.tarih}) gelecekte bir tarih içeriyor.`);
    }
  } else {
    uyarilar.push("Belge tarihi tespit edilemedi; varsayılan günün tarihi kullanılacak.");
  }

  // 4. Genel Toplam Pozitif Olmalı
  if (duzeltilmisVeri.genelToplam <= 0) {
    hatalar.push("Belge genel toplamı sıfır veya negatif olamaz.");
  }

  return {
    gecerli: hatalar.length === 0,
    veri: duzeltilmisVeri,
    uyarilar,
    hatalar,
  };
}

/**
 * Cari / İletişim Çıkarımının Doğrulanması
 */
export function cariIletisimDogrula(cikti: CariIletisimCikarim): DogrulamaSonucu<CariIletisimCikarim> {
  const uyarilar: string[] = [];
  const hatalar: string[] = [];
  const duzeltilmisVeri = { ...cikti };

  if (!duzeltilmisVeri.unvan || duzeltilmisVeri.unvan.trim().length < 2) {
    hatalar.push("Cari ünvanı en az 2 karakter olmalıdır.");
  }

  if (duzeltilmisVeri.vknTckn) {
    const vkn = duzeltilmisVeri.vknTckn;
    if (vkn.length === 10 && !vknGecerliMi(vkn)) {
      uyarilar.push(`Çıkarılan VKN (${vkn}) kontrol hanesi uyuşmuyor.`);
    } else if (vkn.length === 11 && !tcknGecerliMi(vkn)) {
      uyarilar.push(`Çıkarılan TCKN (${vkn}) kontrol hanesi uyuşmuyor.`);
    }
  }

  if (!duzeltilmisVeri.eposta && !duzeltilmisVeri.telefon) {
    uyarilar.push("İletişim bilgisi (telefon veya e-posta) tespit edilemedi.");
  }

  return {
    gecerli: hatalar.length === 0,
    veri: duzeltilmisVeri,
    uyarilar,
    hatalar,
  };
}
