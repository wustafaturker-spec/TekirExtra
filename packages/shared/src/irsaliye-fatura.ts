/**
 * FTR-26: irsaliyenin sonradan faturaya bağlanması. Satış irsaliyesi satış
 * faturasına, alış irsaliyesi alış faturasına bağlanır; iade ve proforma
 * faturası irsaliye kapatmaz.
 */
export const IRSALIYE_FATURA_TIPI = { satis: "satis", alis: "alis" } as const;

export function irsaliyeFaturaTipiUyarMi(irsaliyeYonu: string, faturaTipi: string): boolean {
  return IRSALIYE_FATURA_TIPI[irsaliyeYonu as keyof typeof IRSALIYE_FATURA_TIPI] === faturaTipi;
}

export interface KarsilastirmaSatiri {
  stokId: string;
  varyantId?: string | null;
  /** Uyarı metninde görünen ad (stok kodu + adı). */
  ad: string;
  miktar: string | number;
  birim: string;
  /** Stok kartı tipi; hizmet satırları karşılaştırılmaz. */
  stokTipi?: string | null;
}

export type KarsilastirmaFarkTuru = "yalniz_irsaliyede" | "yalniz_faturada" | "miktar" | "birim";

export interface KarsilastirmaFarki {
  tur: KarsilastirmaFarkTuru;
  ad: string;
  mesaj: string;
}

/** Miktarlar 3 ondalıkla saklanır; bundan küçük fark yuvarlamadır. */
const MIKTAR_TOLERANSI = 0.0005;

const bicimle = (n: number) => Number(n.toFixed(3)).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

interface Grup {
  ad: string;
  birimler: Set<string>;
  toplam: number;
}

function grupla(satirlar: KarsilastirmaSatiri[]): Map<string, Grup> {
  const gruplar = new Map<string, Grup>();
  for (const s of satirlar) {
    if (s.stokTipi === "hizmet") continue;
    const anahtar = `${s.stokId}|${s.varyantId ?? ""}`;
    const grup = gruplar.get(anahtar) ?? { ad: s.ad, birimler: new Set<string>(), toplam: 0 };
    grup.birimler.add(s.birim);
    grup.toplam += Number(s.miktar);
    gruplar.set(anahtar, grup);
  }
  return gruplar;
}

/**
 * Yumuşak karşılaştırma (FTR-26 madde 8): irsaliye(ler) ile fatura satırları
 * stok kartı + varyant bazında toplanır. Dönen farklar yalnız uyarıdır,
 * bağlamayı engellemez. Birimi farklı kalemin miktarı karşılaştırılmaz —
 * çevrim katsayısı olmadan "5 koli" ile "60 adet" kıyaslanamaz.
 */
export function irsaliyeFaturaFarklari(irsaliye: KarsilastirmaSatiri[], fatura: KarsilastirmaSatiri[]): KarsilastirmaFarki[] {
  const irs = grupla(irsaliye);
  const ftr = grupla(fatura);
  const farklar: KarsilastirmaFarki[] = [];
  for (const [anahtar, i] of irs) {
    const f = ftr.get(anahtar);
    if (!f) {
      farklar.push({ tur: "yalniz_irsaliyede", ad: i.ad, mesaj: `${i.ad}: irsaliyede ${bicimle(i.toplam)} ${[...i.birimler].join("/")} var, faturada yok` });
      continue;
    }
    const ayniBirim = i.birimler.size === 1 && f.birimler.size === 1 && [...i.birimler][0] === [...f.birimler][0];
    if (!ayniBirim) {
      farklar.push({ tur: "birim", ad: i.ad, mesaj: `${i.ad}: birimler farklı (irsaliye ${[...i.birimler].join("/")}, fatura ${[...f.birimler].join("/")}); miktar karşılaştırılamadı` });
      continue;
    }
    if (Math.abs(i.toplam - f.toplam) > MIKTAR_TOLERANSI) {
      const birim = [...i.birimler][0];
      farklar.push({ tur: "miktar", ad: i.ad, mesaj: `${i.ad}: irsaliyede ${bicimle(i.toplam)} ${birim}, faturada ${bicimle(f.toplam)} ${birim}` });
    }
  }
  for (const [anahtar, f] of ftr) {
    if (!irs.has(anahtar)) {
      farklar.push({ tur: "yalniz_faturada", ad: f.ad, mesaj: `${f.ad}: faturada ${bicimle(f.toplam)} ${[...f.birimler].join("/")} var, irsaliyede yok` });
    }
  }
  return farklar;
}

