"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { AramaSecici } from "@/components/arama-secici";

interface Kategori {
  id: string;
  ad: string;
  varsayilanStopajOrani: string | null;
  varsayilanKdvOrani: string | null;
  muhasebeKodu: string | null;
  ustId: string | null;
  _count?: { gelirKayitlari: number };
}

interface Cari {
  id: string;
  unvan: string;
}

interface Hesap {
  id: string;
  ad: string;
  dovizCinsi: string;
  bakiye: string;
  bankaAdi?: string;
}

interface GelirKaydi {
  id: string;
  tarih: string;
  brutTutar: string;
  stopajOrani: string;
  stopajTutari: string;
  kdvOrani: string;
  kdvTutari: string;
  netTutar: string;
  dovizCinsi: string;
  kur: string;
  netTutarTry: string;
  aciklama: string | null;
  belgeNo: string | null;
  kategori: { ad: string; muhasebeKodu: string | null };
  cari?: { unvan: string } | null;
  kasa?: { ad: string } | null;
  bankaHesap?: { ad: string; bankaAdi: string } | null;
}

export default function GelirlerPage() {
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [kayitlar, setKayitlar] = useState<GelirKaydi[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [kasalar, setKasalar] = useState<Hesap[]>([]);
  const [bankalar, setBankalar] = useState<Hesap[]>([]);

  const [loading, setLoading] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const [modal, setModal] = useState<"gelir" | "kategori" | null>(null);
  const [duzenlenenKategori, setDuzenlenenKategori] = useState<Kategori | null>(null);

  // Gelir Kaydı Form States
  const [kategoriId, setKategoriId] = useState("");
  const [tarih, setTarih] = useState(new Date().toISOString().substring(0, 10));
  const [brutTutar, setBrutTutar] = useState("");
  const [stopajOrani, setStopajOrani] = useState("0");
  const [kdvOrani, setKdvOrani] = useState("0");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [kur, setKur] = useState("1");
  const [aciklama, setAciklama] = useState("");
  const [belgeNo, setBelgeNo] = useState("");
  const [cariId, setCariId] = useState("");
  const [hesapSecim, setHesapSecim] = useState(""); // "kasa:ID" veya "banka:ID"

  // Kategori Form States
  const [katAd, setKatAd] = useState("");
  const [katStopaj, setKatStopaj] = useState("0");
  const [katKdv, setKatKdv] = useState("0");
  const [katMuhasebe, setKatMuhasebe] = useState("");

  const yukle = useCallback(async () => {
    setLoading(true);
    try {
      const [katRes, kayitRes, cariRes, kasaRes, bankaRes] = await Promise.all([
        api<Kategori[]>("/gelirler/kategoriler"),
        api<GelirKaydi[]>("/gelirler"),
        tumSayfalariAl<Cari>("/cari").catch(() => []),
        api<Hesap[]>("/kasa-banka/kasalar"),
        api<Hesap[]>("/kasa-banka/bankalar"),
      ]);
      setKategoriler(Array.isArray(katRes) ? katRes : []);
      setKayitlar(Array.isArray(kayitRes) ? kayitRes : []);
      setCariler(Array.isArray(cariRes) ? cariRes : []);
      setKasalar(Array.isArray(kasaRes) ? kasaRes : []);
      setBankalar(Array.isArray(bankaRes) ? bankaRes : []);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  // Hesaplamalar
  const brut = Number(brutTutar || 0);
  const stpOran = Number(stopajOrani || 0);
  const kdvOrn = Number(kdvOrani || 0);

  const stopajTutari = (brut * (stpOran / 100)).toFixed(2);
  const kdvTutari = (brut * (kdvOrn / 100)).toFixed(2);
  const netTutar = (brut - Number(stopajTutari) + Number(kdvTutari)).toFixed(2);

  // Kategori seçilince varsayılan oranları doldur
  const handleKategoriChange = (id: string) => {
    setKategoriId(id);
    const kat = kategoriler.find((k) => k.id === id);
    if (kat) {
      if (kat.varsayilanStopajOrani != null) setStopajOrani(kat.varsayilanStopajOrani);
      if (kat.varsayilanKdvOrani != null) setKdvOrani(kat.varsayilanKdvOrani);
    }
  };

  async function gelirKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    if (!hesapSecim) {
      setHata("Lütfen tahsilatın yapılacağı kasa veya banka hesabını seçin");
      return;
    }
    const [ht, hId] = hesapSecim.split(":");

    try {
      await api("/gelirler", {
        method: "POST",
        body: JSON.stringify({
          kategoriId,
          tarih,
          brutTutar,
          stopajOrani,
          stopajTutari,
          kdvOrani,
          kdvTutari,
          netTutar,
          dovizCinsi,
          kur,
          aciklama: aciklama || undefined,
          belgeNo: belgeNo || undefined,
          cariId: cariId || undefined,
          kasaId: ht === "kasa" ? hId : undefined,
          bankaHesapId: ht === "banka" ? hId : undefined,
        }),
      });
      setBasari("Faturasız gelir kaydı ve kasa/banka tahsilat hareketi oluşturuldu.");
      setModal(null);
      void yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Gelir kaydı oluşturulamadı");
    }
  }

  async function kategoriKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      if (duzenlenenKategori) {
        await api(`/gelirler/kategoriler/${duzenlenenKategori.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ad: katAd,
            varsayilanStopajOrani: katStopaj || undefined,
            varsayilanKdvOrani: katKdv || undefined,
            muhasebeKodu: katMuhasebe || undefined,
          }),
        });
        setBasari("Gelir kategorisi güncellendi.");
      } else {
        await api("/gelirler/kategoriler", {
          method: "POST",
          body: JSON.stringify({
            ad: katAd,
            varsayilanStopajOrani: katStopaj || undefined,
            varsayilanKdvOrani: katKdv || undefined,
            muhasebeKodu: katMuhasebe || undefined,
          }),
        });
        setBasari("Yeni gelir kategorisi eklendi.");
      }
      setModal(null);
      setDuzenlenenKategori(null);
      void yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Kategori kaydedilemedi");
    }
  }

  async function kategoriSil(id: string) {
    if (!confirm("Bu kategoriyi silmek veya pasife almak istediğinize emin misiniz?")) return;
    try {
      await api(`/gelirler/kategoriler/${id}`, { method: "DELETE" });
      setBasari("Kategori silindi/pasife alındı.");
      void yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Kategori silinemedi");
    }
  }

  async function gelirSil(id: string) {
    if (!confirm("Bu gelir kaydını silmek istediğinize emin misiniz? Kasa/banka hareketi de silinecektir.")) return;
    try {
      await api(`/gelirler/${id}`, { method: "DELETE" });
      setBasari("Gelir kaydı ve ilişkili tahsilat hareketi silindi.");
      void yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Gelir kaydı silinemedi");
    }
  }

  const tumHesaplar = [
    ...kasalar.map((k) => ({ ...k, tur: "kasa" })),
    ...bankalar.map((b) => ({ ...b, tur: "banka" })),
  ];

  const para = (v: string | number, d = "TRY") =>
    Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faaliyet Dışı & Faturasız Gelirler"
        subtitle="Kira, Mevduat Faizi, Temettü, Hibe ve Varlık Satış gelirlerinizi dinamik kategorilerle kaydedin."
        actions={
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setDuzenlenenKategori(null);
                setKatAd("");
                setKatStopaj("0");
                setKatKdv("0");
                setKatMuhasebe("");
                setModal("kategori");
              }}
            >
              ⚙ Kategorileri Yönet
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setBrutTutar("");
                setStopajOrani("0");
                setKdvOrani("0");
                setAciklama("");
                setBelgeNo("");
                setModal("gelir");
              }}
            >
              ➕ Yeni Gelir Kaydı
            </Button>
          </div>
        }
      />

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      <Card pad={false} title="Kayıtlı Faaliyet Dışı Gelirler">
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Kategori</th>
              <th>Muhatap (Cari) / Belge</th>
              <th>Brüt Tutar</th>
              <th>Stopaj</th>
              <th>Net Tahsilat</th>
              <th>Hesap (Kasa/Banka)</th>
              <th>Açıklama</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {kayitlar.map((g) => (
              <tr key={g.id}>
                <td>{new Date(g.tarih).toLocaleDateString("tr-TR")}</td>
                <td>
                  <Badge variant="info">{g.kategori.ad}</Badge>
                  {g.kategori.muhasebeKodu && (
                    <small className="block text-gray-500">Kod: {g.kategori.muhasebeKodu}</small>
                  )}
                </td>
                <td>
                  <strong>{g.cari?.unvan || "—"}</strong>
                  {g.belgeNo && <small className="block text-gray-500">Dekont: {g.belgeNo}</small>}
                </td>
                <td>{para(g.brutTutar, g.dovizCinsi)}</td>
                <td className="text-red-600">
                  {Number(g.stopajTutari) > 0 ? `-%${g.stopajOrani} (${para(g.stopajTutari, g.dovizCinsi)})` : "—"}
                </td>
                <td className="font-semibold text-green-700">{para(g.netTutar, g.dovizCinsi)}</td>
                <td>{g.kasa?.ad || g.bankaHesap?.ad || "—"}</td>
                <td>{g.aciklama || "—"}</td>
                <td>
                  <Button size="sm" onClick={() => void gelirSil(g.id)}>
                    Sil
                  </Button>
                </td>
              </tr>
            ))}
            {!kayitlar.length && !loading && (
              <tr>
                <td colSpan={9} className="text-center py-6 text-gray-500">
                  Henüz kaydedilmiş faturasız gelir bulunmuyor.
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* GELİR KAYDI MODALI */}
      {modal === "gelir" && (
        <div className="treasury-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <section className="treasury-modal" style={{ maxWidth: 650 }}>
            <header>
              <div>
                <span>GELİR İŞLEMİ</span>
                <h2>Yeni Faturasız Gelir Kaydı</h2>
              </div>
              <button onClick={() => setModal(null)}>×</button>
            </header>

            <form onSubmit={gelirKaydet}>
              <div className="treasury-form-grid">
                <Field label="Gelir Kategorisi">
                  <Select required value={kategoriId} onChange={(e) => handleKategoriChange(e.target.value)}>
                    <option value="">Kategori Seçin</option>
                    {kategoriler.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.ad} {k.muhasebeKodu ? `(${k.muhasebeKodu})` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Tarih">
                  <Input type="date" required value={tarih} onChange={(e) => setTarih(e.target.value)} />
                </Field>

                <Field label="Tahsil Edilecek Kasa / Banka">
                  <Select required value={hesapSecim} onChange={(e) => setHesapSecim(e.target.value)}>
                    <option value="">Hesap Seçin</option>
                    {tumHesaplar.map((x) => (
                      <option key={`${x.tur}:${x.id}`} value={`${x.tur}:${x.id}`}>
                        {x.ad} ({x.dovizCinsi}) - Bakiye: {para(x.bakiye, x.dovizCinsi)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Muhatap (Cari - Opsiyonel)">
                  <AramaSecici ariaLabel="Muhatap Cari" deger={cariId} onChange={setCariId} placeholder="Cari ara…" secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan }))} />
                </Field>

                <Field label="Brüt Gelir Tutarı">
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={brutTutar}
                    onChange={(e) => setBrutTutar(e.target.value)}
                    placeholder="Örn: 10000"
                  />
                </Field>

                <Field label="Stopaj / Vergi Kesintisi (%)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={stopajOrani}
                    onChange={(e) => setStopajOrani(e.target.value)}
                  />
                </Field>

                <Field label="KDV Oranı (%)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={kdvOrani}
                    onChange={(e) => setKdvOrani(e.target.value)}
                  />
                </Field>

                <Field label="Dekont / Belge No">
                  <Input value={belgeNo} onChange={(e) => setBelgeNo(e.target.value)} placeholder="Opsiyonel" />
                </Field>

                <Field label="Açıklama" className="col-span-2">
                  <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn: Ağustos Ayı Repo/Faiz Getirisi" />
                </Field>
              </div>

              {brut > 0 && (
                <div style={{ backgroundColor: "#f0fdf4", padding: 12, borderRadius: 8, marginTop: 12, border: "1px solid #bbf7d0", fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span>Brüt Tutar: <strong>{para(brut, dovizCinsi)}</strong></span>
                    {Number(stopajTutari) > 0 && <span style={{ color: "#dc2626" }}>Stopaj Kesintisi (%{stopajOrani}): -{para(stopajTutari, dovizCinsi)}</span>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px dashed #86efac", paddingTop: 6, fontWeight: "bold" }}>
                    <span>Net Hesaba Yatan Tutar:</span>
                    <span style={{ color: "#15803d", fontSize: 15 }}>{para(netTutar, dovizCinsi)}</span>
                  </div>
                </div>
              )}

              <footer style={{ marginTop: 16 }}>
                <Button type="button" onClick={() => setModal(null)}>Vazgeç</Button>
                <Button type="submit" variant="primary">Kaydet ve Tahsil Et</Button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* KATEGORİ YÖNETİMİ MODALI */}
      {modal === "kategori" && (
        <div className="treasury-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <section className="treasury-modal" style={{ maxWidth: 650 }}>
            <header>
              <div>
                <span>DİNAMİK GELİR KATEGORİLERİ</span>
                <h2>Gelir Kategorilerini Yönet</h2>
              </div>
              <button onClick={() => setModal(null)}>×</button>
            </header>

            <form onSubmit={kategoriKaydet} style={{ marginBottom: 20 }}>
              <div className="treasury-form-grid">
                <Field label="Kategori Adı">
                  <Input
                    required
                    value={katAd}
                    onChange={(e) => setKatAd(e.target.value)}
                    placeholder="Örn. Gayrimenkul Kira Gelirleri"
                  />
                </Field>
                <Field label="Varsayılan Stopaj Oranı (%)">
                  <Input
                    type="number"
                    step="0.01"
                    value={katStopaj}
                    onChange={(e) => setKatStopaj(e.target.value)}
                  />
                </Field>
                <Field label="Muhasebe Kodu">
                  <Input
                    value={katMuhasebe}
                    onChange={(e) => setKatMuhasebe(e.target.value)}
                    placeholder="Örn. 649 veya 642"
                  />
                </Field>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {duzenlenenKategori && (
                  <Button
                    type="button"
                    onClick={() => {
                      setDuzenlenenKategori(null);
                      setKatAd("");
                      setKatStopaj("0");
                      setKatMuhasebe("");
                    }}
                  >
                    Temizle / Yeni Eklemeye Dön
                  </Button>
                )}
                <Button type="submit" variant="primary">
                  {duzenlenenKategori ? "Kategoriyi Güncelle" : "Kategori Ekle"}
                </Button>
              </div>
            </form>

            <TableWrap>
              <thead>
                <tr>
                  <th>Kategori Adı</th>
                  <th>Varsayılan Stopaj</th>
                  <th>Muhasebe Kodu</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {kategoriler.map((k) => (
                  <tr key={k.id}>
                    <td><strong>{k.ad}</strong></td>
                    <td>{k.varsayilanStopajOrani ? `%${k.varsayilanStopajOrani}` : "%0"}</td>
                    <td>{k.muhasebeKodu || "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button
                          size="sm"
                          onClick={() => {
                            setDuzenlenenKategori(k);
                            setKatAd(k.ad);
                            setKatStopaj(k.varsayilanStopajOrani || "0");
                            setKatMuhasebe(k.muhasebeKodu || "");
                          }}
                        >
                          Düzenle
                        </Button>
                        <Button size="sm" onClick={() => void kategoriSil(k.id)}>
                          Sil
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </section>
        </div>
      )}
    </div>
  );
}
