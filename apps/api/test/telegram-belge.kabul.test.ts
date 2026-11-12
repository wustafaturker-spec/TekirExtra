import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AsistanSoruService } from "../src/asistan-soru/asistan-soru.service";
import { MasrafBelgeService } from "../src/asistan-soru/masraf-belge.service";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { KullaniciDurumService } from "../src/core/kullanici-durum.service";
import { PrismaService } from "../src/core/prisma.service";
import { TelegramIstemci } from "../src/telegram/telegram-istemci";
import { TelegramKanalService } from "../src/telegram/telegram-kanal.service";
import { TelegramService } from "../src/telegram/telegram.service";

/**
 * CNL-16 kabul testi (gerçek PostgreSQL, RLS): Telegram'a gönderilen fiş fotoğrafı indirilir, içerik
 * denetiminden geçer, OCR'a gider ve masraf taslağına döner. Kategori OCR önerisinden ya da satıcının
 * geçmişinden gelir; belirsizse düğmeli soru sorulur. Görsel olmayan dosya OCR'a hiç gitmez.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const T = randomUUID();
const [MUH, SATIS, AKARYAKIT, KIRTASIYE] = Array.from({ length: 4 }, () => randomUUID());
const HESAP_MUH = 960_000_000 + Math.floor(Math.random() * 1e7);
const HESAP_SATIS = HESAP_MUH + 1;
const rastgeleNo = () => 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// --- Sahte Telegram: getFile + dosya indirme + mesajlar ---
const giden: Array<{ yontem: string; govde: Record<string, unknown> }> = [];
const dosyalar: Record<string, Buffer> = { png: PNG, metin: Buffer.from("bu bir fiş değil, düz metin") };
let sunucu: Server;

// --- OCR, ek deposu ve taslak aracı kayıt tutan sahteler ---
let ocrYaniti: { satici: string; vkn: string | null; oneri: string | null } = { satici: "", vkn: null, oneri: null };
const ocrCagrilari: string[] = [];
const ai = {
  async fisFaturaOcrTara(_t: string, g: { gorselBase64: string }) {
    ocrCagrilari.push(g.gorselBase64.slice(0, 22));
    return {
      dogrulama: { gecerli: true, hatalar: [], uyarilar: [], veri: { belgeTuru: "FIS", belgeNo: "F-1", tarih: "2026-11-10", saticiUnvan: ocrYaniti.satici, saticiVknTckn: ocrYaniti.vkn, paraBirimi: "TRY", toplamKdv: 200, toplamMatrah: 1000, genelToplam: 1200, kdvKirilimi: [{ oran: 20, matrah: 1000, kdvTutari: 200 }], kalemler: [], guvenSkoru: 0.9 } },
      eslesenCari: null, onerilenMasrafKategorisi: ocrYaniti.oneri,
    };
  },
};
const ekYuklemeleri: Array<{ sahipTur: string; sahipId: string }> = [];
const ekler = {
  async yukle(sahipTur: string, sahipId: string, d: { size: number }) { ekYuklemeleri.push({ sahipTur, sahipId }); return { id: randomUUID(), boyut: d.size }; },
  async indir() { return { ek: { dosyaAdi: "fis.png", mimeTip: "image/png" }, icerik: PNG }; },
};
const taslaklar: Array<Record<string, unknown>> = [];
const yurutucu = {
  izinliAraclar: (rol: string) => (rol === "muhasebe" ? [{ ad: "masraf_taslagi_olustur", sinif: "taslak" }] : []),
  async yurut(c: { ad: string; girdi: Record<string, unknown> }) { taslaklar.push(c.girdi); return { icerik: JSON.stringify({ id: randomUUID(), durum: "taslak", adres: "/panel/masraflar" }) }; },
};
const ajan = { async telegramOturumKimligi() { return randomUUID(); }, async telegramGecmiseYaz() {} };

const masrafBelge = new MasrafBelgeService(prisma, ai as never, ekler as never, yurutucu as never, ajan as never);
const sorular = new AsistanSoruService(prisma, {} as never, {} as never, {} as never, yurutucu as never, masrafBelge);
const telegram = new TelegramService(prisma, new AbonelikErisimService(prisma), new KullaniciDurumService(prisma));
const kanal = new TelegramKanalService(prisma, ajan as never, telegram, sorular, undefined, masrafBelge);

const foto = (hesap: number, dosya: string, caption?: string) => kanal.isle({ update_id: rastgeleNo(), message: { message_id: rastgeleNo() % 100000, date: 0, chat: { id: hesap, type: "private" }, from: { id: hesap }, photo: [{ file_id: dosya, width: 1, height: 1, file_size: 70 }], ...(caption ? { caption } : {}) } });
const sonMetin = (hesap: number) => giden.filter((g) => g.yontem === "sendMessage" && g.govde.chat_id === String(hesap)).at(-1)?.govde as { text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } | undefined;

beforeAll(async () => {
  sunucu = createServer((istek, cevap) => {
    let govde = "";
    istek.on("data", (p) => (govde += p));
    istek.on("end", () => {
      const yol = istek.url ?? "";
      if (yol.includes("/file/bot")) { cevap.writeHead(200); cevap.end(dosyalar[yol.split("/").pop()!]); return; }
      const yontem = yol.split("/").pop()!;
      const veri = govde ? JSON.parse(govde) : {};
      giden.push({ yontem, govde: veri });
      const sonuc = yontem === "getFile" ? { file_path: `x/${veri.file_id}`, file_size: dosyalar[veri.file_id]?.length } : yontem === "sendMessage" ? { message_id: giden.length } : true;
      cevap.writeHead(200, { "Content-Type": "application/json" }); cevap.end(JSON.stringify({ ok: true, result: sonuc }));
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  (kanal as unknown as { istemci: TelegramIstemci }).istemci = new TelegramIstemci("123456789:AAEhBP0av18Fz6Xx-deneme-anahtari-00", `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`);

  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${T}::uuid, 'Belge Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  for (const [id, rol, hesap] of [[MUH, "muhasebe", HESAP_MUH], [SATIS, "satis", HESAP_SATIS]] as const) {
    await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${T}::uuid, ${`belge-${id}@test.local`}, 'x', ${rol}, ${rol}::"Rol", now())`;
    await y.telegramBagi.create({ data: { tenantId: T, userId: id, telegramKullaniciId: BigInt(hesap), sohbetId: BigInt(hesap), oturumSurumu: 0, rizaAt: new Date() } });
  }
  await y.$executeRaw`INSERT INTO masraf_kategorileri (id, tenant_id, ad, updated_at) VALUES (${AKARYAKIT}::uuid, ${T}::uuid, 'Akaryakıt', now()), (${KIRTASIYE}::uuid, ${T}::uuid, 'Kırtasiye', now())`;
  await y.modulAyar.create({ data: { tenantId: T, modul: "telegram", ayarlar: { etkin: true, tutarGoster: true } } });
  // Satıcının geçmişi: bu VKN'den daha önce Kırtasiye masrafı girilmiş.
  await y.$executeRawUnsafe(`INSERT INTO masraflar (id, tenant_id, kategori_id, belge_turu, tarih, matrah, kdv_tutari, toplam, durum, aciklama, vkn_tckn, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'fis', '2026-10-01', 100, 20, 120, 'onaylandi', 'eski', '9876543210', now())`, randomUUID(), T, KIRTASIYE);
});

afterAll(async () => {
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("Telegram'dan fiş fotoğrafıyla masraf (CNL-16)", () => {
  it("OCR'ın önerdiği kategori tek eşleşirse taslak doğrudan açılır, görsel masrafa eklenir", async () => {
    ocrYaniti = { satici: "Shell Petrol", vkn: null, oneri: "akaryakıt" };
    await foto(HESAP_MUH, "png", "Ankara yolu");
    expect(taslaklar.at(-1)).toMatchObject({ kategoriId: AKARYAKIT, saticiUnvan: "Shell Petrol", toplam: 1200, kdvOrani: 20, belgeTuru: "fis", aciklama: "Ankara yolu" });
    expect(ekYuklemeleri.map((e) => e.sahipTur)).toEqual(["ai_sohbet", "masraf"]);
    expect(sonMetin(HESAP_MUH)?.text).toMatch(/^🧾 Masraf taslağı açıldı: Shell Petrol · 10\.11\.2026 · 1\.200,00 TL \(KDV %20\) · Akaryakıt\./);
    expect(ocrCagrilari.at(-1)).toBe("data:image/png;base64,");
  });

  it("satıcının geçmişteki kategorisi soru sormadan kullanılır (CNL-10 öğrenme)", async () => {
    ocrYaniti = { satici: "Kırtasiyeci Ltd", vkn: "9876543210", oneri: null };
    await foto(HESAP_MUH, "png");
    expect(taslaklar.at(-1)).toMatchObject({ kategoriId: KIRTASIYE, vknTckn: "9876543210" });
  });

  it("kategori belirsizse düğmeli soru gider; seçimle taslak açılır", async () => {
    ocrYaniti = { satici: "Bilinmeyen Firma", vkn: null, oneri: "çeşitli" };
    const once = taslaklar.length;
    await foto(HESAP_MUH, "png");
    expect(taslaklar.length).toBe(once);
    const soru = sonMetin(HESAP_MUH)!;
    expect(soru.text).toMatch(/^❓ Bilinmeyen Firma — 1\.200,00 TL, 10\.11\.2026 belgesini masraf taslağı olarak açacağım/);
    const dugmeler = soru.reply_markup!.inline_keyboard.flat();
    const kirtasiye = dugmeler.find((d) => d.text === "Kırtasiye")!;
    await kanal.isle({ update_id: rastgeleNo(), callback_query: { id: "cb", from: { id: HESAP_MUH }, message: { message_id: 1, chat: { id: HESAP_MUH, type: "private" } }, data: kirtasiye.callback_data } });
    expect(taslaklar.at(-1)).toMatchObject({ kategoriId: KIRTASIYE, saticiUnvan: "Bilinmeyen Firma" });
    expect(sonMetin(HESAP_MUH)?.text).toMatch(/^✅ 🧾 Masraf taslağı açıldı/);
    const kayit = await prisma.tenantIslem(T, (tx) => tx.asistanSorusu.findFirst({ where: { tur: "masraf_kategori", userId: MUH } }));
    expect(kayit?.durum).toBe("yanitlandi");
  });

  it("görsel olmayan dosya içerik denetiminde durur; OCR'a hiç gitmez", async () => {
    const once = ocrCagrilari.length;
    await foto(HESAP_MUH, "metin");
    expect(ocrCagrilari.length).toBe(once);
    expect(sonMetin(HESAP_MUH)?.text).not.toMatch(/Masraf taslağı açıldı/);
    expect(sonMetin(HESAP_MUH)?.text).not.toMatch(/Invalid|prisma|\/home\//i);
  });

  it("masraf taslağı açamayan rol reddedilir; dosya indirilmez", async () => {
    const indirme = giden.filter((g) => g.yontem === "getFile").length;
    await foto(HESAP_SATIS, "png");
    expect(sonMetin(HESAP_SATIS)?.text).toMatch(/masraf taslağı açmaya izin vermiyor/);
    expect(giden.filter((g) => g.yontem === "getFile").length).toBe(indirme);
  });
});
