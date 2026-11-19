import type { PanelWidget } from "@tekirextra/shared";

type Sablon<T = PanelWidget> = T extends PanelWidget ? Omit<T, "id"> : never;

const SABLONLAR = {
  haftalikAlacak: { baslik: "Bu haftanın açık alacakları", kaynak: "vade", filtre: "alacak_bu_hafta", gorunum: "tutar" },
  haftalikBorc: { baslik: "Bu haftanın açık borçları", kaynak: "vade", filtre: "borc_bu_hafta", gorunum: "liste" },
  aylikTahsilat: { baslik: "Bu ayın tahsilatı", kaynak: "tahsilat", filtre: "bu_ay", gorunum: "tutar" },
  kritikStok: { baslik: "Kritik stoklar", kaynak: "stok", filtre: "kritik", gorunum: "sayi" },
  bekleyenler: { baslik: "Onay bekleyen hazırlıklar", kaynak: "sabah", filtre: "bekleyen", gorunum: "sayi" },
  sabahListesi: { baslik: "İncelenecek hazırlıklar", kaynak: "sabah", filtre: "bekleyen", gorunum: "liste" },
} as const satisfies Record<string, Sablon>;

type SablonKodu = keyof typeof SABLONLAR;

const ROL_SABLONLARI: Record<string, readonly SablonKodu[]> = {
  yonetici: ["aylikTahsilat", "haftalikAlacak", "bekleyenler"],
  muhasebe: ["haftalikAlacak", "haftalikBorc", "aylikTahsilat"],
  satis: ["sabahListesi", "bekleyenler"],
  mali_musavir: ["haftalikAlacak", "haftalikBorc", "aylikTahsilat"],
};

export function widgetSablonlari(rol: string, kaynaklar: readonly PanelWidget["kaynak"][]) {
  const kodlar = ROL_SABLONLARI[rol] ?? ["kritikStok"];
  return kodlar.filter((kod) => kaynaklar.includes(SABLONLAR[kod].kaynak))
    .map((kod) => ({ kod, widget: SABLONLAR[kod] }));
}
