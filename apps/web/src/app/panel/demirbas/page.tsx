"use client";

/**
 * DMR-01/11/12: demirbaş listesi. Süzgeçler (durum, sınıf, arama), yeni kart,
 * açılış kayıtlarının Excel'le aktarımı ve Excel raporları.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, apiDosyaIndir, ApiHata, tokenAl } from "@/lib/api";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Badge, Button, ButtonLabel, Field, Input, PageHeader, Para, Select, Stat, StatGrid, TableWrap, Tarih } from "@/components/ui";
import { KartFormu } from "./kart-formu";
import { CIKIS_TURLERI, SINIFLAR, type KartOzeti, type ListeKalemi, type Sinif } from "./ortak";

interface AcilisOnizleme {
  hatalar: Array<{ satirNo: number; mesaj: string }>;
  satirlar: Array<{ satirNo: number; kod: string | null; ad: string; sinif: Sinif; faydaliOmur: number; edinmeTarihi: string; edinmeBedeli: number; acilisBirikmis: number; acilisSonYil: number | null }>;
}

export default function DemirbasSayfasi() {
  const router = useRouter();
  const [kartlar, setKartlar] = useState<KartOzeti[]>([]);
  const [liste, setListe] = useState<ListeKalemi[]>([]);
  const [suzgec, setSuzgec] = useState({ durum: "kullanimda", sinif: "", ara: "" });
  const [panel, setPanel] = useState<null | "yeni" | "acilis">(null);
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);

  const yukle = useCallback(async () => {
    const q = new URLSearchParams({ durum: suzgec.durum, ...(suzgec.sinif ? { sinif: suzgec.sinif } : {}), ...(suzgec.ara.trim() ? { ara: suzgec.ara.trim() } : {}) });
    try { setKartlar(await api<KartOzeti[]>(`/demirbas?${q}`)); }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Demirbaşlar yüklenemedi" }); }
    finally { setYukleniyor(false); }
  }, [suzgec]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);
  useEffect(() => { if (tokenAl()) void api<ListeKalemi[]>("/demirbas/liste-kalemleri").then(setListe).catch(() => undefined); }, []);

  async function indir(tur: "liste" | "zimmet" | "cikis") {
    try {
      const q = new URLSearchParams({ tur, durum: suzgec.durum, ...(suzgec.sinif ? { sinif: suzgec.sinif } : {}) });
      await apiDosyaIndir(`/demirbas/rapor/excel?${q}`, tur === "liste" ? "demirbas-listesi.xlsx" : tur === "zimmet" ? "demirbas-zimmetler.xlsx" : "demirbas-cikislar.xlsx");
    } catch (e) { setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Rapor indirilemedi" }); }
  }

  const toplam = (a: "bedel" | "birikmis" | "netDeger" | "buYil") => kartlar.reduce((t, k) => t + Number(k[a]), 0);
  return (
    <div className="demirbas-page">
      <PageHeader
        title="Demirbaşlar"
        subtitle="Sabit kıymet kartları, amortisman, zimmet ve elden çıkarma. Faturadan açılan kartın satırı muhasebe aktarımında varlık hesabına (252–264) yazılır."
        actions={<>
          <ButtonLabel as="a" href="/panel/demirbas/amortisman">Amortisman</ButtonLabel>
          <Button onClick={() => setPanel("acilis")}>Açılış kayıtları (Excel)</Button>
          <Button variant="primary" onClick={() => setPanel("yeni")}>+ Yeni demirbaş</Button>
        </>}
      />
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}
      <div className="row-tight demirbas__suzgec">
        <Field label="Durum">
          <Select value={suzgec.durum} onChange={(e) => setSuzgec({ ...suzgec, durum: e.target.value })}>
            <option value="kullanimda">Kullanımda</option><option value="elden_cikti">Elden çıkan</option><option value="tumu">Tümü</option>
          </Select>
        </Field>
        <Field label="Sınıf">
          <Select value={suzgec.sinif} onChange={(e) => setSuzgec({ ...suzgec, sinif: e.target.value })}>
            <option value="">Tümü</option>
            {Object.entries(SINIFLAR).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}
          </Select>
        </Field>
        <Field label="Ara"><Input value={suzgec.ara} placeholder="Kod, ad, seri no" onChange={(e) => setSuzgec({ ...suzgec, ara: e.target.value })} /></Field>
        <div className="row-tight demirbas__indir">
          <Button size="sm" onClick={() => void indir("liste")}>Liste (Excel)</Button>
          <Button size="sm" onClick={() => void indir("zimmet")}>Zimmetler</Button>
          <Button size="sm" onClick={() => void indir("cikis")}>Elden çıkanlar</Button>
        </div>
      </div>

      <StatGrid>
        <Stat label="Kart" value={String(kartlar.length)} />
        <Stat label="Bedel" value={<Para deger={toplam("bedel")} />} />
        <Stat label="Birikmiş amortisman" value={<Para deger={toplam("birikmis")} />} />
        <Stat label="Net defter değeri" value={<Para deger={toplam("netDeger")} />} />
      </StatGrid>

      <TableWrap>
        <table className="table">
          <thead><tr><th>Kod</th><th>Ad</th><th>Sınıf</th><th>Edinme</th><th className="num">Bedel</th><th className="num">Birikmiş</th><th className="num">Net değer</th><th className="num">Bu yıl</th><th>Zimmet / konum</th></tr></thead>
          <tbody>
            {!yukleniyor && kartlar.length === 0 && <tr><td colSpan={9} className="muted">Kayıt yok. Alış faturasından, elle ya da açılış kaydıyla kart açın.</td></tr>}
            {kartlar.map((k) => (
              <tr key={k.id} className="tiklanir" onClick={() => router.push(`/panel/demirbas/${k.id}`)}>
                <td><a href={`/panel/demirbas/${k.id}`}>{k.kod}</a></td>
                <td>{k.ad} {k.acilis && <Badge variant="neutral">açılış</Badge>} {k.durum === "elden_cikti" && <Badge variant="warning">{k.cikisTuru ? CIKIS_TURLERI[k.cikisTuru] : "çıktı"}</Badge>}</td>
                <td>{SINIFLAR[k.sinif]}</td>
                <td><Tarih deger={k.edinmeTarihi} /></td>
                <td className="num"><Para deger={k.bedel} /></td>
                <td className="num"><Para deger={k.birikmis} /></td>
                <td className="num"><Para deger={k.netDeger} /></td>
                <td className="num">{k.durum === "kullanimda" ? <Para deger={k.buYil} /> : "—"}</td>
                <td>{[k.zimmetli, k.konum].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
          {kartlar.length > 0 && (
            <tfoot><tr><td colSpan={4}>Toplam</td><td className="num"><Para deger={toplam("bedel")} /></td><td className="num"><Para deger={toplam("birikmis")} /></td><td className="num"><Para deger={toplam("netDeger")} /></td><td className="num"><Para deger={toplam("buYil")} /></td><td /></tr></tfoot>
          )}
        </table>
      </TableWrap>

      {panel === "yeni" && (
        <HizliKayitPaneli baslik="Yeni demirbaş" onKapat={() => setPanel(null)}>
          <KartFormu liste={liste} onKaydedildi={(id) => router.push(`/panel/demirbas/${id}`)} />
        </HizliKayitPaneli>
      )}
      {panel === "acilis" && <AcilisAktarimi onKapat={() => setPanel(null)} onAktarildi={(n) => { setPanel(null); setMesaj({ tur: "success", metin: `${n} açılış kartı aktarıldı.` }); void yukle(); }} />}
    </div>
  );
}

/** DMR-11: şablon indir → doldur → önizle (hatalar) → uygula (hepsi ya da hiçbiri). */
function AcilisAktarimi({ onKapat, onAktarildi }: { onKapat: () => void; onAktarildi: (n: number) => void }) {
  const [dosya, setDosya] = useState<File | null>(null);
  const [onizleme, setOnizleme] = useState<AcilisOnizleme | null>(null);
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const govde = (f: File) => { const d = new FormData(); d.append("file", f); return d; };
  const anahtar = () => ({ "Idempotency-Key": crypto.randomUUID() });

  async function onizle(f: File) {
    setDosya(f); setHata(""); setOnizleme(null); setIsleniyor(true);
    try { setOnizleme(await api<AcilisOnizleme>("/demirbas/acilis/onizle", { method: "POST", body: govde(f), headers: anahtar() })); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Dosya okunamadı"); }
    finally { setIsleniyor(false); }
  }
  async function uygula() {
    if (!dosya) return;
    setIsleniyor(true); setHata("");
    try { onAktarildi((await api<{ aktarilan: number }>("/demirbas/acilis/uygula", { method: "POST", body: govde(dosya), headers: anahtar() })).aktarilan); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Aktarılamadı"); }
    finally { setIsleniyor(false); }
  }

  return (
    <HizliKayitPaneli baslik="Açılış kayıtları (Excel)" onKapat={onKapat}>
      <div className="stack">
        <p className="muted">Sistemden önce alınmış kıymetler bedel, edinme tarihi, ömür ve o güne kadar ayrılmış birikmiş amortismanla girilir. Açılış kartları muhasebe aktarımına girmez; plan birikmişin son yılını izleyen yıldan sürer.</p>
        <Button onClick={() => void apiDosyaIndir("/demirbas/acilis/sablon", "demirbas-acilis-sablonu.xlsx").catch((e) => setHata(e instanceof Error ? e.message : "Şablon indirilemedi"))}>Şablonu indir</Button>
        <Field label="Doldurulmuş dosya (.xlsx)"><Input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onizle(f); }} /></Field>
        {hata && <Alert tone="error">{hata}</Alert>}
        {isleniyor && <p className="muted">İşleniyor…</p>}
        {onizleme && onizleme.hatalar.length > 0 && (
          <Alert tone="error">
            {onizleme.hatalar.length} satırda hata var; düzeltip dosyayı yeniden seçin. Hiçbir kart yazılmaz.
            <ul>{onizleme.hatalar.slice(0, 50).map((h) => <li key={`${h.satirNo}-${h.mesaj}`}>Satır {h.satirNo}: {h.mesaj}</li>)}</ul>
          </Alert>
        )}
        {onizleme && onizleme.satirlar.length > 0 && (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Satır</th><th>Ad</th><th>Sınıf</th><th>Edinme</th><th>Ömür</th><th className="num">Bedel</th><th className="num">Birikmiş</th><th>Son yıl</th></tr></thead>
              <tbody>{onizleme.satirlar.map((s) => <tr key={s.satirNo}><td>{s.satirNo}</td><td>{s.kod ? `${s.kod} · ` : ""}{s.ad}</td><td>{SINIFLAR[s.sinif]}</td><td><Tarih deger={s.edinmeTarihi} /></td><td>{s.faydaliOmur}</td><td className="num"><Para deger={s.edinmeBedeli} /></td><td className="num"><Para deger={s.acilisBirikmis} /></td><td>{s.acilisSonYil ?? "—"}</td></tr>)}</tbody>
            </table>
          </TableWrap>
        )}
        {onizleme && onizleme.hatalar.length === 0 && onizleme.satirlar.length > 0 && (
          <Button variant="primary" disabled={isleniyor} onClick={() => void uygula()}>{onizleme.satirlar.length} kartı aktar</Button>
        )}
      </div>
    </HizliKayitPaneli>
  );
}
