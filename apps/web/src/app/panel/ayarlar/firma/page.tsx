"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, kimlikliFetch, tokenAl, tokenYaz } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { EBELGE_UYGULAMALARI, ebelgeKullanilmiyor, ILAVE_FATURA_TIPLERI, ILLER, ilBul, tekVergiDairesi, vergiDaireleriniSirala, ilaveFaturaTipiBul, SGK_TANIMSIZ_KOD, type EbelgeUygulamaKodu, type EbelgeUygulamalari } from "@tekirextra/shared";

interface Logo {
  id: string;
  dosyaAdi: string;
  mimeTip: string;
  boyut: number;
}

interface Firma {
  id: string;
  unvan: string;
  kisiTuru: "gercek" | "tuzel";
  vkn: string;
  vergiDairesi: string | null;
  vergiDairesiKodu: string | null;
  logo: Logo | null;
  /** EBLG-62: e-belgenin satıcı tarafına ve PDF'lere yazılan bilgiler. */
  adres: string | null;
  ilce: string | null;
  il: string | null;
  postaKodu: string | null;
  telefon: string | null;
  eposta: string | null;
  webSitesi: string | null;
  mersisNo: string | null;
  ticaretSicilNo: string | null;
  /** Yolcu beraberi (tax-free): KDV iadesini yapan aracı kurumun varsayılanı. */
  araciKurumVkn: string | null;
  araciKurumEtiket: string | null;
  araciKurumUnvan: string | null;
  sgkIlaveFaturaTipi: string | null;
  sgkMukellefKodu: string | null;
  sgkMukellefAdi: string | null;
  /** EBLG-77: firmanın kendi mükellefiyetleri; null "otomatik" demektir. */
  efaturaMukellefi: boolean | null;
  /** EBLG-77: elle "kayıtlı değiliz" denmiş ama GİB listesi aksini söylüyor. */
  ebelgeCelismeleri?: string[];
  earsivMukellefi: boolean | null;
  eirsaliyeMukellefi: boolean | null;
  ebelgeUygulamalari?: EbelgeUygulamalari;
  /** e-Belge gönderimini durduran eksikler; boşsa gönderilebilir. */
  ebelgeEksikleri: string[];
  abonelik: {
    planKodu: string;
    durum: "deneme" | "aktif" | "askida" | "iptal";
    faturaEpostasi: string | null;
    donemBaslangici: string | null;
    donemSonu: string | null;
  } | null;
}

const ILETISIM_ALANLARI = ["adres", "ilce", "il", "postaKodu", "telefon", "eposta", "webSitesi", "mersisNo", "ticaretSicilNo", "araciKurumVkn", "araciKurumEtiket", "araciKurumUnvan", "sgkIlaveFaturaTipi", "sgkMukellefKodu", "sgkMukellefAdi"] as const;
type IletisimAlani = (typeof ILETISIM_ALANLARI)[number];
const BOS_ILETISIM = Object.fromEntries(ILETISIM_ALANLARI.map((a) => [a, ""])) as Record<IletisimAlani, string>;
const iletisimOku = (f: Firma) => Object.fromEntries(ILETISIM_ALANLARI.map((a) => [a, f[a] ?? ""])) as Record<IletisimAlani, string>;


/** Seçimin altındaki açıklama: geçerli durum ve nereden geldiği (EBLG-77). */
function uygulamaAciklamasi(kod: EbelgeUygulamaKodu, uygulamalar: EbelgeUygulamalari | undefined): string {
  const durum = uygulamalar?.[kod];
  const deger = durum?.acik === null || durum === undefined
    ? "Bilinmiyor"
    : durum.acik ? "Kayıtlı" : "Kayıtlı değil";
  const kaynak = durum?.kaynak === "elle" ? "firma ayarı" : durum?.kaynak === "entegrator" ? "GİB mükellef listesi" : "belirlenemedi";
  const ek = kod === "eirsaliye"
    ? " e-İrsaliye, e-Fatura'ya kayıtlı olmayı gerektirir."
    : kod === "efatura"
      ? " Kapalıysa belgeler e-Arşiv olarak düzenlenir; bunu yalnız firma GİB'de e-Fatura'ya gerçekten kayıtlı değilse seçin — entegratör ayara değil GİB listesine bakar."
      : "";
  return `Geçerli durum: ${deger} (${kaynak}).${ek}`;
}

