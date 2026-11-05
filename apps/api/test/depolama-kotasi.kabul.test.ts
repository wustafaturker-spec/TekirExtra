import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, expect, it } from "vitest";
import { bugunTR, PAKET_MODUL_KODLARI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { PrismaService } from "../src/core/prisma.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformFirmaIstisnaService } from "../src/mevzuat/platform-firma-istisna.service";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(); let n = 0;
const servis = new PlatformFirmaIstisnaService({ db } as never), paket = new PlatformPaketService({ db } as never);
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "depolama@kabul.invalid", rol: "yonetici" }, is);
const kapsam = (sinirBayt: string | null): PaketKapsamSozlesmesi => ({ semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: { kullanici: { sinir: 3, uyariYuzdesi: 80 }, cari: { sinir: 250, uyariYuzdesi: 80 }, stok: { sinir: 500, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 } }, depolama: { sinirBayt, uyariYuzdesi: 80 } });
async function firma() {
  const id = randomUUID(); n++;
  await admin.tenant.create({ data: { id, unvan: "Depolama kabul", vkn: String(8199990100+n) } });
  const a = await admin.tenantAbonelik.create({ data: { tenantId: id, planKodu: "baslangic" } });
  return { id, surumId: a.paketSurumId! };
}
async function ata(f: { id: string; surumId: string }, sinir: string | null) {
  const r = await olarak(() => servis.taslak({ tenantId: f.id, paketSurumId: f.surumId, neden: "Depolama kotası kabulü", baslangic: new Date(Date.now()-1000).toISOString(), bitis: new Date(Date.now()+3600000).toISOString(), kapsamSozlesmesi: kapsam(sinir) }));
  await olarak(() => servis.onayla(f.id, r.id)); return r.id;
}
const ayir = (tid: string, id: string, bayt: number, key: string) => app.tenantIslem(tid, (tx) => tx.$queryRaw`SELECT ek_yukleme_ayir(${id}::uuid,${bayt}::bigint,${key})`);
const dosya = (tenantId: string, boyut: number, depoAnahtari: string) => ({ tenantId, sahipTur: "firma" as const, sahipId: tenantId, boyut, depoAnahtari, dosyaAdi: "kabul.bin", mimeTip: "application/octet-stream" });
beforeAll(async () => { await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Depolama yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } }); });
afterAll(async () => { await Promise.all([admin.$disconnect(),db.$disconnect(),app.$disconnect()]); });

it("eşzamanlı rezervasyon kotayı aşamaz; kendi rezervasyonu kayıt sırasında ikinci kez sayılmaz", async () => {
  const f = await firma(); await ata(f,"8");
  const ids = [randomUUID(),randomUUID()], keys = ids.map((id) => `${f.id}/${id}`);
  const rs = await Promise.allSettled(ids.map((id,i) => ayir(f.id,id,6,keys[i])));
  expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const i = rs.findIndex((r) => r.status === "fulfilled");
  await app.tenantIslem(f.id, async (tx) => { await tx.ek.create({ data: dosya(f.id,6,keys[i]) }); await tx.$queryRaw`SELECT ek_yukleme_kapat(${ids[i]}::uuid,true)`; });
  await expect(app.tenantIslem(f.id,(tx) => tx.ek.create({ data: dosya(f.id,3,`${f.id}/fazla`) }))).rejects.toThrow("ek_depolama_kota_dolu");
  const [r] = await db.$queryRaw<{ sonuc: unknown }[]>`SELECT platform_firma_ek_hacmi(${kisi}::uuid,${f.id}::uuid) AS sonuc`;
  expect(r.sonuc).toMatchObject({ bayt: "6", bekleyenBayt: "0", sinirBayt: "8", kotaUygulaniyor: true });
});

it("iptal ve süre sonu kapasiteyi bırakır; sıfır sınır ilk yüklemeyi engeller", async () => {
  const f = await firma(); await ata(f,"8"); const id = randomUUID();
  await ayir(f.id,id,8,`${f.id}/iptal`);
  await app.tenantIslem(f.id,(tx) => tx.$queryRaw`SELECT ek_yukleme_kapat(${id}::uuid,false)`);
  const eski = randomUUID(); await ayir(f.id,eski,8,`${f.id}/eski`);
  await admin.$executeRaw`UPDATE ek_yukleme_rezervasyonlari SET son_gecerlilik=clock_timestamp()-interval '1 second' WHERE id=${eski}::uuid`;
  await expect(ayir(f.id,randomUUID(),8,`${f.id}/yeni`)).resolves.toBeDefined();
  const z = await firma(); await ata(z,"0");
  await expect(ayir(z.id,randomUUID(),1,`${z.id}/sifir`)).rejects.toThrow("ek_depolama_kota_dolu");
  await expect(admin.ek.create({ data: dosya(z.id,1,`${z.id}/dogrudan`) })).rejects.toThrow("ek_depolama_kota_dolu");
});

