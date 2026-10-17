import "reflect-metadata";
import "../src/ayar-tanimlari";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as ExcelJS from "exceljs";
import { PrismaClient, Prisma } from "@prisma/client";
import { beforeAll, afterAll, expect, it } from "vitest";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { maliyetDogrulamasiniOku, maliyetIncelemesiniKapat } from "../src/rapor/maliyet-dogrulama";
import { maliyetTakibiBaslat, maliyetTakibiGuncelle } from "../src/rapor/maliyet-takibi";
import { StokMaliyetService } from "../src/stok/stok-maliyet.service";
import { StokService } from "../src/stok/stok.service";
import { FaturaService } from "../src/fatura/fatura.service";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
import { satisSatirlari } from "../src/stok/satis-ozeti";
import { maliyetEksikleriniOku, maliyetEksigiSorgusu } from "../src/rapor/maliyet-eksikleri";
import { karZararHesapla, karZararVerisi } from "../src/rapor/kar-zarar";
import { RaporService } from "../src/rapor/rapor.service";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { PrismaService } from "../src/core/prisma.service";

// Bu test DATABASE_URL/.env kullanmaz; yalnız geçici konteyner runner'ıyla açılır.
const url = process.env.F01_YARIS_DB_URL;
if (!url || !process.env.F01_YARIS_NONCE) throw new Error("Yalnız node scripts/f01-yaris-kabul.mjs ile çalıştırın.");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || !/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname) || parsed.username !== "tekir_app" || ["5432", "5433"].includes(parsed.port)) throw new Error("Geçici yarış DB kapsamı doğrulanamadı.");
const clients = Array.from({ length: 3 }, () => new PrismaClient({ datasourceUrl: url }));
const [a, b, observer] = clients;
const requireArtifact = createRequire(import.meta.url), artifact = process.env.F01_API_DIST;
const runtime = artifact ? Object.assign({}, ...[
  "ayar-tanimlari.js", "core/prisma.service.js", "rapor/rapor.service.js", "core/ayarlar/ayarlar.service.js", "core/istek-baglami.js", "rapor/maliyet-dogrulama.js", "rapor/maliyet-takibi.js", "stok/stok-maliyet.service.js", "stok/stok.service.js", "fatura/fatura.service.js", "donem-kapatma/donem-kilidi.service.js", "stok/satis-ozeti.js", "rapor/maliyet-eksikleri.js", "rapor/kar-zarar.js",
].map((p) => requireArtifact(resolve(artifact, p)))) : { PrismaService, RaporService, AyarlarService, baglamlaCalistir, maliyetDogrulamasiniOku, maliyetIncelemesiniKapat, maliyetTakibiBaslat, maliyetTakibiGuncelle, StokMaliyetService, StokService, FaturaService, DonemKilidiService, satisSatirlari, maliyetEksikleriniOku, maliyetEksigiSorgusu, karZararHesapla, karZararVerisi };

type Tx = Prisma.TransactionClient;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const outcome = <T>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
beforeAll(async () => {
  const [guard] = await a.$queryRaw<{ db: string; marker: string; rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT current_database() AS db, current_setting('tekir.f01_yaris_nonce', true) AS marker, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  expect(guard).toEqual({ db: parsed.pathname.slice(1), marker: process.env.F01_YARIS_NONCE, rolsuper: false, rolbypassrls: false });
  const rows = await a.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner: boolean }[]>`SELECT relname, relrowsecurity, relforcerowsecurity, relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owner FROM pg_class WHERE relname IN ('stok_hareketleri', 'duzeltme_kayitlari', 'duzeltme_olaylari')`;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity && !r.owner)).toBe(true);
});
afterAll(async () => { await Promise.all(clients.map((c) => c.$disconnect())); });

