"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { useDepolar } from "@/lib/depolar";
import { DepoSecici } from "@/components/depo-secici";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  EylemCubugu,
  EylemMenusu,
  Field,
  Input,
  PageHeader,
  Select,
  TabPanel,
  Tabs,
  TableWrap,
} from "@/components/ui";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface Kategori {
  id: string;
  ad: string;
  ust: { id: string; ad: string } | null;
}

function ReceteSekmesi({ stokId, anaBirim, recete, stoklar, isMerkezleri, onKaydedildi, onSilindi, onHata }: { stokId: string; anaBirim: string; recete: Recete | null; stoklar: StokOzet[]; isMerkezleri: IsMerkezi[]; onKaydedildi: () => Promise<void>; onSilindi: () => Promise<void>; onHata: (mesaj: string) => void }) {
  const [ciktiMiktari, setCiktiMiktari] = useState("1");
  const [aciklama, setAciklama] = useState("");
  const [degisiklikNedeni, setDegisiklikNedeni] = useState("");
  const [yururlukBaslangic, setYururlukBaslangic] = useState("");
  const [kaliteKontrolGerekli, setKaliteKontrolGerekli] = useState(false);
  const [kalemler, setKalemler] = useState<{ malzemeStokId: string; miktar: string; fireOrani: string }[]>([{ malzemeStokId: "", miktar: "1", fireOrani: "0" }]);
  const [operasyonlar, setOperasyonlar] = useState<{ isMerkeziId: string; operasyonKodu: string; operasyonAdi: string; hazirlikDakika: string; cevrimDakika: string }[]>([]);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  useEffect(() => {
    setCiktiMiktari(recete?.ciktiMiktari ?? "1"); setAciklama(recete?.aciklama ?? "");
    setKalemler(recete?.kalemler?.length ? recete.kalemler.map((k) => ({ malzemeStokId: k.malzemeStokId, miktar: k.miktar, fireOrani: k.fireOrani })) : [{ malzemeStokId: "", miktar: "1", fireOrani: "0" }]);
    setOperasyonlar(recete?.operasyonlar?.map((o) => ({ isMerkeziId: o.isMerkeziId, operasyonKodu: o.operasyonKodu, operasyonAdi: o.operasyonAdi, hazirlikDakika: o.hazirlikDakika, cevrimDakika: o.cevrimDakika })) ?? []);
    setKaliteKontrolGerekli(recete?.kaliteKontrolGerekli ?? false);
  }, [recete]);
  async function kaydet(event: React.FormEvent) {
    event.preventDefault(); onHata(""); setKaydediliyor(true);
    try {
      await api(`/uretim/receteler/${stokId}`, { method: "POST", body: JSON.stringify({ ciktiMiktari, aciklama: aciklama || null, degisiklikNedeni: degisiklikNedeni || null, yururlukBaslangic: yururlukBaslangic || null, kaliteKontrolGerekli, kalemler: kalemler.map((k) => ({ ...k, malzemeVaryantId: null })), operasyonlar }) });
      setDegisiklikNedeni("");
      await onKaydedildi();
    } catch (h) { onHata(h instanceof Error ? h.message : "Reçete kaydedilemedi"); }
    finally { setKaydediliyor(false); }
  }
  async function sil() {
    if (!window.confirm("Bu ürün reçetesi kaldırılacak. Devam edilsin mi?")) return;
    try { await api(`/uretim/receteler/${stokId}`, { method: "DELETE" }); await onSilindi(); }
    catch (h) { onHata(h instanceof Error ? h.message : "Reçete kaldırılamadı"); }
  }
  async function onayla() {
    if (!recete || !window.confirm(`Reçete v${recete.surum} üretimde kullanılmak üzere etkinleştirilsin mi?`)) return;
    setKaydediliyor(true); onHata("");
    try { await api(`/uretim/receteler/${stokId}/surumler/${recete.id}/onayla`, { method: "POST" }); await onKaydedildi(); }
    catch (h) { onHata(h instanceof Error ? h.message : "Reçete onaylanamadı"); }
    finally { setKaydediliyor(false); }
  }
  const satirHesapla = (kalem: typeof kalemler[number]) => {
    const malzeme = stoklar.find((s) => s.id === kalem.malzemeStokId);
    const net = Number(kalem.miktar) || 0;
    const brut = net * (1 + (Number(kalem.fireOrani) || 0) / 100);
    const birimMaliyet = Number(malzeme?.ortalamaMaliyet ?? 0);
    return { malzeme, brut, birimMaliyet, toplam: brut * birimMaliyet };
  };
  const toplamMaliyet = kalemler.reduce((toplam, kalem) => toplam + satirHesapla(kalem).toplam, 0);
  const birimMamulMaliyeti = toplamMaliyet / Math.max(Number(ciktiMiktari) || 1, 0.001);
  return <div className="recipe-workspace">
    <section className="recipe-hero">
      <div><span className="recipe-eyebrow">ÜRETİM TANIMI</span><h2>Ürün reçetesi</h2><p>Bir üretim çevriminde tüketilecek malzemeleri, fire paylarını ve tahmini maliyeti yönetin.</p></div>
      <div className="recipe-health"><span className={recete?.durum === "aktif" ? "is-ready" : ""} />{recete ? `v${recete.surum} · ${recete.durum === "aktif" ? "Aktif" : recete.durum === "taslak" ? "Taslak" : "Onay bekliyor"}` : "Henüz kaydedilmedi"}</div>
    </section>
    <form className="recipe-form" onSubmit={kaydet}>
      <section className="recipe-setup">
        <div><h3>Reçete bilgileri</h3><p>Hesaplamaların baz aldığı standart üretim çıktısı.</p></div>
        <div className="recipe-setup__fields"><Field label={`Çıktı miktarı (${anaBirim})`}><Input required type="number" min="0.001" step="0.001" value={ciktiMiktari} onChange={(e) => setCiktiMiktari(e.target.value)} /></Field><Field label="Üretim notu"><Input maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. standart üretim partisi" /></Field><Field label="Değişiklik nedeni"><Input maxLength={500} value={degisiklikNedeni} onChange={(e) => setDegisiklikNedeni(e.target.value)} placeholder="Yeni sürümün amacı" /></Field><Field label="Yürürlük başlangıcı"><Input type="date" value={yururlukBaslangic} onChange={(e) => setYururlukBaslangic(e.target.value)} /></Field><label className="check"><input type="checkbox" checked={kaliteKontrolGerekli} onChange={(e) => setKaliteKontrolGerekli(e.target.checked)} /><span>Üretim sonrası kalite kontrolü zorunlu</span></label></div>
      </section>
      <section className="recipe-materials"><div className="recipe-section-head"><div><h3>Operasyon rotası</h3><p>Hazırlık ve birim çevrim süreleri üretim emrinin kapasite planına kopyalanır.</p></div><Button type="button" disabled={!isMerkezleri.length} onClick={() => setOperasyonlar((eski) => [...eski, { isMerkeziId: isMerkezleri[0]?.id ?? "", operasyonKodu: `OP-${String(eski.length + 1).padStart(2, "0")}`, operasyonAdi: "", hazirlikDakika: "0", cevrimDakika: "0" }])}>+ Operasyon ekle</Button></div>
        <TableWrap><thead><tr><th>Sıra</th><th>İş merkezi</th><th>Kod</th><th>Operasyon</th><th className="num">Hazırlık dk</th><th className="num">Çevrim dk/birim</th><th /></tr></thead><tbody>{operasyonlar.map((o, index) => <tr key={index}><td>{index + 1}</td><td><Select required value={o.isMerkeziId} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, isMerkeziId: e.target.value } : x))}>{isMerkezleri.map((m) => <option key={m.id} value={m.id}>{m.kod} — {m.ad}</option>)}</Select></td><td><Input required maxLength={30} value={o.operasyonKodu} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, operasyonKodu: e.target.value } : x))} /></td><td><Input required maxLength={120} value={o.operasyonAdi} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, operasyonAdi: e.target.value } : x))} /></td><td><Input required type="number" min="0" step="0.01" value={o.hazirlikDakika} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, hazirlikDakika: e.target.value } : x))} /></td><td><Input required type="number" min="0" step="0.0001" value={o.cevrimDakika} onChange={(e) => setOperasyonlar((eski) => eski.map((x, i) => i === index ? { ...x, cevrimDakika: e.target.value } : x))} /></td><td><Button type="button" size="sm" variant="danger" onClick={() => setOperasyonlar((eski) => eski.filter((_, i) => i !== index))}>Sil</Button></td></tr>)}{!operasyonlar.length && <tr><td colSpan={7}>Operasyon rotası isteğe bağlıdır. Önce Üretim Planlama ekranından iş merkezi tanımlayın.</td></tr>}</tbody></TableWrap>
      </section>
      <section className="recipe-materials">
        <div className="recipe-section-head"><div><h3>Malzeme listesi</h3><p>Maliyetler stok kartlarındaki güncel ortalama maliyetten hesaplanır.</p></div><Button type="button" onClick={() => setKalemler((eski) => [...eski, { malzemeStokId: "", miktar: "1", fireOrani: "0" }])}>+ Malzeme ekle</Button></div>
        <TableWrap><thead><tr><th>Malzeme</th><th className="num">Net miktar</th><th>Birim</th><th className="num">Fire</th><th className="num">Birim maliyet</th><th className="num">Satır maliyeti</th><th /></tr></thead><tbody>{kalemler.map((kalem, index) => { const hesap = satirHesapla(kalem); return <tr key={index}><td><Select required value={kalem.malzemeStokId} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, malzemeStokId: e.target.value } : k))}><option value="">Malzeme seçin</option>{stoklar.map((s) => <option key={s.id} value={s.id}>{s.kod} — {s.ad}</option>)}</Select>{hesap.malzeme && <small className="recipe-stock">Kullanılabilir stok: {adet(hesap.malzeme.mevcutMiktar)} {hesap.malzeme.anaBirim}</small>}</td><td><Input aria-label="Reçete miktarı" required type="number" min="0.001" step="0.001" value={kalem.miktar} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, miktar: e.target.value } : k))} /></td><td><span className="recipe-unit">{hesap.malzeme?.anaBirim ?? "—"}</span></td><td><div className="recipe-percent"><Input aria-label="Fire oranı" required type="number" min="0" max="100" step="0.01" value={kalem.fireOrani} onChange={(e) => setKalemler((eski) => eski.map((k, i) => i === index ? { ...k, fireOrani: e.target.value } : k))} /><span>%</span></div></td><td className="num recipe-money">{tl(hesap.birimMaliyet)}</td><td className="num"><strong>{tl(hesap.toplam)}</strong>{Number(kalem.fireOrani) > 0 && <small className="recipe-stock">Fire dahil {adet(hesap.brut)} {hesap.malzeme?.anaBirim}</small>}</td><td><Button type="button" size="sm" variant="danger" disabled={kalemler.length === 1} onClick={() => setKalemler((eski) => eski.filter((_, i) => i !== index))}>Sil</Button></td></tr>; })}</tbody></TableWrap>
      </section>
      <section className="recipe-summary"><div><span>Malzeme çeşidi</span><strong>{kalemler.filter((k) => k.malzemeStokId).length}</strong></div><div><span>Reçete toplam maliyeti</span><strong>{tl(toplamMaliyet)}</strong></div><div className="recipe-summary__lead"><span>1 {anaBirim} tahmini maliyet</span><strong>{tl(birimMamulMaliyeti)}</strong><small>İşçilik ve genel üretim giderleri hariç</small></div></section>
      <div className="recipe-actions"><div>{recete && <Button type="button" variant="danger" onClick={() => void sil()}>Reçeteyi arşivle</Button>}</div><div className="row-tight"><span className="muted">Kaydetme yeni taslak sürüm oluşturur.</span>{recete && ["taslak", "onay_bekliyor"].includes(recete.durum) && <Button type="button" onClick={() => void onayla()} disabled={kaydediliyor}>Sürümü onayla</Button>}<Button type="submit" variant="primary" disabled={kaydediliyor}>{kaydediliyor ? "Kaydediliyor…" : "Yeni sürüm kaydet"}</Button></div></div>
    </form>
  </div>;
}

