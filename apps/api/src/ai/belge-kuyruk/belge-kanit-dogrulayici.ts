import { DOVIZ_CINSLERI, vknGecerliMi, tcknGecerliMi } from "@tekirextra/shared";
import type { FisFaturaOcrSonuc } from "../ai.semalar";
import type { BelgeAlanKanitlari, BelgeDogrulamaSonucu } from "./belge-kuyruk.semalar";

/**
 * Belgedeki çıkarılan alanların sayfa ve alıntı kanıtlarını oluşturur.
 */
export function belgeAlanKanitlariniOlustur(
  veri: FisFaturaOcrSonuc,
  hamMetin?: string | null,
  sayfaMetinleri?: Record<number, string>,
): BelgeAlanKanitlari {
  const kanitlar: BelgeAlanKanitlari = {};
  const genelGuven = typeof veri.guvenSkoru === "number" ? veri.guvenSkoru : 0.85;

  const sayfalardaAra = (aranan: string): { sayfa?: number; alinti?: string } => {
    if (!aranan || aranan.trim().length === 0) return {};
    const hedef = aranan.trim().toLowerCase();

    if (sayfaMetinleri) {
      for (const [sayfaStr, metin] of Object.entries(sayfaMetinleri)) {
        const sayfaNo = Number(sayfaStr);
        const idx = metin.toLowerCase().indexOf(hedef);
        if (idx !== -1) {
          const bas = Math.max(0, idx - 25);
          const son = Math.min(metin.length, idx + aranan.length + 25);
          return {
            sayfa: sayfaNo,
            alinti: metin.substring(bas, son).replace(/\s+/g, " ").trim(),
          };
        }
      }
    }

    if (hamMetin) {
      const idx = hamMetin.toLowerCase().indexOf(hedef);
      if (idx !== -1) {
        const bas = Math.max(0, idx - 25);
        const son = Math.min(hamMetin.length, idx + aranan.length + 25);
        return {
          sayfa: 1,
          alinti: hamMetin.substring(bas, son).replace(/\s+/g, " ").trim(),
        };
      }
    }

    return {};
  };

  if (veri.saticiUnvan) {
    const k = sayfalardaAra(veri.saticiUnvan);
    kanitlar.saticiUnvan = { ...k, guven: genelGuven };
  }
  if (veri.saticiVknTckn) {
    const k = sayfalardaAra(veri.saticiVknTckn);
    kanitlar.saticiVknTckn = { ...k, guven: genelGuven };
  }
  if (veri.belgeNo) {
    const k = sayfalardaAra(veri.belgeNo);
    kanitlar.belgeNo = { ...k, guven: genelGuven };
  }
  if (veri.tarih) {
    const k = sayfalardaAra(veri.tarih);
    kanitlar.tarih = { ...k, guven: genelGuven };
  }
  if (veri.genelToplam) {
    const k = sayfalardaAra(veri.genelToplam.toString());
    kanitlar.genelToplam = { ...k, guven: genelGuven };
  }
  if (veri.toplamKdv) {
    const k = sayfalardaAra(veri.toplamKdv.toString());
    kanitlar.toplamKdv = { ...k, guven: genelGuven };
  }

  return kanitlar;
}

/**
 * Aritmetik doğrulama, döviz ve zorunlu alan çelişkilerini denetler.
 * P-09: Çelişkiler çözülmeden kayıt aktarımı engellenir.
 */