async function fixture(options: { katsayi?: string; miktar?: string; maliyet?: string; tutar?: string; kur?: string; dovizCinsi?: "TRY" | "USD"; varyant?: "satir" | "hareket" | "ikisi" } = {}) {
  const katsayi = options.katsayi ?? "1", miktar = options.miktar ?? "1", tutar = options.tutar ?? "100";
  const ana = new Prisma.Decimal(miktar).mul(katsayi), mevcut = new Prisma.Decimal(20).sub(ana).toString();
  const tenantId = randomUUID();
  return a.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.tenant.create({ data: { id: tenantId, vkn: tenantId, unvan: "F01 geçici yarış testi" } });
    const user = await tx.user.create({ data: { tenantId, eposta: `${tenantId}@test.local`, parolaHash: "test", adSoyad: "Yarış testi", rol: "yonetici" } });
    await tx.modulAyar.create({ data: { tenantId, modul: "maliyet_kontrolu", ayarlar: { surum: 1, mod: "pilot" } } });
    await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
    const cari = await tx.cariHesap.create({ data: { tenantId, kod: "C", unvan: "Test", tip: "musteri" } });
    const stok = await tx.stokKart.create({ data: { tenantId, kod: "S", ad: "Test", mevcutMiktar: mevcut, ortalamaMaliyet: "20" } });
    const varyant = options.varyant ? await tx.stokVaryant.create({ data: { tenantId, stokId: stok.id, kod: "MAVI", ad: "Mavi", nitelikler: {} } }) : null;
    const birim = await tx.stokBirim.create({ data: { tenantId, stokId: stok.id, ad: "paket", katsayi } });
    const depo = await tx.depo.create({ data: { tenantId, kod: "D", ad: "Test" } });
    await tx.stokDepoBakiye.create({ data: { tenantId, stokId: stok.id, depoId: depo.id, mevcutMiktar: mevcut } });
    const f = await tx.fatura.create({ data: {
      tenantId, cariId: cari.id, tip: "satis", durum: "kesin", tarih: new Date("2026-10-01"), dovizCinsi: options.dovizCinsi ?? "TRY", kur: options.kur ?? "1", toplamBrut: tutar, toplamMatrah: tutar, genelToplam: tutar, toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0",
      satirlar: { create: [{ tenantId, stokId: stok.id, varyantId: options.varyant === "satir" || options.varyant === "ikisi" ? varyant!.id : null, birim: "paket", miktar, birimFiyat: new Prisma.Decimal(tutar).div(miktar), matrah: tutar, toplamTutar: tutar, kdvOrani: "0", kdvTutari: "0", netKdvTutari: "0" }] },
    }, include: { satirlar: true } });
    await tx.stokHareket.create({ data: { tenantId, stokId: stok.id, depoId: depo.id, tip: "giris", miktar: "20", girilenMiktar: "20", girilenBirim: "adet", maliyet: "20", tarih: new Date("2026-09-30"), kaynakTur: "manuel" } });
    const h = await tx.stokHareket.create({ data: { tenantId, stokId: stok.id, depoId: depo.id, tip: "cikis", varyantId: options.varyant === "hareket" || options.varyant === "ikisi" ? varyant!.id : null, miktar: ana.negated(), girilenMiktar: miktar, girilenBirim: "paket", maliyet: "0", tarih: f.tarih, kaynakTur: "fatura", kaynakRef: f.id } });
    await tx.cariHareket.create({ data: { tenantId, cariId: cari.id, tip: "borc", tutar, dovizCinsi: options.dovizCinsi ?? "TRY", kur: options.kur ?? "1", tutarTry: new Prisma.Decimal(tutar).mul(options.kur ?? "1").toDecimalPlaces(2), tarih: f.tarih, kaynakTur: "fatura", kaynakRef: f.id } });
    const kayit = await runtime.maliyetTakibiBaslat(tx, tenantId, user.id, f.satirlar[0].id, "Kaynak araştırılıyor");
    await tx.stokHareket.update({ where: { id: h.id }, data: { maliyet: options.maliyet ?? "10" } });
    return { tenantId, userId: user.id, stokId: stok.id, depoId: depo.id, birimId: birim.id, faturaId: f.id, satirId: f.satirlar[0].id, hareketId: h.id, varyantId: varyant?.id ?? null, kayitId: kayit.kayit.id };
  });
}
type F = Awaited<ReturnType<typeof fixture>>;
async function transaction<T>(db: PrismaClient, f: F, fn: (tx: Tx) => Promise<T>, timeout = 25000) {
  return runtime.baglamlaCalistir({ tenantId: f.tenantId, userId: f.userId, rol: "yonetici" }, () => db.$transaction(async (tx: Tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.tenantId}, true), set_config('app.user_id', ${f.userId}, true), set_config('lock_timeout', '10000ms', true)`;
    return fn(tx);
  }, { timeout }));
}
const preview = (f: F) => transaction(a, f, (tx) => runtime.maliyetDogrulamasiniOku(tx, f.tenantId, f.satirId));
const body = (p: any) => ({ kayitId: p.kayitId, beklenenGuncelleme: p.kayitSurumu, kanit: p.kanit, aciklama: "Kaynak ve hareketler doğrulandı" });
const close = (tx: Tx, f: F, p: any) => runtime.maliyetIncelemesiniKapat(tx, f.tenantId, f.userId, f.satirId, body(p));
async function pid(tx: Tx) { return (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; }
async function blocked(waiter: number, holder: number) {
  expect(waiter).not.toBe(holder);
  const deadline = Date.now() + 5000;
  do {
    const [r] = await observer.$queryRaw<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${waiter}::int) AS blockers`;
    if (r.blockers.includes(holder)) return;
    await new Promise((r) => setTimeout(r, 20));
  } while (Date.now() < deadline);
  throw new Error("İkinci bağlantının ilk transaction kilidinde beklediği doğrulanamadı.");
}
async function race(f: F, first: (tx: Tx) => Promise<unknown>, second: (tx: Tx) => Promise<unknown>) {
  const entered = deferred<number>(), resumed = deferred<void>(), secondPid = deferred<number>();
  const writer = outcome(transaction(a, f, async (tx) => {
    const value = await first(tx); entered.resolve(await pid(tx)); await resumed.promise; return value;
  }));
  let reader: ReturnType<typeof outcome> | undefined;
  try {
    const holder = await Promise.race([entered.promise, writer.then((r) => { throw r.ok ? new Error("İlk işlem beklenmeden bitti") : r.error; })]);
    reader = outcome(transaction(b, f, async (tx) => { secondPid.resolve(await pid(tx)); return second(tx); }));
    const waiter = await secondPid.promise;
    await blocked(waiter, holder);
  } finally {
    resumed.resolve();
    const results = await Promise.all([writer, ...(reader ? [reader] : [])]);
    if (!results[0].ok) throw results[0].error;
  }
  return reader!;
}
async function state(f: F) {
  return transaction(a, f, async (tx) => ({
    kayit: await tx.duzeltmeKaydi.findUniqueOrThrow({ where: { id: f.kayitId } }),
    events: await tx.duzeltmeOlayi.count({ where: { duzeltmeKaydiId: f.kayitId, olayTuru: "kayitli_maliyet_dogrulandi" } }),
    audit: await tx.auditLog.findMany({ where: { varlikId: f.kayitId, islem: "maliyet_incelemesi_kapatildi" } }),
  }));
}
const financial = (f: F) => transaction(a, f, async (tx) => JSON.stringify({ f: await tx.fatura.findUnique({ where: { id: f.faturaId }, include: { satirlar: true } }), hs: await tx.stokHareket.findMany({ where: { stokId: f.stokId }, orderBy: { id: "asc" } }), stok: await tx.stokKart.findUnique({ where: { id: f.stokId } }), cari: await tx.cariHareket.findMany({ orderBy: { id: "asc" } }), maliyetGecmisi: await tx.stokMaliyetDuzeltme.findMany({ orderBy: { id: "asc" } }), donemler: await tx.maliDonem.findMany({ orderBy: { id: "asc" } }), varyantlar: await tx.stokVaryant.findMany({ orderBy: { id: "asc" } }) }));
function conflict(result: any) { expect(result.ok).toBe(false); expect(result.error.getStatus()).toBe(409); }
const recalculate = (tx: Tx, f: F) => new runtime.StokMaliyetService({}).kartiUygula(tx, f.stokId, randomUUID());

const adapter = (tx: Tx) => ({ tenantIslem: (_tenant: string, fn: (t: Tx) => Promise<unknown>) => fn(tx) });
it.each(["kapali", "salt_okunur"])("şirket modu %s önce commit ederse bekleyen gerçek servis kapanışı reddedilir", async (mod) => {
  const f = await fixture(), p = await preview(f), before = await financial(f);
  const result = await race(f,
    (tx) => new runtime.AyarlarService(adapter(tx)).guncelle("maliyet_kontrolu", { mod }),
    (tx) => new runtime.RaporService(adapter(tx)).maliyetIncelemesiniKapat(f.satirId, body(p)));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.getStatus()).toBe(403);
  const s = await state(f); expect(s.kayit.durum).toBe("acik"); expect(s.events).toBe(0); expect(s.audit).toHaveLength(0);
  expect(await financial(f)).toBe(before);
});
it.each(["kapali", "salt_okunur"])("gerçek servis kapanışı önce başlarsa %s ayarı kapanış commit'ini bekler", async (mod) => {
  const f = await fixture(), p = await preview(f), before = await financial(f);
  expect((await race(f,
    (tx) => new runtime.RaporService(adapter(tx)).maliyetIncelemesiniKapat(f.satirId, body(p)),
    (tx) => new runtime.AyarlarService(adapter(tx)).guncelle("maliyet_kontrolu", { mod }))).ok).toBe(true);
  const s = await state(f); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit).toHaveLength(1);
  expect(await financial(f)).toBe(before);
  const rejected = await outcome(transaction(a, f, (tx) => new runtime.RaporService(adapter(tx)).maliyetIncelemesiniKapat(f.satirId, body(p))));
  expect(rejected.ok).toBe(false); if (!rejected.ok) expect(rejected.error.getStatus()).toBe(403);
});

