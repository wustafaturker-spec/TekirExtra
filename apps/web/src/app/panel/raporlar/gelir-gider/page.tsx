"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { ayBasiTR, bugunTR, gunEkleTR, gunTR, yilBasiTR } from "@tekirextra/shared";

interface GelirGiderOzet {
  toplamGelir: string;
  toplamGider: string;
  netFark: string;
  karMarjiYuzde: number;
  satisHasilati: string;
  faaliyetDisiGelirler: string;
  mevcutStokDegeri: string;
  alisMaliyeti: string;
  masrafGiderleri: string;
  personelGiderleri: string;
}

interface KategoriKirilim {
  anaKategori: string;
  altKategori: string;
  tutar: string;
}

interface GelirGiderKalem {
  id: string;
  tarih: string;
  tur: "gelir" | "gider";
  anaKategori: string;
  altKategori: string;
  belgeNo: string;
  cariUnvan: string;
  aciklama: string;
  tutarTry: string;
  dovizCinsi: string;
  tutar: string;
}

/** RPR-12: tek kâr tanımı — net satış − SMM + diğer gelirler − giderler. */
interface KarZarar {
  netSatis: number;
  smm: number;
  brutKar: number;
  digerGelirler: number;
  hizmetAlislari: number;
  masraflar: number;
  personel: number;
  faaliyetGiderleri: number;
  netKar: number;
  maliyetsizSatis: { satir: number; ciro: number };
}

interface GelirGiderRaporYaniti {
  baslangicTarihi: string;
  bitisTarihi: string;
  ozet: GelirGiderOzet;
  karZarar: KarZarar;
  uyarilar?: string[];
  gelirKategorileri: KategoriKirilim[];
  giderKategorileri: KategoriKirilim[];
  kalemler: GelirGiderKalem[];
}

