import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const posta = vi.hoisted(() => ({ gonderilen: [] as { subject: string; text: string }[], bozuk: false }));
vi.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: async (m: { subject: string; text: string }) => { if (posta.bozuk) throw new Error("SMTP kapalı"); posta.gonderilen.push(m); } }),
}));

import { NabizService } from "../src/core/nabiz/nabiz.service";
import { PrismaService } from "../src/core/prisma.service";
import { SistemSagligiService } from "../src/sistem-sagligi/sistem-sagligi.service";

/**
 * PLT-16/19: nabız sayaçları ve alarm tekilliği gerçek PostgreSQL'de. Kuyruk
 * ve platform işlevleri sahtedir; alarm tablosu ve kurallar gerçektir.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
const db = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });

const kiraci = randomUUID();
const oluId = `kabul-${randomUUID()}`;
const isAdi = `kabul-is-${randomUUID().slice(0, 8)}`;
let oluIsler: { id: string; tenantId: string; isTuru: string; hata: string }[] = [];
let kursorler: { tenant_id: string; unvan: string; saglayici: string; son_cekim_at: Date | null; irsaliye_son_cekim_at: null }[] = [];

const platform = {
  db: {
    $queryRaw: async (sablon: TemplateStringsArray) => {
      const sql = sablon.join("?");
      if (sql.includes("platform_gelen_kursor_durumu")) return kursorler;
      if (sql.includes("platform_firma_adlari")) return [{ tenant_id: kiraci, unvan: "KABUL FİRMASI" }];
      return [];
    },
    platformKullanici: { findMany: async () => [{ eposta: "ekip@ornek.invalid" }] },
    mevzuatOlay: { create: async () => ({}) },
  },
};
const kuyruk = { platformOzeti: async () => ({ sayilar: {}, firmalar: [], oluIsler }) };
const servis = new SistemSagligiService(db, platform as any, kuyruk as any);
const kendiAlarmlari = () => db.sistemAlarmi.findMany({ where: { anahtar: { in: [`olu-is:${oluId}`, `kursor:${kiraci}`] } }, orderBy: { anahtar: "asc" } });

beforeEach(() => { posta.gonderilen = []; posta.bozuk = false; });
afterAll(async () => {
  await db.sistemAlarmi.deleteMany({ where: { anahtar: { in: [`olu-is:${oluId}`, `kursor:${kiraci}`] } } });
  await db.sistemIsi.deleteMany({ where: { isAdi } });
  await db.$disconnect();
});

describe("sistem alarmı (PLT-19) — gerçek PostgreSQL", () => {
  const simdi = new Date();
  const sonra = (dk: number) => new Date(simdi.getTime() + dk * 60_000);

  it("yeni sorunlar tek e-postayla bildirilir, sonraki denetimde tekrar gönderilmez", async () => {
    oluIsler = [{ id: oluId, tenantId: kiraci, isTuru: "gelen-belge-cek", hata: "job stalled more than allowable limit" }];
    kursorler = [{ tenant_id: kiraci, unvan: "KABUL FİRMASI", saglayici: "nes", son_cekim_at: new Date(simdi.getTime() - 7 * 3_600_000), irsaliye_son_cekim_at: null }];
    const ilk = await servis.alarmDenetle(simdi);
    const kendi = (a: { yeni: { anahtar: string }[] }) => a.yeni.map((s) => s.anahtar).filter((k) => k.includes(oluId) || k.includes(kiraci)).sort();
    expect(kendi(ilk)).toEqual([`kursor:${kiraci}`, `olu-is:${oluId}`]);
    expect(posta.gonderilen).toHaveLength(1);
    expect(posta.gonderilen[0].text).toContain("KABUL FİRMASI: gelen e-Fatura taraması 7 saattir");
    expect(posta.gonderilen[0].text).toContain("Kuyruktan düşen iş: gelen-belge-cek — KABUL FİRMASI");
    expect((await kendiAlarmlari()).every((a) => a.acik && a.sonBildirimAt)).toBe(true);

    expect(kendi(await servis.alarmDenetle(sonra(5)))).toEqual([]);
    expect(posta.gonderilen).toHaveLength(1);
  });

  it("sorun kalkınca 'düzeldi' gider ve alarm kapanır", async () => {
    oluIsler = [];
    const s = await servis.alarmDenetle(sonra(10));
    expect(s.duzelen).toContain(`olu-is:${oluId}`);
    expect(posta.gonderilen.at(-1)?.text).toMatch(/Düzelenler:\n• Kuyruktan düşen iş: gelen-belge-cek/);
    expect((await kendiAlarmlari()).find((a) => a.anahtar === `olu-is:${oluId}`)?.acik).toBe(false);
  });

  it("e-posta gidemezse bildirilmiş sayılmaz; bir saat geçince yeniden denenir", async () => {
    // Aynı iş 1 saat dolmadan yeniden düşer: son bildirim yakın, beklenir.
    oluIsler = [{ id: oluId, tenantId: kiraci, isTuru: "gelen-belge-cek", hata: "yine" }];
    await servis.alarmDenetle(sonra(20));
    expect(posta.gonderilen).toHaveLength(0);
    posta.bozuk = true;
    await servis.alarmDenetle(sonra(70));
    expect((await kendiAlarmlari()).find((a) => a.anahtar === `olu-is:${oluId}`)?.sonBildirimAt?.getTime()).toBeLessThan(sonra(20).getTime());
    posta.bozuk = false;
    const tekrar = await servis.alarmDenetle(sonra(75));
    expect(tekrar.yeni.map((s) => s.anahtar)).toContain(`olu-is:${oluId}`);
    expect(posta.gonderilen).toHaveLength(1);
  });
});

describe("nabız sayaçları (PLT-16) — gerçek PostgreSQL", () => {
  it("hata ardışık sayılır, başarı sıfırlar; son başarı ve son hata korunur", async () => {
    const n = new NabizService(db);
    const t = (s: number) => new Date(Date.UTC(2026, 9, 29, 13, 0, s));
    await n.kaydet({ ad: isAdi, baslangic: t(0), bitis: t(1), hata: "a" });
    await n.kaydet({ ad: isAdi, baslangic: t(2), bitis: t(3), hata: "b" });
    let k = await db.sistemIsi.findUniqueOrThrow({ where: { isAdi } });
    expect(k).toMatchObject({ ardisikHata: 2, sonHata: "b", sonBasariAt: null, calismaSayisi: 2n, sonSureMs: 1000 });
    await n.kaydet({ ad: isAdi, baslangic: t(4), bitis: t(6), hata: null });
    k = await db.sistemIsi.findUniqueOrThrow({ where: { isAdi } });
    expect(k).toMatchObject({ ardisikHata: 0, sonHata: "b", sonSureMs: 2000, calismaSayisi: 3n });
    expect(k.sonBasariAt?.toISOString()).toBe(t(6).toISOString());
  });
});
