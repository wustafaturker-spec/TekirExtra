import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ServiceUnavailableException } from "@nestjs/common";
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
 * CNL-17g kabul testi: iki firmada bağlı iki Telegram hesabı, gerçek PostgreSQL (uygulama rolü,
 * RLS) ve sahte Telegram sunucusu. Yoklama döngüsü gerçekten çalışır; asistan, çağrıldığı firma
 * bağlamında yalnız o firmanın görebildiğini döndüren bir taklittir.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const A = { tenant: randomUUID(), yonetici: randomUUID(), kullanici: randomUUID(), unvan: "Alfa Tekstil" };
const B = { tenant: randomUUID(), yonetici: randomUUID(), kullanici: randomUUID(), unvan: "Beta Gıda" };
const HESAP_A = 700_000_000 + Math.floor(Math.random() * 1_000_000);
const HESAP_B = HESAP_A + 1;
const HESAP_YABANCI = HESAP_A + 2;
const HESAP_DENEYEN = HESAP_A + 3;

// --- Sahte Telegram sunucusu: getUpdates kuyruğu, sendMessage kayıtları ---
type Giden = { chat_id: string; text: string };
const kuyruk: Array<{ update_id: number; message: unknown }> = [];
const gidenler: Giden[] = [];
let sunucu: Server;
let taban = "";
let sonrakiNo = 5_000 + Math.floor(Math.random() * 1_000_000);

function mesaj(hesap: number, text: string | undefined, secenek: { tur?: "private" | "group"; no?: number } = {}) {
  const no = secenek.no ?? sonrakiNo++;
  kuyruk.push({ update_id: no, message: { message_id: no, date: Math.floor(Date.now() / 1000), chat: { id: secenek.tur === "group" ? -hesap : hesap, type: secenek.tur ?? "private" }, from: { id: hesap, username: `k${hesap}` }, ...(text !== undefined ? { text } : {}) } });
  return no;
}
const gelenler = (hesap: number) => gidenler.filter((g) => g.chat_id === String(hesap)).map((g) => g.text);
async function bekle(kosul: () => boolean, ms = 15_000) {
  const son = Date.now() + ms;
  while (!kosul()) { if (Date.now() > son) throw new Error("Beklenen Telegram yanıtı gelmedi"); await new Promise((r) => setTimeout(r, 50)); }
}
/** Bir hesaba giden yeni yanıtı bekler ve döndürür. */
async function yanit(hesap: number, onceki: number): Promise<string> {
  await bekle(() => gelenler(hesap).length > onceki);
  return gelenler(hesap)[onceki];
}

// --- Asistan taklidi: yalnız bağlamdaki firmanın gördüğünü yazar ---
const denenenler = new Set<string>();
const asistanCagrilari: Array<{ tenantId: string; userId: string; kanal?: string; requestId?: string }> = [];
const ajan = {
  async mesajiIsle(m: string, requestId: string, _e: unknown, _ek: unknown, secenek: { kanal?: string; olay?: (e: unknown) => void }) {
    const { tenantId, userId } = aktifBaglam();
    asistanCagrilari.push({ tenantId, userId, kanal: secenek.kanal, requestId });
    // Sağlayıcı zaman aşımı taklidi: ilk denemede hata; araçtan sonra hata.
    if (m === "zaman aşımı" && asistanCagrilari.filter((c) => c.requestId === requestId).length === 1 && !denenenler.has(m)) { denenenler.add(m); throw new ServiceUnavailableException("OpenAI yanıt vermedi."); }
    if (m === "araçtan sonra hata") { secenek.olay?.({ tur: "arac", ad: "belge_taslagi_olustur", etiket: "", durum: "basladi" }); throw new ServiceUnavailableException("OpenAI yanıt vermedi."); }
    const { firma, baglar, izler } = await prisma.tenantIslem(tenantId, async (tx) => ({
      firma: (await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }))?.unvan,
      baglar: await tx.telegramBagi.findMany({ select: { tenantId: true } }),
      izler: await tx.telegramMesaji.findMany({ select: { tenantId: true } }),
    }));
    const yabanci = [...baglar, ...izler].filter((x) => x.tenantId !== tenantId).length;
    return { cevap: `firma=${firma} yabanci=${yabanci} iban=TR330006100519786457841326`, onayTalepleri: [{ id: "11111111-1111-4111-8111-111111111111", ozet: "Fatura kesinleştir" }], araclar: [], oturumId: null };
  },
  async telegramSohbetiniKapat() {},
};

