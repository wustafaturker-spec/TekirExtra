import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { girisSatirKaniti, siparisGirisleriniOku } from './ihtiyac-siparis-kaynak';

const id = '11111111-1111-4111-8111-111111111111';
const D = (s: string) => new Prisma.Decimal(s);
function satir() {
  return { id, tenantId: id, belgeId: id, stokId: id, varyantId: null, miktar: D('4'), teslimEdilenMiktar: D('1'), birim: 'kutu',
    belge: { id, tenantId: id, tur: 'siparis', yon: 'alis', durum: 'kismen_kapandi', depoId: id, cariId: id, faturaId: null },
    stok: { tenantId: id, aktif: true, tip: 'urun', anaBirim: 'adet', birimler: [{ ad: 'kutu', katsayi: D('2.5') }] }, girisTarihi: null } as unknown as Parameters<typeof girisSatirKaniti>[0];
}
it('teslim edilmemiş kalanı ana birime çevirir; tarih kalan teslimlerde geçerli kalır', () => {
  const s = satir(), k = girisSatirKaniti(s);
  expect(k.kalanMiktar).toBe('7.500');
  s.teslimEdilenMiktar = D('2');
  expect(girisSatirKaniti(s)).toMatchObject({ kalanMiktar: '5.000', kaynakOzeti: k.kaynakOzeti });
});
it('miktar, katsayı ve depo değişimi önceki tarih kanıtını geçersizleştirir', () => {
  const k = girisSatirKaniti(satir()).kaynakOzeti;
  const s = satir(); s.miktar = D('5'); expect(girisSatirKaniti(s).kaynakOzeti).not.toBe(k);
  const b = satir(); b.stok.birimler[0].katsayi = D('3'); expect(girisSatirKaniti(b).kaynakOzeti).not.toBe(k);
  const d = satir(); d.belge.depoId = '22222222-2222-4222-8222-222222222222'; expect(girisSatirKaniti(d).kaynakOzeti).not.toBe(k);
});
it('fazla teslim, bilinmeyen birim ve kapalı siparişi reddeder', () => {
  const s = satir(); s.teslimEdilenMiktar = D('5'); expect(() => girisSatirKaniti(s)).toThrow();
  const b = satir(); b.birim = 'bilinmeyen'; expect(() => girisSatirKaniti(b)).toThrow();
  const k = satir(); k.belge.durum = 'kapandi'; expect(() => girisSatirKaniti(k)).toThrow();
});
it('tarihsiz kaynağı girişe eklemez; kaynak sınırını sorguda kurar', async () => {
  const findMany = vi.fn().mockResolvedValue([satir()]);
  const tx = { belgeSatir: { findMany } } as unknown as Prisma.TransactionClient;
  expect(await siparisGirisleriniOku(tx, id, id, id, '10')).toMatchObject({olaylar:[{ gun: null, tarihDogrulandi: false, kalanMiktar: '7.500' }]});
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5001, where: expect.objectContaining({ tenantId: id, stokId: id, belge: expect.objectContaining({ depoId: id }) }) }));
  await expect(siparisGirisleriniOku(tx, id, id, id, '7')).rejects.toMatchObject({ status: 409 });
});
it('5001 kaynakta kısmi sonuç döndürmez', async () => {
  const tx = { belgeSatir: { findMany: vi.fn().mockResolvedValue(Array(5001).fill(satir())) } } as unknown as Prisma.TransactionClient;
  await expect(siparisGirisleriniOku(tx, id, id, id, '99999')).rejects.toMatchObject({ status: 409 });
});
