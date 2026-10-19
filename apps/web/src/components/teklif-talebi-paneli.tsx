"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Input } from "@/components/ui";
import { CariSecModali } from "@/components/cari-sec-modali";

type Durum = "isleniyor" | "atlandi" | "teklif_degil" | "incelenmeli" | "cari_secimi" | "cari_onayi_bekliyor" | "cari_yok" | "taslak_hazir" | "sinirda" | "hata";

interface Kalem {
  ifade: string; miktar: number | null; birim: string | null; stokId: string | null; kod: string | null; ad: string | null;
  belirsizKart?: { kartKodu: string; kartAdi: string; secenekler: string[] };
  /** AI-61: önceki düzeltmeden hatırlandı. */
  hatirlandi?: boolean;
}
interface Islem {
  durum: Durum; guven: number | null; uyarilar: string[]; kalemler: Kalem[]; hata: string | null; cariId: string | null;
  belgeAdresi: string | null; onayAdresi: string | null; yanitOnerisi: string | null;
  cariAdaylari: Array<{ cariId: string; kod: string | null; unvan: string; vknTckn: string | null; gerekceler: string[] }>;
}

type Varyant = "neutral" | "accent" | "success" | "info" | "danger" | "warning";
export const TEKLIF_DURUMU: Record<Durum, { ad: string; varyant: Varyant }> = {
  isleniyor: { ad: "İşleniyor", varyant: "info" },
  atlandi: { ad: "Otomatik ileti", varyant: "neutral" },
  teklif_degil: { ad: "Teklif talebi değil", varyant: "neutral" },
  incelenmeli: { ad: "Teklif: incelenmeli", varyant: "warning" },
  cari_secimi: { ad: "Teklif: cari seçimi bekliyor", varyant: "warning" },
  cari_onayi_bekliyor: { ad: "Teklif: cari onayı bekliyor", varyant: "warning" },
  cari_yok: { ad: "Teklif: cari yok", varyant: "warning" },
  taslak_hazir: { ad: "Teklif taslağı hazır", varyant: "success" },
  sinirda: { ad: "Teklif: AI sınırında", varyant: "danger" },
  hata: { ad: "Teklif: hata", varyant: "danger" },
};

/** Listede küçük rozet; teklifle ilgisi olmayan sonuçlar gösterilmez. */
export function TeklifTalebiRozeti({ durum }: { durum: string | null | undefined }) {
  if (!durum || durum === "teklif_degil" || durum === "atlandi") return null;
  const d = TEKLIF_DURUMU[durum as Durum];
  return d ? <Badge variant={d.varyant}>{d.ad}</Badge> : null;
}

const YENIDEN: Durum[] = ["atlandi", "teklif_degil", "incelenmeli", "cari_yok", "sinirda", "hata"];

/**
 * AI-37: seçili e-postanın teklif talebi işlemi — durum, kalem eşleşmeleri,
 * uyarılar, taslak/onay bağlantıları ve elle "Taslak hazırla".
 */
