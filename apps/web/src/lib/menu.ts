/**
 * Ana navigasyonun tek doğruluk kaynağı.
 *
 * Yan menüde 55 bağlantıyı düz listeleyen önceki yapı, kullanıcıyı aradığını
 * bulmak yerine yerini ezberlemeye zorluyordu. Menü artık sekiz çalışma
 * alanına bölünmüştür ve ikinci seviye yalnız açık alan için gösterilir;
 * böylece ekranda aynı anda ~8 alan + ~6 madde durur. Ayarlar ana
 * navigasyondan çıkarılıp alt köşedeki kullanıcı menüsüne taşınmıştır —
 * günlük iş akışının parçası değildir.
 *
 * Komut paleti (⌘K) de bu listeyi kullanır; buraya eklenen sayfa aramada
 * kendiliğinden çıkar.
 */
import {
  Archive,
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  BookUser,
  Boxes,
  Building2,
  Calculator,
  CalendarRange,
  ChartColumn,
  ChartNoAxesColumn,
  ClipboardCheck,
  Contact,
  CreditCard,
  Factory,
  FileSpreadsheet,
  FileStack,
  FileText,
  FolderKanban,
  FolderTree,
  Gauge,
  Inbox,
  Landmark,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  Package,
  Package2,
  Percent,
  PiggyBank,
  Plug,
  Receipt,
  Repeat,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Tags,
  Target,
  Terminal,
  TrendingUp,
  TriangleAlert,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface MenuOge {
  href: string;
  ikon: LucideIcon;
  baslik: string;
  /** "tam": yalnız birebir yol eşleşmesi aktif sayılır. */
  eslesme?: "tam" | "onek";
  /** Komut paletindeki eşanlamlılar — kullanıcının aklındaki sözcük. */
  esanlamlilar?: string[];
}

export interface MenuAlani {
  baslik: string;
  ikon: LucideIcon;
  ogeler: MenuOge[];
}

export const MENU: MenuAlani[] = [
  {
    baslik: "Özet",
    ikon: Gauge,
    ogeler: [
      { href: "/panel", ikon: Gauge, baslik: "Finansal Özet", eslesme: "tam", esanlamlilar: ["ana sayfa", "dashboard", "kokpit"] },
      { href: "/panel/islemler", ikon: TriangleAlert, baslik: "Düzeltme Merkezi", eslesme: "tam", esanlamlilar: ["hata", "istisna", "uyarı"] },
      { href: "/panel/bildirimler", ikon: Bell, baslik: "Bildirimler", eslesme: "tam", esanlamlilar: ["uyarı", "hatırlatma", "görev"] },
      { href: "/panel/donem-kapatma", ikon: Lock, baslik: "Dönem Kapatma", eslesme: "tam", esanlamlilar: ["mali dönem", "kilit", "kapanış"] },
      { href: "/panel/nakit-akisi", ikon: TrendingUp, baslik: "Nakit Akışı", eslesme: "tam", esanlamlilar: ["nakit akış tahmini", "nakit tahmini", "likidite", "senaryo"] },
      { href: "/panel/butce", ikon: CalendarRange, baslik: "Bütçe", eslesme: "tam", esanlamlilar: ["plan", "gerçekleşen", "sapma", "revizyon"] },
      { href: "/panel/ai", ikon: Sparkles, baslik: "AI Finansal Asistan", eslesme: "tam", esanlamlilar: ["yapay zeka", "ocr"] },
    ],
  },
  {
    baslik: "Satış",
    ikon: TrendingUp,
    ogeler: [
      { href: "/panel/satis", ikon: ShoppingCart, baslik: "Satış İşlemleri", eslesme: "onek", esanlamlilar: ["çalışma alanı", "satış özeti"] },
      { href: "/panel/belgeler?tur=teklif&yon=satis", ikon: ScrollText, baslik: "Satış Teklifleri", eslesme: "tam", esanlamlilar: ["teklif", "fiyat teklifi", "proforma"] },
      { href: "/panel/belgeler?tur=siparis&yon=satis", ikon: ClipboardCheck, baslik: "Satış Siparişleri", eslesme: "tam", esanlamlilar: ["sipariş", "müşteri siparişi", "sevkiyat"] },
      { href: "/panel/fatura?yon=satis", ikon: FileText, baslik: "Satış Faturaları", eslesme: "tam", esanlamlilar: ["kesilen fatura", "müşteri faturası"] },
      { href: "/panel/crm", ikon: Target, baslik: "CRM Satış Hunisi", eslesme: "tam", esanlamlilar: ["fırsat", "pipeline", "aday"] },
      { href: "/panel/b2b", ikon: Store, baslik: "B2B Bayi Portalı", eslesme: "tam", esanlamlilar: ["bayi", "katalog"] },
      { href: "/panel/pazaryeri", ikon: Package, baslik: "Pazaryeri Siparişleri", eslesme: "tam", esanlamlilar: ["trendyol", "hepsiburada", "n11", "amazon"] },
      { href: "/panel/pazaryeri/kesintiler", ikon: Percent, baslik: "Pazaryeri Kesintileri", eslesme: "tam", esanlamlilar: ["komisyon", "hakediş"] },
    ],
  },
  {
    baslik: "Satın Alma",
    ikon: ShoppingBag,
    ogeler: [
      { href: "/panel/satin-alma", ikon: ShoppingBag, baslik: "Satın Alma İşlemleri", eslesme: "tam", esanlamlilar: ["tedarik", "sipariş"] },
      { href: "/panel/satin-alma/talepler", ikon: ShoppingBag, baslik: "Satın Alma Talepleri", eslesme: "onek", esanlamlilar: ["talep", "onay", "teklif", "tedarikçi teklifi"] },
      { href: "/panel/belgeler?tur=siparis&yon=alis", ikon: ClipboardCheck, baslik: "Satın Alma Siparişleri", eslesme: "tam", esanlamlilar: ["sipariş", "tedarikçi siparişi", "mal kabul", "teslim bekleyen"] },
      { href: "/panel/fatura?yon=alis", ikon: FileText, baslik: "Alış Faturaları", eslesme: "tam", esanlamlilar: ["gelen fatura", "tedarikçi faturası"] },
      { href: "/panel/satin-alma/irsaliye-eslesme", ikon: ClipboardCheck, baslik: "İrsaliye–Fatura Eşleşmesi", eslesme: "tam", esanlamlilar: ["faturası gelmemiş irsaliye", "gelen e-irsaliye", "irsaliyesiz fatura", "eşleşmeyen"] },
      { href: "/panel/masraflar", ikon: Receipt, baslik: "Masraflar", eslesme: "tam", esanlamlilar: ["gider", "fiş", "harcama"] },
      { href: "/panel/masraflar/kiralar", ikon: Building2, baslik: "Kira Sözleşmeleri", eslesme: "tam", esanlamlilar: ["kira", "stopaj"] },
      { href: "/panel/masraflar/raporlar", ikon: ChartColumn, baslik: "Masraf Raporları", eslesme: "tam" },
      { href: "/panel/gelirler", ikon: PiggyBank, baslik: "Faaliyet Dışı Gelirler", eslesme: "tam", esanlamlilar: ["diğer gelir"] },
    ],
  },
  {
    baslik: "Belgeler & e-Belge",
    ikon: FileStack,
    ogeler: [
      { href: "/panel/belgeler", ikon: FileStack, baslik: "Tüm Belgeler", eslesme: "tam", esanlamlilar: ["teklif", "sipariş", "irsaliye", "zincir"] },
      { href: "/panel/fatura/tekrarlayan", ikon: Repeat, baslik: "Tekrarlayan Faturalar", esanlamlilar: ["abonelik", "periyodik"] },
      { href: "/panel/ebelge/fatura-gelen", ikon: Inbox, baslik: "Gelen e-Faturalar", eslesme: "tam", esanlamlilar: ["gib", "gelen kutusu"] },
      { href: "/panel/ebelge/irsaliye-gelen", ikon: Truck, baslik: "Gelen e-İrsaliyeler", eslesme: "tam" },
      { href: "/panel/ebelge/irsaliye-giden", ikon: Truck, baslik: "Giden e-İrsaliyeler", eslesme: "tam", esanlamlilar: ["sevk", "irsaliye gönder", "e-irsaliye durumu"] },
      { href: "/panel/ebelge/kuyruk", ikon: ListChecks, baslik: "e-Belge Operasyonları", eslesme: "tam", esanlamlilar: ["kuyruk", "gönderim", "hata"] },
      { href: "/panel/fatura/earsiv-raporlari", ikon: Archive, baslik: "e-Arşiv Raporları", eslesme: "tam" },
    ],
  },
  {
    baslik: "Finans",
    ikon: Wallet,
    ogeler: [
      { href: "/panel/kasa-banka", ikon: Landmark, baslik: "Kasa & Banka", eslesme: "tam", esanlamlilar: ["tahsilat", "ödeme", "virman", "nakit"] },
      { href: "/panel/kasa-banka/kredi-kartlari", ikon: CreditCard, baslik: "Kredi Kartları", eslesme: "tam", esanlamlilar: ["taksit", "ekstre"] },
      { href: "/panel/kasa-banka/pos", ikon: Terminal, baslik: "POS Hesapları", eslesme: "tam", esanlamlilar: ["sanal pos", "iyzico", "paytr"] },
      { href: "/panel/kasa-banka/cek-senet", ikon: ScrollText, baslik: "Çek & Senetler", eslesme: "tam", esanlamlilar: ["portföy", "vade", "ciro"] },
      { href: "/panel/kasa-banka/ekstre", ikon: FileSpreadsheet, baslik: "Banka Ekstresi", eslesme: "tam", esanlamlilar: ["mutabakat", "eşleştirme", "csv"] },
      { href: "/panel/projeler", ikon: FolderKanban, baslik: "Projeler & Analitik Yevmiye", eslesme: "tam", esanlamlilar: ["maliyet merkezi"] },
    ],
  },
  {
    baslik: "Stok & Üretim",
    ikon: Boxes,
    ogeler: [
      { href: "/panel/stok", ikon: Package2, baslik: "Stok Kartları", eslesme: "tam", esanlamlilar: ["ürün", "malzeme", "barkod"] },
      { href: "/panel/stok/kategoriler", ikon: FolderTree, baslik: "Kategoriler", eslesme: "tam" },
      { href: "/panel/stok/sayim", ikon: ClipboardCheck, baslik: "Stok Sayımı", eslesme: "tam", esanlamlilar: ["envanter"] },
      { href: "/panel/stok/transferler", ikon: ArrowLeftRight, baslik: "Depo Transferi", eslesme: "tam", esanlamlilar: ["sevk", "depo"] },
      { href: "/panel/stok/fiyat-listeleri", ikon: Tags, baslik: "Fiyat Listeleri", eslesme: "tam", esanlamlilar: ["iskonto", "bayi fiyatı"] },
      { href: "/panel/uretim", ikon: Factory, baslik: "Üretim Emirleri", eslesme: "tam", esanlamlilar: ["reçete", "iş emri"] },
      { href: "/panel/uretim/planlama", ikon: CalendarRange, baslik: "Üretim Planlama", eslesme: "tam", esanlamlilar: ["kapasite", "vardiya"] },
      { href: "/panel/uretim/maliyet", ikon: Calculator, baslik: "Üretim Maliyeti", eslesme: "tam", esanlamlilar: ["sapma"] },
      { href: "/panel/uretim/kalite", ikon: BadgeCheck, baslik: "Kalite Kontrol", eslesme: "tam", esanlamlilar: ["hurda", "yeniden işleme"] },
    ],
  },
  {
    baslik: "Cari & Personel",
    ikon: Users,
    ogeler: [
      { href: "/panel/cari", ikon: Contact, baslik: "Cari Hesaplar", esanlamlilar: ["müşteri", "tedarikçi", "bakiye", "ekstre"] },
      { href: "/panel/personel", ikon: UserCog, baslik: "Personel & İK", eslesme: "tam", esanlamlilar: ["bordro", "izin", "avans", "sgk"] },
    ],
  },
  {
    baslik: "Raporlar",
    ikon: ChartNoAxesColumn,
    ogeler: [
      { href: "/panel/raporlar", ikon: ChartNoAxesColumn, baslik: "Raporlar & Analiz", eslesme: "tam" },
      { href: "/panel/raporlar/gelir-gider", ikon: ChartColumn, baslik: "Gelir - Gider Raporu", eslesme: "tam", esanlamlilar: ["kâr", "zarar"] },
      { href: "/panel/raporlar/urun-hareketleri", ikon: Package, baslik: "Ürün Hareket Raporu", eslesme: "tam" },
      { href: "/panel/mali-musavir", ikon: BookUser, baslik: "Mali Müşavir Portalı", eslesme: "tam", esanlamlilar: ["luca", "zirve", "kdv", "beyanname"] },
    ],
  },
];

/**
 * Ayarlar ana navigasyondan ayrıdır: günde bir kez değil, ayda bir kez
 * girilen sayfalardır. Alt köşedeki kullanıcı menüsünden ve komut paletinden
 * erişilir.
 */
export const AYARLAR: MenuOge[] = [
  { href: "/panel/ayarlar/firma", ikon: Building2, baslik: "Firma Ayarları", eslesme: "tam" },
  { href: "/panel/ayarlar/kullanicilar", ikon: Users, baslik: "Kullanıcılar", eslesme: "tam", esanlamlilar: ["rol", "yetki", "bayi"] },
  { href: "/panel/ayarlar/fatura-serileri", ikon: FileText, baslik: "Fatura Serileri", eslesme: "tam" },
  { href: "/panel/ayarlar/doviz-kurlari", ikon: ChartColumn, baslik: "Döviz Kurları", eslesme: "tam", esanlamlilar: ["kur", "tcmb", "usd", "eur", "elle kur"] },
  { href: "/panel/ayarlar/depolar", ikon: Boxes, baslik: "Depolar", eslesme: "tam" },
  { href: "/panel/ayarlar/araclar", ikon: Truck, baslik: "Araçlar ve Şoförler", eslesme: "tam", esanlamlilar: ["plaka", "dorse", "şoför", "sevkiyat", "e-irsaliye"] },
  { href: "/panel/ayarlar/entegratorler", ikon: Plug, baslik: "e-Belge Ayarları", eslesme: "tam", esanlamlilar: ["sovos", "izibiz", "entegratör"] },
  { href: "/panel/ayarlar/pazaryerleri", ikon: Store, baslik: "Pazaryeri Ayarları", eslesme: "tam" },
  { href: "/panel/ayarlar/pos", ikon: Terminal, baslik: "Sanal POS Ayarları", eslesme: "tam" },
  { href: "/panel/ayarlar/banka-baglantilari", ikon: Landmark, baslik: "Banka Bağlantıları", eslesme: "tam" },
  { href: "/panel/ayarlar/sms", ikon: MessageSquare, baslik: "SMS Ayarları", eslesme: "tam", esanlamlilar: ["netgsm"] },
  { href: "/panel/ayarlar/eposta", ikon: Mail, baslik: "E-posta Ayarları", eslesme: "tam", esanlamlilar: ["smtp"] },
  { href: "/panel/ayarlar/bildirimler", ikon: Bell, baslik: "Bildirim Tercihleri", eslesme: "tam", esanlamlilar: ["sessiz saat", "kanal", "e-posta bildirimi"] },
  { href: "/panel/ayarlar/moduller", ikon: Settings, baslik: "Modül Ayarları", eslesme: "tam" },
  { href: "/panel/ayarlar/abonelik", ikon: CreditCard, baslik: "Abonelik ve Paket", eslesme: "tam" },
  { href: "/panel/ayarlar/denetim", ikon: ShieldCheck, baslik: "Denetim İzi", eslesme: "tam", esanlamlilar: ["log", "audit"] },
  { href: "/panel/ayarlar/kullanim", ikon: ChartColumn, baslik: "Kullanım Metrikleri", eslesme: "tam" },
  { href: "/panel/ayarlar/hesap", ikon: ShieldCheck, baslik: "Hesap Güvenliği", eslesme: "tam", esanlamlilar: ["parola", "totp", "iki adımlı"] },
];

/**
 * Yan menüye alınmayacak kadar dar kapsamlı, ama erişilebilir kalması gereken
 * sayfalar. Komut paletinde çıkar, navigasyonu şişirmez.
 */
export const PALET_EK_SAYFALAR: MenuOge[] = [
  { href: "/panel/fatura/tekrarlayan/raporlar", ikon: ChartColumn, baslik: "Tekrarlayan Fatura Raporları", eslesme: "tam" },
];

/** Tüm gezilebilir sayfalar — komut paletinin sayfa kaynağı. */
export const TUM_SAYFALAR: MenuOge[] = [
  ...MENU.flatMap((alan) => alan.ogeler),
  ...PALET_EK_SAYFALAR,
  ...AYARLAR,
];

/** Menü maddesinin sorgusu açık sayfanınkiyle örtüşüyor mu? */
function sorguEslesiyor(hedefSorgu: string, aktifArama: string): boolean {
  const hedef = new URLSearchParams(hedefSorgu);
  const aktif = new URLSearchParams(aktifArama);
  return Array.from(hedef.entries()).every(([anahtar, deger]) => aktif.get(anahtar) === deger);
}

/**
 * Menü maddesi açık sayfayı mı gösteriyor?
 *
 * Aynı sayfayı hem süzgeçli (ör. "Satış Siparişleri") hem süzgeçsiz (ör. "Tüm
 * Belgeler") gösteren maddeler var. Süzgeçli madde eşleştiğinde süzgeçsiz olan
 * geri çekilir; yoksa iki madde birden aktif görünürdü.
 */
export function menuOgesiAktifMi(oge: MenuOge, pathname: string, aktifArama: string, menu: MenuAlani[] = MENU): boolean {
  const [hedefYol, hedefSorgu = ""] = oge.href.split("?");
  const yolEslesiyor = oge.eslesme === "tam" ? pathname === hedefYol : pathname.startsWith(hedefYol);
  if (!yolEslesiyor) return false;
  if (hedefSorgu) return sorguEslesiyor(hedefSorgu, aktifArama);
  return !menu.some((alan) =>
    alan.ogeler.some((digerOge) => {
      const [digerYol, digerSorgu = ""] = digerOge.href.split("?");
      return digerSorgu !== "" && digerYol === hedefYol && sorguEslesiyor(digerSorgu, aktifArama);
    }),
  );
}