it("gerçek maliyet yeniden hesaplaması önce yazarsa kapanış bekler ve eski kanıtı reddeder", async () => {
  const f = await fixture(), p = await preview(f); expect(p.maliyet).toBe("10.00");
  conflict(await race(f, (tx) => recalculate(tx, f), (tx) => close(tx, f, p)));
  const s = await state(f); expect(s.kayit.durum).toBe("acik"); expect(s.audit).toHaveLength(0); expect(s.events).toBe(0);
  const fresh = await preview(f); expect(fresh).toMatchObject({ uygun: true, maliyet: "20.00" });
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, fresh)); expect(await financial(f)).toBe(before);
});

it("kapanış önce yazarsa gerçek maliyet uygulaması commit'i bekler; kapanış kanıtı tarihsel olarak korunur", async () => {
  const f = await fixture(), p = await preview(f);
  expect((await race(f, (tx) => close(tx, f, p), (tx) => recalculate(tx, f))).ok).toBe(true);
  const s = await state(f); expect(s.kayit.durum).toBe("cozuldu"); expect(s.audit).toHaveLength(1); expect(s.audit[0].detay).toMatchObject({ maliyet: "10.00", kanit: p.kanit });
  expect((await preview(f)).maliyet).toBe("20.00");
});

it("iki eşzamanlı kapanıştan yalnız biri çözüm olayı ve audit üretir; mali kayıtlar değişmez", async () => {
  const f = await fixture(), p = await preview(f), before = await financial(f);
  conflict(await race(f, (tx) => close(tx, f, p), (tx) => close(tx, f, p)));
  const s = await state(f); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit).toHaveLength(1); expect(await financial(f)).toBe(before);
});

it("gerçek faturayı taslağa geri alma kapanıştan önce commit ederse eski kanıt reddedilir", async () => {
  const f = await fixture(), p = await preview(f);
  conflict(await race(f, async (tx) => {
    // Gerçek servis sorguları aynı açık transaction'a yönlenir; bağlı belge fixture'da yoktur.
    const prisma = { tenantIslem: (_tenant: string, fn: (t: Tx) => Promise<unknown>) => fn(tx) };
    const donem = new runtime.DonemKilidiService(prisma);
    const stok = new runtime.StokService(prisma, undefined, undefined, donem);
    const belgeler = { zincirEtkisiniCoz: async (_tx: Tx, ids: string[]) => { expect(ids).toEqual([]); } };
    const service = new runtime.FaturaService(prisma, stok, undefined, undefined, undefined, belgeler, donem);
    return service.taslagaGeriAl(f.faturaId);
  }, (tx) => close(tx, f, p)));
  const s = await state(f); expect(s.kayit.durum).toBe("acik"); expect(s.events).toBe(0); expect(s.audit).toHaveLength(0);
  expect((await preview(f)).uygun).toBe(false);
  await transaction(a, f, async (tx) => {
    expect((await tx.fatura.findUniqueOrThrow({ where: { id: f.faturaId } })).durum).toBe("taslak");
    expect(await tx.stokHareket.count({ where: { kaynakRef: f.faturaId, kaynakTur: "fatura_geri_alma" } })).toBe(1);
  });
});

it("birim katsayısı değişirken kapanış güncel birimi bekler ve eski kanıtla kapanmaz", async () => {
  const f = await fixture(), p = await preview(f);
  conflict(await race(f, (tx) => tx.stokBirim.update({ where: { id: f.birimId }, data: { katsayi: "2" } }), (tx) => close(tx, f, p)));
  const s = await state(f); expect(s.kayit.durum).toBe("acik"); expect(s.audit).toHaveLength(0); expect((await preview(f)).uygun).toBe(false);
});

it("eşzamanlı inceleme notu sürümü değiştirirse eski kanıtla kapanış yapılmaz", async () => {
  const f = await fixture(), p = await preview(f);
  conflict(await race(f, (tx) => runtime.maliyetTakibiGuncelle(tx, f.tenantId, f.userId, f.satirId, { aciklama: "Yeni kaynak araştırılıyor", durum: "beklemede", beklenenGuncelleme: p.kayitSurumu }), (tx) => close(tx, f, p)));
  const s = await state(f); expect(s.kayit.durum).toBe("beklemede"); expect(s.events).toBe(0); expect(s.audit).toHaveLength(0);
});

it("kapanış önce yazarsa birim katsayısı yazımı commit'i bekler; tarihsel kanıt korunur", async () => {
  const f = await fixture(), p = await preview(f);
  expect((await race(f, (tx) => close(tx, f, p), (tx) => tx.stokBirim.update({ where: { id: f.birimId }, data: { katsayi: "2" } }))).ok).toBe(true);
  const s = await state(f); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit).toHaveLength(1);
  expect(s.audit[0].detay).toMatchObject({ kanit: p.kanit, maliyet: "10.00" });
  expect((await preview(f)).uygun).toBe(false);
});

it.each(["satir", "hareket"] as const)("varyant yalnız %s üzerindeyse eşleşmeyen kaynak kapatılamaz", async (varyant) => {
  const f = await fixture({ varyant }), p = await preview(f), before = await financial(f);
  expect(p.uygun).toBe(false); expect(p.kanit).toBeNull();
  conflict(await outcome(transaction(a, f, (tx) => close(tx, f, { ...p, kanit: "a".repeat(64) }))));
  expect(await financial(f)).toBe(before);
  const s = await state(f); expect(s.kayit.durum).toBe("acik"); expect(s.events).toBe(0); expect(s.audit).toHaveLength(0);
});

