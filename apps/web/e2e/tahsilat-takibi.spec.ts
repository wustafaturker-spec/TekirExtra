import { expect, test, type Page, type Route } from "@playwright/test";
const c="11111111-1111-4111-8111-111111111111", u="22222222-2222-4222-8222-222222222222", id="33333333-3333-4333-8333-333333333333";
const tarih="2026-10-15", zaman="2026-10-15T12:00:00Z";
const takip=()=>({id,cari:{id:c,unvan:"Takip müşterisi"},sorumlu:{id:u,adSoyad:"Muhasebe Sorumlusu",aktif:true},konu:"Vadesi geçen alacak",neden:"tahsilat",durum:"acik",sonrakiIslemTarihi:tarih as string|null,sonrakiIslem:"Telefonla ara" as string|null,sonIslemGerekcesi:null,surum:1,createdAt:zaman,updatedAt:zaman});
type State={mod:string;kayitlar:ReturnType<typeof takip>[];notlar:any[];yazilar:{method:string;yol:string;body:any}[];okumalar:number};
const cari={id:c,kod:"C001",unvan:"Takip müşterisi",tip:"musteri",aktif:true,sektor:null,vknTckn:null,eposta:null,telefon:null,karaListe:false,bakiyeler:[],kisiTipi:"tuzel",vergiDairesi:null,adresler:[],kisiler:[],bankaHesaplari:[],etiketler:[],grup:null,risk:{cekSenetRiski:"0",mevcutRisk:"0",limit:null,kalanLimit:null,asim:false},finansalOzet:{sonIslemTarihi:null,sonTahsilatTarihi:null,sonOdemeTarihi:null,vadesiGecmisBakiye:"0"}};
async function kur(page:Page,rol="muhasebe",ozel?:(r:Route,url:URL,s:State)=>Promise<boolean>){
 const s:State={mod:"pilot",kayitlar:[takip()],notlar:[],yazilar:[],okumalar:0};page.on("pageerror",e=>{throw e;});
 await page.addInitScript(()=>sessionStorage.setItem("tekir_access","test-token"));
 await page.route("**/api/v1/**",async r=>{
  const url=new URL(r.request().url()),yol=url.pathname.replace("/api/v1","");expect(url.origin).toBe("http://127.0.0.1:3106");
  const method=r.request().method(),write=method!=="GET";
  if(write){expect(yol.startsWith("/cari/tahsilat-takipleri")).toBe(true);s.yazilar.push({method,yol,body:r.request().postDataJSON()});}
  if(yol==="/cari/tahsilat-takipleri"&&!write)s.okumalar++;
  if(ozel&&await ozel(r,url,s))return;
  if(write){
   const g=r.request().postDataJSON();
   if(yol==="/cari/tahsilat-takipleri"){const yeni={...takip(),konu:g.konu,neden:g.neden,sonrakiIslemTarihi:g.sonrakiIslemTarihi,sonrakiIslem:g.sonrakiIslem};s.kayitlar.push(yeni);await r.fulfill({json:yeni});return;}
   const k=s.kayitlar[0];k.surum++;
   if(method==="PATCH"){Object.assign(k,{durum:g.durum,neden:g.neden,sonrakiIslem:g.sonrakiIslem,sonrakiIslemTarihi:g.sonrakiIslemTarihi});}
   else s.notlar.push({id:"44444444-4444-4444-8444-444444444444",kanal:g.kanal,gorusmeTarihi:g.gorusmeTarihi,not:g.not,createdAt:zaman});
   await r.fulfill({json:k});return;
  }
  let json:unknown={};
  if(yol==="/auth/ben")json={rol,userId:u,tenantId:c};
  else if(yol==="/cari/odeme-sozleri/is-listesi")json={kayitlar:[],sonrakiImlec:null};
  else if(yol==="/cari/tahsilat-takipleri/sorumlular")json={kayitlar:[{id:u,adSoyad:"Muhasebe Sorumlusu"}],varsayilanUserId:u};
  else if(yol==="/cari/tahsilat-takipleri"){
   const gorunum=url.searchParams.get("gorunum")??"bugun",cariId=url.searchParams.get("cariId"),sorumluUserId=url.searchParams.get("sorumluUserId");
   const kayitlar=s.kayitlar.filter(k=>(!cariId||k.cari.id===cariId)&&(!sorumluUserId||k.sorumlu.id===sorumluUserId)&&(gorunum==="tum"||["acik","beklemede"].includes(k.durum))&&(gorunum!=="bugun"||k.sonrakiIslemTarihi!<=tarih)&&(gorunum!=="itiraz"||k.neden==="itiraz"));
   json={kullanimModu:s.mod,bugun:tarih,alindigiZaman:zaman,cariId,gorunum,sorumluUserId,toplam:kayitlar.length,sonrakiImlec:null,kayitlar};
  }else if(yol===`/cari/tahsilat-takipleri/${id}`)json={kullanimModu:s.mod,kayit:s.kayitlar[0],gorusmeSayisi:s.notlar.length,olaySayisi:0,gorusmeler:s.notlar,olaylar:[]};
  else if(yol===`/cari/${c}`)json=cari;
  else if(yol===`/cari/${c}/durum`)json={hesaplandiAt:zaman,gostergeler:null,bulgular:[],toplamBulgu:0};
  else if(yol==="/ai/cari-durum/kullanilabilir")json={kullanilabilir:false};
  else if(yol==="/cari")json={kayitlar:[cari],sonrakiImlec:null};
  else if(yol.endsWith("/crm"))json={etkilesimler:[],gorevler:[],teklifler:[],kullanicilar:[]};
  else if(yol.endsWith("/davranis-analizi")){await r.fulfill({status:403,json:{message:"Testte kapalı"}});return;}
  else if(yol.endsWith("/teminatlar"))json={satirlar:[],gecerliToplamTry:"0"};
  else if(yol.endsWith("/ekstre"))json={cari,satirlar:[],dovizOzet:[]};
  else if(yol==="/cari/odeme-sozleri")json={cari:{id:c,unvan:cari.unvan},kullanimModu:s.mod,alindigiZaman:zaman,zamanHassasiyeti:"gun",uyari:"Aynı gün sırası bilinmiyor.",sozler:[]};
  else if(["/cari/etiketler","/cari/gruplar","/fiyat-listeleri","/ai/onay-talepleri"].includes(yol))json=[];
  else if(yol==="/ebelge/uygulamalar")json={efatura:{acik:false},earsiv:{acik:false},eirsaliye:{acik:false}};
  await r.fulfill({json});
 });return s;
}
async function daily(page:Page){await page.goto("/panel/cari/tahsilat");return page.getByRole("region",{name:"Tahsilat takipleri",exact:true});}
async function detay(page:Page){await page.getByRole("button",{name:"Takibi incele: Takip müşterisi"}).click();return page.getByRole("region",{name:"Tahsilat takip detayı",exact:true});}
test("günlük iş listesi ve açık itiraz/benim filtreleri doğru sorguyu kullanır",async({page})=>{
 const s=await kur(page);const p=await daily(page);await expect(p.getByRole("table")).toBeVisible();expect(s.yazilar).toEqual([]);
 await p.getByLabel("Yalnız bana atananlar").check();await expect(p.getByRole("table")).toBeVisible();
 await p.getByLabel("İş listesi",{exact:true}).selectOption("itiraz");await expect(p.getByText("Bu görünümde tahsilat takibi yok.")).toBeVisible();
 await p.getByLabel("İş listesi",{exact:true}).selectOption("tum");await expect(p.getByRole("link",{name:"Takip müşterisi"})).toHaveAttribute("href",`/panel/cari/${c}`);
});
test("cari detayında yeni takip sorumlu ve sonraki işlemle oluşturulur",async({page})=>{
 const s=await kur(page);s.kayitlar=[];await page.goto(`/panel/cari/${c}`);await page.getByRole("tab",{name:"Tahsilat",exact:true}).click();
 const p=page.getByRole("region",{name:"Tahsilat takipleri",exact:true});await p.getByRole("button",{name:"Yeni tahsilat takibi",exact:true}).click();
 const f=page.getByRole("region",{name:"Tahsilat takip işlemi"});await f.getByLabel("Takip konusu",{exact:true}).fill("Faturaya itiraz görüşülecek");
 await f.getByLabel("Takip nedeni",{exact:true}).selectOption("itiraz");await f.getByLabel("Sonraki işlem günü").fill("2035-01-01");await f.getByLabel("Sonraki işlem",{exact:true}).fill("Belgeyi kontrol et");
 await expect(f.getByLabel("Takip sorumlusu")).toHaveValue(u);await f.getByRole("button",{name:"Takibi oluştur"}).click();
 await expect(p.getByRole("table")).toBeVisible();expect(s.yazilar[0].body).toMatchObject({cariId:c,sorumluUserId:u,neden:"itiraz",sonrakiIslemTarihi:"2035-01-01"});
});
test("görüşme notu sürümle yazılır ve yeniden okunan geçmişte görünür",async({page})=>{
 const s=await kur(page);await daily(page);const d=await detay(page);await d.getByRole("button",{name:"Görüşme ekle",exact:true}).click();
 const f=page.getByRole("region",{name:"Tahsilat takip işlemi"});await f.getByLabel("Görüşme kanalı").selectOption("eposta");await f.getByLabel("Görüşme notu").fill("Müşteri ödeme belgesini iletecek");
 await f.getByRole("button",{name:"Görüşmeyi kaydet"}).click();await expect(d.getByText("Müşteri ödeme belgesini iletecek",{exact:true})).toBeVisible();
 expect(s.yazilar).toHaveLength(1);expect(s.yazilar[0].body).toMatchObject({beklenenSurum:1,kanal:"eposta"});expect(s.yazilar[0].yol).toBe(`/cari/tahsilat-takipleri/${id}/gorusmeler`);
});
test("takibi tamamlamak açık onay ve gerekçe ister, günlük listeden çıkarır",async({page})=>{
 const s=await kur(page);const p=await daily(page);const d=await detay(page);await d.getByRole("button",{name:"Takibi düzenle",exact:true}).click();
 const f=page.getByRole("region",{name:"Tahsilat takip işlemi"});await f.getByLabel("Takip durumu").selectOption("tamamlandi");await f.getByLabel("Değişiklik gerekçesi").fill("Görüşme süreci tamamlandı");
 await f.getByRole("button",{name:"Takip değişikliğini kaydet"}).click();await expect(p.getByText("Bu görünümde tahsilat takibi yok.")).toBeVisible();
 expect(s.yazilar[0].method).toBe("PATCH");expect(s.yazilar[0].body).toMatchObject({durum:"tamamlandi",sonrakiIslem:null,sonrakiIslemTarihi:null,beklenenSurum:1});
 await expect(d.getByRole("button",{name:"Görüşme ekle",exact:true})).toHaveCount(0);
});
test("409 görüşme taslağını korur ve tekrar gönderimi durdurur",async({page})=>{
 const s=await kur(page,"muhasebe",async(r)=>{if(r.request().method()!=="POST")return false;await r.fulfill({status:409,json:{message:"Takip değişmiş"}});return true;});
 await daily(page);const d=await detay(page);await d.getByRole("button",{name:"Görüşme ekle",exact:true}).click();const f=page.getByRole("region",{name:"Tahsilat takip işlemi"});
 await f.getByLabel("Görüşme notu").fill("Bu taslak korunacak");await f.getByRole("button",{name:"Görüşmeyi kaydet"}).click();await expect(f.getByLabel("Görüşme notu")).toHaveValue("Bu taslak korunacak");await expect(f.getByRole("button",{name:"Görüşmeyi kaydet"})).toBeDisabled();expect(s.yazilar).toHaveLength(1);
});
for(const rol of ["salt_okunur","mali_musavir"])test(`${rol} görüşmeleri okur, takip yazamaz`,async({page})=>{
 await kur(page,rol);await daily(page);const d=await detay(page);await expect(d.getByText("Henüz görüşme kaydı yok.")).toBeVisible();await expect(d.getByRole("button",{name:"Görüşme ekle",exact:true})).toHaveCount(0);
});
test("salt okunur şirket modunda yönetici de takip yazamaz",async({page})=>{
 const s=await kur(page,"yonetici");s.mod="salt_okunur";await daily(page);const d=await detay(page);await expect(d.getByText("Henüz görüşme kaydı yok.")).toBeVisible();await expect(d.getByRole("button",{name:"Takibi düzenle",exact:true})).toHaveCount(0);
});
test("kapalı şirket hatası boş iş listesi olarak sunulmaz",async({page})=>{
 await kur(page,"muhasebe",async(r,url)=>{if(!url.pathname.endsWith("/tahsilat-takipleri"))return false;await r.fulfill({status:403,json:{message:"Tahsilat şirket için kapalı"}});return true;});
 const p=await daily(page);await expect(p.getByText("Tahsilat şirket için kapalı")).toBeVisible();await expect(p.getByText("Bu görünümde tahsilat takibi yok.")).toHaveCount(0);
});
test("satış rolü iş listesi API'sini çağırmaz",async({page})=>{
 const s=await kur(page,"satis");await daily(page);await expect(page.getByRole("heading",{name:"Bu sayfaya erişim yetkiniz yok"})).toBeVisible();expect(s.okumalar).toBe(0);
});
test("bildirim bağlantısı liste filtresinden bağımsız doğru takip detayını açar",async({page})=>{
 await kur(page);await page.goto(`/panel/cari/tahsilat?takip=${id}`);
 await expect(page.getByRole("region",{name:"Tahsilat takip detayı"})).toBeVisible();
 await expect(page.getByRole("region",{name:"Tahsilat takip detayı"}).getByText("Henüz görüşme kaydı yok.")).toBeVisible();
 await expect(page.getByLabel("İş listesi",{exact:true})).toHaveValue("tum");
});
test("aynı ekranda başka bildirim bağlantısına geçince eski takip detayı kalmaz",async({page})=>{
 const diger="55555555-5555-4555-8555-555555555555";
 await kur(page,"muhasebe",async(r,url)=>{
  if(!url.pathname.endsWith(`/tahsilat-takipleri/${diger}`))return false;
  await r.fulfill({json:{kullanimModu:"pilot",kayit:{...takip(),id:diger,konu:"İkinci bildirim takibi"},gorusmeSayisi:0,olaySayisi:0,gorusmeler:[],olaylar:[]}});return true;
 });
 await page.goto(`/panel/cari/tahsilat?takip=${id}`);
 const bolge=page.getByRole("region",{name:"Tahsilat takip detayı"});await expect(bolge.getByText(/Vadesi geçen alacak/)).toBeVisible();
 await page.evaluate((hedef)=>window.history.pushState(null,"",`/panel/cari/tahsilat?takip=${hedef}`),diger);
 await expect(bolge.getByText(/İkinci bildirim takibi/)).toBeVisible();await expect(bolge.getByText(/Vadesi geçen alacak/)).toHaveCount(0);
});

