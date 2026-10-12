"use client";

import { useState } from "react";
import { Button, Modal, Alert } from "@/components/ui";
import { api } from "@/lib/api";

export interface FisAiDoldurVerisi {
  belgeTuru: "FIS" | "FATURA" | "E_ARSIV" | "E_FATURA" | "BILINMIYOR";
  belgeNo?: string | null;
  tarih?: string | null;
  saticiUnvan: string;
  saticiVknTckn?: string | null;
  saticiVergiDairesi?: string | null;
  paraBirimi: string;
  toplamKdv: number;
  toplamMatrah: number;
  genelToplam: number;
  kdvKirilimi: { oran: number; matrah: number; kdvTutari: number }[];
  kalemler: {
    aciklama: string;
    miktar: number;
    birim: string;
    birimFiyat: number;
    toplamTutar: number;
    kdvOrani?: number | null;
  }[];
  guvenSkoru: number;
}

interface FisAiDoldurModalProps {
  acik: boolean;
  onKapat: () => void;
  kategoriler?: Array<{ id: string; ad: string; varsayilanKdvOrani?: string | null; ustId?: string | null }>;
  kasalar?: Array<{ id: string; ad: string; dovizCinsi: string }>;
  krediKartlari?: Array<{ id: string; ad: string; sonDortHane: string; dovizCinsi: string; aktif: boolean }>;
  onVeriDoldur: (veri: {
    ocr: FisAiDoldurVerisi;
    dosya?: File;
    kategoriId?: string | null;
    odemeHesabi?: string | null;
  }) => void;
}

