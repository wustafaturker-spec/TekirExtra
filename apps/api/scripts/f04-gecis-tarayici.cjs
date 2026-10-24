const fs=require('node:fs'),assert=require('node:assert/strict'),req=require('node:module').createRequire('/runtime/apps/api/package.json');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{const browser=await req('playwright').chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/v1/'))requests.push({path:new URL(r.url()).pathname,status:r.status(),method:r.request().method()});});
 await page.goto('http://127.0.0.1:8080/giris');await page.getByRole('textbox',{name:'E-posta Adresi',exact:true}).fill(input.email);await page.getByLabel('Parola',{exact:true}).fill(input.password);await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();await page.waitForURL('**/panel',{timeout:30000});
 if(input.mode==='eski'){await page.goto('http://127.0.0.1:8080/panel/stok/ihtiyac');await page.getByRole('heading',{name:'Stok ihtiyaç önizlemesi',exact:true}).waitFor();}
 else{await page.goto('http://127.0.0.1:8080/panel/stok/ihtiyac-planlari?plan='+input.planId);await page.getByRole('link',{name:'Bağlı talebi incele',exact:true}).waitFor();}
 await page.screenshot({path:'/proof/gecis-'+input.mode+'.png',fullPage:true});assert.deepEqual(errors,[]);assert(requests.some(r=>r.path==='/api/v1/auth/giris'&&r.status===201));assert(requests.every(r=>r.status<500));
 console.log(JSON.stringify({gercekFormGirisi:true,mode:input.mode,apiMock:false,errors,requests}));
 }finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
