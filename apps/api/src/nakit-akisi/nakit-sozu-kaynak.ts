import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { odemeSozuKaynaklariniOku } from "../cari/odeme-sozu-kaynak";
import { TAHSILAT_MODULU, tahsilatAyariSemasi } from "../cari/tahsilat-erisim";

export interface NakitSozu {
  id: string;
  faturaId: string;
  cariId: string;
  dovizCinsi: string;
  tarih: string;
  kalan: string;
}

/** Çağıranın fatura/bakiye okumasıyla aynı RepeatableRead transaction'ında. */
export async function nakitSozleriniOku(tx: Prisma.TransactionClient, tenantId: string, bugun: string) {
  const baglam = aktifBaglam();
  if (baglam.tenantId !== tenantId || !["yonetici", "muhasebe"].includes(baglam.rol)) return new Map<string, NakitSozu>();
  const ayar = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: TAHSILAT_MODULU } }, select: { ayarlar: true } });
  const mod = tahsilatAyariSemasi.safeParse(ayar?.ayarlar ?? {});
  if (!mod.success || mod.data.mod === "kapali") return new Map<string, NakitSozu>();
  const adaylar = await tx.odemeSozu.findMany({
    where: { tenantId, kayitDurumu: "aktif", sozTarihi: { gte: new Date(`${bugun}T00:00:00Z`) } },
    select: { cariId: true }, distinct: ["cariId"], take: 101,
  });
  if (adaylar.length > 100) throw new BadRequestException("Nakit planı ödeme sözü kaynak sınırı aşıldı; kısmi tahmin üretilmedi");
  const sonuc = new Map<string, NakitSozu>();
  for (const { cariId } of adaylar) {
    const kaynak = await odemeSozuKaynaklariniOku(tx, tenantId, cariId);
    for (const s of kaynak.sozler) {
      // Ufuk dışındaki söz de eski vadeli faturayı ufuktan çıkarmalıdır.
      if (s.kayitDurumu !== "aktif" || s.sozTarihi < bugun || !s.gerceklesme || !["aktif", "kismen_gerceklesti"].includes(s.gerceklesme.durum)) continue;
      if (sonuc.has(s.faturaId)) throw new BadRequestException("Fatura için birden fazla aktif ödeme sözü var");
      sonuc.set(s.faturaId, { id: s.id, faturaId: s.faturaId, cariId: s.cariId, dovizCinsi: s.dovizCinsi, tarih: s.sozTarihi, kalan: s.gerceklesme.kalan });
    }
  }
  return sonuc;
}
