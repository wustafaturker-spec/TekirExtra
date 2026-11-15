"use client";

import { useEffect, useState } from "react";
import { RaporPaneli } from "@/components/rapor-paneli";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { rolMenuYoluGorebilir } from "@/lib/rol-yetkileri";

/** Kendi ekranı olan raporlar katalogda bağlantı olarak durur; rolün göremediği ekran listelenmez (RPR-21). */
const AYRI_EKRANLAR = [
  { modul: "genel", ad: "Gelir - Gider Raporu", aciklama: "Gelir ve gider kalemleri, kategori kırılımı ve kâr marjı (ayrı ekran)", href: "/panel/raporlar/gelir-gider" },
  { modul: "genel", ad: "Bütçe – Gerçekleşen", aciklama: "Aylık bütçe, gerçekleşen ve sapma; revizyonlar (ayrı ekran)", href: "/panel/butce" },
  { modul: "vergi", ad: "Peşin Ödenen Vergiler ve Fonlar", aciklama: "Bizden kesilen stopaj, kaynak kırılımı ve beyannamede mahsup takibi (ayrı ekran)", href: "/panel/raporlar/pesin-vergiler" },
  { modul: "vergi", ad: "Vergi ve SGK Takvimi", aciklama: "KDV, muhtasar ve SGK için son tarih, ön hesap tutar ve ödeme takibi (ayrı ekran)", href: "/panel/raporlar/vergi-takvimi" },
  { modul: "kasa_banka", ad: "Nakit Akışı Tahmini", aciklama: "Vadeli alacak, borç, çek ve planlı ödemelerden ileriye dönük nakit pozisyonu (ayrı ekran)", href: "/panel/nakit-akisi" },
  { modul: "stok", ad: "SMM & Kârlılık", aciklama: "Satılan malın maliyeti ve brüt kâr; ağırlıklı ortalama ya da FIFO (ayrı ekran)", href: "/panel/stok/smm" },
  { modul: "stok", ad: "Endeksli Artışlar", aciklama: "Kira ve tekrarlayan faturada TÜFE/Yİ-ÜFE'ye bağlı yıllık artış önerileri ve kuralları (ayrı ekran)", href: "/panel/raporlar/endeksli-artislar" },
  { modul: "fatura", ad: "Fatura Pivotu", aciklama: "Fatura kalemlerini iki boyutta toplar; cari × ay, ürün × depo… (ayrı ekran)", href: "/panel/fatura/pivot" },
];

export default function RaporlarSayfasi() {
  const [rol, setRol] = useState<string | null>(null);
  useEffect(() => { api<{ rol: string }>("/auth/ben").then((b) => setRol(b.rol)).catch(() => undefined); }, []);
  const ekranlar = rol ? AYRI_EKRANLAR.filter((e) => rolMenuYoluGorebilir(rol, e.href)) : [];
  return (
    <div>
      <PageHeader
        title="Raporlar & Analiz"
        subtitle="Tüm modüllerin raporları tek yerde: soldan raporu seçin, dönemi ve filtreleri belirleyip çalıştırın; Excel ya da PDF olarak indirin, sık kullandığınız filtreleri görünüm olarak saklayın."
      />
      <RaporPaneli ayriEkranlar={ekranlar} />
    </div>
  );
}