const erisim = new AbonelikErisimService(prisma);
const durum = new KullaniciDurumService(prisma);
const telegram = new TelegramService(prisma, erisim, durum);
const kanal = new TelegramKanalService(prisma, ajan as never, telegram);
const olarak = <T>(f: typeof A, userId: string, rol: string, fn: () => Promise<T>) => baglamlaCalistir({ tenantId: f.tenant, userId, rol } as never, fn);
const say = (f: typeof A, fn: (t: PrismaClient) => Promise<number>) => prisma.tenantIslem(f.tenant, (tx) => fn(tx as unknown as PrismaClient));

beforeAll(async () => {
  process.env.TELEGRAM_BOT_ADI = "tekir_deneme_bot";
  process.env.APP_URL = "https://panel.ornek";
  sunucu = createServer((istek, cevap) => {
    let govde = "";
    istek.on("data", (p) => (govde += p));
    istek.on("end", () => {
      const yontem = (istek.url ?? "").split("/").pop();
      const veri = govde ? JSON.parse(govde) : {};
      const yaz = (sonuc: unknown) => { cevap.writeHead(200, { "Content-Type": "application/json" }); cevap.end(JSON.stringify({ ok: true, result: sonuc })); };
      if (yontem === "getUpdates") {
        // Offset bilerek yok sayılır: Telegram'ın yeniden teslimi (süreç yeniden başlarken) taklit edilir.
        const ver = () => kuyruk.splice(0, kuyruk.length);
        if (kuyruk.length) return yaz(ver());
        return void setTimeout(() => yaz(ver()), 150);
      }
      if (yontem === "sendMessage") { gidenler.push({ chat_id: String(veri.chat_id), text: veri.text }); return yaz({ message_id: 1 }); }
      if (yontem === "getMe") return yaz({ id: 1, is_bot: true, username: "tekir_deneme_bot" });
      return yaz(true);
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  taban = `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`;

  for (const f of [A, B]) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f.tenant}::uuid, ${f.unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
    for (const [id, rol] of [[f.yonetici, "yonetici"], [f.kullanici, "muhasebe"]] as const) {
      await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${f.tenant}::uuid, ${`tg-${id}@test.local`}, 'x', ${`${f.unvan} ${rol}`}, ${rol}::"Rol", now())`;
    }
  }
  kanal.istemciKur = (anahtar) => new TelegramIstemci(anahtar, taban);
  process.env.TELEGRAM_BOT_TOKEN = "123456789:AAEhBP0av18Fz6Xx-deneme-anahtari-00";
});

afterAll(async () => {
  await kanal.onModuleDestroy();
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("Telegram kanalı — aşama A (CNL-01…05, 13, 17, 18, 20)", () => {
  let kodA = "";
  let kodB = "";

  it("ürün eklenmeden bağlantı alınamaz; yalnız yönetici ekler; rıza olmadan kod üretilmez", async () => {
    await expect(olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }))).rejects.toThrow(/eklenmemiş/);
    await expect(olarak(A, A.kullanici, "muhasebe", () => telegram.urunAyarla({ etkin: true, tutarGoster: true }))).rejects.toThrow(/yalnız yönetici/);
    for (const f of [A, B]) await olarak(f, f.yonetici, "yonetici", () => telegram.urunAyarla({ etkin: true, tutarGoster: true }));
    await expect(olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({}))).rejects.toThrow(/onaylamanız/);
    const a = await olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
    const b = await olarak(B, B.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
    expect(a.baglanti).toBe(`https://t.me/tekir_deneme_bot?start=${a.kod}`);
    expect(a.kod).toMatch(/^[A-Za-z0-9_-]{32}$/);
    kodA = a.kod; kodB = b.kod;
    // Kodun kendisi saklanmaz; yalnız özeti.
    expect(await yonetim.telegramBaglamaKodu.count({ where: { kodOzeti: kodA } })).toBe(0);
  });

  it("iki hesap kendi firmalarına bağlanır; bağlı olmayan hesap ve grup mesajı firma kaydına düşmez", async () => {
    kanal.baslat();
    let n = gelenler(HESAP_A).length;
    mesaj(HESAP_A, `/start ${kodA}`);
    expect(await yanit(HESAP_A, n)).toContain(`Bağlantı tamam: ${A.unvan} muhasebe — ${A.unvan}`);
    n = gelenler(HESAP_B).length;
    mesaj(HESAP_B, `/start ${kodB}`);
    expect(await yanit(HESAP_B, n)).toContain(B.unvan);

    // Kod tek kullanımlık.
    n = gelenler(HESAP_YABANCI).length;
    mesaj(HESAP_YABANCI, `/start ${kodA}`);
    expect(await yanit(HESAP_YABANCI, n)).toMatch(/geçersiz ya da süresi dolmuş/);
    mesaj(HESAP_YABANCI, "A firmasının bakiyesini göster");
    expect(await yanit(HESAP_YABANCI, n + 1)).toMatch(/Ayarlar › Bildirimler › Telegram/);

    const oncekiA = gelenler(HESAP_A).length;
    mesaj(HESAP_A, "merhaba", { tur: "group" });
    await new Promise((r) => setTimeout(r, 600));
    expect(gidenler.filter((g) => g.chat_id === String(-HESAP_A))).toHaveLength(0);
    expect(gelenler(HESAP_A)).toHaveLength(oncekiA);

    const bagA = await say(A, (t) => t.telegramBagi.count());
    expect(bagA).toBe(1);
    const izler = await yonetim.telegramMesaji.findMany({ where: { tenantId: { in: [A.tenant, B.tenant] } } });
    expect(izler.every((i) => i.tenantId === A.tenant ? i.userId === A.kullanici : i.userId === B.kullanici)).toBe(true);
    expect(await yonetim.auditLog.count({ where: { tenantId: A.tenant, islem: "telegram_baglandi" } })).toBe(1);
  });

  it("her hesabın sorusu yalnız kendi firmasının bağlamında yanıtlanır; IBAN süzülür, onay panele bağlanır", async () => {
    const [nA, nB] = [gelenler(HESAP_A).length, gelenler(HESAP_B).length];
    mesaj(HESAP_A, "durum nedir");
    mesaj(HESAP_B, "durum nedir");
    const [yA, yB] = [await yanit(HESAP_A, nA), await yanit(HESAP_B, nB)];
    expect(yA).toContain(`firma=${A.unvan} yabanci=0`);
    expect(yB).toContain(`firma=${B.unvan} yabanci=0`);
    expect(yA).toContain("TR** **** 1326");
    expect(yA).not.toContain("TR330006100519786457841326");
    expect(yA).toContain("https://panel.ornek/panel/ai?talep=11111111-1111-4111-8111-111111111111");
    expect(asistanCagrilari.slice(-2).map((c) => [c.tenantId, c.kanal]).sort()).toEqual([[A.tenant, "TELEGRAM"], [B.tenant, "TELEGRAM"]].sort());
    expect(asistanCagrilari.find((c) => c.tenantId === A.tenant)?.userId).toBe(A.kullanici);
  });

  it("model zaman aşımında araç çalışmadıysa bir kez yeniden dener; araç çalıştıysa denemez", async () => {
    let n = gelenler(HESAP_A).length;
    let cagri = asistanCagrilari.length;
    mesaj(HESAP_A, "zaman aşımı");
    expect(await yanit(HESAP_A, n)).toContain(`firma=${A.unvan}`);
    const iki = asistanCagrilari.slice(cagri);
    expect(iki).toHaveLength(2);
    expect(iki[0].requestId).not.toBe(iki[1].requestId);

    n = gelenler(HESAP_A).length;
    cagri = asistanCagrilari.length;
    mesaj(HESAP_A, "araçtan sonra hata");
    expect(await yanit(HESAP_A, n)).toMatch(/Şu anda yanıt veremiyorum/);
    expect(asistanCagrilari.length).toBe(cagri + 1);
    expect(await say(A, (t) => t.telegramMesaji.count({ where: { yon: "gelen", durum: "hata", hataTuru: "ai_hata" } }))).toBe(1);
  });

  it("sus / bugünlük yeter / devam kullanıcı ayarına yazılır, asistana gitmez (CNL-07)", async () => {
    const n = gelenler(HESAP_A).length;
    const cagri = asistanCagrilari.length;
    mesaj(HESAP_A, "Sus");
    expect(await yanit(HESAP_A, n)).toMatch(/24 saat/);
    const sus = await say(A, async (t) => ((await t.bildirimKullaniciAyari.findUnique({ where: { userId: A.kullanici } }))?.telegramSusBitis?.getTime() ?? 0) - Date.now());
    expect(sus).toBeGreaterThan(23 * 3_600_000);
    mesaj(HESAP_A, "/devam");
    expect(await yanit(HESAP_A, n + 1)).toMatch(/yeniden açıldı/);
    expect(await say(A, async (t) => ((await t.bildirimKullaniciAyari.findUnique({ where: { userId: A.kullanici } }))?.telegramSusBitis ? 1 : 0))).toBe(0);
    expect(asistanCagrilari.length).toBe(cagri);
  });

  it("aynı güncelleme ikinci kez gelirse yeniden işlenmez", async () => {
    const n = gelenler(HESAP_A).length;
    const cagri = asistanCagrilari.length;
    const no = mesaj(HESAP_A, "tekrar");
    await yanit(HESAP_A, n);
    mesaj(HESAP_A, "tekrar", { no });
    await new Promise((r) => setTimeout(r, 800));
    expect(asistanCagrilari.length).toBe(cagri + 1);
    expect(gelenler(HESAP_A)).toHaveLength(n + 1);
  });

  it("başka firmaya bağlı hesap yeni koda bağlanamaz; bağ değişince eski firmadan mesaj gitmez", async () => {
    const yeniA = await olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
    let n = gelenler(HESAP_B).length;
    mesaj(HESAP_B, `/start ${yeniA.kod}`);
    expect(await yanit(HESAP_B, n)).toMatch(/başka bir TekirExtra kullanıcısına bağlı/);
    expect(await say(A, (t) => t.telegramBaglamaKodu.count({ where: { kullanildiAt: { not: null } } }))).toBe(1);

    mesaj(HESAP_B, "/ayril");
    expect(await yanit(HESAP_B, n + 1)).toMatch(/Bağlantı kaldırıldı/);
    mesaj(HESAP_B, `/start ${yeniA.kod}`);
    expect(await yanit(HESAP_B, n + 2)).toContain(A.unvan);
    n = gelenler(HESAP_B).length;

    // B firmasından eski kullanıcıya gönderim: bağ yok, gönderilmez ve iz düşer.
    expect(await olarak(B, B.kullanici, "muhasebe", () => kanal.firmayaGonder(B.tenant, B.kullanici, null, "deneme", "B verisi"))).toBe("bag_gecersiz");
    expect(await say(B, (t) => t.telegramMesaji.count({ where: { yon: "giden", durum: "gonderilmedi", hataTuru: "bag_gecersiz" } }))).toBe(1);
    // A kullanıcısının eski hesabı (HESAP_A) artık yönerge alır; hesap B şimdi A firmasında konuşur.
    const nA = gelenler(HESAP_A).length;
    mesaj(HESAP_A, "durum");
    expect(await yanit(HESAP_A, nA)).toMatch(/Ayarlar › Bildirimler › Telegram/);
    mesaj(HESAP_B, "durum");
    expect(await yanit(HESAP_B, n)).toContain(`firma=${A.unvan} yabanci=0`);
    expect(gelenler(HESAP_B).some((x) => x.includes("B verisi"))).toBe(false);
    expect(await yonetim.auditLog.count({ where: { tenantId: B.tenant, islem: "telegram_bag_kaldirildi" } })).toBe(1);
  });

  it("parola/2FA değişince bağ kendiliğinden düşer", async () => {
    await yonetim.$executeRaw`UPDATE users SET oturum_surumu = oturum_surumu + 1 WHERE id = ${A.kullanici}::uuid`;
    const n = gelenler(HESAP_B).length;
    mesaj(HESAP_B, "durum");
    expect(await yanit(HESAP_B, n)).toMatch(/kaldırıldı: parolanız ya da iki adımlı doğrulamanız değişti/);
    expect(await say(A, (t) => t.telegramBagi.count())).toBe(0);
  });

  it("ürün çıkarılınca firmanın bütün bağları düşer, geçmiş iz kalır", async () => {
    const yeni = await olarak(A, A.kullanici, "muhasebe", () => telegram.kodUret({ riza: true }));
    const n = gelenler(HESAP_A).length;
    // Telegram bağlantıdaki kodu iletmediyse kullanıcı kodu tek başına yapıştırır.
    mesaj(HESAP_A, yeni.kod);
    expect(await yanit(HESAP_A, n)).toContain("Bağlantı tamam");
    expect(await say(A, (t) => t.telegramBagi.count())).toBe(1);
    const sonuc = await olarak(A, A.yonetici, "yonetici", () => telegram.urunAyarla({ etkin: false, tutarGoster: true }));
    expect(sonuc.dusenBag).toBe(1);
    expect(await say(A, (t) => t.telegramBagi.count())).toBe(0);
    expect(await say(A, (t) => t.telegramMesaji.count())).toBeGreaterThan(0);
    mesaj(HESAP_A, "durum");
    expect(await yanit(HESAP_A, n + 1)).toMatch(/Ayarlar › Bildirimler › Telegram/);
  });

  it("hatalı bağlama denemesi sınırlanır", async () => {
    const hesap = HESAP_DENEYEN;
    for (let i = 0; i < 5; i++) {
      const n = gelenler(hesap).length;
      mesaj(hesap, `/start ${"x".repeat(31)}${i}`);
      expect(await yanit(hesap, n)).toMatch(/geçersiz/);
    }
    const n = gelenler(hesap).length;
    mesaj(hesap, `/start ${kodB}`);
    expect(await yanit(hesap, n)).toMatch(/Çok fazla hatalı/);
  });

  it("RLS: bir firma bağlamında öteki firmanın Telegram kayıtları görünmez", async () => {
    const gorunen = await prisma.tenantIslem(B.tenant, async (tx) => [
      ...(await tx.telegramBagi.findMany({ select: { tenantId: true } })),
      ...(await tx.telegramMesaji.findMany({ select: { tenantId: true } })),
      ...(await tx.telegramBaglamaKodu.findMany({ select: { tenantId: true } })),
    ]);
    expect(gorunen.length).toBeGreaterThan(0);
    expect(gorunen.every((x) => x.tenantId === B.tenant)).toBe(true);
  });

  it("Telegram süreci nabız tablosuna kendi türüyle yazabilir (CNL-14)", async () => {
    const id = randomUUID();
    await yonetim.sistemSureci.create({ data: { id, tur: "telegram", makine: "kabul", pid: 1 } });
    await yonetim.sistemSureci.delete({ where: { id } });
  });

  it("panel durumu: bot adı yoksa özellik görünmez", async () => {
    const ad = process.env.TELEGRAM_BOT_ADI;
    delete process.env.TELEGRAM_BOT_ADI;
    try {
      expect(await olarak(B, B.kullanici, "muhasebe", () => telegram.durumGetir())).toEqual({ kullanilabilir: false });
    } finally { process.env.TELEGRAM_BOT_ADI = ad; }
    const d = await olarak(B, B.yonetici, "yonetici", () => telegram.durumGetir());
    expect(d).toMatchObject({ kullanilabilir: true, urunEkli: true, yonetici: true, bag: null });
  });
});
