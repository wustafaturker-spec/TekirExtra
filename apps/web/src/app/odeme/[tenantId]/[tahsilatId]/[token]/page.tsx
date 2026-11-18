"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card } from "@/components/ui";

interface OdemeDetay {
  tahsilatId: string;
  tenantId: string;
  durum: "baslatildi" | "odendi" | "suresi_doldu" | "iptal" | string;
  tutar: number;
  dovizCinsi: string;
  sonKullanimTarihi: string | null;
  odemeSayfasiUrl: string | null;
  makbuzUrl: string | null;
  firma: {
    unvan: string;
    vkn: string | null;
    telefon: string | null;
    eposta: string | null;
    webSitesi: string | null;
  };
  cari: {
    unvan: string;
  };
  fatura: {
    no: string | null;
    tarih: string | null;
    genelToplam: number | null;
  } | null;
}

const para = (t: number, d = "TRY") =>
  t.toLocaleString("tr-TR", { style: "currency", currency: d, maximumFractionDigits: 2 });

const tarihTR = (iso: string | null) => {
  if (!iso) return "—";
  return iso.slice(0, 10).split("-").reverse().join(".");
};

export default function MarkaliOdemeSayfasi() {
  const params = useParams<{ tenantId: string; tahsilatId: string; token: string }>();
  const [veri, setVeri] = useState<OdemeDetay | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  useEffect(() => {
    async function yukle() {
      if (!params.tenantId || !params.tahsilatId || !params.token) return;
      setYukleniyor(true);
      setHata("");
      try {
        const res = await api<OdemeDetay>(
          `/pos/odeme/${params.tenantId}/${params.tahsilatId}/${params.token}`,
        );
        setVeri(res);
      } catch (e) {
        setHata(e instanceof Error ? e.message : "Ödeme bilgileri alınamadı veya bağlantı geçersiz.");
      } finally {
        setYukleniyor(false);
      }
    }
    void yukle();
  }, [params.tenantId, params.tahsilatId, params.token]);

  if (yukleniyor) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center text-slate-500 font-medium">Güvenli ödeme bağlantısı yükleniyor...</div>
      </main>
    );
  }

  if (hata || !veri) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-200">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Ödeme Bağlantısı Açılamadı</h1>
          <p className="text-sm text-slate-600 mb-6">{hata || "Bağlantı geçersiz veya süresi dolmuş olabilir."}</p>
          <p className="text-xs text-slate-400">Lütfen ödeme talebini ileten firma ile iletişime geçin.</p>
        </div>
      </main>
    );
  }

  const durumBadge = () => {
    switch (veri.durum) {
      case "odendi":
        return <Badge variant="success">Ödendi ✓</Badge>;
      case "suresi_doldu":
        return <Badge variant="warning">Süresi Doldu</Badge>;
      case "iptal":
        return <Badge variant="danger">İptal Edildi</Badge>;
      default:
        return <Badge variant="accent">Ödeme Bekliyor</Badge>;
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        {/* Üst Marka Başlığı */}
        <div className="bg-gradient-to-r from-teal-700 to-teal-900 text-white p-6 text-center">
          <span className="text-xs uppercase tracking-wider font-semibold opacity-80">GÜVENLİ TAHSİLAT PORTALI</span>
          <h1 className="text-2xl font-bold mt-1">{veri.firma.unvan}</h1>
          {veri.firma.vkn && (
            <div className="text-xs opacity-75 mt-1 font-mono">VKN: {veri.firma.vkn}</div>
          )}
        </div>

        <div className="p-6 space-y-6">
          {/* Tutar ve Durum Kartı */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 text-center">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase">Tahsilat Tutarı</span>
              {durumBadge()}
            </div>
            <div className="text-3xl font-extrabold text-teal-800">
              {para(veri.tutar, veri.dovizCinsi)}
            </div>
            {veri.sonKullanimTarihi && veri.durum === "baslatildi" && (
              <div className="text-xs text-slate-500 mt-2">
                Son geçerlilik: <strong>{tarihTR(veri.sonKullanimTarihi)}</strong>
              </div>
            )}
          </div>

          {/* Cari & Fatura Detayı */}
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-500">Ödeyen:</span>
              <span className="font-semibold text-slate-800 text-right">{veri.cari.unvan}</span>
            </div>

            {veri.fatura && (
              <>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Fatura No:</span>
                  <span className="font-mono font-semibold text-slate-800">{veri.fatura.no || "—"}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Fatura Tarihi:</span>
                  <span className="text-slate-800">{tarihTR(veri.fatura.tarih)}</span>
                </div>
              </>
            )}

            {veri.firma.telefon && (
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">Firma İletişim:</span>
                <span className="text-slate-800">{veri.firma.telefon}</span>
              </div>
            )}
          </div>

          {/* Eylemler */}
          <div className="pt-2">
            {veri.durum === "baslatildi" && veri.odemeSayfasiUrl && (
              <a
                href={veri.odemeSayfasiUrl}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-800 text-white font-semibold py-3.5 px-4 rounded-xl shadow-md transition-colors text-center text-base"
              >
                🔒 Kredi / Banka Kartı ile Güvenli Öde
              </a>
            )}

            {veri.durum === "odendi" && veri.makbuzUrl && (
              <div className="space-y-3">
                <Alert tone="success">
                  Bu tahsilat başarıyla tamamlanmıştır. Muhasebe kayıtlarınız için makbuzunuzu indirebilirsiniz.
                </Alert>
                <a
                  href={veri.makbuzUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="w-full inline-flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-800 text-white font-semibold py-3 px-4 rounded-xl shadow-md transition-colors text-center"
                >
                  📄 Tahsilat Makbuzunu PDF İndir
                </a>
              </div>
            )}

            {veri.durum === "suresi_doldu" && (
              <Alert tone="warning">
                Bu ödeme bağlantısının geçerlilik süresi dolmuştur. Yeni bir ödeme bağlantısı için lütfen firma ile iletişime geçin.
              </Alert>
            )}

            {veri.durum === "iptal" && (
              <Alert tone="error">
                Bu ödeme talebi iptal edilmiştir.
              </Alert>
            )}
          </div>

          {/* Güvenlik & Alt Bilgi */}
          <div className="border-t border-slate-100 pt-4 text-center space-y-1">
            <p className="text-xs text-slate-400">
              🔒 256-bit SSL şifreleme ve BDDK lisanslı sanal POS altyapısı ile korunmaktadır.
            </p>
            <p className="text-xs text-slate-300">
              TekirExtra Güvenli Ödeme Altyapısı
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
