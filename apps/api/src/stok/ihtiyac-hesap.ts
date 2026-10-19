import { Prisma } from '@prisma/client';

/** Bütün miktarlar ana birimdedir. Rezerv yalnız bir kez düşülür; terminsiz giriş eklenmez. */
export function ihtiyaciHesapla(g:{mevcut:string;rezerve:string;yoldaki:string;talep:string}){
 const d=(v:string)=>{if(!/^-?\d{1,12}(\.\d{1,3})?$/.test(v))throw Error('Geçersiz stok miktarı');return new Prisma.Decimal(v);};
 const mevcut=d(g.mevcut),rezerve=d(g.rezerve),yoldaki=d(g.yoldaki),talep=d(g.talep);
 if(rezerve.isNegative()||yoldaki.isNegative()||!talep.gt(0))throw Error('Rezerv/yoldaki negatif olamaz; ihtiyaç pozitif olmalı');
 const kullanilabilir=mevcut.sub(rezerve),karsilanabilir=Prisma.Decimal.max(Prisma.Decimal.min(kullanilabilir,talep),0),eksik=Prisma.Decimal.max(talep.sub(kullanilabilir),0);
 return {mevcut:mevcut.toFixed(3),rezerve:rezerve.toFixed(3),kullanilabilir:kullanilabilir.toFixed(3),yoldaki:yoldaki.toFixed(3),talep:talep.toFixed(3),karsilanabilir:karsilanabilir.toFixed(3),eksik:eksik.toFixed(3),durum:eksik.isZero()?'stok_yeterli' as const:'tedarik_gerekli' as const};
}
