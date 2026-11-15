import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/core/prisma.service";
import { aktifBaglam } from "../src/core/istek-baglami";
import { KullaniciBaglamiHatasi, kullaniciAdinaCalistir, kullaniciBaglami } from "../src/core/kullanici-baglami";

/**
 * AI-94/95 kabul testi (gerçek PostgreSQL, uygulama rolü + RLS): kullanıcı
 * adına çalışan arka plan işinin bağlamı güncel aktiflik, rol ve özel rolden
 * kurulur; önbellek yoktur; pasif kullanıcıda ve başka firmanın kullanıcısında
 * iş başlamaz.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const A = { tenant: randomUUID(), muhasebe: randomUUID(), pasif: randomUUID(), ozelRol: randomUUID() };
const B = { tenant: randomUUID(), yonetici: randomUUID() };

beforeAll(async () => {
  for (const [f, unvan] of [[A.tenant, "Bağlam Alfa"], [B.tenant, "Bağlam Beta"]] as const) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f}::uuid, ${unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
  }
  await yonetim.ozelRol.create({ data: { id: A.ozelRol, tenantId: A.tenant, ad: "Kasasız muhasebe", sablonRol: "muhasebe", kapaliKutular: ["kasa_banka"] } });
  for (const [tenant, id, rol, aktif] of [[A.tenant, A.muhasebe, "muhasebe", true], [A.tenant, A.pasif, "muhasebe", false], [B.tenant, B.yonetici, "yonetici", true]] as const) {
    await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, aktif, updated_at) VALUES (${id}::uuid, ${tenant}::uuid, ${`baglam-${id}@test.local`}, 'x', ${`Bağlam ${rol}`}, ${rol}::"Rol", ${aktif}, now())`;
  }
  await yonetim.user.update({ where: { id: A.muhasebe }, data: { ozelRolId: A.ozelRol } });
});

afterAll(async () => {
  await yonetim.user.deleteMany({ where: { tenantId: { in: [A.tenant, B.tenant] } } }).catch(() => undefined);
  await yonetim.tenant.deleteMany({ where: { id: { in: [A.tenant, B.tenant] } } }).catch(() => undefined);
  await Promise.all([yonetim.$disconnect(), prisma.$disconnect()]);
});

describe("AI-94/95 kullanıcı bağlamı çözümleyicisi", () => {
  it("özel rolün kapattığı kutular bağlama taşınır ve iş bu bağlamla çalışır", async () => {
    expect(await kullaniciBaglami(prisma, A.tenant, A.muhasebe)).toEqual({ tenantId: A.tenant, userId: A.muhasebe, rol: "muhasebe", ozelRol: { id: A.ozelRol, kapali: ["kasa_banka"] } });
    const gorulen = await kullaniciAdinaCalistir(prisma, A.tenant, A.muhasebe, async () => aktifBaglam());
    expect(gorulen.ozelRol?.kapali).toEqual(["kasa_banka"]);
  });

  it("rol ve özel rol değişikliği beklemeden yansır (önbellek yok)", async () => {
    await yonetim.ozelRol.update({ where: { id: A.ozelRol }, data: { kapaliKutular: ["kasa_banka", "personel"] } });
    expect((await kullaniciBaglami(prisma, A.tenant, A.muhasebe)).ozelRol?.kapali).toEqual(["kasa_banka", "personel"]);
    await yonetim.user.update({ where: { id: A.muhasebe }, data: { ozelRolId: null, rol: "satis" } });
    expect(await kullaniciBaglami(prisma, A.tenant, A.muhasebe)).toEqual({ tenantId: A.tenant, userId: A.muhasebe, rol: "satis" });
  });

  it("pasif kullanıcıda iş başlamaz; temel role ya da yöneticiye düşülmez", async () => {
    let calisti = false;
    await expect(kullaniciAdinaCalistir(prisma, A.tenant, A.pasif, async () => { calisti = true; })).rejects.toMatchObject({ neden: "pasif" });
    expect(calisti).toBe(false);
  });

  it("başka firmanın kullanıcısı RLS altında bulunamaz", async () => {
    const hata = await kullaniciBaglami(prisma, A.tenant, B.yonetici).catch((h: unknown) => h);
    expect(hata).toBeInstanceOf(KullaniciBaglamiHatasi);
    expect((hata as KullaniciBaglamiHatasi).neden).toBe("bulunamadi");
  });
});
