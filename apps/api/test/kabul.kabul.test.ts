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
let worker: ChildProcess;
let taban: string;
let sunucuCiktisi = "";
let workerCiktisi = "";
const bugun = () => new Date().toISOString().slice(0, 10);

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
  expect(kayit.durum, `${JSON.stringify(kayit.veri)}${sunucuCiktisi ? `\nAPI çıktısı:\n${sunucuCiktisi}` : ""}`).toBe(201);

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

async function kuyrukIsiniBekle(jeton: string, isId: string) {
  const sonlanma = Date.now() + 30_000;
  for (;;) {
    const liste = await istek<Array<{ id: string; durum: string; hata: string | null }>>("/ebelge/kuyruk", { jeton });
    expect(liste.durum, JSON.stringify(liste.veri)).toBe(200);
    const is = liste.veri.find((kayit) => String(kayit.id) === String(isId));
    if (is?.durum === "completed") return;
    if (is?.durum === "failed" || is?.durum === "dead-letter") {
      throw new Error(`Kuyruk işi başarısız: ${is.hata ?? is.durum}`);
    }
    if (Date.now() >= sonlanma) throw new Error(`Kuyruk işi 30 sn içinde tamamlanmadı: ${isId}`);
    await new Promise((c) => setTimeout(c, 200));
  }
}

