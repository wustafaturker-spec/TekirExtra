"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, PageHeader, Segmented, TableWrap } from "@/components/ui";
import { RiskRozeti, TahsilatOncelikleriKart, type TahsilatOnceligi } from "@/components/tahsilat-riski";

type Kademe = "hatirlatma" | "ihtar";

interface Aday {
  cariId: string;
  kod: string;
  unvan: string;
  eposta: string | null;
  karaListe: boolean;
  aktif: boolean;
  faturaSayisi: number;
  dovizler: { dovizCinsi: string; tutar: string }[];
  toplamTry: string;
  enEskiVade: string | null;
  enUzunGecikme: number;
  sonHatirlatma: string | null;
  siklikEngeli: boolean;
  itirazEngeli?: boolean;
  /** KSB-23: faturaya bağlanmamış tahsilat (TL); vadesi geçmiş fatura bununla ödenmiş olabilir. */
  baglanmamisTahsilatTry?: string | null;
  gonderimEngeli?: string | null;
}
interface Sonuc { cariId: string; kod: string; unvan: string; durum: "gonderildi" | "atlandi" | "hata"; mesaj: string }
interface Onizleme { alici: string | null; konu: string; html: string }

const para = (tutar: string | number, doviz = "TRY") =>
  `${Number(tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;
const tarih = (t: string) => new Date(t).toLocaleDateString("tr-TR");

/**
 * CARI-38: vadesi geçmiş alacağı olan carilere toplu hatırlatma / ihtar
 * e-postası. Seçilenler önizlenip gönderilir; her gönderim CRM'e yazılır.
 * Son 7 günde hatırlatma almış cari varsayılan olarak seçilmez ve sunucuda
 * da atlanır; kullanıcı bilerek geçebilir.
 */
export default function VadeHatirlatmaSayfasi() {
  const [adaylar, setAdaylar] = useState<Aday[] | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [kademe, setKademe] = useState<Kademe>("hatirlatma");
  const [not, setNot] = useState("");
  const [siklikSiniriniAs, setSiklikSiniriniAs] = useState(false);
  const [baglanmamisOnayi, setBaglanmamisOnayi] = useState(false);
  const [smsDeGonder, setSmsDeGonder] = useState(false);
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [sonuclar, setSonuclar] = useState<Sonuc[] | null>(null);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);
  const [oncelikler, setOncelikler] = useState<TahsilatOnceligi[] | null>(null);
  const [notYaziliyor, setNotYaziliyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      const liste = await api<Aday[]>("/cari/vade-hatirlatma/adaylar");
      setAdaylar(liste);
      setSecili(new Set(liste.filter((a) => a.eposta && !a.siklikEngeli && !a.itirazEngeli && !a.baglanmamisTahsilatTry).map((a) => a.cariId)));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Liste yüklenemedi");
    }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);
  // AI-17/18: risk ve öncelik; yüklenemezse ekranın geri kalanı etkilenmez.
  useEffect(() => { api<TahsilatOnceligi[]>("/cari/vade-hatirlatma/oncelikler?adet=500").then(setOncelikler).catch(() => setOncelikler([])); }, []);
  const riskler = useMemo(() => new Map((oncelikler ?? []).map((o) => [o.cariId, o.risk])), [oncelikler]);

  const secilebilir = useMemo(() => (adaylar ?? []).filter((a) => a.eposta && !a.itirazEngeli), [adaylar]);
  const seciliAdaylar = useMemo(() => (adaylar ?? []).filter((a) => secili.has(a.cariId) && !a.itirazEngeli), [adaylar, secili]);
  const seciliToplam = seciliAdaylar.reduce((t, a) => t + Number(a.toplamTry), 0);

  function degistir(id: string) {
    setSecili((eski) => { const yeni = new Set(eski); if (yeni.has(id)) yeni.delete(id); else yeni.add(id); return yeni; });
  }

  async function onizle(cariId: string) {
    setHata("");
    try {
      setOnizleme(await api<Onizleme>("/cari/vade-hatirlatma/onizle", { method: "POST", body: JSON.stringify({ cariId, kademe, not: not || null }) }));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Önizleme alınamadı");
    }
  }

  async function gonder() {
    if (!seciliAdaylar.length) return;
    const ad = kademe === "ihtar" ? "ödeme ihtarı" : "vade hatırlatması";
    if (!window.confirm(`${seciliAdaylar.length} cariye ${ad} gönderilecek (toplam ${para(seciliToplam)}). Devam edilsin mi?`)) return;
    setIslemde(true); setHata(""); setSonuclar(null);
    try {
      const sonuc = await api<Sonuc[]>("/cari/vade-hatirlatma/gonder", {
        method: "POST",
        body: JSON.stringify({ cariIdler: seciliAdaylar.map((a) => a.cariId), kademe, not: not || null, siklikSiniriniAs, baglanmamisOnayi, smsDeGonder }),
      });
      setSonuclar(sonuc);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Gönderim başarısız");
    } finally {
      setIslemde(false);
    }
  }

  /** AI-20: tek cari seçiliyse kişisel, çoksa genel bir not taslağı; kullanıcı düzenler. */
  async function notYazdir() {
    if (!seciliAdaylar.length) return;
    setNotYaziliyor(true); setHata("");
    try {
      const y = await api<{ not: string }>("/cari/vade-hatirlatma/ai-not", { method: "POST", body: JSON.stringify({ cariIdler: seciliAdaylar.map((a) => a.cariId), kademe }) });
      setNot(y.not);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Not yazılamadı");
    } finally {
      setNotYaziliyor(false);
    }
  }

  const gonderilen = sonuclar?.filter((s) => s.durum === "gonderildi").length ?? 0;

  return (
    <div>
      <PageHeader
        title="⏰ Vade Hatırlatma"
        subtitle="Vadesi geçmiş alacağı olan carilere hatırlatma ya da ihtar e-postası; şablonlar Ayarlar > Modüller > Cari'de."
        actions={<ButtonLabel as="a" href="/panel/cari">← Cari Hesaplar</ButtonLabel>}
      />
      <Alert tone="error">{hata}</Alert>
      {sonuclar && (
        <Alert tone={sonuclar.some((s) => s.durum === "hata") ? "warning" : "success"}>
          {gonderilen} cariye gönderildi{sonuclar.length > gonderilen ? `, ${sonuclar.length - gonderilen} cari gönderilmedi` : ""}.
          {sonuclar.filter((s) => s.durum !== "gonderildi").map((s) => <div key={s.cariId}>• {s.kod} {s.unvan}: {s.mesaj}</div>)}
        </Alert>
      )}

      <TahsilatOncelikleriKart liste={oncelikler} />

      <Card>
        <div className="vade-hatirlatma__ayar">
          <Field label="Kademe">
            <Segmented<Kademe> value={kademe} onChange={setKademe} items={[{ deger: "hatirlatma", baslik: "Hatırlatma" }, { deger: "ihtar", baslik: "İhtar" }]} />
          </Field>
          <Field label="Ek not (isteğe bağlı, tablodan sonra eklenir)">
            <textarea className="textarea" rows={2} maxLength={1000} value={not} onChange={(e) => setNot(e.target.value)} placeholder="Örn. Banka hesap bilgilerimiz değişmiştir…" />
          </Field>
          <div className="row-tight">
            <Button size="sm" disabled={!seciliAdaylar.length || notYaziliyor} onClick={() => void notYazdir()}>{notYaziliyor ? "Yazılıyor…" : "✨ Yapay zekâ ile not yaz"}</Button>
            <small className="muted">{seciliAdaylar.length === 1 ? "Seçili cariye göre kişisel taslak; gönderim öncesi düzenleyebilirsiniz." : "Birden çok cari seçili: genel bir taslak yazılır."}</small>
          </div>
          <label className="check-row"><input type="checkbox" checked={smsDeGonder} onChange={(e) => setSmsDeGonder(e.target.checked)} /> SMS ile de gönder (yalnız kartında SMS izni açık carilere, firmanın SMS hesabından)</label>
          <label className="check-row"><input type="checkbox" checked={siklikSiniriniAs} onChange={(e) => setSiklikSiniriniAs(e.target.checked)} /> Son 7 günde hatırlatma almış carilere de gönder</label>
          {seciliAdaylar.some((a) => a.baglanmamisTahsilatTry) && (
            <label className="check-row"><input type="checkbox" checked={baglanmamisOnayi} onChange={(e) => setBaglanmamisOnayi(e.target.checked)} /> Faturaya bağlanmamış tahsilatı olan carilere de gönder (ödenmiş faturaya hatırlatma gidebilir)</label>
          )}
          <div className="vade-hatirlatma__gonder">
            <span>{seciliAdaylar.length} cari seçili · {para(seciliToplam)}</span>
            <Button variant="primary" disabled={!seciliAdaylar.length || islemde} onClick={() => void gonder()}>{islemde ? "Gönderiliyor…" : kademe === "ihtar" ? "İhtarı gönder" : "Hatırlatmayı gönder"}</Button>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th aria-label="Seçim">
                <input
                  type="checkbox"
                  aria-label="Tümünü seç"
                  checked={secilebilir.length > 0 && secilebilir.every((a) => secili.has(a.cariId))}
                  disabled={secilebilir.length === 0}
                  onChange={(e) => setSecili(new Set(e.target.checked ? secilebilir.map((a) => a.cariId) : []))}
                />
              </th>
              <th>Cari</th>
              <th>E-posta</th>
              <th className="num">Vadesi geçmiş</th>
              <th>En eski vade</th>
              <th>Son hatırlatma</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {adaylar === null ? (
              <tr><td colSpan={7} className="empty">Yükleniyor…</td></tr>
            ) : adaylar.length === 0 ? (
              <tr><td colSpan={7} className="empty">Vadesi geçmiş alacağı olan cari yok.</td></tr>
            ) : adaylar.map((a) => (
              <tr key={a.cariId}>
                <td><input type="checkbox" aria-label={`${a.unvan} seç`} disabled={!a.eposta || a.itirazEngeli} checked={secili.has(a.cariId)} onChange={() => degistir(a.cariId)} /></td>
                <td>
                  <a href={`/panel/cari/${a.cariId}`}><strong>{a.unvan}</strong></a> {riskler.get(a.cariId) && <RiskRozeti risk={riskler.get(a.cariId)!} />}
                  <div className="subtle">{a.kod} · {a.faturaSayisi} kalem{a.karaListe ? " · kara listede" : ""}{!a.aktif ? " · pasif" : ""}</div>
                  {a.itirazEngeli && <div><Badge variant="warning">Açık itiraz: gönderim durduruldu</Badge><small className="muted">{a.gonderimEngeli}</small></div>}
                  {a.baglanmamisTahsilatTry && <div><Badge variant="warning">Bağlanmamış tahsilat {Number(a.baglanmamisTahsilatTry).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL</Badge> <a href={`/panel/cari/${a.cariId}`}>Faturalara bağla</a></div>}
                </td>
                <td>{a.eposta ?? <Badge variant="warning">E-posta yok</Badge>}</td>
                <td className="num money neg">
                  {para(a.toplamTry)}
                  {a.dovizler.filter((d) => d.dovizCinsi !== "TRY").map((d) => <small className="muted vade-hatirlatma__doviz" key={d.dovizCinsi}>{para(d.tutar, d.dovizCinsi)}</small>)}
                </td>
                <td>{a.enEskiVade ? tarih(a.enEskiVade) : "—"}<div className="subtle">{a.enUzunGecikme} gün</div></td>
                <td>{a.sonHatirlatma ? <>{tarih(a.sonHatirlatma)}{a.siklikEngeli && <div><Badge variant="info">7 gün dolmadı</Badge></div>}</> : "—"}</td>
                <td><Button size="sm" disabled={a.itirazEngeli} onClick={() => void onizle(a.cariId)}>Önizle</Button></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {onizleme && (
        <Card>
          <div className="vade-hatirlatma__onizleme-bas">
            <div><strong>{onizleme.konu}</strong><div className="subtle">Alıcı: {onizleme.alici ?? "e-posta yok"} · Ek: son 90 günlük ekstre (PDF)</div></div>
            <Button size="sm" onClick={() => setOnizleme(null)}>Kapat</Button>
          </div>
          {/* Sunucu şablonu ve alanları kaçışlayarak üretir. */}
          <div className="vade-hatirlatma__onizleme" dangerouslySetInnerHTML={{ __html: onizleme.html }} />
        </Card>
      )}
    </div>
  );
}
