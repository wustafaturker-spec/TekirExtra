import { redirect } from "next/navigation";

/** RPR-21 (inceleme P2-6): katalogdaki Ürün Hareketleri raporlarına ikinci yoldu; eski bağlantılar katalogda açılır. */
export default function UrunHareketRaporuSayfasi() {
  redirect("/panel/raporlar?rapor=urun-hareket.hareketler");
}
