import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformKotaController } from "../src/mevzuat/platform-kota.controller";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(), firma = randomUUID(), diger = randomUUID();
const controller = new PlatformKotaController({ db } as never);
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "hacim@kabul.invalid", rol: "yonetici" }, is);
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Hacim yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  for (const [id, vkn] of [[firma, "8199990011"], [diger, "8199990012"]]) await admin.tenant.create({ data: { id, unvan: "Ek hacmi kabul", vkn } });
});
afterAll(async () => { await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]); });
it("kayıtlı ek hacmi firma bazında, bigint toplamıyla ve silmelerle ölçülür", async () => {
  expect(await olarak(() => controller.ekHacmi(firma))).toMatchObject({ tenantId: firma, dosyaAdedi: "0", bayt: "0", dagilim: [], kotaUygulaniyor: false });
  const ek = (tenantId: string, boyut: number, sahipTur: "firma" | "fatura") => admin.ek.create({ data: { tenantId, sahipTur, sahipId: tenantId, boyut, dosyaAdi: "kabul.bin", mimeTip: "application/octet-stream", depoAnahtari: randomUUID() } });
  const a = await ek(firma, 2147483647, "firma"); await ek(firma, 2147483647, "fatura"); await ek(firma, 0, "firma"); await ek(diger, 100, "firma");
  expect(await olarak(() => controller.ekHacmi(firma))).toMatchObject({ dosyaAdedi: "3", bayt: "4294967294", dagilim: expect.arrayContaining([{ sahipTur: "firma", dosyaAdedi: "2", bayt: "2147483647" }, { sahipTur: "fatura", dosyaAdedi: "1", bayt: "2147483647" }]) });
  await admin.ek.delete({ where: { id: a.id } });
  expect(await olarak(() => controller.ekHacmi(firma))).toMatchObject({ dosyaAdedi: "2", bayt: "2147483647" });
  await expect(app.$queryRaw`SELECT platform_firma_ek_hacmi(${kisi}::uuid,${firma}::uuid)`).rejects.toThrow();
  await expect(olarak(() => controller.ekHacmi(randomUUID()))).rejects.toThrow("Firma bulunamadı");
  await admin.platformKullanici.update({ where: { id: kisi }, data: { aktif: false } });
  await expect(olarak(() => controller.ekHacmi(firma))).rejects.toThrow("Aktif platform");
});
