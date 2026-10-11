"use client";

import { ButtonLabel, Card, PageHeader } from "@/components/ui";

/*
 * Sayfa Tailwind sınıflarıyla yazılmıştı; uygulamada Tailwind olmadığı için
 * gizlenmesi gereken dosya seçici ham göründü (2026-10-11). OCR kapalıyken
 * çalışamayan yükleme ve sabit "%94 güven" yazan sonuç bloğu kaldırıldı;
 * uç (`POST /ai/ocr/tara`) yerinde, akış açılınca arayüz yeniden kurulur.
 */
export default function AiAsistanSayfasi() {
  return (
    <div>
      <PageHeader title="Finansal Projeksiyon" subtitle="Nakit tahmini ve belge okuma araçları." />

      <div className="form-grid form-grid--2">
        {/* NAK-14: nakit tahmini kendi ekranına taşındı. */}
        <Card title="📊 Nakit akışı tahmini">
          <p className="muted" style={{ fontSize: "0.9rem", marginTop: 0 }}>
            Nakit tahmini ayrı bir ekranda: kasa ve banka bakiyesinden başlayıp faturalar, çek/senetler, masraflar, kira,
            kart taksitleri, bordro ve tekrarlayan faturalardan 7, 30 ve 90 günlük; iyimser, baz ve kötümser senaryolu,
            kalem kalem açıklanabilir tahmin.
          </p>
          <ButtonLabel as="a" href="/panel/nakit-akisi" variant="primary">Nakit akışını aç</ButtonLabel>
        </Card>

        <Card title="🧾 Fiş & fatura OCR — yakında">
          <p className="muted" style={{ fontSize: "0.9rem", marginTop: 0 }}>
            Doğrulanmış bir OCR sağlayıcısı ve kullanıcı onaylı taslak akışı tamamlanana kadar belge yükleme kullanıma
            kapalıdır; henüz gerçek belge işleme yapılmıyor.
          </p>
          <div style={{ border: "2px dashed var(--border)", borderRadius: "0.85rem", color: "var(--text-subtle)", padding: "1.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.8rem" }} aria-hidden>📷</div>
            <strong style={{ color: "var(--text-muted)" }}>Yakında</strong>
          </div>
        </Card>
      </div>
    </div>
  );
}
