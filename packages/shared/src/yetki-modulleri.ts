/**
 * KLN-20: özel rollerin yetki matrisi. Tek kaynak: API guard'ı, menü/sayfa
 * erişimi ve asistan/MCP araç süzgeci bir isteği buradaki modül + işlem
 * anahtarına çevirir. Özel rol şablonunun yetkilerini aşamaz; yalnız kutu
 * kapatır (`kapaliKutular`).
 *
 * Modül, istek yolunun (`/api/v1` sonrası) en uzun eşleşen önekinden; işlem
 * HTTP yönteminden ve yol adındaki eylemden çıkar. Hiçbir modüle düşmeyen
 * yollar (oturum, bildirim, yürürlükteki mevzuat…) özel rolde kapatılamaz.
 */

export const YETKI_ISLEMLERI = ["goruntule", "duzenle", "onayla", "sil"] as const;
export type YetkiIslemi = (typeof YETKI_ISLEMLERI)[number];

export const YETKI_ISLEM_ADI: Record<YetkiIslemi, string> = {
  goruntule: "Görüntüle",
  duzenle: "Oluştur/Düzenle",
  onayla: "Onayla/Kesinleştir",
  sil: "Sil/İptal",
};

export interface YetkiModulu {
  kod: string;
  ad: string;
  /** API yol önekleri (başında / yok). */
  api: readonly string[];
  /** Panel sayfa önekleri; görüntüle kapalıysa menüden kalkar ve sayfa açılmaz. */
  panel: readonly string[];
  /**
   * Görüntüleme başka ekranların da okuduğu ortak veridir (ör. firma bilgisi,
   * döviz kuru, modül ayarları); bu modülde yalnız yazma kutuları kapatılabilir.
   */
  yalnizYazma?: boolean;
  /** `yalnizYazma` modülünde görüntüleme kutusuna yine de bağlı olan hassas okumalar (API yol önekleri). */
  korunanOkuma?: readonly string[];
}

export const YETKI_MODULLERI: readonly YetkiModulu[] = [
  { kod: "satis", ad: "Satış (teklif/sipariş/CRM)", api: ["belgeler", "crm", "is-kutusu", "ai/teklif-talepleri", "fiyat-listeleri", "b2b", "pazaryeri", "eposta/gelen"], panel: ["/panel/satis", "/panel/belgeler", "/panel/crm", "/panel/is-kutusu", "/panel/pazaryeri", "/panel/eposta", "/panel/stok/fiyat-listeleri"] },
  { kod: "fatura", ad: "Fatura", api: ["fatura", "kur-farki"], panel: ["/panel/fatura", "/panel/kasa-banka/kur-farki"] },
  { kod: "ebelge", ad: "e-Belge", api: ["ebelge"], panel: ["/panel/ebelge"] },
  { kod: "cari", ad: "Cari", api: ["cari", "cari-mahsuplari", "mutabakat"], panel: ["/panel/cari"] },
  { kod: "kasa_banka", ad: "Kasa-Banka (kredi, kart, çek-senet, ödeme talimatı)", api: ["kasa-banka", "pos"], panel: ["/panel/kasa-banka"] },
  { kod: "masraf_gelir", ad: "Masraf ve Gelir", api: ["masraflar", "gelirler"], panel: ["/panel/masraflar", "/panel/gelirler"] },
  { kod: "satin_alma", ad: "Satın Alma", api: ["satin-alma"], panel: ["/panel/satin-alma"] },
  { kod: "stok", ad: "Stok ve Depo", api: ["stok", "depo", "sevkiyat"], panel: ["/panel/stok"] },
  { kod: "uretim", ad: "Üretim", api: ["uretim"], panel: ["/panel/uretim"] },
  { kod: "personel", ad: "Personel ve İK", api: ["personel", "self-servis-davet"], panel: ["/panel/personel"] },
  { kod: "demirbas_arac", ad: "Demirbaş ve Araç", api: ["demirbas", "arac-takip"], panel: ["/panel/demirbas", "/panel/araclar"] },
  { kod: "projeler", ad: "Projeler", api: ["projeler"], panel: ["/panel/projeler"] },
  { kod: "butce_nakit", ad: "Bütçe ve Nakit Akışı", api: ["butce", "nakit-akisi"], panel: ["/panel/butce", "/panel/nakit-akisi"] },
  { kod: "raporlar", ad: "Raporlar", api: ["raporlar", "rapor", "rapor-abonelikleri", "ai/rapor"], panel: ["/panel/raporlar"] },
  { kod: "mali_musavir", ad: "Mali Müşavir ve Muhasebe Aktarımı", api: ["mali-musavir"], panel: ["/panel/mali-musavir"] },
  { kod: "donem_kapatma", ad: "Dönem Kapatma", api: ["donem-kapatma", "duzeltmeler"], panel: ["/panel/donem-kapatma"] },
  { kod: "yapay_zeka", ad: "Yapay Zekâ ve Asistan", api: ["ai", "mcp"], panel: ["/panel/ai"] },
  {
    kod: "ayarlar", ad: "Ayarlar", yalnizYazma: true, korunanOkuma: ["denetim", "eposta/gecmis"],
    api: ["ayarlar", "kullanicilar", "ozel-roller", "denetim", "kullanim", "eposta", "ileti-sablonlari", "guvenlik-politikasi", "destek-izni", "abonelik", "calisma-takvimi", "doviz-kurlari", "firma", "baglantilar", "belge-gorunumu", "veri-aktarimi"],
    panel: ["/panel/ayarlar/kullanicilar", "/panel/ayarlar/denetim", "/panel/ayarlar/kullanim", "/panel/ayarlar/guvenlik", "/panel/ayarlar/abonelik", "/panel/ayarlar/ileti-sablonlari", "/panel/ayarlar/veri-aktarimi"],
  },
];

