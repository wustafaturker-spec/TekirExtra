import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { vknGecerliMi } from "@tekirextra/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * v1.0 Kabul Ölçütleri (ISTERLER §6) — uçtan uca senaryolar.
 *
 * Derlenmiş uygulama (`dist/main.js`) alt süreç olarak ayağa kaldırılır ve
 * gerçek HTTP üzerinden sürülür; veritabanı, kuyruk ve depo gerçektir. Böylece
 * dağıtılan artefakt test edilir. e-belge trafiği mock entegratör adaptörü
 * üzerinden akar (T-01): gerçek sağlayıcı adaptörleri geldiğinde bu senaryolar
 * aynen onlara karşı koşturulabilir.
 *
 * Önce `npm run build`, ayrıca `docker compose up -d postgres redis mailpit
 * minio` gerekir.
 */

let sunucu: ChildProcess;
let taban: string;

/** VKN kontrol hanesi tutan, istenen son haneye sahip bir numara üretir. */
function vknUret(sonHaneCift: boolean): string {
  for (let i = 0; i < 200_000; i++) {
    const aday = String(1_000_000_000 + Math.floor(Math.random() * 9_000_000_000));
    if (!vknGecerliMi(aday)) continue;
    if ((Number(aday.at(-1)) % 2 === 0) !== sonHaneCift) continue;
    return aday;
  }
  throw new Error("Geçerli VKN üretilemedi");
}

interface Yanit<T = any> {
  durum: number;
  veri: T;
}

async function istek<T = any>(
  yol: string,
  secenek: { method?: string; body?: unknown; jeton?: string } = {},
): Promise<Yanit<T>> {
  const yanit = await fetch(`${taban}${yol}`, {
    method: secenek.method ?? "GET",
    headers: {
      ...(secenek.body ? { "Content-Type": "application/json" } : {}),
      ...(secenek.jeton ? { Authorization: `Bearer ${secenek.jeton}` } : {}),
    },
    body: secenek.body ? JSON.stringify(secenek.body) : undefined,
  });
  const metin = await yanit.text();
  let veri: unknown = metin;
  try {
    veri = JSON.parse(metin);
  } catch {
    /* PDF/Excel gibi ikili olmayan gövdeler metin kalır */
  }
  return { durum: yanit.status, veri: veri as T };
}

/** Yeni firma açar, yöneticisiyle giriş yapar ve erişim jetonunu döner. */
async function firmaAc(etiket: string, vkn: string) {
  const eposta = `kabul-${etiket}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@deneme.local`;
  const parola = "KabulTest2026x";
  const kayit = await istek("/tenant/kayit", {
    method: "POST",
    body: {
      unvan: `Kabul Test ${etiket}`,
      vkn,
      vergiDairesi: "Test VD",
      yoneticiEposta: eposta,
      yoneticiAdSoyad: "Kabul Yönetici",
      parola,
    },
  });
  expect(kayit.durum, JSON.stringify(kayit.veri)).toBe(201);

  const giris = await istek<{ accessToken: string }>("/auth/giris", {
    method: "POST",
    body: { eposta, parola },
  });
  expect(giris.durum, JSON.stringify(giris.veri)).toBe(201);

  return { eposta, parola, jeton: giris.veri.accessToken, tenantId: kayit.veri.tenantId };
}

/** Aktif mock entegratör bağlantısı kurar (EBLG-01a). */
async function entegratorBagla(jeton: string, saglayici = "izibiz") {
  const olustur = await istek<{ id: string }>("/baglantilar", {
    method: "POST",
    jeton,
    body: {
      aile: "ebelge",
      saglayici,
      config: { kullaniciAdi: "kabul-test", parola: "gizli", servisAdresi: "https://test" },
    },
  });
  expect(olustur.durum, JSON.stringify(olustur.veri)).toBe(201);

  const test = await istek<{ basarili: boolean }>(`/baglantilar/${olustur.veri.id}/test`, {
    method: "POST",
    jeton,
  });
  expect(test.durum, JSON.stringify(test.veri)).toBe(200);
  expect(test.veri.basarili).toBe(true);

  const aktif = await istek(`/baglantilar/${olustur.veri.id}/aktif-et`, {
    method: "POST",
    jeton,
  });
  expect(aktif.durum, JSON.stringify(aktif.veri)).toBe(201);
  return olustur.veri.id;
}