it.each([true, false])("varyant maliyeti başka varyantı gizlemez; ilk satır varyantlı=%s", async (ilkVaryantli) => {
  const f = await fixture(ilkVaryantli ? { varyant: "ikisi" } : {});
  const ikinci = await transaction(a, f, async (tx) => {
    const v = await tx.stokVaryant.create({ data: { tenantId: f.tenantId, stokId: f.stokId, kod: "KIRMIZI", ad: "Kırmızı", nitelikler: {} } });
    const s = await tx.faturaSatir.create({ data: { tenantId: f.tenantId, faturaId: f.faturaId, stokId: f.stokId, varyantId: v.id, birim: "paket", miktar: "1", birimFiyat: "100", matrah: "100", toplamTutar: "100", kdvOrani: "0", kdvTutari: "0", netKdvTutari: "0" } });
    await tx.fatura.update({ where: { id: f.faturaId }, data: { toplamBrut: "200", toplamMatrah: "200", genelToplam: "200" } });
    const belge = await tx.fatura.findUniqueOrThrow({ where: { id: f.faturaId } });
    await tx.cariHareket.create({ data: { tenantId: f.tenantId, cariId: belge.cariId, tip: "borc", tutar: "100", tutarTry: "100", tarih: belge.tarih, kaynakTur: "fatura", kaynakRef: belge.id } });
    return s;
  });
  await transaction(a, f, async (tx) => {
    const rows = await runtime.satisSatirlari(tx, {}, f.faturaId);
    expect(rows.find((r: any) => r.faturaSatirId === f.satirId).maliyet.toFixed(2)).toBe("10.00");
    expect(rows.find((r: any) => r.faturaSatirId === ikinci.id).maliyet.toFixed(2)).toBe("0.00");
    const q = runtime.maliyetEksigiSorgusu({ baslangic: "2026-10-01", bitis: "2026-10-15" });
    const list = await runtime.maliyetEksikleriniOku(tx, f.tenantId, q);
    expect(list.donemOzeti).toEqual({ satir: 1, ciro: "100.00" });
    expect(list.satirlar).toHaveLength(1);
    expect(list.satirlar[0]).toMatchObject({ id: ikinci.id, varyantKod: "KIRMIZI", varyantAd: "Kırmızı", neden: "hareket_yok" });
    const data = await runtime.karZararVerisi(tx, f.tenantId, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-15T23:59:59.999Z"));
    const report = runtime.karZararHesapla(data.kalemler, data.satirlar);
    expect(report.maliyetsizSatis).toEqual({ satir: 1, ciro: 100 });
    expect(report.smm).toBe(10);
    expect(report).toMatchObject({ netSatis: 200, netKar: 190 });
    const yeni = await runtime.maliyetTakibiBaslat(tx, f.tenantId, f.userId, ikinci.id, "Varyant hareketi eksik");
    expect(yeni.kayit.aciklama).toContain("KIRMIZI");
  });
});

it.each([
  { katsayi: "12", miktar: "1", beklenen: "120.00" },
  { katsayi: "0.4", miktar: "0.125", beklenen: "0.50" },
])("bilinen ek birim ve hassas miktar tam kapsamla kapanabilir: %j", async ({ katsayi, miktar, beklenen }) => {
  const f = await fixture({ katsayi, miktar }), p = await preview(f);
  expect(p).toMatchObject({ uygun: true, maliyet: beklenen });
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
  expect((await state(f)).kayit.durum).toBe("cozuldu");
});

it.each(["tanimsiz", "sifir_katsayi"])("%s birimde varsayımla kapanış yapılamaz", async (tur) => {
  const f = await fixture();
  await transaction(a, f, (tx) => tur === "tanimsiz"
    ? tx.faturaSatir.update({ where: { id: f.satirId }, data: { birim: "tanimsiz" } })
    : tx.stokBirim.update({ where: { id: f.birimId }, data: { katsayi: "0" } }));
  const p = await preview(f); expect(p.uygun).toBe(false); expect(p.kanit).toBeNull();
  conflict(await outcome(transaction(a, f, (tx) => close(tx, f, { ...p, kanit: "a".repeat(64) }))));
  expect((await state(f)).kayit.durum).toBe("acik");
});

it("kuruşa yuvarlandığında sıfır kalan çok küçük maliyette kapanış açılmaz", async () => {
  const f = await fixture({ miktar: "0.001", maliyet: "0.0001" });
  expect(await preview(f)).toMatchObject({ uygun: false, maliyet: "0.00", kanit: null });
  expect((await state(f)).audit).toHaveLength(0);
});

it("büyük kayıtlı maliyet ve döviz ciro kuruşları tutarlı kalır; kapanış tutar yazmaz", async () => {
  const f = await fixture({ miktar: "3", maliyet: "123456789.1234", tutar: "1000.01", dovizCinsi: "USD", kur: "40.25" }), p = await preview(f);
  expect(p).toMatchObject({ uygun: true, maliyet: "370370367.37", ciro: "40250.40" });
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
});

async function donemiKapat(f: F) {
  await transaction(a, f, (tx) => tx.maliDonem.create({ data: { tenantId: f.tenantId, yil: 2026, ay: 10, durum: "kapali", kapatildiAt: new Date() } }));
}

it("kapalı dönemde gerçek maliyet uygulaması eksik eski maliyeti doldurmaz; inceleme açık kalır", async () => {
  const f = await fixture({ maliyet: "0" }); await donemiKapat(f);
  const protectedRows = () => transaction(a, f, async (tx) => JSON.stringify({ hs: await tx.stokHareket.findMany({ orderBy: { id: "asc" } }), gecmis: await tx.stokMaliyetDuzeltme.findMany({ orderBy: { id: "asc" } }) }));
  const before = await protectedRows();
  const result = await transaction(a, f, (tx) => recalculate(tx, f)); expect(result).toBeNull();
  expect(await protectedRows()).toBe(before); expect((await preview(f)).uygun).toBe(false);
  expect((await state(f)).kayit.durum).toBe("acik");
});

it("kapalı dönem hareket yazımını DB de reddeder; kayıtlı maliyetle takip kapanışı mali tutar ve dönem durumunu değiştirmez", async () => {
  const f = await fixture(); await donemiKapat(f);
  await expect(transaction(a, f, (tx) => tx.stokHareket.update({ where: { id: f.hareketId }, data: { maliyet: "20" } }))).rejects.toThrow("Mali dönem kapalı");
  const p = await preview(f); expect(p.uygun).toBe(true);
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
  expect((await state(f)).kayit.durum).toBe("cozuldu");
});

it("kapalı dönemde gerçek fatura geri alma servisi hareket yazmadan durur", async () => {
  const f = await fixture(); await donemiKapat(f); const before = await financial(f);
  const result = await outcome(transaction(a, f, async (tx) => {
    const prisma = { tenantIslem: (_tenant: string, fn: (t: Tx) => Promise<unknown>) => fn(tx) };
    const donem = new runtime.DonemKilidiService(prisma), stok = new runtime.StokService(prisma, undefined, undefined, donem);
    const service = new runtime.FaturaService(prisma, stok, undefined, undefined, undefined, undefined, donem);
    return service.taslagaGeriAl(f.faturaId);
  }));
  conflict(result); expect(await financial(f)).toBe(before); expect((await state(f)).kayit.durum).toBe("acik");
});

it("eşleşen varyantın kayıtlı maliyetiyle kapanış açılır ve varyant denetim izinde korunur", async () => {
  const f = await fixture({ varyant: "ikisi" }), p = await preview(f);
  expect(p).toMatchObject({ uygun: true, varyantId: f.varyantId, varyantKod: "MAVI", kapsamSatirSayisi: 1, kapsamMiktari: "1", hareketSayisi: 1, maliyet: "10.00" });
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
  const s = await state(f); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit).toHaveLength(1);
  expect(s.audit[0].detay).toMatchObject({ varyantId: f.varyantId, varyantKod: "MAVI", kapsamSatirSayisi: 1, kapsamMiktari: "1", kanit: p.kanit });
});

