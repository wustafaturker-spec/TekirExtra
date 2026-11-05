import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PrismaService } from "../src/core/prisma.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { EklerService } from "../src/ekler/ekler.service";

vi.mock("../src/core/guvenlik/dosya-dogrulama", () => ({ dosyaIceriginiDogrula: async () => "application/pdf" }));
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const tenantId = randomUUID(), userId = randomUUID();
const olarak = <T>(is: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, is);
const dosya = (originalname = "kabul.pdf") => ({ originalname, mimetype: "application/pdf", size: 4, buffer: Buffer.from("test") });
beforeAll(async () => {
  await admin.tenant.create({ data: { id: tenantId, unvan: "Yükleme rezervasyon kabul", vkn: "8199990021" } });
  await admin.user.create({ data: { id: userId, tenantId, eposta: `${userId}@kabul.invalid`, adSoyad: "Ek kabul", parolaHash: "x", rol: "yonetici" } });
  await admin.platformKullanici.create({ data: { id: userId, eposta: `${userId}@platform.invalid`, adSoyad: "Ölçüm kabul", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
});
afterAll(async () => { await Promise.all([admin.$disconnect(), app.$disconnect()]); });

it("başarıda rezervasyon ve ek birlikte tamamlanır; depo hatasında kapasite bırakılır", async () => {
  const nesneler = new Map<string, Buffer>(); let anahtar = "", hata = false;
  const depo = { yukle: async (k: string, b: Buffer) => { anahtar = k; if (hata) throw new Error("Depo hatası"); nesneler.set(k,b); }, sil: async (k: string) => { nesneler.delete(k); } };
  const servis = new EklerService(app, depo as never);
  const ek = await olarak(() => servis.yukle("firma", tenantId, dosya()));
  expect(nesneler.has(ek.depoAnahtari)).toBe(true);
  const [r] = await admin.$queryRaw<{ durum: string; bayt: bigint }[]>`SELECT durum,bayt FROM ek_yukleme_rezervasyonlari WHERE depo_anahtari=${ek.depoAnahtari}`;
  expect(r).toMatchObject({ durum: "tamamlandi", bayt: BigInt(4) });
  hata = true;
  await expect(olarak(() => servis.yukle("firma", tenantId, dosya()))).rejects.toThrow("Depo hatası");
  const [iptal] = await admin.$queryRaw<{ durum: string }[]>`SELECT durum FROM ek_yukleme_rezervasyonlari WHERE depo_anahtari=${anahtar}`;
  expect(iptal.durum).toBe("iptal");
  expect(await admin.ek.findUnique({ where: { depoAnahtari: anahtar } })).toBeNull();
});

it("metadata hatasında nesne temizlenir; kaybolan commit yanıtında kayıtlı nesne korunur", async () => {
  const nesneler = new Map<string, Buffer>(); let anahtar = "";
  const depo = { yukle: async (k: string, b: Buffer) => { anahtar = k; nesneler.set(k,b); }, sil: async (k: string) => { nesneler.delete(k); } };
  await admin.$executeRawUnsafe(`CREATE FUNCTION test_ek_reddet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.dosya_adi='db-hata.pdf' THEN RAISE EXCEPTION 'ek_metadata_hatasi'; END IF; RETURN NEW; END $$`);
  await admin.$executeRawUnsafe(`CREATE TRIGGER test_ek_reddet BEFORE INSERT ON ekler FOR EACH ROW EXECUTE FUNCTION test_ek_reddet()`);
  try {
    await expect(olarak(() => new EklerService(app, depo as never).yukle("firma", tenantId, dosya("db-hata.pdf")))).rejects.toThrow("ek_metadata_hatasi");
    expect(nesneler.has(anahtar)).toBe(false);
  } finally {
    await admin.$executeRawUnsafe(`DROP TRIGGER test_ek_reddet ON ekler`);
    await admin.$executeRawUnsafe(`DROP FUNCTION test_ek_reddet()`);
  }
  let tur = 0;
  const prisma = { tenantIslem: async (...args: Parameters<PrismaService["tenantIslem"]>) => {
    const sonuc = await app.tenantIslem(...args); tur++;
    if (tur === 2) throw new Error("Commit yanıtı kayıp");
    return sonuc;
  } };
  const ek = await olarak(() => new EklerService(prisma as never, depo as never).yukle("firma", tenantId, dosya()));
  expect(nesneler.has(ek.depoAnahtari)).toBe(true);
  expect(await admin.ek.findUnique({ where: { id: ek.id } })).not.toBeNull();
});

it("süresi dolan rezervasyon tamamlanamaz ve başka kiracının rezervasyonu kapatılamaz", async () => {
  const id = randomUUID(), anahtar = `${tenantId}/sureli`;
  await app.tenantIslem(tenantId, (tx) => tx.$queryRaw`SELECT ek_yukleme_ayir(${id}::uuid,4::bigint,${anahtar})`);
  const [bekleyen] = await admin.$queryRaw<{ sonuc: unknown }[]>`SELECT platform_firma_ek_hacmi(${userId}::uuid,${tenantId}::uuid) AS sonuc`;
  expect(bekleyen.sonuc).toMatchObject({ bekleyenDosyaAdedi: "1", bekleyenBayt: "4" });
  await admin.$executeRaw`UPDATE ek_yukleme_rezervasyonlari SET son_gecerlilik=clock_timestamp()-interval '1 second' WHERE id=${id}::uuid`;
  const [suresiDoldu] = await admin.$queryRaw<{ sonuc: unknown }[]>`SELECT platform_firma_ek_hacmi(${userId}::uuid,${tenantId}::uuid) AS sonuc`;
  expect(suresiDoldu.sonuc).toMatchObject({ bekleyenDosyaAdedi: "0", bekleyenBayt: "0" });
  await expect(app.tenantIslem(tenantId, (tx) => tx.$queryRaw`SELECT ek_yukleme_kapat(${id}::uuid,true)`)).rejects.toThrow("ek_rezervasyon_suresi_doldu");
  await expect(app.tenantIslem(randomUUID(), (tx) => tx.$queryRaw`SELECT ek_yukleme_kapat(${id}::uuid,false)`)).rejects.toThrow("ek_rezervasyon_yok");
  await expect(app.$queryRaw`SELECT * FROM ek_yukleme_rezervasyonlari`).rejects.toThrow();
});
