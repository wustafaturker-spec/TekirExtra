"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Para, Stat, StatGrid, Tarih } from "@/components/ui";

type Onem = "kritik" | "uyari" | "bilgi";
type Durum = "yeni" | "goruldu" | "cozuldu";

interface Icgoru {
  id: string;
  gorevId: string | null;
  gorevAdi: string | null;
  hesaplayan: string | null;
  onem: Onem;
  durum: Durum;
  baslik: string;
  ozet: string;
  metrikler: Record<string, number | string>;
  bulgular: { metin: string; baglanti: string | null }[];
  kanitlar: { kaynak: string; aciklama: string }[];
  varsayimlar: string[];
  uyarilar: string[];
  hesaplandiAt: string;
}

const ONEM: Record<Onem, { rozet: "danger" | "warning" | "info"; ad: string }> = {
  kritik: { rozet: "danger", ad: "Kritik" },
  uyari: { rozet: "warning", ad: "Uyarı" },
  bilgi: { rozet: "info", ad: "Bilgi" },
};

const METRIKLER: { anahtar: string; ad: string; isaretle?: boolean }[] = [
  { anahtar: "baslangicBakiye", ad: "Bugünkü nakit" },
  { anahtar: "bazSonBakiye", ad: "Baz senaryo dönem sonu", isaretle: true },
  { anahtar: "kotumserEnDusuk", ad: "Kötümser en düşük", isaretle: true },
  { anahtar: "vadesiGecenAlacak", ad: "Vadesi geçen alacak" },
];

/**
 * AI-25: nakit ve tahsilat analizinin kayıtlı sonuçları (`ai_icgoruler`).
 * Rakamlar nakit akışı, vadesi geçenler ve tahsilat öncelikleri ekranlarının
 * hesabıdır; dil modeli kullanılmaz. Veri yoksa boş durum gösterilir.
 */
export function YzIcgoruKartlari() {
  const [liste, setListe] = useState<Icgoru[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [analiz, setAnaliz] = useState(false);

  const yukle = useCallback(() => {
    api<Icgoru[]>("/ai/icgoruler")
      .then((x) => { setListe(x); setHata(null); })
      .catch((e) => setHata(e instanceof Error ? e.message : "Analizler yüklenemedi"));
  }, []);
  useEffect(yukle, [yukle]);

  async function analizEt() {
    setAnaliz(true); setHata(null);
    try {
      await api("/ai/icgoruler/analiz", { method: "POST" });
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Analiz çalıştırılamadı");
    } finally {
      setAnaliz(false);
    }
  }

  async function durumYap(i: Icgoru, durum: Durum) {
    try {
      await api(`/ai/icgoruler/${i.id}/durum`, { method: "PATCH", body: JSON.stringify({ durum }) });
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Durum güncellenemedi");
    }
  }

  return (
    <Card
      className="yz-icgoru"
      title="Nakit ve tahsilat analizi"
      actions={<Button size="sm" variant="primary" disabled={analiz} onClick={() => void analizEt()}>{analiz ? "Analiz ediliyor…" : "Şimdi analiz et"}</Button>}
    >
      <p className="muted yz-gorev__not">Bu ekrandaki nakit tahmini, vadesi geçen alacaklar ve tahsilat öncelikleri aynı hesapla özetlenir; dil modeli kullanılmaz. Düzenli çalıştırmak için Ayarlar &gt; Yapay Zeka'da "Nakit ve tahsilat analizi" görevi açın.</p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {liste === null && !hata && <p className="muted">Yükleniyor…</p>}
      {liste?.length === 0 && <p className="muted">Henüz analiz yok. "Şimdi analiz et" ile ilk analizi çalıştırın.</p>}
      {liste?.map((i) => (
        <article className={`yz-icgoru__kart is-${i.onem}`} key={i.id}>
          <header className="yz-icgoru__baslik">
            <div>
              <Badge variant={ONEM[i.onem].rozet}>{ONEM[i.onem].ad}</Badge>{" "}
              {i.durum === "goruldu" && <Badge>Görüldü</Badge>}{" "}
              <strong>{i.gorevAdi ?? "Elle analiz"}</strong>
            </div>
            <span className="subtle">Hesaplandı <Tarih deger={i.hesaplandiAt} saatli />{i.hesaplayan ? ` · ${i.hesaplayan}` : ""}</span>
          </header>
          <p className="yz-icgoru__ozet">{i.ozet}</p>
          {METRIKLER.some((m) => typeof i.metrikler[m.anahtar] === "number") && (
            <StatGrid>
              {METRIKLER.filter((m) => typeof i.metrikler[m.anahtar] === "number").map((m) => {
                const deger = i.metrikler[m.anahtar] as number;
                return <Stat key={m.anahtar} label={m.ad} value={<Para deger={deger} isaretle={m.isaretle} />} tone={m.isaretle && deger < 0 ? "danger" : "default"} />;
              })}
            </StatGrid>
          )}
          {i.bulgular.length > 0 && (
            <ul className="yz-icgoru__bulgular">
              {i.bulgular.map((b, n) => <li key={n}>{b.baglanti ? <Link href={b.baglanti}>{b.metin}</Link> : b.metin}</li>)}
            </ul>
          )}
          {i.uyarilar.length > 0 && <Alert tone="warning">{i.uyarilar.join(" ")}</Alert>}
          <details className="yz-icgoru__dayanak">
            <summary>Dayanak ve varsayımlar</summary>
            <ul>
              {i.kanitlar.map((k) => <li key={k.kaynak}><code>{k.kaynak}</code> — {k.aciklama}</li>)}
              {i.varsayimlar.map((v) => <li key={v}>{v}</li>)}
            </ul>
          </details>
          <div className="row-tight yz-icgoru__eylem">
            {i.durum === "yeni" && <Button size="sm" onClick={() => void durumYap(i, "goruldu")}>Görüldü</Button>}
            <Button size="sm" onClick={() => void durumYap(i, "cozuldu")}>Çözüldü</Button>
          </div>
        </article>
      ))}
    </Card>
  );
}
