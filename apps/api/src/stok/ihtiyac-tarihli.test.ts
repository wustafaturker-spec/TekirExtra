import { expect, it } from 'vitest';
import { tarihliIhtiyaciHesapla, type TarihliIhtiyacGirdisi } from './ihtiyac-tarihli';

const id = '11111111-1111-4111-8111-111111111111';
const kapsam = { tenantId: id, stokId: id, depoId: id, varyantId: null, anaBirim: 'adet' };
const giris = (v: Partial<TarihliIhtiyacGirdisi['olaylar'][number]> = {}): TarihliIhtiyacGirdisi['olaylar'][number] => ({
  kaynakId: 'alis/satir-1', tur: 'giris', gun: '2026-10-23', kalanMiktar: '2',
  durum: 'acik', tarihDogrulandi: true, rezervde: false, kapsam, ...v,
});
const hesap = (olaylar: TarihliIhtiyacGirdisi['olaylar'] = [], v: Partial<TarihliIhtiyacGirdisi> = {}) =>
  tarihliIhtiyaciHesapla({ kapsam, bugun: '2026-10-22', ihtiyacTarihi: '2026-10-24', mevcut: '10', rezerve: '4', yeniTalep: '8', olaylar, ...v });

it('F04-K1: 10 stok ve 4 rezervde yeni 8 talep için açık 2 olur', () => {
  expect(hesap()).toMatchObject({ baslangicKullanilabilir: '6.000', eksik: '2.000', donemIciEnBuyukAcik: '2.000' });
});
it('zamanında doğrulanmış kısmi kalan giriş açığı kapatır', () => {
  expect(hesap([giris()])).toMatchObject({ tarihliGiris: '2.000', eksik: '0.000', donemSonu: '0.000' });
});
it.each([
  [{ gun: null }, 'tarih_dogrulanmadi'],
  [{ tarihDogrulandi: false }, 'tarih_dogrulanmadi'],
  [{ gun: '2026-10-21' }, 'gecikmis_kaynak'],
  [{ gun: '2026-10-25' }, 'ufuk_disinda'],
  [{ durum: 'iptal' }, 'kapali_kaynak'],
  [{ durum: 'tamamlandi' }, 'kapali_kaynak'],
  [{ kalanMiktar: '0' }, 'kalan_yok'],
] as const)('uygun olmayan giriş yeterlilik yaratmaz: %j', (v, neden) => {
  expect(hesap([giris(v)])).toMatchObject({ eksik: '2.000', dislananlar: [{ kaynakId: 'alis/satir-1', neden }] });
});
it('rezervdeki talep ikinci kez düşülmez; rezerv dışı talep düşülür', () => {
  const olaylar = [giris({ tur: 'talep', rezervde: true, kalanMiktar: '4' }), giris({ kaynakId: 'satis/yeni', tur: 'talep', kalanMiktar: '1' })];
  expect(hesap(olaylar)).toMatchObject({ ekTalep: '1.000', eksik: '3.000' });
});
it.each([null, '2026-10-21'])('tarihi belirsiz/gecikmiş açık talepte yeterlilik ilan edilmez: %s', gun => {
  expect(hesap([giris({ tur: 'talep', gun })], { mevcut: '100' })).toMatchObject({ veriYeterli: false, durum: 'dogrulanamadi' });
});
it('gün sonu giriş önceki günün ve aynı günün açığını gizlemez', () => {
  const olaylar = [giris({ kalanMiktar: '10' }), giris({ kaynakId: 'satis/1', tur: 'talep', kalanMiktar: '8' })];
  const r = hesap(olaylar);
  expect(r).toMatchObject({ eksik: '0.000', donemIciEnBuyukAcik: '2.000', durum: 'donem_sonu_yeterli' });
  expect(r.hareketler.map(o => o.tur)).toEqual(['talep', 'giris']);
  expect(hesap([...olaylar].reverse())).toEqual(r);
});
it('negatif stok borcunu ve ondalık hassasiyeti korur', () => {
  expect(hesap([], { mevcut: '-2', yeniTalep: '8' }).eksik).toBe('14.000');
  expect(hesap([], { mevcut: '0.3', rezerve: '0.1', yeniTalep: '0.2' }).eksik).toBe('0.000');
});
it.each(['tenantId', 'stokId', 'depoId', 'varyantId', 'anaBirim'] as const)('farklı %s kapsamını reddeder', k => {
  const diger = k === 'anaBirim' ? 'kutu' : '22222222-2222-4222-8222-222222222222';
  expect(() => hesap([giris({ kapsam: { ...kapsam, [k]: diger } })])).toThrow('kapsamı uyuşmuyor');
});
it('yinelenen kaynak satırını sessizce iki kere saymaz', () => {
  expect(() => hesap([giris(), giris()])).toThrow('Tekrarlanan');
});
it('geçersiz takvim, geçmiş hedef, hassasiyet ve negatif kalanı reddeder', () => {
  expect(() => hesap([giris({ gun: '2026-02-30' })])).toThrow();
  expect(() => hesap([], { ihtiyacTarihi: '2026-10-21' })).toThrow();
  expect(() => hesap([giris({ kalanMiktar: '0.0001' })])).toThrow();
  expect(() => hesap([giris({ kalanMiktar: '-1' })])).toThrow();
  expect(() => hesap([giris({ rezervde: true })])).toThrow();
});
it('5000 kaynak tam işlenir, 5001 kaynakta kısmi sonuç üretilmez', () => {
  const olaylar = Array.from({ length: 5000 }, (_, i) => giris({ kaynakId: `alis/${i}`, kalanMiktar: '0.001' }));
  expect(hesap(olaylar).tarihliGiris).toBe('5.000');
  expect(() => hesap([...olaylar, giris()])).toThrow();
});
it('girdi dizisini değiştirmez ve gün sınırlarını dahil eder', () => {
  const olaylar = [giris({ gun: '2026-10-24' }), giris({ kaynakId: 'alis/2', gun: '2026-10-22' })];
  const once = JSON.stringify(olaylar);
  expect(hesap(olaylar).tarihliGiris).toBe('4.000');
  expect(JSON.stringify(olaylar)).toBe(once);
});
