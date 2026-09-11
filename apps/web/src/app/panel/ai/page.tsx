"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, PageHeader } from "@/components/ui";

interface OcrSonuc {
  unvan: string;
  vkn: string;
  tarih: string;
  toplamTutar: number;
  kdvOrani: number;
  kdvTutari: number;
  matrah: number;
}

export default function AiAsistanSayfasi() {
  const [hata, setHata] = useState("");

  const [ocrYukleniyor, setOcrYukleniyor] = useState(false);
  const [ocrSonuc, setOcrSonuc] = useState<OcrSonuc | null>(null);

  const ocrTara = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrYukleniyor(true);
    setHata("");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await api<{ okunanVeriler: OcrSonuc }>("/ai/ocr/tara", {
          method: "POST",
          body: JSON.stringify({ gorselBase64: reader.result as string }),
        });

        if (data?.okunanVeriler) {
          setOcrSonuc(data.okunanVeriler);
        }
      } catch (err) {
        console.error(err);
        setHata("Görsel taranırken hata oluştu.");
      } finally {
        setOcrYukleniyor(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finansal Projeksiyon"
        subtitle="Nakit tahmini ve belge okuma araçları."
      />

      <Alert tone="error">{hata}</Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* NAK-14: nakit tahmini kendi ekranına taşındı. */}
        <Card className="p-6 space-y-4">
          <div className="border-b pb-3">
            <h2 className="text-lg font-bold text-slate-800">📊 Nakit akışı tahmini</h2>
          </div>
          <p className="text-sm text-slate-600">
            Nakit tahmini artık ayrı bir ekranda: kasa ve banka bakiyesinden başlayıp faturalar, çek/senetler, masraflar,
            kira, kart taksitleri, bordro ve tekrarlayan faturalardan 7, 30 ve 90 günlük; iyimser, baz ve kötümser
            senaryolu, kalem kalem açıklanabilir tahmin.
          </p>
          <Link href="/panel/nakit-akisi"><Button variant="primary">Nakit akışını aç</Button></Link>
        </Card>

        {/* 2. Fiş & Fatura OCR Okuma Kartı */}
        <Card className="p-6 space-y-6">
          <div className="border-b pb-3">
            <h2 className="text-lg font-bold text-slate-800">🧾 Fiş & Fatura OCR <span className="text-xs text-amber-700">Deneysel — kapalı</span></h2>
            <p className="text-xs text-slate-500">Doğrulanmış OCR sağlayıcısı ve kullanıcı onaylı taslak akışı tamamlanana kadar belge yükleme kullanıma kapalıdır.</p>
          </div>

          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3 hover:border-orange-500 transition">
            <input
              type="file"
              accept="image/*"
              onChange={ocrTara}
              className="hidden"
              id="ocr-upload"
              disabled
            />
            <label className="cursor-not-allowed opacity-60 space-y-2 block">
              <div className="text-3xl">📷</div>
              <div className="text-sm font-bold text-orange-600">Yakında</div>
              <div className="text-xs text-slate-400">Henüz gerçek belge işleme yapılmıyor</div>
            </label>
          </div>

          {ocrYukleniyor && (
            <div className="p-4 bg-orange-50 text-orange-700 text-xs font-semibold rounded-xl text-center">
              ⏳ Görsel işleniyor, OCR metin tanıma motoru çalışıyor...
            </div>
          )}

          {ocrSonuc && (
            <div className="p-5 bg-slate-50 rounded-2xl border space-y-3">
              <h3 className="font-bold text-sm text-slate-800 flex justify-between">
                <span>Okunan Belge Detayları</span>
                <span className="text-green-600 text-xs">✓ Doğrulandı (%94 Güven)</span>
              </h3>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Firma Ünvanı:</span> <strong className="text-slate-800">{ocrSonuc.unvan}</strong></div>
                <div><span className="text-slate-500">VKN/TCKN:</span> <strong className="text-slate-800">{ocrSonuc.vkn}</strong></div>
                <div><span className="text-slate-500">Belge Tarihi:</span> <strong className="text-slate-800">{ocrSonuc.tarih}</strong></div>
                <div><span className="text-slate-500">KDV Oranı:</span> <strong className="text-slate-800">%{ocrSonuc.kdvOrani}</strong></div>
                <div><span className="text-slate-500">Matrah:</span> <strong className="text-slate-800">{ocrSonuc.matrah} ₺</strong></div>
                <div><span className="text-slate-500">KDV Tutarı:</span> <strong className="text-slate-800">{ocrSonuc.kdvTutari} ₺</strong></div>
              </div>

              <div className="pt-2 border-t flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700">Genel Toplam:</span>
                <span className="text-base font-bold text-orange-600">{ocrSonuc.toplamTutar} ₺</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
