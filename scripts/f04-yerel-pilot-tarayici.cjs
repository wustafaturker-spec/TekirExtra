const assert=require('node:assert/strict');
const req=require('node:module').createRequire('/runtime/apps/api/package.json');
const {chromium}=req('playwright');
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const results=[];
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const response=await page.goto('http://gecis:8080/giris',{waitUntil:'networkidle',timeout:45000});assert.equal(response.status(),200);
   assert(await page.locator('input[type="password"]').isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.goto('http://gecis:8080/panel',{waitUntil:'networkidle',timeout:45000});assert(new URL(page.url()).pathname.startsWith('/giris'));assert.deepEqual(errors,[]);
   const protectedResponse=await page.request.get('http://gecis:8080/api/v1/stok/ihtiyac-plani/planlar');assert.equal(protectedResponse.status(),401);
   results.push({genislik:viewport.width,giris:200,panelGirisIstiyor:true,korumaliApi:401,jsHatasi:0,yatayTasma:false});await page.close();
  }
  console.log(JSON.stringify({durum:'gecti',kontroller:results,gercekParolaIleGiris:false}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
