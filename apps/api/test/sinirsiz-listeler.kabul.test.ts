import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";
import { gunlukHareketNetleri, mutabakatHesapla, mutabakatOku } from "../src/kasa-banka/ekstre-mutabakat";
import { KasaBankaService } from "../src/kasa-banka/kasa-banka.service";
import { MasraflarService } from "../src/masraflar/masraflar.service";

/**
 * V-2 kabul testi (gerçek PostgreSQL, RLS): masraf defteri ve çek/senet portföyü imleçli sayfa
 * okur; özetler veritabanında toplanır ve eski (bellekte toplayan) hesapla aynı sonucu verir.
 * Masraf raporu dönemle sınırlıdır.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const [T, DIGER, U, KAT_A, KAT_B] = Array.from({ length: 5 }, () => randomUUID());
const masraflar = new MasraflarService(prisma, {} as never, {} as never);
const kasaBanka = new KasaBankaService(prisma, {} as never, {} as never);
const olarak = <R>(fn: () => Promise<R>, tenantId = T) => baglamlaCalistir({ tenantId, userId: U, rol: "muhasebe" } as never, fn);
const gunEkle = (g: number) => { const d = new Date(`${bugunTR()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + g); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  const y = yonetim;
  for (const t of [T, DIGER]) await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${t}::uuid, 'Liste Test', ${String(Date.now() + (t === T ? 0 : 1)).slice(-10)}, now(), now())`;
  await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${U}::uuid, ${T}::uuid, ${`liste-${U}@test.local`}, 'x', 'Liste', 'muhasebe'::"Rol", now())`;
  await y.$executeRaw`INSERT INTO masraf_kategorileri (id, tenant_id, ad, updated_at) VALUES (${KAT_A}::uuid, ${T}::uuid, 'Kırtasiye', now()), (${KAT_B}::uuid, ${T}::uuid, 'Kira', now())`;
  // 120 masraf: her 10'dan biri iptal, her 4'ten biri taslak, her 3'ten biri kısmi ödenmiş, bir kısmı dövizli.
  const satirlar: string[] = [];
  for (let i = 0; i < 120; i++) {
    const durum = i % 10 === 0 ? "iptal" : i % 4 === 0 ? "taslak" : "onaylandi";
    const odenen = i % 3 === 0 ? 50 : 0;
    const doviz = i % 7 === 0 ? "USD" : "TRY";
    const kur = doviz === "USD" ? 34.5 : 1;
    const tarih = gunEkle(-(i % 400));
    satirlar.push(`('${randomUUID()}', '${T}', '${i % 5 === 0 ? KAT_B : KAT_A}', '${i % 5 === 0 ? "kira" : "fis"}', '${tarih}', 100, 20, 120, ${i % 6 === 0 ? 12 : "NULL"}, ${odenen}, '${doviz}', ${kur}, '${durum}', '${odenen ? "kismi_odendi" : "odenmedi"}', '${i === 7 ? "Özel Kırtasiye Ltd" : "Satıcı " + i}', now())`);
  }
  await y.$executeRawUnsafe(`INSERT INTO masraflar (id, tenant_id, kategori_id, belge_turu, tarih, matrah, kdv_tutari, toplam, stopaj_tutari, odenen_tutar, doviz_cinsi, kur, durum, odeme_durumu, satici_unvan, updated_at) VALUES ${satirlar.join(",")}`);
  // Başka firmanın masrafı özete girmemeli.
  await y.$executeRawUnsafe(`INSERT INTO masraf_kategorileri (id, tenant_id, ad, updated_at) VALUES ('${randomUUID()}', '${DIGER}', 'X', now())`);
  // Çekler: açık/geciken/yaklaşan/bankada/ciro/karşılıksız, alınan ve verilen, TRY ve EUR.
  const durumlar = ["portfoyde", "tahsile_verildi", "teminata_verildi", "verildi", "ciro_edildi", "karsiliksiz", "tahsil_edildi", "odendi"];
  const cekler: string[] = [];
  for (let i = 0; i < 260; i++) {
    const durum = durumlar[i % durumlar.length];
    const yon = durum === "verildi" || durum === "odendi" ? "verilen" : "alinan";
    const doviz = i % 9 === 0 ? "EUR" : "TRY";
    const tutar = 1000 + i;
    cekler.push(`('${randomUUID()}', '${T}', 'cek', 'P-${i}', '${gunEkle((i % 90) - 45)}', ${tutar}, '${doviz}', ${doviz === "EUR" ? 37 : 1}, ${doviz === "EUR" ? tutar * 37 : tutar}, 'Borçlu ${i}', '${durum}', '${yon}', now())`);
  }
  await y.$executeRawUnsafe(`INSERT INTO cek_senetler (id, tenant_id, tur, portfoy_no, vade_tarihi, tutar, doviz_cinsi, kur, tutar_try, borclu, durum, yon, updated_at) VALUES ${cekler.join(",")}`);
});

afterAll(async () => {
  await prisma.$disconnect();
  await yonetim.$disconnect();
});

describe("masraf defteri sayfası (V-2)", () => {
  it("özet bellekteki eski hesapla aynı; iptal hariç, dövizli kurla", async () => {
    const tumu = await yonetim.masraf.findMany({ where: { tenantId: T } });
    const gecerli = tumu.filter((m) => m.durum !== "iptal");
    const tl = (m: (typeof tumu)[number], t: unknown) => Number(t ?? 0) * Number(m.kur);
    const beklenen = {
      toplam: gecerli.reduce((t, m) => t + tl(m, m.toplam), 0),
      odenmemis: gecerli.reduce((t, m) => t + Math.max(0, tl(m, m.toplam) - tl(m, m.stopajTutari) - tl(m, m.odenenTutar)), 0),
      kira: gecerli.filter((m) => m.belgeTuru === "kira").reduce((t, m) => t + tl(m, m.toplam), 0),
      taslak: gecerli.filter((m) => m.durum === "taslak").length,
    };
    const s = await olarak(() => masraflar.sayfa({}));
    expect(s.ozet.toplam).toBeCloseTo(beklenen.toplam, 2);
    expect(s.ozet.odenmemis).toBeCloseTo(beklenen.odenmemis, 2);
    expect(s.ozet.kira).toBeCloseTo(beklenen.kira, 2);
    expect(s.ozet.taslak).toBe(beklenen.taslak);
    expect(s.adet).toBe(gecerli.length);
  });

  it("imleçle bütün kayıtlar bir kez ve tarih sırasıyla gelir", async () => {
    const goruldu: string[] = [];
    let imlec: string | undefined;
    let tarihler: string[] = [];
    do {
      const s = await olarak(() => masraflar.sayfa({ durum: "tumu", adet: "25", ...(imlec ? { imlec } : {}) }));
      goruldu.push(...s.kayitlar.map((k) => k.id));
      tarihler = [...tarihler, ...s.kayitlar.map((k) => k.tarih.toISOString())];
      imlec = s.sonrakiImlec ?? undefined;
    } while (imlec);
    expect(goruldu).toHaveLength(120);
    expect(new Set(goruldu).size).toBe(120);
    expect([...tarihler].sort().reverse()).toEqual(tarihler);
  });

  it("süzgeçler sunucuda: arama, durum, bakiye, kategori", async () => {
    expect((await olarak(() => masraflar.sayfa({ arama: "özel kırtasiye" }))).kayitlar.map((k) => k.saticiUnvan)).toEqual(["Özel Kırtasiye Ltd"]);
    expect((await olarak(() => masraflar.sayfa({ durum: "iptal" }))).adet).toBe(12);
    const odenmedi = await olarak(() => masraflar.sayfa({ durum: "odenmedi", adet: "200" }));
    expect(odenmedi.kayitlar.every((k) => k.durum !== "iptal" && k.odemeDurumu !== "odendi")).toBe(true);
    const kira = await olarak(() => masraflar.sayfa({ kategoriId: KAT_B, durum: "tumu" }));
    expect(kira.adet).toBe(24);
  });

  it("başka firma görmez", async () => {
    expect((await olarak(() => masraflar.sayfa({}), DIGER)).adet).toBe(0);
  });

  it("rapor listesi dönemle sınırlı; iki yılı aşan dönem reddedilir", async () => {
    const r = await olarak(() => masraflar.listele({ baslangic: gunEkle(-30), bitis: bugunTR() }));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((m) => m.tarih.toISOString().slice(0, 10) >= gunEkle(-30))).toBe(true);
    await expect(olarak(() => masraflar.listele({ baslangic: "2020-01-01", bitis: bugunTR() }))).rejects.toThrow(/en çok iki yıl/);
    const varsayilan = await olarak(() => masraflar.listele({}));
    expect(varsayilan.every((m) => m.tarih.toISOString().slice(0, 4) === bugunTR().slice(0, 4))).toBe(true);
  });
});

describe("çek/senet portföyü (V-2)", () => {
  /** Değişiklikten önceki bellekte toplama (karşılaştırma için). */
  async function eskiOzet(yon?: string) {
    const kayitlar = await yonetim.cekSenet.findMany({ where: { tenantId: T, ...(yon ? { yon: yon as never } : {}) } });
    const bugun = new Date(`${bugunTR()}T00:00:00Z`);
    const otuz = new Date(bugun); otuz.setUTCDate(otuz.getUTCDate() + 30);
    const acikD = yon === "verilen" ? ["verildi"] : yon === "alinan" ? ["portfoyde", "tahsile_verildi", "teminata_verildi"] : ["portfoyde", "tahsile_verildi", "teminata_verildi", "verildi"];
    const acik = kayitlar.filter((k) => acikD.includes(k.durum));
    const ozet = (l: typeof kayitlar) => ({ adet: l.length, toplamTry: l.reduce((t, k) => t + Number(k.tutarTry), 0).toFixed(2) });
    return {
      acik: { ...ozet(acik), dovizler: Object.fromEntries([...new Set(["TRY", ...acik.map((k) => k.dovizCinsi)])].map((d) => [d, acik.filter((k) => k.dovizCinsi === d).reduce((t, k) => t + Number(k.tutar), 0).toFixed(2)])) },
      geciken: ozet(acik.filter((k) => k.vadeTarihi < bugun)),
      yaklasan: ozet(acik.filter((k) => k.vadeTarihi >= bugun && k.vadeTarihi <= otuz)),
      bankada: ozet(kayitlar.filter((k) => ["tahsile_verildi", "teminata_verildi"].includes(k.durum))),
      ciro: ozet(kayitlar.filter((k) => k.durum === "ciro_edildi")),
      karsiliksiz: ozet(kayitlar.filter((k) => k.durum === "karsiliksiz")),
    };
  }

  it.each([undefined, "alinan", "verilen"])("özet SQL'de, eski hesapla aynı (yön %s)", async (yon) => {
    expect(await olarak(() => kasaBanka.cekSenetOzet(yon))).toEqual(await eskiOzet(yon));
  });

  it("imleçli sayfa: vade sırası, tekrar yok, süzgeç sayısı doğru", async () => {
    const ids: string[] = [];
    let imlec: string | undefined;
    let vadeler: string[] = [];
    do {
      const s = await olarak(() => kasaBanka.cekSenetSayfa({ adet: "70", ...(imlec ? { imlec } : {}) }));
      expect(s.adet).toBe(260);
      ids.push(...s.kayitlar.map((k) => k.id));
      vadeler = [...vadeler, ...s.kayitlar.map((k) => k.vadeTarihi.toISOString())];
      imlec = s.sonrakiImlec ?? undefined;
    } while (imlec);
    expect(new Set(ids).size).toBe(260);
    expect([...vadeler].sort()).toEqual(vadeler);
    const acik = await olarak(() => kasaBanka.cekSenetSayfa({ acik: true, yon: "alinan", adet: "500" }));
    expect(acik.kayitlar.every((k) => ["portfoyde", "tahsile_verildi", "teminata_verildi"].includes(k.durum))).toBe(true);
    expect(acik.adet).toBe(acik.kayitlar.length);
  });
});

