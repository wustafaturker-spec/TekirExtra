import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baglamlaCalistir, platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";
import { PlatformDuyuruService } from "../src/mevzuat/platform-duyuru.service";
import { TenantDuyuruService } from "../src/mevzuat/tenant-duyuru.service";
import type { DuyuruHedefi } from "../src/mevzuat/platform-duyuru.semalar";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(), diger = randomUUID(), t1 = randomUUID(), t2 = randomUUID();
const u1 = randomUUID(), u2 = randomUUID(), u3 = randomUUID();
const servis = new PlatformDuyuruService({ db: platform } as never, {} as never), tenant = new TenantDuyuruService(app);
const ids: string[] = [];
let paketId: string;
const yonetici = <T>(is: () => Promise<T>, kullaniciId = kisi) => platformBaglamiylaCalistir({ kullaniciId, eposta: "duyuru@kabul.invalid", rol: "yonetici" }, is);
const kiraci = <T>(is: () => Promise<T>, tenantId = t1, userId = u1) => baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, is);
const hedef = (): DuyuruHedefi => ({ kapsam: "secili", firmaIds: [t1,t2], haricFirmaIds: [], paketIds: [], durumlar: [], roller: ["yonetici"], yeniUygunlar: "katilmaz", gosterimYerleri: ["merkez"],modulYollari:[],tekrarPolitikasi:"her_zaman",popupOnceligi:50,popupTuru:"normal",ertelemeDakika:1440 });
const bitis = () => new Date(Date.now()+3600000).toISOString();
async function taslak() {
  const d = await yonetici(() => servis.olustur({ baslik: "Yayın kabulü", icerik: "Firmaya özel duyuru", butonMetni: "Detay", butonUrl: "/panel" })); ids.push(d.id); return d;
}
async function yayin(h = hedef(), baslangic: string | null = null) {
  const d = await taslak(); const p = await yonetici(() => servis.hedefOnizle(d.id, { surum: 1, hedef: h, baslangic, bitis: bitis() }));
  return { d: await yonetici(() => servis.yayinla(d.id,p.id)), p };
}
async function kullanici(id: string, tenantId: string, rol: "yonetici" | "muhasebe") {
  await admin.user.create({ data: { id, tenantId, eposta: `${id}@kabul.invalid`, adSoyad: "Duyuru alıcısı", parolaHash: "x", rol } });
}
// Yalnız geçici DB sahibi saati temsil eden alanı değiştirir; üretimde test/clock atlatma ucu yoktur.
async function zamaniDegistir(id: string, baslangic: Date, son: Date) {
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`UPDATE platform_duyurular SET baslangic=${baslangic},bitis=${son} WHERE id=${id}::uuid`;
  });
}
beforeAll(async () => {
  for (const id of [kisi,diger]) await admin.platformKullanici.create({ data: { id, eposta: `${id}@kabul.invalid`, adSoyad: "Duyuru yöneticisi", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  for (const id of [t1,t2]) {
    await admin.tenant.create({ data: { id, unvan: `Duyuru firması ${id}`, vkn: id.replaceAll("-","").slice(0,10) } });
    await admin.tenantAbonelik.create({ data: { tenantId: id, planKodu: "v1", durum: "aktif", donemSonu: new Date(Date.now()+86400000) } });
  }
  await kullanici(u1,t1,"yonetici"); await kullanici(u2,t1,"muhasebe"); await kullanici(u3,t2,"yonetici");
  paketId = (await admin.platformPaket.findUniqueOrThrow({ where: { eskiPlanKodu: "profesyonel" } })).id;
});
afterAll(async () => {
  for (const id of ids) {
    await admin.$executeRaw`DELETE FROM platform_duyuru_tercihleri WHERE duyuru_id=${id}::uuid`;
    await admin.$executeRaw`DELETE FROM platform_duyuru_olaylari WHERE duyuru_id=${id}::uuid`;
    await admin.$executeRaw`DELETE FROM platform_duyuru_alicilari WHERE duyuru_id=${id}::uuid`;
    await admin.$executeRaw`DELETE FROM platform_duyuru_onizlemeleri WHERE duyuru_id=${id}::uuid`;
    await admin.$executeRaw`DELETE FROM platform_duyuru_gecmisi WHERE duyuru_id=${id}::uuid`;
    await admin.$executeRaw`DELETE FROM platform_duyurular WHERE id=${id}::uuid`;
  }
  await admin.user.deleteMany({ where: { tenantId: { in: [t1,t2] } } });
  await admin.tenant.deleteMany({ where: { id: { in: [t1,t2] } } });
  await admin.platformKullanici.deleteMany({ where: { id: { in: [kisi,diger] } } });
  await Promise.all([admin.$disconnect(),platform.$disconnect(),app.$disconnect()]);
});
describe("duyuru hedefleme ve yayın — gerçek PostgreSQL", () => {
  it("paket veya abonelik durumu eşleşmiyorsa boş hedef yayın onayına açılamaz", async () => {
    const d = await taslak();
    const farkliPaket = (await admin.platformPaket.findUniqueOrThrow({ where:{ eskiPlanKodu:"baslangic" } })).id;
    for (const h of [{ ...hedef(),firmaIds:[t1],paketIds:[farkliPaket] },{ ...hedef(),firmaIds:[t1],durumlar:["iptal" as const] }]) {
      await expect(yonetici(() => servis.hedefOnizle(d.id,{surum:1,hedef:h,baslangic:null,bitis:bitis()}))).rejects.toThrow("uygun kullanıcı yok");
    }
  });
  it("dahil/hariç, paket, abonelik ve rol birlikte süzülür; hedef dışı detay/olay kapalıdır", async () => {
    const { d,p } = await yayin({ ...hedef(), kapsam: "tum", firmaIds: [], haricFirmaIds: [t2], paketIds: [paketId], durumlar: ["aktif"] });
    // Kabul DB'si diğer kabul dosyalarının firmalarını da taşır; "tum" kapsamı
    // onları da sayar. Süzgeç bu dosyanın firmaları üzerinden doğrulanır.
    expect(p.firmaSayisi).toBeGreaterThanOrEqual(1);
    const alicilar = await admin.$queryRaw<{ tenant_id: string; user_id: string }[]>`
      SELECT tenant_id::text, user_id::text FROM platform_duyuru_alicilari
      WHERE duyuru_id=${d.id}::uuid AND tenant_id IN (${t1}::uuid, ${t2}::uuid)`;
    expect(alicilar).toEqual([{ tenant_id: t1, user_id: u1 }]);
    expect(await kiraci(() => tenant.getir(d.id,false))).toMatchObject({ baslik: "Yayın kabulü", okundu: false });
    for (const [tid,uid] of [[t1,u2],[t2,u3]]) {
      await expect(kiraci(() => tenant.getir(d.id,false),tid,uid)).rejects.toThrow("bulunamadı");
      await expect(kiraci(() => tenant.olay(d.id,"okudum"),tid,uid)).rejects.toThrow("bulunamadı");
    }
  });
  it("yayın önizlemesi kullanıcıya bağlıdır; tekrar onay tek yayın/geçmiş üretir", async () => {
    const d = await taslak(); const p = await yonetici(() => servis.hedefOnizle(d.id,{ surum: 1,hedef: hedef(),baslangic:null,bitis:bitis() }));
    await expect(yonetici(() => servis.yayinla(d.id,p.id),diger)).rejects.toThrow("bulunamadı");
    const ilk = await yonetici(() => servis.yayinla(d.id,p.id));
    expect(await yonetici(() => servis.yayinla(d.id,p.id))).toEqual(ilk);
    expect(await yonetici(() => servis.gecmis(d.id,1))).toHaveLength(2);
    const rapor = await yonetici(() => servis.rapor(d.id,1));
    expect(rapor).toMatchObject({ firma:2,kullanici:2,gosterim:0,okudum:0,tiklama:0 });
    expect(rapor.firmalar.every((f) => f.unvan.startsWith("Duyuru firması"))).toBe(true);
  });
  it("önizleme ile onay arasında aynı sayıda alıcı değişse de yeni önizleme gerekir", async () => {
    const d = await taslak(); const p = await yonetici(() => servis.hedefOnizle(d.id,{ surum:1,hedef:{ ...hedef(),firmaIds:[t1] },baslangic:null,bitis:bitis() }));
    await admin.user.update({ where:{ id:u1 },data:{ rol:"muhasebe" } });
    await admin.user.update({ where:{ id:u2 },data:{ rol:"yonetici" } });
    try { await expect(yonetici(() => servis.yayinla(d.id,p.id))).rejects.toThrow("Hedef kitle değişti"); }
    finally { await admin.user.update({ where:{ id:u1 },data:{ rol:"yonetici" } }); await admin.user.update({ where:{ id:u2 },data:{ rol:"muhasebe" } }); }
    expect(await yonetici(() => servis.getir(d.id))).toMatchObject({ durum:"taslak",surum:1 });
  });
  it("süresi dolan ve eski içerik sürümüne ait önizleme yayınlanamaz", async () => {
    const d = await taslak(); const p = await yonetici(() => servis.hedefOnizle(d.id,{ surum:1,hedef:hedef(),baslangic:null,bitis:bitis() }));
    await admin.$executeRaw`UPDATE platform_duyuru_onizlemeleri SET son_onay_at=now()-interval '1 minute' WHERE id=${p.id}::uuid`;
    await expect(yonetici(() => servis.yayinla(d.id,p.id))).rejects.toThrow("zamanı geçti");
    const p2 = await yonetici(() => servis.hedefOnizle(d.id,{ surum:1,hedef:hedef(),baslangic:null,bitis:bitis() }));
    await yonetici(() => servis.guncelle(d.id,{ baslik:"Yeni içerik",icerik:"Yeni metin",butonMetni:null,butonUrl:null,surum:1 }));
    await expect(yonetici(() => servis.yayinla(d.id,p2.id))).rejects.toThrow("Duyuru değişti");
  });
  it("başlangıçtan önce gizli, başlangıçta açık, bitişten sonra yalnız geçmiştedir", async () => {
    const { d } = await yayin(hedef(),new Date(Date.now()+60000).toISOString());
    await expect(kiraci(() => tenant.getir(d.id,false))).rejects.toThrow("bulunamadı");
    await expect(kiraci(() => tenant.olay(d.id,"okudum"))).rejects.toThrow("bulunamadı");
    await zamaniDegistir(d.id,new Date(Date.now()-60000),new Date(Date.now()+60000));
    expect(await kiraci(() => tenant.getir(d.id,false))).toMatchObject({ id:d.id });
    await zamaniDegistir(d.id,new Date(Date.now()-120000),new Date(Date.now()-60000));
    await expect(kiraci(() => tenant.getir(d.id,false))).rejects.toThrow("bulunamadı");
    expect(await kiraci(() => tenant.getir(d.id,true))).toMatchObject({ id:d.id });
    await expect(kiraci(() => tenant.olay(d.id,"okudum"))).rejects.toThrow("bulunamadı");
  });
  it("gösterim okuma sayılmaz, paralel tekrarlar benzersiz sayıları artırmaz", async () => {
    const { d } = await yayin();
    await kiraci(() => tenant.listele(1,false));
    expect(await yonetici(() => servis.rapor(d.id,1))).toMatchObject({ gosterim:0,okudum:0 });
    await Promise.all([1,2].map(() => kiraci(() => tenant.olay(d.id,"gosterim"))));
    expect(await yonetici(() => servis.rapor(d.id,1))).toMatchObject({ gosterim:1,okudum:0 });
    await Promise.all([1,2].map(() => kiraci(() => tenant.olay(d.id,"okudum"))));
    await Promise.all([1,2].map(() => kiraci(() => tenant.olay(d.id,"tiklama"))));
    expect(await kiraci(() => tenant.getir(d.id,false))).toMatchObject({ okundu:true });
    expect(await yonetici(() => servis.rapor(d.id,1))).toMatchObject({ firma:2,kullanici:2,gosterim:1,okudum:1,tiklama:1 });
  });
  it("rol ve abonelik değişikliğinde kayıtlı alıcının erişimi yeniden denetlenir", async () => {
    const { d } = await yayin({ ...hedef(),durumlar:["aktif"] });
    await admin.user.update({ where:{ id:u1 },data:{ rol:"muhasebe" } });
    try { await expect(kiraci(() => tenant.getir(d.id,false))).rejects.toThrow("bulunamadı"); await expect(kiraci(() => tenant.olay(d.id,"okudum"))).rejects.toThrow("bulunamadı"); }
    finally { await admin.user.update({ where:{ id:u1 },data:{ rol:"yonetici" } }); }
    await admin.tenantAbonelik.update({ where:{ tenantId:t1 },data:{ durum:"askida" } });
    try { await expect(kiraci(() => tenant.getir(d.id,false))).rejects.toThrow("bulunamadı"); }
    finally { await admin.tenantAbonelik.update({ where:{ tenantId:t1 },data:{ durum:"aktif" } }); }
  });
  it("yayından sonra eklenen kullanıcı otomatik katılmaz", async () => {
    const { d } = await yayin(); const yeni = randomUUID(); await kullanici(yeni,t1,"yonetici");
    await expect(kiraci(() => tenant.getir(d.id,false),t1,yeni)).rejects.toThrow("bulunamadı");
    await expect(platform.$executeRaw`INSERT INTO platform_duyuru_alicilari(duyuru_id,tenant_id,user_id) VALUES (${d.id}::uuid,${t1}::uuid,${yeni}::uuid)`).rejects.toThrow();
  });
  it("yayın içeriği SQL düzeyinde değiştirilemez, durdurma erişimi ve olayları hemen keser", async () => {
    const { d } = await yayin();
    await expect(platform.$executeRaw`UPDATE platform_duyurular SET icerik='Degisti',surum=surum+1 WHERE id=${d.id}::uuid`).rejects.toThrow();
    const durdu = await yonetici(() => servis.durdur(d.id,d.surum)); expect(durdu.durum).toBe("durduruldu");
    await expect(kiraci(() => tenant.getir(d.id,false))).rejects.toThrow("bulunamadı");
    await expect(kiraci(() => tenant.olay(d.id,"okudum"))).rejects.toThrow("bulunamadı");
    expect(await yonetici(() => servis.arsivle(d.id,durdu.surum))).toMatchObject({ durum:"arsiv" });
  });
  it("bir kez gösterim yeni bağlantıda korunur, diğer kullanıcıyı etkilemez ve merkezden okumayı engellemez", async () => {
    const { d } = await yayin({ ...hedef(), gosterimYerleri: ["merkez", "popup"], tekrarPolitikasi: "bir_kez" });
    await kiraci(() => tenant.olay(d.id, "gosterim"));
    const yeniBaglanti = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const yeniTenant = new TenantDuyuruService(yeniBaglanti);
      expect(await kiraci(() => yeniTenant.getir(d.id, false))).toMatchObject({ tekrarGosterilebilir: false, okundu: false });
      await expect(kiraci(() => yeniTenant.olay(d.id, "gosterim"))).rejects.toThrow("bulunamadı");
      await kiraci(() => yeniTenant.olay(d.id, "okudum"));
      expect(await kiraci(() => yeniTenant.getir(d.id, false))).toMatchObject({ okundu: true });
    } finally { await yeniBaglanti.$disconnect(); }
    expect(await kiraci(() => tenant.getir(d.id, false), t2, u3)).toMatchObject({ tekrarGosterilebilir: true, okundu: false });
    expect(await yonetici(() => servis.rapor(d.id, 1))).toMatchObject({ gosterim: 1, okudum: 1 });
  });
  it.each([["gunde_bir", 1], ["haftada_bir", 7]] as const)("%s gösterimi süre dolana kadar engeller; tekrar benzersiz metriği artırmaz", async (politika, gun) => {
    const { d } = await yayin({ ...hedef(), gosterimYerleri: ["merkez", "ust_bant"], tekrarPolitikasi: politika });
    await kiraci(() => tenant.olay(d.id, "gosterim"));
    const ilk = await kiraci(() => tenant.getir(d.id, false));
    expect(ilk.tekrarGosterilebilir).toBe(false);
    const kalan = new Date(ilk.tekrarSonrakiGosterim!).getTime() - Date.now();
    expect(kalan).toBeGreaterThan(gun * 86400000 - 15000);
    expect(kalan).toBeLessThanOrEqual(gun * 86400000);
    await expect(kiraci(() => tenant.olay(d.id, "gosterim"))).rejects.toThrow("bulunamadı");
    // Yalnız izole DB sahibi, bekleme süresinin geçmesini temsil eder.
    await admin.$executeRaw`UPDATE platform_duyuru_tercihleri SET tekrar_sonraki_gosterim=now()-interval '1 minute' WHERE duyuru_id=${d.id}::uuid AND tenant_id=${t1}::uuid AND user_id=${u1}::uuid`;
    expect(await kiraci(() => tenant.getir(d.id, false))).toMatchObject({ tekrarGosterilebilir: true });
    await kiraci(() => tenant.olay(d.id, "gosterim"));
    expect(await kiraci(() => tenant.getir(d.id, false))).toMatchObject({ tekrarGosterilebilir: false });
    expect(await yonetici(() => servis.rapor(d.id, 1))).toMatchObject({ gosterim: 1 });
  });
  it("popup erteleme/kapatma yeni bağlantıda saklanır; rapor tekrarları bir kez sayar", async () => {
    const { d } = await yayin({ ...hedef(), gosterimYerleri: ["merkez", "popup"], ertelemeDakika: 60, popupOnceligi: 82, popupTuru: "kritik" });
    const ertelendi = await kiraci(() => tenant.tercih(d.id, "ertele"));
    const kalan = new Date(ertelendi.sonrakiGosterim!).getTime() - Date.now();
    expect(kalan).toBeGreaterThan(3600000 - 15000);
    expect(kalan).toBeLessThanOrEqual(3600000);
    await kiraci(() => tenant.tercih(d.id, "ertele"));
    const yeniBaglanti = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const yeniTenant = new TenantDuyuruService(yeniBaglanti);
      expect(await kiraci(() => yeniTenant.getir(d.id, false))).toMatchObject({ popupKapatildi: false, popupOnceligi: 82, popupTuru: "kritik", ertelemeDakika: 60 });
      expect(new Date((await kiraci(() => yeniTenant.getir(d.id, false))).sonrakiGosterim!).getTime()).toBeGreaterThan(Date.now());
      await kiraci(() => yeniTenant.tercih(d.id, "kapat"));
      await kiraci(() => yeniTenant.tercih(d.id, "kapat"));
    } finally { await yeniBaglanti.$disconnect(); }
    expect(await kiraci(() => tenant.getir(d.id, false))).toMatchObject({ popupKapatildi: true });
    expect(await kiraci(() => tenant.getir(d.id, false), t2, u3)).toMatchObject({ popupKapatildi: false, sonrakiGosterim: null });
    expect(await yonetici(() => servis.rapor(d.id, 1))).toMatchObject({ popupKapatildi: 1, popupErtelendi: 1 });
    await yonetici(() => servis.durdur(d.id, d.surum));
    await expect(kiraci(() => tenant.tercih(d.id, "ertele"))).rejects.toThrow("bulunamadı");
  });
  it("popup tercihi hedef dışındaki kullanıcıya ve popup olmayan yayına kapalıdır", async () => {
    const { d } = await yayin({ ...hedef(), gosterimYerleri: ["popup"] });
    await expect(kiraci(() => tenant.tercih(d.id, "kapat"), t1, u2)).rejects.toThrow("bulunamadı");
    const normal = await yayin();
    await expect(kiraci(() => tenant.tercih(normal.d.id, "ertele"))).rejects.toThrow("bulunamadı");
    await expect(app.$queryRaw`SELECT * FROM platform_duyuru_tercihleri`).rejects.toThrow();
    await expect(platform.$executeRaw`UPDATE platform_duyuru_tercihleri SET kapatildi_at=now()`).rejects.toThrow();
  });
  it("kiracı rolü kaynak/hedef/alıcı tablolarını doğrudan okuyamaz ve kimlik parametresi alamaz", async () => {
    await expect(app.$queryRaw`SELECT * FROM duyuru_hedef_alicilari('{}'::jsonb)`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM duyuru_kiraci_kaynak()`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM platform_duyuru_alicilari`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM platform_duyuru_olaylari`).rejects.toThrow();
    expect((await app.$queryRaw<{ veri:{ toplam:number } }[]>`SELECT tenant_duyurular(false,1) AS veri`)[0].veri.toplam).toBe(0);
    await expect(platform.$queryRaw`SELECT tenant_duyurular(false,1)`).rejects.toThrow();
  });
});