export default function FirmaAyarlariSayfasi() {
  const yonlendir = useRouter();
  const [firma, setFirma] = useState<Firma | null>(null);
  const [unvan, setUnvan] = useState("");
  const [vergiDairesi, setVergiDairesi] = useState("");
  const [vergiDaireleri, setVergiDaireleri] = useState<{ kod: string; ilKodu: string; il: string; ilce: string; ad: string }[]>([]);
  const [seciliIlKodu, setSeciliIlKodu] = useState("");
  const [seciliDaireKodu, setSeciliDaireKodu] = useState("");
  const [mukellefiyetler, setMukellefiyetler] = useState<Record<EbelgeUygulamaKodu, boolean | null>>({ efatura: null, earsiv: null, eirsaliye: null });
  const [iletisim, setIletisim] = useState<Record<IletisimAlani, string>>(BOS_ILETISIM);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // Mükellef kodu/adı yalnız sağlık gruplarında istenir; etiketleri de gruptan gelir.
  const sgkTipi = ilaveFaturaTipiBul(iletisim.sgkIlaveFaturaTipi);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState(false);

  const yukleLogo = useCallback(async (logoId: string) => {
    try {
      const res = await kimlikliFetch(`/ekler/${logoId}/indir`);
      if (res.ok) {
        const blob = await res.blob();
        setLogoUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      console.error("Logo yükleme hatası", err);
    }
  }, []);

  const yukle = useCallback(async () => {
    try {
      const veri = await api<Firma>("/firma");
      setFirma(veri);
      setUnvan(veri.unvan);
      setVergiDairesi(veri.vergiDairesi ?? "");
      setSeciliDaireKodu(veri.vergiDairesiKodu ?? "");
      setMukellefiyetler({ efatura: veri.efaturaMukellefi, earsiv: veri.earsivMukellefi, eirsaliye: veri.eirsaliyeMukellefi });
      setIletisim(iletisimOku(veri));
      if (veri.logo) {
        void yukleLogo(veri.logo.id);
      } else {
        setLogoUrl(null);
      }
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) {
        tokenYaz(null);
        yonlendir.push("/giris");
      } else {
        setHata(h instanceof Error ? h.message : "Firma bilgileri yüklenemedi");
      }
    }
  }, [yonlendir, yukleLogo]);

  useEffect(() => {
    if (!tokenAl()) {
      yonlendir.push("/giris");
      return;
    }
    void yukle();
  }, [yonlendir, yukle]);

  useEffect(() => { void api<typeof vergiDaireleri>("/vergi-daireleri").then(setVergiDaireleri).catch(() => setVergiDaireleri([])); }, []);
  useEffect(() => {
    const il = ilBul(firma?.il);
    if (il) setSeciliIlKodu(il.kod);
  }, [firma]);
  // İlçe resmi listeden gelir; GİB büyükşehir dairelerini "Merkez" altında verdiği
  // için daire ilçeye göre değil il içinden seçilir, ilçeye yakın olanlar öne alınır.
  const iller = ILLER;
  const ilceler = ilBul(seciliIlKodu)?.ilceler ?? [];
  const { yakin: yakinDaireler, diger: digerDaireler } = vergiDaireleriniSirala(vergiDaireleri, seciliIlKodu, iletisim.ilce);
  const seciliDaireler = [...yakinDaireler, ...digerDaireler];
  const seciliIlAdi = iller.find((i) => i.kod === seciliIlKodu)?.ad ?? "";

  async function bilgileriKaydet(e: FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    setIslemde(true);
    try {
      const guncel = await api<Firma>("/firma", {
        method: "PATCH",
        body: JSON.stringify({
          unvan: unvan || undefined,
          vergiDairesi: vergiDairesi || undefined,
          vergiDairesiKodu: seciliDaireKodu || undefined,
          efaturaMukellefi: mukellefiyetler.efatura,
          earsivMukellefi: mukellefiyetler.earsiv,
          eirsaliyeMukellefi: mukellefiyetler.eirsaliye,
          // Boş alan "sil" demektir; sunucu null olarak kaydeder.
          ...iletisim,
        }),
      });
      setBasari("Firma bilgileri başarıyla güncellendi.");
      setFirma(guncel);
      setIletisim(iletisimOku(guncel));
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Güncelleme hatası");
    } finally {
      setIslemde(false);
    }
  }

  async function logoYukle(e: React.ChangeEvent<HTMLInputElement>) {
    const dosya = e.target.files?.[0];
    if (!dosya || !firma) return;

    setHata("");
    setBasari("");
    setIslemde(true);

    const formData = new FormData();
    formData.append("dosya", dosya);

    try {
      // Önce varsa eski logoyu silelim (leaks önlemek için)
      if (firma.logo) {
        await api(`/ekler/${firma.logo.id}`, { method: "DELETE" }).catch(() => undefined);
      }

      const res = await kimlikliFetch(`/ekler?sahipTur=firma&sahipId=${firma.id}`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.mesaj || errJson.message || "Logo yükleme hatası");
      }

      setBasari("Firma logosu başarıyla güncellendi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Logo yüklenemedi");
    } finally {
      setIslemde(false);
    }
  }

  async function logoSil() {
    if (!firma || !firma.logo) return;
    if (!confirm("Firma logosunu silmek istediğinize emin misiniz?")) return;

    setHata("");
    setBasari("");
    setIslemde(true);

    try {
      await api(`/ekler/${firma.logo.id}`, { method: "DELETE" });
      setBasari("Firma logosu silindi.");
      setLogoUrl(null);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Logo silinemedi");
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <PageHeader
        title="Firma Ayarları"
        subtitle="Şirketinizin genel kimlik bilgilerini ve faturada görünecek kurumsal logosunu buradan yönetin."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        <Card>
          <div className="between">
            <div>
              <h2 className="card__title" style={{ fontSize: "1.1rem", margin: 0 }}>Hesap ve Abonelik Altyapısı</h2>
              <p className="muted" style={{ margin: ".35rem 0 0" }}>v1.0 sürümünde fiyatlandırma ve ücret tahsilatı uygulanmaz.</p>
            </div>
            <Badge variant={firma?.abonelik?.durum === "aktif" ? "success" : "neutral"}>{firma?.abonelik?.durum ?? "Hazırlanıyor"}</Badge>
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <div className="grow"><span className="subtle">Plan kodu</span><div><strong>{firma?.abonelik?.planKodu ?? "v1"}</strong></div></div>
            <div className="grow"><span className="subtle">Fatura iletişimi</span><div><strong>{firma?.abonelik?.faturaEpostasi ?? "—"}</strong></div></div>
            <div className="grow"><span className="subtle">Dönem</span><div><strong>{firma?.abonelik?.donemBaslangici && firma.abonelik.donemSonu ? `${new Date(firma.abonelik.donemBaslangici).toLocaleDateString("tr-TR")} – ${new Date(firma.abonelik.donemSonu).toLocaleDateString("tr-TR")}` : "Süresiz v1 erişimi"}</strong></div></div>
          </div>
        </Card>

        {/* LOGO GÜNCELLEME KARTI */}
        <Card>
          <h2 className="card__title" style={{ fontSize: "1.1rem" }}>🖼️ Firma Logosu</h2>
          <div className="row" style={{ alignItems: "center", gap: "2rem" }}>
            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: "var(--radius)",
                border: "2px dashed var(--border-strong)",
                background: "var(--surface-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Firma Logosu" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <div className="subtle" style={{ textAlign: "center", fontSize: "0.8rem", padding: 10 }}>Logo Yok</div>
              )}
            </div>
            <div className="grow" style={{ minWidth: 260 }}>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 1rem", maxWidth: 400 }}>
                Faturanızda ve resmi çıktılarda yer alacak şirketinize ait logoyu yükleyin.
                İzin verilen formatlar: PNG, JPEG, WEBP. Maksimum boyut: 10 MB.
              </p>
              <div className="row-tight">
                <ButtonLabel variant="primary">
                  {islemde ? "Yükleniyor…" : "Logo Yükle"}
                  <input type="file" accept="image/png, image/jpeg, image/webp" onChange={logoYukle} disabled={islemde} style={{ display: "none" }} />
                </ButtonLabel>
                {logoUrl && (
                  <Button variant="danger" onClick={logoSil} disabled={islemde}>Logoyu Kaldır</Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* GENEL BİLGİLER FORMU */}
        <Card>
          <h2 className="card__title" style={{ fontSize: "1.1rem" }}>📋 Genel Bilgiler</h2>
          <form onSubmit={bilgileriKaydet} className="stack">
            <div className="row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label="Firma Resmi Unvanı">
                  <Input value={unvan} onChange={(e) => setUnvan(e.target.value)} required placeholder="Ör. Tekir Teknoloji Ltd. Şti." />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label={`${firma?.kisiTuru === "gercek" ? "TCKN" : "VKN"} (Değiştirilemez)`}>
                  <Input value={firma?.vkn ?? ""} disabled style={{ background: "var(--surface-2)", color: "var(--text-subtle)", cursor: "not-allowed" }} />
                </Field>
              </div>
            </div>
            <Field label="Vergi Dairesi">
              {vergiDaireleri.length ? <Select value={seciliDaireler.some((d) => d.kod === seciliDaireKodu) ? seciliDaireKodu : "__eski"} onChange={(e) => { const d = seciliDaireler.find((x) => x.kod === e.target.value); setSeciliDaireKodu(d?.kod ?? ""); setVergiDairesi(d?.ad ?? ""); }}>
                {vergiDairesi && !seciliDaireler.some((d) => d.kod === seciliDaireKodu) && <option value="__eski">Mevcut: {vergiDairesi}</option>}
                <option value="">Vergi dairesi seçin</option>
                {yakinDaireler.length > 0 && <optgroup label={`${iletisim.ilce} ilçesindeki daireler`}>{yakinDaireler.map((d) => <option key={d.kod} value={d.kod}>{d.ad}</option>)}</optgroup>}
                {digerDaireler.length > 0 && <optgroup label={yakinDaireler.length ? `${seciliIlAdi} ilindeki diğer daireler` : `${seciliIlAdi} ilindeki daireler`}>{digerDaireler.map((d) => <option key={d.kod} value={d.kod}>{d.ad}</option>)}</optgroup>}
              </Select> : <Input value={vergiDairesi} onChange={(e) => setVergiDairesi(e.target.value)} placeholder="Ör. Kadıköy Vergi Dairesi" />}
            </Field>
            {/*
              * EBLG-77: firma hangi e-belge uygulamalarına kayıtlı? Kapalı
              * uygulamanın ekranları menüden kalkar, uçları reddedilir; ikisi
              * de kapalıysa fatura kağıda basılır.
              */}
            {EBELGE_UYGULAMALARI.map((uygulama) => (
              <Field key={uygulama.kod} label={`${uygulama.ad} mükellefiyeti`}>
                <Select
                  value={mukellefiyetler[uygulama.kod] === null ? "otomatik" : String(mukellefiyetler[uygulama.kod])}
                  onChange={(e) => setMukellefiyetler({ ...mukellefiyetler, [uygulama.kod]: e.target.value === "otomatik" ? null : e.target.value === "true" })}
                >
                  <option value="otomatik">{uygulama.kod === "earsiv" ? "e-Fatura mükellefiyetini izle" : "GİB mükellef listesinden belirle"}</option>
                  <option value="true">Evet, kayıtlıyız</option>
                  <option value="false">Hayır, kayıtlı değiliz</option>
                </Select>
                <small className="muted">{uygulamaAciklamasi(uygulama.kod, firma?.ebelgeUygulamalari)}</small>
              </Field>
            ))}
            {/* Ayar "kayıtlı değiliz" derken GİB listesi aksini söylüyor: entegratör listeye bakar. */}
            {firma?.ebelgeCelismeleri?.map((uyari) => (
              <Alert key={uyari} tone="warning">{uyari}</Alert>
            ))}
            {firma?.ebelgeUygulamalari && ebelgeKullanilmiyor(firma.ebelgeUygulamalari) && (
              <Alert tone="warning">Firma e-Fatura ve e-Arşiv uygulamalarına kayıtlı değil; faturalar e-belge olarak gönderilmez, kendi şablonumuzla kağıda basılır.</Alert>
            )}
            {/* EBLG-62: e-Fatura, e-Arşiv ve e-İrsaliye'nin satıcı tarafına ve PDF'lere yazılır. */}
            {firma && firma.ebelgeEksikleri.length > 0 && (
              <Alert tone="warning">{firma.ebelgeEksikleri.join(" ")} Bu bilgiler olmadan e-belge gönderilemez.</Alert>
            )}
            <Field label="Adres (mahalle, cadde/sokak, no)">
              <Input value={iletisim.adres} onChange={(e) => setIletisim({ ...iletisim, adres: e.target.value })} maxLength={300} placeholder="Ör. Maltepe Mh. Çırpıcı Yol Sk. No:7/2" />
            </Field>
            <div className="row">
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field label="İlçe">{seciliIlKodu && ilceler.length ? <Select value={iletisim.ilce} onChange={(e) => { const ilce = e.target.value; const tek = tekVergiDairesi(vergiDaireleri, seciliIlKodu, ilce); setIletisim({ ...iletisim, ilce }); setVergiDairesi(tek?.ad ?? ""); setSeciliDaireKodu(tek?.kod ?? ""); }}>{iletisim.ilce && !ilceler.includes(iletisim.ilce) && <option value={iletisim.ilce}>Mevcut: {iletisim.ilce}</option>}<option value="">İlçe seçin</option>{ilceler.map((x) => <option key={x} value={x}>{x}</option>)}</Select> : <Input value={iletisim.ilce} onChange={(e) => setIletisim({ ...iletisim, ilce: e.target.value })} maxLength={80} />}</Field>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field label="İl">{iller.length ? <Select value={seciliIlKodu || "__eski"} onChange={(e) => { const secim = iller.find((x) => x.kod === e.target.value); setSeciliIlKodu(secim?.kod ?? ""); setIletisim({ ...iletisim, il: secim?.ad ?? "", ilce: "" }); setVergiDairesi(""); setSeciliDaireKodu(""); }}>
                  {iletisim.il && !seciliIlKodu && <option value="__eski">Mevcut: {iletisim.il}</option>}<option value="">İl seçin</option>{iller.map((x) => <option key={x.kod} value={x.kod}>{x.ad}</option>)}
                </Select> : <Input value={iletisim.il} onChange={(e) => setIletisim({ ...iletisim, il: e.target.value })} maxLength={80} />}</Field>
              </div>
              <div style={{ flex: "0 1 120px", minWidth: 100 }}>
                <Field label="Posta kodu"><Input value={iletisim.postaKodu} onChange={(e) => setIletisim({ ...iletisim, postaKodu: e.target.value })} maxLength={10} inputMode="numeric" /></Field>
              </div>
            </div>
            <div className="row">
              <div style={{ flex: 1, minWidth: 160 }}>
                <Field label="Telefon"><Input value={iletisim.telefon} onChange={(e) => setIletisim({ ...iletisim, telefon: e.target.value })} maxLength={30} type="tel" /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="E-posta"><Input value={iletisim.eposta} onChange={(e) => setIletisim({ ...iletisim, eposta: e.target.value })} type="email" /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Web sitesi"><Input value={iletisim.webSitesi} onChange={(e) => setIletisim({ ...iletisim, webSitesi: e.target.value })} maxLength={200} placeholder="www.firma.com.tr" /></Field>
              </div>
            </div>
            <div className="row">
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="MERSİS no"><Input value={iletisim.mersisNo} onChange={(e) => setIletisim({ ...iletisim, mersisNo: e.target.value.replace(/\D/g, "") })} maxLength={16} inputMode="numeric" placeholder="16 hane" /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Ticaret sicil no"><Input value={iletisim.ticaretSicilNo} onChange={(e) => setIletisim({ ...iletisim, ticaretSicilNo: e.target.value })} maxLength={30} /></Field>
              </div>
            </div>
            <h3 style={{ margin: "1rem 0 0", fontSize: "0.95rem" }}>Yolcu beraberi (tax-free) aracı kurumu</h3>
            <p className="muted" style={{ margin: 0 }}>
              Türkiye'de ikamet etmeyen yolcuya yapılan satışta KDV iadesini yapan yetkili aracı kurum belgede bildirilir.
              Burada varsayılanı durur; sihirbazda faturaya özel değiştirilebilir.
            </p>
            <div className="row">
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Aracı kurum VKN"><Input value={iletisim.araciKurumVkn} onChange={(e) => setIletisim({ ...iletisim, araciKurumVkn: e.target.value.replace(/\D/g, "") })} maxLength={10} inputMode="numeric" placeholder="10 hane" /></Field>
              </div>
              <div style={{ flex: 2, minWidth: 260 }}>
                <Field label="Aracı kurum posta kutusu etiketi"><Input value={iletisim.araciKurumEtiket} onChange={(e) => setIletisim({ ...iletisim, araciKurumEtiket: e.target.value.trim() })} maxLength={200} placeholder="urn:mail:yolcuberaberpk@firma.com.tr" /></Field>
              </div>
            </div>
            <div className="row">
              <div style={{ flex: 1, minWidth: 260 }}>
                <Field label="Aracı kurum unvanı"><Input value={iletisim.araciKurumUnvan} onChange={(e) => setIletisim({ ...iletisim, araciKurumUnvan: e.target.value })} maxLength={200} /></Field>
              </div>
            </div>
            <h3 style={{ margin: "1rem 0 0", fontSize: "0.95rem" }}>SGK faturası</h3>
            <p className="muted" style={{ margin: 0 }}>
              Sosyal Güvenlik Kurumu'na kesilen faturada firmanın hangi grupta olduğu ve Kurum'da tanımlı kodu/adı bildirilir.
              Sağlık hizmeti sunucusunda bu bilgiler sabittir; burada varsayılanı durur, dosya no ve dönem her faturada sihirbazda girilir.
            </p>
            <div className="row">
              <div style={{ flex: 1, minWidth: 240 }}>
                <Field label="İlave fatura tipi">
                  <Select value={iletisim.sgkIlaveFaturaTipi} onChange={(e) => setIletisim({ ...iletisim, sgkIlaveFaturaTipi: e.target.value })}>
                    <option value="">Tanımsız</option>
                    {ILAVE_FATURA_TIPLERI.map((t) => <option key={t.kod} value={t.kod}>{t.kod} — {t.ad}</option>)}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label={sgkTipi?.mukellefKoduEtiketi ?? "Kurum'daki mükellef kodu"}>
                  <Input value={iletisim.sgkMukellefKodu} onChange={(e) => setIletisim({ ...iletisim, sgkMukellefKodu: e.target.value })} maxLength={40} placeholder={SGK_TANIMSIZ_KOD} disabled={!sgkTipi?.mukellefKoduEtiketi} />
                </Field>
              </div>
              <div style={{ flex: 2, minWidth: 240 }}>
                <Field label={sgkTipi?.mukellefAdiEtiketi ?? "Kurum'daki mükellef adı"}>
                  <Input value={iletisim.sgkMukellefAdi} onChange={(e) => setIletisim({ ...iletisim, sgkMukellefAdi: e.target.value })} maxLength={200} disabled={!sgkTipi?.mukellefAdiEtiketi} />
                </Field>
              </div>
            </div>
            <div>
              <Button variant="primary" type="submit" disabled={islemde}>
                {islemde ? "Kaydediliyor..." : "💾 Değişiklikleri Kaydet"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
