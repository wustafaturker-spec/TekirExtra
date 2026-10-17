import { expect,test,type Page } from "@playwright/test";
const f="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222",linkId="33333333-3333-4333-8333-333333333333",date="2026-10-17T10:00:00.000Z";
async function kur(page:Page,mod="pilot",conflict=false) {
 const state={baglar:[] as any[],yazilar:[] as {path:string;body:any}[],mod,rol:"satis",payHatasi:false,dagitim:null as any,olusturmaHatasi:false,ticariSonuc:[] as any[],zincir:{belgeler:[] as any[],faturalar:[] as any[]}};
 const doc={id:b,no:"TEK-001",durum:"onaylandi",dovizCinsi:"USD",genelToplam:"1200.25",updatedAt:date,revizyonNo:1};
 const cariId="77777777-7777-4777-8777-777777777777",stokId="88888888-8888-4888-8888-888888888888";
 const firsat={id:f,cariId,baslik:"Makine satış fırsatı",updatedAt:date};
 page.on("pageerror",e=>{throw e;});await page.addInitScript(()=>sessionStorage.setItem("tekir_access","fixture-token"));
 await page.route("**/api/v1/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.replace("/api/v1","");
  if(req.method()!=="GET") {
   const body=req.postDataJSON();state.yazilar.push({path,body});
   if(path.endsWith('/kapama-paylari')){
    expect(body).toMatchObject({kanitOzeti:'a'.repeat(64),kaynakOzeti:'b'.repeat(64),beklenenSurum:0});
    if(state.payHatasi)return route.fulfill({status:409,json:{message:'Fatura, kaynak veya dağıtım değişti; dağıtımı yenileyin'}});
    state.dagitim.dagitilanToplam=body.tutar;state.dagitim.kapamalar[0]={...state.dagitim.kapamalar[0],pay:body.tutar,surum:1};
    state.dagitim.gecmis=[{id:linkId,kapamaId:body.kapamaId,surum:1,tutar:body.tutar,gerekce:body.gerekce,createdAt:date,gecerli:true}];return route.fulfill({status:201,json:{id:linkId,surum:1}});
   }
   if(path===`/crm/firsatlar/${f}/belgeler/teklif`){
    expect(body.belge).toMatchObject({tur:"teklif",yon:"satis",cariId});expect(body).not.toHaveProperty("tenantId");
    if(state.olusturmaHatasi)return route.fulfill({status:409,json:{message:"Fırsat değişti; fırsatı yenileyin"}});
    state.baglar=[{id:linkId,belgeId:b,surum:1,gerekce:body.gerekce,cozulduAt:null,cozmeGerekcesi:null,belge:{...doc,durum:"taslak"}}];return route.fulfill({status:201,json:{id:b,bagId:linkId,surum:1,cozulduAt:null}});
   }
   if(path.endsWith('/kapama-paylari'))return route.fulfill({json:state.dagitim});
  if(path===`/crm/firsatlar/${f}/belgeler`){expect(body).toMatchObject({belgeId:b,beklenenFirsatZamani:date,beklenenBelgeZamani:date});expect(body).not.toHaveProperty("tenantId");expect(body.istekAnahtari).toMatch(/^[a-f0-9-]{36}$/);if(conflict)return route.fulfill({status:409,json:{message:"Teklif değişti; listeyi yenileyin"}});state.baglar=[{id:linkId,belgeId:b,surum:1,gerekce:body.gerekce,cozulduAt:null,cozmeGerekcesi:null,belge:doc}];return route.fulfill({status:201,json:{id:linkId,surum:1,cozulduAt:null}});}
   expect(path).toBe(`/crm/firsatlar/${f}/belgeler/${linkId}/coz`);expect(body.beklenenSurum).toBe(1);state.baglar[0]={...state.baglar[0],surum:2,cozulduAt:date,cozmeGerekcesi:body.gerekce};return route.fulfill({status:201,json:{id:linkId,surum:2,cozulduAt:date}});
  }
  if(path.endsWith('/kapama-paylari'))return route.fulfill({json:state.dagitim});
  if(path===`/crm/firsatlar/${f}/belgeler`)return route.fulfill({json:{mod:state.mod,firsat,baglar:state.baglar,zincir:state.zincir,ticariSonuc:state.ticariSonuc}});
  if(path===`/crm/firsatlar/${f}/belgeler/adaylar`)return route.fulfill({json:{firsat,kayitlar:[doc,{...doc,id:"44444444-4444-4444-8444-444444444444",no:"TEK-BAGLI",bagli:true}],sonrakiImlec:null}});
  if(path==="/auth/ben")return route.fulfill({json:{rol:state.rol,userId:linkId,tenantId:f}});
  if(path==="/belgeler")return route.fulfill({json:{kayitlar:[],sonrakiImlec:null}});
  if(path==="/cari")return route.fulfill({json:{kayitlar:[{id:cariId,kod:"C1",unvan:"Fırsat müşterisi",aktif:true}],sonrakiImlec:null}});
  if(path==="/stok")return route.fulfill({json:{kayitlar:[{id:stokId,kod:"H1",ad:"Pilot hizmet",tip:"hizmet",anaBirim:"adet",kdvOrani:"20",satisFiyati:"500",aktif:true,birimler:[],varyantlar:[]}],sonrakiImlec:null}});
  if(path===`/stok/${stokId}`)return route.fulfill({json:{varyantlar:[]}});
  if(path===`/stok/${stokId}/tavsiye-fiyat`)return route.fulfill({json:{birimFiyat:500,kaynakFiyat:500,kaynakDoviz:"TRY",belgeDovizi:"TRY",belgeKuru:1,urunKuru:1,cevrilebilir:true,iskontoOrani:0,kdvOrani:20,fiyatKaynagi:"kart"}});
  if(path==="/mevzuat/kod-tablosu")return route.fulfill({status:503,json:{message:"Fixture varsayılan kod listesi"}});
  if(path==="/ebelge/uygulamalar")return route.fulfill({json:{efatura:{acik:false},earsiv:{acik:false},eirsaliye:{acik:false}}});
  return route.fulfill({json:path==="/bildirimler/ozet"?{okunmamis:0,acik:0,kritik:0}:[]});
 });
 await page.goto(`/panel/crm/${f}`);await expect(page.getByText(firsat.baslik,{exact:true})).toBeVisible();return state;
}
async function doldur(page:Page){await page.getByRole("button",{name:"Mevcut teklif bağla",exact:true}).click();const form=page.getByRole("region",{name:"Teklif bağlama",exact:true});await expect(form.getByRole("option",{name:/TEK-BAGLI/})).toHaveAttribute("disabled","");await form.getByLabel("Satış teklifi",{exact:true}).selectOption(b);await form.getByLabel("Bağlama gerekçesi",{exact:true}).fill("Müşterinin makine talebi");return form;}
test("mevcut teklif bağlanır; doğru kaynak açılır ve çözülmüş bağ geçmişte kalır",async({page})=>{const state=await kur(page);await doldur(page);await page.getByRole("button",{name:"Teklifi bağla",exact:true}).click();const link=page.getByRole("link",{name:"TEK-001",exact:true});await expect(link).toHaveAttribute("href",`/panel/belgeler?tur=teklif&yon=satis&odak=${b}`);await page.reload();await expect(link).toBeVisible();await page.getByRole("button",{name:"Bağı çöz",exact:true}).click();await page.getByLabel("Çözme gerekçesi",{exact:true}).fill("Farklı satış dosyasına ait");await page.getByRole("button",{name:"Bağı çözmeyi onayla",exact:true}).click();await expect(page.getByText("Bağ çözüldü: Farklı satış dosyasına ait",{exact:true})).toBeVisible();await expect(link).toBeVisible();expect(state.yazilar).toHaveLength(2);if(process.env.F03_SCREENSHOT_DIR)await page.screenshot({path:process.env.F03_SCREENSHOT_DIR+"/crm-teklif-masaustu.png",fullPage:true});});
test("çatışma hata mesajını ve gerekçe taslağını korur; tekrar aynı anahtarı kullanır",async({page})=>{const state=await kur(page,"pilot",true);const form=await doldur(page);await page.getByRole("button",{name:"Teklifi bağla",exact:true}).click();await expect(page.getByText("Teklif değişti; listeyi yenileyin",{exact:true})).toBeVisible();await expect(form.getByLabel("Bağlama gerekçesi",{exact:true})).toHaveValue("Müşterinin makine talebi");await page.getByRole("button",{name:"Teklifi bağla",exact:true}).click();await expect.poll(()=>state.yazilar.length).toBe(2);expect(state.yazilar[0].body.istekAnahtari).toBe(state.yazilar[1].body.istekAnahtari);});
test("salt okunur modda yazma eylemleri görünmez; mobil sayfa yatay taşmaz",async({page})=>{await page.setViewportSize({width:390,height:844});const state=await kur(page,"salt_okunur");await expect(page.getByText("Bu görünüm salt okunur.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Mevcut teklif bağla",exact:true})).toHaveCount(0);expect(state.yazilar).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(process.env.F03_SCREENSHOT_DIR)await page.screenshot({path:process.env.F03_SCREENSHOT_DIR+"/crm-teklif-mobil.png",fullPage:true});});
test("belge zincirinin kaynakları açılır; ortak fatura uyarısı salt okunur mobilde görünür",async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await kur(page,"salt_okunur");
 const order="55555555-5555-4555-8555-555555555555",invoice="66666666-6666-4666-8666-666666666666";
 state.zincir={belgeler:[{id:order,no:"SIP-001",tur:"siparis",durum:"kapandi",kaynakBelgeId:b,faturaId:invoice}],faturalar:[{id:invoice,no:"FAT-ORTAK",durum:"taslak",kaynakBelgeIds:[order],ortakKaynak:true}]};
 await page.getByRole("button",{name:"Bağları yenile",exact:true}).click();const region=page.getByRole("region",{name:"Bağlantılı satış belgeleri",exact:true});
 await expect(region.getByRole("link",{name:"SIP-001",exact:true})).toHaveAttribute("href",`/panel/belgeler?tur=siparis&yon=satis&odak=${order}`);
 await expect(region.getByRole("link",{name:"FAT-ORTAK",exact:true})).toHaveAttribute("href",`/panel/fatura?yon=satis&faturaId=${invoice}`);
 await expect(region.getByText("· Bu fırsat dışındaki belgeleri de içerir",{exact:true})).toBeVisible();
 expect(state.yazilar).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(process.env.F03_SCREENSHOT_DIR)await page.screenshot({path:process.env.F03_SCREENSHOT_DIR+"/crm-belge-zinciri-mobil.png",fullPage:true});
});
async function teklifFormu(page:Page) {
 await page.getByRole("link",{name:"Yeni teklif oluştur",exact:true}).click();
 await page.waitForURL(new RegExp(`/panel/belgeler/yeni\\?.*firsatId=${f}`),{timeout:45000});
 await expect(page.getByLabel("Fırsat müşterisi",{exact:true})).toHaveValue("Fırsat müşterisi");
 await expect(page.getByLabel("Fırsat müşterisi",{exact:true})).toHaveAttribute("readonly","");
 await expect(page.getByLabel("Belge Türü",{exact:true})).toBeDisabled();
 await expect(page.locator(".document-editor").getByLabel("Yön",{exact:true})).toBeDisabled();
 await page.getByLabel("Fırsat bağlama gerekçesi",{exact:true}).fill("Fırsatın müşteri talebi");
 const secici=page.getByRole("combobox",{name:"1. satır ürün veya hizmet seçimi",exact:true});
 await secici.fill("Pilot");await page.getByRole("option",{name:/Pilot hizmet/}).click();
 const modal=page.getByRole("dialog",{name:"Ürün veya hizmet ekle",exact:true});await expect(modal).toBeVisible();
 await expect(modal.getByText("Birim fiyat",{exact:true}).locator("..").getByRole("spinbutton")).toHaveValue("500");
 await modal.getByRole("button",{name:"+ Ekle",exact:true}).click();
 await expect(modal).toHaveCount(0);
}
test("fırsattan mevcut teklif formu açılır; tek birleşik istek sonrası fırsata döner",async({page})=>{
 const state=await kur(page);await teklifFormu(page);
 if(process.env.F03_SCREENSHOT_DIR)await page.screenshot({path:process.env.F03_SCREENSHOT_DIR+"/firsattan-teklif-formu.png",fullPage:true});
 await page.getByRole("button",{name:"Taslak belgeyi kaydet",exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/panel/crm/${f}$`));await expect(page.getByRole("link",{name:"TEK-001",exact:true})).toBeVisible();
 expect(state.yazilar).toHaveLength(1);expect(state.yazilar[0].path).toBe(`/crm/firsatlar/${f}/belgeler/teklif`);expect(state.yazilar[0].body.belge.satirlar[0]).toMatchObject({birimFiyat:"500"});
});
test("oluşturma çatışmasında form korunur; aynı içerik aynı istek anahtarıyla yinelenir",async({page})=>{
 const state=await kur(page);state.olusturmaHatasi=true;await teklifFormu(page);
 const kaydet=page.getByRole("button",{name:"Taslak belgeyi kaydet",exact:true});await kaydet.click();
 await expect(page.getByText("Fırsat değişti; fırsatı yenileyin",{exact:true})).toBeVisible();
 await expect(page.getByLabel("Fırsat bağlama gerekçesi",{exact:true})).toHaveValue("Fırsatın müşteri talebi");
 await kaydet.click();await expect.poll(()=>state.yazilar.length).toBe(2);expect(state.yazilar[0].body.istekAnahtari).toBe(state.yazilar[1].body.istekAnahtari);
});
test("fatura payı ve kapama ayrı gösterilir; karma ve eski faturada belirsizlik sıfıra çevrilmez",async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await kur(page,"salt_okunur");
 const belirsiz={durum:"dagitilamadi",kasaBanka:null,iade:null,diger:null,kalan:null};
 state.ticariSonuc=[{id:"55555555-5555-4555-8555-555555555555",no:"FAT-KARMA",durum:"kesin",dovizCinsi:"USD",faturaPayi:"100.10",payKapsami:"kismi",kapama:belirsiz},
 {id:"66666666-6666-4666-8666-666666666666",no:"FAT-TAM",durum:"kesin",dovizCinsi:"TRY",faturaPayi:"501.05",payKapsami:"tam",kapama:{durum:"tam",kasaBanka:"30.02",iade:"20.05",diger:"0.00",kalan:"450.98"}},
 {id:"99999999-9999-4999-8999-999999999999",no:"FAT-ESKI",durum:"kesin",dovizCinsi:"TRY",faturaPayi:null,payKapsami:"dagitilamadi",kapama:belirsiz}];
 await page.getByRole("button",{name:"Bağları yenile",exact:true}).click();const region=page.getByRole("region",{name:"Fırsatın fatura payları",exact:true});
 await expect(region.getByText("100.10 USD",{exact:true})).toBeVisible();await expect(region.getByText(/Yalnız doğrulanan satırlar/)).toBeVisible();
 await expect(region.getByText("İade ile kapama",{exact:true})).toBeVisible();await expect(region.getByText("20.05 TRY",{exact:true})).toBeVisible();
 await expect(region.getByText("450.98 TRY",{exact:true})).toBeVisible();await expect(region.getByText(/Fatura payı dağıtılamadı/)).toBeVisible();
 await expect(region.getByText(/Kapama payları dağıtılamadı/)).toHaveCount(2);expect(state.yazilar).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(process.env.F03_SCREENSHOT_DIR)await region.screenshot({path:process.env.F03_SCREENSHOT_DIR+"/fatura-paylari-mobil.png"});
});
async function dagitimKur(page:Page,rol='muhasebe'){
 const state=await kur(page);state.rol=rol;const invoice='66666666-6666-4666-8666-666666666666',cap='44444444-4444-4444-8444-444444444444';
 state.ticariSonuc=[{id:invoice,no:'FAT-DAGITIM',durum:'kesin',dovizCinsi:'TRY',faturaPayi:'100.10',payKapsami:'kismi',kapama:{durum:'dagitilamadi',kasaBanka:null,iade:null,diger:null,kalan:null}}];
 state.dagitim={mod:'pilot',fatura:{id:invoice,no:'FAT-DAGITIM',dovizCinsi:'TRY'},kanitOzeti:'a'.repeat(64),faturaPayi:'100.10',dagitilanToplam:'0.00',kapamalar:[{id:cap,tur:'kasa_banka',tutar:'50.00',kaynakOzeti:'b'.repeat(64),gecerli:true,surum:0,pay:null,azamiTutar:'50.00',gecersizEskiPay:false}],gecmis:[]};
 await page.getByRole('button',{name:'Bağları yenile',exact:true}).click();await page.getByRole('button',{name:'Kapama dağıtımını aç',exact:true}).click();
 const region=page.getByRole('region',{name:'Açık kapama dağıtımı',exact:true});await expect(region.getByText('0.00 TRY',{exact:true})).toBeVisible();return {state,region,cap};
}
test('muhasebe karma kapama payını kaydeder; sürüm ve gerekçe geçmişte kalır',async({page})=>{
 const {state,region,cap}=await dagitimKur(page);await region.getByLabel('Dağıtılacak kapama',{exact:true}).selectOption(cap);
 await region.getByLabel('Fırsatın kapama payı',{exact:true}).fill('20,05');await region.getByLabel('Dağıtım gerekçesi',{exact:true}).fill('Müşterinin ödeme dökümü');
 await region.getByRole('button',{name:'Kapama payını kaydet',exact:true}).click();await expect(region.getByText('20.05 TRY',{exact:true})).toBeVisible();
 await region.getByText('Dağıtım geçmişi',{exact:true}).click();await expect(region.getByText(/Müşterinin ödeme dökümü/)).toBeVisible();expect(state.yazilar).toHaveLength(1);
 expect(state.yazilar[0].body).toMatchObject({tutar:'20.05',kapamaId:cap,beklenenSurum:0});expect(state.yazilar[0].body).not.toHaveProperty('tenantId');
});
test('dağıtım çatışması taslağı korur; değişmeyen istek anahtarıyla yinelenir',async({page})=>{
 const {state,region,cap}=await dagitimKur(page);state.payHatasi=true;await region.getByLabel('Dağıtılacak kapama',{exact:true}).selectOption(cap);
 await region.getByLabel('Fırsatın kapama payı',{exact:true}).fill('25');await region.getByLabel('Dağıtım gerekçesi',{exact:true}).fill('Ödeme referansı');
 const button=region.getByRole('button',{name:'Kapama payını kaydet',exact:true});await button.click();await expect(region.getByText('Fatura, kaynak veya dağıtım değişti; dağıtımı yenileyin',{exact:true})).toBeVisible();
 await expect(region.getByLabel('Fırsatın kapama payı',{exact:true})).toHaveValue('25');await button.click();await expect.poll(()=>state.yazilar.length).toBe(2);expect(state.yazilar[0].body.istekAnahtari).toBe(state.yazilar[1].body.istekAnahtari);
});
test('satış dağıtımı mobilde salt okur; geçersiz kaynak ve geçmiş görünür',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {state,region}=await dagitimKur(page,'satis');
 state.dagitim.kapamalar[0].gecersizEskiPay=true;state.dagitim.gecmis=[{id:linkId,kapamaId:b,surum:1,tutar:'10.00',gerekce:'Önceki dağıtım',createdAt:date,gecerli:false}];
 await region.getByRole('button',{name:'Dağıtımı yenile',exact:true}).click();await expect(region.getByText(/Önceki payın kaynağı değişti/)).toBeVisible();
 await expect(region.getByRole('button',{name:'Kapama payını kaydet',exact:true})).toHaveCount(0);await region.getByText('Dağıtım geçmişi',{exact:true}).click();await expect(region.getByText(/Geçmiş \/ geçersiz kaynak/)).toBeVisible();
 expect(state.yazilar).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(process.env.F03_SCREENSHOT_DIR)await region.screenshot({path:process.env.F03_SCREENSHOT_DIR+'/acik-kapama-mobil.png'});
});
