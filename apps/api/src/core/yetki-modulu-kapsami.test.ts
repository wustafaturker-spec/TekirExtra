import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { yolModulu } from "@tekirextra/shared";
import { describe, expect, it } from "vitest";

/**
 * Özel rol kutuları yalnız yetki modülüne bağlı yolları kapatır. Yeni denetleyici ya bir
 * modüle bağlanmalı ya da burada gerekçesiyle yazılmalı; aksi halde özel rol onu sınırlayamaz.
 */
const MODULSUZ: Record<string, string> = {
  auth: "kullanıcının kendi hesabı",
  "abonelik-odeme": "oturumsuz ödeme uçları",
  "banka-webhook": "kendi anahtarıyla gelen banka bildirimi",
  bildirimler: "kullanıcının kendi bildirimleri",
  duyurular: "platformun her role gösterdiği duyurular; kullanıcının kendi okuma ve tercih kaydı",
  ekler: "sahibin modülüyle serviste denetlenir (EK_ERISIMI)",
  health: "sağlık denetimi",
  "istemci-hata": "kullanıcının kendi ekranındaki hata bildirimi (PLT-119)",
  onaylar: "kullanıcının kendi onay kutusu; karar yetkisi talebin adımında denetlenir (ONY-06)",
  metrics: "işletim metrikleri",
  mevzuat: "yürürlükteki ortak mevzuat",
  platform: "platform ekibi, kiracı rolü değil",
  "self-servis": "çalışanın kendi kartı",
  tenant: "firma kaydı",
};

function denetleyiciler(dizin: string): string[] {
  return readdirSync(dizin, { withFileTypes: true }).flatMap((g) => {
    const yol = join(dizin, g.name);
    return g.isDirectory() ? denetleyiciler(yol) : g.name.endsWith(".controller.ts") ? [yol] : [];
  });
}

describe("yetki modülü kapsamı", () => {
  it("her denetleyici bir modüle bağlı ya da bilinçli olarak modülsüzdür", () => {
    const onekler = denetleyiciler(join(__dirname, "..")).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/@Controller\("([^"]+)"\)/g)].map((m) => m[1]));
    expect(onekler.length).toBeGreaterThan(50);
    const eksik = [...new Set(onekler)].filter((o) => !yolModulu(o) && !MODULSUZ[o.split("/")[0]]);
    expect(eksik).toEqual([]);
  });
});
