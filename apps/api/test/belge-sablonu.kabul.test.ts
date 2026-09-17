import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELGE_SABLONLARI, type BelgeSablonu } from "../src/core/pdf/belge-temasi";
import { gomuluXsltCikar } from "../src/ebelge/ubl-gorunum";
import { faturaUblUret } from "../src/ebelge/xml-uretec";

/**
 * FTR-22/25: kiracının seçtiği şablon UBL'e gömülü görünüme de işler. Şablon
 * yalnız görünüşü değiştirir — belgenin zorunlu alanları (numara, ETTN,
 * taraflar, toplamlar, karekod) her şablonda yerinde kalmalıdır. Tasarım
 * değişikliği bunları düşürürse alıcı eksik belge görür, bu yüzden her şablon
 * gerçekten dönüştürülüp sınanır.
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

/** 1×1 saydam PNG; logo gerçekten gömülüyor mu diye. */
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const ubl = (sablon: BelgeSablonu, vurguRengi = "#0f766e", logoDataUri?: string) =>
  faturaUblUret(FATURA as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, {
    tema: { sablon, vurguRengi, logoDataUri },
  });

let tarayici: Browser;

beforeAll(async () => {
  tarayici = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

afterAll(async () => {
  await tarayici?.close();
});

/** Belgeyi kendi XSLT'siyle, alıcının portalındaki gibi çevrimdışı açar. */
async function goruntule(xml: string) {
  const sayfa = await (await tarayici.newContext({ offline: true })).newPage();
  try {
    await sayfa.route("**", (yol) => void yol.abort());
    const hatalar: string[] = [];
    sayfa.on("pageerror", (hata) => hatalar.push(hata.message));
    await sayfa.setContent("<!doctype html><html><body></body></html>");
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
      metin: await sayfa.locator("body").innerText(),
      sinif: await sayfa.locator("body").getAttribute("class"),
      logoSayisi: await sayfa.locator("img.logo").count(),
      karekodCizildi: (await sayfa.locator("#gib-karekod svg rect, #gib-karekod svg path").count()) > 0,
      serit: await sayfa.locator(".ust-serit").evaluate((o) => {
        const s = getComputedStyle(o as Element);
        return { arka: s.backgroundColor, altCizgi: s.borderBottomColor };
      }),
    };
  } finally {
    await sayfa.context().close();
  }
}

describe("belge şablonları gömülü görünümde (FTR-22/25)", () => {
  for (const sablon of BELGE_SABLONLARI) {
    it(`${sablon} şablonunda zorunlu alanlar ve karekod yerinde kalır`, async () => {
      const { metin, sinif, karekodCizildi } = await goruntule(ubl(sablon));
      expect(sinif).toBe(`sablon-${sablon}`);
      expect(metin).toContain("TKR2026000000001");
      expect(metin).toContain("Satıcı A.Ş.");
      expect(metin).toContain("Alıcı A.Ş.");
      expect(metin).toContain("9876543210");
      expect(metin).toContain("1234567890");
      expect(metin).toContain("120,00");
      expect(metin).toContain(FATURA.id);
      expect(karekodCizildi).toBe(true);
    });
  }

  it("vurgu rengi alıcının gördüğü belgeye işler", async () => {
    const standart = await goruntule(ubl("standart", "#0f766e"));
    expect(standart.serit.arka).toBe("rgb(15, 118, 110)");
    const modern = await goruntule(ubl("modern", "#b91c1c"));
    expect(modern.serit.altCizgi).toBe("rgb(185, 28, 28)");
  });

  it("logo gömülür, sınırı aşan logo belgeyi şişirmez", async () => {
    expect((await goruntule(ubl("modern", "#0f766e", LOGO))).logoSayisi).toBe(1);
    const buyukLogo = `data:image/png;base64,${"A".repeat(60 * 1024)}`;
    const { logoSayisi, metin } = await goruntule(ubl("modern", "#0f766e", buyukLogo));
    expect(logoSayisi).toBe(0);
    expect(metin).toContain("TekirExtra");
  });
});
