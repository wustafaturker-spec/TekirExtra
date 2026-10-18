"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import Link from "next/link";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

/**
 * Modül Ayarları (AYR-01/03): backend jenerik ayar altyapısını
 * (GET/PUT /ayarlar/:modul) tipli bir form ile tüketir. Alan tanımları burada
 * deklaratiftir; yeni modül ayarı gelince yalnız bu tablo genişletilir.
 */
type AlanTip = "enum" | "sayi" | "onay" | "metin" | "uzunMetin" | "kasaRef" | "bankaRef" | "kullaniciRef" | "sablon" | "gizli";
interface Alan {
  ad: string;
  etiket: string;
  tip: AlanTip;
  secenekler?: [string, string][]; // enum için [deger, etiket]
  min?: number;
  max?: number;
  ipucu?: string;
  /** kullaniciRef: seçilebilecek roller (varsayılan yönetici + muhasebe). */
  roller?: string[];
}
interface ModulTanim {
  baslik: string;
  ikon: string;
  alanlar: Alan[];
}

const HATIRLATMA_ALANLARI = "Kullanılabilir alanlar: {unvan} {firma} {toplam} {enEskiVade} {gecikmeGun} {faturaSayisi} {faturalar} — {faturalar} vadesi geçmiş belge tablosudur; metinde yoksa sona eklenir.";