interface Birim {
  id: string;
  ad: string;
  katsayi: string;
}

interface Barkod {
  id: string;
  barkod: string;
  birim: string | null;
  satisFiyati: string | null;
}

interface Tedarikci {
  id: string;
  cariId: string;
  tedarikciUrunKodu: string | null;
  alisFiyati: string | null;
  dovizCinsi: string;
  tedarikSuresiGun: number | null;
  varsayilan: boolean;
  cari: { id: string; kod: string; unvan: string };
}
interface Varyant { id: string; kod: string; ad: string; nitelikler: Record<string, string>; barkod: string | null; alisFiyati: string | null; satisFiyati: string | null; mevcutMiktar: string; aktif: boolean }
interface StokFiyat { id: string; varyantId: string | null; tip: "alis" | "satis"; dovizCinsi: string; tutar: string; aktif: boolean }
interface Recete { id: string; surum: number; durum: "taslak" | "onay_bekliyor" | "aktif" | "pasif" | "arsiv"; ciktiMiktari: string; aciklama: string | null; kaliteKontrolGerekli: boolean; operasyonlar?: { id: string; isMerkeziId: string; operasyonKodu: string; operasyonAdi: string; hazirlikDakika: string; cevrimDakika: string }[]; kalemler?: { id: string; malzemeStokId: string; malzemeVaryantId: string | null; miktar: string; fireOrani: string; malzeme: { id: string; kod: string; ad: string; anaBirim: string; mevcutMiktar: string; ortalamaMaliyet: string } }[] }
interface IsMerkezi { id: string; kod: string; ad: string; aktif: boolean }
interface StokOzet { id: string; kod: string; ad: string; tip: string; anaBirim: string; mevcutMiktar: string; ortalamaMaliyet?: string }

interface Hareket {
  id: string;
  tip: string;
  miktar: string;
  girilenBirim: string;
  girilenMiktar: string;
  maliyet: string;
  tarih: string;
  aciklama: string | null;
  kaynakTur: string;
  kaynakRef: string | null;
  /** İptal edilmiş faturanın hareketi (STK-22); yalnız iptaller gösterilince gelir. */
  iptal?: boolean;
  depo?: { id: string; kod: string; ad: string } | null;
  varyant?: { id: string; kod: string; ad: string } | null;
}

interface StokDetay {
  id: string;
  kod: string;
  ad: string;
  kisaAd: string | null;
  aciklama: string | null;
  tip: string;
  marka: string | null;
  model: string | null;
  mensei: string | null;
  gtipKodu: string | null;
  ureticiUrunKodu: string | null;
  barkod: string | null;
  kategoriId: string | null;
  anaBirim: string;
  kdvOrani: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  alisFiyatiDoviz: string;
  satisFiyatiDoviz: string;
  kritikSeviye: string | null;
  minStok: string | null;
  maksStok: string | null;
  guvenlikStogu: string | null;
  tedarikSuresiGun: number | null;
  gorselUrl: string | null;
  mevcutMiktar: string;
  rezerveMiktar: string;
  yoldakiMiktar: string;
  kullanilabilirMiktar: string;
  ortalamaMaliyet: string;
  aktif: boolean;
  takipTipi?: "yok" | "lot" | "seri";
  kategori: Kategori | null;
  birimler: Birim[];
  barkodlar: Barkod[];
  tedarikciler: Tedarikci[];
  varyantlar?: Varyant[];
  izinliEylemler: string[];
}

interface CariOzet {
  id: string;
  kod: string;
  unvan: string;
}

type Sekme = "genel" | "recete" | "fiyatlar" | "hareketler" | "depolar" | "varyantlar" | "partiler" | "birimler" | "barkodlar" | "tedarikciler";

interface Parti { id: string; lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; uretimTarihi: string | null; ilkMiktar: string; kalanMiktar: string; depo: { ad: string }; varyant: { kod: string; ad: string } | null }

/** Stok kartının depo bazlı kırılımı (STK-07). */
interface DepoBakiyeSatiri {
  depoId: string;
  depoKod: string;
  depoAd: string;
  depoAktif: boolean;
  mevcutMiktar: string;
  rezerveMiktar: string;
  yoldakiMiktar: string;
  kullanilabilirMiktar: string;
}

