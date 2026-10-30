"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Select, TableWrap } from "@/components/ui";

interface Secenek { aySayisi: number; matrah: string; kdv: string; toplam: string }
interface Odeme { id: string; createdAt: string; aySayisi: number; tutar: string; matrah: string | null; kdv: string | null; kaynak: "elle" | "saglayici"; saglayici: string | null; yeniDonemSonu: string; fatura?: { durum: string; faturaNo: string | null } | null }
interface Basarisiz { id: string; createdAt: string; aySayisi: number; toplam: string; hataMesaji: string | null; kaynak?: string }
/** PLT-14: kayıtlı kart; kart sağlayıcıda saklanır, burada yalnız son 4 hane. */
interface Kart { saglayici: string; son4: string | null; marka: string | null; otomatikYenileme: boolean; aySayisi: number; gecerli: boolean; sonHata: string | null; sonDeneme: string | null }
interface OdemeDurumu { etkin: boolean; saglayici: string | null; testOrtami: boolean; neden: string | null; donemSonu: string | null; secenekler: Secenek[]; kart: Kart | null; odemeler: Odeme[]; basarisizDenemeler: Basarisiz[] }

const tl = (s: string | number) => Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tarih = (s: string | null) => (s ? new Date(s).toLocaleDateString("tr-TR") : "—");

/**
 * PLT-13: "Şimdi öde". Ödeme sağlayıcının sayfasında yapılır; dönüşte dönem
 * uzamış olarak bu sayfaya gelinir. Askıdaki firmada da açıktır.
 * PLT-14: isteğe bağlı kart kaydı ve otomatik yenileme.
 */
