import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Next dev sunucusu özel dağıtım klasörüyle (`.next-e2e`) açılınca
 * `next-env.d.ts` dosyasını o klasörü gösterecek biçimde yeniden yazar. Asıl
 * içerik yapılandırma yüklenirken (sunucu açılmadan) `E2E_NEXT_ENV_ILK` ile
 * saklanır; koşu sonunda aynen geri yazılır, çalışma ağacı kirlenmez.
 */
export default async function genelKurulum(): Promise<() => Promise<void>> {
  const dosya = resolve(__dirname, "../next-env.d.ts");
  const saklanan = process.env.E2E_NEXT_ENV_ILK;
  return async () => {
    if (!saklanan) return;
    const ilk = Buffer.from(saklanan, "base64").toString("utf8");
    const simdi = await readFile(dosya, "utf8").catch(() => null);
    if (simdi !== ilk) await writeFile(dosya, ilk);
  };
}
