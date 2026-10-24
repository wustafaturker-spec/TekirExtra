import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Yalnız izole ileri geçiş runner'ının DB'sinde kontrollü kilit/zaman aşımı ve kurtarma. */
export async function kilitProvasiniYap({run,sql,migrationEnv,evidence,eskiIcerigiDogrula}){
 const db=await sql('SELECT current_database()');
 if(!/^f01_yaris_[a-f0-9]{16}$/.test(db))throw Error('Kilit provası yalnız izole DB kabul eder');
 const ad=`f04_kilit_${db.slice(-16)}`,ikinci='20261022160000_ihtiyac_uretim_ve_plan';
 let blocker,pid,serbest=false;
 try{
  // Yeni bağlantılarda geçerlidir; gerçek ortamın varsayılanı veya rol ayarı değiştirilmez.
  await sql(`ALTER DATABASE ${db} SET lock_timeout='1s'`);
  blocker=sql(`SET application_name='${ad}'; BEGIN; LOCK TABLE uretim_emri_kalemleri IN ROW EXCLUSIVE MODE; SELECT pg_sleep(45); ROLLBACK;`).then(()=>({ok:true}),error=>({ok:false,error:String(error)}));
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   const p=await sql(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname=current_database() AND a.application_name='${ad}' AND l.relation='uretim_emri_kalemleri'::regclass AND l.mode='RowExclusiveLock' AND l.granted`);
   if(/^\d+$/.test(p)){pid=Number(p);break;}
   await new Promise(r=>setTimeout(r,100));
  }
  if(!pid)throw Error('Yazma türü tablo kilidi alınamadı');
  const baslangic=Date.now();let hata;
  try{await run('pnpm',['exec','prisma','migrate','deploy'],{env:migrationEnv});}catch(e){hata=String(e);}
  const zamanAsimiDeployMs=Date.now()-baslangic;
  if(!hata?.includes('P3018')||!hata.includes('55P03'))throw Error('Beklenen Prisma P3018 / PostgreSQL lock_timeout 55P03 alınmadı: '+hata);
  await writeFile(join(evidence,'kilit-ilk-deploy.log'),hata+'\n');
  // Engelleyici gerçekten hâlâ açık olmalı; zamanlayıcının doğal bitişi başarı kanıtı değildir.
  const aktif=await sql(`SELECT count(*) FROM pg_stat_activity WHERE pid=${pid} AND datname=current_database() AND application_name='${ad}'`);if(aktif!=='1')throw Error('Engelleyici işlem beklenenden erken kapandı');
  await sql(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=${pid} AND datname=current_database() AND application_name='${ad}'`);
  await blocker;serbest=true;
  await sql(`ALTER DATABASE ${db} RESET lock_timeout`);
  const durum=await sql(`SELECT migration_name FROM _prisma_migrations WHERE migration_name='${ikinci}' AND finished_at IS NULL AND rolled_back_at IS NULL`);
  if(durum!==ikinci)throw Error('Başarısız migration kaydı doğrulanamadı');
  const kismi=await sql("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('depolar_tenant_id_id_key','uretim_emri_kalemleri_tenant_id_id_key','ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari') ORDER BY relname");
  if(kismi)throw Error('Yarım DDL bulundu; otomatik resolve yapılmayacak: '+kismi);
  await eskiIcerigiDogrula();
  let tekrar;
  try{await run('pnpm',['exec','prisma','migrate','deploy'],{env:migrationEnv});}catch(e){tekrar=String(e);}
  if(!tekrar?.includes('P3009'))throw Error('Başarısız migration kaydı varken kör tekrar P3009 ile engellenmedi');
  await writeFile(join(evidence,'kilit-kor-tekrar.log'),tekrar+'\n');
  const resolveLog=await run('pnpm',['exec','prisma','migrate','resolve','--rolled-back',ikinci],{env:migrationEnv});
  await writeFile(join(evidence,'kilit-resolve.log'),resolveLog+'\n');
  const sonuc={durum:'gecti',dbKapsami:'yalnız runner geçici DB',engellenenTablo:'uretim_emri_kalemleri',engelleyiciKilit:'RowExclusiveLock',lockTimeoutMs:1000,zamanAsimiDeployMs,prismaHatasi:'P3018',postgresHatasi:'55P03',kismiIkinciMigrationDdl:false,eskiIsVerisiKorundu:true,korTekrarHatasi:'P3009',kontrolluResolve:'rolled-back; yalnız nesne yokluğu doğrulandıktan sonra',sonDeploy:'ileri geçiş runner devamında doğrulanır',gercekSirketPilotu:false};
  await writeFile(join(evidence,'kilit-ozeti.json'),JSON.stringify(sonuc,null,2)+'\n');return sonuc;
 }finally{
  if(pid&&!serbest){await sql(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=${pid} AND datname=current_database() AND application_name='${ad}'`);await blocker;}
  await sql(`ALTER DATABASE ${db} RESET lock_timeout`);
 }
}
