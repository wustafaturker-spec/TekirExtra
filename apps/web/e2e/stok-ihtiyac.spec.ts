import {test,expect,type Page} from '@playwright/test';
import {createHmac} from 'node:crypto';
const id='11111111-1111-4111-8111-111111111111',depo='22222222-2222-4222-8222-222222222222';
const planId='33333333-3333-4333-8333-333333333333';
async function kur(page:Page,rol='depo'){
 const state={mod:'pilot',sonOnizleme:null as any,sonucKaniti:'c'.repeat(64),veriYeterli:true,izinliPlan:false,planHata:0,planYazilari:[] as any[],planKaydi:null as any,planGuncel:true,ikiSayfa:false,planOkumalari:0,uretimAtama:null as any,uretimHata:false,izinliUretim:false,uretimYazilari:[] as any[],uretimOkumalari:0,hata:false,gecikme:0,eksik:'2.000',tarihliEksik:'1.000',erkenAcik:'1.000',kaynakKaniti:'a'.repeat(64),tarih:'2098-12-31' as string|null,tarihSurumu:1,tarihHata:false,izinliTarih:false,tarihYazilari:[] as any[],izinliYazi:false,yazilar:[] as any[],sorgular:[] as URL[]};
 page.on('pageerror',e=>{throw e;});await page.addInitScript(()=>sessionStorage.setItem('tekir_access','fixture'));
 const g=`v1.${Math.floor(Date.now()/1000)+3600}`;await page.context().addCookies([{name:'tekir_oturum',value:`${g}.${createHmac('sha256','crm-belge-playwright-session-secret-2026').update(g).digest('base64url')}`,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
 await page.route('**/api/v1/**',async r=>{const u=new URL(r.request().url()),p=u.pathname.replace('/api/v1','');
 const erisim={surum:1,mod:state.mod,yazabilir:['pilot','acik'].includes(state.mod)};
 if(state.mod==='kapali'&&p.startsWith('/stok/ihtiyac-plani/')&&!p.endsWith('/onizle'))return r.fulfill({status:403,json:{message:'Tarihli stok ihtiyacı bu şirket için kapalı.'}});
 if(p===`/stok/ihtiyac-plani/uretim-talepleri/${id}`){
  state.uretimOkumalari++;
  if(r.request().method()==='PUT'){
   expect(state.izinliUretim).toBe(true);const g=r.request().postDataJSON();state.uretimYazilari.push(g);
   if(state.uretimHata)return r.fulfill({status:409,json:{message:'Üretim ihtiyaç ataması değişti; yeniden yükleyin'}});
   expect(g.beklenenSurum).toBe(state.uretimAtama?.surum??0);expect(g.beklenenKaynakOzeti).toBe(state.kaynakKaniti);
   state.uretimAtama={...g,surum:g.beklenenSurum+1,kaynakOzeti:state.kaynakKaniti,depo:{aktif:true}};
   return r.fulfill({json:state.uretimAtama});
  }
  return r.fulfill({json:{erisim,kalemId:id,emirId:id,emirNo:'UR-1',malzeme:{kod:'HM-1',ad:'Hammadde'},rezervDisi:'3.000',aktifRezerv:'2.000',anaBirim:'kg',kaynakOzeti:state.kaynakKaniti,atama:state.uretimAtama}});
 }
 if(p==='/stok/ihtiyac-plani/planlar'){
  if(r.request().method()==='POST'){
   expect(state.izinliPlan).toBe(true);const g=r.request().postDataJSON();state.planYazilari.push(g);
   expect(Object.keys(g).sort()).toEqual(['beklenenSonucKaniti','girdi','istekAnahtari']);
   if(state.planHata===409)return r.fulfill({status:409,json:{message:'İhtiyaç kaynakları değişti; önizlemeyi yenileyin'}});
   if(!state.planKaydi)state.planKaydi={id:planId,surum:1,createdAt:'2026-10-22T10:00:00Z',girdi:g.girdi,snapshot:JSON.parse(JSON.stringify(state.sonOnizleme,(_k,v)=>v&&!Array.isArray(v)&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse()):v)),karsilamaBaglari:[{id:'pay-1',tur:'mevcut_stok',kaynakId:'baslangic',miktar:'6.000'},{id:'pay-2',tur:'siparis_girisi',kaynakId:id,miktar:'1.000'}]};
   if(state.planHata===500){state.planHata=0;return r.fulfill({status:500,json:{message:'İşlem sonucu alınamadı'}});}
   return r.fulfill({status:201,json:state.planKaydi});
  }
  state.planOkumalari++;
  const satir={id:planId,createdAt:'2026-10-22T10:00:00Z',stokKod:'S1',stokAd:'Pilot ürün',depoAd:'Ana depo',anaBirim:'adet',miktar:'8.000',ihtiyacTarihi:'2099-01-01'};
  return r.fulfill({json:{kayitlar:u.searchParams.has('imlec')?[{...satir,id:'44444444-4444-4444-8444-444444444444',stokKod:'S2'}]:state.planKaydi||state.ikiSayfa?[satir]:[],sonrakiImlec:state.ikiSayfa&&!u.searchParams.has('imlec')?planId:null}});
 }
 if(p===`/stok/ihtiyac-plani/planlar/${planId}`){state.planOkumalari++;return r.fulfill({json:{...state.planKaydi,guncel:state.planGuncel,erisim}});}
 if(p===`/stok/ihtiyac-plani/giris-tarihleri/${id}`){
  if(r.request().method()==='PUT'){
   expect(state.izinliTarih).toBe(true);const g=r.request().postDataJSON();state.tarihYazilari.push(g);
   if(state.tarihHata)return r.fulfill({status:409,json:{message:'Giriş tarihi başka bir işlemde değişti'}});
   expect(g.beklenenSurum).toBe(state.tarihSurumu);expect(g.beklenenKaynakOzeti).toBe(state.kaynakKaniti);state.tarih=g.tarih;state.tarihSurumu++;
   return r.fulfill({json:{satirId:id,tarih:state.tarih,surum:state.tarihSurumu,kaynakOzeti:state.kaynakKaniti}});
  }
  return r.fulfill({json:{erisim,satirId:id,kaynakOzeti:state.kaynakKaniti,kalanMiktar:'5.000',anaBirim:'adet',tarih:state.tarih,surum:state.tarihSurumu,gecerli:true,gerekce:'Tedarikçi teyidi'}});
 }
 if(r.request().method()!=='GET'){
 expect(state.izinliYazi).toBe(true);expect(p).toBe('/satin-alma/talepler');state.yazilar.push(r.request().postDataJSON());if(r.request().postDataJSON().ihtiyacPlaniId)state.planKaydi.satinAlmaBagi={talepId:'talep-1'};return r.fulfill({status:201,json:{id:'talep-1',no:'STL-1'}});
 }
 if(p==='/auth/ben')return r.fulfill({json:{rol,adSoyad:'Depo test'}});
 if(p==='/depo')return r.fulfill({json:[{id:depo,kod:'D1',ad:'Ana depo'}]});
 const kart={id,kod:'S1',ad:'Pilot ürün',tip:'urun',anaBirim:'adet',birimler:[{ad:'kutu'}]};
 if(p==='/satin-alma/secenekler')return r.fulfill({json:{departmanlar:[],butceKalemleri:[{anahtar:'mal_alis',ad:'Mal alışları'}],stoklar:[{...kart,alisFiyati:'10'}],tedarikciler:[],onayEsigi:5000,yetkiler:{talepAcabilir:true,tumunuGorur:false,teklifYonetir:false}}});
 if(p==='/satin-alma/talepler')return r.fulfill({json:[]});
 if(p==='/satin-alma/talepler/talep-1')return r.fulfill({json:{id:'talep-1',no:'STL-1',durum:'taslak',ihtiyacTarihi:'2099-01-01',gerekce:'Stok ihtiyacı',butceAnahtari:'mal_alis',butceKalemi:'Mal alışları',etkinTutar:'20',talepEden:{id,adSoyad:'Depo test'},departman:null,onaylayan:null,siparisBelge:null,kalemler:[],teklifler:[],olaylar:[],butce:{tanimli:false,asim:0},onaylayabilecekRoller:[],yetkiler:{duzenle:true,gonder:true,geriCek:false,iptal:true,onayla:false,teklifYonet:false,siparis:false}}});
 if(p==='/stok')return r.fulfill({json:{kayitlar:[kart],sonrakiImlec:null}});
 if(p===`/stok/${id}`)return r.fulfill({json:kart});
 if(['/stok/ihtiyac-plani/onizle','/stok/ihtiyac-plani/tarihli-onizle'].includes(p)){state.sorgular.push(u);if(state.gecikme)await new Promise(ok=>setTimeout(ok,state.gecikme));if(state.hata)return r.fulfill({status:400,json:{message:'Varyantlı ürünler bu önizlemede desteklenmiyor'}});const sonuc={erisim,alindigiZaman:new Date().toISOString(),ihtiyacTarihi:u.searchParams.get('ihtiyacTarihi'),stok:{id,kod:'S1',ad:'Pilot ürün',anaBirim:'adet'},depo:{id:depo,kod:'D1',ad:'Ana depo'},girilen:{miktar:u.searchParams.get('miktar'),birim:u.searchParams.get('birim'),katsayi:'1'},hesap:{mevcut:'10.000',rezerve:'4.000',kullanilabilir:'6.000',talep:'8.000',yoldaki:'100.000',eksik:state.eksik,durum:'tedarik_gerekli'},...(p.endsWith('tarihli-onizle')?{sonucKaniti:state.sonucKaniti,tarihli:{surum:1,kaynakKaniti:state.kaynakKaniti,veriYeterli:state.veriYeterli,durum:state.tarihliEksik==='0.000'?'donem_sonu_yeterli':'tedarik_gerekli',eksik:state.tarihliEksik,donemIciEnBuyukAcik:state.erkenAcik,tarihliGiris:'1.000',ekTalep:'0.000',donemSonu:'-1.000',hareketler:[{kaynakId:id,gun:'2098-12-31',tur:'giris',miktar:'1.000',bakiye:'7.000'}],dislananlar:[]}}:{}),uyarilar:['Yoldaki miktar için doğrulanmış giriş tarihi bulunmadığından hesaba eklenmedi.']};state.sonOnizleme=sonuc;return r.fulfill({json:sonuc});}
 return r.fulfill({json:{kayitlar:[],okunmamis:0}});
 });await page.goto('/panel/stok/ihtiyac');return state;
}
async function doldur(p:Page){await p.getByLabel('Ürün',{exact:true}).selectOption(id);await p.getByLabel('Depo',{exact:true}).selectOption(depo);await p.getByLabel('İhtiyaç miktarı').fill('8');await expect(p.getByLabel('Birim',{exact:true})).toHaveValue('adet');}
test('ihtiyacı salt okunur hesaplar; alan değişince önceki sonucu kaldırır',async({page})=>{const s=await kur(page);await doldur(page);await page.getByRole('button',{name:'İhtiyacı hesapla'}).click();await expect(page.getByText('2,000 adet',{exact:true})).toBeVisible();expect(s.sorgular[0].searchParams.get('miktar')).toBe('8');await page.getByLabel('İhtiyaç miktarı').fill('9');await expect(page.getByText('2,000 adet',{exact:true})).toHaveCount(0);});
test('birim seçimini gönderir ve API hatasını görünür tutar',async({page})=>{const s=await kur(page);await doldur(page);await page.getByLabel('Birim',{exact:true}).selectOption('kutu');s.hata=true;await page.getByRole('button',{name:'İhtiyacı hesapla'}).click();await expect(page.getByText('Varyantlı ürünler bu önizlemede desteklenmiyor')).toBeVisible();expect(s.sorgular[0].searchParams.get('birim')).toBe('kutu');});
test('devam eden isteğin sonucu değişen forma yazılmaz',async({page})=>{const s=await kur(page);s.gecikme=600;await doldur(page);await page.getByRole('button',{name:'İhtiyacı hesapla'}).click();await expect.poll(()=>s.sorgular.length).toBe(1);await page.getByLabel('İhtiyaç miktarı').fill('12');await expect(page.getByRole('button',{name:'İhtiyacı hesapla'})).toBeEnabled();await expect(page.getByText('2,000 adet',{exact:true})).toHaveCount(0);});
test('mobilde form ve sonuç yatay taşmaz',async({page})=>{await page.setViewportSize({width:390,height:844});await kur(page);await doldur(page);await page.getByRole('button',{name:'İhtiyacı hesapla'}).click();await expect(page.getByText('2,000 adet',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.release-candidates/f04-ihtiyac-mobil.png',fullPage:true});});
test('yetkisiz kullanıcı hesaplama yapamaz',async({page})=>{const s=await kur(page,'salt_okunur');await expect(page.getByRole('button',{name:'İhtiyacı hesapla'})).toBeDisabled();expect(s.sorgular).toHaveLength(0);});

async function aktar(p:Page){await doldur(p);await p.getByRole('button',{name:'İhtiyacı hesapla'}).click();await p.getByRole('link',{name:'Eksik miktarla satın alma talebi hazırla'}).click();await expect(p.getByText('Yeni satın alma talebi',{exact:true})).toBeVisible();}
async function fiyatButce(p:Page){await p.getByLabel('Bütçe kalemi',{exact:true}).selectOption('mal_alis');await p.getByLabel('1. kalem tahmini birim fiyatı',{exact:true}).fill('10');}
test('stok açığı taslağa aktarılır; bütçe ve fiyat seçilmeden yazılmaz; onay kendiliğinden verilmez',async({page})=>{const s=await kur(page);await aktar(page);await expect(page.getByLabel('1. kalem miktarı',{exact:true})).toHaveValue('2.000');await expect(page.getByLabel('1. kalem miktarı',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect(page.getByText('Bütçe kalemini seçin ve tahmini birim fiyatı girin.')).toBeVisible();expect(s.yazilar).toEqual([]);await fiyatButce(page);s.izinliYazi=true;await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect(page.getByText('Talep taslak olarak kaydedildi; onaya göndermeyi unutmayın.')).toBeVisible();expect(s.yazilar).toHaveLength(1);expect(s.yazilar[0]).toMatchObject({butceAnahtari:'mal_alis',kalemler:[{stokId:id,miktar:'2.000',tahminiBirimFiyat:'10'}]});await expect(page).toHaveURL(/talep=talep-1/);await page.reload();await expect(page.getByText('Yeni satın alma talebi',{exact:true})).toHaveCount(0);expect(s.yazilar).toHaveLength(1);});
test('stok değişince kayıt engellenir; kullanıcı yenileyip yeni eksik miktarı kontrol eder',async({page})=>{const s=await kur(page);await aktar(page);await fiyatButce(page);s.eksik='3.000';await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect(page.getByText(/Stok ihtiyacı değişti/)).toBeVisible();expect(s.yazilar).toEqual([]);await page.getByRole('button',{name:'İhtiyacı yeniden yükle',exact:true}).click();await expect(page.getByLabel('1. kalem miktarı',{exact:true})).toHaveValue('3.000');await expect(page.getByLabel('1. kalem tahmini birim fiyatı',{exact:true})).toHaveValue('10');});
test('kapanmış açık yeni talep oluşturmaz',async({page})=>{const s=await kur(page);await aktar(page);await fiyatButce(page);s.eksik='0.000';await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect(page.getByText(/Stok ihtiyacı değişti/)).toBeVisible();await page.getByRole('button',{name:'İhtiyacı yeniden yükle',exact:true}).click();await expect(page.getByText('Bu ihtiyaç için satın alma açığı bulunmuyor.')).toBeVisible();expect(s.yazilar).toEqual([]);});
test('vazgeçme bağlantı girdilerini temizler ve normal talep formunu serbest bırakır',async({page})=>{await page.setViewportSize({width:390,height:844});await kur(page);await aktar(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Vazgeç',exact:true}).click();await expect(page).not.toHaveURL(/kaynak=stok-ihtiyac/);await page.getByRole('button',{name:'Yeni talep',exact:true}).click();await expect(page.getByLabel('1. kalem miktarı',{exact:true})).toBeEnabled();});

test('tarihli açık aktarılır; yalnız teyit revizyonu değişse de kayıt engellenir',async({page})=>{
 const s=await kur(page);await page.getByLabel('Hesap kapsamı').selectOption('tarihli');await aktar(page);
 await expect(page).toHaveURL(/hesapTuru=tarihli/);await expect(page.getByLabel('1. kalem miktarı',{exact:true})).toHaveValue('1.000');await fiyatButce(page);
 s.kaynakKaniti='b'.repeat(64);await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect(page.getByText(/Stok ihtiyacı değişti/)).toBeVisible();expect(s.yazilar).toHaveLength(0);
 await page.getByRole('button',{name:'İhtiyacı yeniden yükle',exact:true}).click();s.izinliYazi=true;await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect(page).toHaveURL(/talep=talep-1/);expect(s.yazilar[0].kalemler[0].miktar).toBe('1.000');await expect(page).not.toHaveURL(/hesapTuru/);
});
test('erken stok açığı hedef güne talep olarak taşınmaz',async({page})=>{
 const s=await kur(page);s.erkenAcik='3.000';await doldur(page);await page.getByLabel('Hesap kapsamı').selectOption('tarihli');await page.getByRole('button',{name:'İhtiyacı hesapla'}).click();
 await expect(page.getByText(/Dönem içinde daha erken stok açığı var/)).toBeVisible();await expect(page.getByRole('link',{name:'Eksik miktarla satın alma talebi hazırla'})).toHaveCount(0);
});
test('muhasebe tarihi gerekçeyle doğrular ve kaldırır; eski sürümde yeniden yükleme gerekir',async({page})=>{
 const s=await kur(page,'muhasebe');await page.goto(`/panel/stok/giris-tarihleri?satirId=${id}`);
 await expect(page.getByText(/Teslim edilmemiş kalan: 5.000 adet/)).toBeVisible();await page.getByLabel('Beklenen depo giriş günü').fill('2098-12-30');await page.getByLabel('Doğrulama veya kaldırma gerekçesi').fill('Yeni tedarikçi teyidi');s.izinliTarih=true;
 await page.getByRole('button',{name:'Giriş tarihini doğrula',exact:true}).click();await expect(page.getByText('Beklenen depo giriş tarihi doğrulandı.',{exact:true})).toBeVisible();expect(s.tarihYazilari[0].tarih).toBe('2098-12-30');
 await page.getByLabel('Doğrulama veya kaldırma gerekçesi').fill('Tedarikçi tarihini geri çekti');s.tarihHata=true;await page.getByRole('button',{name:'Doğrulamayı kaldır',exact:true}).click();await expect(page.getByText(/Giriş tarihi başka bir işlemde değişti/)).toBeVisible();await expect(page.getByRole('button',{name:'Giriş tarihini doğrula',exact:true})).toBeDisabled();
 s.tarihHata=false;await page.getByRole('button',{name:'Satırı yeniden yükle',exact:true}).click();await page.getByLabel('Doğrulama veya kaldırma gerekçesi').fill('Tedarikçi tarihini geri çekti');await page.getByRole('button',{name:'Doğrulamayı kaldır',exact:true}).click();await expect(page.getByText('Giriş tarihi doğrulaması kaldırıldı.',{exact:true})).toBeVisible();expect(s.tarih).toBeNull();
});
test('depo rolü giriş tarihini mobilde salt okunur inceler',async({page})=>{
 await page.setViewportSize({width:390,height:844});const s=await kur(page);await page.goto(`/panel/stok/giris-tarihleri?satirId=${id}`);await expect(page.getByText(/Depo rolü tarihleri okuyabilir/)).toBeVisible();await expect(page.getByRole('button',{name:'Giriş tarihini doğrula',exact:true})).toHaveCount(0);expect(s.tarihYazilari).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('giris-tarihi-mobil.png'),fullPage:true});
});

async function tarihliHesapla(p:Page){await doldur(p);await p.getByLabel('Hesap kapsamı').selectOption('tarihli');await p.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await expect(p.getByRole('button',{name:'Planı sakla',exact:true})).toBeEnabled();}
test('plan kaydı belirsiz ağ sonucunda aynı anahtarla tekrar edilir; ziyaret satın alma oluşturmaz',async({page})=>{
 const s=await kur(page);await tarihliHesapla(page);s.izinliPlan=true;s.planHata=500;
 await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await expect(page.getByText('İşlem sonucu alınamadı',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await expect(page.getByText('İhtiyaç planı kaynak paylarıyla saklandı.',{exact:true})).toBeVisible();
 expect(s.planYazilari).toHaveLength(2);expect(s.planYazilari[0].istekAnahtari).toBe(s.planYazilari[1].istekAnahtari);expect(s.planYazilari[0].beklenenSonucKaniti).toBe(s.sonucKaniti);expect(s.yazilar).toHaveLength(0);
 await page.getByRole('link',{name:'Kayıtlı planı incele',exact:true}).click();await expect(page.getByText('Planın kaynakları güncel hesapla aynı.',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Planın kaynakları güncel hesapla aynı.',{exact:true})).toBeVisible();expect(s.planYazilari).toHaveLength(2);
});
test('eski önizleme plan yazımını kilitler; yeniden hesaplama yeni kanıt ve istek kullanır',async({page})=>{
 const s=await kur(page);await tarihliHesapla(page);s.izinliPlan=true;s.planHata=409;
 await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await expect(page.getByText('İhtiyaç kaynakları değişti; önizlemeyi yenileyin',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Planı sakla',exact:true})).toBeDisabled();
 s.planHata=0;s.sonucKaniti='d'.repeat(64);await page.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await expect(page.getByText('İhtiyaç planı kaynak paylarıyla saklandı.',{exact:true})).toBeVisible();
 expect(s.planYazilari[0].istekAnahtari).not.toBe(s.planYazilari[1].istekAnahtari);expect(s.planYazilari[1].beklenenSonucKaniti).toBe('d'.repeat(64));
});
test('belirsiz üretim ihtiyacında plan saklama devre dışıdır',async({page})=>{
 const s=await kur(page);s.veriYeterli=false;await doldur(page);await page.getByLabel('Hesap kapsamı').selectOption('tarihli');await page.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await expect(page.getByRole('button',{name:'Planı sakla',exact:true})).toBeDisabled();expect(s.planYazilari).toHaveLength(0);
});
test('depo rolü üretim ihtiyacına açık depo ve gün atar; başlangıç değerleri tahmin edilmez',async({page})=>{
 await page.setViewportSize({width:390,height:844});const s=await kur(page);await page.goto(`/panel/stok/uretim-talepleri?kalemId=${id}`);
 await expect(page.getByText(/Rezerv dışı kalan: 3,000 kg/)).toBeVisible();await expect(page.getByLabel('Hammadde deposu',{exact:true})).toHaveValue('');await expect(page.getByLabel('Malzeme ihtiyaç günü',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Depo ve günü ata',exact:true}).click();await expect(page.getByText(/Hammadde deposunu, ihtiyaç gününü/)).toBeVisible();expect(s.uretimYazilari).toHaveLength(0);
 await page.getByLabel('Hammadde deposu',{exact:true}).selectOption(depo);await page.getByLabel('Malzeme ihtiyaç günü',{exact:true}).fill('2098-12-30');await page.getByLabel('Atama veya kaldırma gerekçesi',{exact:true}).fill('Malzeme planı depo teyidi');s.izinliUretim=true;
 await page.getByRole('button',{name:'Depo ve günü ata',exact:true}).click();await expect(page.getByText('Rezerv dışı üretim ihtiyacının deposu ve günü atandı.',{exact:true})).toBeVisible();expect(s.uretimYazilari[0]).toMatchObject({depoId:depo,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:s.kaynakKaniti});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('uretim-atama-mobil.png'),fullPage:true});
});
test('üretim ataması çakışmada yeniden yüklenir; kaldırma ihtiyacı yok saymaz',async({page})=>{
 const s=await kur(page);await page.goto(`/panel/stok/uretim-talepleri?kalemId=${id}`);await page.getByLabel('Hammadde deposu',{exact:true}).selectOption(depo);await page.getByLabel('Malzeme ihtiyaç günü',{exact:true}).fill('2098-12-30');await page.getByLabel('Atama veya kaldırma gerekçesi',{exact:true}).fill('Malzeme planı depo teyidi');s.izinliUretim=true;s.uretimHata=true;
 await page.getByRole('button',{name:'Depo ve günü ata',exact:true}).click();await expect(page.getByText(/Üretim ihtiyaç ataması değişti/)).toBeVisible();await expect(page.getByRole('button',{name:'Depo ve günü ata',exact:true})).toBeDisabled();
 s.uretimHata=false;await page.getByRole('button',{name:'Kalemi yeniden yükle',exact:true}).click();await page.getByLabel('Hammadde deposu',{exact:true}).selectOption(depo);await page.getByLabel('Malzeme ihtiyaç günü',{exact:true}).fill('2098-12-30');await page.getByLabel('Atama veya kaldırma gerekçesi',{exact:true}).fill('Güncel malzeme planı teyidi');await page.getByRole('button',{name:'Depo ve günü ata',exact:true}).click();await expect(page.getByText('Rezerv dışı üretim ihtiyacının deposu ve günü atandı.',{exact:true})).toBeVisible();
 await page.getByLabel('Atama veya kaldırma gerekçesi',{exact:true}).fill('Atama yeniden planlanacak');await page.getByRole('button',{name:'Atamayı kaldır',exact:true}).click();await expect(page.getByText('Atama kaldırıldı; rezerv dışı ihtiyaç tekrar belirsiz olarak izlenir.',{exact:true})).toBeVisible();expect(s.uretimAtama.aktif).toBe(false);
});
test('plan listesi sayfalanır; eski detaydan yeniden hesaplama girdileri açılır ve kayıt yazılmaz',async({page})=>{
 const s=await kur(page);await tarihliHesapla(page);s.izinliPlan=true;await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await expect(page.getByText('İhtiyaç planı kaynak paylarıyla saklandı.',{exact:true})).toBeVisible();
 s.planGuncel=false;s.ikiSayfa=true;await page.getByRole('link',{name:'Kayıtlı planı incele',exact:true}).click();await expect(page.getByText(/Planın kaynakları veya ihtiyaç günü değişmiş/)).toBeVisible();await page.getByRole('button',{name:'Daha fazla plan göster',exact:true}).click();await expect(page.getByRole('link',{name:/S2 · Pilot ürün/})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('kayitli-plan-mobil.png'),fullPage:true});
 const once=s.sorgular.length;await page.getByRole('link',{name:'Girdilerle yeniden hesapla',exact:true}).click();await expect(page.getByLabel('İhtiyaç miktarı',{exact:true})).toHaveValue('8');await expect(page.getByLabel('Hesap kapsamı',{exact:true})).toHaveValue('tarihli');expect(s.sorgular).toHaveLength(once);expect(s.planYazilari).toHaveLength(1);
});
test('yetkisiz kullanıcı üretim atama ve plan verisini okuyamaz',async({page})=>{
 const s=await kur(page,'salt_okunur');await page.goto(`/panel/stok/uretim-talepleri?kalemId=${id}`);await expect(page.getByText('Bu ekran için yetkiniz yok.',{exact:true})).toBeVisible();expect(s.uretimOkumalari).toBe(0);
 await page.goto('/panel/stok/ihtiyac-planlari');await expect(page.getByText('Bu ekran için yetkiniz yok.',{exact:true})).toBeVisible();expect(s.planOkumalari).toBe(0);expect(s.planYazilari).toHaveLength(0);
});
test('ana rol koruması satış kullanıcısını yeni stok ekranlarından önce durdurur',async({page})=>{
 const s=await kur(page,'satis');
 for(const yol of [`/panel/stok/uretim-talepleri?kalemId=${id}`,'/panel/stok/ihtiyac-planlari']){await page.goto(yol);await expect(page.getByRole('heading',{name:'Bu sayfaya erişim yetkiniz yok',exact:true})).toBeVisible();}
 expect(s.uretimOkumalari).toBe(0);expect(s.planOkumalari).toBe(0);expect(s.planYazilari).toHaveLength(0);
});

test('kayıtlı plan satın alma taslağına bağlanır; tekrar açılış bağlı talebi gösterir',async({page})=>{
 const s=await kur(page);await tarihliHesapla(page);s.izinliPlan=true;await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await page.getByRole('link',{name:'Kayıtlı planı incele',exact:true}).click();await page.getByRole('link',{name:'Bu plandan satın alma taslağı hazırla',exact:true}).click();
 await expect(page.getByLabel('1. kalem miktarı',{exact:true})).toHaveValue('1.000');await fiyatButce(page);s.izinliYazi=true;await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();await expect.poll(()=>s.yazilar.length).toBe(1);expect(s.yazilar[0].ihtiyacPlaniId).toBe(planId);expect(s.planYazilari).toHaveLength(1);
 await page.goto(`/panel/stok/ihtiyac-planlari?plan=${planId}`);await expect(page.getByRole('link',{name:'Bağlı talebi incele',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Bu plandan satın alma taslağı hazırla',exact:true})).toHaveCount(0);
 await page.goto(`/panel/satin-alma/talepler?ihtiyacPlani=${planId}`);await expect(page.getByRole('button',{name:'Taslak kaydet',exact:true})).toHaveCount(0);expect(s.yazilar).toHaveLength(1);
});
test('eski plan doğrudan bağlantıyla da satın alma formu açamaz',async({page})=>{
 const s=await kur(page);await tarihliHesapla(page);s.izinliPlan=true;await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await page.getByRole('link',{name:'Kayıtlı planı incele',exact:true}).click();s.planGuncel=false;
 await page.goto(`/panel/satin-alma/talepler?ihtiyacPlani=${planId}`);await expect(page.getByText('İhtiyaç planı güncel değil; yeniden hesaplayın.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Taslak kaydet',exact:true})).toHaveCount(0);expect(s.yazilar).toHaveLength(0);
});
test('salt okunur şirket hesabı ve geçmişi gösterir; plan ve kaynak yazma kontrollerini kapatır',async({page})=>{
 const s=await kur(page,'yonetici');await tarihliHesapla(page);s.izinliPlan=true;await page.getByRole('button',{name:'Planı sakla',exact:true}).click();s.mod='salt_okunur';await page.getByRole('link',{name:'Kayıtlı planı incele',exact:true}).click();await expect(page.getByText('Şirket modu salt okunur; bu plandan yeni taslak oluşturulamaz.',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Bu plandan satın alma taslağı hazırla',exact:true})).toHaveCount(0);
 await page.goto('/panel/stok/ihtiyac');await doldur(page);await page.getByLabel('Hesap kapsamı').selectOption('tarihli');await page.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await expect(page.getByRole('button',{name:'Planı sakla',exact:true})).toBeDisabled();await expect(page.getByRole('link',{name:'Eksik miktarla satın alma talebi hazırla',exact:true})).toHaveCount(0);
 await page.goto(`/panel/stok/uretim-talepleri?kalemId=${id}`);await expect(page.getByLabel('Hammadde deposu',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Depo ve günü ata',exact:true})).toBeDisabled();
 await page.goto(`/panel/stok/giris-tarihleri?satirId=${id}`);await expect(page.getByText('Şirket modu salt okunur; giriş tarihi değiştirilemez.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Giriş tarihini doğrula',exact:true})).toHaveCount(0);expect(s.uretimYazilari).toHaveLength(0);expect(s.tarihYazilari).toHaveLength(0);expect(s.planYazilari).toHaveLength(1);
});
test('kapalı şirket anlık hesap yapar; tarihli hesap ve geçmiş için kapalı mesajı gösterir',async({page})=>{
 const s=await kur(page);s.mod='kapali';await doldur(page);await page.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await expect(page.getByText('2,000 adet',{exact:true})).toBeVisible();await page.getByLabel('Hesap kapsamı').selectOption('tarihli');await page.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await expect(page.getByText('Tarihli stok ihtiyacı bu şirket için kapalı.',{exact:true})).toBeVisible();await page.goto('/panel/stok/ihtiyac-planlari');await expect(page.getByText('Tarihli stok ihtiyacı bu şirket için kapalı.',{exact:true})).toBeVisible();expect(s.planYazilari).toHaveLength(0);
});
test('plan ekrandayken şirket kapanırsa eski yazma düğmesiyle kayıt yapılamaz',async({page})=>{
 const s=await kur(page);await tarihliHesapla(page);s.mod='kapali';await page.getByRole('button',{name:'Planı sakla',exact:true}).click();await expect(page.getByText('Tarihli stok ihtiyacı bu şirket için kapalı.',{exact:true})).toBeVisible();expect(s.planYazilari).toHaveLength(0);
});
