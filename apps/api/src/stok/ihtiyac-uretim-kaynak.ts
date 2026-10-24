import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { TarihliIhtiyacGirdisi } from './ihtiyac-tarihli';

export const uretimTalepSecimi = {
  id:true,tenantId:true,uretimEmriId:true,malzemeStokId:true,malzemeVaryantId:true,
  planlananMiktar:true,ekIhtiyacMiktari:true,sarfEdilenMiktar:true,
  malzeme:{select:{kod:true,ad:true,tenantId:true,anaBirim:true,aktif:true,tip:true}},
  uretimEmri:{select:{tenantId:true,durum:true,receteId:true,no:true}},
  rezervasyonlar:{select:{tenantId:true,depoId:true,rezerveMiktar:true,sarfEdilenMiktar:true,cozulenMiktar:true},orderBy:{id:'asc'},take:5001},
  ihtiyacTalebi:{include:{depo:{select:{tenantId:true,aktif:true}}}},
} satisfies Prisma.UretimEmriKalemSelect;
type Kalem=Prisma.UretimEmriKalemGetPayload<{select:typeof uretimTalepSecimi}>;
export function uretimTalepKaniti(k:Kalem){
  if(k.rezervasyonlar.length>5000)throw new ConflictException('Üretim kaleminde 5000 rezerv kaynağı sınırı aşıldı');
  if(k.tenantId!==k.malzeme.tenantId||k.tenantId!==k.uretimEmri.tenantId||k.malzemeVaryantId||!k.malzeme.aktif||k.malzeme.tip==='hizmet')throw new ConflictException('Üretim ihtiyacının ürün/tenant kapsamı uygun değil');
  if(['taslak','tamamlandi','iptal'].includes(k.uretimEmri.durum))throw new ConflictException('Yalnız açık planlanmış üretim ihtiyacı atanabilir');
  const sayilar=[k.planlananMiktar,k.ekIhtiyacMiktari,k.sarfEdilenMiktar];
  if(sayilar.some(n=>n.isNegative()))throw new ConflictException('Üretim ihtiyacı miktarları tutarsız');
  let aktifRezerv=new Prisma.Decimal(0);
  for(const r of k.rezervasyonlar){
    const aktif=r.rezerveMiktar.sub(r.sarfEdilenMiktar).sub(r.cozulenMiktar);
    if(r.tenantId!==k.tenantId||[r.rezerveMiktar,r.sarfEdilenMiktar,r.cozulenMiktar,aktif].some(n=>n.isNegative()))throw new ConflictException('Üretim rezervi tutarsız');
    aktifRezerv=aktifRezerv.add(aktif);
  }
  const kalan=Prisma.Decimal.max(k.planlananMiktar.add(k.ekIhtiyacMiktari).sub(k.sarfEdilenMiktar),0);
  if(aktifRezerv.gt(kalan))throw new ConflictException('Aktif üretim rezervi kalan ihtiyacı aşıyor');
  const rezervDisi=kalan.sub(aktifRezerv);
  if(rezervDisi.decimalPlaces()>3||rezervDisi.gte('1000000000000'))throw new ConflictException('Üretim ihtiyacı miktar sınırını aşıyor');
  const kaynakOzeti=createHash('sha256').update(JSON.stringify([1,k.tenantId,k.id,k.uretimEmriId,k.uretimEmri.receteId,k.malzemeStokId,k.malzemeVaryantId,k.malzeme.anaBirim,k.planlananMiktar.toFixed(3),k.ekIhtiyacMiktari.toFixed(3)])).digest('hex');
  return {kaynakOzeti,rezervDisi:rezervDisi.toFixed(3),aktifRezerv:aktifRezerv.toFixed(3),anaBirim:k.malzeme.anaBirim};
}

export async function uretimTalepleriniOku(tx:Prisma.TransactionClient,tenantId:string,stokId:string,depoId:string,rezerve:string){
  const kalemler=await tx.uretimEmriKalem.findMany({where:{tenantId,malzemeStokId:stokId,malzemeVaryantId:null,uretimEmri:{tenantId,durum:{notIn:['taslak','tamamlandi','iptal']}}},select:uretimTalepSecimi,orderBy:{id:'asc'},take:5001});
  if(kalemler.length>5000)throw new ConflictException('5000 üretim kaynağı sınırı aşıldı; kısmi hesap verilemez');
  const olaylar:TarihliIhtiyacGirdisi['olaylar']=[],kanit:unknown[]=[];
  let depoRezervi=new Prisma.Decimal(0),rezervSayisi=0;
  for(const k of kalemler){
    rezervSayisi+=k.rezervasyonlar.length;if(rezervSayisi>5000)throw new ConflictException('5000 birleşik üretim rezerv kaynağı sınırı aşıldı');
    const h=uretimTalepKaniti(k),a=k.ihtiyacTalebi;
    for(const r of k.rezervasyonlar)if(r.depoId===depoId)depoRezervi=depoRezervi.add(r.rezerveMiktar.sub(r.sarfEdilenMiktar).sub(r.cozulenMiktar));
    kanit.push([k.id,h.kaynakOzeti,h.rezervDisi,h.aktifRezerv,a?.surum??0,a?.aktif??false,a?.depoId??null,a?.ihtiyacTarihi.toISOString().slice(0,10)??null,a?.kaynakOzeti??null]);
    if(h.rezervDisi==='0.000')continue;
    const gecerli=!!a&&a.aktif&&a.depo.aktif&&a.depo.tenantId===tenantId&&a.kaynakOzeti===h.kaynakOzeti;
    if(gecerli&&a!.depoId!==depoId)continue;
    // Atanmamış ihtiyaç hiçbir depoda sessizce yok sayılamaz. Belirsiz talep
    // yeterlilik sonucunu engeller; mamul hedef deposu tahmin edilmez.
    olaylar.push({kaynakId:`uretim/${k.uretimEmriId}/${k.id}`,tur:'talep',gun:gecerli?a!.ihtiyacTarihi.toISOString().slice(0,10):null,kalanMiktar:h.rezervDisi,durum:'acik',tarihDogrulandi:gecerli,rezervde:false,kapsam:{tenantId,stokId,depoId,varyantId:null,anaBirim:h.anaBirim}});
  }
  if(depoRezervi.gt(rezerve))throw new ConflictException('Üretim rezervleri depo rezerv bakiyesini aşıyor');
  return {olaylar,kaynakKaniti:createHash('sha256').update(JSON.stringify(kanit)).digest('hex')};
}
