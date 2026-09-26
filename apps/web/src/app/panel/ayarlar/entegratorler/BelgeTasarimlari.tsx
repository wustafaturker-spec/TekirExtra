"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Segmented, Select, Table } from "@/components/ui";
import { FirmaTasarimi } from "./FirmaTasarimi";

type TasarimTuru = "efatura" | "earsiv" | "eirsaliye";

interface BelgeTasarimi { id: string; baslik: string; varsayilan: boolean }
interface TasarimListesi { destekleniyor: boolean; secili: string | null; tasarimlar: BelgeTasarimi[] }

const TUR_ADI: Record<TasarimTuru, string> = { efatura: "e-Fatura", earsiv: "e-Arşiv", eirsaliye: "e-İrsaliye" };

/**
 * EBLG-99: alıcının gördüğü görünüm entegratördeki tasarımdır (XSLT). Buradan
 * listelenir, yüklenir, önizlenir ve belge türü başına hangisinin kullanılacağı
 * seçilir; seçim her gönderimde belgeyle birlikte istenir.
 */
export function BelgeTasarimlari({ baglantiId, turler }: { baglantiId: string; turler: TasarimTuru[] }) {
  const [tur, setTur] = useState<TasarimTuru>(turler[0] ?? "efatura");
  const [liste, setListe] = useState<TasarimListesi | null>(null);
  const [secim, setSecim] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState<string | null>(null);
  const [onizleme, setOnizleme] = useState<{ baslik: string; belgeNo: string; html: string } | null>(null);

  const yukle = useCallback(async () => {
    setHata("");
    setListe(null);
    try {
      const l = await api<TasarimListesi>(`/baglantilar/${baglantiId}/tasarimlar?tur=${tur}`);
      setListe(l);
      setSecim(l.secili ?? "");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Tasarımlar yüklenemedi");
    }
  }, [baglantiId, tur]);

  useEffect(() => { setOnizleme(null); setBasari(""); void yukle(); }, [yukle]);

  async function secimiKaydet() {
    setIslemde("secim"); setHata(""); setBasari("");
    try {
      await api(`/baglantilar/${baglantiId}/tasarim-secimi`, { method: "PATCH", body: JSON.stringify({ [tur]: secim }) });
      setBasari(secim ? `${TUR_ADI[tur]} belgeleri bundan sonra "${secim}" tasarımıyla gönderilecek.` : `${TUR_ADI[tur]} belgelerinde entegratörün varsayılan tasarımı kullanılacak.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Seçim kaydedilemedi");
    } finally { setIslemde(null); }
  }

  async function onizle(t: BelgeTasarimi) {
    setIslemde(`onizle-${t.id}`); setHata(""); setBasari("");
    try {
      const o = await api<{ html: string; belgeNo: string }>(`/baglantilar/${baglantiId}/tasarimlar/onizle`, { method: "POST", body: JSON.stringify({ tur, tasarimId: t.id }) });
      setOnizleme({ baslik: t.baslik, ...o });
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Önizleme alınamadı");
    } finally { setIslemde(null); }
  }

  async function tasarimYukle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const dosya = f.get("dosya");
    if (!(dosya instanceof File) || dosya.size === 0) { setHata("XSLT dosyası seçin"); return; }
    setIslemde("yukle"); setHata(""); setBasari("");
    try {
      const t = await api<BelgeTasarimi>(`/baglantilar/${baglantiId}/tasarimlar`, { method: "POST", body: JSON.stringify({ tur, baslik: f.get("baslik"), xslt: await dosya.text() }) });
      setBasari(`"${t.baslik}" entegratöre yüklendi. Kullanmak için aşağıdan seçip kaydedin.`);
      form.reset();
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Tasarım yüklenemedi");
    } finally { setIslemde(null); }
  }

  const varsayilan = liste?.tasarimlar.find((t) => t.varsayilan);

  return (
    <div style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px dashed var(--border-strong)" }}>
      <div className="between" style={{ alignItems: "center", marginBottom: "0.5rem" }}>
        <h4 className="card__title" style={{ fontSize: "0.95rem", margin: 0 }}>Belge Tasarımları</h4>
        {turler.length > 1 && <Segmented ariaLabel="Belge türü" items={turler.map((t) => ({ deger: t, baslik: TUR_ADI[t] }))} value={tur} onChange={setTur} />}
      </div>
      <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
        Alıcının gördüğü görünüm entegratördeki tasarımdır. Seçtiğiniz tasarım her belgeyle birlikte istenir;
        seçim yoksa entegratör hesabındaki varsayılan tasarım kullanılır.
      </p>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {!liste ? (!hata && <p className="muted" style={{ fontSize: "0.85rem" }}>Tasarımlar yükleniyor…</p>) : !liste.destekleniyor ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>Bu entegratör tasarım yönetimini desteklemiyor; tasarımı entegratörün portalından yönetin.</p>
      ) : (
        <>
          <div className="row-tight" style={{ alignItems: "flex-end", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <Field label={`Kullanılacak ${TUR_ADI[tur]} tasarımı`}>
              <Select value={secim} onChange={(e) => setSecim(e.target.value)} style={{ minWidth: "18rem" }}>
                <option value="">Entegratörün varsayılanı{varsayilan ? ` (şu an: ${varsayilan.baslik})` : ""}</option>
                {liste.tasarimlar.map((t) => <option key={t.id} value={t.baslik}>{t.baslik}</option>)}
              </Select>
            </Field>
            <Button variant="primary" size="sm" onClick={() => void secimiKaydet()} disabled={islemde !== null || secim === (liste.secili ?? "")}>
              {islemde === "secim" ? "Kaydediliyor..." : "Seçimi Kaydet"}
            </Button>
          </div>

          {/* EBLG-101: firmaya özel tasarımı üretip yükler ve seçer. */}
          <FirmaTasarimi baglantiId={baglantiId} tur={tur} onYuklendi={() => void yukle()} />

          {onizleme && (
            <div style={{ margin: "1rem 0" }}>
              <div className="between" style={{ alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem" }}><strong>{onizleme.baslik}</strong> <span className="muted">· son belgeniz {onizleme.belgeNo} ile</span></span>
                <Button size="sm" onClick={() => setOnizleme(null)}>Kapat</Button>
              </div>
              {/* Görünüm entegratörden gelir ve karekodu betikle çizer; ayrı kökende, betiğe izinli ama sayfaya erişimsiz çalışır. */}
              <iframe
                title="Tasarım önizlemesi"
                sandbox="allow-scripts"
                srcDoc={onizleme.html}
                style={{ width: "100%", height: "48rem", border: "1px solid var(--border)", borderRadius: "0.6rem", background: "#fff" }}
              />
            </div>
          )}

            <Table density="compact">
              <thead><tr><th>Tasarım</th><th>Durum</th><th style={{ textAlign: "right" }}>İşlem</th></tr></thead>
              <tbody>
                {liste.tasarimlar.length === 0 && <tr><td colSpan={3} className="muted">Entegratörde bu türde tasarım yok.</td></tr>}
                {liste.tasarimlar.map((t) => (
                  <tr key={t.id}>
                    <td>{t.baslik}</td>
                    <td>
                      <div className="row-tight">
                        {t.baslik === liste.secili && <Badge variant="success">KULLANILAN</Badge>}
                        {t.varsayilan && <Badge variant="neutral">ENTEGRATÖR VARSAYILANI</Badge>}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Button size="sm" onClick={() => void onizle(t)} disabled={islemde !== null}>
                        {islemde === `onizle-${t.id}` ? "Hazırlanıyor..." : "Önizle"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>

          <form onSubmit={(e) => void tasarimYukle(e)} style={{ marginTop: "1rem" }}>
            <div className="row-tight" style={{ alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
              <Field label="Yeni tasarım adı"><Input name="baslik" required minLength={3} maxLength={30} placeholder={`Ör. Firma ${TUR_ADI[tur]}`} /></Field>
              <Field label="XSLT dosyası"><Input name="dosya" type="file" accept=".xslt,.xsl,.xml" required /></Field>
              <Button type="submit" size="sm" disabled={islemde !== null}>{islemde === "yukle" ? "Yükleniyor..." : "Entegratöre Yükle"}</Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
