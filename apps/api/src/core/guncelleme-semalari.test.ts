import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function semaDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap((ad) => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return semaDosyalari(yol);
    return ad.endsWith(".semalar.ts") ? [yol] : [];
  });
}

/**
 * zod 4'te `.partial()` varsayılanları korur; boş PATCH gövdesi varsayılanlarla
 * dolup kaydı ezer. Güncelleme şemaları `guncellemeSemasi` ile kurulur; yeni
 * bir şema aynı hatayı yaparsa bu test onu adıyla gösterir.
 */
describe("güncelleme şemaları", () => {
  it("istekte olmayan alanı varsayılanla doldurmaz", async () => {
    const sizintilar: string[] = [];
    for (const dosya of semaDosyalari(SRC)) {
      const modul = (await import(dosya)) as Record<string, unknown>;
      for (const [ad, sema] of Object.entries(modul)) {
        if (!/Guncelle\w*Semasi$/.test(ad)) continue;
        const safeParse = (sema as { safeParse?: (v: unknown) => { success: boolean; data?: unknown } }).safeParse;
        if (typeof safeParse !== "function") continue;
        // Zorunlu alanı olan şema (ör. çek/senet durumu) boş gövdeyi reddeder; sızıntı değildir.
        const sonuc = safeParse.call(sema, {});
        if (sonuc.success && sonuc.data && typeof sonuc.data === "object" && Object.keys(sonuc.data).length > 0) {
          sizintilar.push(`${ad}: ${JSON.stringify(sonuc.data)}`);
        }
      }
    }
    expect(sizintilar).toEqual([]);
  });
});
