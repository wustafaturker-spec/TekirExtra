import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gomuluXsltCikar } from "../src/ebelge/ubl-gorunum";
import { faturaKarekodVerisi } from "../src/ebelge/ubl-oku";
import { faturaUblUret } from "../src/ebelge/xml-uretec";

/**
 * EBLG-32: gömülü XSLT'nin alıcının görüntüleyicisinde ürettiği karekod verisi,
 * bizim PDF'imize basılan sunucu verisiyle birebir aynı olmalıdır. XSLT'yi
 * gerçekten çalıştırmak tarayıcı gerektirdiği için kabul testidir: belge
 * Chromium'un XSLTProcessor'ıyla dönüştürülür ve betikleri açık bir sayfada
 * açılır — alıcının portalındaki gibi.
 */

const SATIR = { iskontoTutari: 0, gibIstisnaKodu: null, miktar: 1, stok: { kod: "STK-1", ad: "Ürün" } };

const FATURA = {
  id: "11111111-1111-4111-8111-111111111111",
  no: "TKR2026000000001",
  tarih: new Date("2026-08-12T12:00:00Z"),
  tip: "satis",
  dovizCinsi: "TRY",
  toplamKdv: 20,
  toplamMatrah: 100,
  toplamBrut: 100,
  genelToplam: 120,
  toplamSatirIskontosu: 0,
  cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
  satirlar: [{ ...SATIR, matrah: 100, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100 }],
};

const ubl = (fatura: object, tur?: "efatura" | "earsiv") =>
  faturaUblUret(fatura as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, tur ? { tur } : undefined);

let tarayici: Browser;

beforeAll(async () => {
  tarayici = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

afterAll(async () => {
  await tarayici?.close();
});

/** Belgeyi kendi XSLT'siyle açar; karekod verisini ve çizilen karekodu okur. */
async function goruntule(xml: string) {
  const sayfa = await (await tarayici.newContext({ offline: true })).newPage();
  try {
    await sayfa.route("**", (yol) => void yol.abort());
    const hatalar: string[] = [];
    sayfa.on("pageerror", (hata) => hatalar.push(hata.message));
    await sayfa.setContent("<!doctype html><html><body></body></html>");
    // HTML serileştirmesi: XMLSerializer betik metnindeki "<" işaretlerini kaçırır
    // ve sayfa yeniden açılınca betik bozulur; görüntüleyiciler DOM'u doğrudan gösterir.
    const html = await sayfa.evaluate(([kaynak, bicem]) => {
      const w = globalThis as unknown as {
        DOMParser: new () => { parseFromString(m: string, t: string): unknown };
        XSLTProcessor: new () => {
          importStylesheet(b: unknown): void;
          transformToDocument(k: unknown): { documentElement: { outerHTML: string } };
        };
      };
      const ayristirici = new w.DOMParser();
      const islemci = new w.XSLTProcessor();
      islemci.importStylesheet(ayristirici.parseFromString(bicem, "application/xml"));
      return "<!doctype html>" + islemci.transformToDocument(ayristirici.parseFromString(kaynak, "application/xml")).documentElement.outerHTML;
    }, [xml, gomuluXsltCikar(xml)!] as const);
    await sayfa.setContent(html);
    expect(hatalar, "görünüm betiği hata vermemeli").toEqual([]);
    return {
      veri: await sayfa.evaluate(() => (globalThis as unknown as { document: { getElementById(id: string): { textContent: string } | null } }).document.getElementById("gib-karekod-veri")?.textContent ?? null),
      karekodCizildi: (await sayfa.locator("#gib-karekod svg rect, #gib-karekod svg path").count()) > 0,
    };
  } finally {
    await sayfa.context().close();
  }
}

describe("gömülü XSLT karekodu (EBLG-32)", () => {
  it("tek oranlı e-Faturada sunucuyla aynı JSON'u üretir ve karekodu çizer", async () => {
    const xml = ubl(FATURA);
    const { veri, karekodCizildi } = await goruntule(xml);
    expect(veri).toBe(JSON.stringify(faturaKarekodVerisi(xml)));
    expect(karekodCizildi).toBe(true);
  });

  it("çok oranlı, istisnalı ve küsuratlı oranlı e-Arşivde KDV kırılımı sunucuyla aynıdır", async () => {
    const fatura = {
      ...FATURA,
      toplamKdv: 25.3, toplamMatrah: 180, toplamBrut: 180, genelToplam: 205.3,
      cari: { vknTckn: "10000000078", unvan: "Ada Yılmaz", ad: "Ada", soyad: "Yılmaz" },
      satirlar: [
        { ...SATIR, matrah: 100, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100 },
        { ...SATIR, matrah: 30, kdvTutari: 3, kdvOrani: 10, birimFiyat: 30 },
        { ...SATIR, matrah: 20, kdvTutari: 2, kdvOrani: 10, birimFiyat: 20 },
        { ...SATIR, matrah: 20, kdvTutari: 0.3, kdvOrani: 1.5, birimFiyat: 20 },
        { ...SATIR, matrah: 10, kdvTutari: 0, kdvOrani: 0, birimFiyat: 10, gibIstisnaKodu: "351" },
      ],
    };
    const xml = ubl(fatura, "earsiv");
    const sunucu = faturaKarekodVerisi(xml)!;
    const { veri, karekodCizildi } = await goruntule(xml);
    expect(veri).toBe(JSON.stringify(sunucu));
    expect(Object.keys(sunucu).filter((k) => k.startsWith("kdvmatrah"))).toEqual([
      "kdvmatrah(0)", "kdvmatrah(1.5)", "kdvmatrah(10)", "kdvmatrah(20)",
    ]);
    expect(karekodCizildi).toBe(true);
  });

  it("sağlayıcı numarayı henüz atamamışsa karekod verisi de karekod da yoktur", async () => {
    const { veri, karekodCizildi } = await goruntule(ubl({ ...FATURA, no: "SNC" }, "earsiv"));
    expect(veri).toBeNull();
    expect(karekodCizildi).toBe(false);
  });
});