/**
 * EBLG-82: fatura, malın teslim tarihinden itibaren en geç 7 gün içinde
 * düzenlenir (VUK 231/5); süresinde düzenlenmeyen fatura hiç düzenlenmemiş
 * sayılır. Gün sayısı ayardır (`ebelge.irsaliyeFaturaGunSayisi`), varsayılan
 * bu değer. Kural irsaliyenin türüne değil teslime bağlıdır: kâğıt irsaliye
 * ve e-İrsaliye aynı takip edilir.
 */
export const IRSALIYE_FATURA_GUN_SAYISI = 7;

/** Son güne bu kadar gün kala Bildirim Merkezi uyarır. */
export const IRSALIYE_FATURA_UYARI_GUNU = 2;

const GUN_MS = 86_400_000;
const TR_FARK_MS = 3 * 3_600_000;

/**
 * Teslim günü (`YYYY-MM-DD`, Türkiye takvimi): fiili sevk anı, yoksa irsaliye
 * tarihi. Sevk anı zaman damgasıdır, gece 00:00–03:00 arası sevk UTC'de bir
 * önceki güne düşer; bu yüzden Türkiye saatine çevrilir. İrsaliye tarihi ise
 * saatsiz tarihtir, olduğu gibi okunur.
 */
export function irsaliyeSevkGunu(belge: { fiiliSevkZamani?: Date | string | null; tarih: Date | string }): string {
  if (belge.fiiliSevkZamani) {
    const an = new Date(belge.fiiliSevkZamani);
    if (!Number.isNaN(an.getTime())) return new Date(an.getTime() + TR_FARK_MS).toISOString().slice(0, 10);
  }
  return typeof belge.tarih === "string" ? belge.tarih.slice(0, 10) : belge.tarih.toISOString().slice(0, 10);
}

const gunSayisiOku = (gun: string) => Date.parse(`${gun}T00:00:00Z`) / GUN_MS;

/** Faturanın en geç düzenlenebileceği gün: teslim günü + gün sayısı (1'inde sevk → 8'i). */
export function irsaliyeFaturaSonGun(sevkGunu: string, gunSayisi = IRSALIYE_FATURA_GUN_SAYISI): string {
  return new Date((gunSayisiOku(sevkGunu) + gunSayisi) * GUN_MS).toISOString().slice(0, 10);
}

export interface IrsaliyeFaturaSuresi {
  sevkGunu: string;
  sonGun: string;
  /** Son güne kalan gün; son gün bugünse 0, geçmişse eksi. */
  kalanGun: number;
  gecti: boolean;
  /** Süre dolmadı ama son güne `IRSALIYE_FATURA_UYARI_GUNU` ya da daha az kaldı. */
  yaklasiyor: boolean;
}

export function irsaliyeFaturaSuresi(girdi: { sevkGunu: string; bugun: string; gunSayisi?: number }): IrsaliyeFaturaSuresi {
  const sonGun = irsaliyeFaturaSonGun(girdi.sevkGunu, girdi.gunSayisi);
  const kalanGun = Math.round(gunSayisiOku(sonGun) - gunSayisiOku(girdi.bugun));
  return { sevkGunu: girdi.sevkGunu, sonGun, kalanGun, gecti: kalanGun < 0, yaklasiyor: kalanGun >= 0 && kalanGun <= IRSALIYE_FATURA_UYARI_GUNU };
}

