"use client";

import { useState } from "react";

export default function MaliMusavirSayfasi() {
  const [baslangic, setBaslangic] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0]
  );
  const [bitis, setBitis] = useState(new Date().toISOString().split("T")[0]);

  const [kdvDonem, setKdvDonem] = useState({
    yil: new Date().getFullYear(),
    ay: new Date().getMonth() + 1,
  });
  const [kdvOzet, setKdvOzet] = useState<{
    hesaplananKdv: number;
    indirilecekKdv: number;
    odenecekVeIndirilecekFark: number;
  } | null>(null);
  const [kdvYukleniyor, setKdvYukleniyor] = useState(false);

  const lucaXmlIndir = () => {
    window.open(`/api/mali-musavir/aktarim/luca-xml?baslangic=${baslangic}&bitis=${bitis}`, "_blank");
  };

  const zirveCsvIndir = () => {
    window.open(`/api/mali-musavir/aktarim/zirve-csv?baslangic=${baslangic}&bitis=${bitis}`, "_blank");
  };

  const kdvHesapla = async (e: React.FormEvent) => {
    e.preventDefault();
    setKdvYukleniyor(true);
    try {
      const res = await fetch(`/api/mali-musavir/kdv-ozeti?yil=${kdvDonem.yil}&ay=${kdvDonem.ay}`);
      if (res.ok) {
        const data = await res.json();
        setKdvOzet(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setKdvYukleniyor(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Başlık */}
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold text-slate-800">Mali Müşavir & Veri Aktarım Portalı</h1>
        <p className="text-sm text-slate-500">Fatura, fiş ve KDV verilerini muhasebe programlarına (Luca, Zirve vb.) uygun formatta dışa aktarın.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Dışa Aktarım Kartı */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>📦</span> Fatura & Fiş Dışa Aktarımı
          </h2>
          <p className="text-xs text-slate-500">Seçilen tarih aralığındaki faturaları Luca XML veya Kasa/Banka fişlerini Zirve CSV formatında indirin.</p>
          
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Başlangıç Tarihi</label>
              <input
                type="date"
                value={baslangic}
                onChange={(e) => setBaslangic(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Bitiş Tarihi</label>
              <input
                type="date"
                value={bitis}
                onChange={(e) => setBitis(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <button
              onClick={lucaXmlIndir}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-xl transition flex items-center justify-center gap-2"
            >
              📄 Luca Uyumlu Fatura XML İndir
            </button>
            <button
              onClick={zirveCsvIndir}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl transition flex items-center justify-center gap-2"
            >
              📊 Zirve/Logo Uyumlu Fiş CSV İndir
            </button>
          </div>
        </div>

        {/* 2. KDV Hazırlık Kartı */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>📑</span> KDV Beyanname Ön Analizi
          </h2>
          <p className="text-xs text-slate-500">Aylık bazda hesaplanan (satış) ve indirilecek (alış) KDV tutarlarını sorgulayın.</p>

          <form onSubmit={kdvHesapla} className="grid grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Yıl</label>
              <input
                type="number"
                value={kdvDonem.yil}
                onChange={(e) => setKdvDonem({ ...kdvDonem, yil: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ay</label>
              <input
                type="number"
                min="1"
                max="12"
                value={kdvDonem.ay}
                onChange={(e) => setKdvDonem({ ...kdvDonem, ay: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={kdvYukleniyor}
                className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium text-sm rounded-lg transition"
              >
                {kdvYukleniyor ? "..." : "Sorgula"}
              </button>
            </div>
          </form>

          {kdvOzet && (
            <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Hesaplanan KDV (Satış):</span>
                <span className="font-semibold text-slate-900">{kdvOzet.hesaplananKdv.toLocaleString("tr-TR")} ₺</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">İndirilecek KDV (Alış):</span>
                <span className="font-semibold text-slate-900">{kdvOzet.indirilecekKdv.toLocaleString("tr-TR")} ₺</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold">
                <span className={kdvOzet.odenecekVeIndirilecekFark > 0 ? "text-amber-700" : "text-green-700"}>
                  {kdvOzet.odenecekVeIndirilecekFark > 0 ? "Tahmini Ödenecek KDV:" : "Sonraki Döneme Devreden KDV:"}
                </span>
                <span className={kdvOzet.odenecekVeIndirilecekFark > 0 ? "text-amber-700" : "text-green-700"}>
                  {Math.abs(kdvOzet.odenecekVeIndirilecekFark).toLocaleString("tr-TR")} ₺
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
