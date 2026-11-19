import { ayBasiTR, gunEkleTR, gunTR, type VadeDonemi } from "@tekirextra/shared";

export type VadeAraligi = { baslangic: Date; bitisHaric: Date };

export function vadeDonemAraligi(donem: VadeDonemi, an = new Date()) {
  const bugun = gunTR(an);
  const bugunBaslangic = new Date(`${bugun}T00:00:00Z`);
  const pazartesidenSonra = (bugunBaslangic.getUTCDay() + 6) % 7;
  const baslangic = donem === "bu_hafta" ? gunEkleTR(-pazartesidenSonra, an) : ayBasiTR(an);
  const bitisHaric = donem === "bu_hafta"
    ? new Date(`${gunEkleTR(7 - pazartesidenSonra, an)}T00:00:00Z`)
    : new Date(Date.UTC(bugunBaslangic.getUTCFullYear(), bugunBaslangic.getUTCMonth() + 1, 1));
  const bitis = new Date(bitisHaric.getTime() - 86_400_000).toISOString().slice(0, 10);
  return { baslangic, bitis, bugunBaslangic, aralik: { baslangic: new Date(`${baslangic}T00:00:00Z`), bitisHaric } };
}
