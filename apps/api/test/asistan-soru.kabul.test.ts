import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HafizaService } from "../src/ai/hafiza/hafiza.service";
import { AsistanSoruService } from "../src/asistan-soru/asistan-soru.service";
import { AbonelikErisimService } from "../src/core/abonelik-erisim.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { KullaniciDurumService } from "../src/core/kullanici-durum.service";
import { PrismaService } from "../src/core/prisma.service";
import { EkstreEslestirmeService } from "../src/kasa-banka/ekstre-eslestirme.service";
import { ImapService } from "../src/tenant/imap.service";
import { TelegramBildirimService } from "../src/telegram/telegram-bildirim.service";
import { TelegramIstemci } from "../src/telegram/telegram-istemci";
import { TelegramKanalService } from "../src/telegram/telegram-kanal.service";
import { TelegramService } from "../src/telegram/telegram.service";

/**
 * CNL-09/10 kabul testi (gerçek PostgreSQL, RLS): soru üretimi (banka, e-posta, taslak), yanıtın
 * hafızaya/kurala yazılması, kesin işlemin onay talebi olması, taslağın doğrudan düzeltilmesi,
 * Telegram düğmesi ve serbest yanıt, kişi başına üç açık soru ve firmalar arası yalıtım.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const T = randomUUID();
const DIGER = randomUUID();
const [MUH, SATIS] = [randomUUID(), randomUUID()];
const [CARI, CARI2, PERSONEL, BANKA, EKSTRE] = Array.from({ length: 5 }, () => randomUUID());
const HESAP = 900_000_000 + Math.floor(Math.random() * 1e7);
const satirlar = { bos: randomUUID(), maas: randomUUID(), unvanli: randomUUID() };
const epostaId = randomUUID();
const [TASLAK_VADE, TASLAK_DOGRU] = [randomUUID(), randomUUID()];
const gecmis = Array.from({ length: 3 }, () => randomUUID());

// --- Sahte Telegram ---
const giden: Array<{ yontem: string; govde: Record<string, unknown> }> = [];
let sunucu: Server;
let mesajNo = 100;
/** Kabul veritabanı koşular arasında kalır; güncelleme numarası tekrar korumasına takılmasın. */
const rastgeleNo = () => 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

// --- Onay aracı taklidi: talep açıldı kabul edilir; girdi denetlenir ---
const talepler: Array<{ ad: string; girdi: Record<string, unknown> }> = [];
const yurutucu = {
  izinliAraclar: () => [{ ad: "ekstre_satiri_eslestir", sinif: "onay" }],
  async yurut(c: { ad: string; girdi: Record<string, unknown> }) { talepler.push(c); return { icerik: "ok", talep: { id: randomUUID() } }; },
};

const hafiza = new HafizaService(prisma);
const ekstre = new EkstreEslestirmeService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const sorular = new AsistanSoruService(prisma, ekstre, new ImapService(prisma, {} as never, {} as never, {} as never), hafiza, yurutucu as never);
const telegram = new TelegramService(prisma, new AbonelikErisimService(prisma), new KullaniciDurumService(prisma));
const ajan = { async telegramGecmiseYaz() {} };
const kanal = new TelegramKanalService(prisma, ajan as never, telegram, sorular);
const gonderici = new TelegramBildirimService(prisma, telegram, kanal, ajan as never, { cagir: async () => { throw new Error("yok"); } } as never);
const olarak = <R>(userId: string, rol: string, fn: () => Promise<R>, tenantId = T) => baglamlaCalistir({ tenantId, userId, rol } as never, fn);
const oku = <R>(fn: (t: PrismaClient) => Promise<R>) => prisma.tenantIslem(T, (tx) => fn(tx as unknown as PrismaClient));
const soru = (tur: string, kaynakId: string) => oku((t) => t.asistanSorusu.findFirst({ where: { tur, kaynakId } }));

