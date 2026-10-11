"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { PageHeader } from "@/components/ui";

/** Kendi ekranı olan raporlar katalogda bağlantı olarak durur. */
const AYRI_EKRANLAR = [
  { modul: "genel", ad: "Gelir - Gider Raporu", aciklama: "Gelir ve gider kalemleri, kategori kırılımı ve kâr marjı (ayrı ekran)", href: "/panel/raporlar/gelir-gider" },
];

export default function RaporlarSayfasi() {
  return (
    <div>
      <PageHeader
        title="Raporlar & Analiz"
        subtitle="Tüm modüllerin raporları tek yerde: soldan raporu seçin, dönemi ve filtreleri belirleyip çalıştırın; Excel ya da PDF olarak indirin, sık kullandığınız filtreleri görünüm olarak saklayın."
      />
      <RaporPaneli ayriEkranlar={AYRI_EKRANLAR} />
    </div>
  );
}
