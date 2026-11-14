/**
 * ETC-01/02: entegrasyon kataloğu. Ayarlar ekranı, bağlantı doğrulaması ve talep kaydı aynı
 * tanımı kullanır. `etkin` kartlar bağlanabilir; `yakinda` kartlar yalnız "İlgileniyorum" talebi alır.
 */
export type EntegrasyonKategorisi = "pazaryeri" | "eticaret";
export type KimlikAlani = "kullaniciAdi" | "parola" | "apiAnahtari" | "saticiId" | "magazaId" | "servisAdresi" | "entegratorAdi";

export interface KatalogAlani {
  alan: KimlikAlani;
  etiket: string;
  ipucu?: string;
  gizli?: boolean;
  /** Zorunlu; `veya` verilirse o gruptaki alanlardan biri yeter (Shopify: anahtar ya da istemci kimliği+sırrı). */
  zorunlu?: boolean;
}

export interface KatalogKaydi {
  kod: string;
  ad: string;
  kategori: EntegrasyonKategorisi;
  durum: "etkin" | "yakinda";
  /** `public/entegrasyon/<logo>`; yoksa ad yazılır. */
  logo?: string;
  alanlar?: KatalogAlani[];
  /** Kısa "anahtarı nereden alırım" anlatımı. */
  anahtarYeri?: string;
  /** ETC-12: kayıttan sonra platformda kullanıcı onayı gerekir (OAuth2 authorization_code). */
  yetkiAkisi?: "oauth";
}

export const ENTEGRASYON_KATEGORILERI: Record<EntegrasyonKategorisi, string> = { pazaryeri: "Pazaryeri", eticaret: "E-ticaret sitesi" };

export const ENTEGRASYON_KATALOGU: readonly KatalogKaydi[] = [
  { kod: "trendyol", ad: "Trendyol", kategori: "pazaryeri", durum: "etkin", logo: "trendyol.svg",
    alanlar: [{ alan: "kullaniciAdi", etiket: "API key", zorunlu: true }, { alan: "parola", etiket: "API secret", gizli: true, zorunlu: true }, { alan: "saticiId", etiket: "Satıcı ID", zorunlu: true }],
    anahtarYeri: "Trendyol Satıcı Paneli › Hesap Bilgilerim › Entegrasyon Bilgileri." },
  { kod: "hepsiburada", ad: "Hepsiburada", kategori: "pazaryeri", durum: "etkin", logo: "hepsiburada.svg",
    alanlar: [{ alan: "kullaniciAdi", etiket: "Servis kullanıcı adı", zorunlu: true }, { alan: "parola", etiket: "Servis anahtarı", gizli: true, zorunlu: true }, { alan: "magazaId", etiket: "Merchant ID", zorunlu: true }, { alan: "entegratorAdi", etiket: "Entegratör adı (User-Agent)", ipucu: "Satıcı Paneli'ndeki entegratör adı" }],
    anahtarYeri: "Hepsiburada Satıcı Paneli › Entegrasyon: entegratöre tanımlanan servis kullanıcı adı ve anahtarı; entegratör adı her istekte User-Agent olarak gönderilir." },
  { kod: "n11", ad: "n11", kategori: "pazaryeri", durum: "etkin", logo: "n11.svg",
    alanlar: [{ alan: "kullaniciAdi", etiket: "App key", zorunlu: true }, { alan: "parola", etiket: "App secret", gizli: true, zorunlu: true }],
    anahtarYeri: "n11 Mağaza Yönetimi › Hesabım › API Hesapları." },
  { kod: "amazon_tr", ad: "Amazon", kategori: "pazaryeri", durum: "etkin", logo: "amazon.svg",
    alanlar: [{ alan: "kullaniciAdi", etiket: "LWA client ID", zorunlu: true }, { alan: "parola", etiket: "LWA client secret", gizli: true, zorunlu: true }, { alan: "apiAnahtari", etiket: "Refresh token", gizli: true, zorunlu: true }, { alan: "saticiId", etiket: "Seller ID", zorunlu: true }, { alan: "magazaId", etiket: "Marketplace ID", zorunlu: true }],
    anahtarYeri: "Seller Central › Uygulamalar ve Hizmetler › Uygulama geliştirme." },
  { kod: "woocommerce", ad: "WooCommerce", kategori: "eticaret", durum: "etkin", logo: "woocommerce.svg",
    alanlar: [{ alan: "servisAdresi", etiket: "Site adresi", ipucu: "https://magazam.com", zorunlu: true }, { alan: "kullaniciAdi", etiket: "Consumer key", ipucu: "ck_…", zorunlu: true }, { alan: "parola", etiket: "Consumer secret", ipucu: "cs_…", gizli: true, zorunlu: true }],
    anahtarYeri: "WordPress yönetimi › WooCommerce › Ayarlar › Gelişmiş › REST API › Anahtar ekle (Okuma/Yazma)." },
  { kod: "shopify", ad: "Shopify", kategori: "eticaret", durum: "etkin", logo: "shopify.svg",
    alanlar: [{ alan: "kullaniciAdi", etiket: "Mağaza adı", ipucu: "magazam.myshopify.com", zorunlu: true }, { alan: "apiAnahtari", etiket: "Admin API erişim anahtarı", ipucu: "shpat_… (eski özel uygulama)", gizli: true }, { alan: "saticiId", etiket: "İstemci kimliği (Client ID)", ipucu: "Dev Dashboard uygulaması" }, { alan: "parola", etiket: "İstemci sırrı (Client secret)", gizli: true }],
    anahtarYeri: "Shopify Dev Dashboard › uygulama oluşturun, mağazanıza kurun; izinler: read_orders, read_products, write_products, write_inventory, read_locations. Eski özel uygulamanız varsa yalnız erişim anahtarını girin." },
  { kod: "ikas", ad: "ikas", kategori: "eticaret", durum: "etkin", logo: "ikas.svg",
    alanlar: [{ alan: "kullaniciAdi", etiket: "Mağaza adı", ipucu: "magazam.myikas.com", zorunlu: true }, { alan: "saticiId", etiket: "Client ID", zorunlu: true }, { alan: "parola", etiket: "Client secret", gizli: true, zorunlu: true }],
    anahtarYeri: "ikas yönetim paneli › Uygulamalar › Uygulamalarım › Özel Uygulama Oluştur; izinler: read_orders, read_products, write_products, write_inventories." },
  { kod: "ticimax", ad: "Ticimax", kategori: "eticaret", durum: "etkin", logo: "ticimax.svg",
    alanlar: [{ alan: "servisAdresi", etiket: "Site adresi", ipucu: "https://www.magazam.com", zorunlu: true }, { alan: "apiAnahtari", etiket: "Web servis yetki kodu", gizli: true, zorunlu: true }],
    anahtarYeri: "Ticimax yönetim paneli › Ayarlar › Web Servis Ayarları › yetki kodu (Sipariş ve Ürün servis yetkileri açık)." },
  { kod: "ideasoft", ad: "İdeaSoft", kategori: "eticaret", durum: "etkin", yetkiAkisi: "oauth",
    alanlar: [{ alan: "servisAdresi", etiket: "Mağaza adresi", ipucu: "https://magazam.myideasoft.com", zorunlu: true }, { alan: "saticiId", etiket: "Client ID", zorunlu: true }, { alan: "parola", etiket: "Client Secret", gizli: true, zorunlu: true }],
    anahtarYeri: "İdeaSoft yönetim paneli › Entegrasyonlar › API › Ekle: Yönlendirme (Redirect) adresine aşağıdaki dönüş adresini yazın; izinler: sipariş okuma, ürün okuma ve yazma. Client ID ve Client Secret'ı buraya girip kaydedin, ardından \"İdeaSoft'ta yetki ver\" ile onaylayın." },
  { kod: "tsoft", ad: "T-Soft", kategori: "eticaret", durum: "yakinda", logo: "tsoft.svg" },
  { kod: "ciceksepeti", ad: "Çiçeksepeti", kategori: "pazaryeri", durum: "yakinda" },
  { kod: "pazarama", ad: "Pazarama", kategori: "pazaryeri", durum: "yakinda" },
  { kod: "pttavm", ad: "PttAVM", kategori: "pazaryeri", durum: "yakinda" },
  { kod: "temu", ad: "Temu", kategori: "pazaryeri", durum: "yakinda", logo: "temu.svg" },
];

