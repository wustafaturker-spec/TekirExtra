import type { Prisma } from "@prisma/client";
import { TAHSILAT_MODULU, tahsilatAyariSemasi } from "./tahsilat-erisim";

export const TAHSILAT_BILDIRIM_KAYNAGI = "tahsilat_takibi";

/** Bildirim tercihi e-postayı açsa da bu olay yalnız uygulama içindedir. */
export async function tahsilatBildirimiUret(tx: Prisma.TransactionClient, g: { tenantId: string; takipId: string; sorumluUserId: string; zaman: Date }) {
  const user = await tx.user.findFirst({ where: { tenantId: g.tenantId, id: g.sorumluUserId, aktif: true, rol: { in: ["yonetici", "muhasebe"] } }, select: { id: true } });
  if (!user) return;
  const tercih = await tx.bildirimTercihi.findUnique({ where: { tenantId_userId_tur: { tenantId: g.tenantId, userId: user.id, tur: "vade" } }, select: { uygulamaIci: true } });
  if (tercih?.uygulamaIci === false) return;
  const bildirim = await tx.bildirim.upsert({
    where: { tenantId_birlesimAnahtari: { tenantId: g.tenantId, birlesimAnahtari: `tahsilat-takip:${g.takipId}` } },
    create: { tenantId: g.tenantId, tur: "vade", onem: "uyari", baslik: "Geciken ödeme sözü takibi", aciklama: "Size atanan tahsilat takibine gecikmiş ödeme sözü bağlandı. Güncel kayıt ve görüşmeleri inceleyin.", kaynakTur: TAHSILAT_BILDIRIM_KAYNAGI, kaynakRef: g.takipId, hedefYol: `/panel/cari/tahsilat?takip=${g.takipId}`, birlesimAnahtari: `tahsilat-takip:${g.takipId}`, sonTespitTarihi: g.zaman },
    update: { sonTespitTarihi: g.zaman },
  });
  await tx.bildirimTeslimati.createMany({ data: [{ tenantId: g.tenantId, bildirimId: bildirim.id, userId: user.id, epostaDurumu: "kapali" }], skipDuplicates: true });
}

/** Bildirim, yetkisi veya şirket modu değişmiş kullanıcının eski erişimini korumaz. */
export async function tahsilatBildirimKapsami(tx: Prisma.TransactionClient, tenantId: string, rol: string, userId: string, firma = false): Promise<Prisma.BildirimWhereInput> {
  const haric: Prisma.BildirimWhereInput = { OR: [{ kaynakTur: null }, { kaynakTur: { not: TAHSILAT_BILDIRIM_KAYNAGI } }] };
  if (!["yonetici", "muhasebe", "mali_musavir", "salt_okunur"].includes(rol)) return haric;
  if (!await tx.user.findFirst({ where: { tenantId, id: userId, aktif: true, rol: { in: firma ? ["yonetici"] : ["yonetici", "muhasebe", "mali_musavir", "salt_okunur"] } }, select: { id: true } })) return haric;
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: TAHSILAT_MODULU } }, select: { ayarlar: true } });
  const ayar = tahsilatAyariSemasi.safeParse(kayit?.ayarlar ?? {});
  return ayar.success && ayar.data.mod !== "kapali" ? {} : haric;
}