/**
 * Fatura tarihi bağlı irsaliyelerin süresinden sonraysa uyarı metinleri (engel
 * değil: geç kalmış fatura da kesilmek zorundadır). Alışta yükümlülük
 * tedarikçidedir, metin buna göre değişir.
 */
export function faturaGecikmeUyarilari(girdi: {
  faturaTarihi: string;
  yon: "satis" | "alis";
  irsaliyeler: { no: string | null; sevkGunu: string }[];
  gunSayisi?: number;
}): string[] {
  const gunSayisi = girdi.gunSayisi ?? IRSALIYE_FATURA_GUN_SAYISI;
  const tr = (gun: string) => gun.split("-").reverse().join(".");
  return girdi.irsaliyeler.flatMap((i) => {
    const sonGun = irsaliyeFaturaSonGun(i.sevkGunu, gunSayisi);
    if (girdi.faturaTarihi.slice(0, 10) <= sonGun) return [];
    // EBLG-83: gönderilmemiş e-İrsaliyenin henüz numarası yoktur.
    const ad = i.no ? `${i.no} irsaliyesinin` : "numarasız irsaliyenin";
    return [girdi.yon === "satis"
      ? `Fatura, ${ad} ${gunSayisi} günlük süresinden sonra düzenleniyor (son gün ${tr(sonGun)}).`
      : `Tedarikçi faturası ${ad} ${gunSayisi} günlük süresinden sonra düzenlenmiş (son gün ${tr(sonGun)}).`];
  });
}

/**
 * EBLG-83: satış irsaliyesinin kanalı onayda belirlenir ve yalnız firmanın
 * kapsamına bağlıdır. e-İrsaliye kullanıcısı firma her alıcıya e-İrsaliye
 * düzenler — alıcının GİB listesinde olması gerekmez, kayıtlı olmayana belge
 * alıcı etiketi olmadan gider (NES testinde kabul edildi, 2026-09-24).
 * Kullanıcı olmayan firmanın irsaliyesi kâğıttır ve giden e-İrsaliye
 * serisinden numara almaz. Kapsam bilinmiyorsa karar verilmez: yanlış kanalda
 * onaylanan belge ya seride boşluk bırakır ya da kâğıda düşer.
 */
export type IrsaliyeKanali = "eirsaliye" | "kagit";

export function irsaliyeKanali(firmaEirsaliye: boolean | null): { kanal: IrsaliyeKanali } | { hata: string } {
  if (firmaEirsaliye === null) {
    return { hata: "Firmanın e-İrsaliye kapsamı bilinmiyor; irsaliyeyi onaylamadan önce firma kartında e-İrsaliye ayarını seçin ya da GİB mükellef listesini güncelleyin" };
  }
  return { kanal: firmaEirsaliye ? "eirsaliye" : "kagit" };
}

/**
 * EBLG-87: gümrükten depoya kısım kısım sevk irsaliyesinin açıklaması
 * (mali müşavir, 2026-09-24). e-İrsaliyeye `cbc:Note` olarak yazılır.
 */
export function gumrukSeferNotu(girdi: { beyannameNo: string; beyannameTarihi: string; seferNo: number }): string {
  const tarih = girdi.beyannameTarihi.slice(0, 10).split("-").reverse().join(".");
  return `${tarih} Tarih ve ${girdi.beyannameNo} Sayılı Gümrük Beyannamesi muhteviyatı malların gümrükten depoya kısım kısım taşınmasına ilişkin ${girdi.seferNo}. seferidir.`;
}

/**
 * EBLG-89: ihracat irsaliyesinin bağlı olduğu ihracat faturası (mali müşavir
 * önerisi, 2026-09-24; metin kalıbı kullanıcı onayıyla). `cbc:Note` olur.
 */
