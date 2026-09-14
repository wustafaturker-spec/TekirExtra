"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** EBLG-35: belge durum geçmişi; satırları veritabanı tetikleyicisi yazar. */
interface DurumGecmisiSatiri {
  id: string;
  eksen: string;
  eskiDurum: string | null;
  yeniDurum: string;
  aciklama: string | null;
  kullanici: string | null;
  baslangic: boolean;
  zaman: string;
}

const EKSEN_ADI: Record<string, string> = {
  fatura: "Fatura",
  ebelge: "e-Belge",
  alici_yaniti: "Alıcı yanıtı",
  eirsaliye: "e-İrsaliye",
};

const DURUM_ADI: Record<string, string> = {
  taslak: "Taslak",
  kesin: "Kesinleşti",
  kuyrukta: "Kuyrukta",
  iletildi: "İletildi",
  kabul: "Kabul",
  ret: "Ret",
  hata: "Hata",
  iptal: "İptal",
  kismi_kabul: "Kısmi kabul",
};

const durumAdi = (durum: string) => DURUM_ADI[durum] ?? durum;

/**
 * Durum geçmişini en yeni üstte listeler. Güncel veriyi yeniden çekmek için
 * çağıran `key` değiştirir (ör. kaydın son güncellenme zamanı).
 */
export function DurumGecmisi({ adres, baslik = "Durum geçmişi" }: { adres: string; baslik?: string }) {
  const [kayitlar, setKayitlar] = useState<DurumGecmisiSatiri[] | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    let iptal = false;
    setKayitlar(null);
    setHata("");
    api<DurumGecmisiSatiri[]>(adres)
      .then((veri) => { if (!iptal) setKayitlar(veri); })
      .catch((h) => { if (!iptal) setHata(h instanceof Error ? h.message : "Durum geçmişi yüklenemedi"); });
    return () => { iptal = true; };
  }, [adres]);

  return (
    <section aria-label={baslik} style={{ marginTop: "1rem" }}>
      <h4 className="card__title" style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>{baslik}</h4>
      {hata && <p className="muted">{hata}</p>}
      {!hata && kayitlar === null && <p className="muted">Yükleniyor…</p>}
      {kayitlar?.length === 0 && <p className="muted">Henüz durum değişikliği kaydı yok.</p>}
      {kayitlar && kayitlar.length > 0 && (
        <div className="status-history">
          {kayitlar.map((k) => (
            <div className={"status-history__item" + (["hata", "ret"].includes(k.yeniDurum) ? "" : " is-complete")} key={k.id}>
              <span />
              <div>
                <strong>
                  {EKSEN_ADI[k.eksen] ?? k.eksen}: {k.eskiDurum ? `${durumAdi(k.eskiDurum)} → ` : ""}{durumAdi(k.yeniDurum)}
                </strong>
                <small>
                  {new Date(k.zaman).toLocaleString("tr-TR")}
                  {k.baslangic ? " · Kayıt başlangıcı — önceki değişiklikler tutulmuyordu" : k.kullanici ? ` · ${k.kullanici}` : ""}
                  {k.aciklama ? ` · ${k.aciklama}` : ""}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
