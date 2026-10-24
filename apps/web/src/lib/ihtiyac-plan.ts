import type { IhtiyacGirdisi,IhtiyacSonucu } from './ihtiyac-talep';
export type IhtiyacPlanSatiri={id:string;createdAt:string;stokKod:string;stokAd:string;depoAd:string;anaBirim:string;miktar:string;ihtiyacTarihi:string};
export type KayitliIhtiyacPlani={id:string;createdAt:string;surum:number;guncel:boolean;erisim?:{mod:string;yazabilir:boolean};satinAlmaBagi?:{talepId:string}|null;neden?:string;girdi:IhtiyacGirdisi;snapshot:IhtiyacSonucu;karsilamaBaglari:{id:string;tur:string;kaynakId:string;miktar:string}[]};
export function planGirdisiYolu(g:IhtiyacGirdisi){
 const q=new URLSearchParams({kaynak:'stok-ihtiyac',hesapTuru:'tarihli'});
 for(const k of ['stokId','depoId','miktar','birim','ihtiyacTarihi'] as const)q.set(k,g[k]);
 return '/panel/stok/ihtiyac?'+q;
}
/** Miktarları Number'a çevirerek büyük veya kesirli stoklarda hassasiyet kaybetme. */
export function ihtiyacMiktariYaz(v:string){const [tam,kesir='']=v.split('.');return `${tam.replace(/\B(?=(\d{3})+(?!\d))/g,'.')},${kesir.padEnd(3,'0')}`;}