const MODUL_TANIM: Record<string, ModulTanim> = {
  crm_belge_baglari: {
    baslik: "CRM Teklif Bağları", ikon: "📋", alanlar: [
      { ad: "mod", etiket: "CRM teklif bağı kullanım modu", tip: "enum", secenekler: [["kapali", "Kapalı"], ["salt_okunur", "Salt okunur"], ["pilot", "Pilot"], ["acik", "Açık"]], ipucu: "Pilot ve açık modda yönetici ve satış kullanıcıları teklif bağlayabilir. Salt okunur modda bağ kurma ve çözme kapalıdır." },
    ],
  },
  tahsilat_operasyonu: {
    baslik: "Tahsilat Operasyonu", ikon: "📋", alanlar: [
      { ad: "mod", etiket: "Tahsilat kullanım modu", tip: "enum", secenekler: [["kapali", "Kapalı"], ["salt_okunur", "Salt okunur"], ["pilot", "Pilot"], ["acik", "Açık"]], ipucu: "Pilot ve açık modda yönetici/muhasebe takip yazabilir. Salt okunur mod otomatik iş üretimini de durdurur." },
    ],
  },
  tahsilat_otomasyonu: {
    baslik: "Geciken Ödeme Sözü Takibi", ikon: "📅", alanlar: [
      { ad: "acik", etiket: "Geciken sözlerden otomatik takip oluştur", tip: "onay", ipucu: "Tahsilat operasyonu pilot/açık modundayken 15 dakikada bir taranır. Açık takip varsa söz o takibe bağlanır; sorumlusu ve işlem planı korunur. Tamamlanan takip yeniden açılmaz. E-posta veya SMS gönderilmez." },
      { ad: "sorumluUserId", etiket: "Otomatik takip sorumlusu", tip: "kullaniciRef", ipucu: "Yeni takipler bu aktif yönetici/muhasebe kullanıcısına atanır. Sorumlu pasifleşirse veya yetkisi kalkarsa otomatik üretim durur." },
      { ad: "uygulamaIciBildirim", etiket: "Sorumluya uygulama içi bildirim oluştur", tip: "onay", ipucu: "Yeni gecikmiş söz bağlandığında mevcut takibin sorumlusuna bildirim oluşturur. E-posta göndermez; kullanıcının vade bildirimi tercihini korur. Önceden bağlanmış sözler için geriye dönük bildirim üretmez." },
    ],
  },
  eposta_teklif_taslagi: {
    baslik: "E-postadan Teklif Taslağı", ikon: "✉️", alanlar: [
      { ad: "acik", etiket: "Gelen e-postadaki teklif taleplerinden taslak hazırla", tip: "onay", ipucu: "Açıldıktan sonra gelen e-postalar 5 dakikada bir yapay zekâyla sınıflandırılır (eski e-postalar için e-posta ekranındaki “Taslak hazırla” düğmesi). Teklif talebinde istenen ürünler stokla eşleştirilir, fiyat fiyat listesinden/karttan gelir ve numarasız taslak teklif açılır. Hiçbir şey onaylanmaz ya da gönderilmez. Gönderen cari değilse onaya tabi cari açma talebi bırakılır. Her e-posta bir-iki model çağrısıdır; aylık AI bütçesine tabidir." },
      { ad: "sorumluUserId", etiket: "Taslakların sorumlusu", tip: "kullaniciRef", roller: ["yonetici", "muhasebe", "satis"], ipucu: "Taslaklar bu kullanıcının kimliği ve yetkisiyle açılır; bildirimler ve cari açma onayı ona gelir. Satış rolü cari açamaz: cari açma talebi yalnız yönetici/muhasebe sorumluda bırakılır." },
      { ad: "acildiAt", etiket: "Açılış zamanı", tip: "gizli" },
    ],
  },
  teklif_takibi: {
    baslik: "Teklif Takibi", ikon: "⏰", alanlar: [
      { ad: "acik", etiket: "Yanıt gelmeyen teklifleri hatırlat", tip: "onay", ipucu: "E-postayla gönderilen (ya da gönderildi olarak işaretlenen) teklife belirlenen sürede yanıt gelmezse teklifi gönderen kullanıcıya bildirim düşer ve carinin CRM görevlerine takip görevi açılır. Kapalıyken de gönderim kaydı tutulur ve gelen yanıt teklifle eşleştirilir. Sistem müşteriye kendiliğinden e-posta göndermez." },
      { ad: "isGunu", etiket: "Hatırlatma süresi (iş günü)", tip: "sayi", min: 1, max: 30, ipucu: "Hafta sonu ve çalışma takvimindeki tatiller sayılmaz." },
      { ad: "gecerlilikUyariGun", etiket: "Geçerlilik bitimine kaç iş günü kala uyarılsın", tip: "sayi", min: 0, max: 30 },
    ],
  },
  maliyet_kontrolu: {
    baslik: "Satış Maliyet Kontrolü",
    ikon: "🔎",
    alanlar: [
      { ad: "mod", etiket: "Kullanım modu", tip: "enum", secenekler: [["kapali", "Kapalı"], ["salt_okunur", "Salt okunur"], ["pilot", "Pilot"], ["acik", "Açık"]], ipucu: "Şirket genelinde geçerlidir. Salt okunur: liste, Excel ve inceleme geçmişi. Pilot ve açık: yönetici/muhasebe inceleme kaydı yazabilir ve doğrulanmış kaydı kapatabilir. Pilot, seçilen şirketin deneme kullanımını belirtir; kullanıcı yetkilerini genişletmez." },
    ],
  },
  personel: {
    baslik: "Personel ve İK",
    ikon: "🧑‍💼",
    alanlar: [
      { ad: "maasMuhasebeyeAcik", etiket: "Maaş ve özlük verisi muhasebe rolüne açık", tip: "onay", ipucu: "Kapatılırsa İK ekranlarına yalnız yönetici ve İnsan Kaynakları rolü erişir (PRS-17)." },
    ],
  },
  arayuz: {
    baslik: "Arayüz",
    ikon: "🎨",
    alanlar: [
      { ad: "tema", etiket: "Tema", tip: "enum", secenekler: [["acik", "Açık"], ["koyu", "Koyu"]] },
      { ad: "sayfaBoyutu", etiket: "Sayfa boyutu (satır)", tip: "sayi", min: 10, max: 200 },
    ],
  },
  cari: {
    baslik: "Cari",
    ikon: "👥",
    alanlar: [
      { ad: "varsayilanVadeGun", etiket: "Varsayılan vade (gün)", tip: "sayi", min: 0, max: 365 },
      { ad: "varsayilanDoviz", etiket: "Varsayılan döviz", tip: "enum", secenekler: DOVIZ_CINSLERI.map((d) => [d, d]) },
      { ad: "riskLimitiPolitikasi", etiket: "Risk limiti politikası (CARI-32)", tip: "enum", secenekler: [["uyar", "Uyar"], ["engelle", "Engelle"], ["yonetici_onayi", "Yönetici onayı"]], ipucu: "Satış siparişi onayında ve satış faturası kesinleştirmede risk limiti aşılırsa davranış; yönetici onayında gerekçe denetim izine yazılır" },
      // CARI-38: vade hatırlatma / ihtar e-postası şablonları.
      { ad: "vadeHatirlatmaKonusu", etiket: "Vade hatırlatması — konu", tip: "metin" },
      { ad: "vadeHatirlatmaMetni", etiket: "Vade hatırlatması — metin", tip: "uzunMetin", ipucu: HATIRLATMA_ALANLARI },
      { ad: "ihtarKonusu", etiket: "Ödeme ihtarı — konu", tip: "metin" },
      { ad: "ihtarMetni", etiket: "Ödeme ihtarı — metin", tip: "uzunMetin", ipucu: HATIRLATMA_ALANLARI },
    ],
  },
  stok: {
    baslik: "Stok",
    ikon: "📦",
    alanlar: [
      { ad: "varsayilanBirim", etiket: "Varsayılan birim", tip: "metin" },
      { ad: "kritikSeviyeUyarisi", etiket: "Kritik seviye uyarısı", tip: "onay" },
      { ad: "eksiStokPolitikasi", etiket: "Eksi stok politikası (STK-17)", tip: "enum", secenekler: [["izin", "İzin ver"], ["uyar", "Uyar"], ["engelle", "Engelle"]], ipucu: "Satış çıkışında stok eksiye düşerse davranış" },
    ],
  },
  fatura: {
    baslik: "Fatura",
    ikon: "📄",
    alanlar: [
      { ad: "varsayilanSeri", etiket: "Varsayılan seri (3 büyük harf)", tip: "metin", ipucu: "Ör. TKR" },
      { ad: "varsayilanKdvOrani", etiket: "Varsayılan KDV (%)", tip: "sayi", min: 0, max: 100 },
      // FTR-37/42: şablon seçimi kalktı; görünüm Ayarlar > Belge Görünümü'nde.
      { ad: "faturaSablonu", etiket: "Belge görünümü", tip: "sablon" },
      { ad: "vurguRengi", etiket: "Vurgu rengi", tip: "gizli" },
    ],
  },
  satin_alma: {
    baslik: "Satın Alma",
    ikon: "🛒",
    alanlar: [
      { ad: "onayEsigi", etiket: "Onay eşiği (TL)", tip: "sayi", min: 0, max: 1_000_000_000, ipucu: "Tahmini tutar eşik ve altındaysa muhasebe, üstündeyse yönetici onaylar (SAT-03)" },
      { ad: "miktarToleransYuzde", etiket: "Miktar toleransı (%)", tip: "sayi", min: 0, max: 100, ipucu: "Fatura miktarı mal kabulden bu oranın üstünde ayrılırsa Düzeltme Merkezi'ne fark düşer (SAT-11)" },
      { ad: "fiyatToleransYuzde", etiket: "Fiyat toleransı (%)", tip: "sayi", min: 0, max: 100, ipucu: "Fatura birim fiyatı siparişten bu oranın üstünde ayrılırsa Düzeltme Merkezi'ne fark düşer (SAT-11)" },
    ],
  },
  kasaBanka: {
    baslik: "Kasa & Banka",
    ikon: "🏦",
    alanlar: [
      { ad: "varsayilanKasaId", etiket: "Varsayılan kasa", tip: "kasaRef" },
      { ad: "varsayilanBankaHesapId", etiket: "Varsayılan banka hesabı", tip: "bankaRef" },
      { ad: "cekSenetHatirlatmaGun", etiket: "Çek/senet vadesinden kaç gün önce hatırlatılsın?", tip: "sayi", min: 0, max: 90, ipucu: "0: vade öncesi hatırlatma kapalı. 1–90: belirtilen gün önce hatırlatılır. Şirket genelinde geçerlidir." },
      { ad: "cekSenetVadeGunuHatirlat", etiket: "Çek/senet vade günü hatırlat", tip: "onay", ipucu: "Vade öncesi hatırlatmadan bağımsızdır. Tahsil edilen/ödenen evraklar hatırlatılmaz." },
    ],
  },
};

