"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";

interface Kasa {
  id: string;
  ad: string;
  dovizCinsi: string;
  bakiye: string;
}

interface Banka {
  id: string;
  ad: string;
  bankaAdi: string;
  hesapNo: string | null;
  iban: string | null;
  dovizCinsi: string;
  bakiye: string;
}

interface Cari {
  id: string;
  unvan: string;
}

interface Hareket {
  id: string;
  tarih: string;
  tip: string;
  tutar: string;
  dovizCinsi: string;
  aciklama: string | null;
  kasa?: { ad: string } | null;
  bankaHesap?: { ad: string } | null;
  cari?: { unvan: string } | null;
}

export default function KasaBankaSayfasi() {
  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [bankalar, setBankalar] = useState<Banka[]>([]);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  // Modallar / Formlar Görünürlük
  const [kasaFormAcik, setKasaFormAcik] = useState(false);
  const [bankaFormAcik, setBankaFormAcik] = useState(false);
  const [hareketFormAcik, setHareketFormAcik] = useState(false);
  const [virmanFormAcik, setVirmanFormAcik] = useState(false);

  // Kasa Oluştur Form Alanları
  const [kasaAd, setKasaAd] = useState("");
  const [kasaDoviz, setKasaDoviz] = useState("TRY");

  // Banka Oluştur Form Alanları
  const [bankaAd, setBankaAd] = useState("");
  const [bankaIsim, setBankaIsim] = useState("");
  const [bankaHesapNo, setBankaHesapNo] = useState("");
  const [bankaIban, setBankaIban] = useState("");
  const [bankaDoviz, setBankaDoviz] = useState("TRY");

  // Tahsilat / Tediye Form Alanları
  const [hareketHesapSecimi, setHareketHesapSecimi] = useState(""); // "kasa:id" veya "banka:id"
  const [hareketTip, setHareketTip] = useState("tahsilat");
  const [hareketTutar, setHareketTutar] = useState("");
  const [hareketCariId, setHareketCariId] = useState("");
  const [hareketTarih, setHareketTarih] = useState(new Date().toISOString().substring(0, 10));
  const [hareketAciklama, setHareketAciklama] = useState("");

  // Virman Form Alanları
  const [virmanKaynakSecimi, setVirmanKaynakSecimi] = useState(""); // "kasa:id" veya "banka:id"
  const [virmanHedefSecimi, setVirmanHedefSecimi] = useState(""); // "kasa:id" veya "banka:id"
  const [virmanTutar, setVirmanTutar] = useState("");
  const [virmanTarih, setVirmanTarih] = useState(new Date().toISOString().substring(0, 10));
  const [virmanAciklama, setVirmanAciklama] = useState("");

  const yukle = useCallback(async () => {
    try {
      const kVeri = await api<Kasa[]>("/kasa-banka/kasalar");
      setKasalar(kVeri);

      const bVeri = await api<Banka[]>("/kasa-banka/bankalar");
      setBankalar(bVeri);

      const hVeri = await api<Hareket[]>("/kasa-banka/hareketler");
      setHareketler(hVeri);

      const cVeri = await api<{ kayitlar: Cari[] }>("/cari?adet=100");
      setCariler(cVeri.kayitlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme hatası");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  async function kasaKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/kasa-banka/kasalar", {
        method: "POST",
        body: JSON.stringify({ ad: kasaAd, dovizCinsi: kasaDoviz }),
      });
      setBasari("Yeni kasa hesabı başarıyla açıldı.");
      setKasaFormAcik(false);
      setKasaAd("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kasa açılamadı");
    }
  }

  async function bankaKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/kasa-banka/bankalar", {
        method: "POST",
        body: JSON.stringify({
          ad: bankaAd,
          bankaAdi: bankaIsim,
          hesapNo: bankaHesapNo || null,
          iban: bankaIban || null,
          dovizCinsi: bankaDoviz,
        }),
      });
      setBasari("Yeni banka hesabı başarıyla açıldı.");
      setBankaFormAcik(false);
      setBankaAd("");
      setBankaIsim("");
      setBankaHesapNo("");
      setBankaIban("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Banka hesabı açılamadı");
    }
  }

  async function hareketKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");

    if (!hareketHesapSecimi) {
      setHata("Lütfen işlem yapacağınız kasayı veya bankayı seçin.");
      return;
    }

    const [hesapTipi, hesapId] = hareketHesapSecimi.split(":");
    const kasaId = hesapTipi === "kasa" ? hesapId : null;
    const bankaHesapId = hesapTipi === "banka" ? hesapId : null;

    // Döviz cinsini seçilen kasadan/bankadan bulalım
    let dovizCinsi = "TRY";
    if (kasaId) {
      dovizCinsi = kasalar.find((k) => k.id === kasaId)?.dovizCinsi ?? "TRY";
    } else if (bankaHesapId) {
      dovizCinsi = bankalar.find((b) => b.id === bankaHesapId)?.dovizCinsi ?? "TRY";
    }

    try {
      await api("/kasa-banka/hareketler", {
        method: "POST",
        body: JSON.stringify({
          kasaId,
          bankaHesapId,
          tip: hareketTip,
          tutar: String(hareketTutar),
          dovizCinsi,
          tarih: hareketTarih,
          aciklama: hareketAciklama || null,
          cariId: hareketCariId || null,
        }),
      });

      setBasari("İşlem başarıyla kaydedildi.");
      setHareketFormAcik(false);
      setHareketTutar("");
      setHareketAciklama("");
      setHareketCariId("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem kaydedilemedi");
    }
  }

  async function virmanKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");

    if (!virmanKaynakSecimi || !virmanHedefSecimi) {
      setHata("Lütfen kaynak ve hedef hesapları seçin.");
      return;
    }

    if (virmanKaynakSecimi === virmanHedefSecimi) {
      setHata("Kaynak ve hedef hesap aynı olamaz.");
      return;
    }

    const [kType, kId] = virmanKaynakSecimi.split(":");
    const [hType, hId] = virmanHedefSecimi.split(":");

    // Döviz cinsi doğrulaması
    let kDoviz = "";
    if (kType === "kasa") kDoviz = kasalar.find((k) => k.id === kId)?.dovizCinsi ?? "";
    else kDoviz = bankalar.find((b) => b.id === kId)?.dovizCinsi ?? "";

    let hDoviz = "";
    if (hType === "kasa") hDoviz = kasalar.find((k) => k.id === hId)?.dovizCinsi ?? "";
    else hDoviz = bankalar.find((b) => b.id === hId)?.dovizCinsi ?? "";

    if (kDoviz !== hDoviz) {
      setHata(`Virman işlemi sadece aynı döviz cinsindeki hesaplar arasında yapılabilir. (${kDoviz} -> ${hDoviz} yapılamaz)`);
      return;
    }

    try {
      await api("/kasa-banka/virman", {
        method: "POST",
        body: JSON.stringify({
          kaynakKasaId: kType === "kasa" ? kId : null,
          kaynakBankaHesapId: kType === "banka" ? kId : null,
          hedefKasaId: hType === "kasa" ? hId : null,
          hedefBankaHesapId: hType === "banka" ? hId : null,
          tutar: String(virmanTutar),
          tarih: virmanTarih,
          aciklama: virmanAciklama || null,
        }),
      });

      setBasari("Virman işlemi başarıyla tamamlandı.");
      setVirmanFormAcik(false);
      setVirmanTutar("");
      setVirmanAciklama("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Virman işlemi yapılamadı");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>🏦 Kasa & Banka Yönetimi</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Nakit kasalarınızı, banka hesaplarınızı yönetin, fiş girişleri ve virman işlemlerini yapın.
          </p>
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <button onClick={() => { setVirmanFormAcik(false); setKasaFormAcik(false); setBankaFormAcik(false); setHareketFormAcik(!hareketFormAcik); }} style={{ ...stil.dugme, width: "auto", padding: "0.5rem 1.25rem" }}>
            {hareketFormAcik ? "Vazgeç" : "💵 Fiş Girişi (Gelir/Gider)"}
          </button>
          <button onClick={() => { setHareketFormAcik(false); setKasaFormAcik(false); setBankaFormAcik(false); setVirmanFormAcik(!virmanFormAcik); }} style={{ ...stil.dugme, width: "auto", padding: "0.5rem 1.25rem", background: "#7c3aed" }}>
            {virmanFormAcik ? "Vazgeç" : "🔄 Virman (Para Transferi)"}
          </button>
        </div>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}
      {basari && <p style={stil.basari}>{basari}</p>}

      {/* ─── YENİ KASA HESABI FORMU ────────────────────────────────────────── */}
      {kasaFormAcik && (
        <form onSubmit={kasaKaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "500px" }}>
          <h3 style={{ margin: "0 0 1.25rem", fontSize: "1.05rem", fontWeight: "bold" }}>Yeni Nakit Kasa Hesabı Aç</h3>
          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Kasa Adı</label>
          <input type="text" value={kasaAd} onChange={(e) => setKasaAd(e.target.value)} style={stil.girdi} required placeholder="Örn. Merkez Kasa, TL Kasası" />
          
          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Döviz Cinsi</label>
          <select value={kasaDoviz} onChange={(e) => setKasaDoviz(e.target.value)} style={stil.girdi}>
            <option value="TRY">TRY - Türk Lirası</option>
            <option value="USD">USD - Amerikan Doları</option>
            <option value="EUR">EUR - Euro</option>
          </select>
          <button type="submit" style={stil.dugme}>Kasa Oluştur</button>
        </form>
      )}

      {/* ─── YENİ BANKA HESABI FORMU ────────────────────────────────────────── */}
      {bankaFormAcik && (
        <form onSubmit={bankaKaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "500px" }}>
          <h3 style={{ margin: "0 0 1.25rem", fontSize: "1.05rem", fontWeight: "bold" }}>Yeni Banka Hesabı Tanımla</h3>
          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Hesap Adı</label>
          <input type="text" value={bankaAd} onChange={(e) => setBankaAd(e.target.value)} style={stil.girdi} required placeholder="Örn. Garanti Ticari, Akbank USD" />

          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Banka İsmi</label>
          <input type="text" value={bankaIsim} onChange={(e) => setBankaIsim(e.target.value)} style={stil.girdi} required placeholder="Örn. Garanti BBVA" />

          <div style={{ display: "flex", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Hesap No</label>
              <input type="text" value={bankaHesapNo} onChange={(e) => setBankaHesapNo(e.target.value)} style={stil.girdi} placeholder="1234-56789" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Döviz Cinsi</label>
              <select value={bankaDoviz} onChange={(e) => setBankaDoviz(e.target.value)} style={stil.girdi}>
                <option value="TRY">TRY</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>

          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>IBAN</label>
          <input type="text" value={bankaIban} onChange={(e) => setBankaIban(e.target.value)} style={stil.girdi} placeholder="TR00..." />

          <button type="submit" style={stil.dugme}>Banka Hesabı Kaydet</button>
        </form>
      )}

      {/* ─── TAHSİLAT / TEDİYE (FİŞ) FORMU ──────────────────────────────────── */}
      {hareketFormAcik && (
        <form onSubmit={hareketKaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "600px" }}>
          <h3 style={{ margin: "0 0 1.25rem", fontSize: "1.1rem", fontWeight: "bold" }}>Tahsilat / Ödeme Fişi Düzenle</h3>
          
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Kasa / Banka Seçimi</label>
              <select value={hareketHesapSecimi} onChange={(e) => setHareketHesapSecimi(e.target.value)} style={stil.girdi} required>
                <option value="">-- Hesap Seçiniz --</option>
                <optgroup label="💵 Nakit Kasalar">
                  {kasalar.map((k) => (
                    <option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi}) - Bakiye: {Number(k.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {k.dovizCinsi}</option>
                  ))}
                </optgroup>
                <optgroup label="🏦 Banka Hesapları">
                  {bankalar.map((b) => (
                    <option key={b.id} value={`banka:${b.id}`}>{b.ad} - {b.bankaAdi} ({b.dovizCinsi}) - Bakiye: {Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {b.dovizCinsi}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>İşlem Tipi</label>
              <select value={hareketTip} onChange={(e) => setHareketTip(e.target.value)} style={stil.girdi}>
                <option value="tahsilat">Tahsilat (Para Girişi)</option>
                <option value="tediye">Tediye / Ödeme (Para Çıkışı)</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Cari Hesap İlişkisi</label>
              <select value={hareketCariId} onChange={(e) => setHareketCariId(e.target.value)} style={stil.girdi}>
                <option value="">-- Cari Seçilmeyebilir (Genel Fiş) --</option>
                {cariler.map((c) => (
                  <option key={c.id} value={c.id}>{c.unvan}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Tutar</label>
              <input type="number" step="0.01" min="0.01" value={hareketTutar} onChange={(e) => setHareketTutar(e.target.value)} style={stil.girdi} required placeholder="0.00" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Tarih</label>
              <input type="date" value={hareketTarih} onChange={(e) => setHareketTarih(e.target.value)} style={stil.girdi} required />
            </div>
          </div>

          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Açıklama</label>
          <input type="text" value={hareketAciklama} onChange={(e) => setHareketAciklama(e.target.value)} style={stil.girdi} placeholder="Örn. Tahsilat makbuzu 123 veya Ofis gideri" />

          <button type="submit" style={stil.dugme}>Fişi Kaydet</button>
        </form>
      )}

      {/* ─── VİRMAN (TRANSFER) FORMU ────────────────────────────────────────── */}
      {virmanFormAcik && (
        <form onSubmit={virmanKaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "600px" }}>
          <h3 style={{ margin: "0 0 1.25rem", fontSize: "1.1rem", fontWeight: "bold" }}>Hesaplar Arası Virman (Para Transferi)</h3>
          
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Kaynak Hesap (Çıkış yapılacak)</label>
              <select value={virmanKaynakSecimi} onChange={(e) => setVirmanKaynakSecimi(e.target.value)} style={stil.girdi} required>
                <option value="">-- Çıkış Hesabı --</option>
                <optgroup label="💵 Nakit Kasalar">
                  {kasalar.map((k) => (
                    <option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi})</option>
                  ))}
                </optgroup>
                <optgroup label="🏦 Banka Hesapları">
                  {bankalar.map((b) => (
                    <option key={b.id} value={`banka:${b.id}`}>{b.ad} - {b.bankaAdi} ({b.dovizCinsi})</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Hedef Hesap (Giriş yapılacak)</label>
              <select value={virmanHedefSecimi} onChange={(e) => setVirmanHedefSecimi(e.target.value)} style={stil.girdi} required>
                <option value="">-- Giriş Hesabı --</option>
                <optgroup label="💵 Nakit Kasalar">
                  {kasalar.map((k) => (
                    <option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi})</option>
                  ))}
                </optgroup>
                <optgroup label="🏦 Banka Hesapları">
                  {bankalar.map((b) => (
                    <option key={b.id} value={`banka:${b.id}`}>{b.ad} - {b.bankaAdi} ({b.dovizCinsi})</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Transfer Tutarı</label>
              <input type="number" step="0.01" min="0.01" value={virmanTutar} onChange={(e) => setVirmanTutar(e.target.value)} style={stil.girdi} required placeholder="0.00" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Tarih</label>
              <input type="date" value={virmanTarih} onChange={(e) => setVirmanTarih(e.target.value)} style={stil.girdi} required />
            </div>
          </div>

          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Açıklama</label>
          <input type="text" value={virmanAciklama} onChange={(e) => setVirmanAciklama(e.target.value)} style={stil.girdi} placeholder="Örn. Bankadan kasaya nakit çekim" />

          <button type="submit" style={{ ...stil.dugme, background: "#7c3aed" }}>Virman İşlemini Gerçekleştir</button>
        </form>
      )}

      {/* ─── HESAP BAKİYELERİ GRİDİ ─────────────────────────────────────────── */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1.2rem", fontWeight: "600", marginBottom: "1rem", color: "#a1a1aa" }}>💼 Hesap Bakiyeleri</h2>
        <div style={stil.grid}>
          <div style={{ ...stil.genisKart, flex: 1, minWidth: "300px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>💵 Nakit Kasalar</h3>
              <button onClick={() => { setBankaFormAcik(false); setKasaFormAcik(!kasaFormAcik); }} style={stil.dugmeMuted}>+ Kasa Ekle</button>
            </div>
            <table style={stil.tablo}>
              <thead>
                <tr>
                  <th style={stil.tabloBaslik}>Kasa Adı</th>
                  <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Mevcut Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {kasalar.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>Nakit kasa hesabı bulunmuyor.</td>
                  </tr>
                ) : (
                  kasalar.map((k) => (
                    <tr key={k.id}>
                      <td style={{ ...stil.tabloHucre, fontWeight: "bold" }}>{k.ad}</td>
                      <td style={{ ...stil.tabloHucre, textAlign: "right", color: "#22c55e", fontWeight: "bold" }}>
                        {Number(k.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {k.dovizCinsi}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ ...stil.genisKart, flex: 1, minWidth: "300px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>🏦 Banka Hesapları</h3>
              <button onClick={() => { setKasaFormAcik(false); setBankaFormAcik(!bankaFormAcik); }} style={stil.dugmeMuted}>+ Banka Ekle</button>
            </div>
            <table style={stil.tablo}>
              <thead>
                <tr>
                  <th style={stil.tabloBaslik}>Hesap / Banka</th>
                  <th style={stil.tabloBaslik}>IBAN</th>
                  <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Mevcut Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {bankalar.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>Banka hesabı bulunmuyor.</td>
                  </tr>
                ) : (
                  bankalar.map((b) => (
                    <tr key={b.id}>
                      <td style={stil.tabloHucre}>
                        <span style={{ fontWeight: "bold", display: "block" }}>{b.ad}</span>
                        <span style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>{b.bankaAdi} {b.hesapNo ? `· No: ${b.hesapNo}` : ""}</span>
                      </td>
                      <td style={stil.tabloHucre}>{b.iban || "-"}</td>
                      <td style={{ ...stil.tabloHucre, textAlign: "right", color: "#22c55e", fontWeight: "bold" }}>
                        {Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {b.dovizCinsi}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── SON HAREKETLER ─────────────────────────────────────────────────── */}
      <section style={stil.genisKart}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: "600", marginBottom: "1rem" }}>🔄 Son Kasa & Banka Fişleri</h2>
        <table style={stil.tablo}>
          <thead>
            <tr>
              <th style={stil.tabloBaslik}>Tarih</th>
              <th style={stil.tabloBaslik}>Hesap</th>
              <th style={stil.tabloBaslik}>İşlem Tipi</th>
              <th style={stil.tabloBaslik}>Cari Muhatap</th>
              <th style={stil.tabloBaslik}>Açıklama</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Tutar</th>
            </tr>
          </thead>
          <tbody>
            {hareketler.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>Henüz bir kasa/banka hareketi girilmemiş.</td>
              </tr>
            ) : (
              hareketler.map((h) => {
                const hesapAd = h.kasa?.ad ?? h.bankaHesap?.ad ?? "-";
                const isTahsilat = h.tip === "tahsilat";

                return (
                  <tr key={h.id}>
                    <td style={stil.tabloHucre}>{h.tarih}</td>
                    <td style={{ ...stil.tabloHucre, fontWeight: "500" }}>{hesapAd}</td>
                    <td style={stil.tabloHucre}>
                      {isTahsilat ? (
                        <span style={{ color: "#22c55e", fontWeight: "bold" }}>📥 Gelir / Tahsilat</span>
                      ) : (
                        <span style={{ color: "#ef4444", fontWeight: "bold" }}>📤 Gider / Tediye</span>
                      )}
                    </td>
                    <td style={stil.tabloHucre}>{h.cari?.unvan ?? "(Cari Yok)"}</td>
                    <td style={stil.tabloHucre}>{h.aciklama || "-"}</td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: isTahsilat ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                      {isTahsilat ? "+" : "-"}{Number(h.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {h.dovizCinsi}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