export function TeklifTalebiPaneli({ epostaId, onDegisti }: { epostaId: string; onDegisti?: () => void }) {
  const [islem, setIslem] = useState<Islem | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [cariSec, setCariSec] = useState(false);
  const [urunSec, setUrunSec] = useState<number | null>(null);
  const [bilgi, setBilgi] = useState("");

  const yukle = useCallback(async () => {
    setHata("");
    try { setIslem((await api<{ islem: Islem | null }>(`/ai/teklif-talepleri/${epostaId}`)).islem); }
    catch (e) { setHata(e instanceof Error ? e.message : "Teklif talebi durumu okunamadı"); }
  }, [epostaId]);
  useEffect(() => { setIslem(null); void yukle(); }, [yukle]);

  /** AI-61: seçim bu cari için hatırlanır; taslak yoksa önceki çıkarımla yeniden hazırlanır. */
  async function urunuOgret(kalem: number, stokId: string, varyantId: string | null) {
    setYukleniyor(true); setHata(""); setBilgi("");
    try {
      const g = await api<Islem>(`/ai/teklif-talepleri/${epostaId}/urun`, { method: "POST", body: JSON.stringify({ kalem, stokId, ...(varyantId ? { varyantId } : {}) }) });
      setIslem(g); setUrunSec(null);
      setBilgi(g.belgeAdresi && islem?.belgeAdresi ? "Seçim bu cari için hatırlandı; açık taslağı ayrıca düzeltin." : "Seçim bu cari için hatırlandı.");
      onDegisti?.();
    } catch (e) { setHata(e instanceof Error ? e.message : "Ürün seçimi kaydedilemedi"); }
    finally { setYukleniyor(false); }
  }

  async function hazirla(secim: { cariId?: string; yeniCari?: true } = {}) {
    setCariSec(false); setYukleniyor(true); setHata("");
    try {
      setIslem(await api<Islem>(`/ai/teklif-talepleri/${epostaId}/hazirla`, { method: "POST", body: JSON.stringify(secim) }));
      onDegisti?.();
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslak hazırlanamadı"); }
    finally { setYukleniyor(false); }
  }

  async function geriBildir(tur: "teklif_degil" | "teklifti" | "sustur") {
    setYukleniyor(true); setHata("");
    try {
      const g = await api<{ islem: Islem | null }>(`/ai/teklif-talepleri/${epostaId}/geri-bildirim`, { method: "POST", body: JSON.stringify({ tur }) });
      setIslem(g.islem);
      onDegisti?.();
    } catch (e) { setHata(e instanceof Error ? e.message : "Geri bildirim kaydedilemedi"); }
    finally { setYukleniyor(false); }
  }

  const d = islem ? TEKLIF_DURUMU[islem.durum] : null;
  const taslaksiz = !islem?.belgeAdresi && islem?.durum !== "isleniyor" && islem?.durum !== "cari_onayi_bekliyor";
  const yenidenCalisir = !islem || (YENIDEN.includes(islem.durum) && !islem.belgeAdresi);
  return (
    <div className="teklif-talebi">
      <div className="row-tight teklif-talebi__ust">
        {d ? <Badge variant={d.varyant}>{d.ad}</Badge> : <span className="muted">Teklif talebi olarak işlenmedi</span>}
        {islem?.guven != null && islem.durum !== "atlandi" && <span className="muted">Güven %{Math.round(islem.guven * 100)}</span>}
        {islem?.belgeAdresi && <Link href={islem.belgeAdresi}>Taslağı aç</Link>}
        {islem?.onayAdresi && islem.durum === "cari_onayi_bekliyor" && <Link href={islem.onayAdresi}>Cari açma onayı</Link>}
        {yenidenCalisir && <Button size="sm" disabled={yukleniyor} onClick={() => void hazirla()}>{yukleniyor ? "Hazırlanıyor…" : islem ? "Yeniden dene" : "Taslak hazırla"}</Button>}
        {(islem?.durum === "cari_yok" || islem?.durum === "cari_secimi") && <Button size="sm" disabled={yukleniyor} onClick={() => setCariSec(true)}>{islem.durum === "cari_secimi" ? "Başka cari seç" : "Cari seçerek hazırla"}</Button>}
        {islem?.durum === "cari_secimi" && <Button size="sm" disabled={yukleniyor} onClick={() => void hazirla({ yeniCari: true })}>Hiçbiri, yeni cari aç</Button>}
      </div>
      {islem?.durum === "cari_secimi" && !!islem.cariAdaylari.length && (
        <ul className="teklif-talebi__adaylar" aria-label="Olası cariler">
          {islem.cariAdaylari.map((a) => (
            <li key={a.cariId}>
              <span><strong>{a.unvan}</strong>{a.kod ? <span className="muted"> · {a.kod}</span> : null} <span className="muted">— {a.gerekceler.join(" · ")}</span></span>
              <Button size="sm" variant="primary" disabled={yukleniyor} onClick={() => void hazirla({ cariId: a.cariId })}>Bu cari</Button>
            </li>
          ))}
        </ul>
      )}
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && <Alert tone="success">{bilgi}</Alert>}
      {islem?.hata && <Alert tone="error">{islem.hata}</Alert>}
      {!!islem?.uyarilar.length && <ul className="teklif-talebi__uyarilar">{islem.uyarilar.map((u, i) => <li key={i}>{u}</li>)}</ul>}
      {!!islem?.kalemler.length && (
        <ul className="teklif-talebi__kalemler" aria-label="İstenen kalemler">
          {islem.kalemler.map((k, i) => (
            <li key={i}>
              <span>{k.ifade}{k.miktar !== null ? ` — ${k.miktar}${k.birim ? ` ${k.birim}` : ""}` : ""}</span>
              {k.stokId ? <span className="muted"> → [{k.kod}] {k.ad}</span>
                : k.belirsizKart ? <><span className="muted"> → [{k.belirsizKart.kartKodu}] {k.belirsizKart.kartAdi}</span> <Badge variant="warning">Varyant belirtilmemiş</Badge></>
                : <Badge variant="warning">Stokta yok</Badge>}
              {k.hatirlandi && <Badge variant="info">Hafızadan</Badge>}
              {islem.cariId && <Button size="sm" disabled={yukleniyor} onClick={() => setUrunSec(urunSec === i ? null : i)}>{k.stokId ? "Düzelt" : "Doğru ürünü seç"}</Button>}
              {urunSec === i && (
                <UrunSecici
                  arama={k.belirsizKart?.kartKodu ?? k.kod ?? ilkAramaKelimesi(k.ifade)}
                  onSec={(stokId, varyantId) => void urunuOgret(i, stokId, varyantId)}
                  onKapat={() => setUrunSec(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {islem?.yanitOnerisi && <YanitOnerisi metin={islem.yanitOnerisi} />}
      {islem?.cariId && <MusteriTercihleri cariId={islem.cariId} />}
      {islem && islem.durum !== "isleniyor" && (
        <div className="row-tight teklif-talebi__geri" aria-label="Sınıflandırma geri bildirimi">
          <span className="muted">Geri bildirim:</span>
          {(islem.durum === "teklif_degil" || islem.durum === "atlandi") && taslaksiz
            ? <Button size="sm" disabled={yukleniyor} onClick={() => void geriBildir("teklifti")}>Bu bir teklif talebiydi</Button>
            : islem.durum !== "teklif_degil" && <Button size="sm" disabled={yukleniyor} onClick={() => void geriBildir("teklif_degil")}>Teklif talebi değildi</Button>}
          {taslaksiz && <Button size="sm" disabled={yukleniyor} onClick={() => void geriBildir("sustur")}>Bu göndericiden teklif gelmez</Button>}
          <Link href="/panel/ai/hafiza">Hafıza</Link>
        </div>
      )}
      {cariSec && (
        <CariSecModali
          baslik="Teklif hangi cariye hazırlansın?"
          aciklama="Gönderen adresi bir cariyle tek başına eşleşmedi. Seçtiğiniz cari için önceki çıkarımla taslak hazırlanır."
          onSec={(c) => void hazirla({ cariId: c.id })}
          onKapat={() => setCariSec(false)}
        />
      )}
    </div>
  );
}

/** Varyantı belirsiz kalemler için müşteriye sorulacak metin; gönderim kullanıcının posta programından. */
function YanitOnerisi({ metin }: { metin: string }) {
  const [kopyalandi, setKopyalandi] = useState(false);
  async function kopyala() {
    try {
      await navigator.clipboard.writeText(metin);
      setKopyalandi(true);
      setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      setKopyalandi(false);
    }
  }
  return (
    <div className="teklif-talebi__yanit">
      <div className="between">
        <strong>Müşteriye sorulacak yanıt önerisi</strong>
        <Button size="sm" onClick={() => void kopyala()}>{kopyalandi ? "✓ Kopyalandı" : "Kopyala"}</Button>
      </div>
      <pre>{metin}</pre>
    </div>
  );
}

/** Stok araması tam ifadeyle çoğu zaman boş döner; önce kod benzeri (harf + rakam), yoksa en uzun kelime. */
function ilkAramaKelimesi(ifade: string): string {
  const kelimeler = ifade.split(/[\s,;/()]+/).filter((k) => k.length >= 3 && !/^\d+([.,]\d+)?$/.test(k));
  return kelimeler.find((k) => /\p{L}/u.test(k) && /\d/.test(k)) ?? [...kelimeler].sort((a, b) => b.length - a.length)[0] ?? ifade;
}

interface StokSonucu { id: string; kod: string; ad: string; varyantlar?: Array<{ id: string; kod: string; ad: string; aktif?: boolean }> }

/** AI-61: kalem için doğru kartı/varyantı arayıp seçme; varyantlı kartta varyant seçilir. */
function UrunSecici({ arama: ilkArama, onSec, onKapat }: { arama: string; onSec: (stokId: string, varyantId: string | null) => void; onKapat: () => void }) {
  const [arama, setArama] = useState(ilkArama);
  const [sonuclar, setSonuclar] = useState<StokSonucu[] | null>(null);
  const [hata, setHata] = useState("");
  useEffect(() => {
    const zaman = setTimeout(() => {
      if (arama.trim().length < 2) { setSonuclar(null); return; }
      api<{ kayitlar: StokSonucu[] }>(`/stok?arama=${encodeURIComponent(arama.trim())}&adet=10`)
        .then((r) => { setSonuclar(r.kayitlar); setHata(""); })
        .catch((e) => setHata(e instanceof Error ? e.message : "Stok aranamadı"));
    }, 300);
    return () => clearTimeout(zaman);
  }, [arama]);
  return (
    <div className="teklif-talebi__urun-sec">
      <div className="row-tight">
        <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Kod ya da ürün adı" aria-label="Stok ara" autoFocus />
        <Button size="sm" onClick={onKapat}>Vazgeç</Button>
      </div>
      {hata && <Alert tone="error">{hata}</Alert>}
      {sonuclar && !sonuclar.length && <p className="muted">Sonuç yok.</p>}
      {!!sonuclar?.length && (
        <ul aria-label="Stok sonuçları">
          {sonuclar.flatMap((s) => {
            const varyantlar = (s.varyantlar ?? []).filter((v) => v.aktif !== false);
            return varyantlar.length
              ? varyantlar.map((v) => <li key={v.id}><button type="button" onClick={() => onSec(s.id, v.id)}>[{s.kod}] {s.ad} — {v.ad || v.kod}</button></li>)
              : [<li key={s.id}><button type="button" onClick={() => onSec(s.id, null)}>[{s.kod}] {s.ad}</button></li>];
          })}
        </ul>
      )}
    </div>
  );
}

interface Tercih { id: string; metin: string; durum: "aktif" | "oneri"; kaynak: string }

/** AI-63: carinin kayıtlı tercihleri; AI önerileri onaylanana kadar kullanılmaz. */
function MusteriTercihleri({ cariId }: { cariId: string }) {
  const [tercihler, setTercihler] = useState<Tercih[]>([]);
  const [yeni, setYeni] = useState("");
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState(false);
  const yukle = useCallback(async () => {
    try { setTercihler(await api<Tercih[]>(`/ai/hafiza/tercihler/${cariId}`)); setHata(""); }
    catch (e) { setHata(e instanceof Error ? e.message : "Tercihler okunamadı"); }
  }, [cariId]);
  useEffect(() => { void yukle(); }, [yukle]);
  async function calistir(fn: () => Promise<unknown>) {
    setMesgul(true); setHata("");
    try { await fn(); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
    finally { setMesgul(false); }
  }
  return (
    <div className="teklif-talebi__tercihler">
      <strong>Müşteri tercihleri</strong>
      {hata && <Alert tone="error">{hata}</Alert>}
      {!tercihler.length && <span className="muted">Kayıtlı tercih yok.</span>}
      {!!tercihler.length && (
        <ul>
          {tercihler.map((t) => (
            <li key={t.id}>
              <span>{t.metin}</span>
              {t.durum === "oneri" ? <>
                <Badge variant="warning">AI önerisi</Badge>
                <Button size="sm" variant="primary" disabled={mesgul} onClick={() => void calistir(() => api(`/ai/hafiza/${t.id}`, { method: "PATCH", body: JSON.stringify({ durum: "aktif" }) }))}>Onayla</Button>
                <Button size="sm" disabled={mesgul} onClick={() => void calistir(() => api(`/ai/hafiza/${t.id}`, { method: "PATCH", body: JSON.stringify({ durum: "pasif" }) }))}>Reddet</Button>
              </> : <Button size="sm" disabled={mesgul} onClick={() => void calistir(() => api(`/ai/hafiza/${t.id}`, { method: "PATCH", body: JSON.stringify({ durum: "pasif" }) }))}>Kaldır</Button>}
            </li>
          ))}
        </ul>
      )}
      <form className="row-tight" onSubmit={(e) => { e.preventDefault(); if (yeni.trim().length >= 3) void calistir(async () => { await api(`/ai/hafiza/tercihler/${cariId}`, { method: "POST", body: JSON.stringify({ metin: yeni }) }); setYeni(""); }); }}>
        <Input value={yeni} onChange={(e) => setYeni(e.target.value)} maxLength={300} placeholder="Örn. Fiyatlar KDV hariç verilir" aria-label="Yeni tercih" />
        <Button size="sm" type="submit" disabled={mesgul || yeni.trim().length < 3}>Ekle</Button>
      </form>
    </div>
  );
}
