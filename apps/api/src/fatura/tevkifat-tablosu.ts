import type { Prisma } from "@prisma/client";
import { gizliTevkifatKodlari, ihracKayitliKoduBul, ozelMatrahKoduBul, senaryoHatalari, TEVKIFAT_KODLARI, tevkifatTablosuKur, VARSAYILAN_KOD_TABLOSU, type KodTablosu, type TevkifatFirmaAyari, type TevkifatKodu } from "@tekirextra/shared";
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

/** MVZ-11: belge tarihindeki KDV kod tablosu; mevzuat servisi yoksa (birim testleri) varsayılan. */
export async function belgeKodTablosu(mevzuat: MevzuatService | undefined, tarih: string): Promise<KodTablosu> {
  return mevzuat ? mevzuat.kodTablosu(tarih) : VARSAYILAN_KOD_TABLOSU;
}

/**
 * Şema kod listelerini belge tarihini bilmeden doğrulayamaz; KDV oranı,
 * istisna, tevkifat, özel matrah ve ihraç kayıtlı kodu burada belge
 * tarihindeki merkezi tabloyla denetlenir (MVZ-11/12). Gelen belgeden oluşan
 * faturada gizli tevkifat kodu da kabul edilir (belge karşı tarafındır).
 */
export function mevzuatKurallariniUygula(
  fatura: {
    ozelMatrahKodu?: string | null;
    ihracKayitliKodu?: string | null;
    satirlar: { kdvOrani?: string | number | null; tevkifatKodu?: string | null; tevkifatOrani?: string | null; gibIstisnaKodu?: string | null }[];
  },
  tablolar: { tevkifat: readonly TevkifatKodu[]; kod: KodTablosu },
  pasifKodKabul = false,
): string[] {
  const hatalar = senaryoHatalari(
    fatura.satirlar.map((s) => ({ kdvOrani: Number(s.kdvOrani ?? 0), tevkifatKodu: s.tevkifatKodu, tevkifatOrani: s.tevkifatOrani, gibIstisnaKodu: s.gibIstisnaKodu })),
    Boolean(fatura.ozelMatrahKodu),
    { tevkifatTablosu: tablolar.tevkifat, pasifKodKabul, kodTablosu: tablolar.kod },
  )
    // Sıfır KDV'de istisna kodu zorunluluğu gibi kurallar şemada zaten denetlendi; burada yalnız liste üyeliği.
    .filter((h) => h.alan === "tevkifatKodu" || h.alan === "tevkifatOrani" || h.alan === "kdvOrani" || (h.alan === "gibIstisnaKodu" && h.mesaj.startsWith("Tanımsız")))
    .map((h) => `${h.satirIndeksi + 1}. satır: ${h.mesaj}`);
  if (fatura.ozelMatrahKodu && !ozelMatrahKoduBul(fatura.ozelMatrahKodu, tablolar.kod.ozelMatrah)) hatalar.push(`Özel matrah kodu ${fatura.ozelMatrahKodu} belge tarihinde geçerli değil`);
  if (fatura.ihracKayitliKodu && !ihracKayitliKoduBul(fatura.ihracKayitliKodu, tablolar.kod.ihracKayitli)) hatalar.push(`İhraç kayıtlı kodu ${fatura.ihracKayitliKodu} belge tarihinde geçerli değil`);
  return hatalar;
}

/** Yalnız tevkifat kodu ve oranı (eski çağrılar ve testler için). */
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
