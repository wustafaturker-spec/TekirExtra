/**
 * Gönderim öncesi ön denetçi (EBLG-134…139).
 *
 * Senaryo engelleri kesin hataları durdurur; ön denetçi sistemin geçirdiği
 * ama büyük olasılıkla yanlış olan belgeyi gönderilmeden önce söyler. Kurallar
 * belirlenimcidir ve veritabanına dokunmaz: API gerekli geçmişi toplar,
 * buradaki fonksiyonlar yalnız karşılaştırır. Bulgular engel değildir; uyarı
 * kullanıcı onayıyla geçilir (EBLG-141), bilgi yalnız gösterilir.
 */

export type OnDenetimDuzeyi = "uyari" | "bilgi";

export type OnDenetimKodu =
  | "CARI_UNVAN_FARKLI"
  | "CARI_VERGI_DAIRESI_YOK"
  | "POSTA_KUTUSU_YENI"
  | "SENARYO_ALISKANLIK"
  | "KDV_KARTTAN_FARKLI"
  | "KDV_GECMISTEN_FARKLI"
  | "TEVKIFAT_ALISKANLIK"
  | "ISTISNA_MAL_HIZMET"
  | "FIYAT_SAPMA"
  | "FIYAT_KAT_HATASI"
  | "MIKTAR_KAT_HATASI"
  | "MALIYET_ALTI"
  | "LISTE_FIYATI_FARKLI"
  | "MUKERRER_SUPHESI"
  | "KAYNAK_ASIMI"
  | "KUR_SAPMA"
  | "KUR_BULUNAMADI";

export interface OnDenetimBulgusu {
  kod: OnDenetimKodu;
  duzey: OnDenetimDuzeyi;
  mesaj: string;
  /** 1'den başlayan satır sırası; belge düzeyindeki bulguda yok. */
  satir?: number;
  /** Düzeltmenin yapılacağı ya da karşılaştırılan kayıt. */
  baglanti?: { tur: "cari" | "stok" | "fatura"; id: string; etiket?: string };
}

/** Geçmiş bir satıştaki birim net fiyat (belge dövizinde, satırın biriminde). */
export interface FiyatGecmisi {
  fiyat: number;
  /** Aynı cariye mi kesildi. */
  ayniCari: boolean;
}

export interface OnDenetimSatiri {
  sira: number;
  stokId: string;
  stokAd: string;
  stokTip: "urun" | "hizmet" | "sarf";
  birim: string;
  miktar: number;
  /** İskontosuz birim fiyat (belge dövizinde). */
  birimFiyat: number;
  /** Satır ve genel iskonto düşülmüş birim fiyat (matrah / miktar). */
  netBirimFiyat: number;
  kdvOrani: number;
  kartKdvOrani: number;
  tevkifatKodu: string | null;
  istisnaKodu: string | null;
  /** Belge dövizinde birim maliyet; birim ana birim değilse ya da maliyet yoksa null. */
  birimMaliyet: number | null;
  /** Carinin fiyat listesindeki fiyat; liste dövizi ya da birim uymuyorsa null. */
  listeFiyati: number | null;
  /** Aynı ürünün son satışları, yeniden eskiye; aynı döviz ve birim. */
  gecmisFiyatlar: FiyatGecmisi[];
  /** Ürünün son satışlarındaki KDV oranları, yeniden eskiye. */
  gecmisKdvOranlari: number[];
  /** Bu cariye bu ürünün son satışlarındaki tevkifat kodları (yoksa null), yeniden eskiye. */
  cariGecmisTevkifat: (string | null)[];
  /** Bu cariye bu ürünün son satış miktarları (aynı birim), yeniden eskiye. */
  cariGecmisMiktarlar: number[];
  /** Kaynak sipariş/irsaliye satırından fazla faturalanıyorsa. */
  kaynakAsimi?: { belgeNo: string | null; kaynakMiktar: number; toplamFaturalanan: number } | null;
}

export interface MukerrerAdayi {
  id: string;
  no: string | null;
  tarih: string;
  ayniToplam: boolean;
  ayniSatirlar: boolean;
}