export function ihracatFaturasiNotu(girdi: { faturaNo: string; faturaTarihi: string }): string {
  const tarih = girdi.faturaTarihi.slice(0, 10).split("-").reverse().join(".");
  return `Bu irsaliye ${tarih} tarih ve ${girdi.faturaNo} numaralı ihracat faturasına istinaden düzenlenmiştir.`;
}

/**
 * EBLG-90: GİB'e ulaşmış e-İrsaliye satıcı tarafından iptal edilemez (mali
 * müşavir, 2026-09-24). Programda iptal engellenmez — stok ve rezerv
 * düzeltilebilmeli — ama kullanıcı yasal yolu bilerek onaylar. GİB'e hiç
 * ulaşmamış (hata) ya da alıcının reddettiği belgede uyarı gerekmez.
 */
export const GIB_ULASMIS_EIRSALIYE_DURUMLARI = ["kuyrukta", "iletildi", "kabul", "kismi_kabul"] as const;

export function eirsaliyeIptalUyarisi(eirsaliye: { durum: string; aliciKayitsiz?: boolean | null } | null | undefined): string | null {
  if (!eirsaliye || !(GIB_ULASMIS_EIRSALIYE_DURUMLARI as readonly string[]).includes(eirsaliye.durum)) return null;
  return eirsaliye.aliciKayitsiz
    ? "Bu belge Sanal Alıcı (GİB) üzerinden iletilmiştir ve alıcı tarafından sistem üzerinden reddedilemez. Sevkiyat fiilen gerçekleşmeyecekse, ticari ve yasal kayıtlarınızın doğruluğu için işlemin iptal edildiğini alıcıya yazılı olarak (KEP, noter vb.) bildirmeniz gerekebilir. Programda yalnız stok ve rezerv düzeltilir; belge GİB'de geçerli kalır."
    : "Bu belge GİB'e iletilmiştir; e-İrsaliyede satıcı tarafından iptal seçeneği yoktur. Mal henüz yola çıkmadıysa alıcınızdan bu irsaliyeye sistem üzerinden RET yanıtı vermesini isteyin; alıcı reddedince belge geçersiz olur. Programda yalnız stok ve rezerv düzeltilir; belge alıcı reddedene kadar GİB'de geçerli kalır.";
}

/**
 * EBLG-92: iptalde gösterilecek uyarı. GİB'e ulaşmış belgede EBLG-90 uyarısı;
 * giden seriden numara almış ama GİB'e ulaşmamış (hiç gönderilmemiş ya da
 * hata almış) belgede numara seride boşluk kalır — müteselsillik zorunludur
 * (213 VUK, 509 Sıra No'lu Tebliğ), boşluk için GİB'e dilekçe ya da tutanak
 * gerekir (mali müşavir, 2026-09-24). İç seriler (AIR, KIR) uyarı gerektirmez.
 */
export function irsaliyeIptalUyarisi(b: {
  tur: string;
  yon: string;
  no: string | null;
  kagitIrsaliye?: boolean | null;
  gumrukDepoSevki?: boolean | null;
  eirsaliye?: { durum: string; aliciKayitsiz?: boolean | null } | null;
}): string | null {
  if (b.tur !== "irsaliye") return null;
  const gib = eirsaliyeIptalUyarisi(b.eirsaliye);
  if (gib) return gib;
  const gidenSeri = (b.yon === "satis" || Boolean(b.gumrukDepoSevki)) && !b.kagitIrsaliye;
  if (!gidenSeri || !b.no || (b.eirsaliye && b.eirsaliye.durum !== "hata")) return null;
  return `Bu belgeye ${b.no} numarası verilmiş ama belge GİB'e ulaşmamıştır. İptal ederseniz bu numara e-İrsaliye serisinde boşluk (atlama) olarak kalır. Mevzuat gereği numaralar kesintisiz olmalıdır; boşluk için İnteraktif Vergi Dairesi üzerinden GİB'e dilekçe vermeniz ve bir numara atlama tespit tutanağı düzenlemeniz gerekir (taslakları "Boşta kalan numaralar" raporundan alabilirsiniz).`;
}