beforeAll(async () => {
  const giris = resolve(__dirname, "../dist/main.js");
  if (!existsSync(giris)) {
    throw new Error("dist/main.js yok — kabul testlerinden önce `npm run build` çalıştırın");
  }

  const port = 3100 + Math.floor(Math.random() * 400);
  const workerPort = 9500 + Math.floor(Math.random() * 400);
  taban = `http://127.0.0.1:${port}/api/v1`;
  sunucu = spawn(process.execPath, [giris], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  sunucu.stdout?.on("data", (parca) => {
    sunucuCiktisi = `${sunucuCiktisi}${String(parca)}`.slice(-8_000);
  });
  sunucu.stderr?.on("data", (parca) => {
    sunucuCiktisi = `${sunucuCiktisi}${String(parca)}`.slice(-8_000);
  });

  worker = spawn(process.execPath, [resolve(__dirname, "../dist/main.worker.js")], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, WORKER_METRICS_PORT: String(workerPort), EBELGE_SCHEDULE_INTERVAL_MS: "3600000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", (parca) => {
    workerCiktisi = `${workerCiktisi}${String(parca)}`.slice(-8_000);
  });
  worker.stderr?.on("data", (parca) => {
    workerCiktisi = `${workerCiktisi}${String(parca)}`.slice(-8_000);
  });

  const sonlanma = new Date(Date.now() + 60_000);
  for (;;) {
    if (sunucu.exitCode !== null) {
      throw new Error(
        `API süreci ${sunucu.exitCode} koduyla kapandı${sunucuCiktisi ? `\n${sunucuCiktisi}` : ""}`,
      );
    }
    try {
      const yanit = await fetch(`http://127.0.0.1:${port}/health`);
      if (yanit.ok) break;
    } catch {
      /* henüz dinlemiyor */
    }
    if (Date.now() > sonlanma.getTime()) {
      throw new Error(`API 60 sn içinde ayağa kalkmadı${sunucuCiktisi ? `\n${sunucuCiktisi}` : ""}`);
    }
    await new Promise((c) => setTimeout(c, 300));
  }

  const workerSonlanma = Date.now() + 60_000;
  for (;;) {
    if (worker.exitCode !== null) throw new Error(`Worker süreci ${worker.exitCode} koduyla kapandı\n${workerCiktisi}`);
    try {
      const yanit = await fetch(`http://127.0.0.1:${workerPort}/health`);
      if (yanit.ok) break;
    } catch {
      /* henüz dinlemiyor */
    }
    if (Date.now() > workerSonlanma) throw new Error(`Worker 60 sn içinde ayağa kalkmadı\n${workerCiktisi}`);
    await new Promise((c) => setTimeout(c, 300));
  }
});

describe("R0 operasyon — liveness ve readiness", () => {
  it("kimlik doğrulamasız readiness rotasında zorunlu bağımlılıkları doğrular", async () => {
    const yanit = await fetch(taban.replace(/\/api\/v1$/, "/health/ready"));
    const veri = await yanit.json() as {
      durum: string;
      bagimliliklar: Record<string, string>;
    };
    expect(yanit.status, JSON.stringify(veri)).toBe(200);
    expect(veri.durum).toBe("ready");
    expect(veri.bagimliliklar).toEqual(expect.objectContaining({
      veritabani: "ok",
      redis: "ok",
      depo: "ok",
    }));
  });
});

describe("R1 düzeltme merkezi — tenant bağlamlı tarama ve listeleme", () => {
  it("yeni tenant için taramayı çalıştırır ve sayfalı iş kuyruğunu döndürür", async () => {
    const { jeton } = await firmaAc("r1-duzeltme", vknUret(true));
    const tarama = await istek<{ bulunan: number; otomatikCozulen: number }>("/duzeltmeler/tara", { method: "POST", jeton, body: {} });
    expect(tarama.durum, JSON.stringify(tarama.veri)).toBe(201);
    expect(tarama.veri.bulunan).toBeGreaterThanOrEqual(0);

    const liste = await istek<{ kayitlar: unknown[]; toplam: number; sayfa: number }>("/duzeltmeler?durum=acik", { jeton });
    expect(liste.durum, JSON.stringify(liste.veri)).toBe(200);
    expect(liste.veri).toMatchObject({ sayfa: 1 });
    expect(Array.isArray(liste.veri.kayitlar)).toBe(true);
  });
});

describe("R0 kritik regresyon — tekrarlayan fatura idempotansı", () => {
  it("iki eşzamanlı tetiklemede aynı dönem için yalnızca bir taslak üretir", async () => {
    const { jeton } = await firmaAc("r0-tekrarlayan", vknUret(true));
    const stokId = await stokAc(jeton, "TEKRAR-1");
    const cariId = await cariAc(jeton, "TEKRAR-CARI", vknUret(true));
    const sablon = await istek<{ id: string }>("/fatura", {
      method: "POST",
      jeton,
      body: {
        tip: "satis",
        tarih: bugun(),
        cariId,
        satirlar: [{ stokId, miktar: "1", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
      },
    });
    expect(sablon.durum, JSON.stringify(sablon.veri)).toBe(201);

    const plan = await istek<{ id: string }>("/fatura/tekrarlayanlar", {
      method: "POST",
      jeton,
      body: {
        ad: "Eşzamanlı kabul planı",
        sablonFaturaId: sablon.veri.id,
        siklik: "aylik",
        aralik: 1,
        sonrakiTarih: bugun(),
        bitisTarihi: null,
      },
    });
    expect(plan.durum, JSON.stringify(plan.veri)).toBe(201);

    const [birinci, ikinci] = await Promise.all([
      istek<{ uretilenAdet: number }>("/fatura/tekrarlayanlar/uret", { method: "POST", jeton }),
      istek<{ uretilenAdet: number }>("/fatura/tekrarlayanlar/uret", { method: "POST", jeton }),
    ]);
    expect(birinci.durum, JSON.stringify(birinci.veri)).toBe(201);
    expect(ikinci.durum, JSON.stringify(ikinci.veri)).toBe(201);
    expect(birinci.veri.uretilenAdet + ikinci.veri.uretilenAdet).toBe(1);

    const planlar = await istek<Array<{ id: string; _count: { uretilenler: number } }>>("/fatura/tekrarlayanlar", { jeton });
    expect(planlar.veri.find((kayit) => kayit.id === plan.veri.id)?._count.uretilenler).toBe(1);
  });
});

afterAll(() => {
  sunucu?.kill("SIGTERM");
  worker?.kill("SIGTERM");
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
      tarih: bugun(),
      cariId,
      satirlar: [
        { stokId, miktar: "10", birim: "adet", birimFiyat: "100", kdvOrani: "20" },
      ],
    });

    expect(await stokMiktari(jeton, stokId)).toBe(90);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(1200, 2);

    // EBLG-02: mükellefiyet sorgulanır, e-Fatura'ya yönlendirilir
    const gonder = await istek<{ isId: string }>(`/ebelge/gonder/${fatura.id}`, {
      method: "POST",
      jeton,
    });
    expect(gonder.durum, JSON.stringify(gonder.veri)).toBe(201);
    await kuyrukIsiniBekle(jeton, gonder.veri.isId);
    const gonderilen = await istek<{ ebelge: { tur: string; durum: string } }>(`/fatura/${fatura.id}`, { jeton });
    expect(gonderilen.veri.ebelge.tur).toBe("efatura");

    // EBLG-04: durum sorgulandıkça kuyrukta → iletildi → kabul ilerler
    let sonDurum = "kuyrukta";
    for (let deneme = 0; deneme < 3 && sonDurum !== "iletildi" && sonDurum !== "kabul"; deneme++) {
      const sorguIsi = await istek<{ isId: string }>(`/ebelge/sorgula/${fatura.id}`, {
        method: "POST",
        jeton,
      });
      await kuyrukIsiniBekle(jeton, sorguIsi.veri.isId);
      const sorgulanan = await istek<{ ebelge: { durum: string } }>(`/fatura/${fatura.id}`, { jeton });
      sonDurum = sorgulanan.veri.ebelge.durum;
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
      tarih: bugun(),
      cariId,
      satirlar: [{ stokId, miktar: "1", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });

    const gonder = await istek<{ isId: string }>(`/ebelge/gonder/${fatura.id}`, {
      method: "POST",
      jeton,
    });
    expect(gonder.durum, JSON.stringify(gonder.veri)).toBe(201);
    await kuyrukIsiniBekle(jeton, gonder.veri.isId);
    const gonderilen = await istek<{ ebelge: { tur: string } }>(`/fatura/${fatura.id}`, { jeton });
    expect(gonderilen.veri.ebelge.tur).toBe("earsiv");
  });
});

