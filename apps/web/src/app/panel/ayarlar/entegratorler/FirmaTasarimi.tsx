"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

type TasarimTuru = "efatura" | "earsiv" | "eirsaliye";

interface Firma {
  unvan: string;
  belgeMarkaAdi: string | null;
  belgeMarkaAlt: string | null;
  belgeEkBilgi: string | null;
  belgeRozetleri: string[] | null;
  logo: { id: string } | null;
}

interface BankaHesabi {
  id: string;
  ad: string;
  bankaAdi: string;
  sube: string | null;
  iban: string | null;
  swift: string | null;
  dovizCinsi: string;
  aktif: boolean;
  faturadaGoster: boolean;
}

const TUR_ADI: Record<TasarimTuru, string> = { efatura: "e-Fatura", earsiv: "e-Arşiv", eirsaliye: "e-İrsaliye" };
const AZAMI_ROZET = 3;
/** Sunucudaki sınırla aynı: data URI 80 000 karakter ≈ 58 KB görsel. */
const AZAMI_ROZET_URI = 80_000;

function dataUri(dosya: File): Promise<string> {
  return new Promise((coz, reddet) => {
    const okuyucu = new FileReader();
    okuyucu.onload = () => coz(String(okuyucu.result));
    okuyucu.onerror = () => reddet(okuyucu.error);
    okuyucu.readAsDataURL(dosya);
  });
}

/**
 * EBLG-101: firmanın entegratör tasarımı (EMSA düzeni). Düzen sabittir;
 * firmaya ait parçalar buradan girilir, "Oluştur ve yükle" tasarımı üretip
 * entegratöre yükler ve bu tür için seçer.
 */
