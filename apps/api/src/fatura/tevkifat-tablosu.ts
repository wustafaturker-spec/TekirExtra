import type { Prisma } from "@prisma/client";
import { gizliTevkifatKodlari, senaryoHatalari, TEVKIFAT_KODLARI, tevkifatTablosuKur, type TevkifatFirmaAyari, type TevkifatKodu } from "@tekirextra/shared";
import type { AyarlarService } from "../core/ayarlar/ayarlar.service";
import type { MevzuatService } from "../mevzuat/mevzuat.service";

/**
 * MVZ-12: belge tarihinde yürürlükteki merkezi tevkifat tablosu + firmanın
 * gizlediği kodlar (MVZ-09). `gizlilerDahil` false ise gizli kodlar tabloya
 * hiç işaretlenmez (gelen belge: karşı tarafın belgesi, her kod tanınır).
 * Mevzuat servisi verilmemişse (birim testleri) varsayılan tablo kullanılır.
 */
export async function firmaTevkifatTablosu(
  kaynak: { mevzuat?: MevzuatService; ayarlar?: AyarlarService },
  tarih: string,
  secenek: { gizlilerDahil?: boolean; tx?: Prisma.TransactionClient } = {},
): Promise<TevkifatKodu[]> {
  const kayitlar = kaynak.mevzuat
    ? await kaynak.mevzuat.yururluktekiler("tevkifat_kodu", tarih)
    : TEVKIFAT_KODLARI.map((k) => ({ anahtar: k.kod, deger: { ad: k.ad, oranlar: [...k.oranlar] } }));
  const gizli = secenek.gizlilerDahil !== false && kaynak.ayarlar
    ? gizliTevkifatKodlari((await kaynak.ayarlar.getir("tevkifat", secenek.tx)) as TevkifatFirmaAyari)
    : [];
  return tevkifatTablosuKur(kayitlar, gizli);
}

/**
 * Şema tevkifat kodunu kiracının tablosunu bilmeden doğrulayamaz; kod ve oran
 * kuralı burada belge tarihindeki tabloyla uygulanır. Gelen belgeden oluşan
 * faturada gizli kod da kabul edilir (belge karşı tarafındır).
 */
export function tevkifatKurallariniUygula(
  satirlar: { kdvOrani?: string | number | null; tevkifatKodu?: string | null; tevkifatOrani?: string | null }[],
  tablo: readonly TevkifatKodu[],
  pasifKodKabul = false,
): string[] {
  return senaryoHatalari(
    satirlar.map((s) => ({ kdvOrani: Number(s.kdvOrani ?? 0), tevkifatKodu: s.tevkifatKodu, tevkifatOrani: s.tevkifatOrani, gibIstisnaKodu: "351" })),
    true,
    { tevkifatTablosu: tablo, pasifKodKabul },
  )
    .filter((h) => h.alan === "tevkifatKodu" || h.alan === "tevkifatOrani")
    .map((h) => `${h.satirIndeksi + 1}. satır: ${h.mesaj}`);
}