beforeAll(async () => {
  sunucu = createServer((istek, cevap) => {
    let govde = "";
    istek.on("data", (p) => (govde += p));
    istek.on("end", () => {
      const yontem = (istek.url ?? "").split("/").pop()!;
      giden.push({ yontem, govde: govde ? JSON.parse(govde) : {} });
      cevap.writeHead(200, { "Content-Type": "application/json" });
      cevap.end(JSON.stringify({ ok: true, result: yontem === "sendMessage" ? { message_id: mesajNo++ } : true }));
    });
  });
  await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", r));
  (kanal as unknown as { istemci: TelegramIstemci }).istemci = new TelegramIstemci("123456789:AAEhBP0av18Fz6Xx-deneme-anahtari-00", `http://127.0.0.1:${(sunucu.address() as AddressInfo).port}`);

  const y = yonetim;
  for (const [id, unvan] of [[T, "Soru Test"], [DIGER, "Diğer Firma"]]) {
    await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${id}::uuid, ${unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
  }
  for (const [id, rol] of [[MUH, "muhasebe"], [SATIS, "satis"]] as const) {
    await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${T}::uuid, ${`soru-${id}@test.local`}, 'x', ${rol}, ${rol}::"Rol", now())`;
  }
  await y.$executeRaw`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, updated_at) VALUES
    (${CARI}::uuid, ${T}::uuid, 'MUS-SR1', 'ANADOLU TEKSTIL LTD', 'musteri', now()),
    (${CARI2}::uuid, ${T}::uuid, 'MUS-SR2', 'KARADENIZ GIDA AS', 'musteri', now()),
    (${PERSONEL}::uuid, ${T}::uuid, 'PER-SR1', 'AHMET YILMAZ', 'personel', now())`;
  await y.$executeRaw`INSERT INTO banka_hesaplari (id, tenant_id, ad, banka_adi, updated_at) VALUES (${BANKA}::uuid, ${T}::uuid, 'Test TL', 'Test', now())`;
  await y.$executeRaw`INSERT INTO banka_ekstreleri (id, tenant_id, banka_hesap_id, dosya_adi, satir_sayisi, yeni_satir_sayisi) VALUES (${EKSTRE}::uuid, ${T}::uuid, ${BANKA}::uuid, 'e.csv', 3, 3)`;
  const satir = (id: string, aciklama: string, karsi: string | null, tutar: number) => y.$executeRaw`INSERT INTO banka_ekstre_satirlari (id, tenant_id, ekstre_id, banka_hesap_id, tarih, tutar, aciklama, karsi_unvan, satir_ozeti, created_at, updated_at)
    VALUES (${id}::uuid, ${T}::uuid, ${EKSTRE}::uuid, ${BANKA}::uuid, CURRENT_DATE - 1, ${tutar}, ${aciklama}, ${karsi}, ${id}, now() - interval '2 hours', now())`;
  await satir(satirlar.bos, "GELEN FAST REF 99821", null, 4200);
  await satir(satirlar.maas, "KASIM MAAS ODEMESI", null, -35000);
  await satir(satirlar.unvanli, "HAVALE REF 1", "ZETA DIS TICARET", 1250);
  await y.$executeRaw`INSERT INTO gelen_epostalar (id, tenant_id, mesaj_id, gonderen_adi, gonderen_eposta, alici_eposta, konu, tarih, created_at)
    VALUES (${epostaId}::uuid, ${T}::uuid, ${`<${epostaId}@x>`}, 'Anadolu Tekstil Ltd', 'satis@anadolu-tekstil.example', 'biz@test.local', 'Fiyat teklifi', now(), now() - interval '1 hour')`;
  const fatura = (id: string, durum: string, tarih: string, vade: string, iskonto = 0, olusma = "now() - interval '2 hours'") => y.$executeRawUnsafe(
    `INSERT INTO faturalar (id, tenant_id, tip, durum, tarih, vade_tarihi, cari_id, doviz_cinsi, kur, toplam_brut, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_matrah, toplam_kdv, toplam_tevkifat, toplam_net_kdv, genel_toplam, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 'satis', $3::"FaturaDurum", $4::date, $5::date, $6::uuid, 'TRY', 1, 1000, $7, 0, 1000, 0, 0, 0, 1000, ${olusma}, ${olusma})`, id, T, durum, tarih, vade, CARI, iskonto);
  for (const [i, id] of gecmis.entries()) { const ay = ["07", "08", "10"][i]; await fatura(id, "kesin", `2026-${ay}-01`, `2026-${ay}-31`); }
  await fatura(TASLAK_VADE, "taslak", "2026-11-10", "2027-02-08");
  await fatura(TASLAK_DOGRU, "taslak", "2026-11-11", "2027-01-10");
});

afterAll(async () => {
  await new Promise((r) => sunucu.close(r));
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("asistan soruları (CNL-09/10)", () => {
  it("tarama: eşleşmeyen satır, tanınmayan gönderen ve sapan taslak sorulur; maaş satırı sorulmaz", async () => {
    expect(await olarak(MUH, "muhasebe", () => sorular.tara())).toBeGreaterThan(0);
    // İkinci tarama 30 dk içinde çalışmaz; yeni süre için zamanı ileri al.
    await olarak(MUH, "muhasebe", () => sorular.tara(new Date(Date.now() + 31 * 60_000)));
    expect(await soru("banka_satiri", satirlar.bos)).toMatchObject({ durum: "acik", serbestYanit: true, roller: ["yonetici", "muhasebe"] });
    expect(await soru("banka_satiri", satirlar.maas)).toBeNull();
    const e = await soru("eposta_gonderen", epostaId);
    expect(e?.secenekler).toEqual(expect.arrayContaining([expect.objectContaining({ kod: "cari0", etiket: "ANADOLU TEKSTIL LTD" })]));
    const t = await soru("taslak_kosul", TASLAK_VADE);
    expect(t?.soru).toContain("vade 90 gün; bu caride alışılmış vade 30 gün");
  });

  it("panel listesi role göre; satışçı banka sorusunu görmez ve yanıtlayamaz", async () => {
    const muh = await olarak(MUH, "muhasebe", () => sorular.liste());
    const sat = await olarak(SATIS, "satis", () => sorular.liste());
    expect(muh.some((s) => s.tur === "banka_satiri")).toBe(true);
    expect(sat.some((s) => s.tur === "banka_satiri")).toBe(false);
    expect(sat.some((s) => s.tur === "eposta_gonderen")).toBe(true);
    const b = (await soru("banka_satiri", satirlar.bos))!;
    await expect(olarak(SATIS, "satis", () => sorular.yanitla(b.id, { metin: "ANADOLU" }, "panel"))).rejects.toThrow(/size sorulmadı/);
  });

  it("e-posta yanıtı hafızaya cari eşleşmesi olarak yazılır, e-posta cariye bağlanır, adres bir daha sorulmaz", async () => {
    const e = (await soru("eposta_gonderen", epostaId))!;
    const r = await olarak(SATIS, "satis", () => sorular.yanitla(e.id, { kod: "cari0" }, "panel"));
    expect(r.sonuc).toContain("ANADOLU TEKSTIL LTD carisine bağlandı");
    expect((await oku((t) => t.gelenEposta.findUnique({ where: { id: epostaId } })))?.cariId).toBe(CARI);
    expect(await olarak(SATIS, "satis", () => hafiza.adresCarileri("SATIS@anadolu-tekstil.example"))).toEqual([CARI]);
    await expect(olarak(SATIS, "satis", () => sorular.yanitla(e.id, { kod: "cari0" }, "panel"))).rejects.toThrow(/zaten yanıtlandı/);
  });

  it("banka serbest yanıtı: cari çözülür, kural öğrenilir, eşleştirme onay talebi olur (kayıt yapılmaz)", async () => {
    const b = (await soru("banka_satiri", satirlar.unvanli))!;
    await expect(olarak(MUH, "muhasebe", () => sorular.yanitla(b.id, { metin: "A" }, "panel"))).rejects.toThrow(/birden çok cariyle/);
    expect((await soru("banka_satiri", satirlar.unvanli))?.durum).toBe("acik");
    await expect(olarak(MUH, "muhasebe", () => sorular.yanitla(b.id, { metin: "AHMET YILMAZ" }, "panel"))).rejects.toThrow(/bulamadım/);
    const r = await olarak(MUH, "muhasebe", () => sorular.yanitla(b.id, { metin: "MUS-SR2" }, "panel"));
    expect(r.sonuc).toMatch(/KARADENIZ GIDA AS carisine eşleştirme onayınıza sunuldu.*ZETA|sonraki hareketler/);
    expect(talepler.at(-1)).toEqual({ ad: "ekstre_satiri_eslestir", girdi: { satirId: satirlar.unvanli, cariId: CARI2 } });
    expect((await oku((t) => t.bankaEkstreSatir.findUnique({ where: { id: satirlar.unvanli } })))?.durum).toBe("beklemede");
    expect(await oku((t) => t.ekstreKurali.findFirst({ where: { anahtar: "zeta dis ticaret", cariId: CARI2 } }))).not.toBeNull();
  });

  it("taslak: alışılmışa çek vadeyi düzeltir; doğru yanıtı tercih olur ve aynı koşul bir daha sorulmaz", async () => {
    const t = (await soru("taslak_kosul", TASLAK_VADE))!;
    const r = await olarak(SATIS, "satis", () => sorular.yanitla(t.id, { kod: "olagan" }, "panel"));
    expect(r.sonuc).toContain("30 güne (10.12.2026)");
    expect((await oku((x) => x.fatura.findUnique({ where: { id: TASLAK_VADE } })))?.vadeTarihi?.toISOString().slice(0, 10)).toBe("2026-12-10");
    const d = (await soru("taslak_kosul", TASLAK_DOGRU))!;
    await olarak(SATIS, "satis", () => sorular.yanitla(d.id, { kod: "dogru" }, "panel"));
    expect(await olarak(SATIS, "satis", () => hafiza.aktifTercihler(CARI))).toContain("Bu cari için 60 gün vade olağandır.");
    const yeni = randomUUID();
    await yonetim.$executeRawUnsafe(`INSERT INTO faturalar (id, tenant_id, tip, durum, tarih, vade_tarihi, cari_id, doviz_cinsi, kur, toplam_brut, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_matrah, toplam_kdv, toplam_tevkifat, toplam_net_kdv, genel_toplam, created_at, updated_at)
      VALUES ($1::uuid, $2::uuid, 'satis', 'taslak', '2026-11-11', '2027-01-10', $3::uuid, 'TRY', 1, 1000, 0, 0, 1000, 0, 0, 0, 1000, now() - interval '2 hours', now() - interval '2 hours')`, yeni, T, CARI);
    await olarak(SATIS, "satis", () => sorular.tara(new Date(Date.now() + 62 * 60_000)));
    expect(await soru("taslak_kosul", yeni)).toBeNull();
  });

  it("kaynak başka yoldan işlenince soru geçersizleşir", async () => {
    await yonetim.bankaEkstreSatir.update({ where: { id: satirlar.bos }, data: { durum: "yoksayildi" } });
    await olarak(MUH, "muhasebe", () => sorular.tara(new Date(Date.now() + 93 * 60_000)));
    expect((await soru("banka_satiri", satirlar.bos))?.durum).toBe("gecersiz");
    await yonetim.bankaEkstreSatir.update({ where: { id: satirlar.bos }, data: { durum: "beklemede" } });
  });

  it("Telegram: en çok üç açık soru düğmeyle gider; düğme ve serbest yanıt soruyu yanıtlar, düğmeler kalkar", async () => {
    await yonetim.modulAyar.create({ data: { tenantId: T, modul: "telegram", ayarlar: { etkin: true, tutarGoster: true } } });
    await yonetim.telegramBagi.create({ data: { tenantId: T, userId: MUH, telegramKullaniciId: BigInt(HESAP), sohbetId: BigInt(HESAP), oturumSurumu: 0, rizaAt: new Date(Date.now() - 86_400_000), createdAt: new Date(Date.now() - 86_400_000) } });
    // Üç yeni açık soru daha (dördü açık): yalnız üçü gider.
    for (let i = 0; i < 3; i++) {
      const satirId = randomUUID();
      await yonetim.$executeRaw`INSERT INTO banka_ekstre_satirlari (id, tenant_id, ekstre_id, banka_hesap_id, tarih, tutar, aciklama, satir_ozeti, updated_at) VALUES (${satirId}::uuid, ${T}::uuid, ${EKSTRE}::uuid, ${BANKA}::uuid, CURRENT_DATE, ${100 + i}, ${`DENEME ${i}`}, ${satirId}, now())`;
      await yonetim.asistanSorusu.create({ data: { tenantId: T, tur: "banka_satiri", kaynakId: satirId, roller: ["muhasebe"], soru: `Deneme ${i}`, secenekler: [{ kod: "hayir", etiket: "Hayır" }, { kod: "panel", etiket: "Panelde bakacağım" }], veri: { onerilenCariId: null, karsiUnvan: null }, serbestYanit: true } });
    }
    await gonderici.tara();
    const sorulanlar = giden.filter((g) => g.yontem === "sendMessage" && (g.govde.reply_markup as { inline_keyboard?: unknown[] } | undefined)?.inline_keyboard?.length);
    expect(sorulanlar).toHaveLength(3);
    expect(String(sorulanlar[0].govde.text)).toMatch(/^❓ /);
    const ilk = sorulanlar[0];
    const [dugme] = (ilk.govde.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard[0];
    const mesajId = Number(mesajNo - 3);
    await kanal.isle({ update_id: rastgeleNo(), callback_query: { id: "cb1", from: { id: HESAP }, message: { message_id: mesajId, chat: { id: HESAP, type: "private" } }, data: dugme.callback_data } });
    expect(giden.some((g) => g.yontem === "editMessageReplyMarkup" && g.govde.message_id === mesajId)).toBe(true);
    expect(giden.some((g) => g.yontem === "answerCallbackQuery" && g.govde.callback_query_id === "cb1")).toBe(true);
    const ilkSoru = await oku((t) => t.asistanSoruGonderimi.findFirst({ where: { telegramMesajId: BigInt(mesajId) }, include: { soru: true } }));
    expect(ilkSoru?.soru.durum).toBe("yanitlandi");
    expect(ilkSoru?.soru.yanitKanali).toBe("telegram");

    // Serbest yanıt: ikinci soru mesajı yanıtlanarak cari yazılır.
    const ikinci = await oku((t) => t.asistanSoruGonderimi.findFirst({ where: { userId: MUH, klavyeKaldirildiAt: null }, orderBy: { createdAt: "asc" }, include: { soru: true } }));
    await kanal.isle({ update_id: rastgeleNo(), message: { message_id: 9999, date: 0, chat: { id: HESAP, type: "private" }, from: { id: HESAP }, text: "MUS-SR1", reply_to_message: { message_id: Number(ikinci!.telegramMesajId) } } });
    expect((await oku((t) => t.asistanSorusu.findUnique({ where: { id: ikinci!.soruId } })))?.durum).toBe("yanitlandi");
    expect(giden.some((g) => g.yontem === "sendMessage" && String(g.govde.text).startsWith("✅ "))).toBe(true);

    // Panelden yanıtlanan sorunun Telegram düğmeleri sonraki turda kalkar.
    const ucuncu = await oku((t) => t.asistanSoruGonderimi.findFirst({ where: { userId: MUH, klavyeKaldirildiAt: null }, include: { soru: true } }));
    await olarak(MUH, "muhasebe", () => sorular.yanitla(ucuncu!.soruId, { kod: "hayir" }, "panel")).catch(async () => olarak(MUH, "muhasebe", () => sorular.yanitla(ucuncu!.soruId, { metin: "MUS-SR1" }, "panel")));
    await gonderici.tara();
    expect(giden.some((g) => g.yontem === "editMessageReplyMarkup" && g.govde.message_id === Number(ucuncu!.telegramMesajId))).toBe(true);
  });

  it("RLS: başka firmanın bağlamında sorular görünmez ve yanıtlanamaz", async () => {
    const b = (await soru("banka_satiri", satirlar.bos))!;
    expect(await prisma.tenantIslem(DIGER, (tx) => tx.asistanSorusu.count())).toBe(0);
    await expect(olarak(MUH, "muhasebe", () => sorular.yanitla(b.id, { kod: "hayir" }, "panel"), DIGER)).rejects.toThrow(/bulunamadı/);
  });
});
