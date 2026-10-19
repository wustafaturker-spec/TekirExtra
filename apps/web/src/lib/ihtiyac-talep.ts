/** URL yalnız ihtiyacın girdisini taşır; eksik miktar sunucudan yeniden hesaplanır. */
export type IhtiyacGirdisi = { stokId: string; depoId: string; miktar: string; birim: string; ihtiyacTarihi: string };
export type IhtiyacSonucu = {
  alindigiZaman: string;
  ihtiyacTarihi: string;
  stok: { id: string; kod: string; ad: string; anaBirim: string };
  depo: { id: string; kod: string; ad: string };
  girilen: { miktar: string; birim: string; katsayi: string };
  hesap: Record<string, string>;
};
const alanlar = ['stokId', 'depoId', 'miktar', 'birim', 'ihtiyacTarihi'] as const;
export function ihtiyacTalepYolu(g: IhtiyacGirdisi) {
  const q = new URLSearchParams({ kaynak: 'stok-ihtiyac' });
  for (const k of alanlar) q.set(k, g[k]);
  return '/panel/satin-alma/talepler?' + q;
}
export function ihtiyacGirdisiOku(q: URLSearchParams): IhtiyacGirdisi | null {
  if (q.get('kaynak') !== 'stok-ihtiyac') return null;
  const g = {} as IhtiyacGirdisi;
  for (const k of alanlar) {
    if (q.getAll(k).length !== 1 || !q.get(k) || q.get(k)!.length > 100) throw Error('İhtiyaç bağlantısı eksik veya geçersiz. Stok ihtiyaç ekranından yeniden aktarın.');
    g[k] = q.get(k)!;
  }
  return g;
}
export const ihtiyacSorgusu = (g: IhtiyacGirdisi) => '/stok/ihtiyac-plani/onizle?' + new URLSearchParams(g);
export function ihtiyacKaniti(s: IhtiyacSonucu) {
  return JSON.stringify([s.ihtiyacTarihi, s.stok.id, s.stok.anaBirim, s.depo.id, s.girilen, s.hesap]);
}
export function ihtiyactanTalep(s: IhtiyacSonucu) {
  if (!/^(0|[1-9]\d{0,11})\.\d{3}$/.test(s.hesap.eksik)) throw Error('Eksik miktar satın alma talebinin miktar sınırına uygun değil.');
  if (/^0\.0+$/.test(s.hesap.eksik)) throw Error('Bu ihtiyaç için satın alma açığı bulunmuyor.');
  return {
    departmanId: '', ihtiyacTarihi: s.ihtiyacTarihi, butceAnahtari: '',
    gerekce: `Stok ihtiyacı: ${s.stok.kod} / ${s.depo.kod} ${s.depo.ad}; yeni ihtiyaç ${s.hesap.talep} ${s.stok.anaBirim}, eksik ${s.hesap.eksik} ${s.stok.anaBirim}.`.slice(0, 1000),
    kalemler: [{ stokId: s.stok.id, miktar: s.hesap.eksik, tahminiBirimFiyat: '' }],
  };
}
