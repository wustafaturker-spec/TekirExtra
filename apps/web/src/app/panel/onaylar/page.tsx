"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useArayuzIsleyicisi, useEkranDurumu } from "@/lib/asistan-baglami";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Badge, Button, Card, Field, Modal, PageHeader } from "@/components/ui";

type Kutu = "bekleyen" | "taleplerim" | "gecmis";
type KararIslemi = "onayla" | "reddet" | "geri-cek";
type Durum = "bekliyor" | "isleniyor" | "onaylandi" | "reddedildi" | "geri_cekildi" | "gecersiz" | "hata";
interface Talep {
  id: string; islemAdi: string; ozet: string; tutarTry: string | null; nedenler: string[]; durum: Durum; adim: number; kuralAdi: string | null;
  adimlar: ({ rol: string } | { kullanici: string })[];
  kararlar: { adim: number; ad: string; karar: "onay" | "ret"; gerekce: string | null; at: string }[];
  talepEden: string; hata: string | null; createdAt: string; hedefTur: string | null; hedefId: string | null;
}
interface DigerOnay { tur: string; baslik: string; tutar: string | null; tarih: string; yol: string }

const DURUM: Record<Durum, { ad: string; ton: "info" | "warning" | "success" | "danger" | "neutral" }> = {
  bekliyor: { ad: "Bekliyor", ton: "warning" },
  isleniyor: { ad: "Yürütülüyor", ton: "info" },
  onaylandi: { ad: "Onaylandı ve yapıldı", ton: "success" },
  reddedildi: { ad: "Reddedildi", ton: "danger" },
  geri_cekildi: { ad: "Geri çekildi", ton: "neutral" },
  gecersiz: { ad: "Geçersiz (kayıt değişti)", ton: "neutral" },
  hata: { ad: "Onaylandı, yapılamadı", ton: "danger" },
};
const HEDEF_YOLU: Record<string, (id: string) => string> = {
  fatura: (id) => `/panel/fatura?faturaId=${id}`,
  belge: (id) => `/panel/belgeler?odak=${id}`,
  masraf: () => "/panel/masraflar",
};
const adimAdi = (a: Talep["adimlar"][number]) => ("rol" in a ? ROL_ADI[a.rol as keyof typeof ROL_ADI] ?? a.rol : a.kullanici);
const zaman = (s: string) => new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
const tl = (s: string) => `${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const KARAR_BASLIGI: Record<KararIslemi, string> = {
  onayla: "Talebi onayla",
  reddet: "Talebi reddet",
  "geri-cek": "Talebi geri çek",
};
const hedefeGit = (t: Talep) => t.hedefTur && t.hedefId ? HEDEF_YOLU[t.hedefTur]?.(t.hedefId) : undefined;

/**
 * ONY-06: tek onay kutusu. Onayımı bekleyenler (karar burada), taleplerim (geri çekme), geçmiş.
 * Kendi akışında karar verilen mevcut onaylar da listelenir ve ekranına bağlanır.
 */
export default function OnaylarSayfasi() {
  return <Suspense fallback={<p className="muted">Yükleniyor…</p>}><OnayKutusu /></Suspense>;
}

function OnayKutusu() {
  const vurgulu = useSearchParams().get("talep");
  const [kutu, setKutu] = useState<Kutu>("bekleyen");
  // AI-113: açık onay kutusu asistanın ekran durumudur.
  useEkranDurumu({ ekran: "onaylar", suzgecler: { kutu } });
  // AI-114: asistan onay kutusunu değiştirebilir (onay/ret yapamaz).
  useArayuzIsleyicisi("onaylar", {
    suzgec: (s) => {
      if (!s.kutu || !["bekleyen", "taleplerim", "gecmis"].includes(s.kutu)) return "alan_yok";
      const onceki = kutu;
      setKutu(s.kutu as Kutu);
      return () => setKutu(onceki);
    },
  });
  const [liste, setListe] = useState<{ kutu: Kutu; talepler: Talep[]; digerOnaylar: DigerOnay[] } | null>(null);
  const [listeHatasi, setListeHatasi] = useState<{ kutu: Kutu; mesaj: string } | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState("");
  const [karar, setKarar] = useState<{ talep: Talep; tur: KararIslemi } | null>(null);
  const [gerekce, setGerekce] = useState("");

  // Sekme hızla değiştirilince geç gelen eski yanıt yeni sekmenin listesini ezmesin.
  const sonIstek = useRef(0);
  const yukle = useCallback(async (k: Kutu) => {
    const no = ++sonIstek.current;
    setListe(null);
    setListeHatasi(null);
    try {
      const r = await api<{ talepler: Talep[]; digerOnaylar: DigerOnay[] }>(`/onaylar?kutu=${k}`);
      if (no !== sonIstek.current) return;
      setListe({ kutu: k, ...r });
    } catch (e) {
      if (no === sonIstek.current) setListeHatasi({ kutu: k, mesaj: e instanceof Error ? e.message : "Onaylar alınamadı." });
    }
  }, []);
  useEffect(() => { void yukle(kutu); return () => { sonIstek.current++; }; }, [kutu, yukle]);
  const guncelListe = liste?.kutu === kutu ? liste : null;
  const guncelListeHatasi = listeHatasi?.kutu === kutu ? listeHatasi.mesaj : "";
  const talepler = guncelListe?.talepler;
  const diger = guncelListe?.digerOnaylar ?? [];

  function kararAc(talep: Talep, tur: KararIslemi) {
    setHata("");
    setBasari("");
    setGerekce("");
    setKarar({ talep, tur });
  }

  function kararKapat() {
    if (islem) return;
    setHata("");
    setKarar(null);
  }

  const retEksik = karar?.tur === "reddet" && gerekce.trim().length < 3;
  const kararHedefi = karar && hedefeGit(karar.talep);
  async function eylem() {
    if (!karar || islem || retEksik) return;
    const { talep: t, tur } = karar;
    setIslem(t.id); setHata(""); setBasari("");
    try {
      const r = await api<Talep>(`/onaylar/${t.id}/${tur}`, { method: "POST", body: JSON.stringify({ gerekce: tur === "reddet" ? gerekce.trim() : null }) });
      setBasari(tur === "reddet" ? "Talep reddedildi." : tur === "geri-cek" ? "Talep geri çekildi." : r.durum === "bekliyor" ? "Onayınız kaydedildi; sonraki adımın onayı bekleniyor." : r.durum === "onaylandi" ? "Onaylandı ve işlem yapıldı." : `Onaylandı ama işlem yapılamadı: ${r.hata ?? DURUM[r.durum].ad}`);
      setKarar(null);
      await yukle(kutu);
    } catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
    finally { setIslem(""); }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        title="Onaylar"
        subtitle="Onay kurallarına takılan işlemler burada onaylanır. Son adım onaylanınca işlem, talep edenin adına kendiliğinden yapılır."
        actions={
          <Link href="/panel/ai/sabah-onay">
            <Button size="sm" variant="primary">
              Sabah Onay Kutusu 🌅
            </Button>
          </Link>
        }
      />
      {!karar && <Alert tone="error">{hata}</Alert>}
      <Alert tone="success">{basari}</Alert>
      <div className="row" role="tablist" style={{ gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {([["bekleyen", "Onayımı bekleyenler"], ["taleplerim", "Taleplerim"], ["gecmis", "Geçmiş"]] as const).map(([k, ad]) => (
          <Button key={k} role="tab" aria-selected={kutu === k} disabled={Boolean(islem)} variant={kutu === k ? "primary" : undefined} onClick={() => setKutu(k)}>{ad}</Button>
        ))}
      </div>

      <div className="stack">
        {guncelListeHatasi ? <Card><Alert tone="error">
          <div>{guncelListeHatasi}</div>
          <Button size="sm" onClick={() => void yukle(kutu)}>Tekrar dene</Button>
        </Alert></Card> : !guncelListe && <Card><p className="subtle" role="status" style={{ margin: 0 }}>Onaylar yükleniyor…</p></Card>}
        {talepler?.length === 0 && <Card><p className="subtle" style={{ margin: 0 }}>{kutu === "bekleyen" ? "Onayınızı bekleyen talep yok." : kutu === "taleplerim" ? "Açtığınız onay talebi yok." : "Karara bağlanmış talep yok."}</p></Card>}
        {talepler?.map((t) => {
          const hedefYolu = hedefeGit(t);
          return (
            <Card key={t.id} title={t.islemAdi} actions={<Badge variant={DURUM[t.durum].ton}>{DURUM[t.durum].ad}</Badge>} style={vurgulu === t.id ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined}>
              <div className="stack" style={{ gap: "0.5rem" }}>
                <div><strong>{t.ozet}</strong>{t.tutarTry && <span className="subtle"> · TL karşılığı {tl(t.tutarTry)}</span>}</div>
                <div className="subtle">Neden: {t.nedenler.join("; ")}{t.kuralAdi ? ` (kural: ${t.kuralAdi})` : ""}</div>
                <div className="subtle">Talep eden: {t.talepEden} · {zaman(t.createdAt)}</div>
                <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                  {t.adimlar.map((a, i) => {
                    const k = t.kararlar.find((x) => x.adim === i);
                    const ton = k ? (k.karar === "onay" ? "success" : "danger") : i === t.adim && t.durum === "bekliyor" ? "warning" : "neutral";
                    return <Badge key={i} variant={ton}>{i + 1}. {adimAdi(a)}{k ? ` — ${k.ad} ${k.karar === "onay" ? "onayladı" : "reddetti"}` : ""}</Badge>;
                  })}
                </div>
                {t.kararlar.filter((k) => k.gerekce).map((k) => <div key={`${k.adim}-${k.at}`} className="subtle">{k.ad}: “{k.gerekce}”</div>)}
                {t.hata && <Alert tone="warning">{t.hata}</Alert>}
                <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {hedefYolu && <Link className="btn btn--sm" href={hedefYolu}>Kaydı aç</Link>}
                  {kutu === "bekleyen" && t.durum === "bekliyor" && <>
                    <Button size="sm" variant="danger" disabled={Boolean(islem)} onClick={() => kararAc(t, "reddet")}>Reddet</Button>
                    <Button size="sm" variant="primary" disabled={Boolean(islem)} onClick={() => kararAc(t, "onayla")}>Onayla</Button>
                  </>}
                  {kutu === "taleplerim" && t.durum === "bekliyor" && <Button size="sm" disabled={Boolean(islem)} onClick={() => kararAc(t, "geri-cek")}>Geri çek</Button>}
                </div>
              </div>
            </Card>
          );
        })}

        {kutu === "bekleyen" && diger.length > 0 && (
          <Card title="Kendi ekranında onaylanan işler">
            <p className="subtle" style={{ marginTop: 0 }}>Bu onaylar kendi akışlarında verilir; satıra tıklayınca ilgili ekran açılır.</p>
            <div className="stack" style={{ gap: "0.4rem" }}>
              {diger.map((d, i) => (
                <Link key={`${d.tur}-${i}`} href={d.yol} className="between" style={{ textDecoration: "none", color: "var(--text)", padding: "0.5rem 0.75rem", background: "var(--surface-2)", borderRadius: 8 }}>
                  <span>{d.baslik}</span>
                  <span className="subtle">{d.tutar ? `${tl(d.tutar)} · ` : ""}{zaman(d.tarih)}</span>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
      {karar && <Modal baslik={KARAR_BASLIGI[karar.tur]} onKapat={kararKapat}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void eylem(); }}>
          <Alert tone="error">{hata}</Alert>
          <div className="stack" style={{ gap: ".35rem", overflowWrap: "anywhere" }}>
            <strong>{karar.talep.islemAdi}</strong>
            <span>{karar.talep.ozet}</span>
            {karar.talep.tutarTry !== null && <span>TL karşılığı {tl(karar.talep.tutarTry)}</span>}
            <span className="subtle">Talep eden {karar.talep.talepEden}</span>
            {kararHedefi && <Link href={kararHedefi} target="_blank" rel="noopener noreferrer">Hedef kaydı aç (yeni sekme)</Link>}
          </div>
          {karar.tur === "onayla" && <p className="subtle">{karar.talep.adim + 1 >= karar.talep.adimlar.length
            ? "Bu son onay. Onayladığınızda işlem talep edenin adına hemen yapılacak."
            : "Onayınız kaydedilecek. İşlem sonraki onay adımı tamamlanana kadar bekleyecek."}</p>}
          {karar.tur === "geri-cek" && <p className="subtle">Talep geri çekilecek ve onay akışı sona erecek.</p>}
          {karar.tur === "reddet" && <Field label="Ret gerekçesi (en az 3 karakter)" htmlFor="onay-ret-gerekcesi">
            <textarea id="onay-ret-gerekcesi" className="input" rows={3} maxLength={500} required disabled={Boolean(islem)}
              value={gerekce} onChange={(e) => setGerekce(e.target.value)} />
          </Field>}
          <div className="row-tight" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button type="button" disabled={Boolean(islem)} onClick={kararKapat}>Vazgeç</Button>
            <Button type="submit" variant={karar.tur === "onayla" ? "primary" : "danger"} disabled={Boolean(islem) || retEksik}>
              {islem ? "İşleniyor…" : KARAR_BASLIGI[karar.tur]}
            </Button>
          </div>
        </form>
      </Modal>}
    </div>
  );
}
