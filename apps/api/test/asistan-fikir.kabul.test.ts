import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/stok/stok.raporlar";
import "../src/cari/cari.raporlar";
import { trSimdi } from "../src/ai/ai-zaman";
import { HafizaService } from "../src/ai/hafiza/hafiza.service";
import { isoHafta } from "../src/asistan-soru/fikir.kurallari";
import { FikirService } from "../src/asistan-soru/fikir.service";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { KullaniciDurumService } from "../src/core/kullanici-durum.service";
import { PrismaService } from "../src/core/prisma.service";
import { RaporlarService } from "../src/core/raporlar/raporlar.service";
import { NakitAkisiService } from "../src/nakit-akisi/nakit-akisi.service";
import { isGunuMu } from "../src/telegram/telegram-bildirim.kurallari";
import { TelegramBildirimService } from "../src/telegram/telegram-bildirim.service";
import { TelegramIstemci } from "../src/telegram/telegram-istemci";
import { TelegramKanalService } from "../src/telegram/telegram-kanal.service";
import { TelegramService } from "../src/telegram/telegram.service";

/**
 * CNL-11 kabul testi (gerçek PostgreSQL, RLS): haftalık fikirler rapordan hesaplanır, model yalnız
 * anlatır (yeni sayı içeren anlatım atılır), işaret hafızaya yazılır ve sonraki haftayı etkiler,
 * Telegram'a iş günü bir kez düğmeli gider, düğme işareti kaydeder; satışçı rapora dayalı fikri görmez.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const T = randomUUID();
const [YON, SATIS, TED, BANKA, STOK1, STOK2, FATURA] = Array.from({ length: 7 }, () => randomUUID());
const HESAP = 950_000_000 + Math.floor(Math.random() * 1e7);
const rastgeleNo = () => 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

const giden: Array<{ yontem: string; govde: Record<string, unknown> }> = [];
let sunucu: Server;
let anlatim: (prompt: string) => string = () => "";

const hafiza = new HafizaService(prisma);
const fikirler = new FikirService(prisma, new RaporlarService(prisma, {} as never), new NakitAkisiService(prisma, {} as never), hafiza);
fikirler.anlaticiBul = async () => ({ saglayiciAdi: "deneme", metinUret: async (g: { prompt: string }) => anlatim(g.prompt) }) as never;
const telegram = new TelegramService(prisma, new AbonelikErisimService(prisma), new KullaniciDurumService(prisma));
const ajan = { async telegramGecmiseYaz() {} };
const kanal = new TelegramKanalService(prisma, ajan as never, telegram, undefined, fikirler);
const gonderici = new TelegramBildirimService(prisma, telegram, kanal, ajan as never, { cagir: async () => { throw new Error("yok"); } } as never, fikirler);
const olarak = <R>(userId: string, rol: string, fn: () => Promise<R>) => baglamlaCalistir({ tenantId: T, userId, rol } as never, fn);
const oku = <R>(fn: (t: PrismaClient) => Promise<R>) => prisma.tenantIslem(T, (tx) => fn(tx as unknown as PrismaClient));

/** Bu haftanın ve sonraki haftanın bir iş günü, Türkiye saatiyle 10:30. */
function isGunu(baslangic: Date): Date {
  let g = baslangic;
  while (!isGunuMu(trSimdi(g).gun, trSimdi(g).haftaGunu)) g = new Date(g.getTime() + 86_400_000);
  return new Date(`${trSimdi(g).gun}T10:30:00+03:00`);
}