it("depolama sözleşmesi katalogda yayınlanır; mevcut hacmin altına atama veya istisna onayı yapılamaz", async () => {
  const f = await firma(); await admin.ek.create({ data: dosya(f.id,6,`${f.id}/mevcut`) });
  await expect(ata(f,"2")).rejects.toThrow("depolama sınırını aşıyor");
  const [taslak] = await admin.$queryRaw<{ id: string }[]>`SELECT id FROM platform_firma_istisna_taslaklari WHERE tenant_id=${f.id}::uuid ORDER BY created_at DESC LIMIT 1`;
  expect(await olarak(() => servis.uygunluk(f.id,taslak.id))).toMatchObject({ kosullarUygun: false, engeller: expect.arrayContaining(["depolama_asimi"]), depolama: { kayitliBayt: "6", hedefSinirBayt: "2" } });
  const p = await olarak(() => paket.olustur({ kod: `depo_${randomUUID().slice(0,8)}`, ad: "Depolama paketi", aciklama: "Kabul", ozellikler: ["Dosya kotası"], siralama: 1, kapsamSozlesmesi: kapsam("2"), fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: ([1,3,6,12] as const).map((aySayisi) => ({ aySayisi, matrah: String(100*aySayisi) })) } }));
  const yayin = await olarak(() => paket.yayinla(p.id,p.surum.id,p.surum.kilitSurumu));
  const o = await olarak(() => paket.atamaOnizle({ surumId: yayin.id, tenantIds: [f.id], uygulamaTarihi: bugunTR(), neden: "Depolama hedef ataması", atamaKapsami: "kapsam" }));
  await expect(olarak(() => paket.atamaUygula(o.id))).rejects.toThrow("depolama sınırını aşıyor");
});

it("Repeatable Read eski rezervasyon toplamıyla kotayı aşamaz", async () => {
  const f = await firma(); await ata(f,"8");
  await expect(app.tenantIslem(f.id, async (tx) => {
    await tx.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: f.id } });
    await ayir(f.id,randomUUID(),6,`${f.id}/ilk`);
    await tx.$queryRaw`SELECT ek_yukleme_ayir(${randomUUID()}::uuid,6::bigint,${`${f.id}/eski`})`;
  }, { isolationLevel: "RepeatableRead" })).rejects.toMatchObject({ code: "P2010", meta: expect.objectContaining({ code: "40001" }) });
});

it("geçici ek kapasite biterse devam eden yükleme tamamlanırken standart sınır yeniden uygulanır", async () => {
  const f = await firma();
  const p = await olarak(() => paket.olustur({ kod: `sure_${randomUUID().slice(0,8)}`, ad: "Standart depolama", aciklama: "Süre sonu kabulü", ozellikler: ["8 bayt"], siralama: 1, kapsamSozlesmesi: kapsam("8"), fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: ([1,3,6,12] as const).map((aySayisi) => ({ aySayisi, matrah: String(100*aySayisi) })) } }));
  const y = await olarak(() => paket.yayinla(p.id,p.surum.id,p.surum.kilitSurumu));
  const o = await olarak(() => paket.atamaOnizle({ surumId: y.id, tenantIds: [f.id], uygulamaTarihi: bugunTR(), neden: "Standart depolama ataması", atamaKapsami: "kapsam" }));
  await olarak(() => paket.atamaUygula(o.id));
  const istisnaId = await ata({ id: f.id, surumId: y.id },"12");
  const rezervasyonId = randomUUID(), key = `${f.id}/gecici`;
  await ayir(f.id,rezervasyonId,10,key);
  await admin.$executeRaw`UPDATE platform_firma_istisna_taslaklari SET bitis=clock_timestamp()-interval '1 millisecond' WHERE id=${istisnaId}::uuid`;
  await expect(app.tenantIslem(f.id,async (tx) => { await tx.ek.create({ data: dosya(f.id,10,key) }); await tx.$queryRaw`SELECT ek_yukleme_kapat(${rezervasyonId}::uuid,true)`; })).rejects.toThrow("ek_depolama_kota_dolu");
  expect(await admin.ek.findUnique({ where: { depoAnahtari: key } })).toBeNull();
  await app.tenantIslem(f.id,(tx) => tx.$queryRaw`SELECT ek_yukleme_kapat(${rezervasyonId}::uuid,false)`);
  await expect(ayir(f.id,randomUUID(),8,`${f.id}/standart`)).resolves.toBeDefined();
});
