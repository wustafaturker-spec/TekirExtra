import { ABONELIK_SURELERI, paketFiyatiHesapla } from "../abonelik-odeme/paket-fiyat-sozlesmesi";
import { abonelikKosullariniOku, bagliAbonelikTutari, type BagliAbonelik } from "../tenant/abonelik-kosullari";
import { paketFiyatSemasi } from "./platform-paket-fiyat";

/** Salt okuma karşılaştırmasıdır; uygunluk, atama veya ücret farkı hesaplamaz. */
export function paketFiyatEtkisi(a: BagliAbonelik, hedef: { planKodu: string | null; fiyatlandirma: unknown }) {
  const fiyat = paketFiyatSemasi.parse(hedef.fiyatlandirma);
  const kosullar = abonelikKosullariniOku(a);
  const ayniPlan = hedef.planKodu !== null && hedef.planKodu === (a.planKodu === "v1" ? "profesyonel" : a.planKodu);
  const karsilastirilabilir = ayniPlan && kosullar !== null;
  const yaz = (t: ReturnType<typeof paketFiyatiHesapla> | null) => t ? {
    matrah: t.matrah.toFixed(2), kdv: t.kdv.toFixed(2), toplam: t.toplam.toFixed(2),
  } : null;
  return {
    karsilastirilabilir,
    neden: !ayniPlan ? "farkli_veya_eslenmeyen_plan" : !kosullar ? "kayitli_kosul_yok" : null,
    donemler: ABONELIK_SURELERI.map((ay) => {
      const once = kosullar ? bagliAbonelikTutari(a, ay) : null;
      const sonra = fiyat.donemler.some((d) => d.aySayisi === ay) ? paketFiyatiHesapla(fiyat, ay) : null;
      return { aySayisi: ay, once: yaz(once), sonra: yaz(sonra),
        fark: karsilastirilabilir && once && sonra ? yaz({ matrah: sonra.matrah.sub(once.matrah), kdv: sonra.kdv.sub(once.kdv), toplam: sonra.toplam.sub(once.toplam) }) : null };
    }),
  };
}
