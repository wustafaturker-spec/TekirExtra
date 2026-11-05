export type LimitAnahtari = "kullanici" | "cari" | "stok" | "aylikFatura";

/**
 * Abonelik kaydı yoksa açılan plan. Şemadaki varsayılanla aynıdır ve
 * `profesyonel` plana eşlenir.
 */
export const VARSAYILAN_PLAN_KODU = "v1";

export const ABONELIK_PLANLARI = [
  { kod: "baslangic", ad: "Başlangıç", aciklama: "Küçük ekipler için temel finans ve stok yönetimi.", aylikFiyat: 399, limitler: { kullanici: 3, cari: 250, stok: 500, aylikFatura: 100 }, ozellikler: ["Cari, fatura ve stok", "Kasa ve banka", "Temel raporlar"] },
  { kod: "profesyonel", ad: "Profesyonel", aciklama: "Büyüyen işletmeler için geniş limitler ve entegrasyonlar.", aylikFiyat: 999, onerilen: true, limitler: { kullanici: 10, cari: 2500, stok: 5000, aylikFatura: 1000 }, ozellikler: ["Başlangıç planındaki her şey", "e-Belge ve banka bağlantıları", "Pazaryeri ve POS", "Gelişmiş raporlar"] },
  { kod: "kurumsal", ad: "Kurumsal", aciklama: "Yüksek hacimli ekipler için limitsiz kullanım.", aylikFiyat: null, limitler: { kullanici: null, cari: null, stok: null, aylikFatura: null }, ozellikler: ["Profesyonel planındaki her şey", "Limitsiz kayıt ve kullanıcı", "Öncelikli destek"] },
] as const;
