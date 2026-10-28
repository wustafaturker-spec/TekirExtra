"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Field, Input, Modal, ModalEylem, Segmented, Select } from "@/components/ui";

/** RPR-24: zamanlanmış rapor e-postası — abonelik formu. */

/** KLN-20: aday kullanıcı; özel rolü varsa onun adıyla gruplanır. */
interface AliciAdayi { id: string; adSoyad: string; eposta: string; rol: string; ozelRol: { id: string; ad: string } | null }
const rolAnahtari = (k: AliciAdayi) => (k.ozelRol ? `ozel:${k.ozelRol.id}` : k.rol);
function rolGruplari(adaylar: AliciAdayi[]) {
  const gruplar = new Map<string, { anahtar: string; ad: string; sayi: number }>();
  for (const k of adaylar) {
    const anahtar = rolAnahtari(k);
    const g = gruplar.get(anahtar) ?? { anahtar, ad: k.ozelRol ? `${k.ozelRol.ad} (özel rol)` : ROL_ADI[k.rol as keyof typeof ROL_ADI] ?? k.rol, sayi: 0 };
    g.sayi++;
    gruplar.set(anahtar, g);
  }
  return [...gruplar.values()].sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
}

export type Siklik = "gunluk" | "haftalik" | "aylik";
export type Donem = "dun" | "gecen_hafta" | "gecen_ay" | "bu_ay" | "bu_yil" | "gorunum";
export type Bicim = "excel" | "pdf" | "ikisi";

export interface Abonelik {
  id: string;
  gorunumId: string;
  siklik: Siklik;
  gun: number | null;
  saat: string;
  donem: Donem;
  bicim: Bicim;
  bosGonder: boolean;
  aliciIdler: string[];
  aktif: boolean;
  sonrakiGonderim: string;
  sonGonderim: string | null;
  sonDurum: string | null;
  sonHata: string | null;
  raporKod: string;
  raporAd: string;
  gorunumAd: string;
  kuran: string;
  alicilar: { id: string; adSoyad: string; eposta: string }[];
}

export const DONEM_ADLARI: Record<Donem, string> = {
  dun: "Dün", gecen_hafta: "Geçen hafta", gecen_ay: "Geçen ay", bu_ay: "Bu ay (bugüne kadar)", bu_yil: "Bu yıl (bugüne kadar)", gorunum: "Görünümdeki dönem",
};
export const GUNLER = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

/** "Her Pazartesi 08:00 · Geçen hafta" gibi kısa özet. */
export function zamanlamaOzeti(a: Pick<Abonelik, "siklik" | "gun" | "saat">): string {
  if (a.siklik === "gunluk") return `Her gün ${a.saat}`;
  if (a.siklik === "haftalik") return `Her ${GUNLER[(a.gun ?? 1) - 1]} ${a.saat}`;
  return `Her ayın ${a.gun}. günü ${a.saat}`;
}

