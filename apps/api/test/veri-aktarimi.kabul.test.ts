import { randomUUID } from "node:crypto";
import * as ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/ayar-tanimlari";
import { CariIceAktarmaService } from "../src/cari/cari-ice-aktarma.service";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
import { KasaBankaService } from "../src/kasa-banka/kasa-banka.service";
import { vadesiGecenleriHesapla } from "../src/rapor/rapor.service";
import { DepoService } from "../src/stok/depo.service";
import { StokService } from "../src/stok/stok.service";
import { VeriAktarimiService } from "../src/veri-aktarimi/veri-aktarimi.service";

/**
 * VAK-01…09: veri aktarım sihirbazı gerçek PostgreSQL'de, uygulama rolüyle (RLS).
 * Kaynak program başlıkları, geçiş tarihi, beş adım, vadesi geçenler raporu, kontrol
 * özeti ve geri alma sırası (engel, ters hareket, pasife alma).
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const tenantId = randomUUID();
const userId = randomUUID();
const [depoId, kasaId, bankaId] = [randomUUID(), randomUUID(), randomUUID()];
const GECIS = "2026-06-30";

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 60_000 }),
};
const donem = new DonemKilidiService(prisma as never);
const ayarlar = new AyarlarService(prisma as never);
const stok = new StokService(prisma as never, {} as never, new DepoService(prisma as never), donem, undefined, ayarlar);
const kasaBanka = new KasaBankaService(prisma as never, {} as never, donem);
const servis = new VeriAktarimiService(prisma as never, ayarlar, donem, new CariIceAktarmaService(prisma as never, donem), stok, kasaBanka);
const calistir = <T>(fn: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol: "yonetici" } as never, fn);

async function xlsx(basliklar: string[], ...satirlar: (string | number)[][]): Promise<Buffer> {
  const k = new ExcelJS.Workbook();
  const s = k.addWorksheet("Sayfa1");
  s.addRow(basliklar);
  for (const r of satirlar) s.addRow(r);
  return Buffer.from(await k.xlsx.writeBuffer());
}
const tx = <T>(fn: (t: never) => Promise<T>) => prisma.tenantIslem(tenantId, fn);
const partiler: Record<string, string> = {};

beforeAll(async () => {
  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Aktarım Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`vak-${userId}@test.local`}, 'x', 'Test Yönetici', 'yonetici', now())`;
  await y.$executeRaw`INSERT INTO depolar (id, tenant_id, kod, ad, varsayilan, updated_at) VALUES (${depoId}::uuid, ${tenantId}::uuid, 'MRK', 'Merkez Depo', true, now())`;
  await y.$executeRaw`INSERT INTO kasalar (id, tenant_id, ad, created_at, updated_at) VALUES (${kasaId}::uuid, ${tenantId}::uuid, 'Merkez Kasa', now(), now())`;
  await y.$executeRaw`INSERT INTO banka_hesaplari (id, tenant_id, ad, banka_adi, iban, updated_at) VALUES (${bankaId}::uuid, ${tenantId}::uuid, 'Ziraat TL', 'Ziraat', 'TR330001000000000000000001', now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("veri aktarım sihirbazı (VAK-01…09)", () => {
  it("geçiş tarihi saklanır; cari kartlar Logo başlıklarıyla ve geçiş tarihli açılışla aktarılır", async () => {
    await calistir(() => servis.gecisTarihiKaydet(GECIS));
    const dosya = await xlsx(["Cari Hesap Kodu", "Cari Hesap Ünvanı", "Açılış bakiyesi", "Açılış yönü", "Not"], ["M1", "Müşteri Bir A.Ş.", "", "", "x"], ["M2", "Müşteri İki Ltd.", 500, "Borç", "y"]);
    const on = await calistir(() => servis.onizle("cari", dosya, {}));
    expect(on.ozet).toMatchObject({ toplam: 2, yeni: 2, hatali: 0 });
    expect(on.taninmayanlar).toEqual(["Not"]);
    const r = await calistir(() => servis.uygula("cari", dosya, "cariler.xlsx", { Not: "" }));
    partiler.cari = r.partiId;
    const acilis = await tx((t: never) => (t as PrismaClient).cariHareket.findFirst({ where: { kaynakTur: "acilis" }, select: { tarih: true, tutar: true } }));
    expect(acilis?.tarih.toISOString().slice(0, 10)).toBe(GECIS);
    expect(Number(acilis?.tutar)).toBe(500);
  });

  it("stok kartları Mikro başlıklarıyla, açılış stoğu varsayılan depoya ve maliyetle yazılır", async () => {
    const kartlar = await xlsx(["Stok Kodu", "Stok İsmi", "Birim 1 Adı", "KDV Oranı"], ["A", "Vida", "adet", 20], ["B", "Somun", "adet", 20]);
    partiler.stok = (await calistir(() => servis.uygula("stok", kartlar, "stok.xlsx", {}))).partiId;
    const acilis = await xlsx(["Stok Kodu", "Miktar", "Birim maliyet"], ["A", 10, 5], ["YOK", 1, 1]);
    const on = await calistir(() => servis.onizle("acilis_stok", acilis, {}));
    expect(on.ozet).toMatchObject({ yeni: 1, hatali: 1 });
    partiler.acilisStok = (await calistir(() => servis.uygula("acilis_stok", acilis, "acilis.xlsx", {}))).partiId;
    const a = await tx((t: never) => (t as PrismaClient).stokKart.findFirst({ where: { kod: "A" }, select: { mevcutMiktar: true, ortalamaMaliyet: true } }));
    expect([Number(a?.mevcutMiktar), Number(a?.ortalamaMaliyet)]).toEqual([10, 5]);
  });

  it("kasa/banka açılışı adla ya da IBAN'la; aynı hesaba ikinci açılış reddedilir", async () => {
    const dosya = await xlsx(["Hesap", "Bakiye"], ["merkez kasa", 1000], ["TR33 0001 0000 0000 0000 0000 01", 2500]);
    partiler.kasa = (await calistir(() => servis.uygula("kasa_banka", dosya, "kasa.xlsx", {}))).partiId;
    const tekrar = await calistir(() => servis.onizle("kasa_banka", dosya, {}));
    expect(tekrar.ozet.hatali).toBe(2);
    expect(tekrar.satirlar[0].hatalar.join()).toContain("açılış fişi zaten var");
  });

  it("açık faturalar belge bazında yazılır; toplam açılışlı cari reddedilir; vadesi geçenler raporuna girer", async () => {
    const dosya = await xlsx(["Cari Kodu", "Yön", "Fatura No", "Fatura Tarihi", "Vade Tarihi", "Kalan Tutar"],
      ["M1", "Borç", "ESK2026000000001", "01.06.2026", "15.07.2026", 300],
      ["M2", "Borç", "ESK2026000000002", "01.06.2026", "15.07.2026", 100]);
    const on = await calistir(() => servis.onizle("acik_fatura", dosya, {}));
    expect(on.ozet).toMatchObject({ yeni: 1, hatali: 1 });
    expect(on.satirlar[1].hatalar.join()).toContain("toplam açılış bakiyesi var");
    partiler.fatura = (await calistir(() => servis.uygula("acik_fatura", dosya, "faturalar.xlsx", {}))).partiId;
    const rapor = await calistir(() => tx((t: never) => vadesiGecenleriHesapla(t, tenantId)));
    const kalem = rapor.alacaklar.find((a) => a.no === "ESK2026000000001");
    expect(kalem).toMatchObject({ kalanTry: "300.00", vadeTarihi: "2026-07-15", acilis: true });
    // M2'nin toplam açılışı vadesiz; geçiş tarihinde vadesi gelmiş sayılır.
    expect(rapor.alacaklar.some((a) => a.no === "Açılış bakiyesi" && a.kalanTry === "500.00")).toBe(true);
  });

  it("kontrol özeti geçiş tarihi itibarıyla cari, stok ve kasa/banka toplamlarını verir", async () => {
    const o = await calistir(() => servis.kontrolOzeti());
    expect(o.cari.dovizler).toEqual([{ dovizCinsi: "TRY", borc: "800.00", alacak: "0.00", bakiye: "800.00" }]);
    expect(o.stok.deger).toBe("50.00");
    expect(o.kasaBanka.map((h) => [h.ad, h.bakiye])).toEqual([["Merkez Kasa", "1000.00"], ["Ziraat TL", "2500.00"]]);
    expect((await calistir(() => servis.kontrolOzetiExcel())).length).toBeGreaterThan(1000);
  });

  it("geri alma: bağlı kayıt varken reddedilir, sırayla geri alınır, iki kez alınmaz", async () => {
    await expect(calistir(() => servis.geriAl(partiler.cari))).rejects.toThrow(/sonradan işlem/);
    await calistir(() => servis.geriAl(partiler.fatura));
    await calistir(() => servis.geriAl(partiler.cari));
    expect(await tx((t: never) => (t as PrismaClient).cariHesap.count())).toBe(0);
    await expect(calistir(() => servis.geriAl(partiler.stok))).rejects.toThrow(/sonradan hareket/);
    await calistir(() => servis.geriAl(partiler.acilisStok));
    const sonuc = await calistir(() => servis.geriAl(partiler.stok));
    expect(sonuc.pasifeAlinanStok).toBe(1);
    const kartlar = await tx((t: never) => (t as PrismaClient).stokKart.findMany({ select: { kod: true, aktif: true, mevcutMiktar: true } }));
    expect(kartlar.map((k) => [k.kod, k.aktif, Number(k.mevcutMiktar)])).toEqual([["A", false, 0]]);
    await calistir(() => servis.geriAl(partiler.kasa));
    expect(await tx((t: never) => (t as PrismaClient).kasaBankaHareket.count())).toBe(0);
    await expect(calistir(() => servis.geriAl(partiler.kasa))).rejects.toThrow(/zaten geri alındı/);
    const durum = await calistir(() => servis.durum());
    expect(durum.gecisTarihi).toBe(GECIS);
    expect(durum.partiler.every((p) => p.geriAlindiAt)).toBe(true);
  });
});