export interface OnDenetimGirdisi {
  fatura: {
    senaryo: string;
    doviz: string;
    kur: number;
    /** İhracat ya da yurt dışı e-Arşiv: KDV kartla karşılaştırılmaz. */
    yurtDisi: boolean;
  };
  cari: { id: string; unvan: string; vknTckn: string | null; vergiDairesi: string | null };
  /** Alıcı GİB e-Fatura listesindeyse listedeki unvan ve son gönderimden sonra eklenen kutular. */
  mukellef: { efaturaMukellefi: boolean; unvan: string | null; yeniKutular: string[] } | null;
  /** Bu cariye gönderilmiş son satış faturalarının senaryoları, yeniden eskiye. */
  gecmisSenaryolar: string[];
  satirlar: OnDenetimSatiri[];
  mukerrerAdaylari: MukerrerAdayi[];
  /** Belge günündeki kur; TRY'de ya da kur bulunamazsa null. */
  gunKuru: { alis: number; satis: number } | null;
  esikler?: Partial<OnDenetimEsikleri>;
}

export interface OnDenetimEsikleri {
  /** Fiyatın geçmişten ve listeden sapma eşiği (yüzde). */
  fiyatYuzde: number;
  /** Kurun TCMB kurundan sapma eşiği (yüzde). */
  kurYuzde: number;
}

export const ON_DENETIM_VARSAYILAN_ESIKLER: OnDenetimEsikleri = { fiyatYuzde: 25, kurYuzde: 3 };

/** Alışkanlık sayılması için gereken en az geçmiş kayıt. */
export const ALISKANLIK_EN_AZ = 3;

const SENARYO_ADLARI: Record<string, string> = {
  satis: "temel satış",
  iade: "iade",
  tevkifat: "tevkifatlı",
  tevkifatiade: "tevkifatlı iade",
  istisna: "istisnalı",
  ihrackayitli: "ihraç kayıtlı",
  ozelmatrah: "özel matrahlı",
  sgk: "SGK",
  sarj: "şarj",
  sarjanlik: "anlık şarj",
  konaklamavergisi: "konaklama vergili",
};
const senaryoAdi = (s: string) => SENARYO_ADLARI[s] ?? s;

const KDV_KARTLA_KARSILASTIRILMAZ = new Set(["istisna", "ihrackayitli", "ozelmatrah"]);

/** 301 mal, 302 hizmet ihracatı istisnası (KDV 11/1-a). */
const MAL_ISTISNASI = "301";
const HIZMET_ISTISNASI = "302";

const UNVAN_EKLERI = new Set([
  "LTD", "LİMİTED", "LIMITED", "ŞTİ", "STİ", "AS", "ŞİRKETİ", "ŞİRKET", "A", "Ş", "AŞ", "ANONİM", "TİC", "TİCARET", "SAN", "SANAYİ",
  "VE", "İTH", "İHR", "İTHALAT", "İHRACAT", "PAZ", "PAZARLAMA", "İNŞ", "İNŞAAT", "TAAH", "TAAHHÜT", "DIŞ", "HİZ", "HİZMETLERİ",
  "HİZMET", "ÜRÜNLERİ", "ÜRN", "GIDA", "TEKSTİL", "OTOMOTİV", "KOLL", "KOLLEKTİF", "KOM", "KOMANDİT", "VB",
]);

/** Unvanı karşılaştırılabilir ayırt edici sözcüklere indirger (şirket türü ekleri atılır). */
export function unvanSozcukleri(unvan: string): string[] {
  return unvan
    .toLocaleUpperCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((s) => s && !UNVAN_EKLERI.has(s));
}

/** İki unvan aynı firmayı anlatıyor mu: kısa olanın sözcüklerinin en az yarısı ötekinde. */
export function unvanlarUyumlu(a: string, b: string): boolean {
  const x = unvanSozcukleri(a);
  const y = unvanSozcukleri(b);
  if (!x.length || !y.length) return true;
  const [kisa, uzun] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  const ortak = kisa.filter((s) => uzun.has(s)).length;
  return ortak / kisa.length >= 0.5;
}

export function ortanca(degerler: number[]): number | null {
  const d = degerler.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!d.length) return null;
  const orta = Math.floor(d.length / 2);
  return d.length % 2 ? d[orta] : (d[orta - 1] + d[orta]) / 2;
}

