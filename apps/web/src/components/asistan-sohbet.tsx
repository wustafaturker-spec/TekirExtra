"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Input } from "@/components/ui";

/** AI-04: kullanıcının onayını bekleyen (ya da karara bağlanmış) yapay zekâ işlemi. */
export interface OnayTalebi {
  id: string;
  arac: string;
  ozet: string;
  kaynak: "asistan" | "mcp";
  durum: "bekliyor" | "isleniyor" | "onaylandi" | "reddedildi" | "suresi_doldu" | "hata";
  gecerlilikSonu: string;
  createdAt: string;
  kararAt: string | null;
  sonuc: unknown;
  hata: string | null;
}

interface Mesaj {
  anahtar: string;
  rol: "user" | "assistant";
  icerik: string;
  talepIdleri: string[];
}

interface AjanYaniti {
  cevap: string;
  onayTalepleri: OnayTalebi[];
  araclar: Array<{ ad: string; sinif: string; basarili: boolean }>;
  asistanKapali?: boolean;
}

const DURUM: Record<OnayTalebi["durum"], { ad: string; tur: "warning" | "info" | "success" | "neutral" | "danger" }> = {
  bekliyor: { ad: "Onayınızı bekliyor", tur: "warning" },
  isleniyor: { ad: "İşleniyor", tur: "info" },
  onaylandi: { ad: "Onaylandı, yapıldı", tur: "success" },
  reddedildi: { ad: "Reddedildi", tur: "neutral" },
  suresi_doldu: { ad: "Süresi doldu", tur: "neutral" },
  hata: { ad: "Onaylandı ama yapılamadı", tur: "danger" },
};

let sayac = 0;
const yeniAnahtar = () => `m${Date.now()}-${sayac++}`;

