"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { Alert, Button, Card, Input } from "@/components/ui";

/**
 * Ortak rapor paneli (RPR-06): rapor kataloğunu API meta verisinden çizer —
 * filtreler, gruplama, sıralama, Excel dışa aktarım ve kayıtlı görünümler
 * tüm raporlar için buradan gelir.
 */

interface RaporFiltreTanimi {
  alan: string;
  ad: string;
  tip: "tarih" | "metin" | "sayi" | "secim" | "onay" | "cari" | "stok" | "depo" | "etiket" | "hesap";
  zorunlu?: boolean;
  secenekler?: { deger: string; ad: string }[];
}

interface RaporKolon {
  alan: string;
  baslik: string;
  tip: "metin" | "sayi" | "para" | "yuzde" | "tarih";
  dovizAlani?: string;
  /** RPR-09: hücre satırın bu alanındaki panel yoluna bağlantı olur. */
  baglantiAlani?: string;
}

interface RaporMeta {
  kod: string;
  modul: string;
  ad: string;
  aciklama: string | null;
  filtreler: RaporFiltreTanimi[];
  gruplamalar: { deger: string; ad: string }[];
  kolonlar: RaporKolon[];
}

interface RaporSonucu {
  kolonlar: RaporKolon[];
  satirlar: Record<string, string | number | boolean | null>[];
}

interface Gorunum {
  id: string;
  ad: string;
  firmaGeneli: boolean;
  girdi: {
    filtreler?: Record<string, string | number | boolean>;
    gruplama?: string;
  };
}

interface SecimKaydi {
  id: string;
  ad?: string;
  unvan?: string;
  kod?: string;
}

const MODUL_ADLARI: Record<string, string> = {
  cari: "Cari",
  stok: "Stok",
  fatura: "Fatura",
  genel: "Genel",
  urun_hareket: "Ürün Hareketleri",
  kasa_banka: "Kasa/Banka",
};

const SAYISAL = ["para", "sayi", "yuzde"];

function hucreBicimle(
  kolon: RaporKolon,
  deger: string | number | boolean | null,
  satir?: Record<string, string | number | boolean | null>,
): string {
  if (deger === null || deger === undefined || deger === "") return "—";
  switch (kolon.tip) {
    case "para": {
      const doviz = kolon.dovizAlani ? String(satir?.[kolon.dovizAlani] ?? "TRY") : "TRY";
      return Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + (doviz === "TRY" ? "TL" : doviz);
    }
    case "sayi":
      return Number(deger).toLocaleString("tr-TR");
    case "yuzde":
      return "%" + Number(deger).toFixed(2);
    default:
      return String(deger);
  }
}