/** Oran 10, 100 ya da 1000'in (ya da tersinin) ±%2 yakınındaysa o kat; değilse null. */
export function onKati(oran: number): number | null {
  if (!Number.isFinite(oran) || oran <= 0) return null;
  for (const kat of [10, 100, 1000]) {
    for (const hedef of [kat, 1 / kat]) {
      if (Math.abs(oran / hedef - 1) <= 0.02) return hedef > 1 ? kat : -kat;
    }
  }
  return null;
}

/** Hepsi aynıysa o değer; en az `ALISKANLIK_EN_AZ` kayıt gerekir. */
function tekDuzeDeger<T>(degerler: T[], enAz = ALISKANLIK_EN_AZ): T | undefined {
  if (degerler.length < enAz) return undefined;
  return degerler.every((d) => d === degerler[0]) ? degerler[0] : undefined;
}

const yuzde = (x: number) => `%${Math.abs(x).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
const tutar = (x: number, doviz: string) => `${x.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${doviz}`;

/** Uzun kutu listesini ilk üçüyle özetler (GİB test VKN'lerinde yüzlerce kutu olur). */
function kutuListesi(kutular: string[]): string {
  return kutular.length > 3 ? `${kutular.slice(0, 3).join(", ")} ve ${kutular.length - 3} kutu daha` : kutular.join(", ");
}

function cariKurallari(g: OnDenetimGirdisi): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  const cari = { tur: "cari" as const, id: g.cari.id, etiket: g.cari.unvan };
  if (g.mukellef?.efaturaMukellefi) {
    if (g.mukellef.unvan && !unvanlarUyumlu(g.cari.unvan, g.mukellef.unvan)) {
      bulgular.push({ kod: "CARI_UNVAN_FARKLI", duzey: "uyari", baglanti: cari,
        mesaj: `Cari unvanı GİB listesindeki unvandan farklı: "${g.mukellef.unvan}". Vergi numarası başka bir firmaya ait olabilir.` });
    }
    if (g.cari.vknTckn?.length === 10 && !g.cari.vergiDairesi?.trim()) {
      bulgular.push({ kod: "CARI_VERGI_DAIRESI_YOK", duzey: "uyari", baglanti: cari, mesaj: "Cari kartında vergi dairesi boş." });
    }
    if (g.mukellef.yeniKutular.length) {
      bulgular.push({ kod: "POSTA_KUTUSU_YENI", duzey: "uyari", baglanti: cari,
        mesaj: `Alıcıya son gönderiminizden sonra yeni posta kutusu tanımlanmış: ${kutuListesi(g.mukellef.yeniKutular)}. Belgenin doğru kutuya gittiğinden emin olun.` });
    }
  }
  const aliskanlik = tekDuzeDeger(g.gecmisSenaryolar.slice(0, 5));
  if (aliskanlik !== undefined && aliskanlik !== g.fatura.senaryo) {
    bulgular.push({ kod: "SENARYO_ALISKANLIK", duzey: "uyari",
      mesaj: `Bu cariye son ${Math.min(g.gecmisSenaryolar.length, 5)} fatura ${senaryoAdi(aliskanlik)} kesildi; bu fatura ${senaryoAdi(g.fatura.senaryo)}.` });
  }
  return bulgular;
}

function vergiKurallari(g: OnDenetimGirdisi, s: OnDenetimSatiri): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  const stok = { tur: "stok" as const, id: s.stokId, etiket: s.stokAd };
  const kartlaKarsilastir = !s.istisnaKodu && !g.fatura.yurtDisi && !KDV_KARTLA_KARSILASTIRILMAZ.has(g.fatura.senaryo);
  if (kartlaKarsilastir && s.kdvOrani !== s.kartKdvOrani) {
    bulgular.push({ kod: "KDV_KARTTAN_FARKLI", duzey: "uyari", satir: s.sira, baglanti: stok,
      mesaj: `${s.stokAd}: KDV %${s.kdvOrani}, ürün kartında %${s.kartKdvOrani}.` });
  } else if (kartlaKarsilastir) {
    const gecmis = tekDuzeDeger(s.gecmisKdvOranlari.slice(0, 5));
    if (gecmis !== undefined && gecmis !== s.kdvOrani) {
      bulgular.push({ kod: "KDV_GECMISTEN_FARKLI", duzey: "uyari", satir: s.sira, baglanti: stok,
        mesaj: `${s.stokAd}: KDV %${s.kdvOrani}, bu ürünün son satışlarında hep %${gecmis}.` });
    }
  }
  const tevkifat = tekDuzeDeger(s.cariGecmisTevkifat.slice(0, 5));
  if (tevkifat !== undefined && tevkifat !== s.tevkifatKodu) {
    bulgular.push({ kod: "TEVKIFAT_ALISKANLIK", duzey: "uyari", satir: s.sira,
      mesaj: tevkifat
        ? `${s.stokAd}: bu cariye son satışlarda ${tevkifat} kodlu tevkifat uygulandı; bu satırda ${s.tevkifatKodu ? `${s.tevkifatKodu} kodu var` : "tevkifat yok"}.`
        : `${s.stokAd}: bu cariye son satışlarda tevkifat uygulanmadı; bu satırda ${s.tevkifatKodu} kodlu tevkifat var.` });
  }
  if (s.istisnaKodu === MAL_ISTISNASI && s.stokTip === "hizmet") {
    bulgular.push({ kod: "ISTISNA_MAL_HIZMET", duzey: "uyari", satir: s.sira, baglanti: stok,
      mesaj: `${s.stokAd} hizmet kartı, ama satırda mal ihracatı istisnası (301) var; hizmet ihracatı 302'dir.` });
  } else if (s.istisnaKodu === HIZMET_ISTISNASI && s.stokTip !== "hizmet") {
    bulgular.push({ kod: "ISTISNA_MAL_HIZMET", duzey: "uyari", satir: s.sira, baglanti: stok,
      mesaj: `${s.stokAd} mal kartı, ama satırda hizmet ihracatı istisnası (302) var; mal ihracatı 301'dir.` });
  }
  return bulgular;
}