async function extraLine(tx: Tx, f: F, varyantId: string | null, miktar = "1", birim = "paket") {
  const row = await tx.faturaSatir.create({ data: { tenantId: f.tenantId, faturaId: f.faturaId, stokId: f.stokId, varyantId, birim, miktar, birimFiyat: new Prisma.Decimal(100).div(miktar), matrah: "100", toplamTutar: "100", kdvOrani: "0", kdvTutari: "0", netKdvTutari: "0" } });
  const inv = await tx.fatura.update({ where: { id: f.faturaId }, data: { toplamBrut: { increment: 100 }, toplamMatrah: { increment: 100 }, genelToplam: { increment: 100 } } });
  await tx.cariHareket.create({ data: { tenantId: f.tenantId, cariId: inv.cariId, tip: "borc", tutar: "100", tutarTry: "100", tarih: inv.tarih, kaynakTur: "fatura", kaynakRef: inv.id } });
  return row;
}
const extraExit = (tx: Tx, f: F, varyantId: string | null, miktar: string, maliyet: string) => tx.stokHareket.create({ data: { tenantId: f.tenantId, stokId: f.stokId, varyantId, tip: "cikis", depoId: f.depoId, miktar, girilenBirim: "adet", girilenMiktar: new Prisma.Decimal(miktar).abs(), maliyet, tarih: new Date("2026-10-01"), kaynakTur: "fatura", kaynakRef: f.faturaId } });

it("aynı varyantın çoklu satırı birlikte doğrulanır; diğer varyantın eksik satırı ve kaydı açık kalır", async () => {
  const f = await fixture({ varyant: "ikisi" });
  const other = await transaction(a, f, async (tx) => {
    await extraLine(tx, f, f.varyantId, "2", "adet"); await extraExit(tx, f, f.varyantId, "-2", "10");
    const v = await tx.stokVaryant.create({ data: { tenantId: f.tenantId, stokId: f.stokId, kod: "KIRMIZI", ad: "Kırmızı", nitelikler: {} } });
    const line = await extraLine(tx, f, v.id);
    const record = await runtime.maliyetTakibiBaslat(tx, f.tenantId, f.userId, line.id, "Diğer varyantın hareketi bekleniyor");
    return { lineId: line.id, recordId: record.kayit.id };
  });
  const p = await preview(f); expect(p).toMatchObject({ uygun: true, kapsamSatirSayisi: 2, kapsamMiktari: "3", hareketSayisi: 2, maliyet: "10.00" });
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
  await transaction(a, f, async (tx) => {
    const list = await runtime.maliyetEksikleriniOku(tx, f.tenantId, runtime.maliyetEksigiSorgusu({ baslangic: "2026-10-01", bitis: "2026-10-15" }));
    expect(list.donemOzeti).toEqual({ satir: 1, ciro: "100.00" }); expect(list.satirlar[0].id).toBe(other.lineId);
    expect((await tx.duzeltmeKaydi.findUniqueOrThrow({ where: { id: other.recordId } })).durum).toBe("acik");
  });
});

it("aynı varyantta kısmi sıfır maliyet başka varyantın pozitif maliyetiyle tamamlanmış sayılmaz", async () => {
  const f = await fixture({ varyant: "ikisi" });
  await transaction(a, f, async (tx) => {
    await extraLine(tx, f, f.varyantId); await extraExit(tx, f, f.varyantId, "-1", "0");
    const v = await tx.stokVaryant.create({ data: { tenantId: f.tenantId, stokId: f.stokId, kod: "KIRMIZI", ad: "Kırmızı", nitelikler: {} } });
    await extraLine(tx, f, v.id); await extraExit(tx, f, v.id, "-1", "100");
  });
  const p = await preview(f); expect(p).toMatchObject({ uygun: false, maliyet: "5.00", kapsamSatirSayisi: 2, hareketSayisi: 2, kanit: null });
  conflict(await outcome(transaction(a, f, (tx) => close(tx, f, { ...p, kanit: "a".repeat(64) }))));
  expect((await state(f)).kayit.durum).toBe("acik");
});

it("satış satırı karşılığı olmayan varyant hareketi varsa uygun görünen hedef de kapatılmaz", async () => {
  const f = await fixture({ varyant: "ikisi" });
  await transaction(a, f, async (tx) => {
    const v = await tx.stokVaryant.create({ data: { tenantId: f.tenantId, stokId: f.stokId, kod: "BELIRSIZ", ad: "Belirsiz", nitelikler: {} } });
    await extraExit(tx, f, v.id, "-1", "10");
  });
  const p = await preview(f); expect(p.uygun).toBe(false); expect(p.neden).toContain("karşılığı olmayan");
});

it("başka ürünün varyantı satış ve harekette yazsa bile kapanışa uygun değildir", async () => {
  const f = await fixture({ varyant: "ikisi" });
  await transaction(a, f, async (tx) => {
    const stock = await tx.stokKart.create({ data: { tenantId: f.tenantId, kod: "DIGER", ad: "Diğer" } });
    const v = await tx.stokVaryant.create({ data: { tenantId: f.tenantId, stokId: stock.id, kod: "YANLIS", ad: "Yanlış ürün", nitelikler: {} } });
    await tx.faturaSatir.update({ where: { id: f.satirId }, data: { varyantId: v.id } }); await extraExit(tx, f, v.id, "-1", "10");
  });
  const p = await preview(f); expect(p.uygun).toBe(false); expect(p.neden).toContain("aynı ürününe ait değil");
});

it("önizleme sonrası varyant kimliği değişirse eski kanıtla kapanış reddedilir", async () => {
  const f = await fixture({ varyant: "ikisi" }), p = await preview(f);
  await transaction(a, f, (tx) => tx.stokVaryant.update({ where: { id: f.varyantId! }, data: { kod: "MAVI-YENI" } }));
  conflict(await outcome(transaction(a, f, (tx) => close(tx, f, p)))); expect((await state(f)).audit).toHaveLength(0);
  expect((await preview(f)).kanit).not.toBe(p.kanit);
});

it("varyant kimliği yazımı önceyse kapanış kilitte bekler ve eski kanıtı reddeder", async () => {
  const f = await fixture({ varyant: "ikisi" }), p = await preview(f);
  conflict(await race(f, (tx) => tx.stokVaryant.update({ where: { id: f.varyantId! }, data: { kod: "MAVI-YENI" } }), (tx) => close(tx, f, p)));
  expect((await state(f)).kayit.durum).toBe("acik");
});

