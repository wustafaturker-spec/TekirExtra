"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { AramaSecici } from "@/components/arama-secici";
import { DepoSecici } from "@/components/depo-secici";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { faturaHesapla, type FaturaHesaplaSatirGirdi } from "@tekirextra/shared";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  TableWrap,
} from "@/components/ui";

interface Cari {
  id: string;
  kod?: string;
  unvan: string;
  vknTckn?: string | null;
}

interface CariSecimOzeti extends Cari {
  bakiyeler: { dovizCinsi: string; bakiye: string }[];
  risk: { mevcutRisk: string; limit: string | null; kalanLimit: string | null; asim: boolean };
  varsayilanVadeGun?: number | null;
  eFaturaMukellefi?: boolean | null;
}

interface Stok {
  id: string;
  kod: string;
  ad: string;
  barkod?: string | null;
  anaBirim?: string;
  kullanilabilirMiktar?: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  kdvOrani: string;
}

interface FaturaSatir {
  stokId: string;
  miktar: number;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
  gibIstisnaKodu?: string;
}

interface Fatura {
  id: string;
  no: string | null;
  tip: string;
  tarih: string;
  durum: string;
  toplamMatrah: string;
  toplamKdv: string;
  genelToplam: string;
  cari: { unvan: string };
  /** API iç içe döner; gönderilmemiş faturada null. */
  ebelge?: { id: string; durum: string; tur: string } | null;
}

/** FaturaTip enum'u; iade ve proforma da listede ayırt edilmeli. */
const TIP_ETIKETLERI: Record<string, string> = {
  satis: "📤 Satış",
  alis: "📥 Alış",
  satis_iade: "↩️ Satış İade",
  alis_iade: "↪️ Alış İade",
  proforma: "📄 Proforma",
};

