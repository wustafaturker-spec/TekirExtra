import { createHash } from 'node:crypto';
export function ihtiyacSonucKaniti(s:{bugun:string;ihtiyacTarihi:string;stok:{id:string;anaBirim:string};depo:{id:string};girilen:unknown;hesap:unknown;tarihli:unknown}){
 return createHash('sha256').update(JSON.stringify([1,s.bugun,s.ihtiyacTarihi,s.stok.id,s.stok.anaBirim,s.depo.id,s.girilen,s.hesap,s.tarihli])).digest('hex');
}