it("varyant kapanışı önceyse kimlik yazımı bekler; audit kapanış anındaki kodu korur", async () => {
  const f = await fixture({ varyant: "ikisi" }), p = await preview(f);
  expect((await race(f, (tx) => close(tx, f, p), (tx) => tx.stokVaryant.update({ where: { id: f.varyantId! }, data: { kod: "MAVI-YENI" } }))).ok).toBe(true);
  expect((await state(f)).audit[0].detay).toMatchObject({ varyantId: f.varyantId, varyantKod: "MAVI", kanit: p.kanit });
});

it("pasife alınmış varyantın tarihsel pozitif maliyetiyle takip kapanabilir", async () => {
  const f = await fixture({ varyant: "ikisi" });
  await transaction(a, f, (tx) => tx.stokVaryant.update({ where: { id: f.varyantId! }, data: { aktif: false } }));
  const p = await preview(f); expect(p.uygun).toBe(true);
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
});

it("kapalı dönemde doğru varyant kaynağıyla takip kapanışı mali kayıt ve dönemi değiştirmez", async () => {
  const f = await fixture({ varyant: "ikisi" }); await donemiKapat(f);
  const p = await preview(f); expect(p.uygun).toBe(true);
  const before = await financial(f); await transaction(a, f, (tx) => close(tx, f, p)); expect(await financial(f)).toBe(before);
  expect((await state(f)).kayit.durum).toBe("cozuldu");
});

it("aynı faturanın iki sağlıklı varyantı eşzamanlı kapatılırken her kayıt kendi kanıtıyla bir kez kapanır", async () => {
  const f = await fixture({ varyant: "ikisi" });
  const other = await transaction(a, f, async (tx) => {
    const v = await tx.stokVaryant.create({ data: { tenantId: f.tenantId, stokId: f.stokId, kod: "KIRMIZI", ad: "Kırmızı", nitelikler: {} } });
    const line = await extraLine(tx, f, v.id);
    const record = await runtime.maliyetTakibiBaslat(tx, f.tenantId, f.userId, line.id, "İkinci varyantın hareketi inceleniyor");
    await extraExit(tx, f, v.id, "-1", "20");
    return { ...f, satirId: line.id, kayitId: record.kayit.id, varyantId: v.id };
  });
  const p = await preview(f), pOther = await preview(other), before = await financial(f);
  expect(p.uygun).toBe(true); expect(pOther.uygun).toBe(true);
  expect((await race(f, (tx) => close(tx, f, p), (tx) => close(tx, other, pOther))).ok).toBe(true);
  for (const source of [f, other]) {
    const s = await state(source); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit).toHaveLength(1);
    expect(s.audit[0].detay).toMatchObject({ varyantId: source.varyantId });
  }
  expect(await financial(f)).toBe(before);
});

