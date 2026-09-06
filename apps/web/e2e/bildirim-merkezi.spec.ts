import { expect, test, type Page } from "@playwright/test";

/**
 * Bildirim merkezinin iki iddiasını doğrular:
 *
 *  1. Zil menüsü tarayıcıda özet birleştirmez; sunucudaki kalıcı teslimat
 *     kayıtlarını gösterir ve okundu işaretlemesi sunucuya yazılır.
 *  2. Bildirim ekranı sahiplenmeyi ayrı izler: "okundu" ile "aksiyon alındı"
 *     aynı şey değildir.
 */

interface SahteTeslimat {
  id: string;
  durum: string;
  aksiyonNotu: string | null;
  createdAt: string;
  bildirim: {
    id: string;
    tur: string;
    onem: string;
    baslik: string;
    aciklama: string;
    hedefYol: string | null;
    sonTarih: string | null;
    yukseltildiAt: string | null;
    kapandiAt: string | null;
    createdAt: string;
  };
  kullanici: { id: string; adSoyad: string };
}

function teslimat(ek: Partial<SahteTeslimat> & { id: string; baslik: string; onem?: string; durum?: string }): SahteTeslimat {
  return {
    id: ek.id,
    durum: ek.durum ?? "yeni",
    aksiyonNotu: null,
    createdAt: "2026-09-05T08:00:00.000Z",
    bildirim: {
      id: `b-${ek.id}`,
      tur: "ebelge",
      onem: ek.onem ?? "kritik",
      baslik: ek.baslik,
      aciklama: "SF2026000123 · Tedarik Malzeme AŞ — Entegratör belgeyi reddetti.",
      hedefYol: "/panel/fatura?ebelge=hata",
      sonTarih: "2026-09-06T08:00:00.000Z",
      yukseltildiAt: null,
      kapandiAt: null,
      createdAt: "2026-09-05T08:00:00.000Z",
      ...ek.bildirim,
    },
    kullanici: { id: "u1", adSoyad: "Ayşe Yılmaz" },
  };
}

/** Sunucu davranışını taklit eden sahte uç: durum değişiklikleri kalıcıdır. */
async function apiMockla(page: Page, baslangic: SahteTeslimat[]) {
  const kayitlar = new Map(baslangic.map((k) => [k.id, structuredClone(k)]));
  const cagrilar: string[] = [];

  await page.addInitScript(() => {
    sessionStorage.setItem("tekir_access", "e2e-token");
  });
  await page.route("http://localhost:3001/api/v1/**", async (route) => {
    const istek = route.request();
    const { pathname, searchParams } = new URL(istek.url());

    if (pathname.endsWith("/auth/ben")) return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (pathname.endsWith("/firma")) return route.fulfill({ json: { unvan: "Deneme Ticaret A.Ş." } });

    if (pathname.endsWith("/bildirimler/ozet")) {
      const acik = [...kayitlar.values()].filter((k) => ["yeni", "okundu", "ustlenildi"].includes(k.durum));
      return route.fulfill({
        json: {
          okunmamis: acik.filter((k) => k.durum === "yeni").length,
          acik: acik.length,
          ustlenilen: acik.filter((k) => k.durum === "ustlenildi").length,
          aksiyonAlinan: [...kayitlar.values()].filter((k) => k.durum === "aksiyon_alindi").length,
          kritik: acik.filter((k) => k.bildirim.onem === "kritik").length,
        },
      });
    }
    if (pathname.endsWith("/bildirimler/tumunu-okundu")) {
      cagrilar.push("tumunu-okundu");
      for (const kayit of kayitlar.values()) if (kayit.durum === "yeni") kayit.durum = "okundu";
      return route.fulfill({ json: { guncellenen: 1 } });
    }
    if (pathname.endsWith("/bildirimler/tercihler")) {
      return route.fulfill({ json: { tercihler: [], sessizBaslangic: null, sessizBitis: null } });
    }
    const eylem = pathname.match(/\/bildirimler\/([^/]+)\/(ustlen|aksiyon|yoksay)$/);
    if (eylem) {
      const kayit = kayitlar.get(eylem[1]);
      if (!kayit) return route.fulfill({ status: 404, json: { message: "Bildirim bulunamadı" } });
      cagrilar.push(`${eylem[2]}:${eylem[1]}`);
      kayit.durum = eylem[2] === "ustlen" ? "ustlenildi" : eylem[2] === "aksiyon" ? "aksiyon_alindi" : "yoksayildi";
      const govde = istek.postDataJSON?.() as { not?: string } | undefined;
      if (govde?.not) kayit.aksiyonNotu = govde.not;
      return route.fulfill({ json: kayit });
    }
    if (pathname.endsWith("/bildirimler")) {
      const kapanmis = searchParams.get("kapanmis") === "true";
      const durum = searchParams.get("durum");
      const liste = [...kayitlar.values()]
        .filter((k) => (kapanmis ? k.bildirim.kapandiAt !== null : k.bildirim.kapandiAt === null))
        .filter((k) => !durum || k.durum === durum);
      return route.fulfill({ json: { kayitlar: liste, toplam: liste.length, sayfa: 1, limit: 50, toplamSayfa: 1 } });
    }
    return route.fulfill({ json: {} });
  });

  return { cagrilar, kayitlar };
}

