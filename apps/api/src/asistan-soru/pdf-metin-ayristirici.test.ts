import { describe, expect, it } from "vitest";
import { pdfMetniniAyikla } from "./pdf-metin-ayristirici";

describe("pdfMetniniAyikla", () => {
  it("boş ya da tanımsız tamponda null döner", async () => {
    expect(await pdfMetniniAyikla(null as never)).toBeNull();
    expect(await pdfMetniniAyikla(Buffer.alloc(0))).toBeNull();
  });

  it("geçersiz ya da PDF olmayan içerikte doğrudan null döner", async () => {
    const bozukTampon = Buffer.from("Bu bir geçerli PDF dosyası değildir.");
    const sonuc = await pdfMetniniAyikla(bozukTampon);
    expect(sonuc).toBeNull();
  });
});
