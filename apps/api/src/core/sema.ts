import { z } from "zod";

/** Alanın varsayılansız hâli: dıştaki optional ve default sarmalayıcıları açılır. */
type Varsayilansiz<S> = S extends z.ZodOptional<infer A extends z.ZodType>
  ? Varsayilansiz<A>
  : S extends z.ZodDefault<infer B extends z.ZodType>
    ? B
    : S;

/**
 * Oluşturma şemasından güncelleme (PATCH) şeması: bütün alanlar isteğe bağlı
 * ve varsayılansız.
 *
 * zod 4'te `.partial()` alanın varsayılanını korur; istekte olmayan alan
 * varsayılanla dolar ve kaydın o alanını sessizce ezer (kişi tipi tüzele,
 * stok KDV'si %20'ye döner, depo "varsayılan" işaretini kaybeder, pasif kart
 * yeniden aktif olur). Güncellemede yalnız gönderilen alan değişmelidir.
 * `core/guncelleme-semalari.test.ts` bütün güncelleme şemalarını bu açıdan
 * sınar.
 */
export function guncellemeSemasi<T extends z.ZodRawShape>(
  sema: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<Varsayilansiz<T[K]>> }> {
  const alanlar: Record<string, z.ZodType> = {};
  for (const [ad, tip] of Object.entries(sema.shape)) {
    let ic = tip as z.ZodType;
    if (ic instanceof z.ZodOptional) ic = ic.unwrap() as z.ZodType;
    if (ic instanceof z.ZodDefault) ic = ic.unwrap() as z.ZodType;
    alanlar[ad] = ic.optional();
  }
  return z.object(alanlar) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<Varsayilansiz<T[K]>> }>;
}
