/**
 * İl / ilçe seçimi ve vergi dairesi eşleşmesi.
 *
 * GİB vergi dairesi listesi büyükşehirlerdeki daireleri ilçe yerine "Merkez"
 * altında verir (İstanbul'da 61 daire "Merkez", yalnız 4 çevre ilçe ayrı).
 * Bu yüzden ilçe listesi vergi dairelerinden türetilemez: ilçe resmi listeden
 * seçilir, vergi dairesi ise il içinden seçilir.
 */

import { IL_ILCE_VERISI } from "./il-ilce-verisi";

export interface Il {
  kod: string;
  ad: string;
  ilceler: readonly string[];
}

const TR = new Intl.Collator("tr");

export const ILLER: readonly Il[] = IL_ILCE_VERISI.map(([kod, ad, ilceler]) => ({ kod, ad, ilceler: [...ilceler].sort(TR.compare) }));

const IL_KODA = new Map(ILLER.map((i) => [i.kod, i]));
const IL_ADA = new Map(ILLER.map((i) => [i.ad.toLocaleLowerCase("tr"), i]));

/** GİB listesinde eski yazımla duran ilçe adlarının resmi karşılığı. */
const GIB_ILCE_ESLERI: Readonly<Record<string, string>> = { "Doğubeyazıt": "Doğubayazıt", "Balâ": "Bala", "Göroymak": "Güroymak" };

export function ilBul(kodVeyaAd: string | null | undefined): Il | undefined {
  if (!kodVeyaAd) return undefined;
  const deger = kodVeyaAd.trim();
  return IL_KODA.get(deger.padStart(2, "0")) ?? IL_ADA.get(deger.toLocaleLowerCase("tr"));
}

export function ilceleriGetir(kodVeyaAd: string | null | undefined): readonly string[] {
  return ilBul(kodVeyaAd)?.ilceler ?? [];
}

/** İlçe, ilin resmi ilçelerinden biri mi (büyük/küçük harf duyarsız). */
export function ilceGecerliMi(il: string | null | undefined, ilce: string | null | undefined): boolean {
  if (!ilce) return false;
  const aranan = ilce.trim().toLocaleLowerCase("tr");
  return ilceleriGetir(il).some((x) => x.toLocaleLowerCase("tr") === aranan);
}

export interface VergiDairesiSecenegi {
  kod: string;
  ilKodu: string;
  il: string;
  ilce: string;
  ad: string;
}

/**
 * İlin vergi dairelerini seçilen ilçeye yakınlığa göre sıralar: önce GİB'de
 * aynı ilçede kayıtlı olanlar, sonra adı ilçe adıyla başlayanlar (ör. büyükşehirde
 * "Merkez" altındaki "Kadıköy Vergi Dairesi"), sonra ilin geri kalanı.
 */
export function vergiDaireleriniSirala<T extends VergiDairesiSecenegi>(daireler: readonly T[], ilKodu: string, ilce: string | null | undefined): { yakin: T[]; diger: T[] } {
  const ildeki = daireler.filter((d) => d.ilKodu === ilKodu).sort((a, b) => TR.compare(a.ad, b.ad));
  if (!ilce) return { yakin: [], diger: ildeki };
  const aranan = ilce.toLocaleLowerCase("tr");
  const ayniIlce = (d: T) => (GIB_ILCE_ESLERI[d.ilce] ?? d.ilce).toLocaleLowerCase("tr") === aranan;
  const adiIlceyle = (d: T) => d.ad.toLocaleLowerCase("tr").startsWith(`${aranan} `);
  const yakin = [...ildeki.filter(ayniIlce), ...ildeki.filter((d) => !ayniIlce(d) && adiIlceyle(d))];
  return { yakin, diger: ildeki.filter((d) => !yakin.includes(d)) };
}

/** Seçilen ilçede GİB'de tek daire kayıtlıysa onu döner (kendiliğinden seçim için). */
export function tekVergiDairesi<T extends VergiDairesiSecenegi>(daireler: readonly T[], ilKodu: string, ilce: string | null | undefined): T | undefined {
  if (!ilce) return undefined;
  const aranan = ilce.toLocaleLowerCase("tr");
  const ayni = daireler.filter((d) => d.ilKodu === ilKodu && (GIB_ILCE_ESLERI[d.ilce] ?? d.ilce).toLocaleLowerCase("tr") === aranan);
  return ayni.length === 1 ? ayni[0] : undefined;
}