export function OdemeKarti() {
  const [durum, setDurum] = useState<OdemeDurumu | null>(null);
  const [ay, setAy] = useState(1);
  const [kartKaydet, setKartKaydet] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => {
    const y = await api<OdemeDurumu>("/abonelik/odeme");
    // Eksik yanıtta (ör. eski API) kart çökmesin.
    const d = { ...y, secenekler: Array.isArray(y?.secenekler) ? y.secenekler : [], odemeler: Array.isArray(y?.odemeler) ? y.odemeler : [], basarisizDenemeler: Array.isArray(y?.basarisizDenemeler) ? y.basarisizDenemeler : [], kart: y?.kart ?? null };
    setDurum(d);
    return d;
  }, []);

  useEffect(() => {
    yukle().then((d) => { if (d.secenekler[0]) setAy(d.kart?.aySayisi ?? d.secenekler[0].aySayisi); }).catch((e) => setHata(e instanceof Error ? e.message : "Ödeme bilgileri yüklenemedi"));
  }, [yukle]);

  async function ode() {
    setIslem(true);
    setHata("");
    try {
      const s = await api<{ odemeSayfasiUrl: string }>("/abonelik/odeme", { method: "POST", body: JSON.stringify({ aySayisi: ay, kartKaydet }) });
      window.location.assign(s.odemeSayfasiUrl);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Ödeme başlatılamadı");
      setIslem(false);
    }
  }

  async function kartIslemi(yol: string, istek: RequestInit, onay?: string) {
    if (onay && !confirm(onay)) return;
    setIslem(true);
    setHata("");
    try {
      setBasari((await api<{ mesaj: string }>(yol, istek)).mesaj);
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı");
    } finally {
      setIslem(false);
    }
  }

  /** PLT-23: kesinleşmiş abonelik faturası (faturalayan firmanın belgesi). */
  async function faturaIndir(o: Odeme) {
    setHata("");
    try {
      await apiDosyaIndir(`/abonelik/odeme/${o.id}/fatura.pdf`, `${o.fatura?.faturaNo ?? "abonelik-faturasi"}.pdf`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Fatura indirilemedi");
    }
  }

  if (!durum) return hata ? <Alert tone="error">{hata}</Alert> : null;
  const secili = durum.secenekler.find((s) => s.aySayisi === ay);
  const kart = durum.kart;
  const sonBasarisiz = durum.basarisizDenemeler[0];

  return (
    <Card title="Ödeme">
      <div className="stack">
        <Alert tone="error">{hata}</Alert>
        {basari && <Alert tone="success">{basari}</Alert>}
        {durum.etkin && secili ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Dönem sonu {tarih(durum.donemSonu)}. Seçtiğiniz süre bu tarihe eklenir. Kart bilgileriniz doğrudan {durum.saglayici}&apos;ya gönderilir, TekirExtra&apos;ya gelmez.{durum.testOrtami && <> <Badge variant="warning">Test ortamı</Badge></>}</p>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ minWidth: 160 }}><Field label="Süre"><Select value={ay} onChange={(e) => setAy(Number(e.target.value))}>{durum.secenekler.map((s) => <option key={s.aySayisi} value={s.aySayisi}>{s.aySayisi} ay</option>)}</Select></Field></div>
              <div className="subtle" style={{ lineHeight: 1.5 }}>Tutar {tl(secili.matrah)} TL + KDV %20 {tl(secili.kdv)} TL<br /><strong style={{ color: "var(--text)" }}>Toplam {tl(secili.toplam)} TL</strong></div>
              <Button variant="primary" disabled={islem} onClick={() => void ode()}>{islem ? "Ödeme sayfası açılıyor…" : "Şimdi öde"}</Button>
            </div>
            {!(kart?.gecerli && kart.otomatikYenileme) && (
              <label className="row-tight" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={kartKaydet} onChange={(e) => setKartKaydet(e.target.checked)} />
                <span>Kartımı {durum.saglayici}&apos;da kaydet, aboneliği her dönem sonundan 3 gün önce otomatik yenile</span>
              </label>
            )}
          </>
        ) : durum.neden ? <p className="muted" style={{ margin: 0 }}>{durum.neden}</p> : null}
        {kart && (
          <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div className="row-tight">
              <strong>Kayıtlı kart</strong>
              <span>{kart.marka ? `${kart.marka} ` : ""}{kart.son4 ? `**** ${kart.son4}` : ""} · {kart.saglayici}</span>
              {kart.otomatikYenileme && kart.gecerli ? <Badge variant="success">Otomatik yenileme açık · {kart.aySayisi} ay</Badge> : <Badge variant="neutral">Otomatik yenileme kapalı</Badge>}
            </div>
            {!kart.gecerli && <Alert tone="warning">Bu kart artık kullanılmayan bir ödeme kuruluşuna ait; otomatik yenileme çalışmaz. Kartınızı kaydederek yeniden ödeyin.</Alert>}
            {kart.sonHata && kart.otomatikYenileme && <Alert tone="warning">Son otomatik çekim yapılamadı{kart.sonDeneme ? ` (${new Date(kart.sonDeneme).toLocaleString("tr-TR")})` : ""}: {kart.sonHata}</Alert>}
            <div className="row-tight">
              {kart.gecerli && (kart.otomatikYenileme
                ? <Button size="sm" disabled={islem} onClick={() => void kartIslemi("/abonelik/odeme/otomatik-yenileme", { method: "PUT", body: JSON.stringify({ acik: false }) })}>Otomatik yenilemeyi kapat</Button>
                : <Button size="sm" variant="primary" disabled={islem} onClick={() => void kartIslemi("/abonelik/odeme/otomatik-yenileme", { method: "PUT", body: JSON.stringify({ acik: true, aySayisi: ay }) })}>Otomatik yenilemeyi aç ({ay} ay)</Button>)}
              {kart.gecerli && kart.otomatikYenileme && ay !== kart.aySayisi && <Button size="sm" disabled={islem} onClick={() => void kartIslemi("/abonelik/odeme/otomatik-yenileme", { method: "PUT", body: JSON.stringify({ acik: true, aySayisi: ay }) })}>Yenileme süresini {ay} ay yap</Button>}
              <Button size="sm" variant="danger" disabled={islem} onClick={() => void kartIslemi("/abonelik/odeme/kart", { method: "DELETE" }, "Kayıtlı kart silinsin ve otomatik yenileme kapansın mı?")}>Kartı kaldır</Button>
            </div>
          </div>
        )}
        {sonBasarisiz && new Date(sonBasarisiz.createdAt) > new Date(durum.odemeler[0]?.createdAt ?? 0) && !(kart?.sonHata && sonBasarisiz.kaynak === "otomatik") && (
          <Alert tone="warning">Son ödeme denemesi tamamlanmadı ({new Date(sonBasarisiz.createdAt).toLocaleString("tr-TR")}). Yeniden deneyebilirsiniz.</Alert>
        )}
        {durum.odemeler.length > 0 && (
          <TableWrap>
            <thead><tr><th>Tarih</th><th>Süre</th><th className="num">Toplam</th><th>Yöntem</th><th>Yeni dönem sonu</th><th>Fatura</th></tr></thead>
            <tbody>{durum.odemeler.map((o) => (
              <tr key={o.id}><td>{new Date(o.createdAt).toLocaleDateString("tr-TR")}</td><td>{o.aySayisi} ay</td><td className="num">{tl(o.tutar)} TL</td><td>{o.kaynak === "saglayici" ? `Kart (${o.saglayici === "paytr" ? "PayTR" : "iyzico"})` : "Havale / elle"}</td><td>{tarih(o.yeniDonemSonu)}</td>
                <td>{o.fatura && (o.fatura.durum === "kesinlesti" || o.fatura.durum === "tahsil_edildi")
                  ? <Button size="sm" disabled={islem} onClick={() => void faturaIndir(o)}>{o.fatura.faturaNo ?? "Fatura"} PDF</Button>
                  : <span className="subtle">{o.fatura ? "Hazırlanıyor" : "—"}</span>}</td></tr>
            ))}</tbody>
          </TableWrap>
        )}
      </div>
    </Card>
  );
}
