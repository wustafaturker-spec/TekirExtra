"use client";

/**
 * ARC-01…09: araç kartı. Bilgiler ve mülkiyet bağları, yükümlülükler, gider
 * bağı (plakanın geçtiği kayıtlar önerilir), km ve tüketim, bakım planı, cezalar.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { bugunTR } from "@tekirextra/shared";
import { api, ApiHata, tokenAl } from "@/lib/api";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Badge, Button, ButtonLabel, Card, EylemCubugu, Field, Input, PageHeader, Para, Select, Stat, StatGrid, TableWrap, Tarih } from "@/components/ui";
import { KATEGORILER, kalanMetni, MULKIYETLER, sayi, TURLER, YAKITLAR, YUKUMLULUKLER, type BakimDurumu, type Kategori } from "../ortak";

interface Yukumluluk { id: string; tur: keyof typeof YUKUMLULUKLER; baslangic: string | null; bitis: string; belgeNo: string | null; tutar: string | null; aciklama: string | null; gecerli: boolean; kalanGun: number; esik: "doldu" | "7" | "30" | null }
interface Gider { id: string; kategori: Kategori; tarih: string; tutarTry: string; litre: string | null; km: number | null; kaynak: { tur: "masraf" | "fatura"; id: string; etiket: string; aciklama: string | null } | null }
interface Arac {
  id: string; plaka: string; dorsePlaka: string | null; aciklama: string | null; aktif: boolean;
  marka: string | null; model: string | null; modelYili: number | null; saseNo: string | null; tur: keyof typeof TURLER | null; yakitTuru: keyof typeof YAKITLAR | null; mulkiyet: keyof typeof MULKIYETLER | null;
  demirbasId: string | null; kiraSozlesmeId: string | null; sorumluPersonelId: string | null; binekSinirYok: boolean;
  bakimKmAraligi: number | null; bakimAyAraligi: number | null; sonBakimTarihi: string | null; sonBakimKm: number | null;
  km: number | null; sorumlu: string | null; sorumluKaynak: "zimmet" | "kart";
  demirbas: { id: string; kod: string; ad: string; durum: string } | null; kira: { id: string; baslik: string; matrah: string; dovizCinsi: string } | null;
  bakim: BakimDurumu | null;
  yukumlulukler: Yukumluluk[]; giderler: Gider[];
  kmKayitlari: Array<{ id: string; tarih: string; km: number; kaynak: "elle" | "gider" | "bakim"; gerekce: string | null }>;
  bakimlar: Array<{ id: string; tarih: string; km: number | null; aciklama: string }>;
  cezalar: Array<{ id: string; tarih: string; tutar: string; ihlal: string; yer: string | null; personel: string | null; tahsilNotu: string | null }>;
}
interface Aday { tur: "masraf" | "fatura"; id: string; tarih: string; etiket: string; metin: string; tutarTry: string | null; kategori: Kategori }
type Panel = null | "bilgi" | "yukumluluk" | "gider" | "km" | "bakim" | "ceza";

export default function AracKarti() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Arac | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);
  const yukle = useCallback(async () => {
    try { setA(await api<Arac>(`/arac-takip/${id}`)); }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Araç yüklenemedi" }); }
  }, [id]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);

  async function islem(fn: () => Promise<unknown>, basari: string): Promise<boolean> {
    try { await fn(); setPanel(null); setMesaj({ tur: "success", metin: basari }); await yukle(); return true; }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof ApiHata ? e.message : "İşlem yapılamadı" }); return false; }
  }
  const post = (yol: string, govde?: object) => api(yol, { method: "POST", ...(govde ? { body: JSON.stringify(govde) } : {}) });

  if (!a) return <div>{mesaj ? <Alert tone="error">{mesaj.metin}</Alert> : <p className="muted">Yükleniyor…</p>}</div>;
  const akaryakit = a.giderler.filter((g) => g.kategori === "akaryakit");
  const toplamGider = a.giderler.reduce((t, g) => t + Number(g.tutarTry), 0);
  return (
    <div className="arac-page">
      <PageHeader
        title={`${a.plaka}${a.marka ? ` · ${[a.marka, a.model, a.modelYili].filter(Boolean).join(" ")}` : ""}`}
        subtitle={<>{a.tur ? TURLER[a.tur] : "Tür girilmedi"} · {a.mulkiyet ? MULKIYETLER[a.mulkiyet] : "mülkiyet girilmedi"}{!a.aktif && <> <Badge variant="neutral">pasif</Badge></>}</>}
        actions={<ButtonLabel as="a" href="/panel/araclar">← Araçlar</ButtonLabel>}
      />
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}
      <EylemCubugu etiket="Araç işlemleri">
        <Button onClick={() => setPanel("bilgi")}>Bilgileri düzenle</Button>
        <Button onClick={() => setPanel("yukumluluk")}>Yükümlülük ekle</Button>
        <Button onClick={() => setPanel("gider")}>Gider bağla</Button>
        <Button onClick={() => setPanel("km")}>Km gir</Button>
        <Button onClick={() => setPanel("bakim")}>Bakım gir</Button>
        <Button onClick={() => setPanel("ceza")}>Ceza gir</Button>
      </EylemCubugu>

      <StatGrid>
        <Stat label="Güncel km" value={a.km != null ? a.km.toLocaleString("tr-TR") : "—"} />
        <Stat label="Sorumlu" value={a.sorumlu ?? "—"} hint={a.sorumlu ? (a.sorumluKaynak === "zimmet" ? "demirbaş zimmetinden" : "araç kartından") : undefined} />
        <Stat label="Bağlı giderler" value={<Para deger={toplamGider} />} hint={`${a.giderler.length} kayıt, KDV hariç`} />
        <Stat label="Sıradaki bakım" value={a.bakim ? (a.bakim.tarih ? <Tarih deger={a.bakim.tarih} /> : `${a.bakim.km?.toLocaleString("tr-TR")} km`) : "—"}
          hint={a.bakim ? [a.bakim.km != null && a.bakim.tarih ? `${a.bakim.km.toLocaleString("tr-TR")} km` : null, a.bakim.gecikti ? "gecikti" : a.bakim.yaklasiyor ? "yaklaşıyor" : null].filter(Boolean).join(" · ") || undefined : "plan yok"}
          tone={a.bakim?.gecikti ? "danger" : "default"} />
      </StatGrid>

      <div className="arac__duzen">
        <Card title="Bilgiler">
          <dl className="demirbas__bilgi">
            <dt>Şasi no</dt><dd>{a.saseNo ?? "—"}</dd>
            <dt>Yakıt</dt><dd>{a.yakitTuru ? YAKITLAR[a.yakitTuru] : "—"}</dd>
            {a.demirbas && <><dt>Demirbaş</dt><dd><a href={`/panel/demirbas/${a.demirbas.id}`}>{a.demirbas.kod} {a.demirbas.ad}</a></dd></>}
            {a.kira && <><dt>Kira sözleşmesi</dt><dd><a href="/panel/masraflar/kiralar">{a.kira.baslik}</a> · <Para deger={a.kira.matrah} dovizCinsi={a.kira.dovizCinsi} />/ay</dd></>}
            {a.tur === "binek" && <><dt>Gider kısıtı</dt><dd>{a.binekSinirYok ? "Uygulanmaz (kiralama/işletme faaliyeti)" : "GVK 40/5 uygulanır"}</dd></>}
            <dt>Bakım planı</dt><dd>{[a.bakimKmAraligi && `her ${a.bakimKmAraligi.toLocaleString("tr-TR")} km`, a.bakimAyAraligi && `${a.bakimAyAraligi} ayda bir`].filter(Boolean).join(" ya da ") || "—"}{a.sonBakimTarihi ? <> · son <Tarih deger={a.sonBakimTarihi} />{a.sonBakimKm != null ? ` (${a.sonBakimKm.toLocaleString("tr-TR")} km)` : ""}</> : ""}</dd>
            {a.aciklama && <><dt>Açıklama</dt><dd>{a.aciklama}</dd></>}
          </dl>
        </Card>

        <Card title="Yükümlülükler">
          {a.yukumlulukler.length === 0 ? <p className="muted">Muayene, sigorta, kasko, MTV tarihleri girilmedi.</p> : (
            <TableWrap><table className="table"><thead><tr><th>Konu</th><th>Bitiş</th><th>Belge</th><th className="num">Tutar</th><th /></tr></thead>
              <tbody>{a.yukumlulukler.map((y) => (
                <tr key={y.id} className={y.gecerli ? "" : "muted"}>
                  <td>{YUKUMLULUKLER[y.tur]}{!y.gecerli && " (eski)"}</td>
                  <td><Tarih deger={y.bitis} />{y.gecerli && y.esik && <> <Badge variant={y.esik === "doldu" ? "danger" : "warning"}>{kalanMetni(y.kalanGun)}</Badge></>}</td>
                  <td>{y.belgeNo ?? "—"}</td><td className="num">{y.tutar ? <Para deger={y.tutar} /> : "—"}</td>
                  <td><Button size="sm" onClick={() => { if (confirm("Kayıt silinsin mi?")) void islem(() => post(`/arac-takip/yukumluluk/${y.id}/sil`), "Kayıt silindi."); }}>Sil</Button></td>
                </tr>
              ))}</tbody></table></TableWrap>
          )}
        </Card>

        <Card title="Giderler" className="arac__genis">
          {a.giderler.length === 0 ? <p className="muted">Bağlı gider yok. "Gider bağla" plakanın geçtiği masraf ve fatura satırlarını önerir.</p> : (
            <TableWrap><table className="table"><thead><tr><th>Tarih</th><th>Kategori</th><th>Kaynak</th><th className="num">Tutar (KDV hariç)</th><th className="num">Litre</th><th className="num">Km</th><th /></tr></thead>
              <tbody>{a.giderler.map((g) => (
                <tr key={g.id}>
                  <td><Tarih deger={g.tarih} /></td><td>{KATEGORILER[g.kategori]}</td>
                  <td>{g.kaynak ? <a href={g.kaynak.tur === "masraf" ? "/panel/masraflar" : `/panel/fatura/yeni?ac=${g.kaynak.id}`}>{g.kaynak.etiket}</a> : "—"}{g.kaynak?.aciklama ? <small className="muted"> · {g.kaynak.aciklama}</small> : null}</td>
                  <td className="num"><Para deger={g.tutarTry} /></td><td className="num">{g.litre ?? "—"}</td><td className="num">{g.km?.toLocaleString("tr-TR") ?? "—"}</td>
                  <td><Button size="sm" onClick={() => void islem(() => post(`/arac-takip/gider/${g.id}/coz`), "Gider bağı çözüldü.")}>Çöz</Button></td>
                </tr>
              ))}</tbody></table></TableWrap>
          )}
          {akaryakit.length > 0 && <p className="muted">Akaryakıt: {akaryakit.reduce((t, g) => t + Number(g.litre ?? 0), 0).toLocaleString("tr-TR")} litre. Tüketim km'si girilmiş alımlardan dönem raporunda hesaplanır.</p>}
        </Card>

        <Card title="Km geçmişi">
          {a.kmKayitlari.length === 0 ? <p className="muted">Km girilmedi.</p> : (
            <TableWrap><table className="table"><thead><tr><th>Tarih</th><th className="num">Km</th><th>Kaynak</th><th /></tr></thead>
              <tbody>{a.kmKayitlari.map((k) => (
                <tr key={k.id}><td><Tarih deger={k.tarih} /></td><td className="num">{k.km.toLocaleString("tr-TR")}</td><td>{k.kaynak === "elle" ? "Elle" : k.kaynak === "gider" ? "Gider" : "Bakım"}{k.gerekce ? <small className="muted"> · {k.gerekce}</small> : null}</td>
                  <td>{k.kaynak === "elle" && <Button size="sm" onClick={() => void islem(() => post(`/arac-takip/km/${k.id}/sil`), "Km kaydı silindi.")}>Sil</Button>}</td></tr>
              ))}</tbody></table></TableWrap>
          )}
        </Card>

        <Card title="Bakımlar">
          {a.bakimlar.length === 0 ? <p className="muted">Bakım kaydı yok.</p> : (
            <TableWrap><table className="table"><thead><tr><th>Tarih</th><th className="num">Km</th><th>Açıklama</th><th /></tr></thead>
              <tbody>{a.bakimlar.map((b) => (
                <tr key={b.id}><td><Tarih deger={b.tarih} /></td><td className="num">{b.km?.toLocaleString("tr-TR") ?? "—"}</td><td>{b.aciklama}</td>
                  <td><Button size="sm" onClick={() => { if (confirm("Bakım kaydı silinsin mi? Plan bir önceki bakıma döner.")) void islem(() => post(`/arac-takip/bakim/${b.id}/sil`), "Bakım kaydı silindi."); }}>Sil</Button></td></tr>
              ))}</tbody></table></TableWrap>
          )}
        </Card>

        <Card title="Trafik cezaları">
          {a.cezalar.length === 0 ? <p className="muted">Ceza kaydı yok.</p> : (
            <TableWrap><table className="table"><thead><tr><th>Tarih</th><th>İhlal</th><th>Sürücü</th><th className="num">Tutar</th><th /></tr></thead>
              <tbody>{a.cezalar.map((c) => (
                <tr key={c.id}><td><Tarih deger={c.tarih} /></td><td>{c.ihlal}{c.yer ? <small className="muted"> · {c.yer}</small> : null}{c.tahsilNotu ? <><br /><small className="muted">{c.tahsilNotu}</small></> : null}</td><td>{c.personel ?? "—"}</td><td className="num"><Para deger={c.tutar} /></td>
                  <td><Button size="sm" onClick={() => { if (confirm("Ceza kaydı silinsin mi?")) void islem(() => post(`/arac-takip/ceza/${c.id}/sil`), "Ceza kaydı silindi."); }}>Sil</Button></td></tr>
              ))}</tbody></table></TableWrap>
          )}
        </Card>
      </div>

      {panel === "bilgi" && <BilgiPaneli arac={a} onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => api(`/arac-takip/${a.id}`, { method: "PATCH", body: JSON.stringify(g) }), "Araç bilgileri kaydedildi.")} />}
      {panel === "yukumluluk" && <YukumlulukPaneli onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => post(`/arac-takip/${a.id}/yukumluluk`, g), "Yükümlülük kaydedildi.")} />}
      {panel === "gider" && <GiderPaneli arac={a} onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => post(`/arac-takip/${a.id}/gider`, g), "Gider araca bağlandı.")} />}
      {panel === "km" && <KmPaneli onKapat={() => setPanel(null)} sonKm={a.km} onKaydet={(g) => islem(() => post(`/arac-takip/${a.id}/km`, g), "Km kaydedildi.")} />}
      {panel === "bakim" && <BakimPaneli arac={a} onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => post(`/arac-takip/${a.id}/bakim`, g), "Bakım kaydedildi; plan ilerledi.")} />}
      {panel === "ceza" && <CezaPaneli arac={a} onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => post(`/arac-takip/${a.id}/ceza`, g), "Ceza kaydedildi.")} />}
    </div>
  );
}

const bosaNull = (v: string) => (v.trim() ? v.trim() : null);

function BilgiPaneli({ arac, onKapat, onKaydet }: { arac: Arac; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [f, setF] = useState({
    marka: arac.marka ?? "", model: arac.model ?? "", modelYili: String(arac.modelYili ?? ""), saseNo: arac.saseNo ?? "", tur: arac.tur ?? "", yakitTuru: arac.yakitTuru ?? "",
    mulkiyet: arac.mulkiyet ?? "", demirbasId: arac.demirbasId ?? "", kiraSozlesmeId: arac.kiraSozlesmeId ?? "", sorumluPersonelId: arac.sorumluPersonelId ?? "", binekSinirYok: arac.binekSinirYok,
    bakimKmAraligi: String(arac.bakimKmAraligi ?? ""), bakimAyAraligi: String(arac.bakimAyAraligi ?? ""), sonBakimTarihi: arac.sonBakimTarihi ?? "", sonBakimKm: String(arac.sonBakimKm ?? ""), aciklama: arac.aciklama ?? "", aktif: arac.aktif,
  });
  const [demirbaslar, setDemirbaslar] = useState<Array<{ id: string; kod: string; ad: string }>>([]);
  const [kiralar, setKiralar] = useState<Array<{ id: string; baslik: string }>>([]);
  const [personeller, setPersoneller] = useState<Array<{ id: string; ad: string; soyad: string; durum: string }>>([]);
  useEffect(() => {
    void api<Array<{ id: string; kod: string; ad: string }>>("/demirbas?sinif=tasit").then(setDemirbaslar).catch(() => setDemirbaslar([]));
    void api<Array<{ id: string; baslik: string }>>("/masraflar/kiralar").then(setKiralar).catch(() => setKiralar([]));
    void api<{ kayitlar: Array<{ id: string; ad: string; soyad: string; durum: string }> }>("/personel?adet=200").then((r) => setPersoneller(r.kayitlar.filter((p) => p.durum !== "isten_ayrildi"))).catch(() => setPersoneller([]));
  }, []);
  const n = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <HizliKayitPaneli baslik="Araç bilgileri" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        void onKaydet({
          marka: bosaNull(f.marka), model: bosaNull(f.model), modelYili: n(f.modelYili), saseNo: bosaNull(f.saseNo), tur: f.tur || null, yakitTuru: f.yakitTuru || null,
          mulkiyet: f.mulkiyet || null, demirbasId: f.mulkiyet === "oz" ? f.demirbasId || null : null, kiraSozlesmeId: f.mulkiyet === "kiralik" ? f.kiraSozlesmeId || null : null,
          sorumluPersonelId: f.sorumluPersonelId || null, binekSinirYok: f.binekSinirYok, bakimKmAraligi: n(f.bakimKmAraligi), bakimAyAraligi: n(f.bakimAyAraligi),
          sonBakimTarihi: f.sonBakimTarihi || null, sonBakimKm: n(f.sonBakimKm), aciklama: bosaNull(f.aciklama), aktif: f.aktif,
        });
      }}>
        <div className="form-grid form-grid--2">
          <Field label="Marka"><Input value={f.marka} onChange={(e) => setF({ ...f, marka: e.target.value })} /></Field>
          <Field label="Model"><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
          <Field label="Model yılı"><Input type="number" min={1950} max={2100} value={f.modelYili} onChange={(e) => setF({ ...f, modelYili: e.target.value })} /></Field>
          <Field label="Şasi no"><Input value={f.saseNo} onChange={(e) => setF({ ...f, saseNo: e.target.value })} /></Field>
          <Field label="Tür"><Select value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}><option value="">—</option>{Object.entries(TURLER).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select></Field>
          <Field label="Yakıt"><Select value={f.yakitTuru} onChange={(e) => setF({ ...f, yakitTuru: e.target.value })}><option value="">—</option>{Object.entries(YAKITLAR).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select></Field>
          <Field label="Mülkiyet"><Select value={f.mulkiyet} onChange={(e) => setF({ ...f, mulkiyet: e.target.value })}><option value="">—</option>{Object.entries(MULKIYETLER).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select></Field>
          {f.mulkiyet === "oz" && <Field label="Demirbaş kartı (taşıt)"><Select value={f.demirbasId} onChange={(e) => setF({ ...f, demirbasId: e.target.value })}><option value="">—</option>{demirbaslar.map((d) => <option key={d.id} value={d.id}>{d.kod} · {d.ad}</option>)}</Select></Field>}
          {f.mulkiyet === "kiralik" && <Field label="Kira sözleşmesi"><Select value={f.kiraSozlesmeId} onChange={(e) => setF({ ...f, kiraSozlesmeId: e.target.value })}><option value="">—</option>{kiralar.map((k) => <option key={k.id} value={k.id}>{k.baslik}</option>)}</Select></Field>}
          <Field label={f.demirbasId ? "Sorumlu (demirbaş zimmeti yoksa)" : "Sorumlu personel"}><Select value={f.sorumluPersonelId} onChange={(e) => setF({ ...f, sorumluPersonelId: e.target.value })}><option value="">—</option>{personeller.map((p) => <option key={p.id} value={p.id}>{p.ad} {p.soyad}</option>)}</Select></Field>
          <Field label="Bakım aralığı (km)"><Input type="number" min={100} value={f.bakimKmAraligi} onChange={(e) => setF({ ...f, bakimKmAraligi: e.target.value })} placeholder="ör. 15000" /></Field>
          <Field label="Bakım aralığı (ay)"><Input type="number" min={1} max={120} value={f.bakimAyAraligi} onChange={(e) => setF({ ...f, bakimAyAraligi: e.target.value })} placeholder="ör. 12" /></Field>
          <Field label="Son bakım tarihi"><Input type="date" value={f.sonBakimTarihi} onChange={(e) => setF({ ...f, sonBakimTarihi: e.target.value })} /></Field>
          <Field label="Son bakım km"><Input type="number" min={0} value={f.sonBakimKm} onChange={(e) => setF({ ...f, sonBakimKm: e.target.value })} /></Field>
        </div>
        {f.tur === "binek" && <label className="row-tight"><input type="checkbox" checked={f.binekSinirYok} onChange={(e) => setF({ ...f, binekSinirYok: e.target.checked })} /> Faaliyetimiz binek oto kiralama/işletme — gider kısıtı uygulanmaz</label>}
        <label className="row-tight"><input type="checkbox" checked={f.aktif} onChange={(e) => setF({ ...f, aktif: e.target.checked })} /> Aktif (e-İrsaliyede seçilebilir, uyarılar üretilir)</label>
        <Field label="Açıklama"><Input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
        <Button type="submit" variant="primary">Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function YukumlulukPaneli({ onKapat, onKaydet }: { onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [f, setF] = useState({ tur: "muayene", baslangic: "", bitis: "", belgeNo: "", tutar: "", aciklama: "" });
  return (
    <HizliKayitPaneli baslik="Yükümlülük" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet({ tur: f.tur, baslangic: f.baslangic || null, bitis: f.bitis, belgeNo: bosaNull(f.belgeNo), tutar: f.tutar ? sayi(f.tutar) : null, aciklama: bosaNull(f.aciklama) }); }}>
        <p className="muted">Yenilemede yeni kayıt girin; eski kayıt geçmişte kalır, uyarı yenisine göre çıkar (bitişe 30 ve 7 gün kala).</p>
        <Field label="Konu"><Select value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{Object.entries(YUKUMLULUKLER).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select></Field>
        <div className="form-grid form-grid--2">
          <Field label="Başlangıç"><Input type="date" value={f.baslangic} onChange={(e) => setF({ ...f, baslangic: e.target.value })} /></Field>
          <Field label="Bitiş"><Input type="date" required value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} /></Field>
          <Field label="Belge / poliçe no"><Input value={f.belgeNo} onChange={(e) => setF({ ...f, belgeNo: e.target.value })} /></Field>
          <Field label="Tutar (TL)"><Input inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} /></Field>
        </div>
        <Field label="Açıklama"><Input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
        <Button type="submit" variant="primary" disabled={!f.bitis}>Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function GiderPaneli({ arac, onKapat, onKaydet }: { arac: Arac; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [ara, setAra] = useState("");
  const [adaylar, setAdaylar] = useState<Aday[] | null>(null);
  const [secili, setSecili] = useState<Aday | null>(null);
  const [f, setF] = useState({ kategori: "diger" as Kategori, litre: "", km: "", kmGerekcesi: "" });
  const [hata, setHata] = useState("");
  const getir = useCallback(async (metin: string) => {
    setHata("");
    try { setAdaylar(await api<Aday[]>(`/arac-takip/${arac.id}/gider-adaylari${metin.trim() ? `?ara=${encodeURIComponent(metin.trim())}` : ""}`)); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Kayıtlar getirilemedi"); }
  }, [arac.id]);
  useEffect(() => { void getir(""); }, [getir]);
  const dusukKm = f.km && arac.km != null && Number(f.km) < arac.km;
  return (
    <HizliKayitPaneli baslik="Gider bağla" onKapat={onKapat}>
      <div className="stack">
        <p className="muted">Onaylı masraf ya da kesin alış faturası satırı. Arama boşken plakanın ({arac.plaka}) geçtiği kayıtlar önerilir. Muhasebe değişmez.</p>
        <form className="row-tight" onSubmit={(e) => { e.preventDefault(); void getir(ara); }}>
          <Field label="Ara (açıklama, satıcı, belge/fatura no)"><Input value={ara} onChange={(e) => setAra(e.target.value)} /></Field>
          <Button type="submit">Ara</Button>
        </form>
        {hata && <Alert tone="error">{hata}</Alert>}
        {adaylar && adaylar.length === 0 && <p className="muted">{ara ? "Eşleşen bağlanmamış kayıt yok." : "Plakanın geçtiği bağlanmamış kayıt yok; arama yapın."}</p>}
        <div className="arac__adaylar">
          {adaylar?.map((d) => (
            <label key={`${d.tur}-${d.id}`} className="demirbas__satir">
              <input type="radio" name="aday" checked={secili?.id === d.id} onChange={() => { setSecili(d); setF({ ...f, kategori: d.kategori }); }} />
              <span><Tarih deger={d.tarih} /> · {d.tur === "masraf" ? "Masraf" : "Fatura"} · {d.etiket}{d.tutarTry ? <> · <Para deger={d.tutarTry} /></> : null}<br /><small className="muted">{d.metin}</small></span>
            </label>
          ))}
        </div>
        {secili && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet({ [secili.tur === "masraf" ? "masrafId" : "faturaSatirId"]: secili.id, kategori: f.kategori, litre: f.kategori === "akaryakit" && f.litre ? sayi(f.litre) : null, km: f.km ? Number(f.km) : null, kmGerekcesi: bosaNull(f.kmGerekcesi) }); }}>
            <div className="form-grid form-grid--2">
              <Field label="Kategori"><Select value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value as Kategori })}>{Object.entries(KATEGORILER).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select></Field>
              {f.kategori === "akaryakit" && <Field label="Litre"><Input inputMode="decimal" value={f.litre} onChange={(e) => setF({ ...f, litre: e.target.value })} /></Field>}
              <Field label={`Km (son: ${arac.km?.toLocaleString("tr-TR") ?? "—"})`}><Input type="number" min={0} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></Field>
              {dusukKm && <Field label="Düşük km gerekçesi"><Input required value={f.kmGerekcesi} onChange={(e) => setF({ ...f, kmGerekcesi: e.target.value })} /></Field>}
            </div>
            <Button type="submit" variant="primary">Bağla</Button>
          </form>
        )}
      </div>
    </HizliKayitPaneli>
  );
}

function KmPaneli({ sonKm, onKapat, onKaydet }: { sonKm: number | null; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [f, setF] = useState({ tarih: bugunTR(), km: "", gerekce: "" });
  const dusuk = f.km && sonKm != null && Number(f.km) < sonKm;
  return (
    <HizliKayitPaneli baslik="Km gir" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet({ tarih: f.tarih, km: Number(f.km), gerekce: bosaNull(f.gerekce) }); }}>
        <Field label="Tarih"><Input type="date" required value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></Field>
        <Field label={`Km (son: ${sonKm?.toLocaleString("tr-TR") ?? "—"})`}><Input type="number" required min={0} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></Field>
        {dusuk && <Field label="Düşük km gerekçesi (ör. gösterge değişti)"><Input required value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} /></Field>}
        <Button type="submit" variant="primary" disabled={!f.km}>Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function BakimPaneli({ arac, onKapat, onKaydet }: { arac: Arac; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const bakimGiderleri = arac.giderler.filter((g) => g.kategori === "bakim" || g.kategori === "lastik");
  const [f, setF] = useState({ tarih: bugunTR(), km: "", aciklama: "", aracGiderId: "", kmGerekcesi: "" });
  const dusuk = f.km && arac.km != null && Number(f.km) < arac.km;
  return (
    <HizliKayitPaneli baslik="Bakım gir" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet({ tarih: f.tarih, km: f.km ? Number(f.km) : null, aciklama: f.aciklama, aracGiderId: f.aracGiderId || null, kmGerekcesi: bosaNull(f.kmGerekcesi) }); }}>
        <p className="muted">Bakım planı bu bakımın tarih ve km'sinden ilerler.</p>
        <Field label="Tarih"><Input type="date" required value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></Field>
        <Field label="Km"><Input type="number" min={0} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></Field>
        {dusuk && <Field label="Düşük km gerekçesi"><Input required value={f.kmGerekcesi} onChange={(e) => setF({ ...f, kmGerekcesi: e.target.value })} /></Field>}
        <Field label="Yapılanlar"><Input required value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} placeholder="ör. 30.000 km bakımı, yağ ve filtreler" /></Field>
        {bakimGiderleri.length > 0 && <Field label="Bağlı gider (isteğe bağlı)"><Select value={f.aracGiderId} onChange={(e) => setF({ ...f, aracGiderId: e.target.value })}><option value="">—</option>{bakimGiderleri.map((g) => <option key={g.id} value={g.id}>{g.tarih} · {g.kaynak?.etiket} · {Number(g.tutarTry).toLocaleString("tr-TR")} TL</option>)}</Select></Field>}
        <Button type="submit" variant="primary" disabled={!f.aciklama.trim()}>Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function CezaPaneli({ arac, onKapat, onKaydet }: { arac: Arac; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const cezaGiderleri = arac.giderler.filter((g) => g.kategori === "ceza");
  const [f, setF] = useState({ tarih: bugunTR(), tutar: "", ihlal: "", yer: "", tahsilNotu: "", aracGiderId: "" });
  return (
    <HizliKayitPaneli baslik="Trafik cezası" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet({ tarih: f.tarih, tutar: sayi(f.tutar), ihlal: f.ihlal, yer: bosaNull(f.yer), tahsilNotu: bosaNull(f.tahsilNotu), aracGiderId: f.aracGiderId || null }); }}>
        <p className="muted">Sürücü, ceza tarihindeki sorumlu personel olarak kaydedilir. Personelden tahsil kararı not olarak tutulur; bordro kesintisi elle yapılır.</p>
        <div className="form-grid form-grid--2">
          <Field label="Tarih"><Input type="date" required value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></Field>
          <Field label="Tutar (TL)"><Input inputMode="decimal" required value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} /></Field>
        </div>
        <Field label="İhlal"><Input required value={f.ihlal} onChange={(e) => setF({ ...f, ihlal: e.target.value })} placeholder="ör. hız sınırı aşımı" /></Field>
        <Field label="Yer"><Input value={f.yer} onChange={(e) => setF({ ...f, yer: e.target.value })} /></Field>
        <Field label="Tahsil notu"><Input value={f.tahsilNotu} onChange={(e) => setF({ ...f, tahsilNotu: e.target.value })} placeholder="ör. Ekim bordrosundan kesilecek" /></Field>
        {cezaGiderleri.length > 0 && <Field label="Ödeme masrafı (isteğe bağlı)"><Select value={f.aracGiderId} onChange={(e) => setF({ ...f, aracGiderId: e.target.value })}><option value="">—</option>{cezaGiderleri.map((g) => <option key={g.id} value={g.id}>{g.tarih} · {Number(g.tutarTry).toLocaleString("tr-TR")} TL</option>)}</Select></Field>}
        <Button type="submit" variant="primary" disabled={!f.ihlal.trim() || sayi(f.tutar) <= 0}>Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}
