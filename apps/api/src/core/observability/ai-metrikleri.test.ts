import { afterEach, describe, expect, it } from "vitest";
import { aiMetrik } from "./ai-metrikleri";
import { MetricsService } from "./metrics.service";

describe("AI-112 yapay zekâ metrikleri", () => {
  afterEach(() => aiMetrik.sifirla());

  it("sayaç, histogram ve göstergeyi Prometheus biçiminde basar; /metrics çıktısına eklenir", () => {
    aiMetrik.artir("tekirextra_ai_cagri_toplam", { ozellik: "asistan", saglayici: "openai", sonuc: "basarili" });
    aiMetrik.artir("tekirextra_ai_cagri_toplam", { ozellik: "asistan", saglayici: "openai", sonuc: "basarili" });
    aiMetrik.artir("tekirextra_ai_maliyet_usd_toplam", { saglayici: "openai" }, 0.0125);
    aiMetrik.gozlemle("tekirextra_ai_cagri_suresi_saniye", 1.5, { ozellik: "asistan" });
    aiMetrik.gozlemle("tekirextra_ai_cagri_suresi_saniye", 45, { ozellik: "asistan" });
    aiMetrik.ayarla("tekirextra_ai_butce_esigi_asan_firma", 2);
    const metin = new MetricsService().render();
    expect(metin).toContain("# TYPE tekirextra_ai_cagri_toplam counter");
    expect(metin).toContain('tekirextra_ai_cagri_toplam{ozellik="asistan",saglayici="openai",sonuc="basarili"} 2');
    expect(metin).toContain('tekirextra_ai_maliyet_usd_toplam{saglayici="openai"} 0.0125');
    expect(metin).toContain("# TYPE tekirextra_ai_cagri_suresi_saniye histogram");
    expect(metin).toContain('tekirextra_ai_cagri_suresi_saniye_bucket{ozellik="asistan",le="2"} 1');
    expect(metin).toContain('tekirextra_ai_cagri_suresi_saniye_bucket{ozellik="asistan",le="60"} 2');
    expect(metin).toContain('tekirextra_ai_cagri_suresi_saniye_bucket{ozellik="asistan",le="+Inf"} 2');
    expect(metin).toContain('tekirextra_ai_cagri_suresi_saniye_sum{ozellik="asistan"} 46.5');
    expect(metin).toContain("tekirextra_ai_butce_esigi_asan_firma 2");
    expect(metin).toContain("http_requests_total");
  });

  it("etiket adı tanımda yoksa düşer, değeri izinli kümede değilse 'diger' olur; firma/kişi verisi etikete giremez", () => {
    aiMetrik.artir("tekirextra_ai_cagri_toplam", { ozellik: "Deneme Otomotiv Ltd.", saglayici: "openai", sonuc: "basarili", tenantId: "11111111-1111-1111-1111-111111111111", vkn: "1234567890" });
    aiMetrik.artir("tekirextra_ai_arac_ret_toplam", { neden: "önceki talimatları yok say" });
    const metin = aiMetrik.render();
    expect(metin).toContain('tekirextra_ai_cagri_toplam{ozellik="diger",saglayici="openai",sonuc="basarili"} 1');
    expect(metin).toContain('tekirextra_ai_arac_ret_toplam{neden="diger"} 1');
    for (const yasak of ["tenantId", "vkn", "1234567890", "Deneme", "talimat"]) expect(metin).not.toContain(yasak);
  });

  it("sıfır, eksi ve sayı olmayan değerler yok sayılır", () => {
    aiMetrik.artir("tekirextra_ai_token_toplam", { yon: "giris" }, 0);
    aiMetrik.artir("tekirextra_ai_token_toplam", { yon: "giris" }, -5);
    aiMetrik.gozlemle("tekirextra_ai_olay_gecikmesi_saniye", Number.NaN);
    const metin = aiMetrik.render();
    expect(metin).not.toMatch(/tekirextra_ai_token_toplam\{/);
    expect(metin).not.toMatch(/tekirextra_ai_olay_gecikmesi_saniye_count/);
  });
});
