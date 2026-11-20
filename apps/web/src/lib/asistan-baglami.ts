"use client";

import { useEffect, useRef } from "react";
import { EKRAN_DURUMLARI, ekranDurumunuAyristir, type EkranDurumu } from "@tekirextra/shared";

/** AI-78: asistanın açıldığı ekranın kayıt türleri (sunucudaki EKRAN_TURLERI ile aynı). */
export type EkranTuru = "cari" | "stok" | "fatura" | "belge" | "gelen_efatura" | "gelen_eirsaliye" | "satin_alma_talebi" | "rapor"
  /** AI-113; hesap kimliği `kasa:<uuid>` ya da `banka:<uuid>`. */
  | "kasa_banka_hesabi" | "masraf" | "personel" | "uretim_emri" | "crm_firsati";

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
  kasa_banka_hesabi: [
    { kod: "hesap_ozet", etiket: "Hesap hareketlerini özetle", mesaj: "Bu hesabın bu ayki giriş-çıkışlarını ve bakiyesini özetle; olağandışı hareket varsa belirt.", simge: "🏦" },
  ],
  masraf: [
    { kod: "masraf_kontrol", etiket: "Bu masrafı kontrol et", mesaj: "Bu masrafın kategori, KDV ve ödeme durumunu kontrol et; eksik ya da tutarsız alan var mı?", simge: "🔍" },
  ],
  personel: [
    { kod: "personel_izin", etiket: "İzin durumu", mesaj: "Bu personelin izin bakiyesini ve bekleyen izin taleplerini özetle.", simge: "🗓️" },
  ],
  uretim_emri: [
    { kod: "uretim_durum", etiket: "Emrin durumu", mesaj: "Bu üretim emrinin malzeme uygunluğunu, operasyon durumunu ve gecikme riskini özetle.", simge: "🏭" },
  ],
  crm_firsati: [
    { kod: "firsat_sonraki_adim", etiket: "Sonraki adımı öner", mesaj: "Bu fırsatın aşamasına ve carinin geçmişine bakarak sonraki satış adımını öner.", simge: "🎯" },
  ],
  rapor: [
    { kod: "rapor_yorumla", etiket: "Bu raporu yorumla", mesaj: "Bu raporun sonuçlarını yönetici özeti şeklinde yorumla ve kritik sapmaları belirt.", simge: "💡" },
  ],
};