/** BelgeDurum enum'u (EBLG-04). */
const EBELGE_DURUMLARI: Record<string, { baslik: string; renk: "info" | "success" | "danger" | "neutral" }> = {
  kuyrukta: { baslik: "⚙ Kuyrukta", renk: "info" },
  iletildi: { baslik: "📨 İletildi", renk: "info" },
  kabul: { baslik: "✓ Kabul", renk: "success" },
  ret: { baslik: "⛔ Ret", renk: "danger" },
  hata: { baslik: "⚠ Hata", renk: "danger" },
};

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export default function FaturaSayfasi() {
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [epostaGonderilen, setEpostaGonderilen] = useState<Fatura | null>(null);
  const [epostaAdresi, setEpostaAdresi] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [yonBaglami, setYonBaglami] = useState<"satis" | "alis" | null>(null);
  const [acikSatir, setAcikSatir] = useState<number | null>(null);
  const urunRefleri = useRef<Array<HTMLInputElement | null>>([]);
  const miktarRefleri = useRef<Array<HTMLInputElement | null>>([]);
  const [hizliPanel, setHizliPanel] = useState<"cari" | "stok" | null>(null);
  const [hizliStokSatir, setHizliStokSatir] = useState(0);
  const [hizliHata, setHizliHata] = useState("");
  const [yeniCariKod, setYeniCariKod] = useState("");
  const [yeniCariUnvan, setYeniCariUnvan] = useState("");
  const [yeniCariVkn, setYeniCariVkn] = useState("");
  const [yeniStokKod, setYeniStokKod] = useState("");
  const [yeniStokAd, setYeniStokAd] = useState("");
  const [yeniStokBarkod, setYeniStokBarkod] = useState("");
  const [yeniStokKdv, setYeniStokKdv] = useState("20");
  const [yeniStokFiyat, setYeniStokFiyat] = useState("");

  // Form alanları
  const [cariId, setCariId] = useState("");
  const [cariOzeti, setCariOzeti] = useState<CariSecimOzeti | null>(null);
  const [depoId, setDepoId] = useState("");
  const [tip, setTip] = useState("satis");
  const [tarih, setTarih] = useState(new Date().toISOString().substring(0, 10));
  const [satirlar, setSatirlar] = useState<FaturaSatir[]>([
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" },
  ]);

  // Önizleme hesaplamaları
  const girdiSatirlar: FaturaHesaplaSatirGirdi[] = satirlar.map((s) => ({
    stokId: s.stokId || "gecici-id",
    miktar: s.miktar,
    birimFiyat: s.birimFiyat,
    kdvOrani: s.kdvOrani,
    iskontoOrani: s.iskontoOrani,
  }));
  const sonuc = faturaHesapla({ satirlar: girdiSatirlar });

  const yukle = useCallback(async () => {
    try {
      const fVeri = await api<{ kayitlar: Fatura[] }>("/fatura");
      setFaturalar(fVeri.kayitlar);

      const cVeri = await api<{ kayitlar: Cari[] }>("/cari?adet=100");
      setCariler(cVeri.kayitlar);

      const sVeri = await api<{ kayitlar: Stok[] }>("/stok?adet=100");
      setStoklar(sVeri.kayitlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme hatası");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  useEffect(() => {
    const parametreler = new URLSearchParams(window.location.search);
    const yon = parametreler.get("yon");
    if (yon === "satis" || yon === "alis") {
      setYonBaglami(yon);
      setTip(yon);
    }
    if (parametreler.get("yeni") === "1") setFormAcik(true);
  }, []);

  useEffect(() => {
    if (!cariId || !tokenAl()) {
      setCariOzeti(null);
      return;
    }
    let gecerli = true;
    api<CariSecimOzeti>(`/cari/${cariId}`)
      .then((ozet) => { if (gecerli) setCariOzeti(ozet); })
      .catch(() => { if (gecerli) setCariOzeti(null); });
    return () => { gecerli = false; };
  }, [cariId]);

  function satirEkle() {
    const yeniIndex = satirlar.length;
    setSatirlar([...satirlar, { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" }]);
    requestAnimationFrame(() => urunRefleri.current[yeniIndex]?.focus());
  }

  function satirKopyala(index: number) {
    const yeni = [...satirlar];
    yeni.splice(index + 1, 0, { ...satirlar[index] });
    setSatirlar(yeni);
    setAcikSatir(null);
    requestAnimationFrame(() => miktarRefleri.current[index + 1]?.focus());
  }

  function satirSil(index: number) {
    if (satirlar.length === 1) return;
    setSatirlar(satirlar.filter((_, i) => i !== index));
    setAcikSatir(null);
  }

  async function satirGuncelle(index: number, alan: keyof FaturaSatir, deger: string | number) {
    const yeni = [...satirlar];
    yeni[index] = { ...yeni[index], [alan]: deger };

    // Eğer stok seçildiyse varsayılan fiyatları yükleyelim
    if (alan === "stokId") {
      const stok = stoklar.find((s) => s.id === deger);
      if (stok) {
        yeni[index].kdvOrani = Number(stok.kdvOrani || 20);
      }
      if (deger) {
        try {
          const tavsiye = await api<{ birimFiyat: number; iskontoOrani: number }>(
            `/stok/${deger}/tavsiye-fiyat?cariId=${cariId}&tip=${tip}`
          );
          yeni[index].birimFiyat = tavsiye.birimFiyat;
          yeni[index].iskontoOrani = tavsiye.iskontoOrani;
        } catch (err) {
          console.error("Tavsiye fiyat alınamadı", err);
        }
      }
    }
    setSatirlar(yeni);
  }

  function urunSec(index: number, deger: string) {
    if (deger && satirlar[index].stokId === deger) {
      setSatirlar((eskiler) => eskiler.map((satir, satirIndex) =>
        satirIndex === index ? { ...satir, miktar: Number(satir.miktar) + 1 } : satir,
      ));
      return;
    }
    void satirGuncelle(index, "stokId", deger);
  }

  async function hizliCariOlustur(event: React.FormEvent) {
    event.preventDefault();
    setHizliHata("");
    try {
      const yeni = await api<Cari>("/cari", {
        method: "POST",
        body: JSON.stringify({
          kod: yeniCariKod,
          unvan: yeniCariUnvan,
          tip: tip === "alis" ? "tedarikci" : "musteri",
          kisiTipi: "tuzel",
          vknTckn: yeniCariVkn || undefined,
        }),
      });
      setCariler((eskiler) => [yeni, ...eskiler]);
      setCariId(yeni.id);
      setHizliPanel(null);
      setYeniCariKod("");
      setYeniCariUnvan("");
      setYeniCariVkn("");
      setBasari(`${yeni.unvan} oluşturuldu ve faturaya seçildi.`);
    } catch (h) {
      setHizliHata(h instanceof Error ? h.message : "Cari oluşturulamadı");
    }
  }

  async function hizliStokOlustur(event: React.FormEvent) {
    event.preventDefault();
    setHizliHata("");
    try {
      const yeni = await api<Stok>("/stok", {
        method: "POST",
        body: JSON.stringify({
          kod: yeniStokKod,
          ad: yeniStokAd,
          tip: "urun",
          barkod: yeniStokBarkod || null,
          kdvOrani: yeniStokKdv,
          alisFiyati: tip === "alis" && yeniStokFiyat ? yeniStokFiyat : null,
          satisFiyati: tip !== "alis" && yeniStokFiyat ? yeniStokFiyat : null,
        }),
      });
      setStoklar((eskiler) => [yeni, ...eskiler]);
      setSatirlar((eskiler) => eskiler.map((satir, index) =>
        index === hizliStokSatir
          ? {
              ...satir,
              stokId: yeni.id,
              kdvOrani: Number(yeni.kdvOrani),
              birimFiyat: Number(tip === "alis" ? yeni.alisFiyati ?? 0 : yeni.satisFiyati ?? 0),
            }
          : satir,
      ));
      setHizliPanel(null);
      setYeniStokKod("");
      setYeniStokAd("");
      setYeniStokBarkod("");
      setYeniStokKdv("20");
      setYeniStokFiyat("");
      setBasari(`${yeni.ad} oluşturuldu ve satıra seçildi.`);
      requestAnimationFrame(() => miktarRefleri.current[hizliStokSatir]?.focus());
    } catch (h) {
      setHizliHata(h instanceof Error ? h.message : "Ürün oluşturulamadı");
    }
  }

  useEffect(() => {
    if (cariId && satirlar.some((s) => s.stokId)) {
      const guncelleFiyatlar = async () => {
        const yeni = [...satirlar];
        for (let i = 0; i < yeni.length; i++) {
          if (yeni[i].stokId) {
            try {
              const tavsiye = await api<{ birimFiyat: number; iskontoOrani: number }>(
                `/stok/${yeni[i].stokId}/tavsiye-fiyat?cariId=${cariId}&tip=${tip}`
              );
              yeni[i].birimFiyat = tavsiye.birimFiyat;
              yeni[i].iskontoOrani = tavsiye.iskontoOrani;
            } catch (err) {
              console.error(err);
            }
          }
        }
        setSatirlar(yeni);
      };
      void guncelleFiyatlar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariId, tip]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");

    if (!cariId) {
      setHata("Lütfen bir cari hesap seçin.");
      return;
    }

    const eksikStok = satirlar.some((s) => !s.stokId);
    if (eksikStok) {
      setHata("Lütfen tüm satırlarda ürün/hizmet seçimi yapın.");
      return;
    }

    try {
      await api("/fatura", {
        method: "POST",
        body: JSON.stringify({
          cariId,
          // STK-07: boş bırakılırsa sunucu varsayılan depoyu kullanır
          depoId: depoId || null,
          tip,
          tarih,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            miktar: String(s.miktar),
            birim: "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
            gibIstisnaKodu: s.gibIstisnaKodu || undefined,
          })),
        }),
      });

      setBasari("Fatura taslağı başarıyla oluşturuldu.");
      setFormAcik(false);
      setCariId("");
      setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" }]);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Fatura oluşturulamadı");
    }
  }

  async function kesinlestir(id: string) {
    if (!confirm("Bu faturayı kesinleştirmek istediğinize emin misiniz? Bu işlem geri alınamaz ve e-Belge kuyruğuna gönderilir.")) return;
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/kesinlestir`, { method: "POST" });
      setBasari("Fatura başarıyla kesinleştirildi ve e-Belge süreci başlatıldı.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kesinleştirme hatası");
    }
  }

  async function sil(id: string) {
    if (!confirm("Taslak faturayı silmek istediğinize emin misiniz?")) return;
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}`, { method: "DELETE" });
      setBasari("Fatura başarıyla silindi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Silme hatası");
    }
  }

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/kopyala`, { method: "POST" });
      setBasari("Fatura başarıyla kopyalandı ve taslak olarak kaydedildi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  async function ebelgeSorgula(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/ebelge/sorgula/${id}`, { method: "POST" });
      setBasari("e-Belge durumu sorgulandı ve güncellendi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sorgulama hatası");
    }
  }

  /** FTR-09: proformadan yeni taslak satış faturası üretir. */
  async function satisaDonustur(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/satisa-donustur`, { method: "POST" });
      setBasari("Proforma, taslak satış faturasına dönüştürüldü.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dönüştürme hatası");
    }
  }

  /** Boş bırakılırsa API carinin kayıtlı e-postasına gönderir. */
  async function epostaGonder(id: string, eposta: string) {
    setHata("");
    setBasari("");
    try {
      const yanit = await api<{ alici: string }>(`/fatura/${id}/pdf-gonder`, {
        method: "POST",
        body: JSON.stringify(eposta.trim() === "" ? {} : { eposta: eposta.trim() }),
      });
      setBasari(`Fatura PDF'i ${yanit.alici} adresine gönderildi.`);
      setEpostaGonderilen(null);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "E-posta gönderilemedi");
    }
  }

  function pdfAc(id: string) {
    const token = tokenAl();
    const url = `${apiBase()}/fatura/${id}/pdf?token=${token ?? ""}`;
    window.open(url, "_blank");
  }

  const gorunenFaturalar = yonBaglami
    ? faturalar.filter((f) =>
        yonBaglami === "satis"
          ? ["satis", "satis_iade", "proforma"].includes(f.tip)
          : ["alis", "alis_iade"].includes(f.tip),
      )
    : faturalar;
  const sayfaBasligi =
    yonBaglami === "satis"
      ? "Satış Faturaları"
      : yonBaglami === "alis"
        ? "Alış Faturaları"
        : "Fatura Yönetimi";

  return (
    <div>
      <PageHeader
        title={sayfaBasligi}
        subtitle={
          yonBaglami === "satis"
            ? "Müşteri faturalarını hazırlayın, kesinleştirin ve e-Belge durumlarını takip edin."
            : yonBaglami === "alis"
              ? "Tedarikçi faturalarını kaydedin ve ödeme sürecine hazırlayın."
              : "Alış ve satış faturalarını tek görünümde yönetin."
        }
        actions={
          <>
            <ButtonLabel as="a" href="/panel/fatura/raporlar">📈 Raporlar</ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Fatura"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {epostaGonderilen && (
        <Card className="stack" style={{ marginBottom: "1.5rem", borderColor: "var(--accent)", maxWidth: 620 }}>
          <div className="between">
            <div className="card__title" style={{ margin: 0 }}>
              ✉️ Fatura PDF&apos;ini E-posta ile Gönder
            </div>
            <Button size="sm" onClick={() => { setEpostaGonderilen(null); setEpostaAdresi(""); }}>✖ Vazgeç</Button>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            {epostaGonderilen.no} · {epostaGonderilen.cari.unvan} · {tl(epostaGonderilen.genelToplam)}
          </p>
          <Field label="Alıcı E-posta">
            <Input
              type="email"
              value={epostaAdresi}
              onChange={(e) => setEpostaAdresi(e.target.value)}
              placeholder="Boş bırakılırsa cari kartındaki adres kullanılır"
            />
          </Field>
          <div>
            <Button variant="primary" onClick={() => epostaGonder(epostaGonderilen.id, epostaAdresi)}>
              Gönder
            </Button>
          </div>
        </Card>
      )}

      {formAcik && (
        <div className="document-editor">
          <div className="document-editor__head">
            <h3>Yeni {tip === "alis" ? "alış" : tip === "proforma" ? "proforma" : "satış"} faturası</h3>
            <span className="badge badge--warning">Taslak</span>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Cari ve belge bilgileri</h4>
            <div className="document-fields">
              <Field label={tip === "alis" ? "Tedarikçi" : "Müşteri"}>
                <AramaSecici
                  ariaLabel={tip === "alis" ? "Tedarikçi ara" : "Müşteri ara"}
                  deger={cariId}
                  kullanimAnahtari="tekir_son_cariler"
                  onChange={setCariId}
                  placeholder="Ünvan, cari kodu veya VKN ile ara"
                  yeniKayit={{
                    etiket: tip === "alis" ? "Yeni tedarikçi oluştur" : "Yeni müşteri oluştur",
                    onClick: () => { setHizliHata(""); setHizliPanel("cari"); },
                  }}
                  secenekler={cariler.map((cari) => ({
                    deger: cari.id,
                    baslik: cari.unvan,
                    aciklama: [cari.kod, cari.vknTckn].filter(Boolean).join(" · ") || "Cari hesap",
                    aramaMetni: [cari.kod, cari.vknTckn].filter(Boolean).join(" "),
                  }))}
                />
              </Field>
              <Field label="Fatura Tipi">
                <Select value={tip} onChange={(e) => { setTip(e.target.value); setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]); }}>
                  <option value="satis">Satış Faturası</option>
                  <option value="alis">Alış Faturası</option>
                  <option value="proforma">Proforma</option>
                </Select>
              </Field>
              <Field label="Fatura Tarihi">
                <Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required />
              </Field>
              <div>
                <DepoSecici deger={depoId} onChange={setDepoId} />
              </div>
            </div>
            {cariOzeti && (
              <div className={`customer-context${cariOzeti.risk.asim ? " is-warning" : ""}`}>
                <div><span>TRY bakiye</span><strong>{tl(cariOzeti.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? 0)}</strong></div>
                <div><span>Mevcut risk</span><strong>{tl(cariOzeti.risk.mevcutRisk)}</strong></div>
                <div><span>Kullanılabilir limit</span><strong>{cariOzeti.risk.kalanLimit === null ? "Limit yok" : tl(cariOzeti.risk.kalanLimit)}</strong></div>
                <div><span>Varsayılan vade</span><strong>{cariOzeti.varsayilanVadeGun ? `${cariOzeti.varsayilanVadeGun} gün` : "Tanımsız"}</strong></div>
                <div><span>e-Belge</span><strong>{cariOzeti.eFaturaMukellefi ? "e-Fatura" : "e-Arşiv"}</strong></div>
                {cariOzeti.risk.asim && <p>Risk limiti aşılmış. Kesinleştirmeden önce cari durumunu kontrol edin.</p>}
              </div>
            )}
          </div>

          <div className="document-editor__section document-lines invoice-lines">
            <h4 className="document-editor__section-title">Fatura kalemleri</h4>
            <TableWrap>
              <colgroup>
                <col className="document-line-col--product" />
                <col className="document-line-col--quantity" />
                <col className="document-line-col--price" />
                <col className="document-line-col--rate" />
                <col className="document-line-col--rate" />
                <col className="document-line-col--total" />
                <col className="document-line-col--action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Ürün/Hizmet</th>
                  <th className="num">Miktar</th>
                  <th className="num">Birim fiyat</th>
                  <th className="num">İsk. %</th>
                  <th className="num">KDV %</th>
                  <th className="num">Tutar</th>
                  <th><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody>
                {satirlar.map((s, index) => {
                  const satirSonuc = sonuc.satirlar[index];
                  const seciliStok = stoklar.find((stok) => stok.id === s.stokId);
                  const kullanilabilir = Number(seciliStok?.kullanilabilirMiktar ?? 0);
                  const stokYetersiz = tip === "satis" && seciliStok?.kullanilabilirMiktar !== undefined && Number(s.miktar) > kullanilabilir;
                  return (
                    <Fragment key={index}>
                    <tr>
                      <td className="invoice-line__product">
                        <AramaSecici
                          ariaLabel={`${index + 1}. satır ürün veya hizmet seçimi`}
                          deger={s.stokId}
                          kullanimAnahtari="tekir_son_urunler"
                          inputRef={(eleman) => { urunRefleri.current[index] = eleman; }}
                          onChange={(deger) => urunSec(index, deger)}
                          onSecim={(deger) => requestAnimationFrame(() => {
                            if (s.stokId === deger) urunRefleri.current[index]?.focus();
                            else miktarRefleri.current[index]?.focus();
                          })}
                          placeholder="Kod, barkod veya ürün adıyla ara"
                          yeniKayit={{
                            etiket: "Yeni ürün oluştur",
                            onClick: () => { setHizliHata(""); setHizliStokSatir(index); setHizliPanel("stok"); },
                          }}
                          secenekler={stoklar.map((stok) => ({
                            deger: stok.id,
                            baslik: stok.ad,
                            aciklama: [
                              stok.kod,
                              stok.barkod && `Barkod: ${stok.barkod}`,
                              stok.kullanilabilirMiktar !== undefined && `Stok: ${Number(stok.kullanilabilirMiktar).toLocaleString("tr-TR")} ${stok.anaBirim ?? "adet"}`,
                              tip === "alis"
                                ? stok.alisFiyati && `Alış: ${tl(stok.alisFiyati)}`
                                : stok.satisFiyati && `Satış: ${tl(stok.satisFiyati)}`,
                              `KDV %${Number(stok.kdvOrani)}`,
                            ].filter(Boolean).join(" · "),
                            aramaMetni: [stok.kod, stok.barkod].filter(Boolean).join(" "),
                          }))}
                        />
                        {seciliStok && (
                          <span className={`document-line-stock${stokYetersiz ? " is-warning" : ""}`}>
                            {stokYetersiz
                              ? `Yetersiz stok: ${kullanilabilir.toLocaleString("tr-TR")} ${seciliStok.anaBirim ?? "adet"} kullanılabilir`
                              : `Stok: ${kullanilabilir.toLocaleString("tr-TR")} ${seciliStok.anaBirim ?? "adet"}`}
                          </span>
                        )}
                      </td>
                      <td className="invoice-line__field" data-label="Miktar"><Input className="document-line-number" aria-label="Miktar" type="number" min="0.01" step="any" inputMode="decimal" ref={(eleman) => { miktarRefleri.current[index] = eleman; }} value={s.miktar} onChange={(e) => satirGuncelle(index, "miktar", Number(e.target.value))} required /></td>
                      <td className="invoice-line__field" data-label="Birim fiyat"><Input className="document-line-number" aria-label="Birim fiyat" type="number" min="0" step="any" inputMode="decimal" value={s.birimFiyat} onChange={(e) => satirGuncelle(index, "birimFiyat", Number(e.target.value))} required /></td>
                      <td className="invoice-line__field" data-label="İskonto %"><Input className="document-line-number" aria-label="İskonto yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.iskontoOrani} onChange={(e) => satirGuncelle(index, "iskontoOrani", Number(e.target.value))} /></td>
                      <td className="invoice-line__field" data-label="KDV %"><Input className="document-line-number" aria-label="KDV yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.kdvOrani} onChange={(e) => satirGuncelle(index, "kdvOrani", Number(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); satirEkle(); } }} required /></td>
                      <td className="num document-line-total invoice-line__total" data-label="Tutar">{satirSonuc ? tl(satirSonuc.toplamTutar) : "0,00 TL"}</td>
                      <td className="center invoice-line__action">
                        <Button aria-expanded={acikSatir === index} aria-label="Satır ayrıntıları" title="Satır ayrıntıları" size="sm" type="button" onClick={() => setAcikSatir(acikSatir === index ? null : index)}>⋯</Button>
                      </td>
                    </tr>
                    {acikSatir === index && (
                      <tr className="document-line-detail">
                        <td colSpan={7}>
                          <div className="document-line-detail__content">
                            <Field label="GİB istisna kodu">
                              <Input className="document-line-code" aria-label="GİB istisna kodu" type="text" placeholder="351" value={s.gibIstisnaKodu || ""} onChange={(e) => satirGuncelle(index, "gibIstisnaKodu", e.target.value)} />
                            </Field>
                            <div className="document-line-detail__actions">
                              <Button size="sm" type="button" onClick={() => satirKopyala(index)}>Satırı kopyala</Button>
                              <Button aria-label="Satırı sil" variant="danger" size="sm" type="button" disabled={satirlar.length === 1} onClick={() => satirSil(index)}>Satırı sil</Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </TableWrap>

            <div className="document-summary-row">
              <Button type="button" onClick={satirEkle}>+ Satır ekle</Button>
              <div className="document-totals">
                <div className="document-total-line">
                  <span>Brüt toplam</span><span>{tl(sonuc.toplamBrut)}</span>
                </div>
                <div className="document-total-line is-discount">
                  <span>Toplam iskonto</span><span>-{tl(sonuc.toplamSatirIskontosu)}</span>
                </div>
                <div className="document-total-line is-tax">
                  <span>KDV toplamı</span><span>{tl(sonuc.toplamKdv)}</span>
                </div>
                <div className="document-total-line is-grand">
                  <span>Ödenecek</span><span>{tl(sonuc.genelToplam)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="document-editor__actions">
            <Button variant="primary" onClick={kaydet}>Taslak faturayı kaydet</Button>
          </div>
        </div>
      )}

      {hizliPanel === "cari" && (
        <HizliKayitPaneli baslik={tip === "alis" ? "Yeni tedarikçi" : "Yeni müşteri"} onKapat={() => setHizliPanel(null)}>
          <form className="quick-panel__form" onSubmit={hizliCariOlustur}>
            <Alert tone="error">{hizliHata}</Alert>
            <Field label="Ünvan / Ad soyad"><Input autoFocus value={yeniCariUnvan} onChange={(e) => setYeniCariUnvan(e.target.value)} required /></Field>
            <Field label="Cari kodu"><Input value={yeniCariKod} onChange={(e) => setYeniCariKod(e.target.value)} required placeholder="CARI-001" /></Field>
            <Field label="VKN / TCKN"><Input inputMode="numeric" value={yeniCariVkn} onChange={(e) => setYeniCariVkn(e.target.value)} placeholder="İsteğe bağlı" /></Field>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setHizliPanel(null)}>Vazgeç</Button>
              <Button type="submit" variant="primary">Oluştur ve seç</Button>
            </div>
          </form>
        </HizliKayitPaneli>
      )}

      {hizliPanel === "stok" && (
        <HizliKayitPaneli baslik="Yeni ürün" onKapat={() => setHizliPanel(null)}>
          <form className="quick-panel__form" onSubmit={hizliStokOlustur}>
            <Alert tone="error">{hizliHata}</Alert>
            <Field label="Ürün adı"><Input autoFocus value={yeniStokAd} onChange={(e) => setYeniStokAd(e.target.value)} required /></Field>
            <Field label="Stok kodu"><Input value={yeniStokKod} onChange={(e) => setYeniStokKod(e.target.value)} required placeholder="STK-001" /></Field>
            <Field label="Barkod"><Input value={yeniStokBarkod} onChange={(e) => setYeniStokBarkod(e.target.value)} /></Field>
            <Field label={tip === "alis" ? "Alış fiyatı (TRY)" : "Satış fiyatı (TRY)"}><Input className="record-number" type="number" min="0" step="0.0001" inputMode="decimal" value={yeniStokFiyat} onChange={(e) => setYeniStokFiyat(e.target.value)} placeholder="0,00" /></Field>
            <Field label="KDV (%)"><Input className="record-number" type="number" min="0" max="100" inputMode="decimal" value={yeniStokKdv} onChange={(e) => setYeniStokKdv(e.target.value)} required /></Field>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setHizliPanel(null)}>Vazgeç</Button>
              <Button type="submit" variant="primary">Oluştur ve seç</Button>
            </div>
          </form>
        </HizliKayitPaneli>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Fatura No</th>
              <th>Firma / Cari</th>
              <th>Tarih</th>
              <th>Tip</th>
              <th className="num">Net Tutar</th>
              <th className="num">Genel Toplam</th>
              <th>Durum</th>
              <th>e-Belge</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {gorunenFaturalar.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">Sistemde henüz kayıtlı fatura bulunmuyor.</td>
              </tr>
            ) : (
              gorunenFaturalar.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 700 }} className="mono">{f.no || "(Taslak)"}</td>
                  <td>{f.cari.unvan}</td>
                  <td>{f.tarih}</td>
                  <td>{TIP_ETIKETLERI[f.tip] ?? f.tip}</td>
                  <td className="num">{tl(f.toplamMatrah)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(f.genelToplam)}</td>
                  <td>
                    {f.durum === "taslak"
                      ? <Badge variant="warning">📝 Taslak</Badge>
                      : <Badge variant="success">🔒 Kesinleşti</Badge>}
                  </td>
                  <td>
                    {f.ebelge ? (
                      <Badge variant={EBELGE_DURUMLARI[f.ebelge.durum]?.renk ?? "neutral"}>
                        {EBELGE_DURUMLARI[f.ebelge.durum]?.baslik ?? f.ebelge.durum}
                        {f.ebelge.tur === "efatura" ? " · e-Fatura" : " · e-Arşiv"}
                      </Badge>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td className="center">
                    <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                      {f.durum === "taslak" ? (
                        <>
                          <Button variant="primary" size="sm" onClick={() => kesinlestir(f.id)}>🔒 Kesinleştir</Button>
                          <Button variant="danger" size="sm" onClick={() => sil(f.id)}>Sil</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => pdfAc(f.id)}>🖨 PDF</Button>
                          <Button size="sm" onClick={() => setEpostaGonderilen(f)}>✉️ E-posta</Button>
                          {f.ebelge && !["kabul", "iletildi"].includes(f.ebelge.durum) && (
                            <Button size="sm" onClick={() => ebelgeSorgula(f.id)}>Sorgula</Button>
                          )}
                        </>
                      )}
                      {/* FTR-09: yalnız proforma satışa dönüştürülebilir */}
                      {f.tip === "proforma" && (
                        <Button size="sm" onClick={() => satisaDonustur(f.id)}>➡️ Satışa Dönüştür</Button>
                      )}
                      <Button size="sm" onClick={() => kopyala(f.id)}>📋 Kopyala</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