/* ─── Sabitler ───────────────────────────────────────────────────────────── */

/** STK-19: giriş gibi işlenenler acilis/giris; kalanlar çıkış tarafı. */
const HAREKET_TIPLERI: { deger: string; baslik: string; yon: "giris" | "cikis" | "duzeltme" }[] = [
  { deger: "giris", baslik: "Giriş", yon: "giris" },
  { deger: "cikis", baslik: "Çıkış", yon: "cikis" },
  { deger: "acilis", baslik: "Açılış", yon: "giris" },
  { deger: "fire", baslik: "Fire", yon: "cikis" },
  { deger: "zayi", baslik: "Zayi", yon: "cikis" },
  { deger: "numune", baslik: "Numune", yon: "cikis" },
  { deger: "promosyon", baslik: "Promosyon", yon: "cikis" },
  { deger: "sayim_duzeltme", baslik: "Sayım Düzeltme", yon: "duzeltme" },
];

/**
 * Elle girilemeyen, yalnız listede görünen türler (STK-07): depolar arası
 * transferin iki ayağı — transfer fişi ekranından üretilir.
 */
const TUREYEN_HAREKET_TIPLERI: { deger: string; baslik: string; yon: "giris" | "cikis" }[] = [
  { deger: "transfer_giris", baslik: "Transfer Girişi", yon: "giris" },
  { deger: "transfer_cikis", baslik: "Transfer Çıkışı", yon: "cikis" },
];

const TUM_HAREKET_TIPLERI = [...HAREKET_TIPLERI, ...TUREYEN_HAREKET_TIPLERI];

