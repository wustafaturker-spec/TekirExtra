import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { TarihliIhtiyacGirdisi } from './ihtiyac-tarihli';

export const girisSatirSecimi = {
  id: true, tenantId: true, belgeId: true, stokId: true, varyantId: true,
  miktar: true, teslimEdilenMiktar: true, birim: true,
  belge: { select: { id: true, no: true, tenantId: true, tur: true, yon: true, durum: true, depoId: true, cariId: true, faturaId: true } },
  stok: { select: { kod: true, ad: true, tenantId: true, aktif: true, tip: true, anaBirim: true, birimler: { select: { ad: true, katsayi: true } } } },
  girisTarihi: true,
} satisfies Prisma.BelgeSatirSelect;
type Satir = Prisma.BelgeSatirGetPayload<{ select: typeof girisSatirSecimi }>;

export function girisSatirKaniti(s: Satir) {
  const b = s.belge;
  if (s.tenantId !== b.tenantId || s.tenantId !== s.stok.tenantId || !s.stok.aktif || s.stok.tip === 'hizmet' || s.varyantId) {
    throw new ConflictException('Giriş kaynağının ürün/tenant kapsamı uygun değil');
  }
  if (b.tur !== 'siparis' || b.yon !== 'alis' || !['onaylandi', 'kismen_kapandi'].includes(b.durum) || b.faturaId || !b.depoId) {
    throw new ConflictException('Yalnız deposu belli açık alış siparişleri kullanılabilir');
  }
  const katsayi = s.birim === s.stok.anaBirim ? new Prisma.Decimal(1) : s.stok.birimler.find(v => v.ad === s.birim)?.katsayi;
  if (!katsayi || !katsayi.gt(0) || !s.miktar.gt(0) || s.teslimEdilenMiktar.isNegative() || s.teslimEdilenMiktar.gt(s.miktar)) {
    throw new ConflictException('Sipariş miktarı, teslim birikimi veya birim katsayısı tutarsız');
  }
  const kalan = s.miktar.sub(s.teslimEdilenMiktar).mul(katsayi);
  if (kalan.decimalPlaces() > 3 || kalan.gte('1000000000000')) throw new ConflictException('Kalan ana birim miktarı hesap sınırını aşıyor');
  // Teslim birikimi değiştikçe tarih kalan miktara uygulanır. Satırın kapsamı,
  // ilk miktarı veya dönüşüm katsayısı değişirse yeniden doğrulama gerekir.
  const kaynakOzeti = createHash('sha256').update(JSON.stringify([
    1, s.tenantId, s.id, s.belgeId, s.stokId, s.varyantId, b.cariId, b.depoId,
    b.tur, b.yon, s.miktar.toFixed(3), s.birim, s.stok.anaBirim, katsayi.toString(),
  ])).digest('hex');
  return { kaynakOzeti, kalanMiktar: kalan.toFixed(3), anaBirim: s.stok.anaBirim, depoId: b.depoId };
}

/** Aynı repeatable-read transaction içinde çağrılır. Tarihsiz siparişler de açıklama için okunur. */
export async function siparisGirisleriniOku(tx: Prisma.TransactionClient, tenantId: string, stokId: string, depoId: string, yoldaki: string) {
  const satirlar = await tx.belgeSatir.findMany({
    where: { tenantId, stokId, varyantId: null, belge: { tenantId, tur: 'siparis', yon: 'alis', durum: { in: ['onaylandi', 'kismen_kapandi'] }, faturaId: null, depoId } },
    select: girisSatirSecimi, orderBy: { id: 'asc' }, take: 5001,
  });
  if (satirlar.length > 5000) throw new ConflictException('5000 sipariş kaynağı sınırı aşıldı; kısmi ihtiyaç hesaplanamaz');
  const olaylar: TarihliIhtiyacGirdisi['olaylar'] = [];
  const kanit: unknown[] = [];
  let toplamKalan = new Prisma.Decimal(0);
  for (const s of satirlar) {
    const k = girisSatirKaniti(s);
    toplamKalan = toplamKalan.add(k.kalanMiktar);
    const t = s.girisTarihi;
    kanit.push([s.id,k.kaynakOzeti,s.teslimEdilenMiktar.toFixed(3),t?.surum??0,t?.kaynakOzeti??null,t?.tarih?.toISOString().slice(0,10)??null]);
    const gecerli = !!t && t.tenantId === tenantId && t.kaynakOzeti === k.kaynakOzeti && t.tarih !== null;
    olaylar.push({
      kaynakId: s.id, tur: 'giris', gun: gecerli ? t!.tarih!.toISOString().slice(0, 10) : null,
      kalanMiktar: k.kalanMiktar, durum: 'acik', tarihDogrulandi: gecerli, rezervde: false,
      kapsam: { tenantId, stokId, depoId, varyantId: null, anaBirim: k.anaBirim },
    });
  }
  // Sipariş kalanı yoldakinin alt kümesidir; irsaliyeye geçmiş miktar eklenmez.
  if (toplamKalan.gt(yoldaki)) throw new ConflictException('Sipariş kalanı depo yoldaki bakiyesiyle tutarsız; tarihli ihtiyaç hesaplanamadı');
  return {olaylar,kaynakKaniti:createHash('sha256').update(JSON.stringify(kanit)).digest('hex')};
}
