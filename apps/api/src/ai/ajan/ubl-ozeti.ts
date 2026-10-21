import { faturaUblOku } from "../../ebelge/ubl-oku";

/** AI-79: UBL e-Fatura ise kısa özeti; değilse null (XML başka bir belge olabilir). */
export function ublOzeti(xml: string) {
  try {
    const u = faturaUblOku(xml);
    if (!u.belgeNo || !u.satirlar.length) return null;
    return { belgeNo: u.belgeNo, tarih: u.tarih, profil: u.profilId, tip: u.faturaTipKodu, gonderen: u.gonderen.unvan, gonderenVkn: u.gonderen.vknTckn, aliciVkn: u.alici.vknTckn, genelToplam: u.toplamlar.genelToplam.toFixed(2), doviz: u.dovizCinsi, satirSayisi: u.satirlar.length };
  } catch {
    return null;
  }
}
