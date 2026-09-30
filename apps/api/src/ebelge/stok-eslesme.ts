import { Prisma } from "@prisma/client";
import { varyantAdiEsit, varyantliAdAyir } from "@tekirextra/shared";
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
 * kodu (cariye özgü), üretici kodu, "Ürün — Varyant" adı, son olarak birebir ad. Gelen e-Fatura ve
 * gelen e-İrsaliye (SAT-12) aynı sırayı kullanır.
 */
export async function stokKartiBul(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kimlik: UrunKimligi,
  cariId: string | null,
): Promise<{ stokId: string | null; varyantId: string | null; kaynak: EslesmeKaynagi }> {
  let stokId: string | null = null;
  let kaynak: EslesmeKaynagi = null;

  // Bizim kodumuz ya da barkod bir varyantınsa satır doğrudan o varyanta düşer;
  // varyantlı kartın satırı varyantsız kaydedilemez.
  const varyant = await varyantBul(tx, tenantId, kimlik);
  if (varyant) return varyant;

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

  if (!stokId) {
    const varyant = await varyantAdiylaBul(tx, tenantId, kimlik.ad);
    if (varyant) return varyant;
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

  return { stokId, varyantId: null, kaynak };
}

async function varyantBul(tx: Prisma.TransactionClient, tenantId: string, kimlik: UrunKimligi) {
  if (kimlik.aliciUrunKodu) {
    const v = await tx.stokVaryant.findFirst({ where: { tenantId, kod: kimlik.aliciUrunKodu, aktif: true, stok: { aktif: true } }, select: { id: true, stokId: true } });
    if (v) return { stokId: v.stokId, varyantId: v.id, kaynak: "alici_urun_kodu" as const };
  }
  if (kimlik.barkod) {
    const v = await tx.stokVaryant.findFirst({ where: { tenantId, barkod: kimlik.barkod, aktif: true, stok: { aktif: true } }, select: { id: true, stokId: true } });
    if (v) return { stokId: v.stokId, varyantId: v.id, kaynak: "barkod" as const };
  }
  return null;
}

/**
 * "Ürün — Varyant" adlı satır: ürün adı tutan aktif kartın, aynı nitelik
 * değerlerini taşıyan aktif varyantı (değerlerin sırası önemsiz).
 */
async function varyantAdiylaBul(tx: Prisma.TransactionClient, tenantId: string, ad?: string) {
  const parca = ad ? varyantliAdAyir(ad) : null;
  if (!parca) return null;
  const adaylar = await tx.stokVaryant.findMany({
    where: { tenantId, aktif: true, stok: { aktif: true, ad: { equals: parca.stokAd, mode: "insensitive" } } },
    orderBy: { kod: "asc" },
    select: { id: true, stokId: true, ad: true },
  });
  const v = adaylar.find((x) => varyantAdiEsit(x.ad, parca.varyantAd));
  return v ? { stokId: v.stokId, varyantId: v.id, kaynak: "ad" as const } : null;
}
