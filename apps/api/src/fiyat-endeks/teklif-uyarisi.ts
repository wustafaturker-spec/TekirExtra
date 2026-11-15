import { Prisma } from "@prisma/client";
import { aySonDegeri } from "./alacak-erimesi";

/**
 * END-20: açık teklifte teklif tarihinden bu yana kur ya da endeks değişimi
 * kiracı eşiğini aştıysa uyarı. Teklif kendiliğinden değişmez; yalnız
 * gösterilir. Dövizli teklifte belgenin kuru bugünkü kurla, TL teklifte
 * teklif günündeki USD kuru bugünküyle karşılaştırılır (maliyet baskısı).
 * Endeks: teklif ayının TÜFE değeri ile son açıklanan ay.
 */
type D = Prisma.Decimal;

export interface TeklifUyarisi { tur: "kur" | "endeks"; degisim: string; mesaj: string }

const yuzde = (o: D) => o.mul(100).toDecimalPlaces(2);
const yuzdeMetni = (o: D) => `%${yuzde(o).abs().toFixed(2).replace(".", ",")}`;

export function teklifUyarilari(g: {
  teklifAyi: string;
  doviz: string;
  /** Dövizli teklifte belge kuru; TL teklifte teklif günündeki USD kuru. */
  oncekiKur: D | null;
  bugunkuKur: D | null;
  kurDovizi: string;
  endeks: Map<string, D>;
  endeksAdi: string;
  esik: { kur: number; endeks: number };
}): TeklifUyarisi[] {
  const uyarilar: TeklifUyarisi[] = [];
  if (g.oncekiKur && g.bugunkuKur && g.oncekiKur.gt(0)) {
    const d = g.bugunkuKur.div(g.oncekiKur).sub(1);
    if (yuzde(d).abs().gte(g.esik.kur)) {
      uyarilar.push({
        tur: "kur", degisim: yuzde(d).toFixed(2),
        mesaj: g.doviz === "TRY"
          ? `Teklif tarihinden bu yana ${g.kurDovizi} kuru ${yuzdeMetni(d)} ${d.gte(0) ? "arttı" : "azaldı"}; TL fiyatlar maliyetin gerisinde kalmış olabilir.`
          : `Teklif kuru ${g.oncekiKur.toFixed(4)}, bugünkü ${g.kurDovizi} kuru ${g.bugunkuKur.toFixed(4)} (${d.gte(0) ? "+" : "−"}${yuzdeMetni(d)}); TL karşılığı değişti.`,
      });
    }
  }
  const e0 = g.endeks.get(g.teklifAyi);
  const son = aySonDegeri(g.endeks, "9999-12-01");
  if (e0 && son && son.ay > g.teklifAyi) {
    const d = son.deger.div(e0).sub(1);
    if (yuzde(d).gte(g.esik.endeks)) {
      uyarilar.push({ tur: "endeks", degisim: yuzde(d).toFixed(2), mesaj: `Teklif ayından bu yana ${g.endeksAdi} ${yuzdeMetni(d)} arttı (son açıklanan ay ${son.ay.slice(0, 7)}); fiyatları gözden geçirin.` });
    }
  }
  return uyarilar;
}
