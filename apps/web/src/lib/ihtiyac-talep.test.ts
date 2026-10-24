import {expect,it} from 'vitest';
import {ihtiyacEksigi,ihtiyacGirdisiOku,ihtiyacKaniti,ihtiyacSorgusu,ihtiyacTalepYolu,ihtiyactanTalep,type IhtiyacSonucu} from './ihtiyac-talep';
const g={stokId:'s',depoId:'d',miktar:'8',birim:'kutu',ihtiyacTarihi:'2099-01-01'};
const sonuc:IhtiyacSonucu={alindigiZaman:'2026-10-19T00:00:00Z',ihtiyacTarihi:g.ihtiyacTarihi,stok:{id:'s',kod:'S1',ad:'Ürün',anaBirim:'adet'},depo:{id:'d',kod:'D1',ad:'Merkez'},girilen:{miktar:'8',birim:'kutu',katsayi:'2'},hesap:{talep:'16.000',eksik:'2.000',kullanilabilir:'14.000'}};
it('URL eksik miktar ve fiyat taşımaz; girdiler sunucuda yeniden hesaplanır',()=>{const u=new URL(ihtiyacTalepYolu(g),'http://test');expect(ihtiyacGirdisiOku(u.searchParams)).toEqual(g);expect(u.searchParams.has('eksik')).toBe(false);expect(u.searchParams.has('fiyat')).toBe(false);});
it('aktarımı olmayan sayfayı ve bozuk bağlantıyı ayırır',()=>{expect(ihtiyacGirdisiOku(new URLSearchParams())).toBeNull();expect(()=>ihtiyacGirdisiOku(new URLSearchParams('kaynak=stok-ihtiyac'))).toThrow();expect(()=>ihtiyacGirdisiOku(new URLSearchParams('kaynak=stok-ihtiyac&stokId=s&stokId=s'))).toThrow();});
it('açığı ana birimde aktarır; bütçe ve fiyat seçimini kullanıcıya bırakır',()=>expect(ihtiyactanTalep(sonuc)).toMatchObject({butceAnahtari:'',ihtiyacTarihi:g.ihtiyacTarihi,kalemler:[{stokId:'s',miktar:'2.000',tahminiBirimFiyat:''}]}));
it.each(['0.000','-1.000','NaN','1.0001','1000000000000.000'])('geçersiz veya sıfır açık aktarılmaz: %s',eksik=>expect(()=>ihtiyactanTalep({...sonuc,hesap:{...sonuc.hesap,eksik}})).toThrow());
it('yeniden okumada yalnız saat değişmesi kanıtı bozmaz; miktar ve birim değişimi bozar',()=>{expect(ihtiyacKaniti({...sonuc,alindigiZaman:'yeni'})).toBe(ihtiyacKaniti(sonuc));expect(ihtiyacKaniti({...sonuc,hesap:{...sonuc.hesap,eksik:'3.000'}})).not.toBe(ihtiyacKaniti(sonuc));expect(ihtiyacKaniti({...sonuc,stok:{...sonuc.stok,anaBirim:'kg'}})).not.toBe(ihtiyacKaniti(sonuc));});
const t:IhtiyacSonucu={...sonuc,tarihli:{surum:1,kaynakKaniti:'a'.repeat(64),veriYeterli:true,durum:'tedarik_gerekli',eksik:'1.000',donemIciEnBuyukAcik:'1.000',tarihliGiris:'1.000',ekTalep:'0.000',donemSonu:'-1.000',hareketler:[],dislananlar:[]}};
it('tarihli bağlantı yalnız modu ve girdileri taşır; API sorgusuna UI modu eklenmez',()=>{
 const girdiler={...g,hesapTuru:'tarihli' as const},q=new URL(ihtiyacTalepYolu(girdiler),'http://test').searchParams;
 expect(ihtiyacGirdisiOku(q)).toEqual(girdiler);expect(ihtiyacSorgusu(girdiler)).toContain('/tarihli-onizle?');expect(ihtiyacSorgusu(girdiler)).not.toContain('hesapTuru');
 for(const v of ['yanlis','tarihli&hesapTuru=tarihli'])expect(()=>ihtiyacGirdisiOku(new URLSearchParams(q.toString().replace('hesapTuru=tarihli',`hesapTuru=${v}`)))).toThrow();
});
it('tarihli aktarımda anlık açık yerine tarihli açık kullanılır',()=>{
 expect(ihtiyactanTalep(t,'tarihli').kalemler[0].miktar).toBe('1.000');
 expect(ihtiyactanTalep(t).kalemler[0].miktar).toBe('2.000');
});
it('eksik tarihli yanıt ve doğrulanamayan sonuç anlık hesaba dönmez',()=>{
 expect(()=>ihtiyactanTalep(sonuc,'tarihli')).toThrow('doğrulanamadı');
 expect(()=>ihtiyactanTalep({...t,tarihli:{...t.tarihli!,veriYeterli:false}},'tarihli')).toThrow('doğrulanamadı');
});
it('erken açık hedef güne tek talep olarak taşınmaz',()=>{
 expect(()=>ihtiyacEksigi({...t,tarihli:{...t.tarihli!,donemIciEnBuyukAcik:'2.000'}},'tarihli')).toThrow('daha erken');
});
it('tutar aynı olsa bile kaynak doğrulama revizyonu aktarım kanıtını değiştirir',()=>{
 expect(ihtiyacKaniti({...t,tarihli:{...t.tarihli!,kaynakKaniti:'b'.repeat(64)}})).not.toBe(ihtiyacKaniti(t));
 expect(ihtiyacKaniti({...t,alindigiZaman:'yeni'})).toBe(ihtiyacKaniti(t));
});

it('JSONB alan sırası değişse de aynı plan kanıtıdır; iç kaynak değişimi hâlâ saptanır',()=>{
 const ters=(v:unknown):unknown=>Array.isArray(v)?v.map(ters):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,ters(x)])):v;
 const saklanan=ters(t) as IhtiyacSonucu;expect(ihtiyacKaniti(saklanan)).toBe(ihtiyacKaniti(t));
 expect(ihtiyacKaniti({...saklanan,tarihli:{...saklanan.tarihli!,kaynakKaniti:'b'.repeat(64)}})).not.toBe(ihtiyacKaniti(t));
});
