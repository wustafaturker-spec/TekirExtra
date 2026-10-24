// Yerel kurulum operatörü: var olan yönetici kimliği stdin'den gelir.
// Kısa ömürlü token yalnız bellekte tutulur; parola girişi kabulü değildir.
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
async function main(){
 let input='';for await(const chunk of process.stdin)input+=chunk;
 const actor=JSON.parse(input);assert.match(actor.tenantId,/^[a-f0-9-]{36}$/);assert.match(actor.userId,/^[a-f0-9-]{36}$/);assert.equal(actor.rol,'yonetici');
 const now=Math.floor(Date.now()/1000),part=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const data=part({alg:'HS256',typ:'JWT'})+'.'+part({sub:actor.userId,tenantId:actor.tenantId,rol:actor.rol,iat:now,exp:now+120});
 assert(process.env.JWT_SECRET);const token=data+'.'+createHmac('sha256',process.env.JWT_SECRET).update(data).digest('base64url');
 const request=async(path,options={})=>{const response=await fetch('http://127.0.0.1:3100/api/v1/'+path,{...options,headers:{authorization:'Bearer '+token,'content-type':'application/json'},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,'Operatör HTTP kontrolü: '+path+' '+response.status);return response.json();};
 const before=await request('ayarlar/stok_ihtiyac_plani');
 assert(['kapali','salt_okunur','pilot','acik'].includes(before.mod));
 if(before.mod!=='pilot')await request('ayarlar/stok_ihtiyac_plani',{method:'PUT',body:JSON.stringify({surum:1,mod:'pilot'})});
 const mode=await request('ayarlar/stok_ihtiyac_plani');assert.equal(mode.mod,'pilot');
 await request('stok/ihtiyac-plani/planlar');await request('demirbas');
 console.log(JSON.stringify({durum:'gecti',pilotModu:mode.mod,oncekiMod:before.mod,f04PlanListe:200,demirbasListe:200,parolaGirisKabul:false,finansalOrnekVeriYazilmadi:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
