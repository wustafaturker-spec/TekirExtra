"use client";

/**
 * ARC-01/04/10: araç listesi, yaklaşan yükümlülük ve bakımlar, dönem maliyet
 * raporu (kategori kırılımı, km başı, tüketim, binek KKEG) ve Excel.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Para, TableWrap, Tarih } from "@/components/ui";
import { KATEGORILER, kalanMetni, MULKIYETLER, TURLER, YUKUMLULUKLER, type AracOzeti, type Kategori } from "./ortak";

interface Yaklasan { aracId: string; plaka: string; tur: string; ad: string; tarih: string | null; kalanGun: number | null; kalanKm?: number | null; durum: "doldu" | "7" | "30" | "gecikti" | "yaklasiyor" }
interface RaporSatiri {
  id: string; plaka: string; marka: string | null; model: string | null; kategoriler: Record<Kategori, number>; toplam: number; yol: number | null; kmBasi: number | null; tuketim: number | null; litre: number;
  kkeg: { kiraDisiKkeg: number; kiraKkeg: number; toplamKkeg: number; sinirEksikYillar: number[] } | null; ceza: number; cezaSayisi: number;
}
interface Rapor { baslangic: string; bitis: string; binekGiderOrani: number | null; satirlar: RaporSatiri[]; toplam: number; toplamKkeg: number }

export default function AraclarSayfasi() {
  const router = useRouter();
  const yil = bugunTR().slice(0, 4);
  const [araclar, setAraclar] = useState<AracOzeti[]>([]);
  const [yaklasanlar, setYaklasanlar] = useState<Yaklasan[]>([]);
  const [donem, setDonem] = useState({ baslangic: `${yil}-01-01`, bitis: bugunTR() });
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [tumu, setTumu] = useState(false);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try {
      const [a, y] = await Promise.all([api<AracOzeti[]>(`/arac-takip${tumu ? "?tumu=1" : ""}`), api<Yaklasan[]>("/arac-takip/yaklasanlar")]);
      setAraclar(a); setYaklasanlar(y);
    } catch (e) { setHata(e instanceof Error ? e.message : "Araçlar yüklenemedi"); }
  }, [tumu]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);
  const raporAl = useCallback(async () => {
    try { setRapor(await api<Rapor>(`/arac-takip/rapor?baslangic=${donem.baslangic}&bitis=${donem.bitis}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Rapor alınamadı"); }
  }, [donem]);
  useEffect(() => { if (tokenAl()) void raporAl(); }, [raporAl]);

  const kategoriler = rapor ? (Object.keys(KATEGORILER) as Kategori[]).filter((k) => rapor.satirlar.some((s) => s.kategoriler[k] > 0)) : [];
  return (
    <div className="arac-page">
      <PageHeader
        title="Araçlar"
        subtitle="Muayene, sigorta, kasko ve MTV takibi; bakım planı, km, yakıt tüketimi, araç başına maliyet ve binek oto gider kısıtı (GVK 40/5). Yeni plaka Ayarlar → Araçlar'dan eklenir."
        actions={<><ButtonLabel as="a" href="/panel/ayarlar/araclar">Plaka ekle</ButtonLabel><ButtonLabel as="a" href="/panel/demirbas">Demirbaşlar</ButtonLabel></>}
      />
      {hata && <Alert tone="error">{hata}</Alert>}

      {yaklasanlar.length > 0 && (
        <Card title="Yaklaşan ve geçen yükümlülükler">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Plaka</th><th>Konu</th><th>Tarih</th><th>Durum</th></tr></thead>
              <tbody>{yaklasanlar.map((y) => (
                <tr key={`${y.aracId}-${y.tur}`} className="tiklanir" onClick={() => router.push(`/panel/araclar/${y.aracId}`)}>
                  <td>{y.plaka}</td><td>{y.ad}</td>
                  <td>{y.tarih ? <Tarih deger={y.tarih} /> : "—"}{y.kalanKm != null ? ` · ${y.kalanKm.toLocaleString("tr-TR")} km kaldı` : ""}</td>
                  <td>{y.durum === "doldu" || y.durum === "gecikti" ? <Badge variant="danger">{y.durum === "doldu" ? "Süresi doldu" : "Gecikti"}</Badge> : <Badge variant="warning">{kalanMetni(y.kalanGun) || "yaklaşıyor"}</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <Card title="Araçlar" actions={<label className="row-tight"><input type="checkbox" checked={tumu} onChange={(e) => setTumu(e.target.checked)} /> Pasifleri de göster</label>}>
        <TableWrap>
          <table className="table">
            <thead><tr><th>Plaka</th><th>Araç</th><th>Tür</th><th>Mülkiyet</th><th className="num">Km</th><th>Sorumlu</th><th>En yakın yükümlülük</th><th>Bakım</th></tr></thead>
            <tbody>
              {araclar.length === 0 && <tr><td colSpan={8} className="muted">Kayıtlı araç yok. Ayarlar → Araçlar'dan plaka ekleyin.</td></tr>}
              {araclar.map((a) => (
                <tr key={a.id} className="tiklanir" onClick={() => router.push(`/panel/araclar/${a.id}`)}>
                  <td><a href={`/panel/araclar/${a.id}`}>{a.plaka}</a>{!a.aktif && <> <Badge variant="neutral">pasif</Badge></>}</td>
                  <td>{[a.marka, a.model, a.modelYili].filter(Boolean).join(" ") || "—"}</td>
                  <td>{a.tur ? TURLER[a.tur] : "—"}</td>
                  <td>{a.mulkiyet ? MULKIYETLER[a.mulkiyet] : "—"}</td>
                  <td className="num">{a.km != null ? a.km.toLocaleString("tr-TR") : "—"}</td>
                  <td>{a.sorumlu ?? "—"}</td>
                  <td>{a.enYakinYukumluluk ? <>{YUKUMLULUKLER[a.enYakinYukumluluk.tur]} · <Tarih deger={a.enYakinYukumluluk.bitis} />{a.enYakinYukumluluk.esik && <> <Badge variant={a.enYakinYukumluluk.esik === "doldu" ? "danger" : "warning"}>{kalanMetni(a.enYakinYukumluluk.kalanGun)}</Badge></>}</> : "—"}</td>
                  <td>{a.bakim ? (a.bakim.gecikti ? <Badge variant="danger">gecikti</Badge> : a.bakim.yaklasiyor ? <Badge variant="warning">yaklaşıyor</Badge> : <span className="muted">{a.bakim.tarih ? <Tarih deger={a.bakim.tarih} /> : `${a.bakim.km?.toLocaleString("tr-TR")} km`}</span>) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card title="Araç maliyeti" actions={<Button size="sm" onClick={() => void apiDosyaIndir(`/arac-takip/rapor/excel?baslangic=${donem.baslangic}&bitis=${donem.bitis}`, `arac-maliyeti-${donem.baslangic}-${donem.bitis}.xlsx`).catch((e) => setHata(e instanceof Error ? e.message : "İndirilemedi"))}>Excel</Button>}>
        <div className="row-tight arac__suzgec">
          <Field label="Başlangıç"><Input type="date" value={donem.baslangic} onChange={(e) => setDonem({ ...donem, baslangic: e.target.value })} /></Field>
          <Field label="Bitiş"><Input type="date" value={donem.bitis} onChange={(e) => setDonem({ ...donem, bitis: e.target.value })} /></Field>
        </div>
        {rapor && (
          <>
            <TableWrap>
              <table className="table">
                <thead><tr><th>Plaka</th>{kategoriler.map((k) => <th key={k} className="num">{KATEGORILER[k]}</th>)}<th className="num">Toplam</th><th className="num">Yol (km)</th><th className="num">Km başı</th><th className="num">L/100 km</th><th className="num">Binek KKEG</th></tr></thead>
                <tbody>
                  {rapor.satirlar.length === 0 && <tr><td colSpan={kategoriler.length + 6} className="muted">Dönemde araca bağlı gider yok. Araç kartından gider bağlayın.</td></tr>}
                  {rapor.satirlar.map((s) => (
                    <tr key={s.id}>
                      <td><a href={`/panel/araclar/${s.id}`}>{s.plaka}</a></td>
                      {kategoriler.map((k) => <td key={k} className="num">{s.kategoriler[k] ? <Para deger={s.kategoriler[k]} /> : "—"}</td>)}
                      <td className="num"><strong><Para deger={s.toplam} /></strong></td>
                      <td className="num">{s.yol != null ? s.yol.toLocaleString("tr-TR") : "—"}</td>
                      <td className="num">{s.kmBasi != null ? <Para deger={s.kmBasi} /> : "—"}</td>
                      <td className="num">{s.tuketim != null ? s.tuketim.toLocaleString("tr-TR") : "—"}</td>
                      <td className="num">{s.kkeg ? <Para deger={s.kkeg.toplamKkeg} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {rapor.satirlar.length > 0 && <tfoot><tr><td>Toplam</td>{kategoriler.map((k) => <td key={k} className="num"><Para deger={rapor.satirlar.reduce((t, s) => t + s.kategoriler[k], 0)} /></td>)}<td className="num"><Para deger={rapor.toplam} /></td><td /><td /><td /><td className="num"><Para deger={rapor.toplamKkeg} /></td></tr></tfoot>}
              </table>
            </TableWrap>
            <p className="muted">Tutarlar KDV hariç TL. Binek KKEG: kira dışı giderlerin %{rapor.binekGiderOrani != null ? 100 - rapor.binekGiderOrani : "—"}'i ve aylık kira sınırını aşan kira (GVK 40/5); muhasebe fişini değiştirmez, beyannamede kanunen kabul edilmeyen gider olarak dikkate alınır.
              {rapor.satirlar.some((s) => s.kkeg?.sinirEksikYillar.length) && " Bazı yıllar için kira sınırı Mevzuat Merkezi'nde yok; o ayların kira KKEG'i hesaplanmadı."}</p>
          </>
        )}
      </Card>
    </div>
  );
}
