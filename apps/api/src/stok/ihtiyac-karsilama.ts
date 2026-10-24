import { Prisma } from '@prisma/client';

type Hareket={kaynakId:string;tur:'giris'|'talep';miktar:string};
/** Yeni ihtiyacın kaynak payları. Önce önceki stok borcu ve tarihli talepler karşılanır. */
export function ihtiyacKarsilamasiniHesapla(g:{baslangicKullanilabilir:string;yeniTalep:string;hareketler:Hareket[]}){
 const kaynaklar:{tur:'mevcut_stok'|'siparis_girisi';kaynakId:string;kalan:Prisma.Decimal}[]=[];
 const baslangic=new Prisma.Decimal(g.baslangicKullanilabilir);
 let borc=Prisma.Decimal.max(baslangic.negated(),0),bas=0;
 if(baslangic.gt(0))kaynaklar.push({tur:'mevcut_stok',kaynakId:'baslangic',kalan:baslangic});
 function tuket(m:Prisma.Decimal){while(m.gt(0)&&bas<kaynaklar.length){const k=kaynaklar[bas],pay=Prisma.Decimal.min(m,k.kalan);k.kalan=k.kalan.sub(pay);m=m.sub(pay);if(k.kalan.isZero())bas++;}return m;}
 for(const h of g.hareketler){
  let m=new Prisma.Decimal(h.miktar);
  if(h.tur==='talep')borc=borc.add(tuket(m));
  else{const borcPayi=Prisma.Decimal.min(borc,m);borc=borc.sub(borcPayi);m=m.sub(borcPayi);if(m.gt(0))kaynaklar.push({tur:'siparis_girisi',kaynakId:h.kaynakId,kalan:m});}
 }
 let ihtiyac=new Prisma.Decimal(g.yeniTalep);
 const baglar:{tur:'mevcut_stok'|'siparis_girisi';kaynakId:string;miktar:string}[]=[];
 for(let i=bas;i<kaynaklar.length&&ihtiyac.gt(0);i++){const k=kaynaklar[i],pay=Prisma.Decimal.min(ihtiyac,k.kalan);if(pay.gt(0))baglar.push({tur:k.tur,kaynakId:k.kaynakId,miktar:pay.toFixed(3)});ihtiyac=ihtiyac.sub(pay);}
 return {baglar,yeniTalepKarsilanamayan:ihtiyac.toFixed(3),oncekiAcik:borc.toFixed(3)};
}
