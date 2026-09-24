import type { GibBelgeTuru, Prisma } from "@prisma/client";
import { postaKutusuSec, type EntegratorConfig } from "@tekirextra/baglanti";
import { coz } from "../core/kripto";

/**
 * EBLG-86: alıcının posta kutusu. Gönderim ve cari kartı aynı işlevden okur;
 * kartta görünen kutu ile gönderimde kullanılan kutu ayrışmasın.
 */
export interface PostaKutusuSecimi {
  /** Alıcının GİB listesindeki kutuları; liste boşsa alıcı kayıtlı değildir. */
  adaylar: { postaKutusu: string; kayitZamani: string | null }[];
  /** Gönderimde kullanılacak kutu. */
  secilen?: string;
  /** Kuralın seçtiği kutu (elle seçim olmasaydı). */
  kuralSecimi?: string;
  /** Cari kartında elle seçilen kutu. */
  elleSecilen: string | null;
  /** Elle seçilen kutu listeden düştü; kurala dönüldü. */
  elleSecilenGecersiz: boolean;
  /** Listedeki `<Type>` ("KAMU" / "OZEL"). */
  tur: string | null;
}

export async function postaKutusuSecimi(
  tx: Pick<Prisma.TransactionClient, "gibMukellef">,
  vknTckn: string,
  belgeTuru: GibBelgeTuru,
  elleSecilen: string | null | undefined,
  kendiEtiketimiz: string | null | undefined,
): Promise<PostaKutusuSecimi> {
  const kayitlar = await tx.gibMukellef.findMany({
    where: { vknTckn, belgeTuru },
    select: { postaKutusu: true, kutuKayitZamani: true, tur: true },
    orderBy: { postaKutusu: "asc" },
  });
  const adaylar = kayitlar.map((k) => ({ postaKutusu: k.postaKutusu, kayitZamani: k.kutuKayitZamani?.toISOString() ?? null }));
  const kuralSecimi = postaKutusuSec(adaylar, kendiEtiketimiz);
  const elle = elleSecilen?.trim() || null;
  const elleGecerli = Boolean(elle && adaylar.some((a) => a.postaKutusu === elle));
  return {
    adaylar,
    secilen: elleGecerli ? elle! : kuralSecimi,
    kuralSecimi,
    elleSecilen: elle,
    elleSecilenGecersiz: Boolean(elle) && !elleGecerli,
    tur: kayitlar[0]?.tur ?? null,
  };
}

/**
 * Kiracının aktif e-belge bağlantısındaki gönderici birim etiketi. Kutu
 * kuralı alıcının bizim entegratörümüzdeki kutusunu tercih eder; alan adı bu
 * etiketten okunur.
 */
export async function kendiGbEtiketi(tx: Pick<Prisma.TransactionClient, "baglanti">, tenantId: string): Promise<string | undefined> {
  const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { sifreliConfig: true } });
  if (!baglanti) return undefined;
  return (JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).gondericiBirimEtiketi;
}
