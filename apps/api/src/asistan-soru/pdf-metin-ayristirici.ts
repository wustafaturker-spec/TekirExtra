/**
 * CNL-25: Dijital PDF'lerden doğrudan metin çıkarımı.
 * Metin katmanı bulunan PDF'ler (e-Arşiv/e-Fatura, resmi vergi levhası, antetli evrak)
 * OCR modeline gitmeden pdf.js ile doğrudan okunur; gecikme ve token maliyeti düşer.
 */

export async function pdfMetniniAyikla(tampon: Buffer, azamiSayfa = 5): Promise<string | null> {
  if (!tampon || tampon.length < 10 || !tampon.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
    return null;
  }
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const yukleme = pdfjs.getDocument({
      data: new Uint8Array(tampon),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    const doc = await yukleme.promise;
    const sayfaSayisi = Math.min(doc.numPages, azamiSayfa);
    let birlesikMetin = "";

    for (let sayfaNo = 1; sayfaNo <= sayfaSayisi; sayfaNo++) {
      const sayfa = await doc.getPage(sayfaNo);
      const icerik = await sayfa.getTextContent();
      const metinler = icerik.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter((s) => s.trim().length > 0);
      sayfa.cleanup();
      if (metinler.length > 0) {
        birlesikMetin += `\n[Sayfa ${sayfaNo}]\n` + metinler.join(" ");
      }
    }

    const temiz = birlesikMetin.replace(/\s+/g, " ").trim();
    // En azından unvan veya birkaç kelimelik anlamlı metin olmalı (boş taranmış PDF'ler elenir)
    return temiz.length >= 30 ? temiz : null;
  } catch {
    return null;
  }
}
