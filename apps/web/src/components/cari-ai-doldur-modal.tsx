"use client";

import { useState } from "react";
import { Button, Input, Modal, Alert } from "@/components/ui";
import { api } from "@/lib/api";

export interface CariAiDoldurVerisi {
  unvan: string;
  kisiTipi: "gercek" | "tuzel";
  ad?: string | null;
  soyad?: string | null;
  vknTckn?: string | null;
  vergiDairesi?: string | null;
  ticaretSicilNo?: string | null;
  eposta?: string | null;
  telefon?: string | null;
  faks?: string | null;
  webSitesi?: string | null;
  adres?: string | null;
  il?: string | null;
  ilce?: string | null;
  postaKodu?: string | null;
  iban?: string | null;
  sektor?: string | null;
  yetkiliKisi?: {
    adSoyad?: string | null;
    unvan?: string | null;
    telefon?: string | null;
    eposta?: string | null;
  } | null;
}

interface CariAiDoldurModalProps {
  acik: boolean;
  onKapat: () => void;
  onVeriDoldur: (veri: CariAiDoldurVerisi) => void;
}

export function CariAiDoldurModal({ acik, onKapat, onVeriDoldur }: CariAiDoldurModalProps) {
  const [sekme, setSekme] = useState<"metin" | "gorsel">("metin");
  const [hamMetin, setHamMetin] = useState("");
  const [gorselBase64, setGorselBase64] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [uyarilar, setUyarilar] = useState<string[]>([]);
  const [oneriVeri, setOneriVeri] = useState<CariAiDoldurVerisi | null>(null);

  if (!acik) return null;

  const handleDosyaYukle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = e.target.files?.[0];
    if (!dosya) return;
    const okuyucu = new FileReader();
    okuyucu.onload = (olay) => {
      setGorselBase64(olay.target?.result as string);
    };
    okuyucu.readAsDataURL(dosya);
  };

  const aiIleAnalizEt = async () => {
    setYukleniyor(true);
    setHata("");
    setUyarilar([]);
    setOneriVeri(null);

    try {
      const payload = {
        hamMetin: sekme === "metin" ? hamMetin : undefined,
        gorselBase64: sekme === "gorsel" ? gorselBase64 : undefined,
        belgeTipi: "cari_bilgisi",
      };

      const res = await api<{
        dogrulama: {
          gecerli: boolean;
          veri: CariAiDoldurVerisi;
          uyarilar: string[];
          hatalar: string[];
        };
        mevcutCari: { id: string; unvan: string; kod: string } | null;
      }>("/ai/cari/cikar", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.dogrulama.gecerli || res.dogrulama.hatalar.length > 0) {
        setHata(res.dogrulama.hatalar.join(", "));
        return;
      }

      setOneriVeri(res.dogrulama.veri);
      setUyarilar(res.dogrulama.uyarilar || []);

      if (res.mevcutCari) {
        setUyarilar((prev) => [
          ...prev,
          `⚠️ Dikkat: Bu VKN veya e-posta ile kayıtlı mevcut bir cari bulundu: "${res.mevcutCari?.unvan}" (${res.mevcutCari?.kod})`,
        ]);
      }
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Yapay zeka analizi sırasında bir hata oluştu.");
    } finally {
      setYukleniyor(false);
    }
  };

  const formaAktar = () => {
    if (!oneriVeri) return;
    onVeriDoldur(oneriVeri);
    onKapat();
  };

  return (
    <Modal baslik="✨ Yapay Zeka ile Cari Bilgilerini Otomatik Doldur" onKapat={onKapat}>
      <div className="space-y-4 text-sm">
        <p className="text-gray-600">
          Müşterinizden gelen e-posta imzasını, WhatsApp mesajını yapıştırın veya kartvizit görselini yükleyin.
          Yapay zeka VKN, ünvan, adres, vergi dairesi ve yetkili kişi bilgilerini doğrulayarak çıkarır.
        </p>

        {/* Sekmeler */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            className={`px-4 py-2 font-medium border-b-2 ${
              sekme === "metin" ? "border-primary text-primary" : "border-transparent text-gray-500"
            }`}
            onClick={() => setSekme("metin")}
          >
            📧 E-posta / Metin Yapıştır
          </button>
          <button
            type="button"
            className={`px-4 py-2 font-medium border-b-2 ${
              sekme === "gorsel" ? "border-primary text-primary" : "border-transparent text-gray-500"
            }`}
            onClick={() => setSekme("gorsel")}
          >
            📸 Kartvizit / Belge Görseli
          </button>
        </div>

        {/* Metin Girişi */}
        {sekme === "metin" && (
          <div>
            <label className="block font-medium mb-1">E-posta İmzası veya İletişim Metni</label>
            <textarea
              className="w-full h-32 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:outline-none"
              placeholder="Örn:&#10;Kaya Endüstri Ltd. Şti.&#10;Ahmet Kaya - Genel Müdür&#10;VKN: 1234567890 Kadıköy VD&#10;Tel: 0216 444 0123&#10;E-posta: info@kayametal.com&#10;İmes Sanayi Sitesi E Blok No: 12 Ümraniye / İstanbul"
              value={hamMetin}
              onChange={(e) => setHamMetin(e.target.value)}
            />
          </div>
        )}

        {/* Görsel Yükleme */}
        {sekme === "gorsel" && (
          <div>
            <label className="block font-medium mb-1">Kartvizit veya Belge Görseli</label>
            <input type="file" accept="image/*" onChange={handleDosyaYukle} className="w-full text-sm" />
            {gorselBase64 && (
              <div className="mt-2 border rounded p-1 max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gorselBase64} alt="Önizleme" className="max-h-36 rounded object-contain" />
              </div>
            )}
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

        {/* AI Analiz Sonuç Kartı */}
        {oneriVeri && (
          <div className="bg-blue-50 border border-blue-200 p-3 rounded text-xs space-y-2">
            <div className="font-semibold text-blue-900 border-b border-blue-200 pb-1">
              🔎 Yapay Zeka Tarafından Çıkarılan Bilgiler:
            </div>
            <div className="grid grid-cols-2 gap-2 text-gray-700">
              <div><strong>Ünvan:</strong> {oneriVeri.unvan}</div>
              <div><strong>Kişi Tipi:</strong> {oneriVeri.kisiTipi === "tuzel" ? "Tüzel Kişi" : "Gerçek Kişi"}</div>
              <div><strong>VKN/TCKN:</strong> {oneriVeri.vknTckn || "-"}</div>
              <div><strong>Vergi Dairesi:</strong> {oneriVeri.vergiDairesi || "-"}</div>
              <div><strong>E-posta:</strong> {oneriVeri.eposta || "-"}</div>
              <div><strong>Telefon:</strong> {oneriVeri.telefon || "-"}</div>
              <div className="col-span-2"><strong>Adres:</strong> {[oneriVeri.adres, oneriVeri.ilce, oneriVeri.il].filter(Boolean).join(" ")}</div>
              {oneriVeri.iban && <div className="col-span-2"><strong>IBAN:</strong> {oneriVeri.iban}</div>}
              {oneriVeri.yetkiliKisi?.adSoyad && (
                <div className="col-span-2 text-blue-800 font-medium">
                  👤 Yetkili: {oneriVeri.yetkiliKisi.adSoyad} {oneriVeri.yetkiliKisi.unvan ? `(${oneriVeri.yetkiliKisi.unvan})` : ""} - {oneriVeri.yetkiliKisi.telefon || ""}
                </div>
              )}
            </div>
          </div>
        )}

        {/* İşlem Düğmeleri */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onKapat}>Vazgeç</Button>
          {!oneriVeri ? (
            <Button
              variant="primary"
              onClick={aiIleAnalizEt}
              disabled={yukleniyor || (sekme === "metin" ? !hamMetin.trim() : !gorselBase64)}
            >
              {yukleniyor ? "Analiz Ediliyor..." : "✨ Bilgileri Çıkar"}
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
