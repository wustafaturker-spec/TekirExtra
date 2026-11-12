import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { KullaniciDurumService } from "../src/core/kullanici-durum.service";
import { PrismaService } from "../src/core/prisma.service";
import { TelegramIstemci } from "../src/telegram/telegram-istemci";
import { TelegramKanalService } from "../src/telegram/telegram-kanal.service";
import { TelegramService } from "../src/telegram/telegram.service";

/**
 * CNL-15 kabul testi (gerçek PostgreSQL, RLS): sesli mesaj yalnız yönetici açıkça onay verdiyse
 * OpenAI'ye gider; anlaşılan metin kullanıcıya gösterilir ve asistana soru olarak verilir; maliyet
 * firmanın yapay zekâ izine yazılır. Uzun mesaj indirilmez, sağlayıcı hatası kullanıcıya iç ayrıntı vermez.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const T = randomUUID();
const [YON, MUH] = [randomUUID(), randomUUID()];
const HESAP = 970_000_000 + Math.floor(Math.random() * 1e7);
const rastgeleNo = () => 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const OGG = Buffer.from("OggS-sahte-ses-verisi");

const giden: Array<{ yontem: string; govde: Record<string, unknown> }> = [];
const openai: Array<{ yetki: string | undefined; govde: string }> = [];
let openaiYaniti: { durum: number; metin: string } = { durum: 200, metin: "" };
let sunucu: Server;

const sorular: string[] = [];
const ajan = {
  async mesajiIsle(m: string) { sorular.push(m); return { cevap: "Bugünkü tahsilat 0 TL.", onayTalepleri: [], araclar: [], oturumId: null }; },
  async telegramSohbetiniKapat() {},
};
const telegram = new TelegramService(prisma, new AbonelikErisimService(prisma), new KullaniciDurumService(prisma));
const kanal = new TelegramKanalService(prisma, ajan as never, telegram);
const yonetici = <R>(fn: () => Promise<R>) => baglamlaCalistir({ tenantId: T, userId: YON, rol: "yonetici" } as never, fn);

const ses = (sure: number) => kanal.isle({ update_id: rastgeleNo(), message: { message_id: rastgeleNo() % 100000, date: 0, chat: { id: HESAP, type: "private" }, from: { id: HESAP }, voice: { file_id: "ses", duration: sure, mime_type: "audio/ogg" } } });
const metinler = () => giden.filter((g) => g.yontem === "sendMessage").map((g) => String(g.govde.text));

beforeAll(async () => {
  sunucu = createServer((istek, cevap) => {
    const parcalar: Buffer[] = [];
    istek.on("data", (p: Buffer) => parcalar.push(p));
    istek.on("end", () => {
      const yol = istek.url ?? "";
      const govde = Buffer.concat(parcalar).toString("latin1");
      if (yol.startsWith("/openai")) {
        openai.push({ yetki: istek.headers.authorization, govde });
        cevap.writeHead(openaiYaniti.durum, { "Content-Type": "application/json" });
        cevap.end(JSON.stringify(openaiYaniti.durum === 200 ? { text: openaiYaniti.metin } : { error: { message: "iç ayrıntı sk-gizli" } }));
        return;
      }
      if (yol.includes("/file/bot")) { cevap.writeHead(200); cevap.end(OGG); return; }
      const yontem = yol.split("/").pop()!;
      const veri = govde ? JSON.parse(Buffer.from(govde, "latin1").toString("utf8")) : {};
      giden.push({ yontem, govde: veri });
      const sonuc = yontem === "getFile" ? { file_path: "voice/ses.oga", file_size: OGG.length } : yontem === "sendMessage" ? { message_id: giden.length } : true;
      cevap.writeHead(200, { "Content-Type": "application/json" }); cevap.end(JSON.stringify({ ok: true, result: sonuc }));
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  const adres = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;
  (kanal as unknown as { istemci: TelegramIstemci }).istemci = new TelegramIstemci("123456789:AAEhBP0av18Fz6Xx-deneme-anahtari-00", adres);
  process.env.OPENAI_SES_URL = `${adres}/openai`;
  process.env.TELEGRAM_BOT_ADI = "deneme_bot";
  delete process.env.OPENAI_SES_API_KEY;

  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${T}::uuid, 'Ses Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  for (const [id, rol] of [[YON, "yonetici"], [MUH, "muhasebe"]] as const) {
    await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${T}::uuid, ${`ses-${id}@test.local`}, 'x', ${rol}, ${rol}::"Rol", now())`;
  }
  await y.telegramBagi.create({ data: { tenantId: T, userId: MUH, telegramKullaniciId: BigInt(HESAP), sohbetId: BigInt(HESAP), oturumSurumu: 0, rizaAt: new Date() } });
  await y.modulAyar.create({ data: { tenantId: T, modul: "telegram", ayarlar: { etkin: true, tutarGoster: true } } });
});

afterAll(async () => {
  delete process.env.OPENAI_SES_URL;
  delete process.env.OPENAI_SES_API_KEY;
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("Telegram sesli mesaj (CNL-15)", () => {
  it("firma onay vermediyse ses indirilmez, OpenAI'ye gitmez", async () => {
    await ses(10);
    expect(metinler().at(-1)).toMatch(/Sesli mesaj firmanızda açık değil/);
    expect(giden.some((g) => g.yontem === "getFile")).toBe(false);
    expect(openai).toHaveLength(0);
  });

  it("platform anahtarı yoksa yönetici açamaz; varsa açar ve onay anı yazılır", async () => {
    await expect(yonetici(() => telegram.urunAyarla({ etkin: true, tutarGoster: true, sesEtkin: true }))).rejects.toThrow(/henüz açık değil/);
    process.env.OPENAI_SES_API_KEY = "sk-deneme";
    const sonuc = await yonetici(() => telegram.urunAyarla({ etkin: true, tutarGoster: true, sesEtkin: true }));
    expect(sonuc.sesEtkin).toBe(true);
    expect(Date.parse(sonuc.sesOnayAt!)).toBeGreaterThan(Date.now() - 60_000);
    // Ses alanı gönderilmeyen kayıt (eski panel) onayı silmez.
    expect((await yonetici(() => telegram.urunAyarla({ etkin: true, tutarGoster: false }))).sesOnayAt).toBe(sonuc.sesOnayAt);
  });

  it("ses yazıya çevrilir, gösterilir ve asistana soru olarak gider; maliyet bütçeye yazılır", async () => {
    openaiYaniti = { durum: 200, metin: "  Bugün   ne kadar tahsilat yaptık? " };
    await ses(30);
    expect(openai.at(-1)!.yetki).toBe("Bearer sk-deneme");
    expect(openai.at(-1)!.govde).toContain('filename="ses.ogg"');
    expect(openai.at(-1)!.govde).toContain("gpt-4o-mini-transcribe");
    expect(openai.at(-1)!.govde).toMatch(/name="language"\r\n\r\ntr/);
    expect(sorular.at(-1)).toBe("Bugün ne kadar tahsilat yaptık?");
    expect(metinler()).toContain("🎙️ Anladığım: «Bugün ne kadar tahsilat yaptık?»");
    expect(metinler().at(-1)).toContain("Bugünkü tahsilat");
    const iz = await prisma.tenantIslem(T, (tx) => tx.aiCagriIz.findFirst({ where: { islem: "ses_yazi", basarili: true } }));
    expect(iz).toMatchObject({ saglayici: "openai", model: "gpt-4o-mini-transcribe", userId: MUH });
    expect(Number(iz!.maliyetUsd)).toBeCloseTo(0.0015, 8);
  });

  it("iki dakikadan uzun mesaj indirilmez", async () => {
    const once = openai.length;
    await ses(121);
    expect(metinler().at(-1)).toMatch(/en çok 2 dakika/);
    expect(openai.length).toBe(once);
  });

  it("sağlayıcı hatası kullanıcıya iç ayrıntı vermez; başarısız çağrı ücretlenmez", async () => {
    openaiYaniti = { durum: 500, metin: "" };
    const once = sorular.length;
    await ses(5);
    expect(metinler().at(-1)).toBe("Sesli mesaj yazıya çevrilemedi. Sorunuzu yazarak iletebilirsiniz.");
    expect(metinler().join(" ")).not.toMatch(/sk-|iç ayrıntı/);
    expect(sorular.length).toBe(once);
    const iz = await prisma.tenantIslem(T, (tx) => tx.aiCagriIz.findFirst({ where: { islem: "ses_yazi", basarili: false } }));
    expect(iz).toMatchObject({ hataSinifi: "HTTP_500", maliyetUsd: null });
  });

  it("yönetici kapatınca onay silinir ve ses yeniden reddedilir", async () => {
    const sonuc = await yonetici(() => telegram.urunAyarla({ etkin: true, tutarGoster: true, sesEtkin: false }));
    expect(sonuc).toMatchObject({ sesEtkin: false, sesOnayAt: null });
    await ses(5);
    expect(metinler().at(-1)).toMatch(/açık değil/);
  });
});