describe("ekstre mutabakatı veritabanında (V-2)", () => {
  it("gün özetleri SQL'de; sonuç bellekteki eski hesapla aynı (karışık sıra, eksik bakiye, bekleyen/yoksayılan)", async () => {
    const HESAP = randomUUID(), EKSTRE = randomUUID();
    await yonetim.$executeRaw`INSERT INTO banka_hesaplari (id, tenant_id, ad, banka_adi, updated_at) VALUES (${HESAP}::uuid, ${T}::uuid, 'Mutabakat', 'Banka', now())`;
    await yonetim.$executeRaw`INSERT INTO banka_ekstreleri (id, tenant_id, banka_hesap_id, dosya_adi, satir_sayisi, yeni_satir_sayisi) VALUES (${EKSTRE}::uuid, ${T}::uuid, ${HESAP}::uuid, 'x.csv', 0, 0)`;
    // Rastgele ama tekrarlanabilir: 60 gün, gün başına 0–6 satır; bazı günler azalan sırayla, bazıları bakiyesiz.
    let tohum = 7;
    const r = () => { tohum = (tohum * 48271) % 2147483647; return tohum / 2147483647; };
    let bakiye = 10_000;
    const satirlar: string[] = [];
    const hareketler: string[] = [];
    for (let g = 0; g < 60; g++) {
      const tarih = gunEkle(-60 + g);
      const adet = Math.floor(r() * 7);
      const gun: Array<{ tutar: number; bakiye: number }> = [];
      for (let i = 0; i < adet; i++) { const tutar = Math.round((r() - 0.45) * 2000 * 100) / 100; bakiye = Math.round((bakiye + tutar) * 100) / 100; gun.push({ tutar, bakiye }); }
      if (r() < 0.3) gun.reverse();
      const bakiyesiz = r() < 0.15;
      gun.forEach((x, i) => {
        const durum = r() < 0.15 ? "beklemede" : r() < 0.1 ? "yoksayildi" : "eslesti";
        // Eşit oluşturulma anı: sıra kimlikle belirlenir (iki tarafta da aynı kural).
        satirlar.push(`('${randomUUID()}', '${T}', '${EKSTRE}', '${HESAP}', '${tarih}', ${x.tutar}, ${bakiyesiz ? "NULL" : x.bakiye}, 'a', '${durum}', '${randomUUID()}', '2026-01-01 00:00:0${i % 3}', now())`);
        if (durum === "eslesti") hareketler.push(`('${randomUUID()}', '${T}', '${HESAP}', '${x.tutar < 0 ? "tediye" : "tahsilat"}', ${Math.abs(x.tutar)}, ${Math.abs(x.tutar)}, '${tarih}')`);
      });
    }
    await yonetim.$executeRawUnsafe(`INSERT INTO banka_ekstre_satirlari (id, tenant_id, ekstre_id, banka_hesap_id, tarih, tutar, bakiye, aciklama, durum, satir_ozeti, created_at, updated_at) VALUES ${satirlar.join(",")}`);
    await yonetim.$executeRawUnsafe(`INSERT INTO kasa_banka_hareketleri (id, tenant_id, banka_hesap_id, tip, tutar, tutar_try, tarih) VALUES ${hareketler.join(",")}`);

    const yeni = await prisma.tenantIslem(T, (tx) => mutabakatOku(tx, T, HESAP));
    const eskiSatirlar = await yonetim.bankaEkstreSatir.findMany({ where: { bankaHesapId: HESAP }, orderBy: [{ tarih: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { tarih: true, tutar: true, bakiye: true, durum: true } });
    const eski = mutabakatHesapla(eskiSatirlar, await prisma.tenantIslem(T, (tx) => gunlukHareketNetleri(tx, T, HESAP)));
    const { bakiyeSutunuVar, ...m } = yeni;
    expect(bakiyeSutunuVar).toBe(true);
    expect(m).toEqual(eski);
    expect(eski.gunler.length).toBeGreaterThan(20);
  });
});