export function FisAiDoldurModal({ acik, onKapat, kategoriler, kasalar, krediKartlari, onVeriDoldur }: FisAiDoldurModalProps) {
  const [secilenDosya, setSecilenDosya] = useState<File | null>(null);
  const [gorselBase64, setGorselBase64] = useState("");
  const [hamMetin, setHamMetin] = useState("");
  const [sekme, setSekme] = useState<"gorsel" | "metin">("gorsel");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [uyarilar, setUyarilar] = useState<string[]>([]);
  const [secilenKategoriId, setSecilenKategoriId] = useState<string>("");
  const [secilenOdemeHesabi, setSecilenOdemeHesabi] = useState<string>("");
  const [oneriSonuc, setOneriSonuc] = useState<{
    ocr: FisAiDoldurVerisi;
    eslesenCari: { id: string; unvan: string; kod: string } | null;
    onerilenMasrafKategorisi: string | null;
  } | null>(null);

  if (!acik) return null;

  const handleDosyaSec = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = e.target.files?.[0];
    if (!dosya) return;
    setSecilenDosya(dosya);
    const okuyucu = new FileReader();
    okuyucu.onload = (olay) => {
      setGorselBase64(olay.target?.result as string);
    };
    okuyucu.readAsDataURL(dosya);
  };

  const aiTara = async () => {
    setYukleniyor(true);
    setHata("");
    setUyarilar([]);
    setOneriSonuc(null);

    try {
      const payload = {
        gorselBase64: sekme === "gorsel" ? gorselBase64 : undefined,
        hamMetin: sekme === "metin" ? hamMetin : undefined,
        mimeType: secilenDosya?.type || "image/jpeg",
        belgeTipi: "fis_fatura",
      };

      const res = await api<{
        dogrulama: {
          gecerli: boolean;
          veri: FisAiDoldurVerisi;
          uyarilar: string[];
          hatalar: string[];
        };
        eslesenCari: { id: string; unvan: string; kod: string } | null;
        onerilenMasrafKategorisi: string | null;
      }>("/ai/ocr/tara", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.dogrulama.gecerli || res.dogrulama.hatalar.length > 0) {
        setHata(res.dogrulama.hatalar.join(", "));
        return;
      }

      setOneriSonuc({
        ocr: res.dogrulama.veri,
        eslesenCari: res.eslesenCari,
        onerilenMasrafKategorisi: res.onerilenMasrafKategorisi,
      });
      setUyarilar(res.dogrulama.uyarilar || []);

      // Akıllı Kategori Eşleştirmesi
      if (kategoriler && kategoriler.length > 0) {
        const oneri = res.onerilenMasrafKategorisi?.toLowerCase() || "";
        const satici = res.dogrulama.veri.saticiUnvan?.toLowerCase() || "";
        const bulunan = kategoriler.find((k) => {
          const kAd = k.ad.toLowerCase();
          return (
            (oneri && (kAd.includes(oneri) || oneri.includes(kAd))) ||
            (oneri.includes("akaryakıt") && (kAd.includes("akaryakıt") || kAd.includes("taşıt") || kAd.includes("araç"))) ||
            (oneri.includes("yemek") && (kAd.includes("yemek") || kAd.includes("temsil") || kAd.includes("ağırlama"))) ||
            (oneri.includes("ulaşım") && (kAd.includes("ulaşım") || kAd.includes("seyahat") || kAd.includes("yol"))) ||
            (oneri.includes("ofis") && (kAd.includes("kırtasiye") || kAd.includes("ofis") || kAd.includes("büro"))) ||
            (satici.includes("petrol") && kAd.includes("akaryakıt")) ||
            (satici.includes("taksi") && kAd.includes("ulaşım"))
          );
        });
        if (bulunan) {
          setSecilenKategoriId(bulunan.id);
        } else {
          setSecilenKategoriId(kategoriler[0].id);
        }
      }
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Fiş taranırken bir hata oluştu.");
    } finally {
      setYukleniyor(false);
    }
  };

  const formaAktar = () => {
    if (!oneriSonuc) return;
    onVeriDoldur({
      ocr: oneriSonuc.ocr,
      dosya: secilenDosya || undefined,
      kategoriId: secilenKategoriId || null,
      odemeHesabi: secilenOdemeHesabi || null,
    });
    onKapat();
  };

  return (
    <Modal baslik="✨ Yapay Zeka ile Fiş / Harcama Tara" onKapat={onKapat}>
      <div className="space-y-4 text-sm" style={{ minWidth: "480px", maxWidth: "620px" }}>
        <p className="text-gray-600" style={{ fontSize: "13px", lineHeight: "1.5" }}>
          Akaryakıt, yemek, taksi, otel fişinin fotoğrafını yükleyin veya metnini yapıştırın.
          Yapay zeka matrah, KDV tutarı ve satıcı bilgilerini doğrudan carisiz masraf olarak çıkarır.
        </p>

        {/* Sekmeler */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            className={`px-4 py-2 font-medium border-b-2 ${
              sekme === "gorsel" ? "border-primary text-primary" : "border-transparent text-gray-500"
            }`}
            onClick={() => setSekme("gorsel")}
          >
            📸 Fiş Fotoğrafı / PDF
          </button>
          <button
            type="button"
            className={`px-4 py-2 font-medium border-b-2 ${
              sekme === "metin" ? "border-primary text-primary" : "border-transparent text-gray-500"
            }`}
            onClick={() => setSekme("metin")}
          >
            📋 Fiş / Harcama Metni
          </button>
        </div>

        {/* Görsel Yükleme */}
        {sekme === "gorsel" && (
          <div>
            <label className="block font-medium mb-1">Fiş / Belge Görseli</label>
            <input type="file" accept="image/*,application/pdf" onChange={handleDosyaSec} className="w-full text-sm" />
            {gorselBase64 && (
              <div className="mt-2 border rounded p-1 max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gorselBase64} alt="Fiş Önizleme" className="max-h-36 rounded object-contain" />
              </div>
            )}
          </div>
        )}

        {/* Metin Girişi */}
        {sekme === "metin" && (
          <div>
            <label className="block font-medium mb-1">Fiş / Harcama Metni</label>
            <textarea
              className="w-full h-28 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:outline-none text-xs"
              placeholder="Örn:&#10;OPET PETROLCÜLÜK A.Ş.&#10;Tarih: 12/10/2026 Fiş No: 0041&#10;KDV %20: 100.00 TL&#10;TOPLAM: 600.00 TL"
              value={hamMetin}
              onChange={(e) => setHamMetin(e.target.value)}
            />
          </div>
        )}

        {hata && <Alert tone="error">{hata}</Alert>}

        {uyarilar.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-2.5 rounded text-xs space-y-1">
            {uyarilar.map((u, i) => (
              <div key={i}>{u}</div>
            ))}
          </div>
        )}

        {/* Çıkarım Sonuç Kartı */}
        {oneriSonuc && (
          <div className="space-y-3">
            {/* Carisiz Gider Bilgi Kutusu */}
            <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 14px", color: "#166534", fontSize: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>⚡</span>
              <div>
                <strong>Carisiz Doğrudan Masraf Kaydı:</strong> Fiş doğrudan satıcı ({oneriSonuc.ocr.saticiUnvan || "Perakende"}) adına giderleştirilir; cari hesap açılmadan rehberiniz temiz tutulur.
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 p-3.5 rounded text-xs space-y-2.5">
              <div className="font-semibold text-blue-900 border-b border-blue-200 pb-1 flex justify-between items-center">
                <span>🧾 Çıkarılan Fiş Detayları</span>
                <span className="text-gray-500 font-normal">Güven: %{Math.round(oneriSonuc.ocr.guvenSkoru * 100)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-gray-700">
                <div><strong>Satıcı:</strong> {oneriSonuc.ocr.saticiUnvan}</div>
                <div><strong>Tarih:</strong> {oneriSonuc.ocr.tarih || "-"}</div>
                <div><strong>Fiş/Belge No:</strong> {oneriSonuc.ocr.belgeNo || "-"}</div>
                <div><strong>VKN / TCKN:</strong> {oneriSonuc.ocr.saticiVknTckn || "-"}</div>
                <div><strong>Matrah:</strong> {oneriSonuc.ocr.toplamMatrah.toFixed(2)} TL</div>
                <div><strong>Toplam KDV:</strong> {oneriSonuc.ocr.toplamKdv.toFixed(2)} TL</div>
                <div className="col-span-2 text-sm font-bold text-blue-950 pt-1 border-t border-blue-100 flex justify-between">
                  <span>Ödenecek Tutar:</span>
                  <span>{oneriSonuc.ocr.genelToplam.toFixed(2)} {oneriSonuc.ocr.paraBirimi}</span>
                </div>
              </div>
            </div>

            {/* Kategori ve Ödeme Seçicileri */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              {kategoriler && kategoriler.length > 0 && (
                <div>
                  <label className="block font-medium text-xs mb-1 text-gray-700">🏷️ Masraf Kategorisi</label>
                  <select
                    value={secilenKategoriId}
                    onChange={(e) => setSecilenKategoriId(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {kategoriler.map((k) => (
                      <option key={k.id} value={k.id}>{k.ad}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-xs mb-1 text-gray-700">💳 Ödeme Şekli / Hesap</label>
                <select
                  value={secilenOdemeHesabi}
                  onChange={(e) => setSecilenOdemeHesabi(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Açık Bırak (Sonra ödenecek)</option>
                  {kasalar && kasalar.length > 0 && (
                    <optgroup label="💵 Nakit Kasalar">
                      {kasalar.map((k) => (
                        <option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi})</option>
                      ))}
                    </optgroup>
                  )}
                  {krediKartlari && krediKartlari.length > 0 && (
                    <optgroup label="💳 Şirket Kredi Kartları">
                      {krediKartlari.filter((c) => c.aktif).map((k) => (
                        <option key={k.id} value={`kart:${k.id}`}>{k.ad} · •••• {k.sonDortHane} ({k.dovizCinsi})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Eylem Düğmeleri */}
        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="ghost" onClick={onKapat}>Vazgeç</Button>
          {!oneriSonuc ? (
            <Button
              variant="primary"
              onClick={aiTara}
              disabled={yukleniyor || (sekme === "gorsel" ? !gorselBase64 : !hamMetin.trim())}
            >
              {yukleniyor ? "Fiş Okunuyor..." : "✨ Fişi Oku"}
            </Button>
          ) : (
            <Button variant="primary" onClick={formaAktar}>
              ✅ Forma Doldur
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
