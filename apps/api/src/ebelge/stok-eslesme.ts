import { Prisma } from "@prisma/client";
import type { EslesmeKaynagi } from "./ebelge.service";

/** Belge satırının ürün kimlikleri (UBL `Item` altındaki tanımlayıcılar). */
export interface UrunKimligi {
  aliciUrunKodu?: string;
  barkod?: string;
  saticiUrunKodu?: string;
  ureticiUrunKodu?: string;
  ad?: string;
}

/**
 * Gelen belge satırını stok kartıyla eşler: bizim kodumuz, barkod, tedarikçi
 * kodu (cariye özgü), üretici kodu, son olarak birebir ad. Gelen e-Fatura ve
 * gelen e-İrsaliye (SAT-12) aynı sırayı kullanır.
 */
export async function stokKartiBul(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kimlik: UrunKimligi,
  cariId: string | null,
): Promise<{ stokId: string | null; kaynak: EslesmeKaynagi }> {
  let stokId: string | null = null;
  let kaynak: EslesmeKaynagi = null;

  if (kimlik.aliciUrunKodu) {
    const k = await tx.stokKart.findFirst({
      where: { tenantId, kod: kimlik.aliciUrunKodu, aktif: true },
      select: { id: true },
    });
    if (k) {
      stokId = k.id;
      kaynak = "alici_urun_kodu";
    }
  }

  if (!stokId && kimlik.barkod) {
    const barkodKaydi = await tx.stokBarkod.findFirst({
      where: { tenantId, barkod: kimlik.barkod },
      select: { stokId: true },
    });
    if (barkodKaydi) {
      stokId = barkodKaydi.stokId;
      kaynak = "barkod";
    } else {
      const k = await tx.stokKart.findFirst({
        where: { tenantId, barkod: kimlik.barkod, aktif: true },
        select: { id: true },
      });
      if (k) {
        stokId = k.id;
        kaynak = "barkod";
      }
    }
  }

  if (!stokId && kimlik.saticiUrunKodu) {
    const ted = await tx.stokTedarikci.findFirst({
      where: {
        tenantId,
        tedarikciUrunKodu: kimlik.saticiUrunKodu,
        ...(cariId ? { cariId } : {}),
      },
      select: { stokId: true },
    });
    if (ted) {
      stokId = ted.stokId;
      kaynak = "tedarikci_urun_kodu";
    }
  }

  if (!stokId && kimlik.ureticiUrunKodu) {
    const k = await tx.stokKart.findFirst({
      where: { tenantId, ureticiUrunKodu: kimlik.ureticiUrunKodu, aktif: true },
      select: { id: true },
    });
    if (k) {
      stokId = k.id;
      kaynak = "uretici_urun_kodu";
    }
  }

  if (!stokId && kimlik.ad) {
    const k = await tx.stokKart.findFirst({
      where: { tenantId, ad: { equals: kimlik.ad, mode: "insensitive" }, aktif: true },
      select: { id: true },
    });
    if (k) {
      stokId = k.id;
      kaynak = "ad";
    }
  }

  return { stokId, kaynak };
}