describe("Kabul Ölçütü 2 — gelen e-Fatura alış faturasına işlenir", () => {
  it("entegratörden çekilen belge taslak alış faturası olur; tamamlanınca stok artar ve ödeme bakiyeyi kapatır", async () => {
    const { jeton } = await firmaAc("s2", vknUret(true));
    await entegratorBagla(jeton);
    const stokId = await stokAc(jeton, "KBL-2");

    // Paket 6b (EBLG-05): çekilen belgeler doğrudan fatura üretmez, önce
    // gelen kutusuna düşer; fatura yalnız kullanıcı onayıyla oluşur.
    const cek = await istek<{ isId: string }>(
      "/ebelge/gelenleri-cek",
      { method: "POST", jeton },
    );
    expect(cek.durum, JSON.stringify(cek.veri)).toBe(201);
    await kuyrukIsiniBekle(jeton, cek.veri.isId);

    // Aynı belge ikinci çekimde yinelenmez (EBLG-05)
    const tekrar = await istek<{ isId: string }>("/ebelge/gelenleri-cek", {
      method: "POST",
      jeton,
    });
    await kuyrukIsiniBekle(jeton, tekrar.veri.isId);

    const kutu = await istek<Array<{ id: string; durum: string; belgeNo: string; satirSayisi: number }>>(
      "/ebelge/gelen",
      { jeton },
    );
    expect(kutu.durum, JSON.stringify(kutu.veri)).toBe(200);
    // Mock entegratör biri TİCARİ biri TEMEL iki belge döner; tekrarlı çekim çoğaltmaz.
    expect(kutu.veri).toHaveLength(2);
    const gelen = kutu.veri.find((k) => k.belgeNo === "MCK2026000000001")!;
    expect(gelen.durum).toBe("beklemede");

    // Onay ekranı satırları stok kartıyla eşleştirmeyi zorunlu kılar
    const detay = await istek<{ satirlar: Array<{ siraNo: number }> }>(`/ebelge/gelen/${gelen.id}`, {
      jeton,
    });
    expect(detay.durum, JSON.stringify(detay.veri)).toBe(200);

    const onay = await istek<{ faturaId: string }>(`/ebelge/gelen/${gelen.id}/onayla`, {
      method: "POST",
      jeton,
      body: {
        yeniCariOnay: true,
        satirEslesmeleri: detay.veri.satirlar.map((s) => ({ siraNo: s.siraNo, stokId })),
      },
    });
    expect(onay.durum, JSON.stringify(onay.veri)).toBe(201);

    const faturaId = onay.veri.faturaId;
    const taslak = await istek<{ tip: string; durum: string; cariId: string; no: string | null }>(
      `/fatura/${faturaId}`,
      { jeton },
    );
    expect(taslak.veri.tip).toBe("alis");
    expect(taslak.veri.durum).toBe("taslak");

    const oncekiMiktar = await stokMiktari(jeton, stokId);

    // Alış faturasında belge numarası tedarikçinin belgesinden gelir
    const kesin = await istek(`/fatura/${faturaId}/kesinlestir`, {
      method: "POST",
      jeton,
      body: { no: gelen.belgeNo },
    });
    expect(kesin.durum, JSON.stringify(kesin.veri)).toBe(201);
    expect(await stokMiktari(jeton, stokId)).toBeGreaterThan(oncekiMiktar);

    // Tedarikçiye ödeme (tediye) → bakiye kapanır
    const cariId = taslak.veri.cariId;
    const borc = -(await cariBakiyesi(jeton, cariId));
    expect(borc).toBeGreaterThan(0);

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
        tutar: borc.toFixed(2),
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

describe("R0 kritik regresyon — kesin fatura iptali ters kayıt üretir", () => {
  it("e-belgesiz alış faturasını stok ve cari ters hareketleriyle iptal eder", async () => {
    const { jeton } = await firmaAc("r0-fatura-iptal", vknUret(true));
    const stokId = await stokAc(jeton, "IPT-1");
    const cariId = await cariAc(jeton, "TED-IPT", vknUret(true), "tedarikci");

    const olustur = await istek<{ id: string }>("/fatura", {
      method: "POST",
      jeton,
      body: {
        tip: "alis",
        tarih: "2026-03-10",
        cariId,
        satirlar: [{ stokId, miktar: "5", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
      },
    });
    expect(olustur.durum, JSON.stringify(olustur.veri)).toBe(201);
    const kesin = await istek<{ durum: string }>(`/fatura/${olustur.veri.id}/kesinlestir`, {
      method: "POST",
      jeton,
      body: { no: "ALIS-IPT-001" },
    });
    expect(kesin.durum, JSON.stringify(kesin.veri)).toBe(201);
    expect(await stokMiktari(jeton, stokId)).toBe(5);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(-600, 2);

    const iptal = await istek<{ durum: string }>(`/fatura/${olustur.veri.id}/iptal`, {
      method: "POST",
      jeton,
    });
    expect(iptal.durum, JSON.stringify(iptal.veri)).toBe(201);
    expect(iptal.veri.durum).toBe("iptal");
    expect(await stokMiktari(jeton, stokId)).toBe(0);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(0, 2);

    const hareketler = await istek<Array<{ tip: string; kaynakTur: string; kaynakRef: string }>>(
      `/stok/${stokId}/hareketler`,
      { jeton },
    );
    expect(hareketler.veri).toEqual(expect.arrayContaining([
      expect.objectContaining({ tip: "giris", kaynakTur: "fatura", kaynakRef: olustur.veri.id }),
      expect.objectContaining({ tip: "cikis", kaynakTur: "fatura_iptal", kaynakRef: olustur.veri.id }),
    ]));

    const ikinciIptal = await istek(`/fatura/${olustur.veri.id}/iptal`, { method: "POST", jeton });
    expect(ikinciIptal.durum).toBe(400);
    expect(await stokMiktari(jeton, stokId)).toBe(0);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(0, 2);
  });

  it("ödeme bağlı kesin faturanın doğrudan iptalini engeller", async () => {
    const { jeton } = await firmaAc("r0-fatura-odeme-iptal", vknUret(true));
    const stokId = await stokAc(jeton, "IPT-ODEME");
    const cariId = await cariAc(jeton, "TED-ODEME", vknUret(true), "tedarikci");
    const olustur = await istek<{ id: string }>("/fatura", {
      method: "POST",
      jeton,
      body: {
        tip: "alis",
        tarih: "2026-03-11",
        cariId,
        satirlar: [{ stokId, miktar: "2", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
      },
    });
    expect(olustur.durum, JSON.stringify(olustur.veri)).toBe(201);
    const kesin = await istek(`/fatura/${olustur.veri.id}/kesinlestir`, {
      method: "POST",
      jeton,
      body: { no: "ALIS-ODEME-001" },
    });
    expect(kesin.durum, JSON.stringify(kesin.veri)).toBe(201);

    const kasa = await istek<{ id: string }>("/kasa-banka/kasalar", {
      method: "POST",
      jeton,
      body: { ad: "Fatura İptal Kasası", dovizCinsi: "TRY" },
    });
    expect(kasa.durum, JSON.stringify(kasa.veri)).toBe(201);
    const odeme = await istek("/kasa-banka/hareketler", {
      method: "POST",
      jeton,
      body: {
        kasaId: kasa.veri.id,
        tip: "tediye",
        tutar: "240",
        tarih: "2026-03-12",
        cariId,
        faturaId: olustur.veri.id,
        aciklama: "Bağlı alış faturası ödemesi",
      },
    });
    expect(odeme.durum, JSON.stringify(odeme.veri)).toBe(201);

    const iptal = await istek<{ message: string }>(`/fatura/${olustur.veri.id}/iptal`, {
      method: "POST",
      jeton,
    });
    expect(iptal.durum).toBe(400);
    expect(iptal.veri.message).toContain("önce finans hareketini geri alın veya iade faturası düzenleyin");
    expect(await stokMiktari(jeton, stokId)).toBe(2);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(0, 2);
  });
});

describe("R0 kritik regresyon — masraf kısmi ve taksitli kart ödemesi", () => {
  it("onaylanan masraf önce kasadan kısmen, sonra kartla taksitli ödenerek kapanır", async () => {
    const { jeton } = await firmaAc("r0-masraf", vknUret(true));

    const kategori = await istek<{ id: string }>("/masraflar/kategoriler", {
      method: "POST",
      jeton,
      body: { ad: `Kabul Gideri ${Date.now()}`, varsayilanKdvOrani: 20 },
    });
    expect(kategori.durum, JSON.stringify(kategori.veri)).toBe(201);

    const kasa = await istek<{ id: string }>("/kasa-banka/kasalar", {
      method: "POST",
      jeton,
      body: { ad: "Masraf Kasası", dovizCinsi: "TRY" },
    });
    expect(kasa.durum, JSON.stringify(kasa.veri)).toBe(201);

    const kart = await istek<{ id: string }>("/kasa-banka/kredi-kartlari", {
      method: "POST",
      jeton,
      body: {
        ad: "Masraf Kartı",
        bankaAdi: "Kabul Bankası",
        sonDortHane: "4242",
        limit: "10000",
        dovizCinsi: "TRY",
        hesapKesimGunu: 20,
        sonOdemeGunu: 30,
      },
    });
    expect(kart.durum, JSON.stringify(kart.veri)).toBe(201);

    const masraf = await istek<{ id: string; durum: string; odemeDurumu: string }>("/masraflar", {
      method: "POST",
      jeton,
      body: {
        kategoriId: kategori.veri.id,
        belgeTuru: "fatura",
        belgeNo: `KBL-M-${Date.now()}`,
        tarih: "2026-07-01",
        saticiUnvan: "Kabul Tedarikçisi",
        aciklama: "R0 kısmi ve taksitli ödeme senaryosu",
        matrah: 833.33,
        kdvOrani: 20,
        kdvTutari: 166.67,
        toplam: 1000,
        dovizCinsi: "TRY",
      },
    });
    expect(masraf.durum, JSON.stringify(masraf.veri)).toBe(201);
    expect(masraf.veri.durum).toBe("taslak");

    const onay = await istek<{ durum: string }>(`/masraflar/${masraf.veri.id}/onayla`, {
      method: "POST",
      jeton,
    });
    expect(onay.durum, JSON.stringify(onay.veri)).toBe(201);
    expect(onay.veri.durum).toBe("onaylandi");

    const kismi = await istek<{ odemeDurumu: string; odenenTutar: string }>(
      `/masraflar/${masraf.veri.id}/ode`,
      {
        method: "POST",
        jeton,
        body: { kasaId: kasa.veri.id, odemeTarihi: "2026-07-02", tutar: 300 },
      },
    );
    expect(kismi.durum, JSON.stringify(kismi.veri)).toBe(201);
    expect(kismi.veri.odemeDurumu).toBe("kismi_odendi");
    expect(Number(kismi.veri.odenenTutar)).toBe(300);

    const kapanis = await istek<{ odemeDurumu: string; odenenTutar: string }>(
      `/masraflar/${masraf.veri.id}/ode`,
      {
        method: "POST",
        jeton,
        body: {
          krediKartiId: kart.veri.id,
          odemeTarihi: "2026-07-03",
          tutar: 700,
          taksitSayisi: 3,
          ilkTaksitTarihi: "2026-08-01",
          aciklama: "Kalan masraf kart ödemesi",
        },
      },
    );
    expect(kapanis.durum, JSON.stringify(kapanis.veri)).toBe(201);
    expect(kapanis.veri.odemeDurumu).toBe("odendi");
    expect(Number(kapanis.veri.odenenTutar)).toBe(1000);

    const detay = await istek<{
      odemeDurumu: string;
      odemeler: Array<{ tutar: string; kasaId: string | null; krediKartiId: string | null }>;
    }>(`/masraflar/${masraf.veri.id}`, { jeton });
    expect(detay.durum, JSON.stringify(detay.veri)).toBe(200);
    expect(detay.veri.odemeDurumu).toBe("odendi");
    expect(detay.veri.odemeler).toHaveLength(2);
    expect(detay.veri.odemeler.map((o) => Number(o.tutar)).sort((a, b) => a - b)).toEqual([300, 700]);
    expect(detay.veri.odemeler.some((o) => o.kasaId === kasa.veri.id)).toBe(true);
    expect(detay.veri.odemeler.some((o) => o.krediKartiId === kart.veri.id)).toBe(true);

    const kartlar = await istek<Array<{
      id: string;
      borc: string;
      hareketler: Array<{ tutar: string; taksitSayisi: number; taksitler: Array<{ tutar: string }> }>;
    }>>("/kasa-banka/kredi-kartlari", { jeton });
    expect(kartlar.durum, JSON.stringify(kartlar.veri)).toBe(200);
    const kartDetayi = kartlar.veri.find((k) => k.id === kart.veri.id);
    expect(kartDetayi).toBeDefined();
    expect(Number(kartDetayi?.borc)).toBe(700);
    expect(kartDetayi?.hareketler).toHaveLength(1);
    expect(kartDetayi?.hareketler[0].taksitSayisi).toBe(3);
    expect(kartDetayi?.hareketler[0].taksitler).toHaveLength(3);
    expect(kartDetayi?.hareketler[0].taksitler.reduce((t, k) => t + Number(k.tutar), 0)).toBeCloseTo(700, 2);

    const fazlaOdeme = await istek(`/masraflar/${masraf.veri.id}/ode`, {
      method: "POST",
      jeton,
      body: { kasaId: kasa.veri.id, odemeTarihi: "2026-07-04", tutar: 1 },
    });
    expect(fazlaOdeme.durum).toBe(400);
  });
});

describe("R0 kritik regresyon — çek/senet hesap ve cari yönleri", () => {
  it("alınan çek tahsilata, verilen senet tediyeye dönüşür; cari ikinci kez etkilenmez", async () => {
    const { jeton } = await firmaAc("r0-cek-senet", vknUret(true));
    const musteriId = await cariAc(jeton, "R0-CS-M", vknUret(true));
    const tedarikciId = await cariAc(jeton, "R0-CS-T", vknUret(true), "tedarikci");
    const kasa = await istek<{ id: string }>("/kasa-banka/kasalar", {
      method: "POST",
      jeton,
      body: { ad: "Çek Senet Kasası", dovizCinsi: "TRY" },
    });
    expect(kasa.durum, JSON.stringify(kasa.veri)).toBe(201);

    const alinan = await istek<{ id: string; durum: string; yon: string }>("/kasa-banka/cek-senet", {
      method: "POST",
      jeton,
      body: {
        tur: "cek",
        yon: "alinan",
        portfoyNo: `R0-A-${Date.now()}`,
        cekNo: `A-${Date.now()}`,
        islemTarihi: "2026-07-10",
        vadeTarihi: "2026-08-10",
        tutar: "500",
        dovizCinsi: "TRY",
        kur: "1",
        borclu: "Kabul Müşterisi",
        cariId: musteriId,
      },
    });
    expect(alinan.durum, JSON.stringify(alinan.veri)).toBe(201);
    expect(alinan.veri.durum).toBe("portfoyde");
    expect(await cariBakiyesi(jeton, musteriId)).toBeCloseTo(-500, 2);

    const tahsil = await istek<{ durum: string }>(`/kasa-banka/cek-senet/${alinan.veri.id}`, {
      method: "PATCH",
      jeton,
      body: { durum: "tahsil_edildi", hesapKasaId: kasa.veri.id, islemTarihi: "2026-08-10" },
    });
    expect(tahsil.durum, JSON.stringify(tahsil.veri)).toBe(200);
    expect(tahsil.veri.durum).toBe("tahsil_edildi");
    expect(await cariBakiyesi(jeton, musteriId)).toBeCloseTo(-500, 2);

    const verilen = await istek<{ id: string; durum: string; yon: string }>("/kasa-banka/cek-senet", {
      method: "POST",
      jeton,
      body: {
        tur: "senet",
        yon: "verilen",
        portfoyNo: `R0-V-${Date.now()}`,
        islemTarihi: "2026-07-11",
        vadeTarihi: "2026-08-11",
        tutar: "300",
        dovizCinsi: "TRY",
        kur: "1",
        borclu: "Kabul Test Firması",
        cariId: tedarikciId,
      },
    });
    expect(verilen.durum, JSON.stringify(verilen.veri)).toBe(201);
    expect(verilen.veri.durum).toBe("verildi");
    expect(await cariBakiyesi(jeton, tedarikciId)).toBeCloseTo(300, 2);

    const odeme = await istek<{ durum: string }>(`/kasa-banka/cek-senet/${verilen.veri.id}`, {
      method: "PATCH",
      jeton,
      body: { durum: "odendi", hesapKasaId: kasa.veri.id, islemTarihi: "2026-08-11" },
    });
    expect(odeme.durum, JSON.stringify(odeme.veri)).toBe(200);
    expect(odeme.veri.durum).toBe("odendi");
    expect(await cariBakiyesi(jeton, tedarikciId)).toBeCloseTo(300, 2);

    const kasaDetayi = await istek<{ bakiye: string; borc: string; alacak: string }>(
      `/kasa-banka/kasalar/${kasa.veri.id}`,
      { jeton },
    );
    expect(kasaDetayi.durum, JSON.stringify(kasaDetayi.veri)).toBe(200);
    expect(Number(kasaDetayi.veri.borc)).toBe(500);
    expect(Number(kasaDetayi.veri.alacak)).toBe(300);
    expect(Number(kasaDetayi.veri.bakiye)).toBe(200);

    const hareketler = await istek<Array<{ tip: string; kaynakTur: string; kaynakRef: string }>>(
      `/kasa-banka/hareketler?kasaId=${kasa.veri.id}`,
      { jeton },
    );
    expect(hareketler.durum, JSON.stringify(hareketler.veri)).toBe(200);
    expect(hareketler.veri).toEqual(expect.arrayContaining([
      expect.objectContaining({ tip: "tahsilat", kaynakTur: "cek_senet", kaynakRef: alinan.veri.id }),
      expect.objectContaining({ tip: "tediye", kaynakTur: "cek_senet", kaynakRef: verilen.veri.id }),
    ]));
  });
});

describe("R0 kritik regresyon — POS banka mutabakatı ve geri alma", () => {
  it("POS tahsilatını net banka satırıyla eşleştirir ve geri almada üç finans hareketini temizler", async () => {
    const { jeton } = await firmaAc("r0-pos", vknUret(true));
    const cariId = await cariAc(jeton, "R0-POS-M", vknUret(true));

    const banka = await istek<{ id: string }>("/kasa-banka/bankalar", {
      method: "POST",
      jeton,
      body: { ad: "POS Mutabakat Bankası", bankaAdi: "Kabul Bankası", dovizCinsi: "TRY" },
    });
    expect(banka.durum, JSON.stringify(banka.veri)).toBe(201);

    const pos = await istek<{ id: string }>("/kasa-banka/pos-hesaplari", {
      method: "POST",
      jeton,
      body: {
        ad: "Kabul POS",
        saglayici: "paytr",
        varsayilanBankaHesapId: banka.veri.id,
        dovizCinsi: "TRY",
      },
    });
    expect(pos.durum, JSON.stringify(pos.veri)).toBe(201);

    const tahsilat = await istek<{ id: string }>("/kasa-banka/hareketler", {
      method: "POST",
      jeton,
      body: {
        posHesapId: pos.veri.id,
        tip: "tahsilat",
        tutar: "1000",
        dovizCinsi: "TRY",
        tarih: "2026-08-14",
        aciklama: "POS kart tahsilatı",
        cariId,
      },
    });
    expect(tahsilat.durum, JSON.stringify(tahsilat.veri)).toBe(201);
    expect(await cariBakiyesi(jeton, cariId)).toBeCloseTo(-1000, 2);

    const ilkPos = await istek<Array<{ id: string; bakiye: string }>>("/kasa-banka/pos-hesaplari", { jeton });
    expect(Number(ilkPos.veri.find((h) => h.id === pos.veri.id)?.bakiye)).toBe(1000);

    const csv = "Tarih,Açıklama,Tutar\n2026-08-15,PayTR net aktarımı,960.00\n";
    const form = new FormData();
    form.append("dosya", new Blob([csv], { type: "text/csv" }), "pos-mutabakat.csv");
    form.append("veri", JSON.stringify({
      bankaHesapId: banka.veri.id,
      esleme: { baslikSatiri: 0, tarih: 0, aciklama: 1, tutar: 2 },
      eslemeyiKaydet: false,
    }));
    const yuklemeYaniti = await fetch(`${taban}/kasa-banka/ekstre/yukle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}` },
      body: form,
    });
    expect(yuklemeYaniti.status, await yuklemeYaniti.text()).toBe(201);

    const bekleyenler = await istek<Array<{ id: string; tutar: string; durum: string }>>(
      `/kasa-banka/ekstre/satirlar?durum=beklemede&bankaHesapId=${banka.veri.id}`,
      { jeton },
    );
    expect(bekleyenler.durum, JSON.stringify(bekleyenler.veri)).toBe(200);
    const ekstreSatiri = bekleyenler.veri.find((s) => Number(s.tutar) === 960);
    expect(ekstreSatiri).toBeDefined();

    const aktarim = await istek<{
      gidis: { id: string };
      gelis: { id: string };
      komisyonHareketi: { id: string };
      komisyonMasrafi: { id: string };
      netTutar: string;
    }>("/kasa-banka/pos-hesaplari/bankaya-aktar", {
      method: "POST",
      jeton,
      body: {
        posHesapId: pos.veri.id,
        ekstreSatirId: ekstreSatiri!.id,
        brutTutar: "1000",
        komisyonTutar: "40",
        tarih: "2026-08-15",
      },
    });
    expect(aktarim.durum, JSON.stringify(aktarim.veri)).toBe(201);
    expect(Number(aktarim.veri.netTutar)).toBe(960);

    const komisyonMasraflari = await istek<Array<{
      id: string;
      toplam: string;
      kdvOrani: string;
      durum: string;
      odemeDurumu: string;
      hareketId: string | null;
      kategori: { ad: string };
    }>>("/masraflar", { jeton });
    const komisyonMasrafi = komisyonMasraflari.veri.find((masraf) => masraf.id === aktarim.veri.komisyonMasrafi.id);
    expect(komisyonMasrafi).toEqual(expect.objectContaining({
      toplam: "40",
      kdvOrani: "0",
      durum: "onaylandi",
      odemeDurumu: "odendi",
      hareketId: aktarim.veri.komisyonHareketi.id,
      kategori: expect.objectContaining({ ad: "Banka ve POS Komisyonları" }),
    }));

    const mutabikPos = await istek<Array<{ id: string; bakiye: string }>>("/kasa-banka/pos-hesaplari", { jeton });
    expect(Number(mutabikPos.veri.find((h) => h.id === pos.veri.id)?.bakiye)).toBe(0);
    const mutabikBanka = await istek<{ bakiye: string }>(`/kasa-banka/bankalar/${banka.veri.id}`, { jeton });
    expect(Number(mutabikBanka.veri.bakiye)).toBe(960);

    const eslesenler = await istek<Array<{ id: string; durum: string; hareketId: string | null }>>(
      `/kasa-banka/ekstre/satirlar?durum=eslesti&bankaHesapId=${banka.veri.id}`,
      { jeton },
    );
    const eslesen = eslesenler.veri.find((s) => s.id === ekstreSatiri!.id);
    expect(eslesen?.hareketId).toBe(aktarim.veri.gelis.id);

    const geriAl = await istek<{ durum: string; hareketId: string | null }>(
      `/kasa-banka/ekstre/satirlar/${ekstreSatiri!.id}/geri-al`,
      { method: "POST", jeton },
    );
    expect(geriAl.durum, JSON.stringify(geriAl.veri)).toBe(201);
    expect(geriAl.veri.durum).toBe("beklemede");
    expect(geriAl.veri.hareketId).toBeNull();

    const geriPos = await istek<Array<{ id: string; bakiye: string }>>("/kasa-banka/pos-hesaplari", { jeton });
    expect(Number(geriPos.veri.find((h) => h.id === pos.veri.id)?.bakiye)).toBe(1000);
    const geriBanka = await istek<{ bakiye: string }>(`/kasa-banka/bankalar/${banka.veri.id}`, { jeton });
    expect(Number(geriBanka.veri.bakiye)).toBe(0);

    const posHareketleri = await istek<Array<{ id: string; kaynakTur: string | null }>>(
      `/kasa-banka/hareketler?posHesapId=${pos.veri.id}`,
      { jeton },
    );
    expect(posHareketleri.veri).toHaveLength(1);
    expect(posHareketleri.veri[0].id).toBe(tahsilat.veri.id);

    const geriAlinanMasraflar = await istek<Array<{ id: string }>>("/masraflar", { jeton });
    expect(geriAlinanMasraflar.veri.some((masraf) => masraf.id === aktarim.veri.komisyonMasrafi.id)).toBe(false);
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

    type DenetimKaydi = { islem: string; varlik: string; varlikId: string | null; kullanici: { eposta: string } | null };
    let iz: Yanit<{ kayitlar: DenetimKaydi[] }> | null = null;
    let kesme: DenetimKaydi | undefined;
    for (let deneme = 0; deneme < 5 && !kesme; deneme++) {
      iz = await istek<{ kayitlar: DenetimKaydi[] }>("/denetim?adet=200", { jeton });
      expect(iz.durum, JSON.stringify(iz.veri)).toBe(200);
      kesme = iz.veri.kayitlar.find(
        (k) => k.varlik === "fatura" && k.islem.includes("kesinlestir") && k.varlikId === fatura.id,
      );
      if (!kesme) await new Promise((c) => setTimeout(c, 100));
    }

    // KLN-04: fatura kesme izde, kim yaptığıyla birlikte
    expect(kesme, "fatura kesinleştirme denetim izinde yok").toBeDefined();
    expect(kesme?.kullanici?.eposta).toContain("kabul-s5b");

    // Cari ve stok oluşturma da ize düşer
    expect(iz?.veri.kayitlar.some((k) => k.varlik === "cari")).toBe(true);
    expect(iz?.veri.kayitlar.some((k) => k.varlik === "stok")).toBe(true);

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
      tarih: bugun(),
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

describe("STK-07 — çoklu depo: bakiyeler depo bazında ayrışır", () => {
  it("kayıtla açılan varsayılan depo, transfer, depodan fatura ve depo bazlı eksi stok kontrolü", async () => {
    const firma = await firmaAc("s7", vknUret(true));
    const jeton = firma.jeton;

    // Yeni firmada tek depo vardır: varsayılan Merkez Depo
    const ilkListe = await istek<Array<{ id: string; kod: string; varsayilan: boolean }>>("/depo", { jeton });
    expect(ilkListe.durum, JSON.stringify(ilkListe.veri)).toBe(200);
    expect(ilkListe.veri).toHaveLength(1);
    const merkez = ilkListe.veri[0];
    expect(merkez.varsayilan).toBe(true);

    // İkinci depo
    const subeYanit = await istek<{ id: string }>("/depo", {
      method: "POST",
      jeton,
      body: { kod: "SUBE", ad: "Şube Deposu" },
    });
    expect(subeYanit.durum, JSON.stringify(subeYanit.veri)).toBe(201);
    const sube = subeYanit.veri.id;

    // Depo verilmeyen giriş varsayılan depoya yazılır
    const stokId = await stokAc(jeton, "KBL-7A");
    await stokGirisi(jeton, stokId, "100");

    const kirilim1 = await istek<Array<{ depoId: string; mevcutMiktar: string }>>(
      `/stok/${stokId}/depo-bakiyeleri`,
      { jeton },
    );
    expect(kirilim1.durum).toBe(200);
    expect(kirilim1.veri).toHaveLength(1);
    expect(Number(kirilim1.veri[0].mevcutMiktar)).toBe(100);
    expect(kirilim1.veri[0].depoId).toBe(merkez.id);

    // Transfer fişi: 30 adet şubeye
    const transfer = await istek<{ id: string; no: string; durum: string }>("/depo/transferler", {
      method: "POST",
      jeton,
      body: {
        tarih: "2026-06-01",
        kaynakDepoId: merkez.id,
        hedefDepoId: sube,
        kalemler: [{ stokId, girilenBirim: "adet", girilenMiktar: "30" }],
      },
    });
    expect(transfer.durum, JSON.stringify(transfer.veri)).toBe(201);
    expect(transfer.veri.durum).toBe("taslak");

    // Taslak fiş stoğa dokunmaz
    expect(await stokMiktari(jeton, stokId)).toBe(100);
    expect((await istek<unknown[]>(`/stok/${stokId}/depo-bakiyeleri`, { jeton })).veri).toHaveLength(1);

    const onay = await istek(`/depo/transferler/${transfer.veri.id}/onayla`, {
      method: "POST",
      jeton,
    });
    expect(onay.durum, JSON.stringify(onay.veri)).toBe(201);

    // Firma toplamı değişmez, depo kırılımı ayrışır
    expect(await stokMiktari(jeton, stokId)).toBe(100);
    const kirilim2 = await istek<Array<{ depoId: string; mevcutMiktar: string }>>(
      `/stok/${stokId}/depo-bakiyeleri`,
      { jeton },
    );
    const bakiye = (depoId: string) =>
      Number(kirilim2.veri.find((k) => k.depoId === depoId)?.mevcutMiktar ?? 0);
    expect(bakiye(merkez.id)).toBe(70);
    expect(bakiye(sube)).toBe(30);

    // Şube deposundan kesilen fatura yalnız şubenin stoğunu düşürür
    const cariId = await cariAc(jeton, "MUS-7", vknUret(true));
    await faturaKes(jeton, {
      tip: "satis",
      tarih: "2026-06-02",
      cariId,
      depoId: sube,
      satirlar: [{ stokId, miktar: "5", birim: "adet", birimFiyat: "100", kdvOrani: "20" }],
    });
    const kirilim3 = await istek<Array<{ depoId: string; mevcutMiktar: string }>>(
      `/stok/${stokId}/depo-bakiyeleri`,
      { jeton },
    );
    const bakiye3 = (depoId: string) =>
      Number(kirilim3.veri.find((k) => k.depoId === depoId)?.mevcutMiktar ?? 0);
    expect(bakiye3(merkez.id)).toBe(70);
    expect(bakiye3(sube)).toBe(25);
    expect(await stokMiktari(jeton, stokId)).toBe(95);

    // Eksi stok kontrolü depo bazındadır: şubede 25 varken 40 çıkış uyarı üretir
    // (varsayılan politika "uyar"; firma genelinde 95 adet olsa da ölçüt depodur)
    const fazlaCikis = await istek<{ eksiStokUyarisi: string | null }>(
      `/stok/${stokId}/hareketler`,
      {
        method: "POST",
        jeton,
        body: {
          stokId,
          depoId: sube,
          tip: "cikis",
          miktar: "40",
          girilenBirim: "adet",
          girilenMiktar: "40",
          maliyet: "0",
          tarih: "2026-06-03",
        },
      },
    );
    expect(fazlaCikis.durum, JSON.stringify(fazlaCikis.veri)).toBe(201);
    expect(fazlaCikis.veri.eksiStokUyarisi).toContain("Şube Deposu");

    // Hareket görmüş depo silinemez; varsayılan depo hiç silinemez
    expect((await istek(`/depo/${sube}`, { method: "DELETE", jeton })).durum).toBe(400);
    expect((await istek(`/depo/${merkez.id}`, { method: "DELETE", jeton })).durum).toBe(400);
  });
});