async function stokAc(jeton: string, kod: string) {
  const yanit = await istek<{ id: string }>("/stok", {
    method: "POST",
    jeton,
    body: {
      kod,
      ad: `Kabul Ürünü ${kod}`,
      tip: "urun",
      birim: "adet",
      kdvOrani: "20",
      alisFiyati: "60",
      satisFiyati: "100",
    },
  });
  expect(yanit.durum, JSON.stringify(yanit.veri)).toBe(201);
  return yanit.veri.id;
}

async function cariAc(jeton: string, kod: string, vkn: string, tip = "musteri") {
  const yanit = await istek<{ id: string }>("/cari", {
    method: "POST",
    jeton,
    body: { kod, unvan: `Kabul Cari ${kod}`, tip, kisiTipi: "tuzel", vknTckn: vkn },
  });
  expect(yanit.durum, JSON.stringify(yanit.veri)).toBe(201);
  return yanit.veri.id;
}

async function stokGirisi(jeton: string, stokId: string, miktar: string) {
  const yanit = await istek(`/stok/${stokId}/hareketler`, {
    method: "POST",
    jeton,
    body: {
      stokId,
      tip: "giris",
      miktar,
      girilenBirim: "adet",
      girilenMiktar: miktar,
      maliyet: "60",
      tarih: "2026-01-02",
    },
  });
  expect(yanit.durum, JSON.stringify(yanit.veri)).toBe(201);
}

async function stokMiktari(jeton: string, stokId: string): Promise<number> {
  const yanit = await istek<{ mevcutMiktar: string }>(`/stok/${stokId}`, { jeton });
  expect(yanit.durum).toBe(200);
  return Number(yanit.veri.mevcutMiktar);
}

/** Carinin TRY bakiyesi: pozitif = cari borçlu, negatif = firma borçlu. */
async function cariBakiyesi(jeton: string, cariId: string): Promise<number> {
  const yanit = await istek<{ bakiyeler: Array<{ dovizCinsi: string; bakiye: string }> }>(
    `/cari/${cariId}`,
    { jeton },
  );
  expect(yanit.durum).toBe(200);
  const tryBakiye = yanit.veri.bakiyeler.find((b) => b.dovizCinsi === "TRY");
  return Number(tryBakiye?.bakiye ?? 0);
}

async function faturaKes(
  jeton: string,
  govde: Record<string, unknown>,
): Promise<{ id: string; no: string | null }> {
  const olustur = await istek<{ id: string }>("/fatura", { method: "POST", jeton, body: govde });
  expect(olustur.durum, JSON.stringify(olustur.veri)).toBe(201);

  const kesin = await istek<{ id: string; no: string | null; durum: string }>(
    `/fatura/${olustur.veri.id}/kesinlestir`,
    { method: "POST", jeton, body: {} },
  );
  expect(kesin.durum, JSON.stringify(kesin.veri)).toBe(201);
  expect(kesin.veri.durum).toBe("kesin");
  return { id: olustur.veri.id, no: kesin.veri.no };
}

beforeAll(async () => {
  const giris = resolve(__dirname, "../dist/main.js");
  if (!existsSync(giris)) {
    throw new Error("dist/main.js yok — kabul testlerinden önce `npm run build` çalıştırın");
  }

  const port = 3100 + Math.floor(Math.random() * 400);
  taban = `http://127.0.0.1:${port}/api/v1`;
  sunucu = spawn(process.execPath, [giris], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });

  const sonlanma = new Date(Date.now() + 60_000);
  for (;;) {
    if (sunucu.exitCode !== null) {
      throw new Error(`API süreci ${sunucu.exitCode} koduyla kapandı`);
    }
    try {
      const yanit = await fetch(`http://127.0.0.1:${port}/health`);
      if (yanit.ok) break;
    } catch {
      /* henüz dinlemiyor */
    }
    if (Date.now() > sonlanma.getTime()) throw new Error("API 60 sn içinde ayağa kalkmadı");
    await new Promise((c) => setTimeout(c, 300));
  }
});

