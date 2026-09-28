import type { Prisma } from "@prisma/client";
import { NES_GIB_ALICIYA_ILETIYOR } from "@tekirextra/baglanti";

/**
 * Aynı zarf bu süre dolmadan yeniden sorgulanmaz (EBLG-14). Sağlayıcı kılavuzu
 * "bir zarf otomatik job'larla en az 2 saat sonra tekrar sorgulanmalıdır"
 * diyor; zarfın son duruma ulaşması zaten günler alabiliyor.
 */
const DURUM_SORGU_ARALIK_MS = Number(process.env.EBLG_DURUM_SORGU_ARALIK_MS || 2 * 60 * 60 * 1_000);
const GUN_MS = 86_400_000;

export interface FaturaSorguSureleri {
  /** Ticari e-Faturanın alıcı yanıtı için gönderimden sonra sorgulandığı gün. */
  efaturaYanitGunSayisi: number;
  /** e-Arşiv faturasının iptal edilebildiği, dolayısıyla sorgulandığı gün. */
  earsivIptalGunSayisi: number;
}

export const VARSAYILAN_FATURA_SORGU_SURELERI: FaturaSorguSureleri = { efaturaYanitGunSayisi: 10, earsivIptalGunSayisi: 8 };

/**
 * Planlayıcının iş açıp açmayacağına bakarken kullandığı en uzun süreler;
 * ayar sınırlarıyla aynıdır. Kiracının kendi süresi işte uygulanır.
 */
export const AZAMI_FATURA_SORGU_SURELERI: FaturaSorguSureleri = { efaturaYanitGunSayisi: 60, earsivIptalGunSayisi: 90 };

export function faturaSorguSureleriniOku(ayarlar: Record<string, unknown>): FaturaSorguSureleri {
  return {
    efaturaYanitGunSayisi: Number(ayarlar.efaturaYanitGunSayisi ?? VARSAYILAN_FATURA_SORGU_SURELERI.efaturaYanitGunSayisi),
    earsivIptalGunSayisi: Number(ayarlar.earsivIptalGunSayisi ?? VARSAYILAN_FATURA_SORGU_SURELERI.earsivIptalGunSayisi),
  };
}

/**
 * EBLG-40: otomatik durum sorgusuna girecek giden faturalar. Önceden
 * `iletildi` her belge sonsuza kadar 2 saatte bir soruluyordu.
 * - `kuyrukta` (referanslı) belge GİB sonucu gelene kadar sorulur;
 * - temel e-Fatura `iletildi` olunca durur: alıcının yanıtı yoktur, öğrenilecek
 *   başka durum kalmaz;
 * - GİB'in alıcıya teslimini bekleyen (NES 1200) e-Fatura `iletildi` sayılır
 *   ama teslimde hata çıkabilir; profilden bağımsız, ticari yanıt süresince
 *   sorulur (EBLG-112);
 * - ticari e-Fatura alıcı yanıtı için gönderimden itibaren `efaturaYanitGunSayisi`
 *   gün sorulur (mevzuat 8 gün, 2 gün teslim payı); geç yanıtı gelen tarama okur;
 * - e-Arşiv, iptal edilebildiği sürece sorulur ki entegratör tarafındaki iptal
 *   yakalansın (EBLG-39). İptal kontrolü tam gün farkına bakar
 *   (`earsivBelgesiniIptalEt`), bu yüzden sınır bir gün sonrasına kadar uzanır.
 * Elle sorgu bu koşula bağlı değildir. Planlayıcı da aynı koşulu kullanır.
 */
export function faturaSorguKosulu(tenantId: string, simdi: number, sureler: FaturaSorguSureleri): Prisma.EbelgeKayitWhereInput {
  return {
    tenantId,
    entegratorRef: { not: null },
    OR: [{ sonDurumSorguAt: null }, { sonDurumSorguAt: { lt: new Date(simdi - DURUM_SORGU_ARALIK_MS) } }],
    AND: [
      {
        OR: [
          { durum: "kuyrukta" },
          {
            durum: "iletildi",
            tur: "efatura",
            fatura: { efaturaProfili: "ticari" },
            createdAt: { gte: new Date(simdi - sureler.efaturaYanitGunSayisi * GUN_MS) },
          },
          {
            durum: "iletildi",
            tur: "efatura",
            entegratorDurumu: NES_GIB_ALICIYA_ILETIYOR,
            createdAt: { gte: new Date(simdi - sureler.efaturaYanitGunSayisi * GUN_MS) },
          },
          {
            durum: "iletildi",
            tur: "earsiv",
            fatura: { tarih: { gte: new Date(simdi - (sureler.earsivIptalGunSayisi + 1) * GUN_MS) } },
          },
        ],
      },
    ],
  };
}
