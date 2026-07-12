"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";

/**
 * Ortak rapor paneli (RPR-06): rapor kataloğunu API meta verisinden çizer —
 * filtreler, gruplama, sıralama, Excel dışa aktarım ve kayıtlı görünümler
 * tüm raporlar için buradan gelir.
 */

interface RaporFiltreTanimi {
  alan: string;
  ad: string;
  tip: "tarih" | "metin" | "sayi" | "secim" | "onay" | "cari" | "stok" | "etiket";
  zorunlu?: boolean;
  secenekler?: { deger: string; ad: string }[];
}

interface RaporKolon {
  alan: string;
  baslik: string;
  tip: "metin" | "sayi" | "para" | "yuzde" | "tarih";
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
};

function hucreBicimle(
  kolon: RaporKolon,
  deger: string | number | boolean | null,
): string {
  if (deger === null || deger === undefined || deger === "") return "—";
  switch (kolon.tip) {
    case "para":
      return Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";
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
      void api<{ kayitlar: SecimKaydi[] }>("/cari?adet=200")
        .then((v) => setCariler(v.kayitlar))
        .catch(() => undefined);
    }
    if (tipler.has("stok") && stoklar.length === 0) {
      void api<{ kayitlar: SecimKaydi[] }>("/stok?adet=200")
        .then((v) => setStoklar(v.kayitlar))
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
        return (
          <input
            type="date"
            value={String(deger)}
            onChange={(e) => guncelle(e.target.value)}
            style={{ ...stil.girdi, margin: 0 }}
          />
        );
      case "sayi":
        return (
          <input
            type="number"
            value={deger === "" ? "" : Number(deger)}
            onChange={(e) => guncelle(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ ...stil.girdi, margin: 0 }}
          />
        );
      case "onay":
        return (
          <input
            type="checkbox"
            checked={deger === true}
            onChange={(e) => guncelle(e.target.checked)}
            style={{ width: "1.1rem", height: "1.1rem", marginTop: "0.6rem" }}
          />
        );
      case "secim":
        return (
          <select value={String(deger)} onChange={(e) => guncelle(e.target.value)} style={{ ...stil.girdi, margin: 0 }}>
            <option value="">Tümü</option>
            {f.secenekler?.map((s) => (
              <option key={s.deger} value={s.deger}>{s.ad}</option>
            ))}
          </select>
        );
      case "cari":
      case "stok":
      case "etiket": {
        const kaynak = f.tip === "cari" ? cariler : f.tip === "stok" ? stoklar : etiketler;
        return (
          <select value={String(deger)} onChange={(e) => guncelle(e.target.value)} style={{ ...stil.girdi, margin: 0 }}>
            <option value="">{f.zorunlu ? "Seçiniz..." : "Tümü"}</option>
            {kaynak.map((k) => (
              <option key={k.id} value={k.id}>
                {k.unvan ?? k.ad ?? k.kod ?? k.id}
              </option>
            ))}
          </select>
        );
      }
      default:
        return (
          <input
            type="text"
            value={String(deger)}
            onChange={(e) => guncelle(e.target.value)}
            style={{ ...stil.girdi, margin: 0 }}
          />
        );
    }
  }

  return (
    <div>
      {hata && <p style={stil.hata}>{hata}</p>}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {raporlar.map((r) => (
          <button
            key={r.kod}
            onClick={() => setSecilenKod(r.kod)}
            style={{
              ...stil.dugmeMuted,
              padding: "0.4rem 0.9rem",
              fontSize: "0.85rem",
              ...(r.kod === secilenKod
                ? { background: "rgba(124, 58, 237, 0.2)", borderColor: "#7c3aed", color: "#fafaf9" }
                : {}),
            }}
          >
            {modul ? r.ad : `${MODUL_ADLARI[r.modul] ?? r.modul} · ${r.ad}`}
          </button>
        ))}
      </div>

      {secilen && (
        <div style={{ ...stil.genisKart, marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: "bold" }}>{secilen.ad}</h3>
              {secilen.aciklama && (
                <p style={{ color: "#a1a1aa", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>{secilen.aciklama}</p>
              )}
            </div>
            {gorunumler.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                {gorunumler.map((g) => (
                  <span key={g.id} style={{ background: "#27272a", borderRadius: "999px", padding: "0.2rem 0.35rem 0.2rem 0.7rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                    <button onClick={() => gorunumUygula(g)} title="Görünümü uygula" style={{ background: "none", border: "none", color: "#fafaf9", cursor: "pointer", padding: 0 }}>
                      {g.firmaGeneli ? "🏢" : "⭐"} {g.ad}
                    </button>
                    <button onClick={() => gorunumSil(g.id)} title="Sil" style={{ background: "none", border: "none", color: "#a1a1aa", cursor: "pointer", padding: 0 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem", alignItems: "flex-end" }}>
            {secilen.filtreler.map((f) => (
              <div key={f.alan} style={{ minWidth: f.tip === "onay" ? "auto" : "170px" }}>
                <label style={{ fontSize: "0.8rem", color: "#a1a1aa", display: "block" }}>
                  {f.ad}{f.zorunlu ? " *" : ""}
                </label>
                {filtreGirdisi(f)}
              </div>
            ))}
            {secilen.gruplamalar.length > 0 && (
              <div style={{ minWidth: "150px" }}>
                <label style={{ fontSize: "0.8rem", color: "#a1a1aa", display: "block" }}>Kırılım</label>
                <select value={gruplama} onChange={(e) => setGruplama(e.target.value)} style={{ ...stil.girdi, margin: 0 }}>
                  {secilen.gruplamalar.map((g) => (
                    <option key={g.deger} value={g.deger}>{g.ad}</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={() => void calistir()} disabled={yukleniyor} style={{ ...stil.dugme, width: "auto", padding: "0.55rem 1.5rem" }}>
              {yukleniyor ? "Çalışıyor..." : "▶ Raporu Çalıştır"}
            </button>
            <button onClick={() => void excelIndir()} style={{ ...stil.dugmeMuted, padding: "0.55rem 1rem" }}>
              📊 Excel
            </button>
          </div>

          <form onSubmit={gorunumKaydet} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              value={gorunumAdi}
              onChange={(e) => setGorunumAdi(e.target.value)}
              placeholder="Bu filtre setini görünüm olarak kaydet..."
              style={{ ...stil.girdi, margin: 0, maxWidth: "280px" }}
            />
            <label style={{ fontSize: "0.8rem", color: "#a1a1aa", display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input type="checkbox" checked={firmaGeneli} onChange={(e) => setFirmaGeneli(e.target.checked)} />
              Firma geneli
            </label>
            <button type="submit" style={{ ...stil.dugmeMuted, padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
              💾 Kaydet
            </button>
          </form>
        </div>
      )}

      {sonuc && (
        <div style={stil.genisKart}>
          <div style={{ overflowX: "auto" }}>
            <table style={stil.tablo}>
              <thead>
                <tr>
                  {sonuc.kolonlar.map((k) => (
                    <th
                      key={k.alan}
                      onClick={() => basligaTiklandi(k.alan)}
                      title="Sıralamak için tıklayın"
                      style={{
                        ...stil.tabloBaslik,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        textAlign: ["para", "sayi", "yuzde"].includes(k.tip) ? "right" : "left",
                      }}
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
                    <td colSpan={sonuc.kolonlar.length} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>
                      Seçilen filtrelerle kayıt bulunamadı.
                    </td>
                  </tr>
                ) : (
                  sonuc.satirlar.map((satir, i) => (
                    <tr key={i}>
                      {sonuc.kolonlar.map((k) => (
                        <td
                          key={k.alan}
                          style={{
                            ...stil.tabloHucre,
                            textAlign: ["para", "sayi", "yuzde"].includes(k.tip) ? "right" : "left",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hucreBicimle(k, satir[k.alan] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p style={{ color: "#a1a1aa", fontSize: "0.8rem", margin: "0.75rem 0 0" }}>
            {sonuc.satirlar.length} satır
          </p>
        </div>
      )}
    </div>
  );
}
