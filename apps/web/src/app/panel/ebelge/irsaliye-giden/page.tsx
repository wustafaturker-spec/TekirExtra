"use client";

/**
 * Giden e-İrsaliyeler (EBLG-41…43).
 *
 * Gönderilmiş belgelerin defteri ve gönderilmeyi bekleyenlerin çalışma listesi
 * aynı ekranda durur: bekleyen satır, gönderime engel eksiklerini önceden
 * gösterir (EBLG-42). Görsel dil gelen e-İrsaliye ekranıyla ortaktır, bu yüzden
 * onun `incoming-*` sınıflarını paylaşır.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { EbelgeAdimSeridi } from "@/components/durum-gecmisi";
import { TasimaBilgisiPaneli } from "@/components/tasima-bilgisi-paneli";
import { Alert, Badge, Button, Card, Field, Input, Select, TableWrap } from "@/components/ui";

type Durum = "gonderilmedi" | "kuyrukta" | "iletildi" | "kabul" | "kismi_kabul" | "ret" | "hata";

interface Engel { kod: string; mesaj: string }

interface Satir {
  belgeId: string;
  belgeNo: string | null;
  tarih: string;
  fiiliSevkZamani: string | null;
  belgeDurumu: string;
  genelToplam: string;
  cari: { unvan: string; vknTckn: string | null };
  durum: Durum;
  entegratorRef: string | null;
  hataMesaji: string | null;
  sonDurumSorguAt: string | null;
  gonderimZamani: string | null;
  engeller: Engel[];
  gonderilebilir: boolean;
  mukellefDogrulandi: boolean;
}

interface Detay {
  belgeNo: string | null;
  tarih: string;
  cariUnvan: string;
  durum: Durum;
  entegratorRef: string | null;
  hataMesaji: string | null;
  xmlIcerik: string | null;
  sonDurumSorguAt: string | null;
  gonderimZamani: string;
}

const DURUM_ADI: Record<Durum, string> = {
  gonderilmedi: "Gönderilmedi",
  kuyrukta: "Kuyrukta",
  iletildi: "İletildi, yanıt bekliyor",
  kabul: "Kabul edildi",
  kismi_kabul: "Kısmen kabul",
  ret: "Reddedildi",
  hata: "Hata",
};

const DURUM_TONU: Record<Durum, "neutral" | "info" | "success" | "warning" | "danger"> = {
  gonderilmedi: "neutral",
  kuyrukta: "info",
  iletildi: "info",
  kabul: "success",
  kismi_kabul: "warning",
  ret: "danger",
  hata: "danger",
};

/**
 * Taşıma bilgisi kapısı (EBLG-49). Sunucu bu alanları gönderilmiş e-İrsaliyede
 * kapatır, hata alanda yeniden açar (EBLG-23); ekran aynı sınırı gösterir.
 */
const tasiyanEngeli = (e: Engel) => e.kod === "tasiyan_yok" || e.kod === "tasiyici_vkn_yok";
const tasimaGirilebilir = (s: Satir) => s.belgeDurumu !== "iptal" && (s.durum === "gonderilmedi" || s.durum === "hata");

const gun = (v: string) => new Date(v).toLocaleDateString("tr-TR");
const an = (v: string | null) => (v ? new Date(v).toLocaleString("tr-TR") : null);
const SAYFA_ADEDI = 15;

