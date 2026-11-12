"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { DepoOzet } from "@/lib/depolar";
import { kuyrugaEkle, kvOku, kvSil, kvYaz, type UrunListesi } from "@/lib/saha-depo";
import { miktarEkle, miktarYaz, okutulaniCoz, partiSil, sayimGovdesi, type SayimSatiri } from "@/lib/saha-sayim";
import { useSaha } from "../saha-baglam";

/** Tarayıcının yerleşik barkod okuyucusu (Chrome/Android); türleri TS kitaplığında yok. */
interface BarkodOkuyucu { detect(kaynak: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type BarkodOkuyucuSinifi = new (s?: { formats?: string[] }) => BarkodOkuyucu;
const okuyucuSinifi = (): BarkodOkuyucuSinifi | null => (typeof window !== "undefined" && "BarcodeDetector" in window ? (window as unknown as { BarcodeDetector: BarkodOkuyucuSinifi }).BarcodeDetector : null);

interface Taslak { depoId: string; satirlar: SayimSatiri[]; tanimsiz: string[] }
type Bekleyen = { tur: "varyant"; urunId: string; katsayi: number } | { tur: "parti"; urunId: string; varyantId: string | null; katsayi: number };

/** SAH-03/05: barkodla sayım; ürün listesi cihazda, sayım taslağı her okutmada cihaza yazılır. */
export default function SahaSayimSayfasi() {
  const { sahip, cevrimici, gonder, kuyrukYenile } = useSaha();
  const [liste, setListe] = useState<UrunListesi | null>(null);
  const [depolar, setDepolar] = useState<DepoOzet[]>([]);
  const [taslak, setTaslak] = useState<Taslak>({ depoId: "", satirlar: [], tanimsiz: [] });
  const [girdi, setGirdi] = useState("");
  const [adet, setAdet] = useState("1");
  const [bekleyen, setBekleyen] = useState<Bekleyen | null>(null);
  const [lotNo, setLotNo] = useState(""); const [seriNo, setSeriNo] = useState("");
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState("");
  const [kamera, setKamera] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const girdiRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Cihazdaki ürün listesi, depolar ve yarım kalan sayım.
  useEffect(() => {
    if (!sahip) return;
    void (async () => {
      const [l, d, t] = await Promise.all([kvOku<UrunListesi>("urunler"), kvOku<DepoOzet[]>("depolar"), kvOku<Taslak>("sayim-taslak")]);
      if (l?.sahip === sahip) setListe(l);
      if (d) setDepolar(d);
      if (t) setTaslak(t);
    })().catch(() => undefined);
  }, [sahip]);

  const listeyiIndir = useCallback(async () => {
    if (!sahip) return;
    setHata("");
    try {
      const [l, d] = await Promise.all([api<Omit<UrunListesi, "sahip">>("/saha/urunler"), api<DepoOzet[]>("/depo?yalnizAktif=true")]);
      const yeni = { ...l, sahip };
      await Promise.all([kvYaz("urunler", yeni), kvYaz("depolar", d)]);
      setListe(yeni); setDepolar(d);
      setTaslak((t) => (t.depoId ? t : { ...t, depoId: (d.find((x) => x.varsayilan) ?? d[0])?.id ?? "" }));
    } catch (e) { setHata(e instanceof Error ? e.message : "Ürün listesi indirilemedi"); }
  }, [sahip]);
  // İlk açılışta liste yoksa ya da bir günden eskiyse ve bağlantı varsa indirilir.
  useEffect(() => {
    if (!sahip || !cevrimici) return;
    if (!liste || Date.now() - Date.parse(liste.alindi) > 86_400_000) void listeyiIndir();
  }, [sahip, cevrimici, liste, listeyiIndir]);

  const kaydet = (t: Taslak) => { setTaslak(t); void kvYaz("sayim-taslak", t).catch(() => undefined); };
  const geriBildirim = (basarili: boolean) => { try { navigator.vibrate?.(basarili ? 40 : [60, 40, 60]); } catch { /* titreşim isteğe bağlı */ } };

  function ekle(urunId: string, varyantId: string | null, katsayi: number, parti?: { lotNo?: string; seriNo?: string }) {
    const urun = liste?.urunler.find((u) => u.id === urunId);
    if (!urun) return;
    const miktar = Math.max(0, Number(adet.replace(",", ".")) || 1) * katsayi;
    try {
      const satirlar = miktarEkle(taslak.satirlar, urun, varyantId, miktar, parti);
      kaydet({ ...taslak, satirlar });
      setBilgi(`${satirlar[0].ad}: ${satirlar[0].miktar.toLocaleString("tr-TR")} ${satirlar[0].birim}`); setHata("");
      geriBildirim(true);
      setBekleyen(null); setSeriNo("");
      setAdet("1");
    } catch (e) { setHata(e instanceof Error ? e.message : "Eklenemedi"); geriBildirim(false); }
  }

  function okut(deger: string) {
    if (!liste) { setHata("Önce ürün listesini indirin."); return; }
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

  // Kamera: yerleşik okuyucu saniyede birkaç kare tarar; aynı barkod 1,5 sn içinde tekrar sayılmaz.
  useEffect(() => {
    if (!kamera) return;
    const Sinif = okuyucuSinifi();
    if (!Sinif) { setKamera(false); return; }
    let akis: MediaStream | null = null; let dur = false; let son = { kod: "", an: 0 };
    const okuyucu = new Sinif({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "itf"] });
    void (async () => {
      try {
        akis = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = akis; await videoRef.current.play();
        while (!dur) {
          const bulunan = await okuyucu.detect(videoRef.current).catch(() => []);
          const kod = bulunan[0]?.rawValue;
          if (kod && (kod !== son.kod || Date.now() - son.an > 1500)) { son = { kod, an: Date.now() }; okutRef.current(kod); }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setHata("Kamera açılamadı; izin verin ya da kodu elle yazın."); setKamera(false); }
    })();
    return () => { dur = true; akis?.getTracks().forEach((t) => t.stop()); };
  }, [kamera]);
  const okutRef = useRef(okut); okutRef.current = okut;

  async function gonderSayim() {
    if (!sahip || !taslak.satirlar.length) return;
    if (!window.confirm(`${taslak.satirlar.length} ürünlük sayım taslak olarak gönderilsin mi? Onay panelde verilir.`)) return;
    setGonderiliyor(true); setHata("");
    const depo = depolar.find((d) => d.id === taslak.depoId);
    const id = crypto.randomUUID();
    try {
      await kuyrugaEkle({ id, sahip, tur: "sayim", olusturma: Date.now(), baslik: `${depo?.ad ?? "Depo"} · ${taslak.satirlar.length} ürün`, durum: "bekliyor", deneme: 0, veri: sayimGovdesi(taslak.depoId || null, bugunTR(), taslak.satirlar, "") });
      await kvSil("sayim-taslak");
      setTaslak({ depoId: taslak.depoId, satirlar: [], tanimsiz: [] });
      await kuyrukYenile();
      const sonuc = cevrimici ? await gonder() : [];
      setBilgi(sonuc.some((s) => s.is.id === id) ? "Taslak sayım gönderildi; panelde Stok › Sayım'dan onaylanır." : "Sayım cihazda kuyruğa alındı; bağlantı gelince gönderilecek.");
    } catch (e) { setHata(e instanceof Error ? e.message : "Sayım kaydedilemedi"); } finally { setGonderiliyor(false); }
  }

  const bekleyenUrun = bekleyen ? liste?.urunler.find((u) => u.id === bekleyen.urunId) : undefined;
  const okuyucuVar = typeof window !== "undefined" && Boolean(okuyucuSinifi());

  return (
    <div className="saha-sayim">
      <h1>Barkodla sayım</h1>
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && !hata && <Alert tone="success">{bilgi}</Alert>}

      <section className="saha-kart">
        <Field label="Depo">
          <Select value={taslak.depoId} onChange={(e) => kaydet({ ...taslak, depoId: e.target.value })} disabled={taslak.satirlar.length > 0}>
            {!depolar.length && <option value="">Varsayılan depo</option>}
            {depolar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}
          </Select>
        </Field>
        <small className="muted">
          {liste ? `${liste.urunler.length} ürün, ${liste.barkodlar.length} barkod cihazda (${new Date(liste.alindi).toLocaleString("tr-TR")}).` : "Ürün listesi cihazda yok."}{" "}
          {cevrimici && <button type="button" className="saha-baglanti" onClick={() => void listeyiIndir()}>Listeyi yenile</button>}
        </small>
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
            <Input ref={girdiRef} aria-label="Barkod ya da ürün kodu" placeholder="Barkod / ürün kodu" value={girdi} onChange={(e) => setGirdi(e.target.value)} inputMode="text" autoComplete="off" autoFocus enterKeyHint="go" />
            <Input aria-label="Adet" className="saha-okut__adet" value={adet} onChange={(e) => setAdet(e.target.value)} inputMode="decimal" />
            <Button variant="primary" type="submit" disabled={!liste}>Ekle</Button>
          </form>
          {okuyucuVar ? (
            <Button block onClick={() => setKamera((k) => !k)} disabled={!liste}>{kamera ? "Kamerayı kapat" : "📷 Kamerayla okut"}</Button>
          ) : (
            <small className="muted">Bu tarayıcıda kamera okuyucusu yok; barkod okuyucu tabancası ya da elle giriş kullanın.</small>
          )}
          {kamera && <video ref={videoRef} className="saha-kamera" playsInline muted />}
        </section>
      )}

      <section className="saha-kart" aria-label="Sayılanlar">
        <header><strong>Sayılan {taslak.satirlar.length} ürün</strong>
          {taslak.satirlar.length > 0 && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Sayım taslağı silinsin mi?")) kaydet({ ...taslak, satirlar: [], tanimsiz: [] }); }}>Temizle</Button>}
        </header>
        <ul className="saha-liste">
          {taslak.satirlar.map((s) => (
            <li key={s.anahtar}>
              <div><strong>{s.ad}</strong><small>{s.kod}</small>
                {s.partiler.map((p, i) => (
                  <small key={`${p.lotNo}-${p.seriNo}-${i}`}>Lot {p.lotNo}{p.seriNo ? ` · Seri ${p.seriNo}` : ""} · {p.miktar.toLocaleString("tr-TR")} <button type="button" className="saha-baglanti" onClick={() => kaydet({ ...taslak, satirlar: partiSil(taslak.satirlar, s.anahtar, i) })}>sil</button></small>
                ))}
              </div>
              {s.partiler.length ? <span>{s.miktar.toLocaleString("tr-TR")} {s.birim}</span> : (
                <Input aria-label={`${s.ad} miktarı`} className="saha-okut__adet" inputMode="decimal" value={String(s.miktar)} onChange={(e) => kaydet({ ...taslak, satirlar: miktarYaz(taslak.satirlar, s.anahtar, Number(e.target.value.replace(",", ".")) || 0) })} />
              )}
            </li>
          ))}
        </ul>
        {taslak.tanimsiz.length > 0 && <p className="muted">Tanınmayan: {taslak.tanimsiz.join(", ")}</p>}
        <Button variant="primary" block disabled={!taslak.satirlar.length || gonderiliyor} onClick={() => void gonderSayim()}>{gonderiliyor ? "Kaydediliyor…" : "Taslak sayımı gönder"}</Button>
        <small className="muted">Yalnız sayılan ürünler gönderilir; stok onaydan sonra düzelir.</small>
      </section>
    </div>
  );
}