export const katalogKaydi = (kod: string) => ENTEGRASYON_KATALOGU.find((k) => k.kod === kod);
export const YAKINDA_KODLARI = ENTEGRASYON_KATALOGU.filter((k) => k.durum === "yakinda").map((k) => k.kod);

/** ETC-08…11: e-ticaret sitesi kimliğinde eksik ya da yanlış alan; yoksa null. Pazaryerlerine uygulanmaz. */
export function eticaretKimlikHatasi(saglayici: string, c: Partial<Record<KimlikAlani, string | undefined>>): string | null {
  const dolu = (a: KimlikAlani) => Boolean(c[a]?.trim());
  const magaza = /^[a-z0-9][a-z0-9-]{0,60}(\.(myshopify|myikas)\.com)?$/i;
  switch (saglayici) {
    case "woocommerce":
      if (!dolu("servisAdresi")) return "Site adresi zorunludur";
      if (!dolu("kullaniciAdi") || !dolu("parola")) return "Consumer key ve consumer secret zorunludur";
      return null;
    case "shopify":
      if (!dolu("kullaniciAdi") || !magaza.test(c.kullaniciAdi!.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))) return "Shopify mağaza adı geçersiz (ör. magazam ya da magazam.myshopify.com)";
      if (!dolu("apiAnahtari") && !(dolu("saticiId") && dolu("parola"))) return "Admin API erişim anahtarı ya da istemci kimliği ve sırrı zorunludur";
      return null;
    case "ikas":
      if (!dolu("kullaniciAdi") || !magaza.test(c.kullaniciAdi!.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))) return "ikas mağaza adı geçersiz (ör. magazam ya da magazam.myikas.com)";
      if (!dolu("saticiId") || !dolu("parola")) return "Client ID ve client secret zorunludur";
      return null;
    case "ticimax":
      if (!dolu("servisAdresi")) return "Site adresi zorunludur";
      if (!dolu("apiAnahtari")) return "Web servis yetki kodu zorunludur";
      return null;
    case "ideasoft":
      if (!dolu("servisAdresi")) return "Mağaza adresi zorunludur";
      if (!dolu("saticiId") || !dolu("parola")) return "Client ID ve Client Secret zorunludur";
      return null;
    default:
      return null;
  }
}

export const ETICARET_SAGLAYICILARI = ["woocommerce", "shopify", "ikas", "ticimax", "ideasoft"] as const;
