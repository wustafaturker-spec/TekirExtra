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
 * kodu (cariye özgü; önce varyant kodu, STK-23), üretici kodu, "Ürün — Varyant" adı, son olarak birebir ad. Gelen e-Fatura ve
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
  const varyant = await varyantBul(tx, tenantId, kimlik, cariId);
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

async function varyantBul(tx: Prisma.TransactionClient, tenantId: string, kimlik: UrunKimligi, cariId: string | null) {
  if (kimlik.aliciUrunKodu) {
    const v = await tx.stokVaryant.findFirst({ where: { tenantId, kod: kimlik.aliciUrunKodu, aktif: true, stok: { aktif: true } }, select: { id: true, stokId: true } });
    if (v) return { stokId: v.stokId, varyantId: v.id, kaynak: "alici_urun_kodu" as const };
  }
  if (kimlik.barkod) {
    const v = await tx.stokVaryant.findFirst({ where: { tenantId, barkod: kimlik.barkod, aktif: true, stok: { aktif: true } }, select: { id: true, stokId: true } });
    if (v) return { stokId: v.stokId, varyantId: v.id, kaynak: "barkod" as const };
  }
  // STK-23: tedarikçinin varyanta verdiği kod (kart düzeyindeki koddan önce).
  if (kimlik.saticiUrunKodu) {
    const k = await tx.stokTedarikciVaryant.findFirst({
      where: { tenantId, tedarikciUrunKodu: kimlik.saticiUrunKodu, varyant: { aktif: true, stok: { aktif: true } }, ...(cariId ? { stokTedarikci: { cariId } } : {}) },
      select: { varyant: { select: { id: true, stokId: true } } },
    });
    if (k) return { stokId: k.varyant.stokId, varyantId: k.varyant.id, kaynak: "tedarikci_urun_kodu" as const };
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

/**
 * Gelen belgede bağlanan satırın satıcı kodunu o tedarikçinin kodu olarak
 * öğrenir; sonraki belge kendiliğinden eşleşir. Tedarikçi kartta yoksa fiyatsız
 * eklenir.
 * - Varyanta bağlanan satır (STK-23): kod varyant koduna yazılır; kart
 *   düzeyinde zaten kayıtlıysa (tedarikçi tüm varyantlara aynı kodu veriyor)
 *   öğrenilmez.
 * - Varyantsız satır: kod kartın tedarikçi koduna yazılır; kartta bu tedarikçi
 *   için başka bir kod varsa üzerine yazılmaz (elle girilen kod korunur).
 * Aynı belgede iki ayrı karta/varyanta bağlanan kod belirsizdir, öğrenilmez.
 * Kod aynı tedarikçide başka kart ya da varyanttaysa oradan kaldırılır
 * (kullanıcı eşleşmeyi düzeltti).
 */
export async function tedarikciKodlariniOgren(
  tx: Prisma.TransactionClient,
  tenantId: string,
  cariId: string,
  satirlar: { saticiUrunKodu?: string | null; stokId: string; varyantId?: string | null }[],
): Promise<number> {
  const adaylar = new Map<string, { stokId: string; varyantId: string | null } | null>();
  for (const s of satirlar) {
    const kod = s.saticiUrunKodu?.trim();
    if (!kod || !s.stokId) continue;
    const varyantId = s.varyantId ?? null;
    const onceki = adaylar.get(kod);
    if (onceki === undefined) adaylar.set(kod, { stokId: s.stokId, varyantId });
    else if (onceki && (onceki.stokId !== s.stokId || onceki.varyantId !== varyantId)) adaylar.set(kod, null);
  }

  let ogrenilen = 0;
  for (const [kod, hedef] of adaylar) {
    if (!hedef) continue;
    const tedarikci =
      (await tx.stokTedarikci.findFirst({ where: { tenantId, stokId: hedef.stokId, cariId }, select: { id: true, tedarikciUrunKodu: true } })) ??
      (await tx.stokTedarikci.create({ data: { tenantId, stokId: hedef.stokId, cariId }, select: { id: true, tedarikciUrunKodu: true } }));

    if (hedef.varyantId) {
      if (tedarikci.tedarikciUrunKodu === kod) continue;
      await tx.stokTedarikci.updateMany({ where: { tenantId, cariId, tedarikciUrunKodu: kod, stokId: { not: hedef.stokId } }, data: { tedarikciUrunKodu: null } });
      await tx.stokTedarikciVaryant.deleteMany({ where: { tenantId, tedarikciUrunKodu: kod, stokTedarikci: { cariId }, varyantId: { not: hedef.varyantId } } });
      await tx.stokTedarikciVaryant.upsert({
        where: { stokTedarikciId_varyantId: { stokTedarikciId: tedarikci.id, varyantId: hedef.varyantId } },
        create: { tenantId, stokTedarikciId: tedarikci.id, varyantId: hedef.varyantId, tedarikciUrunKodu: kod },
        update: { tedarikciUrunKodu: kod },
      });
      ogrenilen++;
      continue;
    }

    // Kod bu tedarikçide başka kartta ya da bir varyantta kalırsa (varyant kodu
    // önce eşleşir) düzeltme tutmaz; hedef kart kodu zaten taşısa da temizlenir.
    await tx.stokTedarikci.updateMany({ where: { tenantId, cariId, tedarikciUrunKodu: kod, stokId: { not: hedef.stokId } }, data: { tedarikciUrunKodu: null } });
    await tx.stokTedarikciVaryant.deleteMany({ where: { tenantId, tedarikciUrunKodu: kod, stokTedarikci: { cariId } } });
    if (tedarikci.tedarikciUrunKodu) continue;
    await tx.stokTedarikci.update({ where: { id: tedarikci.id }, data: { tedarikciUrunKodu: kod } });
    ogrenilen++;
  }
  return ogrenilen;
}