function fiyatKurallari(g: OnDenetimGirdisi, s: OnDenetimSatiri, esik: OnDenetimEsikleri): OnDenetimBulgusu[] {
  const bulgular: OnDenetimBulgusu[] = [];
  const doviz = g.fatura.doviz;
  const stok = { tur: "stok" as const, id: s.stokId, etiket: s.stokAd };
  if (s.netBirimFiyat > 0) {
    const ayniCari = s.gecmisFiyatlar.filter((f) => f.ayniCari).slice(0, 5);
    const kaynak = ayniCari.length ? ayniCari : s.gecmisFiyatlar.slice(0, 5);
    const referans = ortanca(kaynak.map((f) => f.fiyat));
    if (referans) {
      const oran = s.netBirimFiyat / referans;
      const kat = onKati(oran);
      const kimeKesildi = ayniCari.length ? "bu cariye" : "tüm carilere";
      if (kat) {
        bulgular.push({ kod: "FIYAT_KAT_HATASI", duzey: "uyari", satir: s.sira, baglanti: stok,
          mesaj: `${s.stokAd}: birim fiyat ${tutar(s.netBirimFiyat, doviz)}, ${kimeKesildi} son satışlarda ${tutar(referans, doviz)} — ${Math.abs(kat)} kat ${kat > 0 ? "fazla" : "az"}. Ondalık ya da birim hatası olabilir.` });
      } else if (Math.abs(oran - 1) * 100 > esik.fiyatYuzde) {
        bulgular.push({ kod: "FIYAT_SAPMA", duzey: "uyari", satir: s.sira, baglanti: stok,
          mesaj: `${s.stokAd}: birim fiyat ${tutar(s.netBirimFiyat, doviz)}, ${kimeKesildi} son satışlarda ${tutar(referans, doviz)} (${yuzde((oran - 1) * 100)} ${oran > 1 ? "yüksek" : "düşük"}).` });
      }
    }
    if (s.birimMaliyet && s.birimMaliyet > 0 && s.netBirimFiyat < s.birimMaliyet) {
      bulgular.push({ kod: "MALIYET_ALTI", duzey: "uyari", satir: s.sira, baglanti: stok,
        mesaj: `${s.stokAd}: birim fiyat ${tutar(s.netBirimFiyat, doviz)}, ortalama maliyetin (${tutar(s.birimMaliyet, doviz)}) altında.` });
    }
  }
  if (s.listeFiyati && s.listeFiyati > 0 && s.birimFiyat > 0) {
    const sapma = (s.birimFiyat / s.listeFiyati - 1) * 100;
    if (Math.abs(sapma) > esik.fiyatYuzde) {
      bulgular.push({ kod: "LISTE_FIYATI_FARKLI", duzey: "uyari", satir: s.sira, baglanti: stok,
        mesaj: `${s.stokAd}: birim fiyat ${tutar(s.birimFiyat, doviz)}, carinin fiyat listesinde ${tutar(s.listeFiyati, doviz)} (${yuzde(sapma)} ${sapma > 0 ? "yüksek" : "düşük"}).` });
    }
  }
  const miktarRef = ortanca(s.cariGecmisMiktarlar.slice(0, 5));
  const miktarKati = miktarRef ? onKati(s.miktar / miktarRef) : null;
  if (miktarRef && miktarKati) {
    bulgular.push({ kod: "MIKTAR_KAT_HATASI", duzey: "uyari", satir: s.sira,
      mesaj: `${s.stokAd}: miktar ${s.miktar.toLocaleString("tr-TR")} ${s.birim}, bu cariye son satışlarda ${miktarRef.toLocaleString("tr-TR")} ${s.birim} — ${Math.abs(miktarKati)} kat ${miktarKati > 0 ? "fazla" : "az"}.` });
  }
  if (s.kaynakAsimi) {
    const a = s.kaynakAsimi;
    bulgular.push({ kod: "KAYNAK_ASIMI", duzey: "uyari", satir: s.sira,
      mesaj: `${s.stokAd}: ${a.belgeNo ?? "kaynak belgedeki"} satırı ${a.kaynakMiktar.toLocaleString("tr-TR")} ${s.birim}, faturalanan toplam bu faturayla ${a.toplamFaturalanan.toLocaleString("tr-TR")} ${s.birim}.` });
  }
  return bulgular;
}

