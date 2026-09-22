import { Prisma } from "@prisma/client";
import { aliciUlkeKodu, cariEbelgeDurumu, yurtDisiAliciMi, type CariEbelgeDurumu, type ListeKaydi } from "@tekirextra/shared";

/** Mükellef listesi bu süreden eskiyse durum "bilinmiyor" sayılır (EBLG-77 ile aynı). */
const LISTE_TAZELIK_SURESI_MS = 48 * 60 * 60 * 1000;

export interface CariEbelgeOkumasi {
  durumlar: Map<string, CariEbelgeDurumu>;
  /** Listenin son başarılı senkronu; kartın altında gösterilir. */
  listeGuncellendi: Date | null;
}

/**
 * CARI-23: carilerin e-belge mükellefiyeti, yerel GİB listesinden. Anahtar
 * VKN/TCKN'dir; listede tek sorguyla okunur, cari listesi için de uygundur.
 * Bir mükellefin birden çok etiketi varsa en eski ilk kayıt zamanı alınır.
 */
export async function cariEbelgeDurumlariniOku(
  tx: Prisma.TransactionClient,
  vknler: (string | null | undefined)[],
): Promise<CariEbelgeOkumasi> {
  const tekil = [...new Set(vknler.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))];
  const [kayitlar, senkron] = await Promise.all([
    tekil.length
      ? tx.gibMukellef.findMany({ where: { vknTckn: { in: tekil } }, select: { vknTckn: true, belgeTuru: true, tur: true, ilkKayitZamani: true } })
      : Promise.resolve([]),
    tx.gibMukellefSenkron.findUnique({ where: { id: "tek" }, select: { sonSenkronAt: true, kayitSayisi: true } }),
  ]);
  const listeGuncel = Boolean(
    senkron?.sonSenkronAt && senkron.kayitSayisi > 0 && Date.now() - senkron.sonSenkronAt.getTime() < LISTE_TAZELIK_SURESI_MS,
  );

  const liste = new Map<string, ListeKaydi & { ilkKayitZamani: Date | null }>();
  for (const kayit of kayitlar) {
    const anahtar = `${kayit.vknTckn}|${kayit.belgeTuru}`;
    const onceki = liste.get(anahtar);
    const dahaEski = kayit.ilkKayitZamani && (!onceki?.ilkKayitZamani || kayit.ilkKayitZamani < onceki.ilkKayitZamani);
    liste.set(anahtar, { ilkKayitZamani: dahaEski ? kayit.ilkKayitZamani : onceki?.ilkKayitZamani ?? null, tur: onceki?.tur ?? kayit.tur });
  }

  const durumlar = new Map<string, CariEbelgeDurumu>();
  for (const vkn of [...tekil, ""]) {
    durumlar.set(vkn, cariEbelgeDurumu({
      vknTckn: vkn,
      efatura: liste.get(`${vkn}|efatura`) ?? null,
      eirsaliye: liste.get(`${vkn}|eirsaliye`) ?? null,
      listeGuncel,
    }));
  }
  return { durumlar, listeGuncellendi: senkron?.sonSenkronAt ?? null };
}

/**
 * Okumadan bir carinin durumu; VKN'siz cari boş anahtarla bulunur. Yurt dışı
 * alıcı (EBLG-80: adres ülkesi ya da 2222222222/1460415308) listeden önce gelir.
 */
export function cariEbelgeDurumuBul(
  okuma: CariEbelgeOkumasi,
  cari: { vknTckn: string | null | undefined; adresler?: readonly { tip: string; ulke: string | null }[] },
): CariEbelgeDurumu {
  if (yurtDisiAliciMi({ ulkeKodu: aliciUlkeKodu(cari.adresler ?? []), vknTckn: cari.vknTckn })) {
    return cariEbelgeDurumu({ vknTckn: cari.vknTckn, yurtDisi: true, efatura: null, eirsaliye: null, listeGuncel: false });
  }
  return okuma.durumlar.get(cari.vknTckn?.trim() ?? "") ?? okuma.durumlar.get("")!;
}