async function multiFixture() {
  const first = await fixture();
  const second = await transaction(a, first, async (tx) => {
    const stock = await tx.stokKart.create({ data: { tenantId: first.tenantId, kod: "S2", ad: "İkinci ürün", mevcutMiktar: "19", ortalamaMaliyet: "40" } });
    await tx.stokDepoBakiye.create({ data: { tenantId: first.tenantId, stokId: stock.id, depoId: first.depoId, mevcutMiktar: "19" } });
    const source = { ...first, stokId: stock.id };
    const line = await extraLine(tx, source, null, "1", "adet");
    await tx.stokHareket.create({ data: { tenantId: first.tenantId, stokId: stock.id, depoId: first.depoId, tip: "giris", miktar: "20", girilenMiktar: "20", girilenBirim: "adet", maliyet: "40", tarih: new Date("2026-09-30"), kaynakTur: "manuel" } });
    const h = await extraExit(tx, source, null, "-1", "0");
    const record = await runtime.maliyetTakibiBaslat(tx, first.tenantId, first.userId, line.id, "İkinci ürün inceleniyor");
    await tx.stokHareket.update({ where: { id: h.id }, data: { maliyet: "15" } });
    return { ...source, satirId: line.id, kayitId: record.kayit.id, hareketId: h.id };
  });
  return [first, second] as const;
}
const realClose = (tx: Tx, f: F, p: any) => new runtime.RaporService(adapter(tx)).maliyetIncelemesiniKapat(f.satirId, body(p));
function reverseInvoice(tx: Tx, f: F) {
  const prisma = adapter(tx), donem = new runtime.DonemKilidiService(prisma);
  const stok = new runtime.StokService(prisma, undefined, undefined, donem);
  const belgeler = { zincirEtkisiniCoz: async (_tx: Tx, ids: string[]) => { expect(ids).toEqual([]); } };
  return new runtime.FaturaService(prisma, stok, undefined, undefined, undefined, belgeler, donem).taslagaGeriAl(f.faturaId);
}
async function allFinancial(f: F) {
  return transaction(a, f, async (tx) => JSON.stringify({
    f: await tx.fatura.findMany({ include: { satirlar: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
    h: await tx.stokHareket.findMany({ orderBy: { id: "asc" } }), s: await tx.stokKart.findMany({ orderBy: { id: "asc" } }),
    d: await tx.stokDepoBakiye.findMany({ orderBy: { id: "asc" } }), c: await tx.cariHareket.findMany({ orderBy: { id: "asc" } }),
    m: await tx.stokMaliyetDuzeltme.findMany({ orderBy: { id: "asc" } }),
  }));
}
it("aynı faturanın iki farklı ürün incelemesi eşzamanlı kapanır; mali kaynaklar korunur", async () => {
  const [f, other] = await multiFixture(), p = await preview(f), op = await preview(other), before = await allFinancial(f);
  expect((await race(f, (tx) => realClose(tx, f, p), (tx) => realClose(tx, other, op))).ok).toBe(true);
  for (const source of [f, other]) {
    const s = await state(source); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit).toHaveLength(1);
    expect(s.audit[0].detay).toMatchObject({ stokId: source.stokId, satirId: source.satirId });
  }
  expect(await allFinancial(f)).toBe(before);
});
it.each([0, 1])("çok ürünlü gerçek fatura geri alma önceyse stok kilidi sırası %s olan inceleme eski kanıtla kapanmaz", async (index) => {
  const sources = await multiFixture(), f = [...sources].sort((x, y) => x.stokId.localeCompare(y.stokId))[index], p = await preview(f);
  conflict(await race(f, (tx) => reverseInvoice(tx, f), (tx) => realClose(tx, f, p)));
  for (const source of sources) {
    expect((await state(source)).kayit.durum).toBe("acik"); expect((await state(source)).events).toBe(0);
    expect((await preview(source)).uygun).toBe(false);
  }
  await transaction(a, f, async (tx) => {
    expect(await tx.stokHareket.count({ where: { kaynakRef: f.faturaId, kaynakTur: "fatura_geri_alma" } })).toBe(2);
    expect((await tx.stokKart.findMany()).every((s) => s.mevcutMiktar.eq(20))).toBe(true);
    expect((await tx.fatura.findUniqueOrThrow({ where: { id: f.faturaId } })).durum).toBe("taslak");
  });
});
it.each([0, 1])("stok kilidi sırası %s olan inceleme önce kapanırsa çok ürünlü geri alma bekler; tarihsel kanıt korunur", async (index) => {
  const sources = await multiFixture(), f = [...sources].sort((x, y) => x.stokId.localeCompare(y.stokId))[index], p = await preview(f);
  expect((await race(f, (tx) => realClose(tx, f, p), (tx) => reverseInvoice(tx, f))).ok).toBe(true);
  const s = await state(f); expect(s.kayit.durum).toBe("cozuldu"); expect(s.events).toBe(1); expect(s.audit[0].detay).toMatchObject({ kanit: p.kanit, maliyet: p.maliyet });
  expect((await state(sources.find((x) => x !== f)!)).kayit.durum).toBe("acik");
  await transaction(a, f, async (tx) => {
    expect(await tx.stokHareket.count({ where: { kaynakRef: f.faturaId, kaynakTur: "fatura_geri_alma" } })).toBe(2);
    expect((await tx.stokKart.findMany()).every((s) => s.mevcutMiktar.eq(20))).toBe(true);
  });
});

it("gerçek toplu maliyet uygulamasında ilk kart commit olur; ikinci kartı bekleyen kapanış eski kanıtı reddeder", async () => {
  const [f, other] = await multiFixture(), p = await preview(f), op = await preview(other);
  const entered = deferred<number>(), release = deferred<void>(), closingPid = deferred<number>();
  const bulk = outcome(runtime.baglamlaCalistir({ tenantId: f.tenantId, userId: f.userId, rol: "yonetici" }, () => new runtime.StokMaliyetService({
    tenantIslem: (_tenant: string, fn: (tx: Tx) => Promise<any>) => transaction(a, f, async (tx) => {
      const result = await fn(tx);
      if (result?.stokId === other.stokId) { entered.resolve(await pid(tx)); await release.promise; }
      return result;
    }),
  }).uygula()));
  let closing: ReturnType<typeof outcome> | undefined;
  try {
    const holder = await Promise.race([entered.promise, bulk.then((r) => { throw r.ok ? new Error("Toplu işlem beklenmeden bitti") : r.error; })]);
    await transaction(b, f, async (tx) => { expect((await tx.stokHareket.findUniqueOrThrow({ where: { id: f.hareketId } })).maliyet.toString()).toBe("20"); });
    closing = outcome(transaction(b, other, async (tx) => { closingPid.resolve(await pid(tx)); return realClose(tx, other, op); }));
    await blocked(await closingPid.promise, holder);
  } finally { release.resolve(); await bulk; if (closing) await closing; }
  const result = await bulk; expect(result.ok).toBe(true); if (result.ok) expect(result.value).toMatchObject({ degisenHareket: 2 });
  conflict(await closing!);
  conflict(await outcome(transaction(a, f, (tx) => realClose(tx, f, p))));
  for (const [source, cost] of [[f, "20.00"], [other, "40.00"]] as const) {
    const fresh = await preview(source); expect(fresh.maliyet).toBe(cost);
    const before = await allFinancial(source); await transaction(a, source, (tx) => realClose(tx, source, fresh)); expect(await allFinancial(source)).toBe(before);
  }
  await transaction(a, f, async (tx) => {
    const history = await tx.stokMaliyetDuzeltme.findMany(); expect(history).toHaveLength(2); expect(new Set(history.map((h) => h.calismaId)).size).toBe(1);
    const audit = await tx.auditLog.findMany({ where: { islem: "stok_maliyet_yeniden_hesap" } }); expect(audit).toHaveLength(1); expect(audit[0].detay).toMatchObject({ kartSayisi: 2, hareketSayisi: 2, kapsam: "tum" });
  });
});

it("toplu maliyetin ikinci kartı hata verirse ilk kart kalır; her inceleme kendi güncel kaynağına göre kapanır", async () => {
  const [f, other] = await multiFixture(), p = await preview(f), op = await preview(other);
  const failure = new Error("İkinci kart transaction hata enjeksiyonu");
  const result = await outcome(runtime.baglamlaCalistir({ tenantId: f.tenantId, userId: f.userId, rol: "yonetici" }, () => new runtime.StokMaliyetService({
    tenantIslem: (_tenant: string, fn: (tx: Tx) => Promise<any>) => transaction(a, f, async (tx) => {
      const value = await fn(tx); if (value?.stokId === other.stokId) throw failure; return value;
    }),
  }).uygula()));
  expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toBe(failure);
  await transaction(a, f, async (tx) => {
    expect((await tx.stokHareket.findUniqueOrThrow({ where: { id: f.hareketId } })).maliyet.toString()).toBe("20");
    expect((await tx.stokHareket.findUniqueOrThrow({ where: { id: other.hareketId } })).maliyet.toString()).toBe("15");
    expect(await tx.stokMaliyetDuzeltme.count()).toBe(1); expect(await tx.auditLog.count({ where: { islem: "stok_maliyet_yeniden_hesap" } })).toBe(0);
  });
  conflict(await outcome(transaction(a, f, (tx) => realClose(tx, f, p))));
  const before = await allFinancial(f);
  await transaction(a, other, (tx) => realClose(tx, other, op));
  await transaction(a, f, async (tx) => realClose(tx, f, await runtime.maliyetDogrulamasiniOku(tx, f.tenantId, f.satirId)));
  expect(await allFinancial(f)).toBe(before);
});

it("2.000/10.000/20.000 satırda liste ve tam Excel tutarlıdır; 20.001 satır kısmi sonuç üretmez", async () => {
  const f = await fixture({ maliyet: "0", tutar: "0.10" }), q = { baslangic: "2026-10-01", bitis: "2026-10-15", sayfa: 2, sayfaBoyutu: 100 };
  const reader = new runtime.RaporService({ tenantIslem: (_tenant: string, fn: (tx: Tx) => Promise<any>) => transaction(a, f, fn, 5000) });
  const inContext = <T>(fn: () => Promise<T>) => runtime.baglamlaCalistir({ tenantId: f.tenantId, userId: f.userId, rol: "yonetici" }, fn);
  let seeded = 1;
  for (const count of [2000, 10000, 20000]) {
    await transaction(a, f, async (tx) => {
      for (let start = seeded; start < count; start += 1000) {
        await tx.faturaSatir.createMany({ data: Array.from({ length: Math.min(1000, count - start) }, () => ({ tenantId: f.tenantId, faturaId: f.faturaId, stokId: f.stokId, miktar: "1", birim: "adet", birimFiyat: "0.10", matrah: "0.10", toplamTutar: "0.10", kdvOrani: "0", kdvTutari: "0", netKdvTutari: "0" })) });
      }
      const total = new Prisma.Decimal(count).mul("0.10");
      const invoice = await tx.fatura.update({ where: { id: f.faturaId }, data: { toplamBrut: total, toplamMatrah: total, genelToplam: total } });
      const delta = new Prisma.Decimal(count - seeded).mul("0.10");
      await tx.cariHareket.create({ data: { tenantId: f.tenantId, cariId: invoice.cariId, tip: "borc", tutar: delta, tutarTry: delta, tarih: invoice.tarih, kaynakTur: "fatura", kaynakRef: invoice.id } });
      await extraExit(tx, f, null, String(seeded - count), "0");
      await tx.stokKart.update({ where: { id: f.stokId }, data: { mevcutMiktar: 20 - count } });
      await tx.stokDepoBakiye.updateMany({ where: { stokId: f.stokId }, data: { mevcutMiktar: 20 - count } });
    }, 60000);
    seeded = count;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now(), list = await inContext(() => reader.maliyetEksikleri(q)); times.push(Math.round(performance.now() - start));
      expect(list.donemOzeti).toEqual({ satir: count, ciro: new Prisma.Decimal(count).mul("0.10").toFixed(2) }); expect(list.satirlar).toHaveLength(100); expect(list.toplamSayfa).toBe(count / 100);
    }
    console.log(`F01_HACIM ${JSON.stringify({ satir: count, listeMs: times, dbTimeoutMs: 5000 })}`);
  }
  const start = performance.now(), excel = await inContext(() => reader.maliyetEksikleriExcel(q));
  const excelMs = Math.round(performance.now() - start), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(excel.dosya as never);
  const sheet = workbook.getWorksheet("Satışlar")!; expect(sheet.rowCount).toBe(20001);
  expect(new Set(sheet.getColumn(11).values.slice(2)).size).toBe(20000); expect(workbook.getWorksheet("Özet")!.getCell("B11").value).toBe(2000);
  const summary = await transaction(a, f, async (tx) => runtime.karZararHesapla([], await runtime.satisSatirlari(tx, { gte: new Date("2026-10-01"), lte: new Date("2026-10-15") })), 5000);
  expect(summary.maliyetsizSatis).toEqual({ satir: 20000, ciro: 2000 });
  const tracking = await inContext(() => reader.maliyetIzleme({ baslangic: q.baslangic, bitis: q.bitis }));
  expect(tracking).toMatchObject({ kapsam: { malSatisSatiri: 20000, takipliKaynakSatiri: 1 }, uyari: { satir: 20000, ciro: "2000.00", aktifTakipliSatir: 1, aktifTakipsizSatir: 19999 }, incelemeler: { toplam: 1, acik: 1, medyanSureSaniye: null } });
  console.log(`F01_HACIM ${JSON.stringify({ satir: 20000, excelMs, excelBytes: excel.dosya.length })}`);
  await transaction(a, f, (tx) => tx.faturaSatir.create({ data: { tenantId: f.tenantId, faturaId: f.faturaId, stokId: f.stokId, miktar: "1", birimFiyat: "0.10", matrah: "0.10", toplamTutar: "0.10", kdvOrani: "0", kdvTutari: "0", netKdvTutari: "0" } }));
  for (const fn of [() => reader.maliyetEksikleri({ ...q, stokId: randomUUID() }), () => reader.maliyetEksikleriExcel(q), () => reader.maliyetIzleme({ baslangic: q.baslangic, bitis: q.bitis })]) {
    const result = await outcome(inContext(fn)); expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.getStatus()).toBe(400); expect(result.error.message).toContain("20.000"); }
  }
}, 120000);

