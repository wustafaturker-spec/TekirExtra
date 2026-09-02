import { expect, test } from "@playwright/test";

test("düzeltme kaydı incelenir, atanır, notlanır ve beklemeye alınır", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  let atanan = false; let notEklendi = false; let durum = "acik";
  const kayit = () => ({
    id: "duzeltme-1", tur: "banka_ekstre", onem: "uyari", durum,
    kaynakTur: "banka_ekstre_satiri", kaynakRef: "satir-1", nedenKodu: "ESLESMEMIS_EKSTRE",
    aciklama: "Havale satırı eşleştirme bekliyor.", onerilenEylem: "Satırı cari veya faturayla eşleştirin.",
    createdAt: "2026-09-02T10:00:00.000Z", atanan: atanan ? { id: "11111111-1111-4111-8111-111111111111", adSoyad: "Ayşe Yönetici" } : null,
    olaylar: notEklendi ? [{ id: "olay-1", olayTuru: "not", aciklama: "Banka dekontu istendi.", createdAt: "2026-09-02T11:00:00.000Z", user: { adSoyad: "Ayşe Yönetici" } }] : [],
  });
  await page.route("http://localhost:3001/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url()); const method = route.request().method();
    if (pathname.endsWith("/auth/ben")) return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (pathname.endsWith("/duzeltmeler/ozet")) return route.fulfill({ json: { acik: 1, kritik: 0, banaAtanan: atanan ? 1 : 0, slaAsan: 0 } });
    if (pathname.endsWith("/duzeltmeler/secenekler")) return route.fulfill({ json: [{ id: "11111111-1111-4111-8111-111111111111", adSoyad: "Ayşe Yönetici", eposta: "ayse@example.com" }] });
    if (pathname.endsWith("/duzeltmeler/duzeltme-1/ata")) { atanan = true; return route.fulfill({ json: kayit() }); }
    if (pathname.endsWith("/duzeltmeler/duzeltme-1/notlar")) { notEklendi = true; return route.fulfill({ json: {} }); }
    if (pathname.endsWith("/duzeltmeler/duzeltme-1/durum")) { durum = "beklemede"; return route.fulfill({ json: kayit() }); }
    if (pathname.endsWith("/duzeltmeler/duzeltme-1")) return route.fulfill({ json: kayit() });
    if (pathname.endsWith("/duzeltmeler") && method === "GET") return route.fulfill({ json: { kayitlar: [kayit()], toplam: 1, sayfa: 1, limit: 25, toplamSayfa: 1 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/panel/islemler");
  await page.getByRole("button", { name: "Ayrıntı" }).click();
  const dialog = page.getByRole("dialog", { name: "Banka ekstresi" });
  await expect(dialog.getByText("Neden oluştu?")).toBeVisible();
  await dialog.getByLabel("Atanan kullanıcı").selectOption("11111111-1111-4111-8111-111111111111");
  await expect(dialog.getByLabel("Atanan kullanıcı")).toHaveValue("11111111-1111-4111-8111-111111111111");
  await dialog.getByLabel("İnceleme notu").fill("Banka dekontu istendi.");
  await dialog.getByRole("button", { name: "Not ekle" }).click();
  await expect(dialog.getByText("Banka dekontu istendi.")).toBeVisible();
  await dialog.getByRole("button", { name: "Beklemeye al" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Kayıt beklemede olarak güncellendi.")).toBeVisible();
});