function mukerrerKurallari(g: OnDenetimGirdisi): OnDenetimBulgusu[] {
  return g.mukerrerAdaylari
    .filter((a) => a.ayniToplam || a.ayniSatirlar)
    .map((a) => ({
      kod: "MUKERRER_SUPHESI" as const,
      duzey: "uyari" as const,
      baglanti: { tur: "fatura" as const, id: a.id, etiket: a.no ?? "taslak" },
      mesaj: `Bu cariye ${a.tarih.split("-").reverse().join(".")} tarihli ${a.no ? `${a.no} numaralı` : "henüz numara almamış"} bir fatura ${a.ayniSatirlar ? "aynı ürün ve miktarlarla" : "aynı toplamla"} kesilmiş. Aynı satış iki kez faturalanıyor olabilir.`,
    }));
}

function kurKurallari(g: OnDenetimGirdisi, esik: OnDenetimEsikleri): OnDenetimBulgusu[] {
  if (g.fatura.doviz === "TRY") return [];
  if (!g.gunKuru) {
    return [{ kod: "KUR_BULUNAMADI", duzey: "bilgi", mesaj: `Belge gününe ait ${g.fatura.doviz} kuru bulunamadı; faturadaki kur (${g.fatura.kur}) karşılaştırılamadı.` }];
  }
  const alt = g.gunKuru.alis * (1 - esik.kurYuzde / 100);
  const ust = g.gunKuru.satis * (1 + esik.kurYuzde / 100);
  if (g.fatura.kur >= alt && g.fatura.kur <= ust) return [];
  return [{ kod: "KUR_SAPMA", duzey: "uyari",
    mesaj: `Faturadaki kur ${g.fatura.kur.toLocaleString("tr-TR", { maximumFractionDigits: 6 })}, belge günündeki ${g.fatura.doviz} kuru ${g.gunKuru.alis.toLocaleString("tr-TR", { maximumFractionDigits: 6 })} (alış) – ${g.gunKuru.satis.toLocaleString("tr-TR", { maximumFractionDigits: 6 })} (satış).` }];
}

/** Bütün kuralları çalıştırır; sıra: belge, cari, satırlar (satır sırasıyla). */
export function onDenetimYap(g: OnDenetimGirdisi): OnDenetimBulgusu[] {
  const esik = { ...ON_DENETIM_VARSAYILAN_ESIKLER, ...g.esikler };
  return [
    ...mukerrerKurallari(g),
    ...kurKurallari(g, esik),
    ...cariKurallari(g),
    ...g.satirlar.flatMap((s) => [...vergiKurallari(g, s), ...fiyatKurallari(g, s, esik)]),
  ];
}