export function belgeCaprazDogrula(
  veri: FisFaturaOcrSonuc,
  eslesenCari: { id: string; unvan: string; kod: string } | null,
  eslesmeTuru: "TAM_VKN" | "UNVAN_BENZERLIGI" | "ESLESMEDI" = "ESLESMEDI",
): BelgeDogrulamaSonucu {
  const uyarilar: string[] = [];
  const hatalar: string[] = [];
  const celiskiler: string[] = [];

  // 1. Aritmetik Sağlama: Matrah + KDV = Toplam
  const hesaplananToplam = Math.round(((veri.toplamMatrah || 0) + (veri.toplamKdv || 0)) * 100) / 100;
  const genelToplam = Math.round((veri.genelToplam || 0) * 100) / 100;
  const fark = Math.round(Math.abs(hesaplananToplam - genelToplam) * 100) / 100;
  const matematikselUyumlu = fark <= 0.05;

  if (!matematikselUyumlu) {
    const mesaj = `Matematiksel uyumsuzluk: Matrah (${veri.toplamMatrah}) + KDV (${veri.toplamKdv}) = ${hesaplananToplam}, Genel Toplam = ${genelToplam} (Fark: ${fark.toFixed(2)})`;
    uyarilar.push(mesaj);
    if (fark > 1.0) {
      celiskiler.push(`Tutar uyuşmazlığı: Matrah + KDV toplamı genel toplamı tutmuyor (Fark: ${fark.toFixed(2)})`);
    }
  }

  // 2. KDV Kırılımı Denetimi
  let kdvKirilimMatrahUyumlu = true;
  if (veri.kdvKirilimi && veri.kdvKirilimi.length > 0) {
    const kirilimMatrah = Math.round(veri.kdvKirilimi.reduce((t, k) => t + (k.matrah || 0), 0) * 100) / 100;
    if (Math.abs(kirilimMatrah - (veri.toplamMatrah || 0)) > 0.05) {
      kdvKirilimMatrahUyumlu = false;
      uyarilar.push(
        `KDV kırılım matrahı toplamı (${kirilimMatrah}) belge toplam matrahını (${veri.toplamMatrah}) tutmuyor.`,
      );
    }
  }

  // 3. Genel Toplam Pozitif Olmalı
  if (!veri.genelToplam || veri.genelToplam <= 0) {
    hatalar.push("Belge genel toplamı sıfır veya negatif olamaz.");
    celiskiler.push("Genel toplam sıfır veya negatif olamaz.");
  }

  // 4. Para Birimi Denetimi
  const doviz = String(veri.paraBirimi ?? "TRY").trim().toUpperCase();
  if (!(DOVIZ_CINSLERI as readonly string[]).includes(doviz)) {
    uyarilar.push(`Tanınmayan para birimi: "${veri.paraBirimi}". Varsayılan TRY olarak işaretlendi.`);
  }

  // 5. Satıcı Ünvanı ve VKN/TCKN Denetimi
  if (!veri.saticiUnvan || veri.saticiUnvan.trim().length < 2) {
    hatalar.push("Satıcı ünvanı eksik veya geçersiz.");
    celiskiler.push("Satıcı ünvanı zorunludur.");
  }

  if (veri.saticiVknTckn) {
    const vkn = veri.saticiVknTckn.replace(/\D/g, "");
    if (vkn.length === 10) {
      if (!vknGecerliMi(vkn)) {
        uyarilar.push(`Satıcı VKN (${vkn}) kontrol hanesi algoritma testinden geçemedi.`);
      }
    } else if (vkn.length === 11) {
      if (!tcknGecerliMi(vkn)) {
        uyarilar.push(`Satıcı TCKN (${vkn}) algoritma testinden geçemedi.`);
      }
    } else {
      uyarilar.push(`Satıcı vergi/TC no (${vkn}) 10 ya da 11 haneli değil.`);
    }
  } else {
    uyarilar.push("Satıcı VKN/TCKN tespit edilemedi; cari otomatik eşleştirilemeyebilir.");
  }

  // 6. Belge Tarihi Denetimi
  if (veri.tarih) {
    const tarih = new Date(veri.tarih);
    if (isNaN(tarih.getTime())) {
      uyarilar.push(`Geçersiz belge tarihi formatı: "${veri.tarih}".`);
    } else if (tarih > new Date(Date.now() + 86_400_000)) {
      uyarilar.push(`Belge tarihi (${veri.tarih}) gelecekte görünüyor.`);
    }
  } else {
    uyarilar.push("Belge tarihi okunamadı.");
  }

  return {
    gecerli: hatalar.length === 0 && celiskiler.length === 0,
    matematikselUyumlu,
    hesaplananToplam,
    genelToplam,
    fark,
    kdvKirilimMatrahUyumlu,
    eslesmeKesinligi: eslesmeTuru,
    eslesenCari,
    uyarilar,
    hatalar,
    celiskiler,
  };
}
