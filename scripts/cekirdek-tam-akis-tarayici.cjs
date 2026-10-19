const fs=require('node:fs');
const assert=require('node:assert/strict');
const req=require('node:module').createRequire('/runtime/apps/api/package.json');
const {chromium}=req('playwright');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
async function visible(locator){await locator.waitFor({state:'visible',timeout:20000});}
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[],requests=[];let page;
 try{
  page=await browser.newPage({viewport:input.mobile?{width:390,height:844}:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().includes('/api/v1/'))requests.push({path:new URL(r.url()).pathname,status:r.status(),method:r.request().method()});});
  await page.goto('http://127.0.0.1:3100/panel/cari/tahsilat');
  await page.waitForURL('**/giris**');
  await page.locator('input[name="eposta"]').fill(input.email);
  await page.locator('input[name="parola"]').fill(input.password);
  await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();
  await page.waitForURL(url=>url.pathname==='/panel'||url.pathname.startsWith('/panel/'),{timeout:20000});
  await page.goto('http://127.0.0.1:3100/panel/cari/tahsilat?takip='+input.followup);
  const detail=page.getByRole('region',{name:'Tahsilat takip detayı',exact:true});
  await visible(detail.getByText('Yalnız izole runtime görüşmesi',{exact:true}));
  if(input.mode==='pilot'){
   await detail.getByRole('button',{name:'Görüşme ekle',exact:true}).click();
   const form=page.getByRole('region',{name:'Tahsilat takip işlemi',exact:true});
   await form.getByLabel('Görüşme notu').fill('Gerçek tarayıcıdan izole görüşme');
   const saved=page.waitForResponse(r=>r.url().includes('/tahsilat-takipleri/'+input.followup+'/gorusmeler')&&r.request().method()==='POST');
   await form.getByRole('button',{name:'Görüşmeyi kaydet',exact:true}).click();
   const savedResponse=await saved;
   assert.equal(savedResponse.status(),201,await savedResponse.text());
   await form.waitFor({state:'hidden',timeout:20000});
   await visible(detail.locator('article').getByText('Gerçek tarayıcıdan izole görüşme',{exact:true}));
   await page.reload();
   await visible(page.getByRole('region',{name:'Tahsilat takip detayı',exact:true}).locator('article').getByText('Gerçek tarayıcıdan izole görüşme',{exact:true}));
  }else{
   assert.equal(await detail.getByRole('button',{name:'Görüşme ekle',exact:true}).count(),0);
   assert.equal(await detail.getByRole('button',{name:'Takibi düzenle',exact:true}).count(),0);
  }
  await page.goto('http://127.0.0.1:3100/panel/cari/'+input.cari);
  await page.getByRole('tab',{name:'Tahsilat',exact:true}).click();
  const promises=page.getByRole('region',{name:'Ödeme sözleri',exact:true});
  await visible(promises.getByRole('table'));
  await visible(promises.getByText('İzole runtime ödeme sözü',{exact:true}));
  assert.equal(await promises.getByRole('button',{name:'Yeni ödeme sözü',exact:true}).count(),input.mode==='pilot'?1:0);
  await page.screenshot({path:'/proof/'+input.mode+(input.mobile?'-mobil':'-masaustu')+'.png',fullPage:true});
  assert.deepEqual(errors,[]);
  assert(requests.some(r=>r.path==='/api/v1/auth/giris'&&r.status===201));
  assert(requests.some(r=>r.path.includes('/odeme-sozleri')&&r.status===200));
  assert(requests.every(r=>r.status<500),'Sunucu hatası var');
  fs.writeFileSync('/proof/'+input.mode+(input.mobile?'-mobil':'-masaustu')+'-istekler.json',JSON.stringify(requests,null,2));
  if(input.mode==='pilot')assert(requests.some(r=>r.path.endsWith('/gorusmeler')&&r.method==='POST'&&r.status===201));
  console.log(JSON.stringify({mode:input.mode,mobile:input.mobile,gercekFormGirisi:true,apiMock:false,sessionTokenEnjeksiyonu:false,pageErrors:errors,requests}));
 }catch(e){if(page){await page.screenshot({path:'/proof/hata-'+input.mode+'.png',fullPage:true}).catch(()=>{});console.error(JSON.stringify({url:page.url(),errors,requests}));}throw e;}finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
