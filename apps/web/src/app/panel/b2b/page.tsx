"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  PageHeader,
  SearchInput,
  Stat,
  StatGrid,
} from "@/components/ui";

interface Urun {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
  listeFiyati: number;
  bayiBirimFiyati: number;
  iskontoYuzdesi: number;
}

interface SepetKalem {
  urun: Urun;
  miktar: number;
}

interface Cari {
  id: string;
  unvan: string;
  kod: string;
}

export default function B2bKatalogSayfasi() {
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [sepet, setSepet] = useState<SepetKalem[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [siparisGonderildi, setSiparisGonderildi] = useState(false);
  const [seciliCariId, setSeciliCariId] = useState("");
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const fetchCariler = useCallback(async () => {
    try {
      const data = await api<{ kayitlar: Cari[] }>("/cari?adet=50");
      if (data?.kayitlar) {
        setCariler(data.kayitlar);
        if (data.kayitlar.length > 0) setSeciliCariId(data.kayitlar[0].id);
      }
    } catch (e) {
      console.error(e);
      setHata("Cari listesi alınamadı.");
    }
  }, []);

  const fetchKatalog = useCallback(async (cariId: string) => {
    setYukleniyor(true);
    setHata("");
    try {
      const data = await api<Urun[]>(`/b2b/katalog/${cariId}`);
      setUrunler(data || []);
    } catch (e) {
      console.error(e);
      setHata("Bayi kataloğu yüklenirken bir hata oluştu.");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void fetchCariler();
  }, [fetchCariler]);

  useEffect(() => {
    if (seciliCariId) {
      void fetchKatalog(seciliCariId);
    }
  }, [seciliCariId, fetchKatalog]);

  const sepeteEkle = (urun: Urun) => {
    setSepet((prev) => {
      const mevcut = prev.find((item) => item.urun.id === urun.id);
      if (mevcut) {
        return prev.map((item) =>
          item.urun.id === urun.id ? { ...item, miktar: item.miktar + 1 } : item
        );
      }
      return [...prev, { urun, miktar: 1 }];
    });
  };

  const miktarDegistir = (urunId: string, yeniMiktar: number) => {
    if (yeniMiktar <= 0) {
      setSepet((prev) => prev.filter((item) => item.urun.id !== urunId));
    } else {
      setSepet((prev) =>
        prev.map((item) => (item.urun.id === urunId ? { ...item, miktar: yeniMiktar } : item))
      );
    }
  };

  const sepetToplam = sepet.reduce(
    (toplam, item) => toplam + Number(item.urun.bayiBirimFiyati) * item.miktar,
    0
  );

  const siparisVer = async () => {
    if (sepet.length === 0 || !seciliCariId) return;
    setHata("");
    setBasari("");

    try {
      await api("/b2b/siparis", {
        method: "POST",
        body: JSON.stringify({
          cariId: seciliCariId,
          kalemler: sepet.map((item) => ({ stokId: item.urun.id, miktar: item.miktar })),
          aciklama: "B2B Bayi Sipariş Portalı Siparişi",
        }),
      });

      setSiparisGonderildi(true);
      setBasari("🎉 Siparişiniz başarıyla alındı ve sipariş sistemimize aktarıldı!");
      setSepet([]);
      setTimeout(() => setSiparisGonderildi(false), 5000);
    } catch (e) {
      console.error(e);
      setHata(e instanceof Error ? e.message : "Sipariş iletilirken hata oluştu.");
    }
  };

  const filtrelenmisUrunler = urunler.filter((u) => {
    const s = arama.trim().toLowerCase();
    if (!s) return true;
    return u.ad.toLowerCase().includes(s) || u.kod.toLowerCase().includes(s);
  });

  const seciliCari = cariler.find((c) => c.id === seciliCariId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PageHeader
        title="🛒 B2B Bayi Sipariş Portalı"
        subtitle="Bayilerinize özel tanımlı iskonto ve fiyat listeleri ile hızlı ve kolay online sipariş."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)" }}>
              Aktif Bayi:
            </span>
            <select
              value={seciliCariId}
              onChange={(e) => setSeciliCariId(e.target.value)}
              style={{
                padding: "0.45rem 0.75rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text)",
                boxShadow: "var(--shadow)",
              }}
            >
              {cariler.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.unvan} ({c.kod})
                </option>
              ))}
            </select>
          </div>
        }
      />

      <Alert tone="error">{hata}</Alert>
      {siparisGonderildi && <Alert tone="success">{basari}</Alert>}

      {/* Özet İstatistik Kartları */}
      <StatGrid>
        <Stat
          label="Aktif Bayi Ünvanı"
          value={seciliCari ? seciliCari.unvan : "Seçilmedi"}
          hint={seciliCari ? `Cari Kodu: ${seciliCari.kod}` : undefined}
        />
        <Stat
          label="Katalogdaki Ürün Sayısı"
          value={urunler.length.toString()}
          hint="Özel Fiyatlı Ürünler"
        />
        <Stat
          label="Sepetteki Ürün Çeşidi"
          value={sepet.length.toString()}
          hint={`Toplam ${sepet.reduce((a, b) => a + b.miktar, 0)} Adet`}
        />
        <Stat
          label="Sepet Net Toplamı"
          value={`${(sepetToplam * 1.2).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`}
          hint="KDV Dahil Tahmini"
        />
      </StatGrid>

      {/* Arama Araç Çubuğu */}
      <div className="toolbar">
        <SearchInput
          className="grow"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Katalog içinde ürün adına veya stok koduna göre ara..."
        />
      </div>

      {/* Katalog ve Sepet Grid Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: "1.5rem",
          alignItems: "start",
        }}
      >
        {/* Ürün Kataloğu */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text)" }}>
              Ürün Kataloğunuz
            </h2>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {filtrelenmisUrunler.length} ürün listeleniyor
            </span>
          </div>

          {yukleniyor ? (
            <Card style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
              Katalog yükleniyor...
            </Card>
          ) : filtrelenmisUrunler.length === 0 ? (
            <Card style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
              Arama kriterlerinize uygun aktif ürün bulunamadı.
            </Card>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "1rem",
              }}
            >
              {filtrelenmisUrunler.map((u) => {
                const sepetteki = sepet.find((s) => s.urun.id === u.id);
                return (
                  <div
                    key={u.id}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      padding: "1.25rem",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "1rem",
                      boxShadow: "var(--shadow)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {/* Kart Üst */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            padding: "0.15rem 0.45rem",
                            borderRadius: "var(--radius-sm)",
                            background: "var(--surface-2)",
                            border: "1px solid var(--border)",
                            color: "var(--text-muted)",
                          }}
                        >
                          {u.kod}
                        </span>
                        {u.iskontoYuzdesi > 0 ? (
                          <Badge variant="success">%{u.iskontoYuzdesi} İskonto</Badge>
                        ) : (
                          <span style={{ fontSize: "0.72rem", color: "var(--text-subtle)" }}>
                            Liste Fiyatı
                          </span>
                        )}
                      </div>

                      <h3
                        style={{
                          fontSize: "0.95rem",
                          fontWeight: 700,
                          color: "var(--text)",
                          margin: 0,
                          lineHeight: 1.3,
                        }}
                      >
                        {u.ad}
                      </h3>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        Birim: <strong style={{ color: "var(--text)" }}>{u.anaBirim}</strong>
                      </div>
                    </div>

                    {/* Kart Alt / Fiyat & Buton */}
                    <div
                      style={{
                        borderTop: "1px solid var(--border)",
                        paddingTop: "0.75rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        {u.iskontoYuzdesi > 0 && (
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--text-subtle)",
                              textDecoration: "line-through",
                            }}
                          >
                            {Number(u.listeFiyati).toLocaleString("tr-TR", {
                              minimumFractionDigits: 2,
                            })}{" "}
                            TL
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: "1.2rem",
                            fontWeight: 800,
                            color: "var(--accent-text)",
                          }}
                        >
                          {Number(u.bayiBirimFiyati).toLocaleString("tr-TR", {
                            minimumFractionDigits: 2,
                          })}{" "}
                          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>TL</span>
                        </div>
                      </div>

                      {sepetteki ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            background: "var(--accent-soft)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "0.25rem 0.5rem",
                          }}
                        >
                          <button
                            onClick={() => miktarDegistir(u.id, sepetteki.miktar - 1)}
                            style={{
                              width: "28px",
                              height: "28px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border)",
                              background: "var(--surface)",
                              cursor: "pointer",
                              fontWeight: 700,
                              color: "var(--accent-text)",
                            }}
                          >
                            -
                          </button>
                          <span
                            style={{
                              fontSize: "0.85rem",
                              fontWeight: 700,
                              color: "var(--accent-text)",
                            }}
                          >
                            {sepetteki.miktar} {u.anaBirim}
                          </span>
                          <button
                            onClick={() => miktarDegistir(u.id, sepetteki.miktar + 1)}
                            style={{
                              width: "28px",
                              height: "28px",
                              borderRadius: "var(--radius-sm)",
                              border: "none",
                              background: "var(--accent)",
                              color: "#fff",
                              cursor: "pointer",
                              fontWeight: 700,
                            }}
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => sepeteEkle(u)}
                          variant="primary"
                          style={{ width: "100%", justifyContent: "center" }}
                        >
                          🛒 Sepete Ekle
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sepet Kartı */}
        <Card style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>🛒 Sipariş Sepeti</h2>
            <Badge variant="info">
              {sepet.reduce((a, b) => a + b.miktar, 0)} Ürün
            </Badge>
          </div>

          {sepet.length === 0 ? (
            <div
              style={{
                padding: "2rem 0",
                textAlign: "center",
                fontSize: "0.82rem",
                color: "var(--text-muted)",
              }}
            >
              Sepetiniz boş. Katalogdan ürün ekleyebilirsiniz.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                  maxHeight: "360px",
                  overflowY: "auto",
                }}
              >
                {sepet.map((item) => (
                  <div
                    key={item.urun.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "0.83rem",
                      paddingBottom: "0.5rem",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{item.urun.ad}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {Number(item.urun.bayiBirimFiyati).toLocaleString("tr-TR")} TL x {item.miktar}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <input
                        type="number"
                        min="1"
                        value={item.miktar}
                        onChange={(e) => miktarDegistir(item.urun.id, Number(e.target.value))}
                        style={{
                          width: "48px",
                          padding: "0.2rem",
                          textAlign: "center",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border)",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                        }}
                      />
                      <button
                        onClick={() => miktarDegistir(item.urun.id, 0)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--danger)",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  borderTop: "2px solid var(--border)",
                  paddingTop: "0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                  }}
                >
                  <span>Toplam (KDV Dahil):</span>
                  <span style={{ color: "var(--accent-text)" }}>
                    {(sepetToplam * 1.2).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </span>
                </div>

                <Button
                  onClick={siparisVer}
                  variant="primary"
                  style={{ width: "100%", justifyContent: "center", padding: "0.65rem" }}
                >
                  Siparişi Onayla & İlet 🚀
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
