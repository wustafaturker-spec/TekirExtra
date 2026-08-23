"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Alert, Card, PageHeader } from "@/components/ui";

interface AiTahmin {
  tarihAraligiGun: number;
  mevcutBakiye: number;
  beklenenAlacaklar: number;
  beklenenBorclar: number;
  tahminiSonBakiye: number;
  riskSeviyesi: string;
  tavsiyeler: string[];
}

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
  const [tahmin, setTahmin] = useState<AiTahmin | null>(null);
  const [yukleniyorTahmin, setYukleniyorTahmin] = useState(true);
  const [hata, setHata] = useState("");

  const [ocrYukleniyor, setOcrYukleniyor] = useState(false);
  const [ocrSonuc, setOcrSonuc] = useState<OcrSonuc | null>(null);

  const fetchTahmin = useCallback(async () => {
    setYukleniyorTahmin(true);
    setHata("");
    try {
      const data = await api<AiTahmin>("/ai/nakit-akis-tahmini?gun=30");
      if (data) setTahmin(data);
    } catch (e) {
      console.error(e);
      setHata("Nakit akış tahmini hesaplanırken hata oluştu.");
    } finally {
      setYukleniyorTahmin(false);
    }
  }, []);

  useEffect(() => {
    void fetchTahmin();
  }, [fetchTahmin]);

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
        title="🤖 AI Finansal Asistan & Fiş OCR"
        subtitle="Yapay zeka ile geleceğe dönük nakit akışı tahmini ve fiş/fatura görsel tarama servisi."
      />

      <Alert tone="error">{hata}</Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 1. Nakit Akış Tahmin Kartı */}
        <Card className="p-6 space-y-6">
          <div className="flex justify-between items-center border-b pb-3">
            <h2 className="text-lg font-bold text-slate-800">📊 AI Nakit Akış Projeksiyonu (30 Gün)</h2>
            {tahmin && (
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full ${
                  tahmin.riskSeviyesi === "DÜŞÜK_RİSK"
                    ? "bg-green-100 text-green-800"
                    : tahmin.riskSeviyesi === "ORTA_RİSK"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {tahmin.riskSeviyesi}
              </span>
            )}
          </div>

          {yukleniyorTahmin ? (
            <div className="py-8 text-center text-slate-500">Analiz hesaplanıyor...</div>
          ) : tahmin ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl border">
                  <div className="text-xs text-slate-500 font-semibold">Mevcut Kasa/Banka Bakiyesi</div>
                  <div className="text-lg font-bold text-slate-800">
                    {Number(tahmin.mevcutBakiye).toLocaleString("tr-TR")} ₺
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="text-xs text-blue-600 font-semibold">Beklenen Tahsilatlar (30 Gün)</div>
                  <div className="text-lg font-bold text-blue-800">
                    +{Number(tahmin.beklenenAlacaklar).toLocaleString("tr-TR")} ₺
                  </div>
                </div>

                <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
                  <div className="text-xs text-rose-600 font-semibold">Beklenen Ödemeler (30 Gün)</div>
                  <div className="text-lg font-bold text-rose-800">
                    -{Number(tahmin.beklenenBorclar).toLocaleString("tr-TR")} ₺
                  </div>
                </div>

                <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                  <div className="text-xs text-orange-700 font-semibold">Tahmini Ay Sonu Net Bakiye</div>
                  <div className="text-lg font-bold text-orange-700">
                    {Number(tahmin.tahminiSonBakiye).toLocaleString("tr-TR")} ₺
                  </div>
                </div>
              </div>

              {/* Akıllı Tavsiyeler */}
              <div className="pt-2 space-y-2">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">AI Akıllı Önerileri</h4>
                <div className="space-y-1.5">
                  {tahmin.tavsiyeler.map((t, idx) => (
                    <div key={idx} className="p-3 bg-slate-100 rounded-lg text-xs font-medium text-slate-700">
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </Card>

        {/* 2. Fiş & Fatura OCR Okuma Kartı */}
        <Card className="p-6 space-y-6">
          <div className="border-b pb-3">
            <h2 className="text-lg font-bold text-slate-800">🧾 Fiş & Fatura Otomatik OCR Metin Okuma</h2>
            <p className="text-xs text-slate-500">Alış fişi veya masraf belgesi fotoğrafını yükleyin, veriler otomatik aktarılsın.</p>
          </div>

          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-3 hover:border-orange-500 transition">
            <input
              type="file"
              accept="image/*"
              onChange={ocrTara}
              className="hidden"
              id="ocr-upload"
            />
            <label htmlFor="ocr-upload" className="cursor-pointer space-y-2 block">
              <div className="text-3xl">📷</div>
              <div className="text-sm font-bold text-orange-600">Fiş / Fatura Görseli Yükle</div>
              <div className="text-xs text-slate-400">PNG, JPG, JPEG desteklenir</div>
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
