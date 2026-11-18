import { DOVIZ_CINSLERI, vknGecerliMi, tcknGecerliMi } from "@tekirextra/shared";
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

  // AI-13: belge dövizi aktarılır; tanınmayan kod TL sayılmaz, uyarıyla TL'ye düşer.
  const doviz = String(duzeltilmisVeri.paraBirimi ?? "TRY").trim().toUpperCase().replace(/^(TL|₺)$/, "TRY");
  if ((DOVIZ_CINSLERI as readonly string[]).includes(doviz)) duzeltilmisVeri.paraBirimi = doviz;
  else { uyarilar.push(`Belge para birimi (${duzeltilmisVeri.paraBirimi}) tanınmadı; TL varsayıldı, kontrol edin.`); duzeltilmisVeri.paraBirimi = "TRY"; }

  // AI-13: kırılım toplamı belge matrahını tutmalı; tutmuyorsa oran başına ayırma uyarıyla yapılır.
  if (duzeltilmisVeri.kdvKirilimi.length > 1) {
    const kirilimMatrah = Math.round(duzeltilmisVeri.kdvKirilimi.reduce((t, k) => t + k.matrah, 0) * 100) / 100;
    if (Math.abs(kirilimMatrah - duzeltilmisVeri.toplamMatrah) > 0.05) uyarilar.push(`KDV kırılımı matrahı (${kirilimMatrah}) belge matrahını (${duzeltilmisVeri.toplamMatrah}) tutmuyor; oranları kontrol edin.`);
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

  // CNL-23: boşluk/nokta/tire ile yazılmış kimlik rakamlarına indirgenir; uzunluğu ya da kontrol
  // hanesi tutmayan kimlik karta yazılmaz (boş bırakılır), kullanıcı uyarılır.
  if (duzeltilmisVeri.vknTckn) {
    const ham = duzeltilmisVeri.vknTckn;
    const vkn = ham.replace(/\D/g, "");
    if (vkn.length !== 10 && vkn.length !== 11) {
      uyarilar.push(`Okunan vergi/kimlik no (${ham.slice(0, 20)}) 10 ya da 11 haneli değil; boş bırakıldı.`);
      duzeltilmisVeri.vknTckn = null;
    } else if (vkn.length === 10 ? !vknGecerliMi(vkn) : !tcknGecerliMi(vkn)) {
      uyarilar.push(`Okunan ${vkn.length === 10 ? "VKN" : "TCKN"} (${vkn}) kontrol hanesi tutmuyor; boş bırakıldı, elle kontrol edin.`);
      duzeltilmisVeri.vknTckn = null;
    } else duzeltilmisVeri.vknTckn = vkn;
  }
  if (duzeltilmisVeri.eposta) duzeltilmisVeri.eposta = duzeltilmisVeri.eposta.trim().toLowerCase();
  // Cari kartı tam adres ister ("aknboya.com" → "https://aknboya.com").
  if (duzeltilmisVeri.webSitesi) {
    const w = duzeltilmisVeri.webSitesi.trim();
    duzeltilmisVeri.webSitesi = /^https?:\/\//i.test(w) ? w : /^[\p{L}\d.-]+\.[\p{L}]{2,}(\/\S*)?$/u.test(w) ? `https://${w}` : null;
  }

  if (!duzeltilmisVeri.eposta && !duzeltilmisVeri.telefon) {
    uyarilar.push("İletişim bilgisi (telefon veya e-posta) tespit edilemedi.");
  }

  // CNL-23/24: IBAN tespiti ve normalizasyonu (TR + 24 hane).
  if (duzeltilmisVeri.iban) {
    const hamIban = duzeltilmisVeri.iban.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const duzeltilmis = hamIban.startsWith("TR") ? hamIban : /^\d{24}$/.test(hamIban) ? `TR${hamIban}` : hamIban;
    if (/^TR\d{24}$/.test(duzeltilmis)) {
      duzeltilmisVeri.iban = duzeltilmis;
    } else {
      uyarilar.push(`Okunan IBAN (${duzeltilmisVeri.iban}) standart 26 haneli TR formatında değil.`);
    }
  }

  return {
    gecerli: hatalar.length === 0,
    veri: duzeltilmisVeri,
    uyarilar,
    hatalar,
  };
}