test.describe("Zil menüsü", () => {
  test("kalıcı kayıtları gösterir ve okundu işaretlemesini sunucuya yazar", async ({ page }) => {
    const { cagrilar } = await apiMockla(page, [
      teslimat({ id: "d1", baslik: "e-Belge gönderimi hata verdi" }),
      teslimat({ id: "d2", baslik: "Vadesi geçen fatura var", onem: "uyari" }),
    ]);
    await page.goto("/panel/bildirimler");

    const zil = page.getByRole("button", { name: /^Bildirimler/ }).first();
    await expect(zil).toHaveAccessibleName(/2/);
    await zil.click();

    const panel = page.getByRole("complementary", { name: "Bildirim merkezi" });
    await expect(panel.getByRole("link", { name: /e-Belge gönderimi hata verdi/ })).toBeVisible();
    await expect(panel.getByRole("link", { name: /Vadesi geçen fatura var/ })).toBeVisible();

    await panel.getByRole("button", { name: "Tümünü okundu işaretle" }).click();
    await expect.poll(() => cagrilar).toContain("tumunu-okundu");
    // Okundu, kaydı listeden düşürmez: iş hâlâ yapılmadı (BLD-02).
    await expect(panel.getByRole("link", { name: /e-Belge gönderimi hata verdi/ })).toBeVisible();
  });
});

test.describe("Bildirim ekranı", () => {
  test("üstlenme ve aksiyon alındı ayrı adımlardır", async ({ page }) => {
    const { cagrilar } = await apiMockla(page, [teslimat({ id: "d1", baslik: "e-Belge gönderimi hata verdi" })]);
    await page.goto("/panel/bildirimler");

    const satir = page.getByRole("row", { name: /e-Belge gönderimi hata verdi/ });
    await expect(satir).toContainText("Yeni");

    await satir.getByRole("button", { name: "Üstlen" }).click();
    await expect(satir).toContainText("Üstlenildi");
    await expect(satir.getByRole("button", { name: "Üstlen" })).toHaveCount(0);

    page.once("dialog", (dialog) => void dialog.accept("Fatura yeniden gönderildi"));
    await satir.getByRole("button", { name: "Aksiyon alındı" }).click();
    await expect(satir).toContainText("Aksiyon alındı");
    await expect(satir).toContainText("Not: Fatura yeniden gönderildi");
    expect(cagrilar).toEqual(["ustlen:d1", "aksiyon:d1"]);
  });

  test("kayıttan kaynağına gidilir ve kapanmış kayıtlar ayrı görünür", async ({ page }) => {
    await apiMockla(page, [teslimat({ id: "d1", baslik: "e-Belge gönderimi hata verdi" })]);
    await page.goto("/panel/bildirimler");

    const satir = page.getByRole("row", { name: /e-Belge gönderimi hata verdi/ });
    await expect(satir.getByRole("link", { name: "Kayda git" })).toHaveAttribute("href", "/panel/fatura?ebelge=hata");

    await page.getByLabel("Kapsam").selectOption("true");
    await expect(page.getByText("Bu filtrede bildirim yok.")).toBeVisible();
  });
});
