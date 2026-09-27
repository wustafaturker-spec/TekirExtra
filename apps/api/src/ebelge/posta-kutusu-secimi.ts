import type { GibBelgeTuru, Prisma } from "@prisma/client";
import { postaKutusuSec, type EntegratorAdapter, type EntegratorConfig } from "@tekirextra/baglanti";
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
  /**
   * EBLG-110: toplu listede olup entegratörün canlı sorgusunda olmayan kutular.
   * Entegratör bu kutuya gönderilen belgeyi etiketsiz taslakta bırakır
   * (EBLG-106); kural bunları seçmez, elle seçimi geçersiz sayar.
   */
  entegratordeYok: string[];
}

export async function postaKutusuSecimi(
  tx: Pick<Prisma.TransactionClient, "gibMukellef">,
  vknTckn: string,
  belgeTuru: GibBelgeTuru,
  elleSecilen: string | null | undefined,
  kendiEtiketimiz: string | null | undefined,
  /** Entegratörün canlı sorgusundaki kutular; boş ya da yoksa toplu liste geçerlidir. */
  canli?: readonly string[] | null,
): Promise<PostaKutusuSecimi> {
  const kayitlar = await tx.gibMukellef.findMany({
    where: { vknTckn, belgeTuru },
    select: { postaKutusu: true, kutuKayitZamani: true, tur: true },
    orderBy: { postaKutusu: "asc" },
  });
  const adaylar = kayitlar.map((k) => ({ postaKutusu: k.postaKutusu, kayitZamani: k.kutuKayitZamani?.toISOString() ?? null }));
  const canliKume = canli?.length ? new Set(canli) : null;
  // Canlı liste toplu listeyle hiç kesişmiyorsa ona güvenilmez; toplu liste geçerli kalır.
  const kesisim = canliKume ? adaylar.filter((a) => canliKume.has(a.postaKutusu)) : [];
  const gecerliler = kesisim.length ? kesisim : adaylar;
  const kuralSecimi = postaKutusuSec(gecerliler, kendiEtiketimiz);
  const elle = elleSecilen?.trim() || null;
  const elleGecerli = Boolean(elle && gecerliler.some((a) => a.postaKutusu === elle));
  return {
    adaylar,
    secilen: elleGecerli ? elle! : kuralSecimi,
    kuralSecimi,
    elleSecilen: elle,
    elleSecilenGecersiz: Boolean(elle) && !elleGecerli,
    tur: kayitlar[0]?.tur ?? null,
    entegratordeYok: kesisim.length ? adaylar.filter((a) => !canliKume!.has(a.postaKutusu)).map((a) => a.postaKutusu) : [],
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

/**
 * EBLG-110: alıcının entegratörün canlı sorgusundaki e-İrsaliye kutuları.
 * Toplu liste bu VKN için entegratörün kabul etmediği kutular taşıyabiliyor
 * (EBLG-106). Aktif bağlantı yoksa, entegratör bu sorguyu vermiyorsa ya da
 * sorgu başarısızsa `null` döner; çağıran toplu listeyle devam eder.
 */
export async function canliIrsaliyeKutulari(
  tx: Pick<Prisma.TransactionClient, "baglanti">,
  tenantId: string,
  adapterCoz: (saglayici: string) => EntegratorAdapter,
  vknTckn: string,
): Promise<string[] | null> {
  const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { saglayici: true, sifreliConfig: true } });
  if (!baglanti) return null;
  const adapter = adapterCoz(baglanti.saglayici);
  if (!adapter.irsaliyePostaKutulariSorgula) return null;
  return adapter.irsaliyePostaKutulariSorgula(JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig, vknTckn).catch(() => null);
}
