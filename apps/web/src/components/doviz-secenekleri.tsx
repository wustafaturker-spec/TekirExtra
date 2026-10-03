import { DOVIZ_ADLARI, DOVIZ_CINSLERI, SIK_DOVIZLER, type DovizKodu } from "@tekirextra/shared";

/**
 * DVZ-10: döviz seçim kutusunun seçenekleri — sık kullanılanlar üstte,
 * kalan TCMB dövizleri "Diğer dövizler" grubunda. `adli` kodun yanına adını
 * yazar; `yalnizYabanci` TL'yi çıkarır.
 */
export function DovizSecenekleri({ adli = false, yalnizYabanci = false }: { adli?: boolean; yalnizYabanci?: boolean }) {
  const uygun = (d: DovizKodu) => !yalnizYabanci || d !== "TRY";
  const secenek = (d: DovizKodu) => (
    <option key={d} value={d}>
      {adli ? `${d} — ${DOVIZ_ADLARI[d]}` : d}
    </option>
  );
  return (
    <>
      {SIK_DOVIZLER.filter(uygun).map(secenek)}
      <optgroup label="Diğer dövizler">{DOVIZ_CINSLERI.filter((d) => !SIK_DOVIZLER.includes(d) && uygun(d)).map(secenek)}</optgroup>
    </>
  );
}
