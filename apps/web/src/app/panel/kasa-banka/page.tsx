"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  TableWrap,
} from "@/components/ui";

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

const para = (deger: string | number, doviz: string): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + doviz;

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
      setKasalar(await api<Kasa[]>("/kasa-banka/kasalar"));
      setBankalar(await api<Banka[]>("/kasa-banka/bankalar"));
      setHareketler(await api<Hareket[]>("/kasa-banka/hareketler"));
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
      <PageHeader
        title="Kasa & Banka Yönetimi"
        subtitle="Nakit kasalarınızı, banka hesaplarınızı yönetin, fiş girişleri ve virman işlemlerini yapın."
        actions={
          <>
            <Button variant="primary" onClick={() => { setVirmanFormAcik(false); setKasaFormAcik(false); setBankaFormAcik(false); setHareketFormAcik(!hareketFormAcik); }}>
              {hareketFormAcik ? "Vazgeç" : "💵 Fiş Girişi"}
            </Button>
            <Button onClick={() => { setHareketFormAcik(false); setKasaFormAcik(false); setBankaFormAcik(false); setVirmanFormAcik(!virmanFormAcik); }}>
              {virmanFormAcik ? "Vazgeç" : "🔄 Virman"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {/* ─── YENİ KASA HESABI FORMU ────────────────────────────────────────── */}
      {kasaFormAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 500 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Yeni Nakit Kasa Hesabı Aç</h3>
          <Field label="Kasa Adı"><Input value={kasaAd} onChange={(e) => setKasaAd(e.target.value)} required placeholder="Örn. Merkez Kasa, TL Kasası" /></Field>
          <Field label="Döviz Cinsi">
            <Select value={kasaDoviz} onChange={(e) => setKasaDoviz(e.target.value)}>
              <option value="TRY">TRY - Türk Lirası</option>
              <option value="USD">USD - Amerikan Doları</option>
              <option value="EUR">EUR - Euro</option>
            </Select>
          </Field>
          <div><Button variant="primary" onClick={kasaKaydet}>Kasa Oluştur</Button></div>
        </Card>
      )}

      {/* ─── YENİ BANKA HESABI FORMU ────────────────────────────────────────── */}
      {bankaFormAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 500 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Yeni Banka Hesabı Tanımla</h3>
          <Field label="Hesap Adı"><Input value={bankaAd} onChange={(e) => setBankaAd(e.target.value)} required placeholder="Örn. Garanti Ticari, Akbank USD" /></Field>
          <Field label="Banka İsmi"><Input value={bankaIsim} onChange={(e) => setBankaIsim(e.target.value)} required placeholder="Örn. Garanti BBVA" /></Field>
          <div className="row">
            <div style={{ flex: 1, minWidth: 160 }}><Field label="Hesap No"><Input value={bankaHesapNo} onChange={(e) => setBankaHesapNo(e.target.value)} placeholder="1234-56789" /></Field></div>
            <div style={{ flex: 1, minWidth: 160 }}><Field label="Döviz Cinsi"><Select value={bankaDoviz} onChange={(e) => setBankaDoviz(e.target.value)}><option value="TRY">TRY</option><option value="USD">USD</option><option value="EUR">EUR</option></Select></Field></div>
          </div>
          <Field label="IBAN"><Input value={bankaIban} onChange={(e) => setBankaIban(e.target.value)} placeholder="TR00..." /></Field>
          <div><Button variant="primary" onClick={bankaKaydet}>Banka Hesabı Kaydet</Button></div>
        </Card>
      )}

      {/* ─── TAHSİLAT / TEDİYE (FİŞ) FORMU ──────────────────────────────────── */}
      {hareketFormAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 620 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Tahsilat / Ödeme Fişi Düzenle</h3>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="Kasa / Banka Seçimi">
                <Select value={hareketHesapSecimi} onChange={(e) => setHareketHesapSecimi(e.target.value)} required>
                  <option value="">-- Hesap Seçiniz --</option>
                  <optgroup label="💵 Nakit Kasalar">
                    {kasalar.map((k) => (<option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi}) - Bakiye: {para(k.bakiye, k.dovizCinsi)}</option>))}
                  </optgroup>
                  <optgroup label="🏦 Banka Hesapları">
                    {bankalar.map((b) => (<option key={b.id} value={`banka:${b.id}`}>{b.ad} - {b.bankaAdi} ({b.dovizCinsi}) - Bakiye: {para(b.bakiye, b.dovizCinsi)}</option>))}
                  </optgroup>
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="İşlem Tipi">
                <Select value={hareketTip} onChange={(e) => setHareketTip(e.target.value)}>
                  <option value="tahsilat">Tahsilat (Para Girişi)</option>
                  <option value="tediye">Tediye / Ödeme (Para Çıkışı)</option>
                </Select>
              </Field>
            </div>
          </div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="Cari Hesap İlişkisi">
                <Select value={hareketCariId} onChange={(e) => setHareketCariId(e.target.value)}>
                  <option value="">-- Cari Seçilmeyebilir (Genel Fiş) --</option>
                  {cariler.map((c) => (<option key={c.id} value={c.id}>{c.unvan}</option>))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}><Field label="Tutar"><Input type="number" step="0.01" min="0.01" value={hareketTutar} onChange={(e) => setHareketTutar(e.target.value)} required placeholder="0.00" /></Field></div>
            <div style={{ flex: 1, minWidth: 200 }}><Field label="Tarih"><Input type="date" value={hareketTarih} onChange={(e) => setHareketTarih(e.target.value)} required /></Field></div>
          </div>
          <Field label="Açıklama"><Input value={hareketAciklama} onChange={(e) => setHareketAciklama(e.target.value)} placeholder="Örn. Tahsilat makbuzu 123 veya Ofis gideri" /></Field>
          <div><Button variant="primary" onClick={hareketKaydet}>Fişi Kaydet</Button></div>
        </Card>
      )}

      {/* ─── VİRMAN (TRANSFER) FORMU ────────────────────────────────────────── */}
      {virmanFormAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 620 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Hesaplar Arası Virman (Para Transferi)</h3>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="Kaynak Hesap (Çıkış)">
                <Select value={virmanKaynakSecimi} onChange={(e) => setVirmanKaynakSecimi(e.target.value)} required>
                  <option value="">-- Çıkış Hesabı --</option>
                  <optgroup label="💵 Nakit Kasalar">
                    {kasalar.map((k) => (<option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi})</option>))}
                  </optgroup>
                  <optgroup label="🏦 Banka Hesapları">
                    {bankalar.map((b) => (<option key={b.id} value={`banka:${b.id}`}>{b.ad} - {b.bankaAdi} ({b.dovizCinsi})</option>))}
                  </optgroup>
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Field label="Hedef Hesap (Giriş)">
                <Select value={virmanHedefSecimi} onChange={(e) => setVirmanHedefSecimi(e.target.value)} required>
                  <option value="">-- Giriş Hesabı --</option>
                  <optgroup label="💵 Nakit Kasalar">
                    {kasalar.map((k) => (<option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi})</option>))}
                  </optgroup>
                  <optgroup label="🏦 Banka Hesapları">
                    {bankalar.map((b) => (<option key={b.id} value={`banka:${b.id}`}>{b.ad} - {b.bankaAdi} ({b.dovizCinsi})</option>))}
                  </optgroup>
                </Select>
              </Field>
            </div>
          </div>
          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}><Field label="Transfer Tutarı"><Input type="number" step="0.01" min="0.01" value={virmanTutar} onChange={(e) => setVirmanTutar(e.target.value)} required placeholder="0.00" /></Field></div>
            <div style={{ flex: 1, minWidth: 200 }}><Field label="Tarih"><Input type="date" value={virmanTarih} onChange={(e) => setVirmanTarih(e.target.value)} required /></Field></div>
          </div>
          <Field label="Açıklama"><Input value={virmanAciklama} onChange={(e) => setVirmanAciklama(e.target.value)} placeholder="Örn. Bankadan kasaya nakit çekim" /></Field>
          <div><Button variant="primary" onClick={virmanKaydet}>Virman İşlemini Gerçekleştir</Button></div>
        </Card>
      )}

      {/* ─── HESAP BAKİYELERİ GRİDİ ─────────────────────────────────────────── */}
      <section style={{ marginBottom: "2rem" }}>
        <div className="row">
          <Card className="grow" style={{ flex: 1, minWidth: 300 }}>
            <div className="between" style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1.05rem", margin: 0 }}>💵 Nakit Kasalar</h3>
              <Button size="sm" onClick={() => { setBankaFormAcik(false); setKasaFormAcik(!kasaFormAcik); }}>+ Kasa Ekle</Button>
            </div>
            <TableWrap>
              <thead>
                <tr><th>Kasa Adı</th><th className="num">Mevcut Bakiye</th></tr>
              </thead>
              <tbody>
                {kasalar.length === 0 ? (
                  <tr><td colSpan={2} className="empty">Nakit kasa hesabı bulunmuyor.</td></tr>
                ) : (
                  kasalar.map((k) => (
                    <tr key={k.id}>
                      <td style={{ fontWeight: 600 }}>{k.ad}</td>
                      <td className="num money pos">{para(k.bakiye, k.dovizCinsi)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>
          </Card>

          <Card className="grow" style={{ flex: 1, minWidth: 300 }}>
            <div className="between" style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1.05rem", margin: 0 }}>🏦 Banka Hesapları</h3>
              <Button size="sm" onClick={() => { setKasaFormAcik(false); setBankaFormAcik(!bankaFormAcik); }}>+ Banka Ekle</Button>
            </div>
            <TableWrap>
              <thead>
                <tr><th>Hesap / Banka</th><th>IBAN</th><th className="num">Mevcut Bakiye</th></tr>
              </thead>
              <tbody>
                {bankalar.length === 0 ? (
                  <tr><td colSpan={3} className="empty">Banka hesabı bulunmuyor.</td></tr>
                ) : (
                  bankalar.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="cell-entity__name">{b.ad}</div>
                        <div className="cell-entity__meta">{b.bankaAdi}{b.hesapNo ? ` · No: ${b.hesapNo}` : ""}</div>
                      </td>
                      <td className="mono">{b.iban || "—"}</td>
                      <td className="num money pos">{para(b.bakiye, b.dovizCinsi)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      </section>

      {/* ─── SON HAREKETLER ─────────────────────────────────────────────────── */}
      <Card>
        <h2 className="card__title" style={{ fontSize: "1.05rem" }}>🔄 Son Kasa & Banka Fişleri</h2>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Hesap</th>
              <th>İşlem Tipi</th>
              <th>Cari Muhatap</th>
              <th>Açıklama</th>
              <th className="num">Tutar</th>
            </tr>
          </thead>
          <tbody>
            {hareketler.length === 0 ? (
              <tr><td colSpan={6} className="empty">Henüz bir kasa/banka hareketi girilmemiş.</td></tr>
            ) : (
              hareketler.map((h) => {
                const hesapAd = h.kasa?.ad ?? h.bankaHesap?.ad ?? "—";
                const isTahsilat = h.tip === "tahsilat";
                return (
                  <tr key={h.id}>
                    <td>{h.tarih}</td>
                    <td style={{ fontWeight: 500 }}>{hesapAd}</td>
                    <td>
                      {isTahsilat
                        ? <Badge variant="success">📥 Tahsilat</Badge>
                        : <Badge variant="danger">📤 Tediye</Badge>}
                    </td>
                    <td>{h.cari?.unvan ?? <span className="subtle">(Cari Yok)</span>}</td>
                    <td>{h.aciklama || "—"}</td>
                    <td className={`num money ${isTahsilat ? "pos" : "neg"}`}>
                      {isTahsilat ? "+" : "-"}{para(h.tutar, h.dovizCinsi)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