export function RaporPaneli({ modul }: { modul?: string }) {
  const [raporlar, setRaporlar] = useState<RaporMeta[]>([]);
  const [secilenKod, setSecilenKod] = useState<string>("");
  const [filtreler, setFiltreler] = useState<Record<string, string | number | boolean>>({});
  const [gruplama, setGruplama] = useState<string>("");
  const [siralama, setSiralama] = useState<{ alan: string; yon: "asc" | "desc" } | null>(null);
  const [sonuc, setSonuc] = useState<RaporSonucu | null>(null);
  const [gorunumler, setGorunumler] = useState<Gorunum[]>([]);
  const [gorunumAdi, setGorunumAdi] = useState("");
  const [firmaGeneli, setFirmaGeneli] = useState(false);
  const [cariler, setCariler] = useState<SecimKaydi[]>([]);
  const [stoklar, setStoklar] = useState<SecimKaydi[]>([]);
  const [etiketler, setEtiketler] = useState<SecimKaydi[]>([]);
  const [depolar, setDepolar] = useState<SecimKaydi[]>([]);
  const [hesaplar, setHesaplar] = useState<SecimKaydi[]>([]);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);

  const secilen = useMemo(
    () => raporlar.find((r) => r.kod === secilenKod) ?? null,
    [raporlar, secilenKod],
  );

  useEffect(() => {
    if (!tokenAl()) return;
    const qs = modul ? `?modul=${modul}` : "";
    api<RaporMeta[]>(`/raporlar${qs}`)
      .then((veri) => {
        setRaporlar(veri);
        if (veri.length > 0) setSecilenKod(veri[0].kod);
      })
      .catch((h) => setHata(h instanceof Error ? h.message : "Rapor kataloğu yüklenemedi"));
  }, [modul]);

  // Rapor değişince filtreleri sıfırla, görünümleri ve dinamik seçenekleri yükle
  useEffect(() => {
    if (!secilen) return;
    setFiltreler({});
    setGruplama(secilen.gruplamalar[0]?.deger ?? "");
    setSiralama(null);
    setSonuc(null);
    setHata("");
    void api<Gorunum[]>(`/raporlar/${secilen.kod}/gorunumler`)
      .then(setGorunumler)
      .catch(() => setGorunumler([]));
    const tipler = new Set(secilen.filtreler.map((f) => f.tip));
    if (tipler.has("cari") && cariler.length === 0) {
      void tumSayfalariAl<SecimKaydi>("/cari")
        .then(setCariler)
        .catch(() => undefined);
    }
    if (tipler.has("stok") && stoklar.length === 0) {
      void tumSayfalariAl<SecimKaydi>("/stok")
        .then(setStoklar)
        .catch(() => undefined);
    }
    if (tipler.has("depo") && depolar.length === 0) {
      void api<SecimKaydi[]>("/depo?yalnizAktif=true")
        .then(setDepolar)
        .catch(() => undefined);
    }
    // KSB-14: kasa/banka/POS hesapları tek listede; değer "tur:id".
    if (tipler.has("hesap") && hesaplar.length === 0) {
      type Hesap = { id: string; ad: string; dovizCinsi: string };
      void Promise.all([
        api<Hesap[]>("/kasa-banka/kasalar"),
        api<Hesap[]>("/kasa-banka/bankalar"),
        api<Hesap[]>("/kasa-banka/pos-hesaplari").catch(() => []),
      ])
        .then(([k, b, p]) =>
          setHesaplar([
            ...k.map((h) => ({ id: `kasa:${h.id}`, ad: `Kasa · ${h.ad} (${h.dovizCinsi})` })),
            ...b.map((h) => ({ id: `banka:${h.id}`, ad: `Banka · ${h.ad} (${h.dovizCinsi})` })),
            ...p.map((h) => ({ id: `pos:${h.id}`, ad: `POS · ${h.ad} (${h.dovizCinsi})` })),
          ]),
        )
        .catch(() => undefined);
    }
    if (tipler.has("etiket") && etiketler.length === 0) {
      void api<SecimKaydi[]>("/cari/etiketler")
        .then(setEtiketler)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secilen?.kod]);

  const girdiOlustur = useCallback(
    (ekSiralama?: { alan: string; yon: "asc" | "desc" } | null) => {
      const temiz: Record<string, string | number | boolean> = {};
      for (const [alan, deger] of Object.entries(filtreler)) {
        if (deger === "" || deger === undefined) continue;
        temiz[alan] = deger;
      }
      return {
        filtreler: temiz,
        ...(gruplama ? { gruplama } : {}),
        ...(ekSiralama ? { siralama: ekSiralama } : {}),
      };
    },
    [filtreler, gruplama],
  );

  const calistir = useCallback(
    async (ekSiralama?: { alan: string; yon: "asc" | "desc" } | null) => {
      if (!secilen) return;
      setYukleniyor(true);
      setHata("");
      try {
        const veri = await api<RaporSonucu>(`/raporlar/${secilen.kod}/calistir`, {
          method: "POST",
          body: JSON.stringify(girdiOlustur(ekSiralama ?? siralama)),
        });
        setSonuc(veri);
      } catch (h) {
        setHata(h instanceof Error ? h.message : "Rapor çalıştırılamadı");
      } finally {
        setYukleniyor(false);
      }
    },
    [secilen, girdiOlustur, siralama],
  );

  function basligaTiklandi(alan: string) {
    const yeni: { alan: string; yon: "asc" | "desc" } =
      siralama?.alan === alan && siralama.yon === "desc"
        ? { alan, yon: "asc" }
        : { alan, yon: "desc" };
    setSiralama(yeni);
    void calistir(yeni);
  }

  async function excelIndir() {
    if (!secilen) return;
    setHata("");
    try {
      const token = tokenAl();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/raporlar/${secilen.kod}/excel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(girdiOlustur(siralama)),
        },
      );
      if (!res.ok) throw new Error("Excel indirilemedi");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${secilen.kod.replace(/\./g, "-")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Excel indirilemedi");
    }
  }

  async function gorunumKaydet(e: React.FormEvent) {
    e.preventDefault();
    if (!secilen || !gorunumAdi.trim()) return;
    try {
      await api(`/raporlar/${secilen.kod}/gorunumler`, {
        method: "POST",
        body: JSON.stringify({
          ad: gorunumAdi.trim(),
          girdi: girdiOlustur(),
          firmaGeneli,
        }),
      });
      setGorunumAdi("");
      setFirmaGeneli(false);
      setGorunumler(await api<Gorunum[]>(`/raporlar/${secilen.kod}/gorunumler`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Görünüm kaydedilemedi");
    }
  }

  function gorunumUygula(g: Gorunum) {
    setFiltreler(g.girdi.filtreler ?? {});
    if (g.girdi.gruplama) setGruplama(g.girdi.gruplama);
  }

  async function gorunumSil(id: string) {
    if (!secilen) return;
    try {
      await api(`/raporlar/gorunumler/${id}`, { method: "DELETE" });
      setGorunumler(gorunumler.filter((g) => g.id !== id));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Görünüm silinemedi");
    }
  }

  function filtreGirdisi(f: RaporFiltreTanimi) {
    const deger = filtreler[f.alan] ?? "";
    const guncelle = (yeni: string | number | boolean) =>
      setFiltreler((eski) => ({ ...eski, [f.alan]: yeni }));

    switch (f.tip) {
      case "tarih":
        return <input className="input" type="date" value={String(deger)} onChange={(e) => guncelle(e.target.value)} />;
      case "sayi":
        return <input className="input" type="number" value={deger === "" ? "" : Number(deger)} onChange={(e) => guncelle(e.target.value === "" ? "" : Number(e.target.value))} />;
      case "onay":
        return <input type="checkbox" checked={deger === true} onChange={(e) => guncelle(e.target.checked)} style={{ width: "1.1rem", height: "1.1rem", marginTop: "0.6rem" }} />;
      case "secim":
        return (
          <select className="select" value={String(deger)} onChange={(e) => guncelle(e.target.value)}>
            <option value="">Tümü</option>
            {f.secenekler?.map((s) => (<option key={s.deger} value={s.deger}>{s.ad}</option>))}
          </select>
        );
      case "cari":
      case "stok":
      case "depo":
      case "hesap":
      case "etiket": {
        const kaynak =
          f.tip === "cari"
            ? cariler
            : f.tip === "stok"
              ? stoklar
              : f.tip === "depo"
                ? depolar
                : f.tip === "hesap"
                  ? hesaplar
                  : etiketler;
        return (
          <select aria-label={f.ad} className="select" value={String(deger)} onChange={(e) => guncelle(e.target.value)}>
            <option value="">{f.zorunlu ? "Seçiniz..." : "Tümü"}</option>
            {kaynak.map((k) => (<option key={k.id} value={k.id}>{k.unvan ?? k.ad ?? k.kod ?? k.id}</option>))}
          </select>
        );
      }
      default:
        return <input className="input" type="text" value={String(deger)} onChange={(e) => guncelle(e.target.value)} />;
    }
  }

  return (
    <div>
      <Alert tone="error">{hata}</Alert>

      <div className="row-tight" style={{ marginBottom: "1.5rem" }}>
        {raporlar.map((r) => (
          <Button
            key={r.kod}
            variant={r.kod === secilenKod ? "primary" : "ghost"}
            size="sm"
            onClick={() => setSecilenKod(r.kod)}
          >
            {modul ? r.ad : `${MODUL_ADLARI[r.modul] ?? r.modul} · ${r.ad}`}
          </Button>
        ))}
      </div>

      {secilen && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", margin: 0 }}>{secilen.ad}</h3>
              {secilen.aciklama && <p className="muted" style={{ fontSize: "0.85rem", margin: "0.25rem 0 0" }}>{secilen.aciklama}</p>}
            </div>
            {gorunumler.length > 0 && (
              <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                {gorunumler.map((g) => (
                  <span key={g.id} className="chip">
                    <button onClick={() => gorunumUygula(g)} title="Görünümü uygula" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                      {g.firmaGeneli ? "🏢" : "⭐"} {g.ad}
                    </button>
                    <button onClick={() => gorunumSil(g.id)} title="Sil">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: "1rem", alignItems: "flex-end", gap: "1rem" }}>
            {secilen.filtreler.map((f) => (
              <div key={f.alan} style={{ minWidth: f.tip === "onay" ? "auto" : 170 }}>
                <label className="field-label" style={{ display: "block", marginBottom: "0.3rem" }}>{f.ad}{f.zorunlu ? " *" : ""}</label>
                {filtreGirdisi(f)}
              </div>
            ))}
            {secilen.gruplamalar.length > 0 && (
              <div style={{ minWidth: 150 }}>
                <label className="field-label" style={{ display: "block", marginBottom: "0.3rem" }}>Kırılım</label>
                <select className="select" value={gruplama} onChange={(e) => setGruplama(e.target.value)}>
                  {secilen.gruplamalar.map((g) => (<option key={g.deger} value={g.deger}>{g.ad}</option>))}
                </select>
              </div>
            )}
            <Button variant="primary" onClick={() => void calistir()} disabled={yukleniyor}>
              {yukleniyor ? "Çalışıyor..." : "▶ Raporu Çalıştır"}
            </Button>
            <Button onClick={() => void excelIndir()}>📊 Excel</Button>
          </div>

          <form onSubmit={gorunumKaydet} className="row-tight" style={{ marginTop: "1rem" }}>
            <Input value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Bu filtre setini görünüm olarak kaydet..." style={{ maxWidth: 280 }} />
            <label className="field-label" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input type="checkbox" checked={firmaGeneli} onChange={(e) => setFirmaGeneli(e.target.checked)} />
              Firma geneli
            </label>
            <Button type="submit" size="sm">💾 Kaydet</Button>
          </form>
        </Card>
      )}

      {sonuc && (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {sonuc.kolonlar.map((k) => (
                    <th
                      key={k.alan}
                      onClick={() => basligaTiklandi(k.alan)}
                      title="Sıralamak için tıklayın"
                      className={SAYISAL.includes(k.tip) ? "num" : undefined}
                      style={{ cursor: "pointer" }}
                    >
                      {k.baslik}
                      {siralama?.alan === k.alan ? (siralama.yon === "desc" ? " ▼" : " ▲") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sonuc.satirlar.length === 0 ? (
                  <tr>
                    <td colSpan={sonuc.kolonlar.length} className="empty">Seçilen filtrelerle kayıt bulunamadı.</td>
                  </tr>
                ) : (
                  sonuc.satirlar.map((satir, i) => (
                    <tr key={i}>
                      {sonuc.kolonlar.map((k) => (
                        <td key={k.alan} className={SAYISAL.includes(k.tip) ? "num" : undefined} style={{ whiteSpace: "nowrap" }}>
                          {k.baglantiAlani && typeof satir[k.baglantiAlani] === "string" && String(satir[k.baglantiAlani]).startsWith("/panel/")
                            ? <a href={String(satir[k.baglantiAlani])}>{hucreBicimle(k, satir[k.alan] ?? null, satir)}</a>
                            : hucreBicimle(k, satir[k.alan] ?? null, satir)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="subtle" style={{ fontSize: "0.8rem", margin: "0.75rem 1rem" }}>{sonuc.satirlar.length} satır</p>
        </Card>
      )}
    </div>
  );
}