export function AbonelikPenceresi({
  raporKod, gorunumler, donemli, kayit, varsayilanGorunumId, onKapat, onKaydedildi,
}: {
  raporKod: string;
  gorunumler: { id: string; ad: string }[];
  /** Raporda başlangıç–bitiş süzgeci var mı; yoksa dönem sorulmaz. */
  donemli: boolean;
  kayit?: Abonelik;
  varsayilanGorunumId?: string;
  onKapat: () => void;
  onKaydedildi: (mesaj: string) => void;
}) {
  const [gorunumId, setGorunumId] = useState(kayit?.gorunumId ?? varsayilanGorunumId ?? gorunumler[0]?.id ?? "");
  const [siklik, setSiklik] = useState<Siklik>(kayit?.siklik ?? "haftalik");
  const [gun, setGun] = useState<number>(kayit?.gun ?? 1);
  const [saat, setSaat] = useState(kayit?.saat ?? "08:00");
  const [donem, setDonem] = useState<Donem>(kayit?.donem ?? (donemli ? "gecen_hafta" : "gorunum"));
  const [bicim, setBicim] = useState<Bicim>(kayit?.bicim ?? "excel");
  const [bosGonder, setBosGonder] = useState(kayit?.bosGonder ?? false);
  const [alicilar, setAlicilar] = useState<string[]>(kayit?.aliciIdler ?? []);
  const [adaylar, setAdaylar] = useState<AliciAdayi[]>([]);
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    void api<AliciAdayi[]>(`/rapor-abonelikleri/alici-adaylari?rapor=${encodeURIComponent(raporKod)}`)
      .then((liste) => {
        setAdaylar(liste);
        // Yeni abonelikte varsayılan alıcı kurandır (listedeyse).
        if (!kayit) void api<{ userId: string }>("/auth/ben").then((b) => { if (liste.some((k) => k.id === b.userId)) setAlicilar((a) => (a.length ? a : [b.userId])); }).catch(() => undefined);
      })
      .catch(() => setAdaylar([]));
  }, [raporKod, kayit]);

  // Sıklık değişince gün kendi aralığında kalsın.
  useEffect(() => { if (siklik === "haftalik" && gun > 7) setGun(1); }, [siklik, gun]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    if (!gorunumId) { setHata("Önce bir görünüm seçin"); return; }
    if (!alicilar.length) { setHata("En az bir alıcı seçin"); return; }
    setIsleniyor(true);
    try {
      const govde = JSON.stringify({ gorunumId, siklik, gun: siklik === "gunluk" ? null : gun, saat, donem, bicim, bosGonder, aliciIdler: alicilar });
      await api(kayit ? `/rapor-abonelikleri/${kayit.id}` : "/rapor-abonelikleri", { method: kayit ? "PUT" : "POST", body: govde });
      onKaydedildi(kayit ? "Zamanlanmış rapor güncellendi." : "Zamanlanmış rapor kuruldu.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kaydedilemedi");
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <Modal
      baslik={kayit ? "Zamanlanmış raporu düzenle" : "E-postayla düzenli gönder"}
      aciklama="Kayıtlı görünüm seçtiğiniz sıklıkta çalıştırılır ve Excel/PDF eki olarak seçilen firma kullanıcılarına gönderilir. Saatler Türkiye saatidir."
      onKapat={onKapat}
    >
      <form onSubmit={kaydet} className="stack">
        <Alert tone="error">{hata}</Alert>
        {!gorunumler.length ? (
          <Alert tone="warning">Bu rapor için kayıtlı görünüm yok. Önce filtreleri seçip Görünümler menüsünden “Bu filtreleri kaydet” deyin.</Alert>
        ) : (
          <Field label="Görünüm">
            <Select value={gorunumId} onChange={(e) => setGorunumId(e.target.value)}>
              {gorunumler.map((g) => <option key={g.id} value={g.id}>{g.ad}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Sıklık">
          <Segmented<Siklik> items={[{ deger: "gunluk", baslik: "Günlük" }, { deger: "haftalik", baslik: "Haftalık" }, { deger: "aylik", baslik: "Aylık" }]} value={siklik} onChange={setSiklik} />
        </Field>
        <div className="row-tight" style={{ alignItems: "flex-end" }}>
          {siklik === "haftalik" && (
            <Field label="Gün">
              <Select value={gun} onChange={(e) => setGun(Number(e.target.value))}>
                {GUNLER.map((g, i) => <option key={g} value={i + 1}>{g}</option>)}
              </Select>
            </Field>
          )}
          {siklik === "aylik" && (
            <Field label="Ayın günü">
              <Select value={gun} onChange={(e) => setGun(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Saat"><Input type="time" required value={saat} onChange={(e) => setSaat(e.target.value)} /></Field>
        </div>
        {donemli && (
          <Field label="Dönem">
            <Select value={donem} onChange={(e) => setDonem(e.target.value as Donem)}>
              {(Object.keys(DONEM_ADLARI) as Donem[]).map((d) => <option key={d} value={d}>{DONEM_ADLARI[d]}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Ek">
          <Segmented<Bicim> items={[{ deger: "excel", baslik: "Excel" }, { deger: "pdf", baslik: "PDF" }, { deger: "ikisi", baslik: "İkisi" }]} value={bicim} onChange={setBicim} />
        </Field>
        <Field label="Alıcılar (raporu görebilen firma kullanıcıları)">
          {/* KLN-20: hazır ya da özel role göre toplu ekleme. */}
          {rolGruplari(adaylar).length > 1 && (
            <Select aria-label="Role göre ekle" value="" onChange={(e) => { const ids = adaylar.filter((k) => rolAnahtari(k) === e.target.value).map((k) => k.id); setAlicilar((a) => [...new Set([...a, ...ids])]); }}>
              <option value="">Role göre ekle…</option>
              {rolGruplari(adaylar).map((g) => <option key={g.anahtar} value={g.anahtar}>{g.ad} ({g.sayi})</option>)}
            </Select>
          )}
          <div className="stack" style={{ gap: "0.3rem", maxHeight: 180, overflowY: "auto" }}>
            {!adaylar.length && <span className="muted">Uygun kullanıcı bulunamadı.</span>}
            {adaylar.map((k) => (
              <label key={k.id} className="rapor-onay">
                <input type="checkbox" checked={alicilar.includes(k.id)} onChange={(e) => setAlicilar((a) => (e.target.checked ? [...a, k.id] : a.filter((x) => x !== k.id)))} />
                <span>{k.adSoyad} <small className="muted">{k.eposta}</small></span>
              </label>
            ))}
          </div>
        </Field>
        <label className="rapor-onay">
          <input type="checkbox" checked={bosGonder} onChange={(e) => setBosGonder(e.target.checked)} />
          <span>Sonuç boşsa da gönder</span>
        </label>
        <ModalEylem onVazgec={onKapat} isleniyor={isleniyor} metin={kayit ? "Kaydet" : "Kur"} />
      </form>
    </Modal>
  );
}