test("iş listesinden ileri tarihli takip açılır ve yeni detay görünür kalır",async({page})=>{
 const s=await kur(page);s.kayitlar=[];const p=await daily(page);
 await p.getByRole("button",{name:"Yeni tahsilat takibi",exact:true}).click();
 const modal=page.getByRole("dialog");await modal.getByLabel("Cari ara").fill("Takip");
 await modal.getByRole("button",{name:"Seç",exact:true}).click();
 const f=page.getByRole("region",{name:"Tahsilat takip işlemi"});
 await expect(p.getByText("Takip oluşturulan cari:")).toContainText("Takip müşterisi");
 await f.getByLabel("Takip konusu",{exact:true}).fill("Gelecek hafta ödeme görüşmesi");
 await f.getByRole("button",{name:"Yarın",exact:true}).click();
 const yarin=await f.getByLabel("Sonraki işlem günü").inputValue();
 await f.getByRole("button",{name:"Bir hafta sonra",exact:true}).click();
 expect(await f.getByLabel("Sonraki işlem günü").inputValue()).not.toBe(yarin);
 await f.getByLabel("Sonraki işlem günü").fill("2035-01-01");
 await f.getByLabel("Sonraki işlem",{exact:true}).fill("Ödeme planını görüş");
 await f.getByRole("button",{name:"Takibi oluştur"}).click();
 await expect(p.getByLabel("İş listesi",{exact:true})).toHaveValue("tum");
 const d=page.getByRole("region",{name:"Tahsilat takip detayı",exact:true});
 await expect(d.getByText("Gelecek hafta ödeme görüşmesi",{exact:true})).toBeVisible();
 expect(s.yazilar).toHaveLength(1);expect(s.yazilar[0].body).toMatchObject({cariId:c,sonrakiIslemTarihi:"2035-01-01"});
});
test("cari seçimini iptal etmek kayıt oluşturmaz",async({page})=>{
 const s=await kur(page);const p=await daily(page);
 await p.getByRole("button",{name:"Yeni tahsilat takibi",exact:true}).click();
 await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Tahsilat takip işlemi"})).toHaveCount(0);expect(s.yazilar).toHaveLength(0);
});
