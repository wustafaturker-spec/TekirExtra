import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SISTEM_KIMLIGI_KULLANIMLARI, SISTEM_USER_ID } from "./sistem-kimligi";

const KOK = join(__dirname, "..");

function kaynaklar(): string[] {
  const sonuc: string[] = [];
  const gez = (d: string) => {
    for (const ad of readdirSync(d)) {
      const yol = join(d, ad);
      if (statSync(yol).isDirectory()) gez(yol);
      else if (ad.endsWith(".ts") && !ad.endsWith(".test.ts")) sonuc.push(yol);
    }
  };
  gez(KOK);
  return sonuc;
}

describe("AI-96 sistem kimliği envanteri", () => {
  it("sistem kimliğini bağlamda kullanan her dosya sınıflandırılmıştır; liste günceldir", () => {
    const kullananlar = kaynaklar()
      .filter((y) => !y.endsWith("core/sistem-kimligi.ts"))
      .filter((y) => { const m = readFileSync(y, "utf8"); return m.includes("SISTEM_USER_ID") || m.includes(SISTEM_USER_ID); })
      .map((y) => relative(KOK, y).split("\\").join("/"))
      .sort();
    // Yeni kullanım: belirli bir kullanıcı adınaysa kullaniciAdinaCalistir kullanın; değilse buraya sınıfıyla ekleyin.
    expect(kullananlar).toEqual(Object.keys(SISTEM_KIMLIGI_KULLANIMLARI).sort());
  });

  it("sabit kimlik tek yerde tanımlıdır", () => {
    const tanimlayanlar = kaynaklar().filter((y) => readFileSync(y, "utf8").includes(`"${SISTEM_USER_ID}"`)).map((y) => relative(KOK, y));
    expect(tanimlayanlar).toEqual(["core/sistem-kimligi.ts"]);
  });
});
