import type { Prisma } from "@prisma/client";
import { raporTanimiAl, type RaporSatiri } from "../core/raporlar/rapor-kayit";
import type { IcgoruIcerigi } from "../ai/icgoru/nakit-tahsilat-analizi";
import type { FiyatEndeksErisimi } from "./fiyat-endeks-erisim";
import "./fiyat-endeks.raporlar";
import "./fiyat-endeks-makas.raporlar";

/**
 * END-22: brifing ve içgörü için deterministik fiyat–endeks bulguları. Son
 * tamamlanmış 12 ay; hesap mevcut raporların kendisidir (marj makası,
 * tedarikçi zam denetimi, fiyat–endeks karşılaştırması). Model kullanılmaz;
 * erişilemeyen taraf (satış/alış) atlanır ve bunu söyler.
 */
type Tx = Prisma.TransactionClient;

export interface FiyatEndeksOzeti {
  donem: { baslangic: string; bitis: string };
  makasAcilan: number | null;
  endeksUstuTedarikci: { sayi: number; ornekler: { tedarikci: string; urun: string; fark: string }[] } | null;
  reelGerileyen: { sayi: number; ornekler: { urun: string; reel: string }[] } | null;
  erisilemeyen: ("satis" | "alis")[];
}

const ayKaydir = (ay: string, n: number) => { const [y, a] = ay.split("-").map(Number); return new Date(Date.UTC(y, a - 1 + n, 1)).toISOString().slice(0, 10); };

export async function fiyatEndeksOzeti(tx: Tx, tenantId: string, erisim: FiyatEndeksErisimi, simdi = new Date()): Promise<FiyatEndeksOzeti> {
  const buAy = simdi.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7) + "-01";
  const baslangic = ayKaydir(buAy, -12), bitis = new Date(Date.parse(`${buAy}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const calistir = (kod: string, filtreler: Record<string, string | boolean>): Promise<RaporSatiri[]> =>
    raporTanimiAl(kod)!.calistir({ filtreler: { baslangic, bitis, ...filtreler } }, { tenantId, tx });
  const erisilemeyen: ("satis" | "alis")[] = [];
  if (!erisim.satis) erisilemeyen.push("satis");
  if (!erisim.alis) erisilemeyen.push("alis");

  const makasAcilan = erisim.satis && erisim.alis ? (await calistir("stok.marj_makasi", { yalnizEsikUstu: true })).length : null;
  let endeksUstuTedarikci: FiyatEndeksOzeti["endeksUstuTedarikci"] = null;
  if (erisim.alis) {
    const r = await calistir("stok.tedarikci_zam", { yalnizUstunde: true });
    endeksUstuTedarikci = {
      sayi: new Set(r.map((x) => x.cariId)).size,
      ornekler: r.slice(0, 3).map((x) => ({ tedarikci: String(x.tedarikci), urun: String(x.ad), fark: String(x.endeksFarki) })),
    };
  }
  let reelGerileyen: FiyatEndeksOzeti["reelGerileyen"] = null;
  if (erisim.satis) {
    const r = (await calistir("stok.fiyat_endeks", { endeks: "TUFE", taraf: "satis" })).filter((x) => x.reelDegisim !== null && Number(x.reelDegisim) < 0);
    reelGerileyen = { sayi: r.length, ornekler: r.slice(0, 3).map((x) => ({ urun: String(x.ad), reel: String(x.reelDegisim) })) };
  }
  return { donem: { baslangic, bitis }, makasAcilan, endeksUstuTedarikci, reelGerileyen, erisilemeyen };
}

const yuzde = (s: string) => `%${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Brifing satırı; bulgu yoksa null. */
export function ozetSatiri(o: FiyatEndeksOzeti): string | null {
  const parca: string[] = [];
  if (o.makasAcilan) parca.push(`${o.makasAcilan} üründe marj makası açıldı`);
  if (o.endeksUstuTedarikci?.sayi) parca.push(`${o.endeksUstuTedarikci.sayi} tedarikçi Yİ-ÜFE'nin üzerinde zam yaptı`);
  if (o.reelGerileyen?.sayi) parca.push(`${o.reelGerileyen.sayi} ürünün satış fiyatı TÜFE karşısında reel geriledi`);
  return parca.length ? `• Fiyat ve endeks (son 12 ay): ${parca.join("; ")}.` : null;
}

/** END-22: yeni endeks açıklanınca yazılan içgörü kaydının içeriği. */
export function endeksIcgorusu(o: FiyatEndeksOzeti, seri: { ad: string; donem: string }): IcgoruIcerigi {
  const bulgular: IcgoruIcerigi["bulgular"] = [];
  if (o.makasAcilan) bulgular.push({ metin: `${o.makasAcilan} üründe maliyet satış fiyatından eşiğin üzerinde hızlı arttı (marj makası).`, baglanti: "/panel/raporlar?rapor=stok.marj_makasi" });
  if (o.endeksUstuTedarikci?.sayi) {
    const ornek = o.endeksUstuTedarikci.ornekler.map((x) => `${x.tedarikci} – ${x.urun} (+${x.fark} puan)`).join("; ");
    bulgular.push({ metin: `${o.endeksUstuTedarikci.sayi} tedarikçi endeksin üzerinde zam yaptı${ornek ? `: ${ornek}` : ""}.`, baglanti: "/panel/raporlar?rapor=stok.tedarikci_zam" });
  }
  if (o.reelGerileyen?.sayi) {
    const ornek = o.reelGerileyen.ornekler.map((x) => `${x.urun} (${yuzde(x.reel)})`).join("; ");
    bulgular.push({ metin: `${o.reelGerileyen.sayi} ürünün satış fiyatı TÜFE karşısında reel olarak geriledi${ornek ? `: ${ornek}` : ""}.`, baglanti: "/panel/raporlar?rapor=stok.fiyat_endeks" });
  }
  const sayi = bulgular.length;
  return {
    onem: o.makasAcilan || o.endeksUstuTedarikci?.sayi ? "uyari" : "bilgi",
    baslik: `${seri.ad} ${seri.donem.slice(0, 7)} açıklandı: fiyat ve endeks bulguları`,
    ozet: sayi ? `Son 12 ayda ${sayi} başlıkta fiyatların endeks karşısındaki durumu gözden geçirilmeli.` : "Son 12 ayda endeks karşısında dikkat gerektiren fiyat bulgusu yok.",
    metrikler: {
      makasAcilan: o.makasAcilan ?? "erişim yok",
      endeksUstuTedarikci: o.endeksUstuTedarikci?.sayi ?? "erişim yok",
      reelGerileyen: o.reelGerileyen?.sayi ?? "erişim yok",
    },
    bulgular,
    kanitlar: [
      { kaynak: "Marj Makası raporu", aciklama: `${o.donem.baslangic} – ${o.donem.bitis}, firmanın makas eşiği` },
      { kaynak: "Tedarikçi Zam Denetimi raporu", aciklama: "Yİ-ÜFE, yalnız endeksin üzerinde zam yapanlar" },
      { kaynak: "Fiyat–Endeks Karşılaştırması raporu", aciklama: "TÜFE, satış fiyatı, baz ay dönem başı" },
    ],
    varsayimlar: ["Hesap faturalardan ve TCMB EVDS endekslerinden yapılır; model sayı üretmez."],
    uyarilar: o.erisilemeyen.length ? [`Rol erişimi olmadığı için atlanan taraf: ${o.erisilemeyen.map((t) => (t === "satis" ? "satış fiyatı" : "alış/maliyet")).join(", ")}.`] : [],
  };
}