// Ekranda görünme sırası
const SIRA = ["fatura", "stok", "maliyet_kontrolu", "cari", "crm_belge_baglari", "eposta_teklif_taslagi", "teklif_takibi", "tahsilat_operasyonu", "tahsilat_otomasyonu", "satin_alma", "kasaBanka", "arayuz"];

interface Ref {
  id: string;
  ad: string;
  bankaAdi?: string;
}

export default function ModulAyarlariSayfasi() {
  const [moduller, setModuller] = useState<string[]>([]);
  const [degerler, setDegerler] = useState<Record<string, Record<string, unknown>>>({});
  const [kasalar, setKasalar] = useState<Ref[]>([]);
  const [bankalar, setBankalar] = useState<Ref[]>([]);
  const [sorumlular, setSorumlular] = useState<{ id: string; adSoyad: string; rol: string }[] | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [kaydedilen, setKaydedilen] = useState<string>("");
  // Değerler gelmeden kart gösterilmez: boş/varsayılan görünüp yanlışlıkla kaydedilmesin.
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yuklenemeyen, setYuklenemeyen] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState<string>("");

  const yukle = useCallback(async () => {
    setHata("");
    setYukleniyor(true);
    try {
      const { moduller: liste } = await api<{ moduller: string[] }>("/ayarlar");
      // Modüller tek tek: biri okunamazsa diğerleri yine gösterilir, okunamayanın kaydı kapalıdır.
      const sonuclar = await Promise.allSettled(liste.map((m) => api<Record<string, unknown>>(`/ayarlar/${m}`)));
      const okunan: Record<string, Record<string, unknown>> = {};
      const hatali: Record<string, string> = {};
      sonuclar.forEach((r, i) => {
        if (r.status === "fulfilled") okunan[liste[i]] = r.value;
        else hatali[liste[i]] = r.reason instanceof Error ? r.reason.message : "okunamadı";
      });
      setDegerler(okunan);
      setYuklenemeyen(hatali);
      setModuller(liste);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Ayarlar yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
    api<Ref[]>("/kasa-banka/kasalar").then(setKasalar).catch(() => undefined);
    api<Ref[]>("/kasa-banka/bankalar").then(setBankalar).catch(() => undefined);
    api<{ id: string; adSoyad: string; aktif: boolean; rol: string }[]>("/kullanicilar")
      .then((liste) => setSorumlular(liste.filter((u) => u.aktif)))
      .catch(() => setSorumlular([]));
  }, [yukle]);

  function alanGuncelle(modul: string, ad: string, deger: unknown) {
    setDegerler((eski) => ({ ...eski, [modul]: { ...eski[modul], [ad]: deger } }));
  }

  async function kaydet(modul: string) {
    if (kaydediliyor || !degerler[modul]) return;
    setHata("");
    setBasari("");
    setKaydediliyor(modul);
    const tanim = MODUL_TANIM[modul];
    const ham = degerler[modul] ?? {};
    // Şemaya uygun tiplere dönüştür
    const govde: Record<string, unknown> = {};
    for (const a of tanim.alanlar) {
      const v = ham[a.ad];
      if (a.tip === "sayi") govde[a.ad] = v === "" || v === undefined ? undefined : Number(v);
      else if (a.tip === "onay") govde[a.ad] = Boolean(v);
      else if (a.tip === "kasaRef" || a.tip === "bankaRef" || a.tip === "kullaniciRef") govde[a.ad] = v ? v : null;
      else govde[a.ad] = v;
    }
    try {
      const guncel = await api<Record<string, unknown>>(`/ayarlar/${modul}`, {
        method: "PUT",
        body: JSON.stringify(govde),
      });
      setDegerler((eski) => ({ ...eski, [modul]: guncel }));
      setBasari(`${tanim.baslik} ayarları kaydedildi.`);
      setKaydedilen(modul);
      setTimeout(() => setKaydedilen(""), 2000);
    } catch (h) {
      setHata(h instanceof Error ? h.message : `${tanim.baslik} ayarları kaydedilemedi`);
    } finally {
      setKaydediliyor("");
    }
  }

  function alanGir(modul: string, a: Alan) {
    const v = degerler[modul]?.[a.ad];
    if (a.tip === "sablon") {
      return (
        <Alert tone="success">
          Teklif, sipariş, proforma, irsaliye, makbuz ve faturanın rengi, yazısı, bölümleri ve hazır metinleri artık{" "}
          <Link href="/panel/ayarlar/belge-gorunumu">Ayarlar › Belge Görünümü</Link> ekranından canlı önizlemeyle düzenlenir.
        </Alert>
      );
    }
    if (a.tip === "enum") {
      return (
        <Select aria-label={a.etiket} value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)}>
          {a.secenekler!.map(([deger, etiket]) => (<option key={deger} value={deger}>{etiket}</option>))}
        </Select>
      );
    }
    if (a.tip === "sayi") {
      return <Input type="number" min={a.min} max={a.max} value={v === null || v === undefined ? "" : String(v)} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)} />;
    }
    if (a.tip === "onay") {
      return (
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", height: 38 }}>
          <input type="checkbox" aria-label={a.etiket} checked={Boolean(v)} onChange={(e) => alanGuncelle(modul, a.ad, e.target.checked)} style={{ width: "1.1rem", height: "1.1rem" }} />
          <span className="muted" style={{ fontSize: "0.9rem" }}>{Boolean(v) ? "Açık" : "Kapalı"}</span>
        </label>
      );
    }
    if (a.tip === "kullaniciRef") {
      if (sorumlular === null) return <Select aria-label={a.etiket} disabled value=""><option value="">Kullanıcılar yükleniyor…</option></Select>;
      const uygun = sorumlular.filter((u) => (a.roller ?? ["yonetici", "muhasebe"]).includes(u.rol));
      return <Select aria-label={a.etiket} value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)}>
        <option value="">— Sorumlu seçin —</option>
        {v && !uygun.some((u) => u.id === v) ? <option value={String(v)} disabled>Önceki sorumlu uygun değil; yeniden seçin</option> : null}
        {uygun.map((u) => <option key={u.id} value={u.id}>{u.adSoyad}</option>)}
      </Select>;
    }
    if (a.tip === "kasaRef" || a.tip === "bankaRef") {
      const kaynak = a.tip === "kasaRef" ? kasalar : bankalar;
      return (
        <Select value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)}>
          <option value="">— Seçilmemiş —</option>
          {kaynak.map((r) => (<option key={r.id} value={r.id}>{r.bankaAdi ? `${r.ad} — ${r.bankaAdi}` : r.ad}</option>))}
        </Select>
      );
    }
    if (a.tip === "uzunMetin") {
      return <textarea className="textarea" rows={9} value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)} />;
    }
    return <Input value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)} placeholder={a.ipucu} />;
  }

  const gorunenModuller = SIRA.filter((m) => moduller.includes(m) && MODUL_TANIM[m]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        title="Modül Ayarları"
        subtitle="Her modülün varsayılanları burada yönetilir (AYR-01). Firma, kullanıcı ve entegratör gibi sistem ayarları kendi ekranlarındadır."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {yukleniyor && <Card><p className="muted" role="status">Ayarlar yükleniyor…</p></Card>}

      <div className="stack">
        {!yukleniyor && gorunenModuller.map((m) => {
          const tanim = MODUL_TANIM[m];
          const okunamadi = yuklenemeyen[m];
          return (
            <Card key={m}>
              <div className="between" style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.05rem", margin: 0 }}>{tanim.ikon} {tanim.baslik}</h3>
                <Button variant="primary" size="sm" disabled={Boolean(okunamadi) || Boolean(kaydediliyor)} onClick={() => kaydet(m)}>
                  {kaydediliyor === m ? "Kaydediliyor…" : kaydedilen === m ? "✓ Kaydedildi" : "Kaydet"}
                </Button>
              </div>
              {okunamadi ? <Alert tone="error">Bu modülün ayarları okunamadı ({okunamadi}); kaydetme kapalı. Sayfayı yenileyin.</Alert> : (
              <div className="row">
                {tanim.alanlar.filter((a) => a.tip !== "gizli").map((a) => (
                  <div key={a.ad} style={a.tip === "sablon" || a.tip === "uzunMetin" ? { flexBasis: "100%" } : { flex: 1, minWidth: 200 }}>
                    {a.tip === "sablon" ? alanGir(m, a) : <Field label={a.etiket}>{alanGir(m, a)}</Field>}
                    {a.ipucu && a.tip !== "metin" && <p className="subtle" style={{ fontSize: "0.75rem", margin: "0.25rem 0 0" }}>{a.ipucu}</p>}
                  </div>
                ))}
              </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