export default function GelirGiderRaporuSayfasi() {
  const bugun = bugunTR();
  const buAyBaslangic = ayBasiTR();

  const [baslangic, setBaslangic] = useState(buAyBaslangic);
  const [bitis, setBitis] = useState(bugun);
  const [versiyon, setVersiyon] = useState<"genel" | "ayrintili">("genel");
  const [aramaMetni, setAramaMetni] = useState("");
  const [turFiltresi, setTurFiltresi] = useState<"hepsi" | "gelir" | "gider">("hepsi");

  const [veri, setVeri] = useState<GelirGiderRaporYaniti | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  const raporYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const parametreler = new URLSearchParams({ baslangic, bitis });
      const sonuc = await api<GelirGiderRaporYaniti>(`/rapor/gelir-gider?${parametreler.toString()}`);
      setVeri(sonuc);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Rapor yüklenirken bir hata oluştu.");
    } finally {
      setYukleniyor(false);
    }
  }, [baslangic, bitis]);

  useEffect(() => {
    void raporYukle();
  }, [raporYukle]);

  const hizliTarihAyarla = (tur: "buAy" | "gecenAy" | "son30Gun" | "buYil") => {
    const simdi = new Date();
    if (tur === "buAy") {
      setBaslangic(ayBasiTR(simdi));
      setBitis(gunTR(simdi));
    } else if (tur === "gecenAy") {
      const gecenAy = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
      const gecenAySon = new Date(simdi.getFullYear(), simdi.getMonth(), 0);
      setBaslangic(gunTR(gecenAy));
      setBitis(gunTR(gecenAySon));
    } else if (tur === "son30Gun") {
      const once30 = new Date();
      once30.setDate(once30.getDate() - 30);
      setBaslangic(gunEkleTR(-30, simdi));
      setBitis(gunTR(simdi));
    } else if (tur === "buYil") {
      setBaslangic(yilBasiTR(simdi));
      setBitis(gunTR(simdi));
    }
  };

  const tl = (tutar: string | number) =>
    Number(tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";

  // Filtrelenmiş ayrıntılı kalemler
  const filtrelenmisKalemler = (veri?.kalemler ?? []).filter((k) => {
    if (turFiltresi !== "hepsi" && k.tur !== turFiltresi) return false;
    if (!aramaMetni.trim()) return true;
    const arama = aramaMetni.toLocaleLowerCase("tr-TR");
    return (
      k.belgeNo.toLocaleLowerCase("tr-TR").includes(arama) ||
      k.cariUnvan.toLocaleLowerCase("tr-TR").includes(arama) ||
      k.anaKategori.toLocaleLowerCase("tr-TR").includes(arama) ||
      k.altKategori.toLocaleLowerCase("tr-TR").includes(arama) ||
      k.aciklama.toLocaleLowerCase("tr-TR").includes(arama)
    );
  });

  const excelIndir = () => {
    if (!veri) return;
    const basliklar = ["Tarih", "Tür", "Ana Kategori", "Alt Kategori", "Belge No", "Firma / Cari", "Açıklama", "Tutar (TRY)", "Orijinal Tutar"];
    const satirlar = filtrelenmisKalemler.map((k) => [
      k.tarih,
      k.tur === "gelir" ? "Gelir" : "Gider",
      `"${k.anaKategori.replace(/"/g, '""')}"`,
      `"${k.altKategori.replace(/"/g, '""')}"`,
      `"${k.belgeNo.replace(/"/g, '""')}"`,
      `"${k.cariUnvan.replace(/"/g, '""')}"`,
      `"${k.aciklama.replace(/"/g, '""')}"`,
      k.tutarTry,
      `${k.tutar} ${k.dovizCinsi}`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [basliklar.join(";"), ...satirlar.map((e) => e.join(";"))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `gelir_gider_mali_rapor_${baslangic}_${bitis}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const netFark = Number(veri?.ozet.netFark ?? 0);

  return (
    <div>
      <PageHeader
        title="📊 Gelir - Gider & Mali Analiz Raporu"
        subtitle="Tahakkuk esaslı ve KDV hariç: faturalar, onaylı masraflar, faaliyet dışı gelir kayıtları ve bordro. Belgesiz kasa/banka hareketleri sayılmaz; personel gideri net ödenecek tutardır."
        actions={
          <div className="row-tight">
            <Button onClick={() => window.print()}>🖨️ Yazdır / PDF</Button>
            <Button variant="primary" onClick={excelIndir} disabled={!veri}>
              📥 Excel'e Aktar
            </Button>
          </div>
        }
      />

      <Alert tone="error">{hata}</Alert>
      {(veri?.uyarilar ?? []).map((u) => <Alert key={u} tone="warning">{u}</Alert>)}

      {/* Tarih ve Versiyon Seçim Paneli */}
      <Card style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
            <Field label="Başlangıç Tarihi">
              <Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
            </Field>
            <Field label="Bitiş Tarihi">
              <Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
            </Field>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <Button size="sm" type="button" onClick={() => hizliTarihAyarla("buAy")}>Bu Ay</Button>
              <Button size="sm" type="button" onClick={() => hizliTarihAyarla("gecenAy")}>Geçen Ay</Button>
              <Button size="sm" type="button" onClick={() => hizliTarihAyarla("son30Gun")}>Son 30 Gün</Button>
              <Button size="sm" type="button" onClick={() => hizliTarihAyarla("buYil")}>Bu Yıl</Button>
            </div>
          </div>

          {/* Rapor Versiyon Tabları */}
          <div style={{ display: "flex", gap: "0.5rem", background: "var(--surface-subtle, #f1f5f9)", padding: "4px", borderRadius: "8px" }}>
            <Button
              size="sm"
              variant={versiyon === "genel" ? "primary" : undefined}
              onClick={() => setVersiyon("genel")}
            >
              📊 Genel Özet & Kırılımlar
            </Button>
            <Button
              size="sm"
              variant={versiyon === "ayrintili" ? "primary" : undefined}
              onClick={() => setVersiyon("ayrintili")}
            >
              📋 Ayrıntılı Kalemler ({veri?.kalemler.length ?? 0})
            </Button>
          </div>
        </div>
      </Card>

      {yukleniyor && <Card><p className="muted">Rapor hesaplanıyor ve yükleniyor...</p></Card>}

      {!yukleniyor && veri && (
        <>
          {/* Özet KPI Kartları */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <Card style={{ borderLeft: "4px solid #16a34a" }}>
              <span className="muted" style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: 600 }}>Toplam Gelir</span>
              <h2 style={{ color: "#16a34a", marginTop: "4px", marginBottom: 0 }}>+{tl(veri.ozet.toplamGelir)}</h2>
              <small className="muted">Satışlar, faaliyet dışı gelirler, alış iadeleri</small>
            </Card>

            <Card style={{ borderLeft: "4px solid #dc2626" }}>
              <span className="muted" style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: 600 }}>Toplam Gider & Maliyet</span>
              <h2 style={{ color: "#dc2626", marginTop: "4px", marginBottom: 0 }}>-{tl(veri.ozet.toplamGider)}</h2>
              <small className="muted">Alışlar, masraflar, personel, satış iadeleri</small>
            </Card>

            {/* RPR-12: net kâr SMM bazlı; alış bazlı gelir − gider farkı ayrıca altta. */}
            <Card style={{ borderLeft: `4px solid ${veri.karZarar.netKar >= 0 ? "var(--success)" : "var(--danger)"}` }}>
              <span className="muted" style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: 600 }}>Dönem Net Kâr / Zarar</span>
              <h2 style={{ color: veri.karZarar.netKar >= 0 ? "var(--success)" : "var(--danger)", marginTop: "4px", marginBottom: 0 }}>
                {veri.karZarar.netKar >= 0 ? "+" : ""}{tl(veri.karZarar.netKar)}
              </h2>
              <small className="muted">Satılan malın maliyetiyle · gelir − gider farkı (alış bazlı) {netFark >= 0 ? "+" : ""}{tl(netFark)}</small>
            </Card>

            <Card style={{ borderLeft: "4px solid #2563eb" }}>
              <span className="muted" style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: 600 }}>Aktif Stok Değeri</span>
              <h2 style={{ color: "#2563eb", marginTop: "4px", marginBottom: 0 }}>{tl(veri.ozet.mevcutStokDegeri)}</h2>
              <small className="muted">Varlıktır; gelire ve net farka katılmaz</small>
            </Card>
          </div>

          {/* RPR-12: kâr dökümü (Kâr/Zarar Özeti raporu ve SMM ekranıyla aynı hesap). */}
          <Card style={{ marginBottom: "1.5rem" }}>
            <div className="invoice-summary" style={{ border: 0, boxShadow: "none", padding: 0 }}>
              <h4>Kâr / zarar · satılan malın maliyetiyle</h4>
              <div className="invoice-summary__line"><span>Net satış (satış − satış iadeleri)</span><span>{tl(veri.karZarar.netSatis)}</span></div>
              <div className="invoice-summary__line is-discount"><span>Satılan malın maliyeti</span><span>{veri.karZarar.smm ? "-" : ""}{tl(veri.karZarar.smm)}</span></div>
              <div className="invoice-summary__line"><strong>Brüt kâr</strong><strong>{tl(veri.karZarar.brutKar)}</strong></div>
              {veri.karZarar.digerGelirler !== 0 && <div className="invoice-summary__line"><span>Diğer gelirler</span><span>+{tl(veri.karZarar.digerGelirler)}</span></div>}
              <div className="invoice-summary__line is-discount"><span>Hizmet alışları</span><span>{veri.karZarar.hizmetAlislari ? "-" : ""}{tl(veri.karZarar.hizmetAlislari)}</span></div>
              <div className="invoice-summary__line is-discount"><span>Masraflar</span><span>{veri.karZarar.masraflar ? "-" : ""}{tl(veri.karZarar.masraflar)}</span></div>
              <div className="invoice-summary__line is-discount"><span>Personel (bordro)</span><span>{veri.karZarar.personel ? "-" : ""}{tl(veri.karZarar.personel)}</span></div>
              <div className="invoice-summary__line is-grand"><span>Net kâr / zarar</span><span>{tl(veri.karZarar.netKar)}</span></div>
              <small className="muted">Mal alışı gider sayılmaz: stoğa girer, satıldığında maliyet olarak düşer. Ödemeler kâra girmez. Aşağıdaki gelir/gider tabloları alışları gider olarak gösterir (bütçe karşılaştırması için).</small>
            </div>
          </Card>

          {/* Versiyon 1: Genel Özet */}
          {versiyon === "genel" && (() => {
            const gelirKategorileri = veri.gelirKategorileri ?? [];
            const giderKategorileri = veri.giderKategorileri ?? [];
            return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
              {/* Gelirler Tablosu */}
              <Card style={{ borderTop: "3px solid #16a34a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <h3 style={{ margin: 0, color: "#16a34a" }}>📈 GELİRLER</h3>
                  <Badge variant="success">Toplam: +{tl(veri.ozet.toplamGelir)}</Badge>
                </div>
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Ana Kategori</th>
                      <th>Alt Kategori</th>
                      <th className="num">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gelirKategorileri.length === 0 ? (
                      <tr><td colSpan={3} className="empty">Bu tarihlerde gelir kaydı bulunmuyor.</td></tr>
                    ) : (
                      gelirKategorileri.map((k, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{k.anaKategori}</td>
                          <td className="muted">{k.altKategori}</td>
                          <td className="num" style={{ fontWeight: 700, color: "#16a34a" }}>
                            +{tl(k.tutar)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </TableWrap>
              </Card>

              {/* Giderler Tablosu (Ana ve Alt Kırılımlar) */}
              <Card style={{ borderTop: "3px solid #dc2626" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <h3 style={{ margin: 0, color: "#dc2626" }}>📉 GİDERLER & MASRAFLAR</h3>
                  <Badge variant="danger">Toplam: -{tl(veri.ozet.toplamGider)}</Badge>
                </div>
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Ana Kategori</th>
                      <th>Alt Kategori</th>
                      <th className="num">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {giderKategorileri.length === 0 ? (
                      <tr><td colSpan={3} className="empty">Bu tarihlerde gider kaydı bulunmuyor.</td></tr>
                    ) : (
                      giderKategorileri.map((k, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{k.anaKategori}</td>
                          <td className="muted">{k.altKategori}</td>
                          <td className="num" style={{ fontWeight: 700, color: "#dc2626" }}>
                            -{tl(k.tutar)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </TableWrap>
              </Card>
            </div>
            );
          })()}

          {/* Versiyon 2: Ayrıntılı Kalemler Listesi */}
          {versiyon === "ayrintili" && (
            <Card pad={false}>
              <div style={{ padding: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid #e2e8f0" }}>
                <Input
                  placeholder="🔍 Belge No, Cari Ünvan, Kategori veya Açıklama ile filtrele..."
                  value={aramaMetni}
                  onChange={(e) => setAramaMetni(e.target.value)}
                  style={{ flex: 1, minWidth: "240px" }}
                />
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <Button size="sm" variant={turFiltresi === "hepsi" ? "primary" : undefined} onClick={() => setTurFiltresi("hepsi")}>Hepsi</Button>
                  <Button size="sm" variant={turFiltresi === "gelir" ? "primary" : undefined} onClick={() => setTurFiltresi("gelir")}>Gelirler</Button>
                  <Button size="sm" variant={turFiltresi === "gider" ? "primary" : undefined} onClick={() => setTurFiltresi("gider")}>Giderler</Button>
                </div>
              </div>

              <TableWrap>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Tür</th>
                    <th>Ana Kategori</th>
                    <th>Alt Kategori</th>
                    <th>Belge / Fatura No</th>
                    <th>Firma / Cari</th>
                    <th>Açıklama</th>
                    <th className="num">Tutar (TRY)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrelenmisKalemler.length === 0 ? (
                    <tr><td colSpan={8} className="empty">Filtrelere uygun kalem bulunamadı.</td></tr>
                  ) : (
                    filtrelenmisKalemler.map((kalem) => (
                      <tr key={kalem.id}>
                        <td>{kalem.tarih}</td>
                        <td>
                          {kalem.tur === "gelir" ? (
                            <Badge variant="success">Gelir</Badge>
                          ) : (
                            <Badge variant="danger">Gider</Badge>
                          )}
                        </td>
                        <td style={{ fontWeight: 600 }}>{kalem.anaKategori}</td>
                        <td className="muted">{kalem.altKategori}</td>
                        <td className="mono">{kalem.belgeNo}</td>
                        <td>{kalem.cariUnvan}</td>
                        <td className="muted">{kalem.aciklama}</td>
                        <td className="num" style={{ fontWeight: 700, color: kalem.tur === "gelir" ? "#16a34a" : "#dc2626" }}>
                          {kalem.tur === "gelir" ? "+" : "-"}{tl(kalem.tutarTry)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableWrap>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
