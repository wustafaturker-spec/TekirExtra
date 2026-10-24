import {cp,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

/** Yalnız f01-yaris-kabul runner'ının açtığı izole DB'de çağrılır; bağımsız canlı URL almaz. */
export async function ileriGecisiProvaEt({run,sql,migrationEnv,testEnv,prismaRoot,evidence,kilitProva=false}){
 const yeni=['20261022120000_siparis_giris_tarihi','20261022160000_ihtiyac_uretim_ve_plan','20261022190000_ihtiyac_satin_alma_bagi'];
 const dizinler=(await readdir(join(prismaRoot,'migrations'),{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).sort();
 if(yeni.some(n=>!dizinler.includes(n))||dizinler.some(n=>n>=yeni[0]&&!yeni.includes(n)))throw Error('F04 öncesi/sonrası migration kapsamı değişmiş; açık envanter gerekli');
 const eski=dizinler.filter(n=>n<yeni[0]),stage=await mkdtemp(join(tmpdir(),'tekir-f04-oncesi-'));
 const test=async asama=>{
  const output=await run('pnpm',['exec','vitest','run','--config','vitest.ihtiyac-ileri.config.ts'],{timeout:180000,env:{...testEnv,F04_HTTP_EVIDENCE:evidence,F04_ILERI_ASAMA:asama}});
  const adet=Number(output.match(/Tests\s+(\d+) passed/)?.[1]??0);if(!adet)throw Error('İleri geçiş test sayısı doğrulanamadı');
  await writeFile(join(evidence,`ileri-${asama}-kabul.log`),output+'\n');console.log(output);return adet;
 };
 try{
  // Veri modeli dosyası aynı kalır; deploy yalnız kopyalanmış eski migration zincirini uygular.
  await cp(join(prismaRoot,'schema.prisma'),join(stage,'schema.prisma'));
  await cp(join(prismaRoot,'migrations'),join(stage,'migrations'),{recursive:true,filter:p=>!yeni.some(n=>p.split('/').includes(n))});
  const onceLog=await run('pnpm',['exec','prisma','migrate','deploy','--schema',join(stage,'schema.prisma')],{env:migrationEnv});
  await writeFile(join(evidence,'ileri-eski-migration.log'),onceLog+'\n');
  const oncekiTestAdedi=await test('once');
  const tablolar=(await sql("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).split('\n').filter(Boolean);
  if(!tablolar.length||tablolar.some(t=>!/^[a-z_][a-z0-9_]*$/.test(t)))throw Error('Eski tablo kapsamı doğrulanamadı');
  const sorgu=tablolar.map(t=>`SELECT '${t}' AS tablo,count(*)::text AS adet,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) AS ozet FROM public."${t}" x`).join(' UNION ALL ');
  const fingerprint=()=>sql(`SELECT * FROM (${sorgu}) q ORDER BY tablo`),before=await fingerprint();
  let kilit;
  if(kilitProva){
   const {kilitProvasiniYap}=await import('./f04-kilit-prova.mjs');
   kilit=await kilitProvasiniYap({run,sql,migrationEnv,evidence,eskiIcerigiDogrula:async()=>{if(before!==await fingerprint())throw Error('Kilit hatası eski iş verisini değiştirdi');}});
  }
  const baslangic=Date.now();
  const log=await run('pnpm',['exec','prisma','migrate','deploy'],{env:migrationEnv});
  const deploySureMs=Date.now()-baslangic;
  await writeFile(join(evidence,'ileri-yeni-migration.log'),log+'\n');
  const uygulanan=(await sql(`SELECT migration_name FROM _prisma_migrations WHERE migration_name>='${yeni[0]}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)).split('\n').filter(Boolean);
  if(JSON.stringify(uygulanan)!==JSON.stringify(yeni))throw Error('Beklenen üç F04 migration uygulaması doğrulanamadı');
  const after=await fingerprint();if(before!==after)throw Error('F04 ilk uygulaması eski iş tablolarının içeriğini değiştirdi');
  const sonrakiTestAdedi=await test('sonra');
  const sha=v=>createHash('sha256').update(v).digest('hex');
  const migrations={};for(const n of dizinler)migrations[n]=sha(await readFile(join(prismaRoot,'migrations',n,'migration.sql')));
  const sonuc={durum:'gecti',...(kilit?{kilitProva:{...kilit,sonDeploy:'gecti'}}:{}),oncekiMigrationAdedi:eski.length,uygulanan,eskiTabloSayisi:tablolar.length,veriOlanEskiTabloSayisi:before.split('\n').filter(r=>Number(r.split('|')[1])>0).length,eskiTabloIcerigiKorundu:true,kayitOzeti:sha(before),deploySureMs,sureKapsami:'İzole küçük fixture; pnpm/Prisma başlangıcı dahil deploy duvar süresi. Üretim kilit veya performans kabulü değildir.',oncekiTestAdedi,sonrakiTestAdedi,migrationSha256:migrations};
  await writeFile(join(evidence,'ileri-gecis-ozeti.json'),JSON.stringify(sonuc,null,2)+'\n');return sonuc;
 }finally{await rm(stage,{recursive:true,force:true});}
}
