"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { kvOku, kvSil, kvYaz } from "@/lib/saha-depo";
import { kabulGovdesi, kabulPlani, type MalKabulBelgesi } from "@/lib/saha-mal-kabul";
import { miktarEkle, miktarYaz, okutulaniCoz, partiSil, type SayimSatiri } from "@/lib/saha-sayim";
import { KameraOkuyucu } from "../kamera";
import { useSaha } from "../saha-baglam";
import { useUrunListesi } from "../urun-listesi";

interface Kaynak { id: string; no: string | null; tarih: string; cariUnvan: string; kismen?: boolean; satirSayisi?: number }
interface Kaynaklar { siparisler: Kaynak[]; eirsaliyeler: Kaynak[] }
interface Taslak { belge: MalKabulBelgesi; satirlar: SayimSatiri[]; tanimsiz: string[] }
type Bekleyen = { tur: "varyant"; urunId: string; katsayi: number } | { tur: "parti"; urunId: string; varyantId: string | null; katsayi: number };

const sayi = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
const tarihTR = (g: string) => g.split("-").reverse().join(".");

/** SAH-06: açık alış siparişi ya da gelen e-İrsaliye seçilir, ürünler okutulur; sonuç alış irsaliyesi taslağı. */
export default function SahaMalKabulSayfasi() {
  const { sahip, cevrimici } = useSaha();
  const { liste, hata: listeHatasi } = useUrunListesi(sahip, cevrimici);
  const [kaynaklar, setKaynaklar] = useState<Kaynaklar | null>(null);
  const [sekme, setSekme] = useState<"siparis" | "eirsaliye">("siparis");
  const [taslak, setTaslak] = useState<Taslak | null>(null);
  const [girdi, setGirdi] = useState("");
  const [adet, setAdet] = useState("1");
  const [bekleyen, setBekleyen] = useState<Bekleyen | null>(null);
  const [lotNo, setLotNo] = useState(""); const [seriNo, setSeriNo] = useState("");
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const girdiRef = useRef<HTMLInputElement>(null);

  // Yarım kalan kabul cihazdan okunur (okutmalar her adımda cihaza yazılır).
  useEffect(() => {
    if (!sahip) return;
    void kvOku<Taslak & { sahip?: string }>("mal-kabul-taslak").then((t) => { if (t && t.sahip === sahip) setTaslak(t); }).catch(() => undefined);
  }, [sahip]);

  useEffect(() => {
    if (!sahip || !cevrimici || taslak) return;
    api<Kaynaklar>("/saha/mal-kabul").then(setKaynaklar).catch((e: unknown) => setHata(e instanceof Error ? e.message : "Belgeler alınamadı"));
  }, [sahip, cevrimici, taslak]);

  const kaydet = (t: Taslak | null) => {
    setTaslak(t);
    void (t ? kvYaz("mal-kabul-taslak", { ...t, sahip }) : kvSil("mal-kabul-taslak")).catch(() => undefined);
  };
  const geriBildirim = (basarili: boolean) => { try { navigator.vibrate?.(basarili ? 40 : [60, 40, 60]); } catch { /* titreşim isteğe bağlı */ } };

  async function belgeAc(tur: "siparis" | "eirsaliye", id: string) {
    setHata(""); setBilgi(""); setIsleniyor(true);
    try {
      const belge = await api<MalKabulBelgesi>(`/saha/mal-kabul/${tur}/${id}`);
      if (belge.engel) { setHata(belge.engel); return; }
      if (!belge.satirlar.length) { setHata("Belgede teslim bekleyen satır yok."); return; }
      kaydet({ belge, satirlar: [], tanimsiz: [] });
    } catch (e) { setHata(e instanceof Error ? e.message : "Belge açılamadı"); } finally { setIsleniyor(false); }
  }

  function ekle(urunId: string, varyantId: string | null, katsayi: number, parti?: { lotNo?: string; seriNo?: string }) {
    const urun = liste?.urunler.find((u) => u.id === urunId);
    if (!urun || !taslak) return;
    const miktar = Math.max(0, Number(adet.replace(",", ".")) || 1) * katsayi;
    try {
      const satirlar = miktarEkle(taslak.satirlar, urun, varyantId, miktar, parti);
      kaydet({ ...taslak, satirlar });
      setBilgi(`${satirlar[0].ad}: ${sayi(satirlar[0].miktar)} ${satirlar[0].birim}`); setHata("");
      geriBildirim(true);
      setBekleyen(null); setSeriNo(""); setAdet("1");
    } catch (e) { setHata(e instanceof Error ? e.message : "Eklenemedi"); geriBildirim(false); }
  }

  function okut(deger: string) {
    if (!taslak) return;
    if (!liste) { setHata("Önce ürün listesinin inmesini bekleyin."); return; }
    const s = okutulaniCoz(deger, liste.urunler, liste.barkodlar);
    setGirdi("");
    if (s.tur === "bulunamadi") {
      if (s.kod) kaydet({ ...taslak, tanimsiz: [s.kod, ...taslak.tanimsiz.filter((x) => x !== s.kod)].slice(0, 50) });
      setHata(`'${s.kod}' bu firmanın ürünlerinde yok.`); geriBildirim(false); return;
    }
    if (s.tur === "varyant_sec") { setBekleyen({ tur: "varyant", urunId: s.urun.id, katsayi: s.katsayi }); return; }
    if (s.urun.takipTipi !== "yok") { setBekleyen({ tur: "parti", urunId: s.urun.id, varyantId: s.varyantId, katsayi: s.katsayi }); return; }
    ekle(s.urun.id, s.varyantId, s.katsayi);
    girdiRef.current?.focus();
  }

  const plan = useMemo(() => (taslak ? kabulPlani(taslak.belge, taslak.satirlar) : null), [taslak]);

  async function gonder() {
    if (!taslak || !plan) return;
    if (!plan.kalemler.length) { setHata("Belgedeki ürünlerden okutulan yok."); return; }
    const eksik = plan.durumlar.filter((d) => d.fark < 0).length;
    const notlar = [eksik && `${eksik} satır eksik`, plan.fazla.length && `${plan.fazla.length} üründe fazla`, plan.beklenmeyen.length && `${plan.beklenmeyen.length} beklenmeyen ürün`].filter(Boolean).join(", ");
    if (!window.confirm(`${plan.kalemler.length} satırlık alış irsaliyesi taslağı açılsın mı?${notlar ? `\n${notlar}; fazla ve beklenmeyenler irsaliyeye girmez.` : ""}\nOnay panelde verilir.`)) return;
    setIsleniyor(true); setHata("");
    try {
      await api(`/saha/mal-kabul/${taslak.belge.tur}/${taslak.belge.id}`, { method: "POST", body: JSON.stringify(kabulGovdesi(taslak.belge, plan.kalemler)) });
      const no = taslak.belge.no ?? "";
      kaydet(null); setKaynaklar(null);
      setBilgi(`${no} için alış irsaliyesi taslağı açıldı; panelde kontrol edilip onaylanır.`);
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslak açılamadı"); } finally { setIsleniyor(false); }
  }

  const bekleyenUrun = bekleyen ? liste?.urunler.find((u) => u.id === bekleyen.urunId) : undefined;
  const uyarilar = (hata || listeHatasi) && <Alert tone="error">{hata || listeHatasi}</Alert>;

  if (!taslak) {
    const liste_ = sekme === "siparis" ? kaynaklar?.siparisler : kaynaklar?.eirsaliyeler;
    return (
      <div className="saha-mal-kabul">
        <h1>Mal kabul</h1>
        {uyarilar}
        {bilgi && !hata && <Alert tone="success">{bilgi}</Alert>}
        {!cevrimici ? <Alert tone="warning">Belge seçmek için bağlantı gerekir; açık bir kabul varsa cihazdan sürer.</Alert> : (
          <section className="saha-kart">
            <div className="saha-sekmeler" role="tablist">
              <Button role="tab" aria-selected={sekme === "siparis"} variant={sekme === "siparis" ? "primary" : undefined} onClick={() => setSekme("siparis")}>Siparişler ({kaynaklar?.siparisler.length ?? "…"})</Button>
              <Button role="tab" aria-selected={sekme === "eirsaliye"} variant={sekme === "eirsaliye" ? "primary" : undefined} onClick={() => setSekme("eirsaliye")}>e-İrsaliyeler ({kaynaklar?.eirsaliyeler.length ?? "…"})</Button>
            </div>
            {!kaynaklar ? <small className="muted">Yükleniyor…</small> : !liste_?.length ? (
              <small className="muted">{sekme === "siparis" ? "Teslim bekleyen onaylı alış siparişi yok." : "İşlenmemiş gelen e-İrsaliye yok."}</small>
            ) : (
              <ul className="saha-liste">
                {liste_.map((k) => (
                  <li key={k.id}>
                    <div><strong>{k.cariUnvan}</strong><small>{k.no ?? "Numarasız"} · {tarihTR(k.tarih)}{k.kismen ? " · kısmen teslim alındı" : ""}</small></div>
                    <Button size="sm" disabled={isleniyor} onClick={() => void belgeAc(sekme, k.id)}>Aç</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="saha-mal-kabul">
      <h1>Mal kabul</h1>
      {uyarilar}
      {bilgi && !hata && <Alert tone="success">{bilgi}</Alert>}

      <section className="saha-kart">
        <header>
          <div><strong>{taslak.belge.cariUnvan}</strong><br /><small className="muted">{taslak.belge.tur === "siparis" ? "Alış siparişi" : "e-İrsaliye"} {taslak.belge.no ?? ""} · {tarihTR(taslak.belge.tarih)}</small></div>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Bu kabul bırakılsın mı? Okutulanlar silinir.")) kaydet(null); }}>Bırak</Button>
        </header>
      </section>

      {bekleyen && bekleyenUrun ? (
        <section className="saha-kart" aria-label="Ek bilgi">
          <strong>{bekleyenUrun.ad}</strong>
          {bekleyen.tur === "varyant" ? (
            <div className="saha-secenekler">
              {bekleyenUrun.varyantlar.map((v) => (
                <Button key={v.id} onClick={() => (bekleyenUrun.takipTipi !== "yok" ? setBekleyen({ tur: "parti", urunId: bekleyenUrun.id, varyantId: v.id, katsayi: bekleyen.katsayi }) : ekle(bekleyenUrun.id, v.id, bekleyen.katsayi))}>{v.ad}</Button>
              ))}
            </div>
          ) : (
            <form className="saha-form" onSubmit={(e) => { e.preventDefault(); ekle(bekleyen.urunId, bekleyen.varyantId, bekleyen.katsayi, { lotNo, seriNo }); }}>
              <Field label="Lot no"><Input value={lotNo} onChange={(e) => setLotNo(e.target.value)} autoFocus /></Field>
              {bekleyenUrun.takipTipi === "seri" && <Field label="Seri no"><Input value={seriNo} onChange={(e) => setSeriNo(e.target.value)} /></Field>}
              <Button variant="primary" type="submit">Ekle</Button>
            </form>
          )}
          <Button variant="ghost" onClick={() => setBekleyen(null)}>Vazgeç</Button>
        </section>
      ) : (
        <section className="saha-kart">
          <form className="saha-okut" onSubmit={(e) => { e.preventDefault(); okut(girdi); }}>
            <Input ref={girdiRef} aria-label="Barkod ya da ürün kodu" placeholder="Barkod / ürün kodu" value={girdi} onChange={(e) => setGirdi(e.target.value)} autoComplete="off" autoFocus enterKeyHint="go" />
            <Input aria-label="Adet" className="saha-okut__adet" value={adet} onChange={(e) => setAdet(e.target.value)} inputMode="decimal" />
            <Button variant="primary" type="submit" disabled={!liste}>Ekle</Button>
          </form>
          <KameraOkuyucu etkin={Boolean(liste)} onOkut={okut} onHata={setHata} />
        </section>
      )}

      {plan && (
        <section className="saha-kart" aria-label="Beklenen ve okunan">
          <header><strong>Beklenen / okunan</strong></header>
          <ul className="saha-liste">
            {plan.durumlar.map((d) => (
              <li key={d.satir.anahtar}>
                <div><strong>{d.satir.ad}</strong><small>{d.satir.kod ?? ""}{d.kabulEdilemez ? ` · ${d.kabulEdilemez}` : ""}</small></div>
                <span className={d.fark === 0 ? "saha-fark saha-fark--tamam" : "saha-fark saha-fark--eksik"}>
                  {sayi(d.okunan)} / {sayi(d.satir.beklenen)} {d.satir.birim}
                </span>
              </li>
            ))}
          </ul>
          {plan.fazla.length > 0 && <p className="saha-uyari">Fazla (irsaliyeye girmez): {plan.fazla.map((f) => `${f.ad} ${sayi(f.miktar)} ${f.birim}`).join(", ")}</p>}
          {plan.beklenmeyen.length > 0 && <p className="saha-uyari">Belgede olmayan: {plan.beklenmeyen.map((f) => `${f.ad} ${sayi(f.miktar)} ${f.birim}`).join(", ")}</p>}
          {taslak.tanimsiz.length > 0 && <p className="muted">Tanınmayan: {taslak.tanimsiz.join(", ")}</p>}
        </section>
      )}

      {taslak.satirlar.length > 0 && (
        <section className="saha-kart" aria-label="Okutulanlar">
          <header><strong>Okutulan {taslak.satirlar.length} ürün</strong></header>
          <ul className="saha-liste">
            {taslak.satirlar.map((s) => (
              <li key={s.anahtar}>
                <div><strong>{s.ad}</strong><small>{s.kod}</small>
                  {s.partiler.map((p, i) => (
                    <small key={`${p.lotNo}-${p.seriNo}-${i}`}>Lot {p.lotNo}{p.seriNo ? ` · Seri ${p.seriNo}` : ""} · {sayi(p.miktar)} <button type="button" className="saha-baglanti" onClick={() => kaydet({ ...taslak, satirlar: partiSil(taslak.satirlar, s.anahtar, i) })}>sil</button></small>
                  ))}
                </div>
                {s.partiler.length ? <span>{sayi(s.miktar)} {s.birim}</span> : (
                  <Input aria-label={`${s.ad} miktarı`} className="saha-okut__adet" inputMode="decimal" value={String(s.miktar)} onChange={(e) => kaydet({ ...taslak, satirlar: miktarYaz(taslak.satirlar, s.anahtar, Number(e.target.value.replace(",", ".")) || 0) })} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="saha-kart">
        <Button variant="primary" block disabled={!plan?.kalemler.length || isleniyor || !cevrimici} onClick={() => void gonder()}>{isleniyor ? "Gönderiliyor…" : "İrsaliye taslağını aç"}</Button>
        <small className="muted">{cevrimici ? "Okutulanlar belge birimine çevrilir; kesinleştirme panelde yapılır." : "Gönderim için bağlantı gerekir; okutmalar cihazda saklanıyor."}</small>
      </section>
    </div>
  );
}
