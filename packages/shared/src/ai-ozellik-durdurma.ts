/**
 * AI-109: yapay zekâ özellik anahtarları. Platform ekibi her birini acil durdurabilir;
 * firma yöneticisi kendi firmasında kapatabilir. Öncelik: acil durdurma > paket (yapay_zeka
 * modülü) > firma ayarı. Kapalı özellik 503 ve açık mesaj döner; bekleyen onaylar ve
 * kuyruktaki işler silinmez, özellik açılınca sürer.
 */
export const AI_OZELLIK_ANAHTARLARI = ["asistan", "asistan_telegram", "arka_plan_gorevi", "sabah_hazirlik", "teklif_otomasyonu", "ocr", "mcp", "metin_tamamlama"] as const;
export type AiOzellikAnahtari = (typeof AI_OZELLIK_ANAHTARLARI)[number];

export const AI_OZELLIK_ADLARI: Record<AiOzellikAnahtari, { ad: string; aciklama: string }> = {
  asistan: { ad: "Asistan (web)", aciklama: "Paneldeki asistan sohbeti ve zamanlanmış asistan görevleri" },
  asistan_telegram: { ad: "Asistan (Telegram)", aciklama: "Telegram'dan asistanla yazışma" },
  arka_plan_gorevi: { ad: "Arka plan analizleri", aciklama: "Tarayıcı kapansa da süren uzun analizler" },
  sabah_hazirlik: { ad: "Sabah hazırlığı", aciklama: "Gece üretilen sabah onay kutusu önerileri" },
  teklif_otomasyonu: { ad: "E-postadan teklif", aciklama: "Gelen e-postalardan otomatik teklif taslağı" },
  ocr: { ad: "Belge okuma (OCR)", aciklama: "Fiş, fatura, çek ve vergi levhası okuma" },
  mcp: { ad: "MCP erişimi", aciklama: "Dış yapay zekâ araçlarının MCP ile bağlanması" },
  metin_tamamlama: { ad: "Metin tamamlama", aciklama: "Açıklama, not ve e-posta alanlarında devam önerisi ve yeniden yazma" },
};

export const aiOzellikAnahtariMi = (x: unknown): x is AiOzellikAnahtari => typeof x === "string" && (AI_OZELLIK_ANAHTARLARI as readonly string[]).includes(x);
