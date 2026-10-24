import { expect,it } from 'vitest';
import { ihtiyacKarsilamasiniHesapla as hesap } from './ihtiyac-karsilama';
import { tarihliIhtiyaciHesapla } from './ihtiyac-tarihli';
import { Prisma } from '@prisma/client';
it('yeni talebi mevcut stok ve doğrulanmış girişten tam paylaştırır',()=>{
 expect(hesap({baslangicKullanilabilir:'6',yeniTalep:'8',hareketler:[{kaynakId:'s1',tur:'giris',miktar:'5'}]})).toEqual({baglar:[{tur:'mevcut_stok',kaynakId:'baslangic',miktar:'6.000'},{tur:'siparis_girisi',kaynakId:'s1',miktar:'2.000'}],yeniTalepKarsilanamayan:'0.000',oncekiAcik:'0.000'});
});
it('önceki talepler yeni talebin kaynak payını tüketir; aynı giriş iki kez kullanılmaz',()=>{
 const h=hesap({baslangicKullanilabilir:'2',yeniTalep:'8',hareketler:[{kaynakId:'u1',tur:'talep',miktar:'5'},{kaynakId:'s1',tur:'giris',miktar:'4'},{kaynakId:'s2',tur:'giris',miktar:'2'}]});
 expect(h).toEqual({baglar:[{tur:'siparis_girisi',kaynakId:'s1',miktar:'1.000'},{tur:'siparis_girisi',kaynakId:'s2',miktar:'2.000'}],yeniTalepKarsilanamayan:'5.000',oncekiAcik:'0.000'});
});
it('önceki stok borcunu girişten ayırır ve yeni talebe yanlış pay yazmaz',()=>{
 expect(hesap({baslangicKullanilabilir:'-5',yeniTalep:'2',hareketler:[{kaynakId:'s1',tur:'giris',miktar:'3'}]})).toEqual({baglar:[],yeniTalepKarsilanamayan:'2.000',oncekiAcik:'2.000'});
});
it('ondalık paylarda yuvarlama veya fazla karşılama oluşturmaz',()=>{
 expect(hesap({baslangicKullanilabilir:'0.1',yeniTalep:'0.3',hareketler:[{kaynakId:'s1',tur:'giris',miktar:'0.2'}]}).yeniTalepKarsilanamayan).toBe('0.000');
});
it('kaynak payları ve açıklar 54 farklı borç/talep/giriş birleşiminde ana motorla eşittir',()=>{
 const id='11111111-1111-4111-8111-111111111111',kapsam={tenantId:id,stokId:id,depoId:id,varyantId:null,anaBirim:'adet'};
 for(const mevcut of ['-4','0','6'])for(const onceki of ['0','3','9'])for(const giris of ['0','2','12'])for(const yeniTalep of ['1','8']){
  const ortak={durum:'acik' as const,tarihDogrulandi:true,rezervde:false,kapsam};
  const r=tarihliIhtiyaciHesapla({kapsam,bugun:'2026-10-22',ihtiyacTarihi:'2026-10-24',mevcut,rezerve:'0',yeniTalep,olaylar:[{...ortak,kaynakId:'talep-1',tur:'talep',gun:'2026-10-22',kalanMiktar:onceki},{...ortak,kaynakId:'giris-1',tur:'giris',gun:'2026-10-23',kalanMiktar:giris}]});
  const h=hesap(r),D=Prisma.Decimal;
  expect(new D(h.oncekiAcik).add(h.yeniTalepKarsilanamayan).toFixed(3)).toBe(r.eksik);
  expect(h.baglar.reduce((a,b)=>a.add(b.miktar),new D(h.yeniTalepKarsilanamayan)).toFixed(3)).toBe(new D(yeniTalep).toFixed(3));
 }
});
