"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { stil } from "@/lib/stil";

interface Firma {
  unvan: string;
  vkn: string;
  vergiDairesi?: string;
}

interface Baglanti {
  id: string;
  saglayici: string;
  durum: string;
  kullaniciAdiMaskeli: string;
}

const SAGLAYICILAR = ["izibiz", "foriba", "elogo", "uyumsoft"] as const;

export default function PanelSayfasi() {
  const yonlendir = useRouter();
  const [firma, setFirma] = useState<Firma | null>(null);
  const [baglantilar, setBaglantilar] = useState<Baglanti[]>([]);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try {
      setFirma(await api<Firma>("/firma"));
      setBaglantilar(await api<Baglanti[]>("/baglantilar"));
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) {
        tokenYaz(null);
        yonlendir.push("/giris");
      } else {
        setHata(h instanceof Error ? h.message : "Yükleme hatası");
      }
    }
  }, [yonlendir]);

  useEffect(() => {
    if (!tokenAl()) {
      yonlendir.push("/giris");
      return;
    }
    void yukle();
  }, [yonlendir, yukle]);

  async function baglantiEkle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHata("");
    const v = new FormData(e.currentTarget);
    try {
      await api("/baglantilar", {
        method: "POST",
        body: JSON.stringify({
          aile: "ebelge",
          saglayici: v.get("saglayici"),
          config: {
            kullaniciAdi: v.get("kullaniciAdi"),
            parola: v.get("parola") || undefined,
          },
        }),
      });
      await yukle();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Bağlantı eklenemedi");
    }
  }

  async function testEt(id: string) {
    setHata("");
    try {
      const s = await api<{ basarili: boolean; mesaj?: string }>(
        `/baglantilar/${id}/test`,
        { method: "POST" },
      );
      if (!s.basarili) setHata(s.mesaj ?? "Bağlantı testi başarısız");
      await yukle();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Test hatası");
    }
  }

  async function cikis() {
    await api("/auth/cikis", { method: "POST" }).catch(() => undefined);
    tokenYaz(null);
    yonlendir.push("/giris");
  }

  return (
    <main style={{ ...stil.sayfa, alignItems: "flex-start", paddingTop: "3rem" }}>
      <div style={{ ...stil.kart, maxWidth: 640 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h1>🐈 {firma?.unvan ?? "Yükleniyor…"}</h1>
          <button onClick={() => void cikis()} style={{ ...stil.dugme, width: "auto", padding: ".4rem .8rem" }}>
            Çıkış
          </button>
        </div>
        {firma && (
          <p style={{ color: "#57534e", fontSize: ".9rem" }}>
            VKN: {firma.vkn}
            {firma.vergiDairesi ? ` · ${firma.vergiDairesi}` : ""}
          </p>
        )}

        <h2 style={{ marginTop: "1.5rem" }}>e-Belge Bağlantısı</h2>
        {baglantilar.length === 0 ? (
          <form onSubmit={baglantiEkle}>
            <label>
              Entegratör
              <select name="saglayici" style={stil.girdi}>
                {SAGLAYICILAR.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kullanıcı adı
              <input name="kullaniciAdi" required style={stil.girdi} />
            </label>
            <label>
              Parola / API anahtarı
              <input name="parola" type="password" style={stil.girdi} />
            </label>
            <button style={stil.dugme}>Bağlantıyı kaydet</button>
          </form>
        ) : (
          <ul style={{ paddingLeft: 0, listStyle: "none" }}>
            {baglantilar.map((b) => (
              <li
                key={b.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: ".6rem 0",
                  borderBottom: "1px solid #e7e5e4",
                }}
              >
                <span>
                  <strong>{b.saglayici}</strong> · {b.kullaniciAdiMaskeli} ·{" "}
                  <span style={{ color: b.durum === "aktif" ? "#15803d" : "#a16207" }}>
                    {b.durum}
                  </span>
                </span>
                <button
                  onClick={() => void testEt(b.id)}
                  style={{ ...stil.dugme, width: "auto", padding: ".35rem .7rem" }}
                >
                  Bağlantı testi
                </button>
              </li>
            ))}
          </ul>
        )}
        {hata && <p style={stil.hata}>{hata}</p>}
      </div>
    </main>
  );
}