const MODUL_KODLARI = new Set(YETKI_MODULLERI.map((m) => m.kod));

/** "modul.islem" biçimi; özel rolün kapalı kutuları bu anahtarlarla saklanır. */
export function yetkiAnahtari(modul: string, islem: YetkiIslemi): string {
  return `${modul}.${islem}`;
}

export function gecerliYetkiAnahtariMi(anahtar: string): boolean {
  const [modul, islem] = anahtar.split(".");
  return MODUL_KODLARI.has(modul) && (YETKI_ISLEMLERI as readonly string[]).includes(islem);
}

const ONEKLER = YETKI_MODULLERI
  .flatMap((m) => m.api.map((onek) => ({ onek, modul: m })))
  .sort((a, b) => b.onek.length - a.onek.length);

/** Yolun (sorgu ve `/api/v1` olmadan, ör. `fatura/123/kesinlestir`) modülü. */
export function yolModulu(yol: string): YetkiModulu | null {
  const temiz = yol.replace(/^\/+/, "").replace(/^api\/v\d+\//, "").split("?")[0];
  for (const { onek, modul } of ONEKLER) {
    if (temiz === onek || temiz.startsWith(`${onek}/`)) return modul;
  }
  return null;
}

/** Yol adındaki onay/kesinleştirme ve iptal/silme eylemleri (yalnız tam bölüt eşleşmesi). */
const ONAY_EYLEMLERI = new Set(["onayla", "onay", "kesinlestir", "onaya-gonder", "gonder", "toplu-gonder", "yeniden-gonder", "taslak-gonder", "simdi-gonder", "yayinla", "ode", "faturalastir", "karar", "yurt-disi-onay", "giderlestir", "gerceklesti"]);
const SIL_EYLEMLERI = new Set(["iptal", "sil", "geri-al", "taslak-iptal", "odeme-iptal", "onay-geri-al", "slip-geri-al", "cikis-geri-al", "gerceklesme-geri-al", "taslaga-geri-al", "fatura-bagini-kaldir", "iptal-bildir"]);

/**
 * İsteğin işlemi. `saltOkuma`: yöntemi POST olsa da veri değiştirmeyen uç
 * (rapor çalıştırma, önizleme, dışa aktarma) görüntüleme sayılır.
 */
export function yolIslemi(yontem: string, yol: string, saltOkuma = false): YetkiIslemi {
  const y = yontem.toUpperCase();
  if (y === "GET" || y === "HEAD" || saltOkuma) return "goruntule";
  if (y === "DELETE") return "sil";
  const bolutler = yol.split("?")[0].split("/");
  if (bolutler.some((b) => SIL_EYLEMLERI.has(b))) return "sil";
  if (bolutler.some((b) => ONAY_EYLEMLERI.has(b))) return "onayla";
  return "duzenle";
}

/** Görüntüleme, bu yolda özel rolün görüntüleme kutusuna bağlı mı? `yalnizYazma` modüllerde yalnız korunan okumalar. */
export function okumaKutusunaBagli(modul: YetkiModulu, yol: string): boolean {
  if (!modul.yalnizYazma) return true;
  const temiz = yol.replace(/^\/+/, "").replace(/^api\/v\d+\//, "").split("?")[0];
  return (modul.korunanOkuma ?? []).some((onek) => temiz === onek || temiz.startsWith(`${onek}/`));
}

/** İstek özel rolün kapattığı bir kutuya mı düşüyor? */
export function ozelRolIstegiKapali(kapaliKutular: readonly string[], yontem: string, yol: string, saltOkuma = false): boolean {
  if (!kapaliKutular.length) return false;
  const modul = yolModulu(yol);
  if (!modul) return false;
  const islem = yolIslemi(yontem, yol, saltOkuma);
  if (islem === "goruntule" && !okumaKutusunaBagli(modul, yol)) return false;
  return kapaliKutular.includes(yetkiAnahtari(modul.kod, islem));
}

/** Panel sayfası özel rolde görüntüleme kapalı bir modüle mi ait? */
export function ozelRolPanelYoluKapali(kapaliKutular: readonly string[], href: string): boolean {
  if (!kapaliKutular.length) return false;
  const yol = href.split("?")[0];
  let enUzun: { modul: YetkiModulu; uzunluk: number } | null = null;
  for (const m of YETKI_MODULLERI) {
    for (const p of m.panel) {
      if ((yol === p || yol.startsWith(`${p}/`)) && (!enUzun || p.length > enUzun.uzunluk)) enUzun = { modul: m, uzunluk: p.length };
    }
  }
  return Boolean(enUzun && kapaliKutular.includes(yetkiAnahtari(enUzun.modul.kod, "goruntule")));
}

/** KLN-21 / rapor-bildirim alıcıları: özel rol hedefi "ozel:<id>" biçimindedir. */
export const OZEL_ROL_ONEKI = "ozel:";
