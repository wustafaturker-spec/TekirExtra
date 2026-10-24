import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { expect,it,vi } from 'vitest';
import { uretimTalepKaniti,uretimTalepleriniOku } from './ihtiyac-uretim-kaynak';
const id='11111111-1111-4111-8111-111111111111',d=(n:string)=>new Prisma.Decimal(n);
function kalem(){return {id,tenantId:id,uretimEmriId:id,malzemeStokId:id,malzemeVaryantId:null,planlananMiktar:d('10'),ekIhtiyacMiktari:d('2'),sarfEdilenMiktar:d('3'),malzeme:{tenantId:id,anaBirim:'kg',aktif:true,tip:'urun'},uretimEmri:{tenantId:id,durum:'malzeme_bekliyor',receteId:null,no:'UR-1'},rezervasyonlar:[{tenantId:id,depoId:id,rezerveMiktar:d('5'),sarfEdilenMiktar:d('2'),cozulenMiktar:d('1')}],ihtiyacTalebi:null} as unknown as Parameters<typeof uretimTalepKaniti>[0];}
it('plan + ek ihtiyaç - sarf - tüm depolardaki aktif rezervi bir kez düşer',()=>{
 const k=kalem();k.rezervasyonlar.push({...k.rezervasyonlar[0],depoId:'22222222-2222-4222-8222-222222222222',rezerveMiktar:d('4'),sarfEdilenMiktar:d('1'),cozulenMiktar:d('0')});
 expect(uretimTalepKaniti(k)).toMatchObject({rezervDisi:'4.000',aktifRezerv:'5.000'});
});
it('sarf ve rezerv ilerlemesi miktarı günceller; plan değişimi doğrulamayı bozar',()=>{
 const k=kalem(),once=uretimTalepKaniti(k);k.sarfEdilenMiktar=d('4');expect(uretimTalepKaniti(k)).toMatchObject({kaynakOzeti:once.kaynakOzeti,rezervDisi:'6.000'});
 k.planlananMiktar=d('11');expect(uretimTalepKaniti(k).kaynakOzeti).not.toBe(once.kaynakOzeti);
});
it('negatif aktif rezerv ve kalan ihtiyacı aşan rezervi reddeder',()=>{
 const k=kalem();k.rezervasyonlar[0].cozulenMiktar=d('10');expect(()=>uretimTalepKaniti(k)).toThrow('rezervi tutarsız');
 const b=kalem();b.rezervasyonlar[0].rezerveMiktar=d('100');expect(()=>uretimTalepKaniti(b)).toThrow('aşıyor');
});
it('atama olmayan ihtiyaç için mamul hedef deposu varsaymaz; belirsiz olay üretir',async()=>{
 const tx={uretimEmriKalem:{findMany:vi.fn().mockResolvedValue([kalem()])}} as unknown as Prisma.TransactionClient;
 expect(await uretimTalepleriniOku(tx,id,id,id,'2')).toMatchObject({olaylar:[{tur:'talep',gun:null,kalanMiktar:'7.000',tarihDogrulandi:false}]});
 await expect(uretimTalepleriniOku(tx,id,id,id,'1')).rejects.toMatchObject({status:409});
});
it('5001 üretim kaynağını kısmi okumaz',async()=>{
 const tx={uretimEmriKalem:{findMany:vi.fn().mockResolvedValue(Array(5001).fill(kalem()))}} as unknown as Prisma.TransactionClient;
 await expect(uretimTalepleriniOku(tx,id,id,id,'2')).rejects.toMatchObject({status:409});
});
it('5001 rezerv kaynağında ve birleşik rezerv sınırında kısmi sonuç verilmez',async()=>{
 const k=kalem();k.rezervasyonlar=Array(5001).fill(k.rezervasyonlar[0]);expect(()=>uretimTalepKaniti(k)).toThrow('5000 rezerv');
 const a=kalem();a.rezervasyonlar=Array(2501).fill({...a.rezervasyonlar[0],rezerveMiktar:d('0'),sarfEdilenMiktar:d('0'),cozulenMiktar:d('0')});
 const tx={uretimEmriKalem:{findMany:vi.fn().mockResolvedValue([a,{...a,id:'22222222-2222-4222-8222-222222222222'}])}} as unknown as Prisma.TransactionClient;
 await expect(uretimTalepleriniOku(tx,id,id,id,'0')).rejects.toMatchObject({status:409});
});