it("inceleme özeti gerçek PrismaService ile tutarlı snapshot okur; arada kapanan kayıt sonraki ölçümde görünür", async () => {
  const f = await fixture(), p = await preview(f), before = await allFinancial(f);
  const prisma = new runtime.PrismaService({ datasourceUrl: url });
  const native = prisma.tenantIslem.bind(prisma), entered = deferred<void>(), release = deferred<void>();
  prisma.tenantIslem = (id: string, fn: (tx: Tx) => Promise<unknown>, options: any) => native(id, async (tx: Tx) => {
    expect((await tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`)[0].transaction_isolation).toBe("repeatable read");
    return fn(new Proxy(tx, { get(target, key) {
      if (key !== "duzeltmeKaydi") return Reflect.get(target, key);
      return { ...target.duzeltmeKaydi, findMany: async (args: any) => { entered.resolve(); await release.promise; return target.duzeltmeKaydi.findMany(args); } };
    } }));
  }, options);
  const read = () => runtime.baglamlaCalistir({ tenantId: f.tenantId, userId: f.userId, rol: "yonetici" }, () => new runtime.RaporService(prisma).maliyetIzleme({ baslangic: "2026-10-01", bitis: "2026-10-15" }));
  const pending = outcome(read());
  try {
    try {
      await Promise.race([entered.promise, pending.then((r) => { throw r.ok ? new Error("Özet beklenmeden tamamlandı") : r.error; })]);
      await transaction(b, f, (tx) => realClose(tx, f, p));
    } finally { release.resolve(); }
    const result = await pending; expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.incelemeler).toMatchObject({ acik: 1, dogrulanmisKapanis: 0, medyanSureSaniye: null });
    prisma.tenantIslem = native;
    const next = await read(); expect(next.incelemeler).toMatchObject({ acik: 0, dogrulanmisKapanis: 1, sureOrnekSayisi: 1 });
    expect(await allFinancial(f)).toBe(before);
  } finally { release.resolve(); await pending; await prisma.$disconnect(); }
});

it("doğrulama olayı olmayan eski kapanış doğrulanmış çözüm sayılmaz; taslağa alınan satış kapsamdan çıkar", async () => {
  const f = await fixture();
  await transaction(a, f, (tx) => tx.duzeltmeKaydi.update({ where: { id: f.kayitId }, data: { durum: "cozuldu", tekillikAnahtari: null } }));
  const read = () => transaction(a, f, (tx) => new runtime.RaporService(adapter(tx)).maliyetIzleme({ baslangic: "2026-10-01", bitis: "2026-10-15" }));
  expect((await read()).incelemeler).toMatchObject({ dogrulanmisKapanis: 0, digerKapanis: 1, medyanSureSaniye: null });
  await transaction(a, f, (tx) => reverseInvoice(tx, f));
  expect(await read()).toMatchObject({ kapsam: { malSatisSatiri: 0, takipliKaynakSatiri: 0 }, incelemeler: { toplam: 0 }, uyari: { satir: 0, ciro: "0.00" } });
});
