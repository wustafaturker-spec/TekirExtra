import type { Prisma } from "@prisma/client";
import { BORDRO_ANAHTARI, type GelirVergisiDilimi } from "@tekirextra/shared";
import type { BordroMevzuatParametreleri } from "./bordro-hesaplama";

/**
 * MVZ-14: bordro mevzuatı Mevzuat Merkezi'nde (`bordro_parametreleri` türü)
 * tutulur; kiracıya kopyalanmaz. Merkezdeki düz değer bordro hesabının
 * parametre biçimine çevrilir.
 */
export function bordroParametreleri(deger: unknown): BordroMevzuatParametreleri {
  const d = (deger ?? {}) as Record<string, unknown>;
  const sayi = (ad: string) => Number(d[ad] ?? 0);
  return {
    asgariUcretBrut: sayi("asgariUcretBrut"),
    sgkTavan: sayi("sgkTavan"),
    sgkIsciOrani: sayi("sgkIsciOrani"),
    issizlikIsciOrani: sayi("issizlikIsciOrani"),
    sgkIsverenOrani: sayi("sgkIsverenOrani"),
    issizlikIsverenOrani: sayi("issizlikIsverenOrani"),
    sgkTesvikAzamiOrani: sayi("sgkTesvikAzamiOrani"),
    yemekGelirVergisiGunlukIstisna: sayi("yemekGelirVergisiGunlukIstisna"),
    yemekSgkGunlukIstisna: sayi("yemekSgkGunlukIstisna"),
    engellilikIndirimi: { derece1: sayi("engellilikDerece1"), derece2: sayi("engellilikDerece2"), derece3: sayi("engellilikDerece3") },
    damgaVergisiOrani: sayi("damgaVergisiOrani"),
    gelirVergisiDilimleri: (d.gelirVergisiDilimleri as GelirVergisiDilimi[] | undefined) ?? [],
  };
}

export interface DonemBordroMevzuati {
  /** Merkezi kaydın kimliği; bordro bu kayda bağlanır (kayıt yayından sonra değişmez). */
  id: string;
  parametreler: BordroMevzuatParametreleri;
  yururlukBaslangic: Date;
  yururlukBitis: Date | null;
}

/**
 * Dönemin ilk gününde yürürlükteki bordro parametreleri. Gelir vergisi
 * tarifesi yıllık olduğu için kayıt yalnız başladığı takvim yılında geçerlidir:
 * yeni yılın kaydı yayınlanmadıysa önceki yılın değerleri kullanılmaz, `null`
 * döner. Ay içinde yürürlüğe giren değişiklik sonraki aydan uygulanır.
 */
export async function donemBordroMevzuati(db: Pick<Prisma.TransactionClient, "mevzuatKayit">, yil: number, ay: number): Promise<DonemBordroMevzuati | null> {
  const donemBasi = new Date(Date.UTC(yil, ay - 1, 1));
  const kayit = await db.mevzuatKayit.findFirst({
    where: {
      tur: "bordro_parametreleri",
      anahtar: BORDRO_ANAHTARI,
      yururlukBaslangic: { lte: donemBasi, gte: new Date(Date.UTC(yil, 0, 1)) },
      OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: donemBasi } }],
    },
    orderBy: { yururlukBaslangic: "desc" },
  });
  return kayit ? { id: kayit.id, parametreler: bordroParametreleri(kayit.deger), yururlukBaslangic: kayit.yururlukBaslangic, yururlukBitis: kayit.yururlukBitis } : null;
}

export const mevzuatYokMesaji = (yil: number) => `${yil} yılı için bordro parametreleri Mevzuat Merkezi'nde henüz yayınlanmadı`;