afterAll(() => {
  sunucu?.kill("SIGTERM");
});

describe("Kabul Ölçütü 1 — satış: e-belge yönlendirme, stok, cari, tahsilat", () => {
  it("mükellef cariye kesilen fatura e-Fatura olarak gider; stok düşer, cari borçlanır, tahsilatla bakiye kapanır", async () => {
    const { jeton } = await firmaAc("s1", vknUret(true));
    await entegratorBagla(jeton);

    const stokId = await stokAc(jeton, "KBL-1");
    await stokGirisi(jeton, stokId, "100");
    // Mock adaptör: son hanesi çift olan VKN e-Fatura mükellefi sayılır
    const cariId = await cariAc(jeton, "MUS-1", vknUret(true));

    const fatura = await faturaKes(jeton, {
      tip: "satis",
      tarih: "2026-02-01",
      cariId,
      satirlar: [
        { stokId, miktar: "10", birim: "adet", birimFiyat: "100", kdvOrani: "20" },
      ],
    });

    expect(await stokMiktari(jeton, stokId)).toBe(90);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(1200, 2);

    // EBLG-02: mükellefiyet sorgulanır, e-Fatura'ya yönlendirilir
    const gonder = await istek<{ tur: string; durum: string }>(`/ebelge/gonder/${fatura.id}`, {
      method: "POST",
      jeton,
    });
    expect(gonder.durum, JSON.stringify(gonder.veri)).toBe(201);
    expect(gonder.veri.tur).toBe("efatura");

    // EBLG-04: durum sorgulandıkça kuyrukta → iletildi → kabul ilerler
    const ilk = await istek<{ durum: string }>(`/ebelge/sorgula/${fatura.id}`, {
      method: "POST",
      jeton,
    });
    expect(["kuyrukta", "iletildi", "kabul"]).toContain(ilk.veri.durum);
    let sonDurum = ilk.veri.durum;
    for (let i = 0; i < 3 && sonDurum !== "iletildi" && sonDurum !== "kabul"; i++) {
      const tekrar = await istek<{ durum: string }>(`/ebelge/sorgula/${fatura.id}`, {
        method: "POST",
        jeton,
      });
      sonDurum = tekrar.veri.durum;
    }
    expect(["iletildi", "kabul"]).toContain(sonDurum);

    // Tahsilat → cari bakiyesi kapanır
    const kasa = await istek<{ id: string }>("/kasa-banka/kasalar", {
      method: "POST",
      jeton,
      body: { ad: "Merkez Kasa", dovizCinsi: "TRY" },
    });
    expect(kasa.durum, JSON.stringify(kasa.veri)).toBe(201);

    const tahsilat = await istek("/kasa-banka/hareketler", {
      method: "POST",
      jeton,
      body: {
        kasaId: kasa.veri.id,
        tip: "tahsilat",
        tutar: "1200",
        tarih: "2026-02-05",
        cariId,
        faturaId: fatura.id,
      },
    });
    expect(tahsilat.durum, JSON.stringify(tahsilat.veri)).toBe(201);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(0, 2);
  });

  it("mükellef olmayan cariye kesilen fatura e-Arşiv olarak gider", async () => {
    const { jeton } = await firmaAc("s1b", vknUret(true));
    await entegratorBagla(jeton);
    const stokId = await stokAc(jeton, "KBL-1B");
    await stokGirisi(jeton, stokId, "10");
    const cariId = await cariAc(jeton, "MUS-1B", vknUret(false));

    const fatura = await faturaKes(jeton, {
      tip: "satis",
      tarih: "2026-02-01",
      cariId,
      satirlar: [{ stokId, miktar: "1", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });

    const gonder = await istek<{ tur: string }>(`/ebelge/gonder/${fatura.id}`, {
      method: "POST",
      jeton,
    });
    expect(gonder.durum, JSON.stringify(gonder.veri)).toBe(201);
    expect(gonder.veri.tur).toBe("earsiv");
  });
});

describe("Kabul Ölçütü 2 — gelen e-Fatura alış faturasına işlenir", () => {
  it("entegratörden çekilen belge taslak alış faturası olur; tamamlanınca stok artar ve ödeme bakiyeyi kapatır", async () => {
    const { jeton } = await firmaAc("s2", vknUret(true));
    await entegratorBagla(jeton);
    const stokId = await stokAc(jeton, "KBL-2");

    const cek = await istek<{ toplamCekilen: number; yeniFaturaSayisi: number; eklenenFaturaIdler: string[] }>(
      "/ebelge/gelenleri-cek",
      { method: "POST", jeton },
    );
    expect(cek.durum, JSON.stringify(cek.veri)).toBe(201);
    expect(cek.veri.toplamCekilen).toBeGreaterThan(0);
    expect(cek.veri.yeniFaturaSayisi).toBe(1);

    const faturaId = cek.veri.eklenenFaturaIdler[0];
    const taslak = await istek<{ tip: string; durum: string; cariId: string; no: string | null }>(
      `/fatura/${faturaId}`,
      { jeton },
    );
    expect(taslak.veri.tip).toBe("alis");
    expect(taslak.veri.durum).toBe("taslak");
    expect(taslak.veri.no).toBe("MCK2026000000001");

    // Aynı belge ikinci çekimde yinelenmez (EBLG-05)
    const tekrar = await istek<{ yeniFaturaSayisi: number }>("/ebelge/gelenleri-cek", {
      method: "POST",
      jeton,
    });
    expect(tekrar.veri.yeniFaturaSayisi).toBe(0);

    // Kullanıcı taslağı kalemlerle tamamlayıp kesinleştirir → stok artar
    const guncelle = await istek(`/fatura/${faturaId}`, {
      method: "PATCH",
      jeton,
      body: {
        satirlar: [{ stokId, miktar: "20", birim: "adet", birimFiyat: "60", kdvOrani: "20" }],
      },
    });
    expect(guncelle.durum, JSON.stringify(guncelle.veri)).toBe(200);

    // Alış faturasında belge numarası tedarikçinin belgesinden gelir
    const kesin = await istek(`/fatura/${faturaId}/kesinlestir`, {
      method: "POST",
      jeton,
      body: { no: taslak.veri.no },
    });
    expect(kesin.durum, JSON.stringify(kesin.veri)).toBe(201);
    expect(await stokMiktari(jeton, stokId)).toBe(20);

    // Tedarikçiye ödeme (tediye) → bakiye kapanır
    const cariId = taslak.veri.cariId;
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(-1440, 2);

    const kasa = await istek<{ id: string }>("/kasa-banka/kasalar", {
      method: "POST",
      jeton,
      body: { ad: "Merkez Kasa", dovizCinsi: "TRY" },
    });
    const odeme = await istek("/kasa-banka/hareketler", {
      method: "POST",
      jeton,
      body: {
        kasaId: kasa.veri.id,
        tip: "tediye",
        tutar: "1440",
        tarih: "2026-02-10",
        cariId,
        faturaId,
      },
    });
    expect(odeme.durum, JSON.stringify(odeme.veri)).toBe(201);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(0, 2);
  });
});

describe("Kabul Ölçütü 3 — iade faturası stok ve cariyi ters yönde işler", () => {
  it("satış iadesinde stok geri girer ve cari alacaklanır", async () => {
    const { jeton } = await firmaAc("s3", vknUret(true));
    const stokId = await stokAc(jeton, "KBL-3");
    await stokGirisi(jeton, stokId, "50");
    const cariId = await cariAc(jeton, "MUS-3", vknUret(true));

    await faturaKes(jeton, {
      tip: "satis",
      tarih: "2026-03-01",
      cariId,
      satirlar: [{ stokId, miktar: "10", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });
    expect(await stokMiktari(jeton, stokId)).toBe(40);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(1200, 2);

    await faturaKes(jeton, {
      tip: "satis_iade",
      tarih: "2026-03-05",
      cariId,
      satirlar: [{ stokId, miktar: "4", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });

    expect(await stokMiktari(jeton, stokId)).toBe(44);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(720, 2);
  });
});

describe("Kabul Ölçütü 4 — dönem sonu raporları PDF/Excel alınabilir", () => {
  it("KDV özeti, cari ekstresi ve stok raporu üretilir", async () => {
    const { jeton } = await firmaAc("s4", vknUret(true));
    const stokId = await stokAc(jeton, "KBL-4");
    await stokGirisi(jeton, stokId, "30");
    const cariId = await cariAc(jeton, "MUS-4", vknUret(true));
    await faturaKes(jeton, {
      tip: "satis",
      tarih: "2026-04-01",
      cariId,
      satirlar: [{ stokId, miktar: "5", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });

    const kdv = await istek("/raporlar/fatura.kdv-dokumu/calistir", {
      method: "POST",
      jeton,
      body: { baslangic: "2026-01-01", bitis: "2026-12-31" },
    });
    expect(kdv.durum, JSON.stringify(kdv.veri)).toBe(201);

    const pdf = await fetch(`${taban}/raporlar/fatura.kdv-dokumu/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ baslangic: "2026-01-01", bitis: "2026-12-31" }),
    });
    expect(pdf.status).toBe(201);
    const pdfGovde = Buffer.from(await pdf.arrayBuffer());
    expect(pdfGovde.subarray(0, 5).toString()).toBe("%PDF-");

    const excel = await fetch(`${taban}/raporlar/stok.envanter/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
      body: JSON.stringify({}),
    });
    expect(excel.status).toBe(201);
    const excelGovde = Buffer.from(await excel.arrayBuffer());
    // XLSX bir ZIP kabıdır: "PK" imzasıyla başlar
    expect(excelGovde.subarray(0, 2).toString()).toBe("PK");

    const ekstre = await fetch(`${taban}/cari/${cariId}/ekstre/pdf`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });
    expect(ekstre.status).toBe(200);
    const ekstreGovde = Buffer.from(await ekstre.arrayBuffer());
    expect(ekstreGovde.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("Kabul Ölçütü 5 — rol kısıtı ve denetim izi", () => {
  it("satış rolündeki kullanıcı kasa/banka modülüne erişemez", async () => {
    const { jeton } = await firmaAc("s5", vknUret(true));

    const satisEposta = `kabul-s5-satis-${Date.now()}@deneme.local`;
    const satisParola = "SatisKabul2026x";
    const kullanici = await istek("/kullanicilar", {
      method: "POST",
      jeton,
      body: {
        eposta: satisEposta,
        adSoyad: "Satış Kullanıcısı",
        rol: "satis",
        parola: satisParola,
      },
    });
    expect(kullanici.durum, JSON.stringify(kullanici.veri)).toBe(201);

    const giris = await istek<{ accessToken: string }>("/auth/giris", {
      method: "POST",
      body: { eposta: satisEposta, parola: satisParola },
    });
    expect(giris.durum, JSON.stringify(giris.veri)).toBe(201);
    const satisJeton = giris.veri.accessToken;

    const kasalar = await istek("/kasa-banka/kasalar", { jeton: satisJeton });
    expect(kasalar.durum).toBe(403);

    const hareket = await istek("/kasa-banka/hareketler", {
      method: "POST",
      jeton: satisJeton,
      body: { tip: "tahsilat", tutar: "100", tarih: "2026-05-01" },
    });
    expect(hareket.durum).toBe(403);
  });

  it("kritik işlemler denetim izinde görünür; izi yalnızca yönetici okuyabilir", async () => {
    const { jeton } = await firmaAc("s5b", vknUret(true));
    const stokId = await stokAc(jeton, "KBL-5B");
    await stokGirisi(jeton, stokId, "10");
    const cariId = await cariAc(jeton, "MUS-5B", vknUret(true));
    const fatura = await faturaKes(jeton, {
      tip: "satis",
      tarih: "2026-05-02",
      cariId,
      satirlar: [{ stokId, miktar: "1", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });

    const iz = await istek<{
      kayitlar: Array<{ islem: string; varlik: string; varlikId: string | null; kullanici: { eposta: string } | null }>;
    }>("/denetim?adet=200", { jeton });
    expect(iz.durum, JSON.stringify(iz.veri)).toBe(200);

    // KLN-04: fatura kesme izde, kim yaptığıyla birlikte
    const kesme = iz.veri.kayitlar.find(
      (k) => k.varlik === "fatura" && k.islem.includes("kesinlestir") && k.varlikId === fatura.id,
    );
    expect(kesme, "fatura kesinleştirme denetim izinde yok").toBeDefined();
    expect(kesme?.kullanici?.eposta).toContain("kabul-s5b");

    // Cari ve stok oluşturma da ize düşer
    expect(iz.veri.kayitlar.some((k) => k.varlik === "cari")).toBe(true);
    expect(iz.veri.kayitlar.some((k) => k.varlik === "stok")).toBe(true);

    // KLN-04a: satış rolü denetim izini okuyamaz
    const satisEposta = `kabul-s5b-satis-${Date.now()}@deneme.local`;
    const satisParola = "SatisKabul2026x";
    await istek("/kullanicilar", {
      method: "POST",
      jeton,
      body: { eposta: satisEposta, adSoyad: "Satış", rol: "satis", parola: satisParola },
    });
    const giris = await istek<{ accessToken: string }>("/auth/giris", {
      method: "POST",
      body: { eposta: satisEposta, parola: satisParola },
    });
    const yasak = await istek("/denetim", { jeton: giris.veri.accessToken });
    expect(yasak.durum).toBe(403);
  });
});

describe("Kabul Ölçütü 6 — çok kiracılı yalıtım", () => {
  it("iki firma farklı entegratör bağlar ve birbirinin verisini göremez", async () => {
    const a = await firmaAc("s6a", vknUret(true));
    const b = await firmaAc("s6b", vknUret(true));

    await entegratorBagla(a.jeton, "foriba");
    await entegratorBagla(b.jeton, "izibiz");

    const aCari = await cariAc(a.jeton, "MUS-6A", vknUret(true));
    const aStok = await stokAc(a.jeton, "KBL-6A");
    await stokGirisi(a.jeton, aStok, "10");
    const aFatura = await faturaKes(a.jeton, {
      tip: "satis",
      tarih: "2026-06-01",
      cariId: aCari,
      satirlar: [{ stokId: aStok, miktar: "1", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });

    // Her firma kendi entegratörü üzerinden gönderebilir
    const aGonder = await istek(`/ebelge/gonder/${aFatura.id}`, { method: "POST", jeton: a.jeton });
    expect(aGonder.durum, JSON.stringify(aGonder.veri)).toBe(201);

    // B firması A'nın kayıtlarına erişemez
    expect((await istek(`/cari/${aCari}`, { jeton: b.jeton })).durum).toBe(404);
    expect((await istek(`/fatura/${aFatura.id}`, { jeton: b.jeton })).durum).toBe(404);
    expect((await istek(`/ebelge/gonder/${aFatura.id}`, { method: "POST", jeton: b.jeton })).durum).toBe(404);

    const bCariler = await istek<{ kayitlar?: unknown[] }>("/cari", { jeton: b.jeton });
    const liste = Array.isArray(bCariler.veri) ? bCariler.veri : (bCariler.veri.kayitlar ?? []);
    expect(liste).toHaveLength(0);

    const bBaglantilar = await istek<Array<{ saglayici: string }>>("/baglantilar", { jeton: b.jeton });
    expect(bBaglantilar.veri.map((k) => k.saglayici)).toEqual(["izibiz"]);
  });
});