/** Metindeki `/panel/...` yollarını bağlantıya çevirir; geri kalanı düz metin. */
function baglantili(metin: string): ReactNode {
  const parcalar = metin.split(/(\/panel\/[^\s)\]"'`,]+)/g);
  return parcalar.map((p, i) => (p.startsWith("/panel/") ? <a href={p} key={i}>{p}</a> : <Fragment key={i}>{p}</Fragment>));
}

function hataMesaji(hata: unknown): string {
  return hata instanceof Error ? hata.message : "İşlem tamamlanamadı";
}

/** Onay talebi kartı: özet, durum, sonuç bağlantısı; bekleyen talepte Onayla/Reddet. */
export function TalepKarti({ talep, onDegisti }: { talep: OnayTalebi; onDegisti: (t: OnayTalebi) => void }) {
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const durum = DURUM[talep.durum];
  const sonucAdresi = (talep.sonuc as { adres?: unknown } | null)?.adres;

  async function karar(eylem: "onayla" | "reddet") {
    setIsleniyor(true);
    setHata(null);
    try {
      onDegisti(await api<OnayTalebi>(`/ai/onay-talepleri/${talep.id}/${eylem}`, { method: "POST" }));
    } catch (e) {
      setHata(hataMesaji(e));
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <div className="asistan-talep">
      <div className="asistan-talep__ust">
        <Badge variant={durum.tur}>{durum.ad}</Badge>
        {talep.kaynak === "mcp" && <Badge variant="info">MCP</Badge>}
      </div>
      <p className="asistan-talep__ozet">{talep.ozet}</p>
      {talep.hata && <Alert tone="error">{talep.hata}</Alert>}
      {hata && <Alert tone="error">{hata}</Alert>}
      {typeof sonucAdresi === "string" && talep.durum === "onaylandi" && <a href={sonucAdresi}>Kaydı aç</a>}
      {talep.durum === "bekliyor" && (
        <div className="row-tight">
          <Button size="sm" variant="primary" disabled={isleniyor} onClick={() => void karar("onayla")}>{isleniyor ? "İşleniyor…" : "Onayla"}</Button>
          <Button size="sm" disabled={isleniyor} onClick={() => void karar("reddet")}>Reddet</Button>
        </div>
      )}
    </div>
  );
}

/**
 * AI-05: panel asistanı. Kullanıcı yazar, asistan araçları çalıştırır;
 * onaya tabi işlem talep kartı olarak döner ve yalnız düğmeyle onaylanır.
 */
export function AsistanSohbet({ yukseklik, onTalepDegisti }: { yukseklik?: string; onTalepDegisti?: () => void }) {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([]);
  const [talepler, setTalepler] = useState<Record<string, OnayTalebi>>({});
  const [girdi, setGirdi] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [kapali, setKapali] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const sonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let iptal = false;
    void Promise.all([
      api<{ mesajlar: Array<{ rol: string; icerik: string; talepIdleri: string[] }> }>("/ai/ajan/gecmis"),
      api<OnayTalebi[]>("/ai/onay-talepleri"),
    ])
      .then(([gecmis, liste]) => {
        if (iptal) return;
        // Geçmiş, yüklenirken gönderilmiş mesajların önüne eklenir; üzerine yazmaz.
        const eskiler = gecmis.mesajlar.filter((m) => m.rol === "user" || m.rol === "assistant").map((m) => ({ anahtar: yeniAnahtar(), rol: m.rol as Mesaj["rol"], icerik: m.icerik, talepIdleri: m.talepIdleri }));
        setMesajlar((yeniler) => [...eskiler, ...yeniler]);
        setTalepler((t) => ({ ...Object.fromEntries(liste.map((x) => [x.id, x])), ...t }));
      })
      .catch((e) => { if (!iptal) setHata(hataMesaji(e)); });
    return () => { iptal = true; };
  }, []);

  useEffect(() => {
    sonRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mesajlar, gonderiliyor]);

  async function gonder() {
    const metin = girdi.trim();
    if (!metin || gonderiliyor) return;
    setGirdi("");
    setHata(null);
    setMesajlar((m) => [...m, { anahtar: yeniAnahtar(), rol: "user", icerik: metin, talepIdleri: [] }]);
    setGonderiliyor(true);
    try {
      const y = await api<AjanYaniti>("/ai/ajan/mesaj", { method: "POST", body: JSON.stringify({ mesaj: metin }) });
      if (y.asistanKapali) setKapali(y.cevap);
      setTalepler((t) => ({ ...t, ...Object.fromEntries(y.onayTalepleri.map((x) => [x.id, x])) }));
      setMesajlar((m) => [...m, { anahtar: yeniAnahtar(), rol: "assistant", icerik: y.cevap, talepIdleri: y.onayTalepleri.map((x) => x.id) }]);
      if (y.onayTalepleri.length) onTalepDegisti?.();
    } catch (e) {
      setHata(hataMesaji(e));
    } finally {
      setGonderiliyor(false);
    }
  }

  const talepGuncelle = (t: OnayTalebi) => {
    setTalepler((onceki) => ({ ...onceki, [t.id]: t }));
    onTalepDegisti?.();
  };

  return (
    <div className="asistan" style={yukseklik ? { height: yukseklik } : undefined}>
      <div className="asistan__mesajlar" aria-live="polite">
        {!mesajlar.length && (
          <div className="asistan__bos">
            <strong>Ne yapmak istersiniz?</strong>
            <span>Örnek: “Yılmaz Ticaret'in bakiyesi ne?”, “A4 kağıt stoğu kaç?”, “Kaya Ltd'ye 50 koli A4 için 30 gün vadeli teklif hazırla”.</span>
            <span>Teklif, fatura ve masraf taslağı doğrudan açılır. Onaylama, kesinleştirme, gönderim, ödeme ve kart değişiklikleri yalnız sizin onayınızla yapılır. Asistan kayıt silemez.</span>
          </div>
        )}
        {mesajlar.map((m) => (
          <div className={`asistan__mesaj asistan__mesaj--${m.rol === "user" ? "kullanici" : "asistan"}`} key={m.anahtar}>
            <div className="asistan__balon">{baglantili(m.icerik)}</div>
            {m.talepIdleri.map((id) => talepler[id] && <TalepKarti key={id} talep={talepler[id]} onDegisti={talepGuncelle} />)}
          </div>
        ))}
        {gonderiliyor && <div className="asistan__mesaj asistan__mesaj--asistan"><div className="asistan__balon asistan__balon--bekliyor">Çalışıyor…</div></div>}
        <div ref={sonRef} />
      </div>
      {kapali && <Alert tone="warning">{kapali}</Alert>}
      {hata && <Alert tone="error">{hata}</Alert>}
      <form className="asistan__girdi" onSubmit={(e) => { e.preventDefault(); void gonder(); }}>
        <Input aria-label="Asistana mesaj" disabled={gonderiliyor} maxLength={4000} onChange={(e) => setGirdi(e.target.value)} placeholder="Talimatınızı yazın…" value={girdi} />
        <Button disabled={gonderiliyor || !girdi.trim()} type="submit" variant="primary">Gönder</Button>
      </form>
    </div>
  );
}