beforeAll(async () => {
  sunucu = createServer((istek, cevap) => {
    let govde = "";
    istek.on("data", (p) => (govde += p));
    istek.on("end", () => {
      giden.push({ yontem: (istek.url ?? "").split("/").pop()!, govde: govde ? JSON.parse(govde) : {} });
      cevap.writeHead(200, { "Content-Type": "application/json" });
      cevap.end(JSON.stringify({ ok: true, result: { message_id: giden.length } }));
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  (kanal as unknown as { istemci: TelegramIstemci }).istemci = new TelegramIstemci("123456789:AAEhBP0av18Fz6Xx-deneme-anahtari-00", `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`);
  process.env.APP_URL = "https://panel.ornek";

  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${T}::uuid, 'Fikir Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  for (const [id, rol] of [[YON, "yonetici"], [SATIS, "satis"]] as const) {
    await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${T}::uuid, ${`fikir-${id}@test.local`}, 'x', ${rol}, ${rol}::"Rol", now())`;
  }
  // Yavaş stok: hiç hareketi olmayan, değeri 15.000 TL ve 3.000 TL iki ürün.
  await y.$executeRaw`INSERT INTO stok_kartlari (id, tenant_id, kod, ad, tip, mevcut_miktar, ortalama_maliyet, updated_at) VALUES
    (${STOK1}::uuid, ${T}::uuid, 'YV-1', 'Eski Model Pompa', 'urun', 10, 1500, now()), (${STOK2}::uuid, ${T}::uuid, 'YV-2', 'Yedek Conta', 'urun', 100, 30, now())`;
  // Erken ödeme: 40 gün sonra vadeli 20.000 TL alış faturası, bankada 100.000 TL.
  await y.$executeRaw`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, updated_at) VALUES (${TED}::uuid, ${T}::uuid, 'TED-F1', 'MARMARA HAMMADDE AS', 'tedarikci', now())`;
  await y.$executeRaw`INSERT INTO banka_hesaplari (id, tenant_id, ad, banka_adi, updated_at) VALUES (${BANKA}::uuid, ${T}::uuid, 'Ana TL', 'Banka', now())`;
  await y.$executeRaw`INSERT INTO kasa_banka_hareketleri (id, tenant_id, banka_hesap_id, tip, tutar, tutar_try, tarih) VALUES (${randomUUID()}::uuid, ${T}::uuid, ${BANKA}::uuid, 'tahsilat', 100000, 100000, CURRENT_DATE - 5)`;
  await y.$executeRawUnsafe(`INSERT INTO faturalar (id, tenant_id, tip, durum, tarih, vade_tarihi, cari_id, doviz_cinsi, kur, toplam_brut, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_matrah, toplam_kdv, toplam_tevkifat, toplam_net_kdv, genel_toplam, created_at, updated_at)
    VALUES ($1::uuid, $2::uuid, 'alis', 'kesin', CURRENT_DATE - 2, CURRENT_DATE + 40, $3::uuid, 'TRY', 1, 20000, 0, 0, 20000, 0, 0, 0, 20000, now(), now())`, FATURA, T, TED);
});

afterAll(async () => {
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("haftalık fikirler (CNL-11)", () => {
  const buHafta = isGunu(new Date());

  it("rapordan hesaplanır; geçerli anlatım kullanılır, yeni sayı içeren anlatım atılır; haftada bir", async () => {
    anlatim = (p) => (p.includes("hareketsiz") || p.includes("90 gündür") ? "Depoda 2 ürün 90 gündür duruyor ve 18.000,00 TL bağlı; en büyüğü Eski Model Pompa (YV-1) 15.000,00 TL." : "Tedarikçiye erken öderseniz %5 iskonto alır, 7.000 TL kazanırsınız.");
    expect(await olarak(YON, "yonetici", () => fikirler.haftalikUret(buHafta))).toBe(2);
    const l = await oku((t) => t.asistanFikri.findMany({ where: { hafta: isoHafta(trSimdi(buHafta).gun) }, orderBy: { etkiTl: "desc" } }));
    expect(l.map((f) => [f.tur, Number(f.etkiTl), f.modelAnlatti])).toEqual([["yavas_stok", 18000, true], ["erken_odeme", 400, false]]);
    expect(l[0].metin).toContain("18.000,00 TL bağlı");
    expect(l[1].metin).toBe("MARMARA HAMMADDE AS carisine " + l[1].metin.split("carisine ")[1]);
    expect(l[1].metin).toContain("%2 iskonto isterseniz kazanç 400,00 TL");
    expect(l[1].metin).not.toContain("7.000");
    expect(await olarak(YON, "yonetici", () => fikirler.haftalikUret(new Date(buHafta.getTime() + 7 * 3_600_000)))).toBe(0);
  });

  it("görme yetkisi rapora bağlı: satışçı stok/finans fikirlerini görmez", async () => {
    expect((await olarak(YON, "yonetici", () => fikirler.liste())).map((f) => f.tur).sort()).toEqual(["erken_odeme", "yavas_stok"]);
    expect(await olarak(SATIS, "satis", () => fikirler.liste())).toEqual([]);
  });

  it("Telegram: iş günü 10–12 arası bir kez, düğmeli; düğme işareti fikre ve hafızaya yazar", async () => {
    await yonetim.modulAyar.create({ data: { tenantId: T, modul: "telegram", ayarlar: { etkin: true, tutarGoster: true } } });
    await yonetim.telegramBagi.create({ data: { tenantId: T, userId: YON, telegramKullaniciId: BigInt(HESAP), sohbetId: BigInt(HESAP), oturumSurumu: 0, rizaAt: new Date(), createdAt: new Date(Date.now() - 86_400_000) } });
    await gonderici.tara(new Date(buHafta.getTime() - 2 * 3_600_000)); // 08:30: pencere dışı
    expect(giden.filter((g) => String(g.govde.chat_id) === String(HESAP) && String(g.govde.text ?? "").startsWith("💡"))).toHaveLength(0);
    await gonderici.tara(buHafta);
    // İz kaydının zamanı veritabanı saatidir; taklit edilen gün bugün değilse "haftada bir" koruması
    // kaydı görsün diye gönderim zamanı taklit edilen ana çekilir.
    await yonetim.telegramMesaji.updateMany({ where: { tenantId: T, yon: "giden", tur: "fikir" }, data: { createdAt: buHafta } });
    await gonderici.tara(new Date(buHafta.getTime() + 60_000));
    // Kalıcı kabul veritabanında önceki koşuların firmaları da taranır; yalnız bu koşunun hesabı sayılır.
    const fikirMesajlari = giden.filter((g) => String(g.govde.chat_id) === String(HESAP) && String(g.govde.text ?? "").startsWith("💡"));
    expect(fikirMesajlari).toHaveLength(2);
    expect(String(fikirMesajlari[0].govde.text)).toContain("https://panel.ornek/panel/raporlar?rapor=stok.hareketsiz");
    const dugmeler = (fikirMesajlari[0].govde.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard.flat().map((d) => d.callback_data);
    expect(dugmeler.map((d) => d.split(":")[2])).toEqual(["yarar", "yaramaz", "getirme"]);
    const getirme = dugmeler[2];
    await kanal.isle({ update_id: rastgeleNo(), callback_query: { id: "fk1", from: { id: HESAP }, message: { message_id: 1, chat: { id: HESAP, type: "private" } }, data: getirme } });
    expect(giden.some((g) => g.yontem === "answerCallbackQuery" && String(g.govde.text).includes("bir daha fikir getirmeyeceğim"))).toBe(true);
    expect((await oku((t) => t.asistanFikri.findFirst({ where: { tur: "yavas_stok" } })))?.isaret).toBe("getirme");
    expect(await oku((t) => t.aiHafiza.findFirst({ where: { tur: "fikir_isareti", anahtar: "yavas_stok:*", etiket: "getirme" } }))).not.toBeNull();
    await expect(olarak(YON, "yonetici", () => fikirler.isaretle(getirme.split(":")[1], "yarar"))).rejects.toThrow(/zaten işaretlendi/);
  });

  it("işaret sonraki haftayı etkiler: getirilmemesi istenen tür çıkmaz", async () => {
    anlatim = () => "";
    const sonraki = isGunu(new Date(buHafta.getTime() + 7 * 86_400_000));
    await olarak(YON, "yonetici", () => fikirler.haftalikUret(sonraki));
    const l = await oku((t) => t.asistanFikri.findMany({ where: { hafta: isoHafta(trSimdi(sonraki).gun) } }));
    expect(l.map((f) => f.tur)).toEqual(["erken_odeme"]);
  });

  it("iç hata Telegram'a metniyle gitmez; kullanıcı genel ileti görür", async () => {
    const asil = hafiza.fikirIsaretle.bind(hafiza);
    hafiza.fikirIsaretle = async () => { throw new Error("Invalid `tx.aiHafiza.create()` invocation in /home/gizli/yol.ts"); };
    try {
      const f = (await oku((t) => t.asistanFikri.findFirst({ where: { tur: "erken_odeme", isaret: null } })))!;
      await kanal.isle({ update_id: rastgeleNo(), callback_query: { id: "fk2", from: { id: HESAP }, message: { message_id: 2, chat: { id: HESAP, type: "private" } }, data: `f:${f.id}:yarar` } });
      const yanit = giden.filter((g) => g.yontem === "answerCallbackQuery" && g.govde.callback_query_id === "fk2").map((g) => String(g.govde.text));
      expect(yanit).toEqual(["İşaret kaydedilemedi; biraz sonra yeniden deneyin."]);
      // Hafıza yazılamadı: işaret de geri alındı.
      expect((await oku((t) => t.asistanFikri.findUnique({ where: { id: f.id } })))?.isaret).toBeNull();
    } finally { hafiza.fikirIsaretle = asil; }
  });

  it("RLS: başka firmanın bağlamında fikirler görünmez", async () => {
    expect(await prisma.tenantIslem(randomUUID(), (tx) => tx.asistanFikri.count())).toBe(0);
  });
});
