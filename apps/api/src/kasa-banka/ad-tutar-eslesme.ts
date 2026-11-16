import { Prisma } from "@prisma/client";

/**
 * KSB-45: açıklamadaki adla bulunan (ya da ad adayları arasından seçilecek)
 * caride ekstre tutarının nasıl tuttuğu. Sıra: tek faturanın kalanı → en eski
 * vadeden başlayan ardışık faturaların toplamı → carinin toplam bakiyesi.
 * Yalnız hesap dövizindeki açık faturalar sayılır.
 */
export type TutarEslesmesiTuru = "tek_fatura" | "ardisik_faturalar" | "bakiye";
export interface TutarEslesmesi {
  tur: TutarEslesmesiTuru;
  /** Önerilen dağıtım; bakiyede faturaya düşmeyen kısım avans/cari bakiyesi olarak kalır. */
  dagitim: Array<{ faturaId: string; tutar: string }>;
  aciklama: string;
}
export interface EslesmeFaturasi { id: string; no: string | null; tarih: string; vadeTarihi: string | null; dovizCinsi: string; kalan: string }

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);
const eskidenYeniye = (a: EslesmeFaturasi, b: EslesmeFaturasi) =>
  (a.vadeTarihi ?? "9999-12-31").localeCompare(b.vadeTarihi ?? "9999-12-31") || a.tarih.localeCompare(b.tarih) || a.id.localeCompare(b.id);

/**
 * Tutarın tek bir şekilde tuttuğu eşleşme; tutmuyorsa ya da birden çok fatura
 * aynı kalanla tutuyorsa (hangisi bilinemez) null. `bakiye` carinin hesap
 * dövizindeki bakiyesidir (borç − alacak); girişte alacağımızı, çıkışta
 * borcumuzu kapatan tutar aranır.
 */
export function tutarEslesmesiBul(faturalar: EslesmeFaturasi[], bakiye: Prisma.Decimal | null, mutlak: Prisma.Decimal, giris: boolean, doviz: string): TutarEslesmesi | null {
  const acik = faturalar.filter((f) => f.dovizCinsi === doviz && D(f.kalan).gt(0)).sort(eskidenYeniye);
  const tekler = acik.filter((f) => D(f.kalan).equals(mutlak));
  if (tekler.length > 1) return null;
  if (tekler.length === 1) return { tur: "tek_fatura", dagitim: [{ faturaId: tekler[0].id, tutar: mutlak.toFixed(2) }], aciklama: `${tekler[0].no ?? "fatura"} kalanı tutarla aynı` };
  // Kalanlar pozitif olduğundan ön toplamlar artar: en çok bir ön dizi tutar.
  let toplam = D(0);
  for (let i = 0; i < acik.length; i++) {
    toplam = toplam.add(acik[i].kalan);
    if (toplam.gt(mutlak)) break;
    if (i > 0 && toplam.equals(mutlak)) {
      const dizi = acik.slice(0, i + 1);
      return { tur: "ardisik_faturalar", dagitim: dizi.map((f) => ({ faturaId: f.id, tutar: D(f.kalan).toFixed(2) })), aciklama: `en eski ${dizi.length} faturanın kalanı toplamı tutarla aynı` };
    }
  }
  const kapatilan = bakiye ? (giris ? bakiye : bakiye.neg()) : null;
  if (kapatilan && kapatilan.gt(0) && kapatilan.equals(mutlak)) {
    const dagitim: TutarEslesmesi["dagitim"] = [];
    let kalan = mutlak;
    for (const f of acik) {
      if (kalan.lte(0)) break;
      const pay = Prisma.Decimal.min(kalan, D(f.kalan));
      dagitim.push({ faturaId: f.id, tutar: pay.toFixed(2) });
      kalan = kalan.sub(pay);
    }
    return { tur: "bakiye", dagitim, aciklama: "carinin toplam bakiyesini kapatıyor" };
  }
  return null;
}