const TIP_ETIKETLERI: Record<string, string> = {
  urun: "📦 Ürün",
  hizmet: "🛠️ Hizmet",
  sarf: "🧰 Sarf",
};

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const bugun = () => new Date().toISOString().slice(0, 10);

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function StokDetaySayfasi() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detay, setDetay] = useState<StokDetay | null>(null);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [iptalleriGoster, setIptalleriGoster] = useState(false);
  const [depoBakiyeleri, setDepoBakiyeleri] = useState<DepoBakiyeSatiri[]>([]);
  const [partiler, setPartiler] = useState<Parti[]>([]);
  const [fiyatlar, setFiyatlar] = useState<StokFiyat[]>([]);
  const [recete, setRecete] = useState<Recete | null>(null);
  const [isMerkezleri, setIsMerkezleri] = useState<IsMerkezi[]>([]);
  const [tumStoklar, setTumStoklar] = useState<StokOzet[]>([]);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [cariler, setCariler] = useState<CariOzet[]>([]);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const { cokluDepo } = useDepolar();
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [uyari, setUyari] = useState("");
  const [fiyatTipi, setFiyatTipi] = useState<"alis" | "satis">("satis");
  const [fiyatDovizi, setFiyatDovizi] = useState("TRY");
  const [fiyatTutar, setFiyatTutar] = useState("");
  const [fiyatVaryantId, setFiyatVaryantId] = useState("");

  const yukle = useCallback(async () => {
    try {
      const veri = await api<StokDetay>(`/stok/${id}`);
      setDetay(veri);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Stok kartı yüklenemedi");
    }
  }, [id]);

  const hareketleriYukle = useCallback(async () => {
    try {
      setHareketler(await api<Hareket[]>(`/stok/${id}/hareketler${iptalleriGoster ? "?iptaller=1" : ""}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Hareketler yüklenemedi");
    }
  }, [id, iptalleriGoster]);

  const depoBakiyeleriYukle = useCallback(async () => {
    try {
      setDepoBakiyeleri(await api<DepoBakiyeSatiri[]>(`/stok/${id}/depo-bakiyeleri`));
    } catch {
      setDepoBakiyeleri([]);
    }
  }, [id]);
  const partileriYukle = useCallback(async () => { try { const veri = await api<Parti[]>(`/stok/${id}/partiler`); setPartiler(Array.isArray(veri) ? veri : []); } catch { setPartiler([]); } }, [id]);
  const fiyatlariYukle = useCallback(async () => { try { setFiyatlar(await api<StokFiyat[]>(`/stok/${id}/fiyatlar`)); } catch { setFiyatlar([]); } }, [id]);
  const receteyiYukle = useCallback(async () => {
    try {
      const veri = await api<Recete | null>(`/uretim/receteler/${id}`);
      setRecete(veri?.id ? { ...veri, kalemler: Array.isArray(veri.kalemler) ? veri.kalemler : [] } : null);
    } catch { setRecete(null); }
  }, [id]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
    void hareketleriYukle();
    void depoBakiyeleriYukle();
    void partileriYukle();
    void fiyatlariYukle();
    void receteyiYukle();
    void api<IsMerkezi[]>("/uretim/is-merkezleri").then((v) => setIsMerkezleri(v.filter((m) => m.aktif))).catch(() => setIsMerkezleri([]));
    void tumSayfalariAl<StokOzet>("/stok").then(setTumStoklar).catch(() => {});
    void api<Kategori[]>("/stok/kategoriler").then(setKategoriler).catch(() => {});
    void tumSayfalariAl<CariOzet>("/cari").then(setCariler).catch(() => {});
  }, [yukle, hareketleriYukle, depoBakiyeleriYukle, partileriYukle, fiyatlariYukle, receteyiYukle]);

  /** Alt kayıt ekleme/silme sonrası ortak akış. */
  async function islem(calistir: () => Promise<unknown>, basariMesaji: string) {
    setHata("");
    setBasari("");
    setUyari("");
    try {
      await calistir();
      setBasari(basariMesaji);
      await yukle();
      return true;
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
      return false;
    }
  }

  async function fiyatEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!fiyatTutar) return;
    const ok = await islem(() => api(`/stok/${id}/fiyatlar`, { method: "POST", body: JSON.stringify({ tip: fiyatTipi, dovizCinsi: fiyatDovizi, tutar: fiyatTutar, varyantId: fiyatVaryantId || null }) }), "Dövizli fiyat kaydedildi.");
    if (ok) { setFiyatTutar(""); setFiyatlar(await api<StokFiyat[]>(`/stok/${id}/fiyatlar`)); }
  }

  async function fiyatSil(fiyatId: string) {
    const ok = await islem(() => api(`/stok/${id}/fiyatlar/${fiyatId}`, { method: "DELETE" }), "Dövizli fiyat silindi.");
    if (ok) setFiyatlar(await api<StokFiyat[]>(`/stok/${id}/fiyatlar`));
  }

  async function kopyala() {
    setHata(""); setBasari(""); setUyari("");
    try {
      const kopya = await api<StokDetay>(`/stok/${id}/kopyala`, { method: "POST" });
      router.push(`/panel/stok/${kopya.id}`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  async function sil() {
    if (!detay || !window.confirm(`“${detay.ad}” stok kartı silinsin mi?`)) return;
    const ok = await islem(() => api(`/stok/${id}`, { method: "DELETE" }), "Stok kartı silindi.");
    if (ok) router.push("/panel/stok");
  }

  if (!detay) {
    return (
      <div>
        <PageHeader title="Stok Kartı" />
        <Alert tone="error">{hata}</Alert>
        {!hata && <Card>Yükleniyor…</Card>}
      </div>
    );
  }

  const miktar = Number(detay.mevcutMiktar);
  const kritik = detay.kritikSeviye ? Number(detay.kritikSeviye) : null;
  const kritikAlti = kritik !== null && miktar <= kritik;

  return (
    <div className="stock-detail-page">
      <header className="stock-profile">
        <div className="stock-profile__top"><ButtonLabel as="a" href="/panel/stok">← Stok listesi</ButtonLabel><span className="stock-profile__code">STOK KARTI / {detay.kod}</span></div>
        <div className="stock-profile__body">
          <div className="stock-profile__avatar">{detay.ad.trim().slice(0, 2).toLocaleUpperCase("tr-TR")}</div>
          <div className="stock-profile__identity"><div className="stock-profile__badges"><Badge variant={detay.aktif ? "success" : "neutral"}>{detay.aktif ? "Aktif" : "Pasif"}</Badge>{kritikAlti && <Badge variant="warning">Kritik stok</Badge>}<Badge variant="neutral">{TIP_ETIKETLERI[detay.tip] ?? detay.tip}</Badge></div><h1>{detay.ad}</h1><p>{detay.kategori?.ad ?? "Kategorisiz"} · Ana birim {detay.anaBirim}{detay.marka ? ` · ${detay.marka}` : ""}{detay.model ? ` ${detay.model}` : ""}</p></div>
          <div className="stock-profile__commercial"><span>Satış fiyatı</span><strong>{detay.satisFiyati ? `${Number(detay.satisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${detay.satisFiyatiDoviz}` : "Tanımsız"}</strong><small>{detay.alisFiyati ? `Alış ${Number(detay.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${detay.alisFiyatiDoviz}` : "Alış fiyatı tanımsız"}</small></div>
        </div>
      </header>

      {(detay.izinliEylemler.includes("kopyala") || detay.izinliEylemler.includes("sil")) && (
        <EylemCubugu etiket="Stok kartı eylemleri">
          {detay.izinliEylemler.includes("kopyala") && <Button size="sm" type="button" onClick={() => void kopyala()}>⧉ Kopyala</Button>}
          {detay.izinliEylemler.includes("sil") && (
            <EylemMenusu>
              <Button size="sm" type="button" variant="danger" onClick={() => void sil()}>🗑️ Sil</Button>
            </EylemMenusu>
          )}
        </EylemCubugu>
      )}

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {uyari && <Alert tone="error">⚠️ {uyari}</Alert>}

      <section className="stock-kpis">
        <div className={`stock-kpi stock-kpi--lead${kritikAlti ? " is-danger" : ""}`}><span>Mevcut stok</span><strong>{adet(detay.mevcutMiktar)} <small>{detay.anaBirim}</small></strong><p>{kritik !== null ? `Kritik eşik ${adet(kritik)} ${detay.anaBirim}` : "Kritik eşik tanımlanmamış"}</p></div>
        <div className="stock-kpi"><span>Kullanılabilir</span><strong>{adet(detay.kullanilabilirMiktar)} <small>{detay.anaBirim}</small></strong><p>{adet(detay.rezerveMiktar)} {detay.anaBirim} rezerve</p></div>
        <div className="stock-kpi"><span>Tedarik görünümü</span><strong>{adet(detay.yoldakiMiktar)} <small>{detay.anaBirim}</small></strong><p>{detay.tedarikSuresiGun != null ? `${detay.tedarikSuresiGun} gün tedarik süresi` : "Tedarik süresi tanımsız"}</p></div>
        <div className="stock-kpi stock-kpi--value"><span>Stok değeri</span><strong>{tl(Number(detay.ortalamaMaliyet) * miktar)}</strong><p>Ort. maliyet {tl(detay.ortalamaMaliyet)}</p></div>
      </section>

      <div className="stock-tabs">
        <Tabs<Sekme>
          ariaLabel="Stok kartı bölümleri"
          idPrefix="stok-detay"
          value={aktifSekme}
          onChange={setAktifSekme}
          items={[
            { deger: "genel", baslik: "Genel" },
            { deger: "recete", baslik: recete ? `Ürün reçetesi (${recete.kalemler?.length ?? 0})` : "Ürün reçetesi" },
            { deger: "fiyatlar", baslik: `Dövizli fiyatlar (${fiyatlar.length})` },
            { deger: "hareketler", baslik: `Hareketler (${hareketler.length})` },
            ...(cokluDepo
              ? [{ deger: "depolar" as Sekme, baslik: `Depolar (${depoBakiyeleri.length})` }]
              : []),
            { deger: "birimler", baslik: `Birimler (${detay.birimler.length})` },
            { deger: "varyantlar", baslik: `Varyantlar (${detay.varyantlar?.length ?? 0})` },
            ...((detay.takipTipi ?? "yok") !== "yok" ? [{ deger: "partiler" as Sekme, baslik: `Seri / Lot (${partiler.length})` }] : []),
            { deger: "barkodlar", baslik: `Barkodlar (${detay.barkodlar.length})` },
            { deger: "tedarikciler", baslik: `Tedarikçiler (${detay.tedarikciler.length})` },
          ]}
        />
      </div>

      {aktifSekme === "genel" && (
        <TabPanel idPrefix="stok-detay" value="genel">
          <GenelSekmesi
            detay={detay}
            kategoriler={kategoriler}
            onKaydet={(govde) =>
              islem(
                () => api(`/stok/${id}`, { method: "PATCH", body: JSON.stringify(govde) }),
                "Stok kartı güncellendi.",
              )
            }
          />
        </TabPanel>
      )}

      {aktifSekme === "recete" && <TabPanel idPrefix="stok-detay" value="recete"><ReceteSekmesi stokId={id} anaBirim={detay.anaBirim} recete={recete} stoklar={tumStoklar.filter((s) => s.id !== id && s.tip !== "hizmet")} isMerkezleri={isMerkezleri} onKaydedildi={async () => { await receteyiYukle(); setBasari("Yeni reçete sürümü taslak olarak kaydedildi."); }} onSilindi={async () => { await receteyiYukle(); setBasari("Ürün reçetesi arşivlendi."); }} onHata={setHata} /></TabPanel>}
      {aktifSekme === "fiyatlar" && <TabPanel idPrefix="stok-detay" value="fiyatlar"><Card title="Dövizli ürün fiyatları"><form className="form-grid" onSubmit={fiyatEkle}><Field label="Tip"><Select value={fiyatTipi} onChange={(e) => setFiyatTipi(e.target.value as "alis" | "satis")}><option value="satis">Satış</option><option value="alis">Alış</option></Select></Field><Field label="Varyant"><Select value={fiyatVaryantId} onChange={(e) => setFiyatVaryantId(e.target.value)}><option value="">Kart fiyatı</option>{(detay.varyantlar ?? []).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad}</option>)}</Select></Field><Field label="Döviz"><Select value={fiyatDovizi} onChange={(e) => setFiyatDovizi(e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></Select></Field><Field label="Tutar"><Input type="number" min="0" step="0.0001" value={fiyatTutar} onChange={(e) => setFiyatTutar(e.target.value)} required /></Field><div><Button type="submit" variant="primary">Fiyat kaydet</Button></div></form><TableWrap><thead><tr><th>Tip</th><th>Varyant</th><th>Döviz</th><th className="num">Tutar</th><th>Durum</th><th /></tr></thead><tbody>{fiyatlar.map((f) => <tr key={f.id}><td>{f.tip === "alis" ? "Alış" : "Satış"}</td><td>{f.varyantId ? detay.varyantlar?.find((v) => v.id === f.varyantId)?.kod ?? f.varyantId : "Kart"}</td><td>{f.dovizCinsi}</td><td className="num">{Number(f.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {f.dovizCinsi}</td><td>{f.aktif ? "Aktif" : "Pasif"}</td><td><Button size="sm" variant="danger" type="button" onClick={() => void fiyatSil(f.id)}>Sil</Button></td></tr>)}{!fiyatlar.length && <tr><td colSpan={6}>Henüz dövizli fiyat tanımlanmamış.</td></tr>}</tbody></TableWrap></Card></TabPanel>}

      {aktifSekme === "hareketler" && (
        <TabPanel idPrefix="stok-detay" value="hareketler"><HareketlerSekmesi
          detay={detay}
          hareketler={hareketler}
          iptalleriGoster={iptalleriGoster}
          onIptalleriGoster={setIptalleriGoster}
          onEkle={async (govde) => {
            setHata("");
            setBasari("");
            setUyari("");
            try {
              const yanit = await api<{ eksiStokUyarisi: string | null }>(`/stok/${id}/hareketler`, {
                method: "POST",
                body: JSON.stringify(govde),
              });
              setBasari("Stok hareketi işlendi.");
              if (yanit.eksiStokUyarisi) setUyari(yanit.eksiStokUyarisi);
              await yukle();
              await hareketleriYukle();
              await depoBakiyeleriYukle();
              await partileriYukle();
              return true;
            } catch (h) {
              setHata(h instanceof Error ? h.message : "Hareket işlenemedi");
              return false;
            }
          }}
        /></TabPanel>
      )}

      {aktifSekme === "depolar" && (
        <TabPanel idPrefix="stok-detay" value="depolar"><DepolarSekmesi detay={detay} satirlar={depoBakiyeleri} /></TabPanel>
      )}

      {aktifSekme === "birimler" && (
        <TabPanel idPrefix="stok-detay" value="birimler"><BirimlerSekmesi
          detay={detay}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/birimler`, { method: "POST", body: JSON.stringify(govde) }),
              "Birim eklendi.",
            )
          }
          onSil={(birimId) =>
            islem(() => api(`/stok/${id}/birimler/${birimId}`, { method: "DELETE" }), "Birim silindi.")
          }
        /></TabPanel>
      )}

      {aktifSekme === "varyantlar" && (
        <TabPanel idPrefix="stok-detay" value="varyantlar"><VaryantlarSekmesi detay={detay} onIslem={islem} /></TabPanel>
      )}
      {aktifSekme === "partiler" && <TabPanel idPrefix="stok-detay" value="partiler"><PartilerSekmesi detay={detay} partiler={partiler} /></TabPanel>}

      {aktifSekme === "barkodlar" && (
        <TabPanel idPrefix="stok-detay" value="barkodlar"><BarkodlarSekmesi
          detay={detay}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/barkodlar`, { method: "POST", body: JSON.stringify(govde) }),
              "Barkod eklendi.",
            )
          }
          onSil={(barkodId) =>
            islem(() => api(`/stok/${id}/barkodlar/${barkodId}`, { method: "DELETE" }), "Barkod silindi.")
          }
          onHata={setHata}
        /></TabPanel>
      )}

      {aktifSekme === "tedarikciler" && (
        <TabPanel idPrefix="stok-detay" value="tedarikciler"><TedarikcilerSekmesi
          detay={detay}
          cariler={cariler}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/tedarikciler`, { method: "POST", body: JSON.stringify(govde) }),
              "Tedarikçi eklendi.",
            )
          }
          onSil={(tedarikciId) =>
            islem(
              () => api(`/stok/${id}/tedarikciler/${tedarikciId}`, { method: "DELETE" }),
              "Tedarikçi bağlantısı silindi.",
            )
          }
        /></TabPanel>
      )}
    </div>
  );
}