export const EKRAN_TURU_ADI: Record<EkranTuru, string> = {
  cari: "cari", stok: "stok kartı", fatura: "fatura", belge: "belge", gelen_efatura: "gelen e-Fatura",
  gelen_eirsaliye: "gelen e-İrsaliye", satin_alma_talebi: "satın alma talebi", rapor: "rapor",
  kasa_banka_hesabi: "hesap", masraf: "masraf", personel: "personel", uretim_emri: "üretim emri", crm_firsati: "fırsat",
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
  kasa_banka_hesabi: ["Bu hesabın son hareketleri", "Bu ay giriş-çıkış toplamı", "Eşleşmemiş ekstre satırı var mı?"],
  masraf: ["Bu masrafı kontrol et", "Bu kategoride bu ayki toplam"],
  personel: ["İzin bakiyesi", "Bekleyen talepleri var mı?"],
  uretim_emri: ["Malzeme yeterli mi?", "Emrin maliyeti ne durumda?"],
  crm_firsati: ["Sonraki adımı öner", "Bu carinin açık teklifleri"],
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

/*
 * AI-113: liste ekranları süzgeç ve seçimlerini bildirir. Ekran kapanınca durum silinir;
 * asistan açıldığında ve her mesajda en son bildirilen durum gönderilir. İçerik değil yalnız
 * süzgeç değerleri ve kimlikler taşınır (sözleşme `@tekirextra/shared` ekran-durumu).
 */
let sonDurum: EkranDurumu | null = null;

export function ekranDurumu(): EkranDurumu | null {
  return sonDurum;
}

export function useEkranDurumu(durum: EkranDurumu | null | undefined) {
  const temiz = durum ? ekranDurumunuAyristir(durum) : null;
  const anahtar = temiz ? JSON.stringify(temiz) : "";
  useEffect(() => {
    if (!temiz) return;
    sonDurum = temiz;
    return () => {
      if (sonDurum && JSON.stringify(sonDurum) === anahtar) sonDurum = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- durum içeriği anahtarla izlenir
  }, [anahtar]);
}

/** Rozet metni: "Fatura listesi · 2 süzgeç · 3 seçili". */
export function ekranDurumuOzeti(d: EkranDurumu): string {
  const suzgec = Object.keys(d.suzgecler ?? {}).length;
  const secili = d.secili?.length ?? 0;
  return [EKRAN_DURUMLARI[d.ekran].ad, suzgec ? `${suzgec} süzgeç` : "", secili ? `${secili} seçili` : ""].filter(Boolean).join(" · ");
}

/** Boş/"tümü" değerleri süzgeçten çıkarır (sayfalar ham state'i verebilsin). */
export function suzgecler(degerler: Record<string, string | null | undefined | false>): Record<string, string> {
  return Object.fromEntries(Object.entries(degerler).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "" && e[1] !== "tumu"));
}

/*
 * AI-114: arayüz eylemleri. Ekranlar uygulayabildikleri eylemleri kaydeder; asistan yanıtla
 * gelen doğrulanmış eylemi ilgili işleyiciye verir. İşleyici geri alma işlevi döner; alanı
 * yoksa "alan_yok". Kayıt kaydetmek işleyicinin işi değildir (form yalnız doldurulur).
 */
export type GeriAl = () => void;
export interface ArayuzIsleyicisi {
  suzgec?: (suzgecler: Record<string, string>) => GeriAl | "alan_yok";
  sekme?: (sekme: string) => GeriAl | "alan_yok";
  formDoldur?: (form: string, alanlar: Record<string, string | number>, satirlar?: Array<{ stokId: string; miktar: number; birimFiyat?: number; kdvOrani?: number; iskontoOrani?: number }>) => GeriAl | "alan_yok";
}

const isleyiciler = new Map<string, ArayuzIsleyicisi>();

export function arayuzIsleyicisi(ekran: string): ArayuzIsleyicisi | undefined {
  return isleyiciler.get(ekran);
}

/** Ekran, eylem işleyicilerini kaydeder; işleyici her çizimde güncel state'i görür. */
export function useArayuzIsleyicisi(ekran: string, isleyici: ArayuzIsleyicisi) {
  const ref = useRef(isleyici);
  ref.current = isleyici;
  useEffect(() => {
    const vekil: ArayuzIsleyicisi = {
      suzgec: (s) => ref.current.suzgec?.(s) ?? "alan_yok",
      sekme: (s) => ref.current.sekme?.(s) ?? "alan_yok",
      formDoldur: (f, a, st) => ref.current.formDoldur?.(f, a, st) ?? "alan_yok",
    };
    isleyiciler.set(ekran, vekil);
    return () => { if (isleyiciler.get(ekran) === vekil) isleyiciler.delete(ekran); };
  }, [ekran]);
}

/** Listede `data-kayit-id` taşıyan satırları vurgular ve ilkine kaydırır. */
export function kayitlariVurgula(idler: string[]): GeriAl | "alan_yok" {
  const ogeler = idler.flatMap((id) => Array.from(document.querySelectorAll<HTMLElement>(`[data-kayit-id="${CSS.escape(id)}"]`)));
  if (!ogeler.length) return "alan_yok";
  ogeler.forEach((o) => o.classList.add("asistan-vurgu"));
  ogeler[0]!.scrollIntoView({ behavior: "smooth", block: "center" });
  return () => ogeler.forEach((o) => o.classList.remove("asistan-vurgu"));
}