export default function GidenEirsaliyeler() {
  const [liste, setListe] = useState<Satir[]>([]);
  const [gonderebilir, setGonderebilir] = useState(false);
  const [durum, setDurum] = useState("");
  const [arama, setArama] = useState("");
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [detay, setDetay] = useState<Detay | null>(null);
  const [tasimaBelgesi, setTasimaBelgesi] = useState<{ id: string; no: string | null } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islemde, setIslemde] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [basarisizlar, setBasarisizlar] = useState<{ belgeNo: string | null; hata: string }[]>([]);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const yanit = await api<{ kayitlar: Satir[]; yetkiler: { gonderebilir: boolean } }>(`/ebelge/irsaliye/giden${durum ? `?durum=${durum}` : ""}`);
      setListe(yanit.kayitlar);
      setGonderebilir(yanit.yetkiler.gonderebilir);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Giden e-İrsaliyeler yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [durum]);

  useEffect(() => { void yukle(); }, [yukle]);
  useEffect(() => { setSayfa(1); setSecili(new Set()); }, [arama, durum, baslangic, bitis]);

  const filtreli = useMemo(() => liste.filter((s) => {
    const q = arama.toLocaleLowerCase("tr-TR");
    const metin = `${s.belgeNo ?? ""} ${s.cari.unvan} ${s.cari.vknTckn ?? ""} ${s.entegratorRef ?? ""}`.toLocaleLowerCase("tr-TR");
    return (!q || metin.includes(q)) && (!baslangic || s.tarih >= baslangic) && (!bitis || s.tarih <= bitis);
  }), [liste, arama, baslangic, bitis]);

  const ozet = useMemo(() => ({
    toplam: liste.length,
    bekleyen: liste.filter((s) => s.durum === "gonderilmedi").length,
    yolda: liste.filter((s) => s.durum === "kuyrukta" || s.durum === "iletildi").length,
    sorunlu: liste.filter((s) => s.durum === "hata" || s.durum === "ret").length,
  }), [liste]);

  const sayfaAdedi = Math.max(1, Math.ceil(filtreli.length / SAYFA_ADEDI));
  const gorunen = filtreli.slice((sayfa - 1) * SAYFA_ADEDI, sayfa * SAYFA_ADEDI);
  const secilebilirler = gonderebilir ? filtreli.filter((s) => s.gonderilebilir) : [];
  const mukellefListesiBayat = liste.length > 0 && !liste[0].mukellefDogrulandi;

  function secimDegistir(belgeId: string) {
    setSecili((onceki) => {
      const yeni = new Set(onceki);
      if (yeni.has(belgeId)) yeni.delete(belgeId); else yeni.add(belgeId);
      return yeni;
    });
  }

  function tumunuSec() {
    setSecili((onceki) => (onceki.size === secilebilirler.length ? new Set() : new Set(secilebilirler.map((s) => s.belgeId))));
  }

  function sonucuYaz(gonderilen: number, basarisiz: { belgeNo: string | null; hata: string }[]) {
    setBasarisizlar(basarisiz);
    if (basarisiz.length === 0) setBasari(`${gonderilen} e-İrsaliye entegratöre gönderildi.`);
    else if (gonderilen > 0) setBasari(`${gonderilen} e-İrsaliye gönderildi, ${basarisiz.length} belge gönderilemedi.`);
    else setHata("Seçilen belgelerin hiçbiri gönderilemedi.");
  }

  async function gonder(belgeIdler: string[]) {
    setIslemde(belgeIdler.length === 1 ? belgeIdler[0] : "toplu");
    setHata(""); setBasari(""); setBasarisizlar([]);
    try {
      const sonuc = await api<{ gonderilen: number; basarisiz: { belgeNo: string | null; hata: string }[] }>(
        "/ebelge/irsaliye/giden/toplu-gonder",
        { method: "POST", body: JSON.stringify({ belgeIdler }) },
      );
      sonucuYaz(sonuc.gonderilen, sonuc.basarisiz);
      setSecili(new Set());
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "e-İrsaliye gönderilemedi");
    } finally {
      setIslemde("");
    }
  }

  async function durumlariSorgula() {
    setIslemde("sorgu"); setHata(""); setBasari(""); setBasarisizlar([]);
    try {
      const sonuc = await api<{ sorgulanan: number; guncellenen: number; atlanan: number }>(
        "/ebelge/irsaliye/giden/durumlari-sorgula",
        { method: "POST" },
      );
      setBasari(
        sonuc.sorgulanan === 0
          ? "Durumu sorgulanacak e-İrsaliye bulunmuyor."
          : `${sonuc.sorgulanan} belge sorgulandı, ${sonuc.guncellenen} belgenin durumu değişti.${sonuc.atlanan ? ` ${sonuc.atlanan} belge sorgu aralığı dolmadığı için atlandı.` : ""}`,
      );
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Durumlar sorgulanamadı");
    } finally {
      setIslemde("");
    }
  }

  async function detayAc(belgeId: string) {
    setHata("");
    try {
      setDetay(await api<Detay>(`/ebelge/irsaliye/giden/${belgeId}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge ayrıntısı açılamadı");
    }
  }

  function xmlIndir() {
    if (!detay?.xmlIcerik) return;
    const url = URL.createObjectURL(new Blob([detay.xmlIcerik], { type: "application/xml;charset=utf-8" }));
    const bag = document.createElement("a");
    bag.href = url;
    bag.download = `${detay.belgeNo ?? "eirsaliye"}.xml`;
    bag.click();
    URL.revokeObjectURL(url);
  }

  return <div className="incoming-page">
    <header className="incoming-hero">
      <div>
        <span>E-BELGE OPERASYON MERKEZİ</span>
        <h1>Giden e-İrsaliyeler</h1>
        <p>Sevk belgelerinin entegratör durumunu izleyin, gönderilmeyi bekleyenleri eksikleriyle görüp buradan gönderin.</p>
      </div>
      <div>
        <small>{ozet.bekleyen ? `${ozet.bekleyen} irsaliye gönderilmeyi bekliyor` : "Bekleyen sevkiyat yok"}</small>
        {gonderebilir && (
          <Button variant="primary" disabled={islemde === "sorgu"} onClick={() => void durumlariSorgula()}>
            {islemde === "sorgu" ? "Sorgulanıyor…" : "↻ Durumları sorgula"}
          </Button>
        )}
      </div>
    </header>

    {hata && <Alert tone="error">{hata}</Alert>}
    {basari && <Alert tone="success">{basari}</Alert>}
    {basarisizlar.length > 0 && (
      <Alert tone="warning">
        <strong>Gönderilemeyen belgeler</strong>
        <ul>{basarisizlar.map((b, i) => <li key={i}>{b.belgeNo ?? "Numarasız belge"}: {b.hata}</li>)}</ul>
      </Alert>
    )}
    {mukellefListesiBayat && (
      <Alert tone="warning">
        GİB mükellef listesi güncel değil; alıcıların e-İrsaliye mükellefiyeti doğrulanamadı. Ayarlar &gt; Entegratörler ekranından listeyi güncelleyin.
      </Alert>
    )}

    <section className="incoming-kpis">
      <div className="is-lead"><span>Toplam belge</span><strong>{ozet.toplam}</strong><small>Satış irsaliyeleri</small></div>
      <div className={ozet.bekleyen ? "is-warning" : ""}><span>Gönderilmeyi bekleyen</span><strong>{ozet.bekleyen}</strong><small>{ozet.bekleyen ? "Gönderim gerekiyor" : "Bekleyen yok"}</small></div>
      <div><span>Yolda</span><strong>{ozet.yolda}</strong><small>Alıcı yanıtı bekleniyor</small></div>
      <div className={ozet.sorunlu ? "is-warning" : ""}><span>Hata / ret</span><strong>{ozet.sorunlu}</strong><small>{ozet.sorunlu ? "İnceleme gerekiyor" : "Sorunlu belge yok"}</small></div>
    </section>

    <Card className="incoming-filter">
      <div className="incoming-filter__grid">
        <Field label="Belge veya cari ara"><Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Belge no, cari, VKN veya entegratör referansı…" /></Field>
        <Field label="Durum">
          <Select value={durum} onChange={(e) => setDurum(e.target.value)}>
            <option value="">Tüm durumlar</option>
            {(Object.keys(DURUM_ADI) as Durum[]).map((d) => <option key={d} value={d}>{DURUM_ADI[d]}</option>)}
          </Select>
        </Field>
        <Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>
        <Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
        <Button onClick={() => { setArama(""); setDurum(""); setBaslangic(""); setBitis(""); }}>Filtreleri temizle</Button>
      </div>
    </Card>

    <Card
      className="incoming-register"
      pad={false}
      title={<div className="incoming-register__title">
        <span>GİDEN KUTUSU</span>
        <h2>Sevk belgeleri</h2>
        <small>{filtreli.length} kayıt gösteriliyor{secili.size > 0 ? ` · ${secili.size} seçili` : ""}</small>
      </div>}
    >
      {secilebilirler.length > 0 && (
        <div className="incoming-filter__grid" style={{ padding: "12px" }}>
          <Button size="sm" onClick={tumunuSec}>{secili.size === secilebilirler.length ? "Seçimi kaldır" : `Gönderilebilir ${secilebilirler.length} belgeyi seç`}</Button>
          <Button size="sm" variant="primary" disabled={secili.size === 0 || islemde !== ""} onClick={() => void gonder([...secili])}>
            {islemde === "toplu" ? "Gönderiliyor…" : `Seçilenleri gönder (${secili.size})`}
          </Button>
        </div>
      )}
      <TableWrap>
        <thead>
          <tr>
            <th><span className="sr-only">Seç</span></th>
            <th>Belge</th><th>Alıcı</th><th>Sevk tarihi</th><th>Durum</th><th>İşlem</th>
          </tr>
        </thead>
        <tbody>
          {yukleniyor && <tr><td colSpan={6}><div className="incoming-empty">Belgeler yükleniyor…</div></td></tr>}
          {!yukleniyor && gorunen.map((s) => (
            <tr key={s.belgeId} className={s.durum === "hata" ? "is-failed" : ""}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${s.belgeNo ?? "Numarasız belge"} seç`}
                  disabled={!s.gonderilebilir || !gonderebilir}
                  checked={secili.has(s.belgeId)}
                  onChange={() => secimDegistir(s.belgeId)}
                />
              </td>
              <td>
                <strong>{s.belgeNo ?? "Numara gönderimde"}</strong>
                <small>{Number(s.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</small>
                {s.entegratorRef && <small title={s.entegratorRef}>Ref: {s.entegratorRef.slice(0, 12)}…</small>}
              </td>
              <td><strong>{s.cari.unvan}</strong><small>{s.cari.vknTckn ? `VKN/TCKN ${s.cari.vknTckn}` : "VKN/TCKN yok"}</small></td>
              <td><strong>{gun(s.tarih)}</strong><small>{an(s.fiiliSevkZamani) ?? "Fiili sevk girilmemiş"}</small></td>
              <td>
                <Badge variant={DURUM_TONU[s.durum]}>{DURUM_ADI[s.durum]}</Badge>
                {s.hataMesaji && <small className="incoming-reason">{s.hataMesaji}</small>}
                {s.engeller.map((e) => <small className="incoming-reason" key={e.kod}>{e.mesaj}</small>)}
              </td>
              <td>
                <div className="incoming-actions">
                  {s.gonderilebilir && gonderebilir && (
                    <Button size="sm" variant="primary" disabled={islemde !== ""} onClick={() => void gonder([s.belgeId])}>
                      {islemde === s.belgeId ? "Gönderiliyor…" : s.durum === "hata" ? "Yeniden gönder" : "Gönder"}
                    </Button>
                  )}
                  {tasimaGirilebilir(s) && gonderebilir && (
                    <Button size="sm" variant={s.engeller.some(tasiyanEngeli) ? "primary" : undefined} onClick={() => setTasimaBelgesi({ id: s.belgeId, no: s.belgeNo })}>
                      🚚 Taşıma bilgisi
                    </Button>
                  )}
                  {s.durum !== "gonderilmedi" && <Button size="sm" onClick={() => void detayAc(s.belgeId)}>İncele</Button>}
                  <a className="btn btn--ghost btn--sm" href={`/panel/belgeler?odak=${s.belgeId}`}>Belgeyi aç</a>
                </div>
              </td>
            </tr>
          ))}
          {!yukleniyor && gorunen.length === 0 && (
            <tr><td colSpan={6}><div className="incoming-empty"><strong>Belge bulunamadı</strong><span>Süzgeçleri değiştirin ya da yeni bir satış irsaliyesi onaylayın.</span></div></td></tr>
          )}
        </tbody>
      </TableWrap>
      {filtreli.length > SAYFA_ADEDI && (
        <footer className="incoming-pagination">
          <span>Sayfa {sayfa} / {sayfaAdedi}</span>
          <div>
            <Button size="sm" disabled={sayfa === 1} onClick={() => setSayfa((x) => x - 1)}>Önceki</Button>
            <Button size="sm" disabled={sayfa === sayfaAdedi} onClick={() => setSayfa((x) => x + 1)}>Sonraki</Button>
          </div>
        </footer>
      )}
    </Card>

    {detay && (
      <div className="incoming-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetay(null); }}>
        <aside className="incoming-drawer" role="dialog" aria-modal="true" aria-label="Giden e-İrsaliye detayı">
          <header>
            <div>
              <span>GİDEN E-İRSALİYE</span>
              <h2>{detay.belgeNo ?? "Numarasız belge"}</h2>
              <Badge variant={DURUM_TONU[detay.durum]}>{DURUM_ADI[detay.durum]}</Badge>
            </div>
            <button aria-label="Kapat" onClick={() => setDetay(null)}>×</button>
          </header>
          <EbelgeAdimSeridi akis={{ tur: "eirsaliye", durum: detay.durum }} />
          <section className="incoming-drawer__summary">
            <div><span>Alıcı</span><strong>{detay.cariUnvan}</strong><small>{gun(detay.tarih)}</small></div>
            <div><span>Gönderim</span><strong>{an(detay.gonderimZamani)}</strong><small>{an(detay.sonDurumSorguAt) ? `Son sorgu ${an(detay.sonDurumSorguAt)}` : "Henüz sorgulanmadı"}</small></div>
            <div><span>Entegratör referansı</span><strong>{detay.entegratorRef ?? "—"}</strong><small>{detay.entegratorRef ? "Entegratördeki karşılık" : "Referans oluşmadı"}</small></div>
          </section>
          {detay.hataMesaji && <div className="incoming-info"><span>Hata / yanıt açıklaması</span><strong>{detay.hataMesaji}</strong></div>}
          <footer>
            <small>Belge UBL'i entegratöre gönderilen içeriktir.</small>
            <div><Button disabled={!detay.xmlIcerik} onClick={xmlIndir}>XML indir</Button></div>
          </footer>
        </aside>
      </div>
    )}

    {tasimaBelgesi && (
      <TasimaBilgisiPaneli
        belgeId={tasimaBelgesi.id}
        belgeNo={tasimaBelgesi.no}
        onKapat={() => setTasimaBelgesi(null)}
        onKaydedildi={(mesaj) => { setTasimaBelgesi(null); setHata(""); setBasari(mesaj); void yukle(); }}
      />
    )}
  </div>;
}