/* ─── Genel sekmesi ──────────────────────────────────────────────────────── */

function GenelSekmesi({
  detay,
  kategoriler,
  onKaydet,
}: {
  detay: StokDetay;
  kategoriler: Kategori[];
  onKaydet: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const duzenlenebilir = detay.izinliEylemler.includes("duzenle");
  const [form, setForm] = useState({
    ad: detay.ad,
    kisaAd: detay.kisaAd ?? "",
    aciklama: detay.aciklama ?? "",
    kategoriId: detay.kategoriId ?? "",
    marka: detay.marka ?? "",
    model: detay.model ?? "",
    mensei: detay.mensei ?? "",
    gtipKodu: detay.gtipKodu ?? "",
    ureticiUrunKodu: detay.ureticiUrunKodu ?? "",
    kdvOrani: detay.kdvOrani,
    alisFiyati: detay.alisFiyati ?? "",
    satisFiyati: detay.satisFiyati ?? "",
    alisFiyatiDoviz: detay.alisFiyatiDoviz ?? "TRY",
    satisFiyatiDoviz: detay.satisFiyatiDoviz ?? "TRY",
    kritikSeviye: detay.kritikSeviye ?? "",
    minStok: detay.minStok ?? "",
    maksStok: detay.maksStok ?? "",
    guvenlikStogu: detay.guvenlikStogu ?? "",
    tedarikSuresiGun: detay.tedarikSuresiGun?.toString() ?? "",
    aktif: detay.aktif,
    takipTipi: detay.takipTipi ?? "yok",
  });

  const alan = (k: keyof typeof form) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  /** Boş metin alanları null, sayısal alanlar API'nin beklediği string olarak gider. */
  function kaydet() {
    const bosNull = (d: string) => (d.trim() === "" ? null : d.trim());
    void onKaydet({
      ad: form.ad,
      kisaAd: bosNull(form.kisaAd),
      aciklama: bosNull(form.aciklama),
      kategoriId: bosNull(form.kategoriId),
      marka: bosNull(form.marka),
      model: bosNull(form.model),
      mensei: bosNull(form.mensei),
      gtipKodu: bosNull(form.gtipKodu),
      ureticiUrunKodu: bosNull(form.ureticiUrunKodu),
      kdvOrani: form.kdvOrani || "20",
      alisFiyati: bosNull(form.alisFiyati),
      satisFiyati: bosNull(form.satisFiyati),
      alisFiyatiDoviz: form.alisFiyatiDoviz,
      satisFiyatiDoviz: form.satisFiyatiDoviz,
      kritikSeviye: bosNull(form.kritikSeviye),
      minStok: bosNull(form.minStok),
      maksStok: bosNull(form.maksStok),
      guvenlikStogu: bosNull(form.guvenlikStogu),
      tedarikSuresiGun: form.tedarikSuresiGun.trim() === "" ? null : Number(form.tedarikSuresiGun),
      aktif: form.aktif,
      takipTipi: form.takipTipi,
    });
  }

  return (
    <Card className="stack stock-editor">
      <div className="between">
        <div className="card__title" style={{ margin: 0 }}>
          Kart bilgileri
        </div>
        {duzenlenebilir && (
          <Button size="sm" onClick={() => setForm((f) => ({ ...f, aktif: !f.aktif }))}>
            {form.aktif ? "Pasife Al" : "Aktife Al"}
          </Button>
        )}
      </div>

      <div className="stock-editor__section"><span>01</span><div><strong>Temel bilgiler</strong><small>Ürünün katalogda görünen kimliği ve sınıflandırması</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--basic">
        <div className="stock-field stock-field--wide">
          <Field label="Ürün/Hizmet Adı *">
            <Input {...alan("ad")} required />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Kısa Ad">
            <Input {...alan("kisaAd")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Kategori">
            <Select {...alan("kategoriId")}>
              <option value="">— Kategorisiz —</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ust ? `${k.ust.ad} › ${k.ad}` : k.ad}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="stock-field stock-field--full"><Field label="Açıklama"><Input {...alan("aciklama")} placeholder="Ürünle ilgili kısa açıklama veya kullanım notu" /></Field></div>
      </div>

      <div className="stock-editor__section"><span>02</span><div><strong>İzlenebilirlik ve tanımlayıcılar</strong><small>Üretici, menşei ve seri/lot izleme tercihleri</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--identity">
        <div className="stock-field stock-field--tracking"><Field label="Seri / lot takibi"><Select {...alan("takipTipi")}><option value="yok">Takip yok</option><option value="lot">Lot / parti ve son kullanma tarihi</option><option value="seri">Tekil seri numarası</option></Select></Field></div>
        <div className="stock-field">
          <Field label="Marka">
            <Input {...alan("marka")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Model">
            <Input {...alan("model")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Menşei">
            <Input {...alan("mensei")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="GTİP Kodu">
            <Input {...alan("gtipKodu")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Üretici Ürün Kodu">
            <Input {...alan("ureticiUrunKodu")} />
          </Field>
        </div>
      </div>

      <div className="stock-editor__section"><span>03</span><div><strong>Fiyatlandırma</strong><small>Vergi oranı ve kartın varsayılan alış/satış fiyatları</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--pricing">
        <div className="stock-field">
          <Field label="KDV Oranı (%)">
            <Input type="number" step="0.01" {...alan("kdvOrani")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Alış Fiyatı">
            <div className="stock-price-input"><Input type="number" step="0.0001" {...alan("alisFiyati")} placeholder="0.0000" /><Select aria-label="Alış fiyatı dövizi" {...alan("alisFiyatiDoviz")}><option>TRY</option><option>USD</option><option>EUR</option></Select></div>
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Satış Fiyatı">
            <div className="stock-price-input"><Input type="number" step="0.0001" {...alan("satisFiyati")} placeholder="0.0000" /><Select aria-label="Satış fiyatı dövizi" {...alan("satisFiyatiDoviz")}><option>TRY</option><option>USD</option><option>EUR</option></Select></div>
          </Field>
        </div>
      </div>

      <div className="stock-editor__section"><span>04</span><div><strong>Stok planlama</strong><small>Kritik eşikler, güvenlik stoğu ve tedarik parametreleri</small></div></div>
      <div className="stock-editor__grid stock-editor__grid--planning">
        <div className="stock-field">
          <Field label="Kritik Seviye">
            <Input type="number" step="0.001" {...alan("kritikSeviye")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Min. Stok">
            <Input type="number" step="0.001" {...alan("minStok")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Maks. Stok">
            <Input type="number" step="0.001" {...alan("maksStok")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Güvenlik Stoğu">
            <Input type="number" step="0.001" {...alan("guvenlikStogu")} />
          </Field>
        </div>
        <div className="stock-field">
          <Field label="Tedarik Süresi (gün)">
            <Input type="number" min="0" max="365" {...alan("tedarikSuresiGun")} />
          </Field>
        </div>
      </div>

      <div className="stock-editor__actions">
        <Button variant="primary" onClick={kaydet} disabled={!duzenlenebilir}>
          Değişiklikleri Kaydet
        </Button>
        {!duzenlenebilir && (
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Bu kartı düzenleme yetkiniz yok.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ─── Hareketler sekmesi (STK-02) ────────────────────────────────────────── */

/* ─── Depolar sekmesi (STK-07) ───────────────────────────────────────────── */

function DepolarSekmesi({
  detay,
  satirlar,
}: {
  detay: StokDetay;
  satirlar: DepoBakiyeSatiri[];
}) {
  return (
    <Card pad={false}>
      <TableWrap>
        <thead>
          <tr>
            <th>Depo</th>
            <th className="num">Mevcut</th>
            <th className="num">Rezerve</th>
            <th className="num">Kullanılabilir</th>
            <th className="num">Yoldaki</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                Bu ürünün henüz hiçbir depoda bakiyesi yok.
              </td>
            </tr>
          ) : (
            <>
              {satirlar.map((s) => (
                <tr key={s.depoId}>
                  <td>
                    <span className="mono">{s.depoKod}</span> · {s.depoAd}
                    {!s.depoAktif && " (pasif)"}
                  </td>
                  <td className="num">
                    {adet(s.mevcutMiktar)} {detay.anaBirim}
                  </td>
                  <td className="num">{adet(s.rezerveMiktar)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {adet(s.kullanilabilirMiktar)}
                  </td>
                  <td className="num">{adet(s.yoldakiMiktar)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Toplam</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.mevcutMiktar)} {detay.anaBirim}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.rezerveMiktar)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.kullanilabilirMiktar)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.yoldakiMiktar)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function PartilerSekmesi({ detay, partiler }: { detay: StokDetay; partiler: Parti[] }) {
  return <Card title="Seri / Lot izlenebilirliği"><p className="muted">Çıkışlar son kullanma tarihi en yakın partiden (FEFO) otomatik karşılanır.</p><TableWrap><thead><tr><th>Lot / Seri</th><th>Varyant</th><th>Depo</th><th>Üretim</th><th>Son kullanma</th><th>Giren</th><th>Kalan</th></tr></thead><tbody>{partiler.map((p) => <tr key={p.id}><td><strong>{p.lotNo}</strong>{p.seriNo && <><br /><small>{p.seriNo}</small></>}</td><td>{p.varyant ? `${p.varyant.kod} — ${p.varyant.ad}` : "—"}</td><td>{p.depo.ad}</td><td>{p.uretimTarihi?.slice(0, 10) ?? "—"}</td><td>{p.sonKullanmaTarihi?.slice(0, 10) ?? "—"}</td><td>{adet(p.ilkMiktar)} {detay.anaBirim}</td><td><strong>{adet(p.kalanMiktar)} {detay.anaBirim}</strong></td></tr>)}{!partiler.length && <tr><td colSpan={7}>Henüz seri/lot girişi yok.</td></tr>}</tbody></TableWrap></Card>;
}

function VaryantlarSekmesi({ detay, onIslem }: { detay: StokDetay; onIslem: (islem: () => Promise<unknown>, mesaj: string) => Promise<boolean> }) {
  const [form, setForm] = useState({ kod: "", ad: "", nitelikler: "", barkod: "", alisFiyati: "", satisFiyati: "" });
  async function ekle(e: React.FormEvent) {
    e.preventDefault();
    const nitelikler = Object.fromEntries(form.nitelikler.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [anahtar, ...deger] = x.split(":"); return [anahtar.trim(), deger.join(":").trim()]; }).filter(([, v]) => v));
    const basarili = await onIslem(() => api(`/stok/${detay.id}/varyantlar`, { method: "POST", body: JSON.stringify({ kod: form.kod, ad: form.ad, nitelikler, barkod: form.barkod || null, alisFiyati: form.alisFiyati || null, satisFiyati: form.satisFiyati || null }) }), "Varyant eklendi.");
    if (basarili) setForm({ kod: "", ad: "", nitelikler: "", barkod: "", alisFiyati: "", satisFiyati: "" });
  }
  return <div className="stack"><Card title="Yeni varyant"><form className="form-grid" onSubmit={ekle}><Field label="Varyant kodu"><Input required value={form.kod} onChange={(e) => setForm({ ...form, kod: e.target.value })} /></Field><Field label="Ad"><Input required value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></Field><Field label="Nitelikler"><Input required placeholder="Renk: Siyah, Beden: M" value={form.nitelikler} onChange={(e) => setForm({ ...form, nitelikler: e.target.value })} /></Field><Field label="Barkod"><Input value={form.barkod} onChange={(e) => setForm({ ...form, barkod: e.target.value })} /></Field><Field label="Alış fiyatı"><Input type="number" min="0" step="0.0001" value={form.alisFiyati} onChange={(e) => setForm({ ...form, alisFiyati: e.target.value })} /></Field><Field label="Satış fiyatı"><Input type="number" min="0" step="0.0001" value={form.satisFiyati} onChange={(e) => setForm({ ...form, satisFiyati: e.target.value })} /></Field><div><Button type="submit">Varyant ekle</Button></div></form></Card><Card title="Varyantlar"><TableWrap><thead><tr><th>Kod</th><th>Ad / Nitelikler</th><th>Barkod</th><th>Stok</th><th>Satış</th><th>Durum</th></tr></thead><tbody>{(detay.varyantlar ?? []).map((v) => <tr key={v.id}><td>{v.kod}</td><td><strong>{v.ad}</strong><br /><small>{Object.entries(v.nitelikler).map(([k, d]) => `${k}: ${d}`).join(" · ")}</small></td><td>{v.barkod ?? "—"}</td><td>{adet(v.mevcutMiktar)} {detay.anaBirim}</td><td>{v.satisFiyati ? tl(v.satisFiyati) : "Kart fiyatı"}</td><td><Button variant="ghost" size="sm" onClick={() => void onIslem(() => api(`/stok/${detay.id}/varyantlar/${v.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !v.aktif }) }), v.aktif ? "Varyant pasifleştirildi." : "Varyant etkinleştirildi.")}>{v.aktif ? "Aktif" : "Pasif"}</Button></td></tr>)}</tbody></TableWrap></Card></div>;
}

function HareketlerSekmesi({
  detay,
  hareketler,
  iptalleriGoster,
  onIptalleriGoster,
  onEkle,
}: {
  detay: StokDetay;
  hareketler: Hareket[];
  iptalleriGoster: boolean;
  onIptalleriGoster: (goster: boolean) => void;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const { cokluDepo } = useDepolar();
  const [formAcik, setFormAcik] = useState(false);
  const [tip, setTip] = useState("giris");
  const [girilenMiktar, setGirilenMiktar] = useState("");
  const [girilenBirim, setGirilenBirim] = useState(detay.anaBirim);
  const [maliyet, setMaliyet] = useState("0");
  const [tarih, setTarih] = useState(bugun());
  const [aciklama, setAciklama] = useState("");
  const [depoId, setDepoId] = useState("");
  const [varyantId, setVaryantId] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [seriNolar, setSeriNolar] = useState("");
  const [sonKullanmaTarihi, setSonKullanmaTarihi] = useState("");
  const [uretimTarihi, setUretimTarihi] = useState("");

  /** Seçili birimin ana birim karşılığı; ana birim için katsayı 1. */
  const katsayi =
    girilenBirim === detay.anaBirim
      ? 1
      : Number(detay.birimler.find((b) => b.ad === girilenBirim)?.katsayi ?? 1);
  const anaBirimMiktar = girilenMiktar ? Number(girilenMiktar) * katsayi : 0;

  async function kaydet() {
    const girisMi = HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris";
    const seriler = seriNolar.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);
    const partiler = !girisMi || (detay.takipTipi ?? "yok") === "yok" ? [] : detay.takipTipi === "seri"
      ? seriler.map((seriNo) => ({ lotNo: lotNo || seriNo, seriNo, sonKullanmaTarihi: sonKullanmaTarihi || null, uretimTarihi: uretimTarihi || null, miktar: "1" }))
      : [{ lotNo, seriNo: null, sonKullanmaTarihi: sonKullanmaTarihi || null, uretimTarihi: uretimTarihi || null, miktar: anaBirimMiktar.toFixed(3) }];
    const eklendi = await onEkle({
      stokId: detay.id,
      varyantId: varyantId || null,
      depoId: depoId || null,
      tip,
      // Ana birim cinsinden miktar; API girilen değeri kendi çevirmez.
      miktar: anaBirimMiktar.toFixed(3),
      girilenBirim,
      girilenMiktar: Number(girilenMiktar).toFixed(3),
      maliyet: (maliyet || "0").toString(),
      tarih,
      aciklama: aciklama.trim() === "" ? null : aciklama.trim(),
      partiler,
    });
    if (eklendi) {
      setGirilenMiktar("");
      setAciklama("");
      setFormAcik(false);
    }
  }

  const yon = (t: string) => TUM_HAREKET_TIPLERI.find((h) => h.deger === t)?.yon ?? "duzeltme";
  const baslik = (t: string) => TUM_HAREKET_TIPLERI.find((h) => h.deger === t)?.baslik ?? t;

  return (
    <div className="stack">
      <Card>
        <div className="between">
          <div className="card__title" style={{ margin: 0 }}>
            Stok Hareketleri
          </div>
          <Button variant={formAcik ? "ghost" : "primary"} size="sm" onClick={() => setFormAcik(!formAcik)}>
            {formAcik ? "Vazgeç" : "➕ Hareket Ekle"}
          </Button>
        </div>

        {formAcik && (
          <div className="stack" style={{ marginTop: "1rem" }}>
            {(detay.takipTipi ?? "yok") !== "yok" && HAREKET_TIPLERI.find((h) => h.deger === tip)?.yon === "giris" && <div className="row"><div style={{ flex: 1, minWidth: 160 }}><Field label="Lot / Parti No"><Input required value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></Field></div>{detay.takipTipi === "seri" && <div style={{ flex: 2, minWidth: 240 }}><Field label="Seri numaraları (virgülle)"><Input required value={seriNolar} onChange={(e) => setSeriNolar(e.target.value)} placeholder="SN001, SN002" /></Field></div>}<div style={{ flex: 1, minWidth: 160 }}><Field label="Üretim tarihi"><Input type="date" value={uretimTarihi} onChange={(e) => setUretimTarihi(e.target.value)} /></Field></div><div style={{ flex: 1, minWidth: 160 }}><Field label="Son kullanma"><Input type="date" value={sonKullanmaTarihi} onChange={(e) => setSonKullanmaTarihi(e.target.value)} /></Field></div></div>}
            <div className="row">
              {(detay.varyantlar?.length ?? 0) > 0 && <div style={{ flex: 1, minWidth: 170 }}><Field label="Varyant"><Select required value={varyantId} onChange={(e) => setVaryantId(e.target.value)}><option value="">Seçin</option>{(detay.varyantlar ?? []).filter((v) => v.aktif).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad}</option>)}</Select></Field></div>}
              <div style={{ flex: 1, minWidth: 170 }}>
                <Field label="Hareket Tipi">
                  <Select value={tip} onChange={(e) => setTip(e.target.value)}>
                    {HAREKET_TIPLERI.map((h) => (
                      <option key={h.deger} value={h.deger}>
                        {h.baslik}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Miktar *">
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={girilenMiktar}
                    onChange={(e) => setGirilenMiktar(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Birim">
                  <Select value={girilenBirim} onChange={(e) => setGirilenBirim(e.target.value)}>
                    <option value={detay.anaBirim}>{detay.anaBirim} (ana birim)</option>
                    {detay.birimler.map((b) => (
                      <option key={b.id} value={b.ad}>
                        {b.ad} (×{adet(b.katsayi)})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Birim Maliyet (TRY)">
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={maliyet}
                    onChange={(e) => setMaliyet(e.target.value)}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Tarih *">
                  <Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <DepoSecici deger={depoId} onChange={setDepoId} />
              </div>
            </div>

            <Field label="Açıklama">
              <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. Fatura dışı giriş" />
            </Field>

            {girilenBirim !== detay.anaBirim && girilenMiktar && (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                {adet(girilenMiktar)} {girilenBirim} × {adet(katsayi)} ={" "}
                <strong>
                  {adet(anaBirimMiktar)} {detay.anaBirim}
                </strong>{" "}
                stoğa işlenecek.
              </p>
            )}

            <div>
              <Button variant="primary" onClick={kaydet} disabled={!girilenMiktar || Number(girilenMiktar) <= 0}>
                Hareketi Kaydet
              </Button>
            </div>
          </div>
        )}
      </Card>

      <label className="check-row">
        <input type="checkbox" checked={iptalleriGoster} onChange={(e) => onIptalleriGoster(e.target.checked)} />
        İptalleri de göster
      </label>
      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              {cokluDepo && <th>Depo</th>}
              <th>Tip</th>
              <th className="num">Girilen</th>
              <th className="num">Ana Birim</th>
              <th className="num">Birim Maliyet</th>
              <th>Kaynak</th>
              <th>Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {hareketler.length === 0 ? (
              <tr>
                <td colSpan={cokluDepo ? 8 : 7} className="empty">
                  Bu ürün için henüz stok hareketi yok.
                </td>
              </tr>
            ) : (
              hareketler.map((h) => {
                const y = yon(h.tip);
                // miktar API'de işaretli saklanır (çıkışlarda eksi); işareti biz eklemiyoruz.
                const degisim = Number(h.miktar);
                return (
                  <tr key={h.id} style={h.iptal ? { opacity: 0.6 } : undefined}>
                    <td className="mono">{h.tarih.slice(0, 10)}</td>
                    {cokluDepo && <td>{h.depo?.ad ?? "—"}</td>}
                    <td>
                      <Badge variant={y === "giris" ? "success" : y === "cikis" ? "danger" : "info"}>
                        {baslik(h.tip)}
                      </Badge>
                      {h.iptal && <> <Badge variant="neutral">İptal</Badge></>}
                    </td>
                    <td className="num">
                      {adet(h.girilenMiktar)} {h.girilenBirim}
                      {h.varyant && <><br /><small>{h.varyant.kod} — {h.varyant.ad}</small></>}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700, color: degisim < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {degisim > 0 ? "+" : ""}
                      {adet(degisim)} {detay.anaBirim}
                    </td>
                    <td className="num">{Number(h.maliyet) > 0 ? tl(h.maliyet) : "—"}</td>
                    <td>
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        {h.kaynakTur === "manuel" ? "Manuel" : h.kaynakTur}
                      </span>
                    </td>
                    <td>{h.aciklama ?? "—"}</td>
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

/* ─── Birimler sekmesi (STK-10) ──────────────────────────────────────────── */

function BirimlerSekmesi({
  detay,
  onEkle,
  onSil,
}: {
  detay: StokDetay;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (birimId: string) => void;
}) {
  const [ad, setAd] = useState("");
  const [katsayi, setKatsayi] = useState("");

  async function ekle() {
    const eklendi = await onEkle({ ad: ad.trim(), katsayi: Number(katsayi).toFixed(6) });
    if (eklendi) {
      setAd("");
      setKatsayi("");
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Ek Birim Ekle</div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          Katsayı, bir ek birimin kaç <strong>{detay.anaBirim}</strong> ettiğidir. Örnek: 1 koli = 12 adet ise katsayı 12.
        </p>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Birim Adı *">
              <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="koli" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label={`Katsayı (1 birim = ? ${detay.anaBirim}) *`}>
              <Input
                type="number"
                step="0.000001"
                min="0"
                value={katsayi}
                onChange={(e) => setKatsayi(e.target.value)}
                placeholder="12"
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={!ad.trim() || !katsayi || Number(katsayi) <= 0}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Birim</th>
              <th className="num">Katsayı</th>
              <th>Karşılığı</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{detay.anaBirim}</strong>
              </td>
              <td className="num">1</td>
              <td>
                <Badge variant="accent">Ana birim</Badge>
              </td>
              <td className="center">—</td>
            </tr>
            {detay.birimler.map((b) => (
              <tr key={b.id}>
                <td>{b.ad}</td>
                <td className="num">{adet(b.katsayi)}</td>
                <td>
                  1 {b.ad} = {adet(b.katsayi)} {detay.anaBirim}
                </td>
                <td className="center">
                  <Button size="sm" variant="danger" onClick={() => onSil(b.id)}>
                    Sil
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── Barkodlar sekmesi (STK-15) ─────────────────────────────────────────── */

function BarkodlarSekmesi({
  detay,
  onEkle,
  onSil,
  onHata,
}: {
  detay: StokDetay;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (barkodId: string) => void;
  onHata: (mesaj: string) => void;
}) {
  const [barkod, setBarkod] = useState("");
  const [birim, setBirim] = useState("");
  const [satisFiyati, setSatisFiyati] = useState("");
  const [etiketAdet, setEtiketAdet] = useState("1");
  const [etiketBarkod, setEtiketBarkod] = useState("");

  async function ekle() {
    const eklendi = await onEkle({
      barkod: barkod.trim(),
      birim: birim === "" ? null : birim,
      satisFiyati: satisFiyati.trim() === "" ? null : satisFiyati,
    });
    if (eklendi) {
      setBarkod("");
      setBirim("");
      setSatisFiyati("");
    }
  }

  /** Etiket PDF'i JSON değil blob döner; api() kullanılamaz. */
  async function etiketBas() {
    try {
      const res = await fetch(`${apiBase()}/stok/etiketler`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` },
        body: JSON.stringify({
          kalemler: [
            {
              stokId: detay.id,
              adet: Number(etiketAdet) || 1,
              ...(etiketBarkod ? { barkod: etiketBarkod } : {}),
            },
          ],
        }),
      });
      if (!res.ok) {
        const govde = await res.json().catch(() => ({}));
        throw new Error(govde.message || "Etiket PDF'i alınamadı");
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (h) {
      onHata(h instanceof Error ? h.message : "Etiket basılamadı");
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Barkod Ekle</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Barkod *">
              <Input value={barkod} onChange={(e) => setBarkod(e.target.value)} placeholder="8690000000000" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Birim">
              <Select value={birim} onChange={(e) => setBirim(e.target.value)}>
                <option value="">{detay.anaBirim} (ana birim)</option>
                {detay.birimler.map((b) => (
                  <option key={b.id} value={b.ad}>
                    {b.ad}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Satış Fiyatı (TRY)">
              <Input
                type="number"
                step="0.0001"
                value={satisFiyati}
                onChange={(e) => setSatisFiyati(e.target.value)}
                placeholder="Kart fiyatı kullanılır"
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={barkod.trim().length < 3}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card__title">🏷️ Etiket Bas</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Barkod">
              <Select value={etiketBarkod} onChange={(e) => setEtiketBarkod(e.target.value)}>
                <option value="">— İlk barkod —</option>
                {detay.barkodlar.map((b) => (
                  <option key={b.id} value={b.barkod}>
                    {b.barkod}
                    {b.birim ? ` (${b.birim})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Adet">
              <Input
                type="number"
                min="1"
                max="500"
                value={etiketAdet}
                onChange={(e) => setEtiketAdet(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button onClick={etiketBas} disabled={detay.barkodlar.length === 0}>
              🖨️ Etiket PDF&apos;i Aç
            </Button>
          </div>
        </div>
        {detay.barkodlar.length === 0 && (
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Etiket basmak için önce en az bir barkod eklemelisiniz.
          </p>
        )}
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Barkod</th>
              <th>Birim</th>
              <th className="num">Satış Fiyatı</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            {detay.barkodlar.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  Bu ürüne tanımlı barkod yok.
                </td>
              </tr>
            ) : (
              detay.barkodlar.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.barkod}</td>
                  <td>{b.birim ?? detay.anaBirim}</td>
                  <td className="num">{b.satisFiyati ? tl(b.satisFiyati) : "—"}</td>
                  <td className="center">
                    <Button size="sm" variant="danger" onClick={() => onSil(b.id)}>
                      Sil
                    </Button>
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

/* ─── Tedarikçiler sekmesi (STK-18) ──────────────────────────────────────── */

function TedarikcilerSekmesi({
  detay,
  cariler,
  onEkle,
  onSil,
}: {
  detay: StokDetay;
  cariler: CariOzet[];
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (tedarikciId: string) => void;
}) {
  const [cariId, setCariId] = useState("");
  const [urunKodu, setUrunKodu] = useState("");
  const [alisFiyati, setAlisFiyati] = useState("");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [tedarikSuresiGun, setTedarikSuresiGun] = useState("");
  const [varsayilan, setVarsayilan] = useState(false);

  async function ekle() {
    const eklendi = await onEkle({
      cariId,
      tedarikciUrunKodu: urunKodu.trim() === "" ? null : urunKodu.trim(),
      alisFiyati: alisFiyati.trim() === "" ? null : alisFiyati,
      dovizCinsi,
      tedarikSuresiGun: tedarikSuresiGun.trim() === "" ? null : Number(tedarikSuresiGun),
      varsayilan,
    });
    if (eklendi) {
      setCariId("");
      setUrunKodu("");
      setAlisFiyati("");
      setTedarikSuresiGun("");
      setVarsayilan(false);
    }
  }

  const bagliCariIdler = new Set(detay.tedarikciler.map((t) => t.cariId));

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Tedarikçi Ekle</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 220 }}>
            <Field label="Cari *">
              <Select aria-label="Cari" value={cariId} onChange={(e) => setCariId(e.target.value)}>
                <option value="">— Cari seçin —</option>
                {cariler
                  .filter((c) => !bagliCariIdler.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.kod} · {c.unvan}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Tedarikçi Ürün Kodu">
              <Input value={urunKodu} onChange={(e) => setUrunKodu(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Alış Fiyatı">
              <Input
                type="number"
                step="0.0001"
                value={alisFiyati}
                onChange={(e) => setAlisFiyati(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <Field label="Döviz">
              <Select value={dovizCinsi} onChange={(e) => setDovizCinsi(e.target.value)}>
                <option value="TRY">TRY</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Tedarik Süresi (gün)">
              <Input
                type="number"
                min="0"
                max="365"
                value={tedarikSuresiGun}
                onChange={(e) => setTedarikSuresiGun(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="between" style={{ marginTop: "0.75rem" }}>
          <label className="row-tight" style={{ alignItems: "center", cursor: "pointer", fontSize: "0.9rem" }}>
            <input type="checkbox" checked={varsayilan} onChange={(e) => setVarsayilan(e.target.checked)} />
            Varsayılan tedarikçi olarak işaretle
          </label>
          <Button variant="primary" onClick={ekle} disabled={!cariId}>
            ➕ Ekle
          </Button>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Cari</th>
              <th>Tedarikçi Ürün Kodu</th>
              <th className="num">Alış Fiyatı</th>
              <th className="num">Tedarik Süresi</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            {detay.tedarikciler.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Bu ürüne bağlı tedarikçi yok.
                </td>
              </tr>
            ) : (
              detay.tedarikciler.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="cell-entity__name">
                      {t.cari.unvan} {t.varsayilan && <Badge variant="accent">Varsayılan</Badge>}
                    </div>
                    <div className="cell-entity__meta">{t.cari.kod}</div>
                  </td>
                  <td className="mono">{t.tedarikciUrunKodu ?? "—"}</td>
                  <td className="num">
                    {t.alisFiyati
                      ? `${Number(t.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${t.dovizCinsi}`
                      : "—"}
                  </td>
                  <td className="num">{t.tedarikSuresiGun !== null ? `${t.tedarikSuresiGun} gün` : "—"}</td>
                  <td className="center">
                    <Button size="sm" variant="danger" onClick={() => onSil(t.id)}>
                      Sil
                    </Button>
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
