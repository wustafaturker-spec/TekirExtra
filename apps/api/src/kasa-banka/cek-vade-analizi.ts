import { Prisma } from "@prisma/client";
export interface VadeEvraki {
  yon: "alinan" | "verilen"; durum: string; vadeTarihi: Date; tutar: Prisma.Decimal; dovizCinsi: string;
}
export const CEK_VADE_ACIK_DURUMLARI = ["portfoyde", "tahsile_verildi", "teminata_verildi", "verildi"] as const;
export function cekVadeAnalizi(kayitlar: VadeEvraki[], bugun: string) {
  const gun = (t: string) => Date.parse(`${t}T00:00:00Z`) / 86_400_000;
  const gunEkle = (n: number) => new Date((gun(bugun) + n) * 86_400_000).toISOString().slice(0, 10);
  const gruplar = [
    { kod: "geciken", ad: "Vadesi geçmiş", min: -Infinity, max: -1, baslangic: null, bitis: gunEkle(-1) },
    { kod: "bugun", ad: "Bugün", min: 0, max: 0, baslangic: bugun, bitis: bugun },
    { kod: "7gun", ad: "1–7 gün", min: 1, max: 7, baslangic: gunEkle(1), bitis: gunEkle(7) },
    { kod: "30gun", ad: "8–30 gün", min: 8, max: 30, baslangic: gunEkle(8), bitis: gunEkle(30) },
    { kod: "90gun", ad: "31–90 gün", min: 31, max: 90, baslangic: gunEkle(31), bitis: gunEkle(90) },
    { kod: "sonra", ad: "90 günden sonra", min: 91, max: Infinity, baslangic: gunEkle(91), bitis: null },
  ];
  const acik = kayitlar.filter((k) => (CEK_VADE_ACIK_DURUMLARI as readonly string[]).includes(k.durum));
  const toplamlar = (liste: VadeEvraki[]) => {
    const dovizler = new Map<string, { tutar: Prisma.Decimal; adet: number }>();
    for (const k of liste) {
      const t = dovizler.get(k.dovizCinsi) ?? { tutar: new Prisma.Decimal(0), adet: 0 };
      dovizler.set(k.dovizCinsi, { tutar: t.tutar.plus(k.tutar), adet: t.adet + 1 });
    }
    return { adet: liste.length, dovizler: [...dovizler].sort(([a], [b]) => a.localeCompare(b))
      .map(([doviz, t]) => ({ doviz, tutar: t.tutar.toFixed(2), adet: t.adet })) };
  };
  return { bugun, gruplar: gruplar.map((g) => {
    const liste = acik.filter((k) => { const n = gun(k.vadeTarihi.toISOString().slice(0, 10)) - gun(bugun); return n >= g.min && n <= g.max; });
    return { kod: g.kod, ad: g.ad, baslangic: g.baslangic, bitis: g.bitis,
      alinan: toplamlar(liste.filter((k) => k.yon === "alinan")), verilen: toplamlar(liste.filter((k) => k.yon === "verilen")) };
  }), toplam: { alinan: toplamlar(acik.filter((k) => k.yon === "alinan")), verilen: toplamlar(acik.filter((k) => k.yon === "verilen")) },
    uyari: "Dövizler ayrı toplanır; vadeler tahsilat/ödeme garantisi değildir. Bankadaki ve teminattaki evraklar dahildir; ciro edilmiş, tahsil edilmiş, ödenmiş, karşılıksız ve iade edilmiş evraklar bu açık vade tablosunda yer almaz." };
}
