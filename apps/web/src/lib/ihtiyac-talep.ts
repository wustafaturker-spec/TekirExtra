/** URL yalnız ihtiyacın girdisini taşır; eksik miktar sunucudan yeniden hesaplanır. */
export type IhtiyacGirdisi = { stokId: string; depoId: string; miktar: string; birim: string; ihtiyacTarihi: string; hesapTuru?: 'tarihli' };
export type IhtiyacSonucu = {
  alindigiZaman: string;
  ihtiyacTarihi: string;
  stok: { id: string; kod: string; ad: string; anaBirim: string };
  depo: { id: string; kod: string; ad: string };
  girilen: { miktar: string; birim: string; katsayi: string };
  hesap: Record<string, string>;
  sonucKaniti?:string;
  erisim?:{surum:1;mod:string;yazabilir:boolean};
  tarihli?: {surum:number;kaynakKaniti:string;veriYeterli:boolean;durum:string;eksik:string;tarihliGiris:string;ekTalep:string;donemSonu:string;donemIciEnBuyukAcik:string;hareketler:{kaynakId:string;gun:string;tur:string;miktar:string;bakiye:string}[];dislananlar:{kaynakId:string;neden:string}[]};
};
const alanlar = ['stokId', 'depoId', 'miktar', 'birim', 'ihtiyacTarihi'] as const;
export function ihtiyacTalepYolu(g: IhtiyacGirdisi) {
  const q = new URLSearchParams({ kaynak: 'stok-ihtiyac' });
  for (const k of alanlar) q.set(k, g[k]);
  if(g.hesapTuru)q.set('hesapTuru',g.hesapTuru);
  return '/panel/satin-alma/talepler?' + q;
}
export function ihtiyacGirdisiOku(q: URLSearchParams): IhtiyacGirdisi | null {
  if (q.get('kaynak') !== 'stok-ihtiyac') return null;
  const g = {} as IhtiyacGirdisi;
  for (const k of alanlar) {
    if (q.getAll(k).length !== 1 || !q.get(k) || q.get(k)!.length > 100) throw Error('İhtiyaç bağlantısı eksik veya geçersiz. Stok ihtiyaç ekranından yeniden aktarın.');
    g[k] = q.get(k)!;
  }
  if(q.has('hesapTuru')){
    if(q.getAll('hesapTuru').length!==1||q.get('hesapTuru')!=='tarihli')throw Error('Geçersiz ihtiyaç hesap türü.');
    g.hesapTuru='tarihli';
  }
  return g;
}
export const ihtiyacSorgusu = (g: IhtiyacGirdisi) => {
  const q=new URLSearchParams();for(const k of alanlar)q.set(k,g[k]);
  return `/stok/ihtiyac-plani/${g.hesapTuru==='tarihli'?'tarihli-onizle':'onizle'}?${q}`;
};
// PostgreSQL JSONB nesne alanlarını yeniden sıralayabilir; dizilerin sırası anlamlıdır.
function siraliNesne(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(siraliNesne);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,deger])=>[k,siraliNesne(deger)]));
  return v;
}
export function ihtiyacKaniti(s: IhtiyacSonucu) {
  return JSON.stringify(siraliNesne([s.ihtiyacTarihi, s.stok.id, s.stok.anaBirim, s.depo.id, s.girilen, s.hesap,s.tarihli??null]));
}
export function ihtiyacEksigi(s:IhtiyacSonucu,tur?:'tarihli'){
  const t=s.tarihli;
  if(tur==='tarihli'&&(!t||t.surum!==1||!t.veriYeterli||!/^[a-f0-9]{64}$/.test(t.kaynakKaniti)||t.durum==='dogrulanamadi'))throw Error('Tarihli ihtiyaç doğrulanamadı; yeniden hesaplayın.');
  const eksik=tur==='tarihli'?t!.eksik:s.hesap.eksik;
  if (!/^(0|[1-9]\d{0,11})\.\d{3}$/.test(eksik)) throw Error('Eksik miktar satın alma talebinin miktar sınırına uygun değil.');
  if(tur==='tarihli'){
    if(!/^(0|[1-9]\d*)\.\d{3}$/.test(t!.donemIciEnBuyukAcik)||BigInt(t!.donemIciEnBuyukAcik.replace('.',''))>BigInt(eksik.replace('.','')))throw Error('Dönem içinde daha erken stok açığı var. Önce bu açığın ihtiyaç gününü ayrıca planlayın.');
  }
  return eksik;
}
export function ihtiyactanTalep(s: IhtiyacSonucu,tur?:'tarihli') {
  const eksik=ihtiyacEksigi(s,tur);
  if (/^0\.0+$/.test(eksik)) throw Error('Bu ihtiyaç için satın alma açığı bulunmuyor.');
  return {
    departmanId: '', ihtiyacTarihi: s.ihtiyacTarihi, butceAnahtari: '',
    gerekce: `${tur==='tarihli'?'Tarihli stok ihtiyacı':'Stok ihtiyacı'}: ${s.stok.kod} / ${s.depo.kod} ${s.depo.ad}; yeni ihtiyaç ${s.hesap.talep} ${s.stok.anaBirim}, eksik ${eksik} ${s.stok.anaBirim}.`.slice(0, 1000),
    kalemler: [{ stokId: s.stok.id, miktar: eksik, tahminiBirimFiyat: '' }],
  };
}
