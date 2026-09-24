/**
 * Listedeki zaman damgası. Bölge bilgisi taşımayan değer GİB'in saati, yani
 * Türkiye saatidir; UTC sanılırsa gece yarısına yakın kayıt bir gün kayar.
 */
export function gibZamani(deger?: string): string | undefined {
  const metin = deger?.trim();
  if (!metin) return undefined;
  const bolgeli = /(Z|[+-]\d{2}:?\d{2})$/.test(metin) ? metin : `${metin}+03:00`;
  const an = new Date(bolgeli);
  return Number.isNaN(an.getTime()) ? undefined : an.toISOString();
}

/** `urn:mail:defaultpk@nes.com.tr` → `nes.com.tr` */
export function etiketAlanAdi(etiket?: string | null): string | undefined {
  const i = etiket?.lastIndexOf("@") ?? -1;
  return i > 0 ? etiket!.slice(i + 1).toLowerCase() : undefined;
}

/** `urn:mail:defaultpk@nes.com.tr` → `defaultpk` */
export function etiketYerelAdi(etiket: string): string {
  return (/^urn:mail:([^@]+)/.exec(etiket)?.[1] ?? "").toLowerCase();
}

/**
 * Alıcının posta kutusunu seçer (EBLG-86). Tek etiket varsa soru yoktur;
 * gerçek firmaların neredeyse tamamı bu durumdadır.
 *
 * Birden çoksa veriden çıkarılabilecek en güvenilir sinyal, etiketin **bizim
 * entegratörümüzün alan adında** olmasıdır: alıcı da aynı entegratördeyse
 * teslimat oradan yürür. Bu küme içinde GİB'in birincil kutu adlandırması olan
 * `defaultpk` tercih edilir, kalan eşitlik en yeni kayıtla bozulur.
 *
 * Denenip elenen iki kural: "listenin ilki" (API sırası rastgele; yerel listede
 * alfabetik ilk — 2026-09-24'te GİB test VKN'sinde teslim edilmeyen bir kutuyu
 * seçti) ve "en yeni etiket" — GİB test VKN'lerinde yıllar içinde her
 * entegratörden etiket birikir; Kurum 02'nin 225 etiketinin 57'si `defaultpk`
 * ve en yenisi yürürlükteki kutu değil. Seçim bu yüzden bir tahmindir; cari
 * kartında elle seçilen kutu kuralın önüne geçer.
 *
 * Yerel liste ve canlı sorgu aynı kuralı kullanır; kayıt zamanı ISO metnidir.
 */
export function postaKutusuSec(
  adaylar: readonly { postaKutusu: string; kayitZamani?: string | null }[],
  kendiEtiketimiz?: string | null,
): string | undefined {
  if (adaylar.length <= 1) return adaylar[0]?.postaKutusu;
  const bizimAlan = etiketAlanAdi(kendiEtiketimiz);
  const ayniEntegrator = bizimAlan ? adaylar.filter((e) => etiketAlanAdi(e.postaKutusu) === bizimAlan) : [];
  const havuz = ayniEntegrator.length ? ayniEntegrator : adaylar;
  const varsayilanlar = havuz.filter((e) => etiketYerelAdi(e.postaKutusu) === "defaultpk");
  // Eşit zamanlı adaylarda sonuç sıraya bağlı kalmasın diye etiket adı ikinci anahtardır.
  return (varsayilanlar.length ? varsayilanlar : havuz)
    .slice()
    .sort((a, b) => (b.kayitZamani ?? "").localeCompare(a.kayitZamani ?? "") || a.postaKutusu.localeCompare(b.postaKutusu))[0]?.postaKutusu;
}