export function FirmaTasarimi({ baglantiId, tur, onYuklendi }: { baglantiId: string; tur: TasarimTuru; onYuklendi: () => void }) {
  const [firma, setFirma] = useState<Firma | null>(null);
  const [hesaplar, setHesaplar] = useState<BankaHesabi[]>([]);
  const [rozetler, setRozetler] = useState<string[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    try {
      const [f, h] = await Promise.all([api<Firma>("/firma"), api<BankaHesabi[]>("/kasa-banka/bankalar")]);
      setFirma(f);
      setRozetler(f.belgeRozetleri ?? []);
      setHesaplar(h.filter((x) => x.aktif));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Firma bilgisi okunamadı");
    }
  }, []);

  useEffect(() => { void yukle(); }, [yukle]);

  async function rozetEkle(dosya: File | undefined) {
    if (!dosya) return;
    setHata("");
    const uri = await dataUri(dosya);
    if (uri.length > AZAMI_ROZET_URI) { setHata("Rozet görseli en çok 60 KB olabilir; küçültüp yeniden deneyin"); return; }
    setRozetler((r) => [...r, uri].slice(0, AZAMI_ROZET));
  }

  async function kaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setIslemde("kaydet"); setHata(""); setBasari("");
    try {
      await api("/firma", { method: "PATCH", body: JSON.stringify({
        belgeMarkaAdi: f.get("belgeMarkaAdi"), belgeMarkaAlt: f.get("belgeMarkaAlt"), belgeEkBilgi: f.get("belgeEkBilgi"), belgeRozetleri: rozetler,
      }) });
      // Hesap başına yalnız değişen alanlar yazılır.
      for (const h of hesaplar) {
        const goster = f.get(`goster-${h.id}`) === "on";
        const swift = String(f.get(`swift-${h.id}`) ?? "").trim();
        if (goster !== h.faturadaGoster || swift !== (h.swift ?? "")) {
          await api(`/kasa-banka/bankalar/${h.id}`, { method: "PATCH", body: JSON.stringify({ faturadaGoster: goster, swift }) });
        }
      }
      setBasari("Firma tasarımı bilgileri kaydedildi. Belgelere yansıması için tasarımı yeniden oluşturun.");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kaydedilemedi");
    } finally { setIslemde(null); }
  }

  async function olustur() {
    setIslemde("olustur"); setHata(""); setBasari("");
    try {
      const s = await api<{ tasarim: { baslik: string }; boyut: number; logoKondu: boolean }>(`/baglantilar/${baglantiId}/tasarimlar/firma-tasarimi`, { method: "POST", body: JSON.stringify({ tur }) });
      setBasari(`"${s.tasarim.baslik}" oluşturuldu, entegratöre yüklendi ve ${TUR_ADI[tur]} belgeleri için seçildi (${Math.round(s.boyut / 1024)} KB)${s.logoKondu ? "" : " — logo konmadı: firma logosu yok ya da 110 KB'tan büyük"}.`);
      onYuklendi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Tasarım oluşturulamadı");
    } finally { setIslemde(null); }
  }

  if (!firma) return hata ? <Alert tone="error">{hata}</Alert> : null;

  return (
    <div style={{ marginTop: "1rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "0.6rem" }}>
      <div className="between" style={{ alignItems: "center" }}>
        <strong style={{ fontSize: "0.9rem" }}>Firma tasarımı</strong>
        <Button variant="primary" size="sm" onClick={() => void olustur()} disabled={islemde !== null}>
          {islemde === "olustur" ? "Oluşturuluyor..." : `${TUR_ADI[tur]} tasarımını oluştur ve yükle`}
        </Button>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0.75rem" }}>
        İki dilli (TR/EN) kurumsal düzen. Satıcı, alıcı, kalemler, toplamlar ve karekod belgeden okunur; aşağıdakiler firmanıza aittir.
        Logo Ayarlar › Firma&apos;daki logodur{firma.logo ? "" : " (henüz yüklenmemiş)"}. Her oluşturma entegratörde yeni bir sürüm açar.
      </p>
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      <form onSubmit={(e) => void kaydet(e)}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
          <Field label="Marka adı (üst şerit)"><Input name="belgeMarkaAdi" defaultValue={firma.belgeMarkaAdi ?? ""} maxLength={40} placeholder={firma.unvan} /></Field>
          <Field label="Marka alt yazısı"><Input name="belgeMarkaAlt" defaultValue={firma.belgeMarkaAlt ?? ""} maxLength={80} placeholder="Ör. ÖN MUHASEBE" /></Field>
          <Field label="Ek bilgi satırı"><Input name="belgeEkBilgi" defaultValue={firma.belgeEkBilgi ?? ""} maxLength={160} placeholder="Ör. ISO 9001 · Sertifika no …" /></Field>
        </div>

        <div style={{ marginTop: "0.75rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Rozetler (sağ üst, en çok {AZAMI_ROZET})</span>
          <div className="row-tight" style={{ alignItems: "center", gap: "0.5rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
            {rozetler.map((r, i) => (
              <span key={i} className="row-tight" style={{ alignItems: "center", gap: "0.25rem" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r} alt={`Rozet ${i + 1}`} style={{ height: "2.5rem", border: "1px solid var(--border)", borderRadius: "0.3rem" }} />
                <Button type="button" size="sm" onClick={() => setRozetler((x) => x.filter((_, j) => j !== i))}>Kaldır</Button>
              </span>
            ))}
            {rozetler.length < AZAMI_ROZET && <Input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { void rozetEkle(e.target.files?.[0]); e.target.value = ""; }} style={{ maxWidth: "16rem" }} />}
          </div>
        </div>

        {tur !== "eirsaliye" && (
          <div style={{ marginTop: "0.75rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Faturada gösterilecek banka hesapları</span>
            {hesaplar.length === 0 && <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0" }}>Aktif banka hesabı yok; Kasa &amp; Banka&apos;dan ekleyin.</p>}
            {hesaplar.map((h) => (
              <div key={h.id} className="row-tight" style={{ alignItems: "center", gap: "0.75rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                <label className="row-tight" style={{ gap: "0.4rem", alignItems: "center", minWidth: "18rem" }}>
                  <input type="checkbox" name={`goster-${h.id}`} defaultChecked={h.faturadaGoster} disabled={!h.iban} />
                  <span style={{ fontSize: "0.85rem" }}>{h.bankaAdi} · {h.ad} · {h.dovizCinsi}{h.iban ? "" : " (IBAN yok)"}</span>
                </label>
                <Input name={`swift-${h.id}`} defaultValue={h.swift ?? ""} placeholder="SWIFT (isteğe bağlı)" maxLength={11} style={{ maxWidth: "12rem" }} />
              </div>
            ))}
          </div>
        )}

        <div className="row-tight" style={{ justifyContent: "flex-end", marginTop: "0.75rem" }}>
          <Button type="submit" size="sm" disabled={islemde !== null}>{islemde === "kaydet" ? "Kaydediliyor..." : "Bilgileri Kaydet"}</Button>
        </div>
      </form>
    </div>
  );
}
