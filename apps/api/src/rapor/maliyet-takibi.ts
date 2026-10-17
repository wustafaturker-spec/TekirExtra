import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { maliyetBilinmiyor, satisSatirlari } from "../stok/satis-ozeti";

export const MALIYET_TAKIP_NEDENI = "SATIS_MALIYET_KONTROLU";
export const maliyetTakipAnahtari = (id: string) => `${MALIYET_TAKIP_NEDENI}:fatura_satiri:${id}`;
const not = z.string().trim().min(2).max(2000);
const baslatSemasi = z.object({ aciklama: not }).strict();
const guncelleSemasi = z.object({ aciklama: not, beklenenGuncelleme: z.iso.datetime(), durum: z.enum(["incelemede", "beklemede"]) }).strict();
export function maliyetTakipGirdisi(govde: unknown, guncelle = false) {
  const r = (guncelle ? guncelleSemasi : baslatSemasi).safeParse(govde);
  if (!r.success) throw new BadRequestException("2–2000 karakterlik inceleme notu ve geçerli durum/sürüm bilgisi girin.");
  return r.data;
}
export function maliyetTakipId(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new BadRequestException("Geçersiz satış satırı.");
  return id;
}
type Tx = Prisma.TransactionClient;
async function kaynak(tx: Tx, tenantId: string, id: string) {
  const s = await tx.faturaSatir.findFirst({ where: { id, tenantId }, select: { id: true, faturaId: true } });
  if (!s) throw new NotFoundException("Satış satırı bulunamadı.");
  return s;
}
export async function maliyetTakibiniOku(tx: Tx, tenantId: string, id: string) {
  await kaynak(tx, tenantId, id);
  const kapsam = { tenantId, kaynakTur: "fatura_satiri", kaynakRef: id, nedenKodu: MALIYET_TAKIP_NEDENI };
  const acik = await tx.duzeltmeKaydi.findFirst({ where: { ...kapsam, tekillikAnahtari: maliyetTakipAnahtari(id) }, select: { id: true } });
  return tx.duzeltmeKaydi.findFirst({
    where: { ...kapsam, ...(acik ? { id: acik.id } : {}) },
    orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    include: { _count: { select: { olaylar: true } }, olaylar: {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
      include: { user: { select: { adSoyad: true } } },
    } },
  });
}
export async function maliyetTakibiBaslat(tx: Tx, tenantId: string, userId: string, id: string, aciklama: string) {
  const s = await kaynak(tx, tenantId, id);
  // Aynı kaynak için eşzamanlı açılışlar tek kayıt ve tek ilk olay üretir.
  await tx.$queryRaw`SELECT id FROM fatura_satirlari WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  const tekillikAnahtari = maliyetTakipAnahtari(id);
  const eski = await tx.duzeltmeKaydi.findUnique({ where: { tenantId_tekillikAnahtari: { tenantId, tekillikAnahtari } } });
  if (eski) return { zatenVardi: true, kayit: await maliyetTakibiniOku(tx, tenantId, id) };
  const satir = (await satisSatirlari(tx, {}, s.faturaId)).find((r) => r.faturaSatirId === id);
  if (!satir || !maliyetBilinmiyor(satir)) throw new ConflictException("Kaynak artık maliyet kontrolü koşuluna uymuyor. Listeyi yenileyin.");
  const kayit = await tx.duzeltmeKaydi.create({ data: {
    tenantId, tur: "stok", kaynakTur: "fatura_satiri", kaynakRef: id, nedenKodu: MALIYET_TAKIP_NEDENI, tekillikAnahtari,
    aciklama: `${satir.faturaNo || "Satış faturası"} · ${satir.kod}${satir.varyantKod ? ` · Varyant: ${satir.varyantKod} · ${satir.varyantAd ?? ""}` : ""} · sıfır kayıtlı maliyet kontrolü. Kesin kök neden belirlenmedi.`,
    onerilenEylem: "Kaynak belge ve stok hareketlerini inceleyin. İnceleme durumu maliyeti veya kâr uyarısını değiştirmez.",
  } });
  await tx.duzeltmeOlayi.create({ data: { tenantId, userId, duzeltmeKaydiId: kayit.id, olayTuru: "maliyet_takibi_acildi", yeniDurum: "acik", aciklama } });
  return { zatenVardi: false, kayit: await maliyetTakibiniOku(tx, tenantId, id) };
}
export async function maliyetTakibiGuncelle(tx: Tx, tenantId: string, userId: string, id: string, govde: unknown) {
  const girdi = guncelleSemasi.safeParse(govde);
  if (!girdi.success) throw new BadRequestException("Geçerli inceleme notu, durum ve sürüm bilgisi girin.");
  await kaynak(tx, tenantId, id);
  const tekillikAnahtari = maliyetTakipAnahtari(id);
  await tx.$queryRaw`SELECT id FROM duzeltme_kayitlari WHERE tenant_id = ${tenantId}::uuid AND tekillik_anahtari = ${tekillikAnahtari} FOR UPDATE`;
  const onceki = await tx.duzeltmeKaydi.findUnique({ where: { tenantId_tekillikAnahtari: { tenantId, tekillikAnahtari } } });
  if (!onceki) throw new NotFoundException("Açık maliyet inceleme kaydı bulunamadı.");
  if (["cozuldu", "yoksayildi"].includes(onceki.durum)) throw new ConflictException("Kapanmış inceleme kaydı değiştirilemez.");
  if (onceki.updatedAt.toISOString() !== girdi.data.beklenenGuncelleme) throw new ConflictException("İnceleme kaydı başka bir işlemle değişti. Geçmişi yenileyip tekrar deneyin.");
  const updatedAt = new Date(Math.max(Date.now(), onceki.updatedAt.getTime() + 1));
  await tx.duzeltmeKaydi.update({ where: { id: onceki.id }, data: { durum: girdi.data.durum, updatedAt } });
  await tx.duzeltmeOlayi.create({ data: {
    tenantId, userId, duzeltmeKaydiId: onceki.id, olayTuru: "maliyet_incelemesi", oncekiDurum: onceki.durum,
    yeniDurum: girdi.data.durum, aciklama: girdi.data.aciklama,
  } });
  return { kayit: await maliyetTakibiniOku(tx, tenantId, id) };
}
