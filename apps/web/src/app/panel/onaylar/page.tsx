"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ROL_ADI } from "@/lib/rol-adlari";
import { Alert, Badge, Button, Card, PageHeader } from "@/components/ui";

type Kutu = "bekleyen" | "taleplerim" | "gecmis";
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
  const [talepler, setTalepler] = useState<Talep[] | null>(null);
  const [diger, setDiger] = useState<DigerOnay[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState("");

  // Sekme hızla değiştirilince geç gelen eski yanıt yeni sekmenin listesini ezmesin.
  const sonIstek = useRef(0);
  const yukle = useCallback(async (k: Kutu) => {
    const no = ++sonIstek.current;
    try {
      const r = await api<{ talepler: Talep[]; digerOnaylar: DigerOnay[] }>(`/onaylar?kutu=${k}`);
      if (no !== sonIstek.current) return;
      setTalepler(r.talepler); setDiger(r.digerOnaylar);
    } catch (e) { if (no === sonIstek.current) setHata(e instanceof Error ? e.message : "Onaylar alınamadı"); }
  }, []);
  useEffect(() => { setTalepler(null); void yukle(kutu); }, [kutu, yukle]);

  async function eylem(t: Talep, tur: "onayla" | "reddet" | "geri-cek") {
    let gerekce: string | null = null;
    if (tur === "reddet") {
      gerekce = window.prompt("Ret gerekçesi (en az 3 karakter):");
      if (gerekce === null) return;
    } else if (tur === "onayla") {
      if (!window.confirm(`${t.islemAdi} onaylanacak${t.adim + 1 >= t.adimlar.length ? " ve işlem talep edenin adına hemen yapılacak" : ""}. Devam edilsin mi?`)) return;
    } else if (!window.confirm("Talep geri çekilecek. Devam edilsin mi?")) return;
    setIslem(t.id); setHata(""); setBasari("");
    try {
      const r = await api<Talep>(`/onaylar/${t.id}/${tur}`, { method: "POST", body: JSON.stringify({ gerekce }) });
      setBasari(tur === "reddet" ? "Talep reddedildi." : tur === "geri-cek" ? "Talep geri çekildi." : r.durum === "bekliyor" ? "Onayınız kaydedildi; sonraki adımın onayı bekleniyor." : r.durum === "onaylandi" ? "Onaylandı ve işlem yapıldı." : `Onaylandı ama işlem yapılamadı: ${r.hata ?? DURUM[r.durum].ad}`);
      await yukle(kutu);
    } catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
    finally { setIslem(""); }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader title="Onaylar" subtitle="Onay kurallarına takılan işlemler burada onaylanır. Son adım onaylanınca işlem, talep edenin adına kendiliğinden yapılır." />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      <div className="row" role="tablist" style={{ gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {([["bekleyen", "Onayımı bekleyenler"], ["taleplerim", "Taleplerim"], ["gecmis", "Geçmiş"]] as const).map(([k, ad]) => (
          <Button key={k} role="tab" aria-selected={kutu === k} variant={kutu === k ? "primary" : undefined} onClick={() => setKutu(k)}>{ad}</Button>
        ))}
      </div>

      <div className="stack">
        {talepler === null && <Card><p className="subtle" role="status" style={{ margin: 0 }}>Yükleniyor…</p></Card>}
        {talepler?.length === 0 && <Card><p className="subtle" style={{ margin: 0 }}>{kutu === "bekleyen" ? "Onayınızı bekleyen talep yok." : kutu === "taleplerim" ? "Açtığınız onay talebi yok." : "Karara bağlanmış talep yok."}</p></Card>}
        {talepler?.map((t) => {
          const hedefYolu = t.hedefTur && t.hedefId ? HEDEF_YOLU[t.hedefTur]?.(t.hedefId) : null;
          return (
            <Card key={t.id} title={t.islemAdi} actions={<Badge variant={DURUM[t.durum].ton}>{DURUM[t.durum].ad}</Badge>}>
              <div className="stack" style={{ gap: "0.5rem", outline: vurgulu === t.id ? "2px solid var(--accent)" : undefined, borderRadius: 8 }}>
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
                    <Button size="sm" variant="danger" disabled={Boolean(islem)} onClick={() => void eylem(t, "reddet")}>Reddet</Button>
                    <Button size="sm" variant="primary" disabled={Boolean(islem)} onClick={() => void eylem(t, "onayla")}>{islem === t.id ? "İşleniyor…" : "Onayla"}</Button>
                  </>}
                  {kutu === "taleplerim" && t.durum === "bekliyor" && <Button size="sm" disabled={Boolean(islem)} onClick={() => void eylem(t, "geri-cek")}>Geri çek</Button>}
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
    </div>
  );
}
