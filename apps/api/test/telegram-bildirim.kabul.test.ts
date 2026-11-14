import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trSimdi } from "../src/ai/ai-zaman";
import { BildirimService, type BildirimGirdisi } from "../src/bildirimler/bildirim.service";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { KullaniciDurumService } from "../src/core/kullanici-durum.service";
import { PrismaService } from "../src/core/prisma.service";
import { isGunuMu } from "../src/telegram/telegram-bildirim.kurallari";
import { TelegramBildirimService } from "../src/telegram/telegram-bildirim.service";
import { TelegramIstemci } from "../src/telegram/telegram-istemci";
import { TelegramKanalService } from "../src/telegram/telegram-kanal.service";
import { TelegramService } from "../src/telegram/telegram.service";

/**
 * CNL-06/07/08/12 kabul testi: bildirim merkezinin teslimatları gerçek PostgreSQL'de (RLS)
 * Telegram'a düşer. İki firma, sahte Telegram sunucusu; yalıtım, sessiz saat, "sus", günlük sınır,
 * kritik istisnası, bütçe freni ve günde bir brifing.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const firma = () => ({ tenant: randomUUID(), kullanici: randomUUID(), hesap: 800_000_000 + Math.floor(Math.random() * 1e8) });
const A = { ...firma(), unvan: "Alfa Bildirim" };
const B = { ...firma(), unvan: "Beta Bildirim" };

const gidenler: Array<{ chat_id: string; text: string }> = [];
let sunucu: Server;
const gelen = (f: typeof A) => gidenler.filter((g) => g.chat_id === String(f.hesap)).map((g) => g.text);

const gecmis: Array<{ isaret: string }> = [];
const ajan = { async telegramGecmiseYaz(isaret: string) { gecmis.push({ isaret }); } };
const uc = { async cagir() { throw new Error("uç yok"); } };
const telegram = new TelegramService(prisma, new AbonelikErisimService(prisma), new KullaniciDurumService(prisma));
const kanal = new TelegramKanalService(prisma, ajan as never, telegram);
const gonderici = new TelegramBildirimService(prisma, telegram, kanal, ajan as never, uc as never);

const uret = (f: typeof A, g: Partial<BildirimGirdisi> & { anahtar: string }) => baglamlaCalistir({ tenantId: f.tenant, userId: f.kullanici, rol: "muhasebe" } as never, () =>
  new BildirimService(prisma).uret({ tur: "vade", onem: "uyari", baslik: `${f.unvan} ${g.anahtar}`, aciklama: "ayrıntı", roller: [], kullaniciIdler: [f.kullanici], birlesimAnahtari: g.anahtar, ...g }));
const sonuclar = (f: typeof A) => yonetim.bildirimTeslimati.findMany({ where: { tenantId: f.tenant }, select: { telegramSonuc: true, bildirim: { select: { birlesimAnahtari: true } } } })
  .then((l) => Object.fromEntries(l.map((x) => [x.bildirim.birlesimAnahtari, x.telegramSonuc])));
const ayar = (f: typeof A, veri: Record<string, unknown>) => yonetim.bildirimKullaniciAyari.upsert({ where: { userId: f.kullanici }, create: { tenantId: f.tenant, userId: f.kullanici, ...veri }, update: veri });

beforeAll(async () => {
  sunucu = createServer((istek, cevap) => {
    let govde = "";
    istek.on("data", (p) => (govde += p));
    istek.on("end", () => {
      if ((istek.url ?? "").endsWith("/sendMessage")) { const v = JSON.parse(govde); gidenler.push({ chat_id: String(v.chat_id), text: v.text }); }
      cevap.writeHead(200, { "Content-Type": "application/json" }); cevap.end(JSON.stringify({ ok: true, result: true }));
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  (kanal as unknown as { istemci: TelegramIstemci }).istemci = new TelegramIstemci("123456789:AAEhBP0av18Fz6Xx-deneme-anahtari-00", `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`);
  process.env.APP_URL = "https://panel.ornek";

  for (const f of [A, B]) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f.tenant}::uuid, ${f.unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
    await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${f.kullanici}::uuid, ${f.tenant}::uuid, ${`tgb-${f.kullanici}@test.local`}, 'x', ${f.unvan}, 'muhasebe'::"Rol", now())`;
    await yonetim.modulAyar.create({ data: { tenantId: f.tenant, modul: "telegram", ayarlar: { etkin: true, tutarGoster: true } } });
  }
  // Bağdan önce üretilen bildirim Telegram'a gitmez.
  await uret(A, { anahtar: "a-eski", onem: "kritik" });
  await new Promise((r) => setTimeout(r, 20));
  for (const f of [A, B]) {
    await yonetim.telegramBagi.create({ data: { tenantId: f.tenant, userId: f.kullanici, telegramKullaniciId: BigInt(f.hesap), sohbetId: BigInt(f.hesap), oturumSurumu: 0, rizaAt: new Date() } });
  }
});

afterAll(async () => {
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("kendiliğinden Telegram mesajları (CNL-06/07/08/12)", () => {
  it("uygun bildirimler tek özetle, yalnız kendi firmasına; konu dışı ve bağdan eskisi gitmez", async () => {
    await uret(A, { anahtar: "a-nakit", onem: "kritik", tur: "vade" });
    await uret(A, { anahtar: "a-ebelge", tur: "ebelge" });
    await uret(A, { anahtar: "a-stok", tur: "stok" });
    await uret(B, { anahtar: "b-onay", tur: "onay" });
    await gonderici.tara();
    const [a] = gelen(A);
    expect(gelen(A)).toHaveLength(1);
    expect(a.startsWith("2 yeni bildirim:\n🔴 Alfa Bildirim a-nakit\n🟠 Alfa Bildirim a-ebelge")).toBe(true);
    expect(a).not.toContain("Beta");
    expect(gelen(B)).toEqual([expect.stringContaining("🟠 Beta Bildirim b-onay\n\nayrıntı\n\nhttps://panel.ornek/panel/bildirimler")]);
    expect(gelen(B)[0]).not.toContain("Alfa");
    expect(await sonuclar(A)).toEqual({ "a-eski": null, "a-nakit": "ozet", "a-ebelge": "ozet", "a-stok": "konu_disi" });
    expect(gecmis.map((x) => x.isaret).sort()).toEqual(["[Bildirim özeti]", "[Bildirim]"]);
    // İkinci tur yeniden göndermez.
    await gonderici.tara();
    expect(gidenler).toHaveLength(2);
  });

  it("sessiz saatte bekler, aralık bitince gider", async () => {
    await ayar(A, { sessizBaslangic: "00:00", sessizBitis: "23:59" });
    await uret(A, { anahtar: "a-sessiz", tur: "ebelge" });
    await gonderici.tara();
    expect(gelen(A)).toHaveLength(1);
    expect((await sonuclar(A))["a-sessiz"]).toBeNull();
    await ayar(A, { sessizBaslangic: null, sessizBitis: null });
    await gonderici.tara();
    expect(gelen(A)).toHaveLength(2);
    expect((await sonuclar(A))["a-sessiz"]).toBe("gonderildi");
  });

  it("sus süresince kritik de gitmez ve sonra yığılmaz", async () => {
    await kanal.susAyarla(A.tenant, A.kullanici, new Date(Date.now() + 3_600_000));
    await uret(A, { anahtar: "a-sus", onem: "kritik" });
    await gonderici.tara();
    expect(gelen(A)).toHaveLength(2);
    expect((await sonuclar(A))["a-sus"]).toBe("sus");
    await kanal.susAyarla(A.tenant, A.kullanici, null);
  });

  it("günlük sınır kritik olmayanı durdurur, kritiği durdurmaz", async () => {
    await ayar(B, { telegramGunlukSinir: 1 });
    await uret(B, { anahtar: "b-uyari", tur: "ebelge" });
    await uret(B, { anahtar: "b-kritik", onem: "kritik", tur: "stok" });
    await gonderici.tara();
    expect(gelen(B)).toHaveLength(2);
    expect(gelen(B)[1].startsWith("🔴 Beta Bildirim b-kritik")).toBe(true);
    expect(await sonuclar(B)).toMatchObject({ "b-uyari": "sinir", "b-kritik": "gonderildi" });
  });

  it("bütçe dolunca kritik olmayan durur, kullanıcıya ayda bir kez söylenir, kritik gider", async () => {
    await yonetim.$executeRaw`INSERT INTO tenant_ai_ayarlari (tenant_id, api_key, giris_token_milyon_usd, cikis_token_milyon_usd, aylik_maliyet_butcesi_usd) VALUES (${B.tenant}::uuid, 'x', 1, 1, 0.01)`;
    await yonetim.$executeRaw`INSERT INTO ai_cagri_izleri (id, tenant_id, user_id, ozellik, saglayici, islem, sure_ms, basarili, maliyet_usd) VALUES (${randomUUID()}::uuid, ${B.tenant}::uuid, ${B.kullanici}::uuid, 'asistan', 'openai', 'aracli_sohbet', 1, true, 1)`;
    await ayar(B, { telegramGunlukSinir: 20 });
    await uret(B, { anahtar: "b-butce-uyari", tur: "onay" });
    await uret(B, { anahtar: "b-butce-kritik", onem: "kritik", tur: "onay" });
    await gonderici.tara();
    await uret(B, { anahtar: "b-butce-uyari2", tur: "onay" });
    await gonderici.tara();
    const yeni = gelen(B).slice(2);
    expect(yeni.filter((m) => m.includes("bütçesi doldu"))).toHaveLength(1);
    expect(yeni.some((m) => m.startsWith("🔴 Beta Bildirim b-butce-kritik"))).toBe(true);
    expect(await sonuclar(B)).toMatchObject({ "b-butce-uyari": "butce", "b-butce-uyari2": "butce", "b-butce-kritik": "gonderildi" });
  });

  it("brifing iş günü sabahı günde bir kez gider; bütçesi dolan firmada gitmez", async () => {
    let gun = new Date();
    while (!isGunuMu(trSimdi(gun).gun, trSimdi(gun).haftaGunu)) gun = new Date(gun.getTime() + 86_400_000);
    const sabah = new Date(`${trSimdi(gun).gun}T09:00:00+03:00`);
    const once = gelen(A).length;
    await gonderici.tara(sabah);
    // İz kaydının zamanı veritabanı saatidir; taklit edilen gün bugün değilse (hafta sonu/tatil) "günde bir"
    // koruması kaydı görsün diye gönderim zamanı taklit edilen ana çekilir.
    await yonetim.telegramMesaji.updateMany({ where: { tenantId: A.tenant, yon: "giden", tur: "brifing" }, data: { createdAt: sabah } });
    await gonderici.tara(new Date(sabah.getTime() + 60_000));
    const brifingler = gelen(A).slice(once).filter((m) => m.startsWith("☀️ Günlük brifing"));
    expect(brifingler).toHaveLength(1);
    expect(brifingler[0]).toContain("Her maddenin ayrıntısını buradan sorabilirsiniz.");
    expect(gelen(B).some((m) => m.startsWith("☀️"))).toBe(false);
    expect(gecmis.some((x) => x.isaret === "[Sabah brifingi]")).toBe(true);
  });

  it("ürün kapalı firmada hiçbir şey gitmez", async () => {
    await yonetim.modulAyar.update({ where: { tenantId_modul: { tenantId: A.tenant, modul: "telegram" } }, data: { ayarlar: { etkin: false, tutarGoster: true } } });
    const once = gidenler.length;
    await uret(A, { anahtar: "a-kapali", onem: "kritik" });
    await gonderici.tara();
    expect(gidenler.length).toBe(once);
  });
});
