import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { aktifBaglam, baglamlaCalistir } from "../src/core/istek-baglami";
import { KullaniciDurumService } from "../src/core/kullanici-durum.service";
import { PrismaService } from "../src/core/prisma.service";
import { TelegramIstemci } from "../src/telegram/telegram-istemci";
import { TelegramKanalService } from "../src/telegram/telegram-kanal.service";
import { TelegramService } from "../src/telegram/telegram.service";

/**
 * CNL-19 kabul testi: firmaya özel bot. Gerçek PostgreSQL (uygulama rolü, RLS), bot anahtarına göre
 * ayrı kuyruk tutan sahte Telegram sunucusu, gerçek yoklama döngüleri. Plan özelliği erişim
 * servisinde taklit edilir (paket sözleşmesinin okunması ayrı birim testindedir).
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const A = { tenant: randomUUID(), yonetici: randomUUID(), kullanici: randomUUID(), unvan: "Alfa Firma Botu" };
const B = { tenant: randomUUID(), yonetici: randomUUID(), kullanici: randomUUID(), unvan: "Beta Platform" };
const HESAP_A = 710_000_000 + Math.floor(Math.random() * 1_000_000);
const HESAP_B = HESAP_A + 1;

const PLATFORM = "123456789:AAEhBP0av18Fz6Xx-platform-anahtari-0";
const BOT_A = `${880_000_000 + Math.floor(Math.random() * 1_000_000)}:AAFirmaAlfaAnahtari-1234567890abc`;
const BOT_A_YENI = BOT_A.replace("Anahtari", "Yenilendi");
const WEBHOOKLU = "777000111:AAWebhookluBotAnahtari-1234567890";
const PLATFORM_KOPYA = "777000222:AAPlatformBotununKopyasi-12345678";
const botKimligi = (anahtar: string) => Number(anahtar.split(":")[0]);
const BOTLAR: Record<string, { username: string; webhook?: string }> = {
  [PLATFORM]: { username: "tekir_deneme_bot" },
  [BOT_A]: { username: "alfa_firma_bot" },
  [BOT_A_YENI]: { username: "alfa_firma_bot" },
  [WEBHOOKLU]: { username: "baska_yerde_bot", webhook: "https://ornek.com/kanca" },
  [PLATFORM_KOPYA]: { username: "Tekir_Deneme_Bot" },
};
const iptalEdilen = new Set<string>();

// --- Sahte Telegram sunucusu: anahtar başına getUpdates kuyruğu, sendMessage kayıtları ---
type Giden = { anahtar: string; chat_id: string; text: string };
const kuyruklar = new Map<string, Array<{ update_id: number; message: unknown }>>();
const gidenler: Giden[] = [];
let sunucu: Server;
let taban = "";
let sonrakiNo = 9_000 + Math.floor(Math.random() * 1_000_000);

function mesaj(anahtar: string, hesap: number, text: string, no = sonrakiNo++) {
  const k = kuyruklar.get(anahtar) ?? [];
  k.push({ update_id: no, message: { message_id: no, date: Math.floor(Date.now() / 1000), chat: { id: hesap, type: "private" }, from: { id: hesap, username: `k${hesap}` }, text } });
  kuyruklar.set(anahtar, k);
  return no;
}
const gelenler = (anahtar: string, hesap: number) => gidenler.filter((g) => g.anahtar === anahtar && g.chat_id === String(hesap)).map((g) => g.text);
async function bekle(kosul: () => boolean | Promise<boolean>, ms = 15_000) {
  const son = Date.now() + ms;
  while (!(await kosul())) { if (Date.now() > son) throw new Error("Beklenen durum oluşmadı"); await new Promise((r) => setTimeout(r, 50)); }
}
async function yanit(anahtar: string, hesap: number, onceki: number): Promise<string> {
  await bekle(() => gelenler(anahtar, hesap).length > onceki);
  return gelenler(anahtar, hesap)[onceki];
}

const ajan = {
  async mesajiIsle() {
    const { tenantId } = aktifBaglam();
    const firma = await prisma.tenantIslem(tenantId, async (tx) => (await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }))?.unvan);
    return { cevap: `firma=${firma}`, onayTalepleri: [], araclar: [], oturumId: null };
  },
  async telegramSohbetiniKapat() {},
};

const acikFirmalar = new Set<string>([A.tenant]);
const erisim = new AbonelikErisimService(prisma);
erisim.ozellikAcik = async (tenantId) => acikFirmalar.has(tenantId);
const telegram = new TelegramService(prisma, erisim, new KullaniciDurumService(prisma));
const bildirimler: Array<{ tenantId: string; baslik: string }> = [];
const kanal = new TelegramKanalService(prisma, ajan as never, telegram, undefined, undefined, undefined, { uret: async (g: { baslik: string }) => { bildirimler.push({ tenantId: aktifBaglam().tenantId, baslik: g.baslik }); return { bildirimId: "x", yeniTeslimat: 1 }; } } as never);
const olarak = <T>(f: typeof A, userId: string, rol: string, fn: () => Promise<T>) => baglamlaCalistir({ tenantId: f.tenant, userId, rol } as never, fn);
const bagSayisi = (f: typeof A) => prisma.tenantIslem(f.tenant, (tx) => tx.telegramBagi.count());

beforeAll(async () => {
  process.env.TELEGRAM_BOT_ADI = "tekir_deneme_bot";
  process.env.APP_URL = "https://panel.ornek";
  sunucu = createServer((istek, cevap) => {
    let govde = "";
    istek.on("data", (p) => (govde += p));
    istek.on("end", () => {
      const [, botParca, yontem] = (istek.url ?? "").split("/");
      const anahtar = decodeURIComponent(botParca.replace(/^bot/, ""));
      const veri = govde ? JSON.parse(govde) : {};
      const yaz = (sonuc: unknown, durum = 200) => { cevap.writeHead(durum, { "Content-Type": "application/json" }); cevap.end(JSON.stringify(durum === 200 ? { ok: true, result: sonuc } : { ok: false, description: "Unauthorized" })); };
      if (!BOTLAR[anahtar] || iptalEdilen.has(anahtar)) return yaz(null, 401);
      if (yontem === "getUpdates") {
        const k = kuyruklar.get(anahtar) ?? [];
        const ver = () => k.splice(0, k.length);
        if (k.length) return yaz(ver());
        return void setTimeout(() => yaz(ver()), 150);
      }
      if (yontem === "sendMessage") { gidenler.push({ anahtar, chat_id: String(veri.chat_id), text: veri.text }); return yaz({ message_id: 1 }); }
      if (yontem === "getMe") return yaz({ id: botKimligi(anahtar), is_bot: true, username: BOTLAR[anahtar].username });
      if (yontem === "getWebhookInfo") return yaz({ url: BOTLAR[anahtar].webhook ?? "" });
      return yaz(true);
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  taban = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
  for (const f of [A, B]) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f.tenant}::uuid, ${f.unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
    for (const [id, rol] of [[f.yonetici, "yonetici"], [f.kullanici, "muhasebe"]] as const) {
      await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${f.tenant}::uuid, ${`tgf-${id}@test.local`}, 'x', ${`${f.unvan} ${rol}`}, ${rol}::"Rol", now())`;
    }
  }
  kanal.istemciKur = (anahtar) => new TelegramIstemci(anahtar, taban);
  telegram.istemciKur = (anahtar) => new TelegramIstemci(anahtar, taban);
  process.env.TELEGRAM_BOT_TOKEN = PLATFORM;
  for (const f of [A, B]) await olarak(f, f.yonetici, "yonetici", () => telegram.urunAyarla({ etkin: true, tutarGoster: true }));
  kanal.baslat();
});

afterAll(async () => {
  await kanal.onModuleDestroy();
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("Firmaya özel Telegram botu (CNL-19)", () => {
  it("yalnız yönetici, yalnız plan özelliği açıksa; geçersiz, webhooklu ve platform botu reddedilir", async () => {
    await expect(olarak(A, A.kullanici, "muhasebe", () => telegram.ozelBotKaydet({ anahtar: BOT_A }))).rejects.toThrow(/yalnız yönetici/);
    await expect(olarak(B, B.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: BOT_A }))).rejects.toThrow(/paketinizde yok/);
    await expect(olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: "bozuk-anahtar-xxxxxxxxxxxxxxxx" }))).rejects.toThrow(/biçimi geçersiz/);
    await expect(olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: "999999999:AABilinmeyenBotAnahtari-123456789" }))).rejects.toThrow(/tanımadı/);
    await expect(olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: WEBHOOKLU }))).rejects.toThrow(/webhook/);
    await expect(olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: PLATFORM_KOPYA }))).rejects.toThrow(/Platform botu/);
    expect(await yonetim.telegramFirmaBotu.count({ where: { tenantId: A.tenant } })).toBe(0);
  });

  it("geçişte bağlar düşer; eski hesap platform botunda yeni bota yönlendirilir; anahtar hiçbir yere yazılmaz", async () => {
    for (const [f, hesap] of [[A, HESAP_A], [B, HESAP_B]] as const) {
      const k = await olarak(f, f.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
      expect(k.baglanti).toBe(`https://t.me/tekir_deneme_bot?start=${k.kod}`);
      const n = gelenler(PLATFORM, hesap).length;
      mesaj(PLATFORM, hesap, `/start ${k.kod}`);
      expect(await yanit(PLATFORM, hesap, n)).toContain("Bağlantı tamam");
    }
    const r = await olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: BOT_A }));
    expect(r).toEqual({ botAdi: "alfa_firma_bot", dusenBag: 1 });
    expect(await bagSayisi(A)).toBe(0);
    expect(await bagSayisi(B)).toBe(1);
    const kayit = await yonetim.telegramFirmaBotu.findUniqueOrThrow({ where: { tenantId: A.tenant } });
    expect(kayit.sifreliAnahtar).not.toContain(BOT_A.split(":")[1]);
    const iz = await yonetim.auditLog.findFirstOrThrow({ where: { tenantId: A.tenant, islem: "telegram_ozel_bot_kaydedildi" } });
    expect(JSON.stringify(iz.detay)).not.toContain(BOT_A.split(":")[1]);
    const d = await olarak(A, A.yonetici, "yonetici", () => telegram.durumGetir());
    expect(JSON.stringify(d)).not.toContain(BOT_A.split(":")[1]);
    expect(d).toMatchObject({ botAdi: "alfa_firma_bot", ozelBot: { kullanilabilir: true, bot: { botAdi: "alfa_firma_bot", durum: "etkin" } } });

    const n = gelenler(PLATFORM, HESAP_A).length;
    mesaj(PLATFORM, HESAP_A, "durum");
    expect(await yanit(PLATFORM, HESAP_A, n)).toContain("@alfa_firma_bot");
  });

  it("firma botuyla bağlanılır ve konuşulur; platform botu kodu kabul etmez; güncelleme numaraları çakışmaz", async () => {
    await kanal.firmaBotlariniYenile();
    const k = await olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
    expect(k.baglanti).toBe(`https://t.me/alfa_firma_bot?start=${k.kod}`);
    let n = gelenler(PLATFORM, HESAP_A).length;
    mesaj(PLATFORM, HESAP_A, `/start ${k.kod}`);
    expect(await yanit(PLATFORM, HESAP_A, n)).toMatch(/başka bir Telegram botu için/);
    n = gelenler(BOT_A, HESAP_A).length;
    mesaj(BOT_A, HESAP_A, `/start ${k.kod}`);
    expect(await yanit(BOT_A, HESAP_A, n)).toContain(`Bağlantı tamam: ${A.unvan} muhasebe`);
    expect((await yonetim.telegramBagi.findUniqueOrThrow({ where: { userId: A.kullanici } })).botKimlik).toBe(BigInt(botKimligi(BOT_A)));

    // Aynı güncelleme numarası iki botta ayrı mesajdır.
    const no = sonrakiNo++;
    const [nA, nB] = [gelenler(BOT_A, HESAP_A).length, gelenler(PLATFORM, HESAP_B).length];
    mesaj(BOT_A, HESAP_A, "durum", no);
    mesaj(PLATFORM, HESAP_B, "durum", no);
    expect(await yanit(BOT_A, HESAP_A, nA)).toBe(`firma=${A.unvan}`);
    expect(await yanit(PLATFORM, HESAP_B, nB)).toBe(`firma=${B.unvan}`);

    // Firma botuna bağlı hesap platform botundan yanıt almaz; B'nin hesabı A'nın botundan yanıt almaz.
    n = gelenler(PLATFORM, HESAP_A).length;
    mesaj(PLATFORM, HESAP_A, "durum");
    expect(await yanit(PLATFORM, HESAP_A, n)).toMatch(/kendi TekirExtra botuna bağlı/);
    n = gelenler(BOT_A, HESAP_B).length;
    mesaj(BOT_A, HESAP_B, "durum");
    expect(await yanit(BOT_A, HESAP_B, n)).toMatch(/başka bir TekirExtra botuna bağlı/);
    expect(gelenler(BOT_A, HESAP_B).some((x) => x.includes("firma="))).toBe(false);
  });

  it("kendiliğinden mesaj firmanın botundan gider; bot başka firmada kullanılamaz", async () => {
    expect(await olarak(A, A.kullanici, "muhasebe", () => kanal.firmayaGonder(A.tenant, A.kullanici, null, "deneme", "A bildirimi"))).toBe("gonderildi");
    expect(gelenler(BOT_A, HESAP_A)).toContain("A bildirimi");
    expect(gidenler.some((g) => g.anahtar === PLATFORM && g.text === "A bildirimi")).toBe(false);
    acikFirmalar.add(B.tenant);
    try {
      await expect(olarak(B, B.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: BOT_A }))).rejects.toThrow(/başka bir firmada/);
    } finally { acikFirmalar.delete(B.tenant); }
  });

  it("aynı botun anahtarı yenilenince bağlar korunur; iptal edilen anahtar botu durdurur ve yöneticiye bildirilir", async () => {
    const r = await olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: BOT_A_YENI }));
    expect(r.dusenBag).toBe(0);
    expect(await bagSayisi(A)).toBe(1);
    await kanal.firmaBotlariniYenile();
    let n = gelenler(BOT_A_YENI, HESAP_A).length;
    mesaj(BOT_A_YENI, HESAP_A, "durum");
    expect(await yanit(BOT_A_YENI, HESAP_A, n)).toBe(`firma=${A.unvan}`);

    iptalEdilen.add(BOT_A_YENI);
    await bekle(async () => (await yonetim.telegramFirmaBotu.findUniqueOrThrow({ where: { tenantId: A.tenant } })).durum === "gecersiz");
    expect(bildirimler.some((b) => b.tenantId === A.tenant && b.baslik.includes("@alfa_firma_bot"))).toBe(true);
    const d = await olarak(A, A.kullanici, "muhasebe", () => telegram.durumGetir());
    expect(d).toMatchObject({ botGecersiz: true, bag: { kullaniciAdi: `k${HESAP_A}` } });
    await expect(olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }))).rejects.toThrow(/çalışmıyor/);
    expect(await olarak(A, A.kullanici, "muhasebe", () => kanal.firmayaGonder(A.tenant, A.kullanici, null, "deneme", "gitmemeli"))).toBe("hata");
    iptalEdilen.delete(BOT_A_YENI);
  });

  it("plan özelliği kapanınca firma botu durur, bağ kullanımda düşer; kaldırınca platform botuna dönülür", async () => {
    await olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: BOT_A }));
    await kanal.firmaBotlariniYenile();
    acikFirmalar.delete(A.tenant);
    await kanal.firmaBotlariniYenile();
    const d = await olarak(A, A.kullanici, "muhasebe", () => telegram.durumGetir());
    expect(d).toMatchObject({ botAdi: "tekir_deneme_bot", bag: null });
    expect(await bagSayisi(A)).toBe(0);
    acikFirmalar.add(A.tenant);

    const r = await olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaldir());
    expect(r.kaldirildi).toBe(true);
    const k = await olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
    expect(k.baglanti).toBe(`https://t.me/tekir_deneme_bot?start=${k.kod}`);
    const n = gelenler(PLATFORM, HESAP_A).length;
    mesaj(PLATFORM, HESAP_A, `/start ${k.kod}`);
    expect(await yanit(PLATFORM, HESAP_A, n)).toContain("Bağlantı tamam");
    expect(await yonetim.auditLog.count({ where: { tenantId: A.tenant, islem: "telegram_ozel_bot_kaldirildi" } })).toBe(1);
  });

  it("RLS: firma botu ve geçiş kayıtları başka firmada görünmez", async () => {
    await olarak(A, A.yonetici, "yonetici", () => telegram.ozelBotKaydet({ anahtar: BOT_A }));
    const gorunen = await prisma.tenantIslem(B.tenant, async (tx) => [
      ...(await tx.telegramFirmaBotu.findMany({ select: { tenantId: true } })),
      ...(await tx.telegramBotGecisi.findMany({ select: { tenantId: true } })),
    ]);
    expect(gorunen.every((x) => x.tenantId === B.tenant)).toBe(true);
    expect(await prisma.tenantIslem(A.tenant, (tx) => tx.telegramBotGecisi.count())).toBeGreaterThan(0);
  });
});
