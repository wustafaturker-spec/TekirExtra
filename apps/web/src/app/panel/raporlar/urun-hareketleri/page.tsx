"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { PageHeader } from "@/components/ui";

export default function UrunHareketRaporuSayfasi() {
  return <div>
    <PageHeader title="Ürün Hareket Raporu" subtitle="Stok giriş ve çıkışlarını, fireleri, üretim hareketlerini ve alıcı bazlı ürün satışlarını inceleyin." />
    <RaporPaneli modul="urun_hareket" />
  </div>;
}
