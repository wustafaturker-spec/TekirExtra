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
const [MUH, SATIS, AKARYAKIT, KIRTASIYE, KART1, KART2, KASA1, KASA2, ARAC] = Array.from({ length: 9 }, () => randomUUID());
const HESAP_MUH = 960_000_000 + Math.floor(Math.random() * 1e7);
const HESAP_SATIS = HESAP_MUH + 1;
const rastgeleNo = () => 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// --- Sahte Telegram: getFile + dosya indirme + mesajlar ---
const giden: Array<{ yontem: string; govde: Record<string, unknown> }> = [];
const dosyalar: Record<string, Buffer> = { png: PNG, metin: Buffer.from("bu bir fiş değil, düz metin") };
let sunucu: Server;

// --- OCR, ek deposu ve taslak aracı kayıt tutan sahteler ---
let ocrYaniti: { satici: string; vkn: string | null; oneri: string | null; ek?: Record<string, unknown> } = { satici: "", vkn: null, oneri: null };
const ocrCagrilari: string[] = [];
const ai = {
  async fisFaturaOcrTara(_t: string, g: { gorselBase64: string }) {
    ocrCagrilari.push(g.gorselBase64.slice(0, 22));
    return {
      dogrulama: { gecerli: true, hatalar: [], uyarilar: [], veri: { belgeTuru: "FIS", belgeNo: "F-1", tarih: "2026-11-10", saticiUnvan: ocrYaniti.satici, saticiVknTckn: ocrYaniti.vkn, paraBirimi: "TRY", toplamKdv: 200, toplamMatrah: 1000, genelToplam: 1200, kdvKirilimi: [{ oran: 20, matrah: 1000, kdvTutari: 200 }], kalemler: [], guvenSkoru: 0.9, ...ocrYaniti.ek } },
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
const tamamlamalar: Array<Record<string, unknown>> = [];
const yurutucu = {
  izinliAraclar: (rol: string) => (rol === "muhasebe" ? [{ ad: "masraf_taslagi_olustur", sinif: "taslak" }, { ad: "masraf_tamamla", sinif: "onay" }] : []),
  async yurut(c: { ad: string; girdi: Record<string, unknown> }) {
    if (c.ad === "masraf_tamamla") { tamamlamalar.push(c.girdi); return { icerik: "onay bekliyor", talep: { id: randomUUID() } }; }
    // Ödeme sorusu masraf taslakken geçerli kalır; testte gerçek bir taslak satırı yazılır.
    const id = randomUUID();
    await yonetim.$executeRawUnsafe(`INSERT INTO masraflar (id, tenant_id, kategori_id, belge_turu, tarih, matrah, kdv_tutari, toplam, durum, aciklama, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'fis', '2026-11-10', 1000, 200, 1200, 'taslak', 'test', now())`, id, T, c.girdi.kategoriId);
    taslaklar.push(c.girdi); return { icerik: JSON.stringify({ id, durum: "taslak", adres: "/panel/masraflar" }) };
  },
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
  // CNL-21/22: iki şirket kartı, bir kasa, bir araç.
  await y.$executeRaw`INSERT INTO kredi_kartlari (id, tenant_id, ad, banka_adi, son_dort_hane, "limit", hesap_kesim_gunu, son_odeme_gunu, updated_at) VALUES (${KART1}::uuid, ${T}::uuid, 'İş Kartı', 'İş Bankası', '1234', 50000, 5, 15, now()), (${KART2}::uuid, ${T}::uuid, 'Garanti Kartı', 'Garanti', '9876', 50000, 10, 20, now())`;
  await y.$executeRaw`INSERT INTO kasalar (id, tenant_id, ad, updated_at) VALUES (${KASA1}::uuid, ${T}::uuid, 'Merkez Kasa', now())`;
  await y.$executeRaw`INSERT INTO araclar (id, tenant_id, plaka, updated_at) VALUES (${ARAC}::uuid, ${T}::uuid, '34 TKR 34', now())`;
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

  it("CNL-21/22: kart son dört hanesi ve plaka eşleşirse tek onay talebi açılır", async () => {
    ocrYaniti = { satici: "Opet", vkn: null, oneri: "akaryakıt", ek: { plaka: "34tkr34", litre: 30.5, odemeSekli: "kart", kartSonDort: "9876" } };
    await foto(HESAP_MUH, "png");
    expect(tamamlamalar.at(-1)).toMatchObject({ odeme: { tur: "kart", hesapId: KART2 }, arac: { aracId: ARAC, kategori: "akaryakit", litre: 30.5 } });
    expect(sonMetin(HESAP_MUH)?.text).toMatch(/onay talebi açıldı \(ödeme: Garanti Kartı •••• 9876, araç: 34 TKR 34 30\.5 L\)/);
  });

  it("CNL-22: tek kasa varsa nakit fiş o kasaya; bilinmeyen plaka not olarak yazılır", async () => {
    ocrYaniti = { satici: "Otopark A.Ş.", vkn: null, oneri: "akaryakıt", ek: { plaka: "06 ZZ 99", odemeSekli: "nakit" } };
    await foto(HESAP_MUH, "png");
    expect(tamamlamalar.at(-1)).toEqual({ masrafId: expect.any(String), odeme: { tur: "kasa", hesapId: KASA1 } });
    expect(sonMetin(HESAP_MUH)?.text).toContain("06ZZ99 plakası araç kartlarında yok");
  });

  it("CNL-22: eşleşmeyen kart → düğmeli soru; seçimle talep açılır; cevap sonrası soru kapanır", async () => {
    ocrYaniti = { satici: "Opet", vkn: null, oneri: "akaryakıt", ek: { plaka: "34 TKR 34", odemeSekli: "kart", kartSonDort: "0000" } };
    const once = tamamlamalar.length;
    await foto(HESAP_MUH, "png");
    expect(tamamlamalar.length).toBe(once);
    const mesajlar = giden.filter((g) => g.yontem === "sendMessage" && g.govde.chat_id === String(HESAP_MUH));
    expect((mesajlar.at(-2)?.govde as { text: string }).text).toMatch(/^🧾 Masraf taslağı açıldı/);
    const soru = sonMetin(HESAP_MUH)!;
    expect(soru.text).toContain("•••• 0000");
    const dugmeler = soru.reply_markup!.inline_keyboard.flat();
    expect(dugmeler.map((d) => d.text)).toEqual(["İş Kartı •••• 1234", "Garanti Kartı •••• 9876", "Şirket kartı değil", "Panelde bakacağım"]);
    await kanal.isle({ update_id: rastgeleNo(), callback_query: { id: "cb2", from: { id: HESAP_MUH }, message: { message_id: 2, chat: { id: HESAP_MUH, type: "private" } }, data: dugmeler[0].callback_data } });
    expect(tamamlamalar.at(-1)).toMatchObject({ odeme: { tur: "kart", hesapId: KART1 }, arac: { aracId: ARAC, kategori: "akaryakit" } });
    const yanit = sonMetin(HESAP_MUH)!.text;
    expect(yanit).toMatch(/^✅ Onay talebi açıldı/);
    expect(yanit.match(/talep=/g)).toHaveLength(1);
    const kayit = await prisma.tenantIslem(T, (tx) => tx.asistanSorusu.findFirst({ where: { tur: "masraf_odeme", userId: MUH }, orderBy: { createdAt: "desc" } }));
    expect(kayit?.durum).toBe("yanitlandi");
  });

  it("CNL-22: birden çok kasada nakit fiş sorulur; 'Kasadan değil' yalnız aracı bağlar", async () => {
    await yonetim.$executeRaw`INSERT INTO kasalar (id, tenant_id, ad, updated_at) VALUES (${KASA2}::uuid, ${T}::uuid, 'Şube Kasa', now())`;
    ocrYaniti = { satici: "Opet", vkn: null, oneri: "akaryakıt", ek: { plaka: "34 TKR 34", odemeSekli: "nakit" } };
    await foto(HESAP_MUH, "png");
    const dugmeler = sonMetin(HESAP_MUH)!.reply_markup!.inline_keyboard.flat();
    expect(dugmeler.map((d) => d.text)).toEqual(["Merkez Kasa", "Şube Kasa", "Kasadan değil", "Panelde bakacağım"]);
    await kanal.isle({ update_id: rastgeleNo(), callback_query: { id: "cb3", from: { id: HESAP_MUH }, message: { message_id: 3, chat: { id: HESAP_MUH, type: "private" } }, data: dugmeler[2].callback_data } });
    expect(tamamlamalar.at(-1)).toEqual({ masrafId: expect.any(String), arac: { aracId: ARAC, kategori: "akaryakit" } });
  });

  it("masraf taslağı açamayan rol reddedilir; dosya indirilmez", async () => {
    const indirme = giden.filter((g) => g.yontem === "getFile").length;
    await foto(HESAP_SATIS, "png");
    expect(sonMetin(HESAP_SATIS)?.text).toMatch(/masraf taslağı açmaya izin vermiyor/);
    expect(giden.filter((g) => g.yontem === "getFile").length).toBe(indirme);
  });
});
