"use client";

import { useEkranKaydi } from "@/lib/asistan-baglami";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ihtiyacGirdisiOku, ihtiyacKaniti, ihtiyacSorgusu, ihtiyactanTalep, type IhtiyacGirdisi, type IhtiyacSonucu } from "@/lib/ihtiyac-talep";
import { AramaSecici } from "@/components/arama-secici";
import { BelgeDosyalari, belgeDosyalariniYukle, KayitliEkSatiri, type KayitliEk } from "@/components/belge-dosyalari";
import { DepoSecici } from "@/components/depo-secici";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, EylemCubugu, Field, Input, Modal, PageHeader, Para, SearchInput, Select, Stat, StatGrid, TableWrap, Tabs, Tarih } from "@/components/ui";
import { gunEkleTR } from "@tekirextra/shared";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
import { KdvOraniSecimi, useKodTablosu } from "@/components/kdv-orani-secimi";
import { AkisGostergesi, DURUM, Gecmis, KararPenceresi, TutarCubugu, type Durum, type KararTanimi } from "./talep-parcalari";

type Kapsam = "benim" | "onay" | "tum";
type DurumSuzgeci = "hepsi" | "acik" | Durum;

interface Secenekler {
  departmanlar: { id: string; ad: string }[];
  butceKalemleri: { anahtar: string; ad: string }[];
  stoklar: { id: string; kod: string; ad: string; anaBirim: string; tip: string; alisFiyati: string | null }[];
  tedarikciler: { id: string; kod: string; unvan: string }[];
  onayEsigi: number;
  yetkiler: { talepAcabilir: boolean; tumunuGorur: boolean; teklifYonetir: boolean };
}

interface TalepSatiri {
  id: string;
  no: string;
  durum: Durum;
  ihtiyacTarihi: string;
  gerekce: string;
  etkinTutar: string;
  talepEden: string;
  departman: string | null;
  teklifSayisi: number;
  siparisBelge: { id: string; no: string | null } | null;
  onaylayabilecekRoller: string[];
  yenidenOnay?: boolean;
}

interface Teklif {
  id: string;
  tedarikci: { id: string; kod: string; unvan: string };
  dovizCinsi: string;
  kur: string;
  teslimSuresiGun: number | null;
  gecerlilikTarihi: string | null;
  aciklama: string | null;
  toplam: string;
  toplamTry: string;
  secildi: boolean;
  enDusuk: boolean;
  suresiDoldu?: boolean;
  kalemler: { talepKalemiId: string; birimFiyat: string; kdvOrani: string }[];
}

interface TalepDetay {
  id: string;
  no: string;
  durum: Durum;
  ihtiyacTarihi: string;
  gerekce: string;
  butceAnahtari: string;
  butceKalemi: string;
  etkinTutar: string;
  onaylananTutar?: string | null;
  yenidenOnaySiniri?: string | null;
  yenidenOnayNedeni?: string | null;
  talepEden: { id: string; adSoyad: string };
  departman: { id: string; ad: string } | null;
  onaylayan: string | null;
  onayZamani: string | null;
  butceAsimGerekcesi: string | null;
  redGerekcesi: string | null;
  teklifSecimGerekcesi: string | null;
  siparisBelge: { id: string; no: string | null; durum: string } | null;
  kalemler: { id: string; stokId: string; stokKod: string; stokAd: string; miktar: string; birim: string; tahminiBirimFiyat: string; tutar: string }[];
  teklifler: Teklif[];
  olaylar: { tur: string; aciklama: string | null; kullanici: string; zaman: string }[];
  butce: { yil: number; ay: number; tanimli: boolean; butce: number; gerceklesen: number; digerTalepler: number; kalan: number; talep: number; asim: number };
  onaylayabilecekRoller: string[];
  onayEngeli: string | null;
  yetkiler: { duzenle: boolean; gonder: boolean; geriCek: boolean; iptal: boolean; onayla: boolean; teklifYonet: boolean; siparis: boolean };
}

interface KalemFormu { stokId: string; miktar: string; tahminiBirimFiyat: string }
interface TalepFormu { id?: string; departmanId: string; ihtiyacTarihi: string; gerekce: string; butceAnahtari: string; kalemler: KalemFormu[] }
interface TeklifFormu { tedarikciCariId: string; dovizCinsi: string; kur: string; teslimSuresiGun: string; gecerlilikTarihi: string; aciklama: string; fiyatlar: Record<string, { birimFiyat: string; kdvOrani: string }> }

const ROL_ADI: Record<string, string> = { muhasebe: "muhasebe", yonetici: "yönetici" };
const ACIK: Durum[] = ["taslak", "onay_bekliyor", "onaylandi"];
const LISTE_SINIRI = 500;

const sayi = (v: string | number) => Number(v || 0);
const bosTalep = (): TalepFormu => ({ departmanId: "", ihtiyacTarihi: gunEkleTR(7), gerekce: "", butceAnahtari: "mal_alis", kalemler: [{ stokId: "", miktar: "1", tahminiBirimFiyat: "" }] });
const bosTeklif = (): TeklifFormu => ({ tedarikciCariId: "", dovizCinsi: "TRY", kur: "1", teslimSuresiGun: "", gecerlilikTarihi: "", aciklama: "", fiyatlar: {} });
const bugun = () => gunEkleTR(0);

export default function SatinAlmaTalepleriSayfasi() {
  const [secenekler, setSecenekler] = useState<Secenekler | null>(null);
  const [kapsam, setKapsam] = useState<Kapsam>("benim");
  const [liste, setListe] = useState<TalepSatiri[]>([]);
  const [listeYuklendi, setListeYuklendi] = useState(false);
  const [arama, setArama] = useState("");
  const [durumSuzgeci, setDurumSuzgeci] = useState<DurumSuzgeci>("hepsi");
  const [detay, setDetay] = useState<TalepDetay | null>(null);
  // AI-78: açık satın alma talebi asistan bağlamı olur.
  useEkranKaydi(detay ? { tur: "satin_alma_talebi", id: detay.id, etiket: detay.no } : null);
  const aktarimSirasi = useRef(0);
  const [aktarim, setAktarim] = useState<{ girdi: IhtiyacGirdisi; sonuc: IhtiyacSonucu } | null>(null);
  const [form, setForm] = useState<TalepFormu | null>(null);
  const [karar, setKarar] = useState<KararTanimi | null>(null);
  const [teklifPenceresi, setTeklifPenceresi] = useState<"teklif" | "dogrudan" | null>(null);
  const [teklif, setTeklif] = useState<TeklifFormu>(bosTeklif());
  // MVZ-11: teklif bugün girilir; KDV oranı bugün yürürlükteki merkezi listeden.
  const kodTablosu = useKodTablosu(null);
  const [teklifDosyalari, setTeklifDosyalari] = useState<File[]>([]);
  const [depoId, setDepoId] = useState("");
  const [ekAcik, setEkAcik] = useState<string | null>(null);
  const [ekler, setEkler] = useState<KayitliEk[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState(false);

  const listeyiYukle = useCallback(async (k: Kapsam) => {
    try {
      setListe(await api<TalepSatiri[]>(`/satin-alma/talepler?kapsam=${k}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Talepler yüklenemedi");
    } finally {
      setListeYuklendi(true);
    }
  }, []);

  const detayAc = useCallback(async (id: string) => {
    setHata("");
    setTeklif(bosTeklif());
    setTeklifDosyalari([]);
    setEkAcik(null);
    try {
      setDetay(await api<TalepDetay>(`/satin-alma/talepler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Talep açılamadı");
    }
  }, []);

  useEffect(() => {
    const sira = ++aktarimSirasi.current;
    void (async () => {
      try {
        const s = await api<Secenekler>("/satin-alma/secenekler");
        setSecenekler(s);
        const ilk: Kapsam = !s.yetkiler.talepAcabilir && s.yetkiler.tumunuGorur ? "tum" : "benim";
        setKapsam(ilk);
        await listeyiYukle(ilk);
        const talep = new URLSearchParams(window.location.search).get("talep");
        if (talep) await detayAc(talep);
        else {
          const girdi = ihtiyacGirdisiOku(new URLSearchParams(window.location.search));
          if (girdi) {
            if (!s.yetkiler.talepAcabilir) throw Error("Bu rol satın alma talebi açamaz.");
            const sonuc = await api<IhtiyacSonucu>(ihtiyacSorgusu(girdi), { cache: "no-store" });
            if (!s.stoklar.some(k => k.id === sonuc.stok.id)) throw Error("Ürün satın alma listesinde yok. Stok kartını kontrol edin.");
            if (sira === aktarimSirasi.current) { setForm(ihtiyactanTalep(sonuc)); setAktarim({ girdi, sonuc }); }
          }
        }
      } catch (h) {
        setHata(h instanceof Error ? h.message : "Satın alma bilgileri yüklenemedi");
      }
    })();
    return () => { aktarimSirasi.current++; };
  }, [listeyiYukle, detayAc]);

  const stokSecenekleri = useMemo(
    () => (secenekler?.stoklar ?? []).map((s) => ({ deger: s.id, baslik: `${s.kod} — ${s.ad}`, aciklama: s.tip === "hizmet" ? "Hizmet" : s.anaBirim, aramaMetni: `${s.kod} ${s.ad}` })),
    [secenekler],
  );
  const tedarikciSecenekleri = useMemo(
    () => (secenekler?.tedarikciler ?? []).map((c) => ({ deger: c.id, baslik: c.unvan, aciklama: c.kod, aramaMetni: `${c.kod} ${c.unvan}` })),
    [secenekler],
  );

  const suzulmus = useMemo(() => {
    const aranan = arama.trim().toLocaleLowerCase("tr-TR");
    return liste.filter((t) => {
      if (durumSuzgeci === "acik" ? !ACIK.includes(t.durum) : durumSuzgeci !== "hepsi" && t.durum !== durumSuzgeci) return false;
      if (!aranan) return true;
      return `${t.no} ${t.gerekce} ${t.talepEden} ${t.departman ?? ""}`.toLocaleLowerCase("tr-TR").includes(aranan);
    });
  }, [liste, arama, durumSuzgeci]);

  async function yenile(mesaj: string, id?: string) {
    setBasari(mesaj);
    await listeyiYukle(kapsam);
    if (id) await detayAc(id);
  }

  async function calistir(is: () => Promise<void>) {
    setHata("");
    setBasari("");
    setIslemde(true);
    try {
      await is();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem tamamlanamadı");
    } finally {
      setIslemde(false);
    }
  }

  const post = <T,>(yol: string, govde?: unknown) => api<T>(yol, { method: "POST", body: JSON.stringify(govde ?? {}) });

  function kapsamDegistir(k: Kapsam) {
    setKapsam(k);
    void listeyiYukle(k);
  }

  function talepSec(id: string) {
    setForm(null);
    aktarimiKapat();
    const adres = new URL(window.location.href);
    adres.searchParams.set("talep", id);
    window.history.replaceState(null, "", adres);
    void detayAc(id);
  }

  function listeyeDon() {
    setDetay(null);
    setForm(null);
    aktarimiKapat();
    const adres = new URL(window.location.href);
    adres.searchParams.delete("talep");
    window.history.replaceState(null, "", adres);
  }

  function talepKaydet() {
    if (!form) return;
    void calistir(async () => {
      if (aktarim) {
        if (form.kalemler.length !== 1 || form.kalemler[0].stokId !== aktarim.sonuc.stok.id || form.kalemler[0].miktar !== aktarim.sonuc.hesap.eksik || form.ihtiyacTarihi !== aktarim.sonuc.ihtiyacTarihi) throw Error("Aktarılan ihtiyaç değişti. İhtiyacı yeniden yükleyin.");
        const guncel = await api<IhtiyacSonucu>(ihtiyacSorgusu(aktarim.girdi), { cache: "no-store" });
        if (ihtiyacKaniti(guncel) !== ihtiyacKaniti(aktarim.sonuc)) throw Error("Stok ihtiyacı değişti. İhtiyacı yeniden yükleyip miktarı kontrol edin; talep kaydedilmedi.");
        if (!form.butceAnahtari || !form.kalemler[0]?.tahminiBirimFiyat) throw Error("Bütçe kalemini seçin ve tahmini birim fiyatı girin.");
      }
      // SAT-09: sıfır tahmin onayı anlamsızlaştırır; sunucu da reddeder.
      const eksikKalem = form.kalemler.findIndex((k) => !k.stokId || sayi(k.miktar) <= 0 || sayi(k.tahminiBirimFiyat) <= 0);
      if (eksikKalem >= 0) throw Error(`${eksikKalem + 1}. kalem için kart seçin, miktar ve sıfırdan büyük tahmini birim fiyat girin.`);
      const govde = {
        departmanId: form.departmanId || null,
        ihtiyacTarihi: form.ihtiyacTarihi,
        gerekce: form.gerekce,
        butceAnahtari: form.butceAnahtari,
        kalemler: form.kalemler.map((k) => ({ stokId: k.stokId, miktar: k.miktar, tahminiBirimFiyat: k.tahminiBirimFiyat })),
      };
      const sonuc = form.id
        ? await api<{ id: string }>(`/satin-alma/talepler/${form.id}`, { method: "PUT", body: JSON.stringify(govde) })
        : await api<{ id: string; no: string }>("/satin-alma/talepler", { method: "POST", body: JSON.stringify(govde) });
      setForm(null); setAktarim(null);
      const adres = new URL(window.location.href);
      for (const k of ["kaynak", "stokId", "depoId", "miktar", "birim", "ihtiyacTarihi"]) adres.searchParams.delete(k);
      adres.searchParams.set("talep", sonuc.id); window.history.replaceState(null, "", adres);
      await yenile(form.id ? "Talep güncellendi." : "Talep taslak olarak kaydedildi; onaya göndermeyi unutmayın.", sonuc.id);
    });
  }

  function aktarimiKapat() {
    aktarimSirasi.current++;
    setAktarim(null);
    const adres = new URL(window.location.href);
    for (const k of ["kaynak", "stokId", "depoId", "miktar", "birim", "ihtiyacTarihi"]) adres.searchParams.delete(k);
    window.history.replaceState(null, "", adres);
  }

  function talepDuzenle(d: TalepDetay) {
    aktarimiKapat();
    setForm({
      id: d.id,
      departmanId: d.departman?.id ?? "",
      ihtiyacTarihi: d.ihtiyacTarihi,
      gerekce: d.gerekce,
      butceAnahtari: d.butceAnahtari,
      kalemler: d.kalemler.map((k) => ({ stokId: k.stokId, miktar: String(Number(k.miktar)), tahminiBirimFiyat: String(Number(k.tahminiBirimFiyat)) })),
    });
  }

  /** Karar penceresinden çalışan durum eylemi; pencere başarıda kapanır. */
  function durumEylemi(yol: string, mesaj: string, govde?: (gerekce: string) => unknown) {
    if (!detay) return async () => undefined;
    const id = detay.id;
    return (gerekce: string) => calistir(async () => {
      await post(`/satin-alma/talepler/${id}/${yol}`, govde?.(gerekce));
      setKarar(null);
      await yenile(mesaj, id);
    });
  }

  /* ─── Teklif ──────────────────────────────────────────────────────────── */

  const teklifKur = teklif.dovizCinsi === "TRY" ? 1 : sayi(teklif.kur);
  const teklifToplami = detay ? detay.kalemler.reduce((t, k) => t + sayi(k.miktar) * sayi(teklif.fiyatlar[k.id]?.birimFiyat ?? ""), 0) : 0;
  const teklifToplamiTry = teklifToplami * teklifKur;
  const teklifEksik = !detay || !teklif.tedarikciCariId || detay.kalemler.some((k) => sayi(teklif.fiyatlar[k.id]?.birimFiyat ?? "") <= 0) || (teklif.dovizCinsi !== "TRY" && teklifKur <= 0);
  const sinir = detay?.yenidenOnaySiniri ? Number(detay.yenidenOnaySiniri) : null;

  function teklifGovdesi(d: TalepDetay) {
    return {
      tedarikciCariId: teklif.tedarikciCariId,
      dovizCinsi: teklif.dovizCinsi,
      kur: teklif.dovizCinsi === "TRY" ? "1" : teklif.kur,
      kalemler: d.kalemler.map((k) => ({ talepKalemiId: k.id, birimFiyat: teklif.fiyatlar[k.id]?.birimFiyat ?? "", kdvOrani: teklif.fiyatlar[k.id]?.kdvOrani || "20" })),
    };
  }

  function teklifPenceresiniAc(tur: "teklif" | "dogrudan") {
    setTeklif(bosTeklif());
    setTeklifDosyalari([]);
    setTeklifPenceresi(tur);
  }

  function teklifKaydet() {
    if (!detay || teklifEksik) return;
    const d = detay;
    void calistir(async () => {
      if (teklifPenceresi === "dogrudan") {
        const sonuc = await post<{ siparisBelgeId: string | null; yenidenOnay?: string | null }>(`/satin-alma/talepler/${d.id}/siparis`, { depoId: depoId || null, dogrudan: teklifGovdesi(d) });
        setTeklifPenceresi(null);
        await yenile(sonuc.yenidenOnay ? `Sipariş oluşturulmadı: ${sonuc.yenidenOnay}. Talep yeniden onaya gönderildi.` : "Taslak alış siparişi oluşturuldu; Belgeler ekranından kontrol edip onaylayın.", d.id);
        return;
      }
      const sonuc = await post<{ id: string }>(`/satin-alma/talepler/${d.id}/teklifler`, {
        ...teklifGovdesi(d),
        teslimSuresiGun: teklif.teslimSuresiGun === "" ? null : Number(teklif.teslimSuresiGun),
        gecerlilikTarihi: teklif.gecerlilikTarihi || null,
        aciklama: teklif.aciklama || null,
      });
      setTeklifPenceresi(null);
      try {
        if (teklifDosyalari.length) await belgeDosyalariniYukle("satin_alma_teklif", sonuc.id, teklifDosyalari);
      } catch (h) {
        // Teklif kaydedildi; yeniden kaydetmek mükerrer teklif açardı.
        await yenile("Teklif kaydedildi.", d.id);
        throw Error(`Teklif kaydedildi ama dosyalar yüklenemedi: ${h instanceof Error ? h.message : "bilinmeyen hata"}. Dosyaları teklifin Ekler bölümünden yeniden ekleyin.`);
      }
      await yenile("Teklif kaydedildi.", d.id);
    });
  }

  function teklifSecimi(t: Teklif) {
    if (!detay) return;
    const id = detay.id;
    const asim = sinir !== null && Number(t.toplamTry) > sinir;
    const sec = (gerekce: string) => calistir(async () => {
      const sonuc = await post<{ yenidenOnay?: string | null }>(`/satin-alma/teklifler/${t.id}/sec`, { gerekce: t.enDusuk ? undefined : gerekce });
      setKarar(null);
      await yenile(sonuc.yenidenOnay ? `${t.tedarikci.unvan} teklifi seçildi. ${sonuc.yenidenOnay}; talep onay bekleyenlere döndü.` : `${t.tedarikci.unvan} teklifi seçildi.`, id);
    });
    if (t.enDusuk && !asim) { void sec(""); return; }
    setKarar({
      baslik: `${t.tedarikci.unvan} teklifini seç`,
      icerik: (
        <>
          {asim && <Alert tone="warning">Bu teklif yeniden onay sınırını aşıyor. Seçerseniz talebin onayı kalkar ve talep tekrar onaya gider; sipariş ancak yeni onaydan sonra verilebilir.</Alert>}
          {!t.enDusuk && <p className="muted" style={{ margin: 0 }}>Bu teklif en düşük TL toplamlı teklif değil. Seçim gerekçesi geçmişe ve talep kaydına yazılır.</p>}
        </>
      ),
      gerekcesiz: t.enDusuk,
      gerekceEtiketi: "Neden bu teklif?",
      enAzGerekce: t.enDusuk ? undefined : 5,
      onayMetni: asim ? "Seç ve yeniden onaya gönder" : "Teklifi seç",
      calistir: sec,
    });
  }

  function teklifSil(t: Teklif) {
    if (!detay) return;
    const id = detay.id;
    setKarar({
      baslik: "Teklifi sil",
      aciklama: `${t.tedarikci.unvan} teklifi ve ekleri talepten kaldırılır.`,
      gerekcesiz: true,
      onayMetni: "Teklifi sil",
      tehlikeli: true,
      calistir: () => calistir(async () => {
        await api(`/satin-alma/teklifler/${t.id}`, { method: "DELETE" });
        setKarar(null);
        await yenile("Teklif silindi.", id);
      }),
    });
  }

  async function ekleriAc(teklifId: string) {
    if (ekAcik === teklifId) {
      setEkAcik(null);
      return;
    }
    setEkAcik(teklifId);
    try {
      setEkler(await api<KayitliEk[]>(`/ekler?sahipTur=satin_alma_teklif&sahipId=${teklifId}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Teklif ekleri yüklenemedi");
    }
  }

  function siparisOlustur() {
    if (!detay) return;
    const d = detay;
    void calistir(async () => {
      const sonuc = await post<{ siparisBelgeId: string | null; yenidenOnay?: string | null }>(`/satin-alma/talepler/${d.id}/siparis`, { depoId: depoId || null });
      await yenile(sonuc.yenidenOnay ? `Sipariş oluşturulmadı: ${sonuc.yenidenOnay}. Talep yeniden onaya gönderildi.` : "Taslak alış siparişi oluşturuldu; Belgeler ekranından kontrol edip onaylayın.", d.id);
    });
  }

  /* ─── Kararlar ────────────────────────────────────────────────────────── */

  function onayPenceresi(d: TalepDetay) {
    const asim = d.butce?.asim > 0;
    setKarar({
      baslik: `${d.no} talebini onayla`,
      icerik: (
        <dl className="sat-ozet">
          <div><dt>Onaylanacak tutar</dt><dd><Para deger={d.etkinTutar} /></dd></div>
          <div><dt>Talep eden</dt><dd>{d.talepEden.adSoyad}</dd></div>
          {d.yenidenOnayNedeni && <div className="sat-ozet__genis"><dt>Yeniden onay nedeni</dt><dd>{d.yenidenOnayNedeni}</dd></div>}
          {asim && <div className="sat-ozet__genis"><dt>Bütçe</dt><dd className="sat-kotu">Bu talep {String(d.butce.ay).padStart(2, "0")}/{d.butce.yil} bütçesini <Para deger={d.butce.asim} /> aşıyor.</dd></div>}
        </dl>
      ),
      gerekceEtiketi: asim ? "Bütçe aşımı gerekçesi" : undefined,
      enAzGerekce: asim ? 5 : undefined,
      gerekcesiz: !asim,
      onayMetni: "Onayla",
      calistir: durumEylemi("onayla", "Talep onaylandı.", (g) => ({ butceAsimGerekcesi: g || undefined })),
    });
  }

  function redPenceresi(d: TalepDetay) {
    setKarar({
      baslik: `${d.no} talebini reddet`,
      aciklama: "Red gerekçesi talep edene gösterilir.",
      gerekceEtiketi: "Red gerekçesi",
      enAzGerekce: 5,
      onayMetni: "Reddet",
      tehlikeli: true,
      calistir: durumEylemi("reddet", "Talep reddedildi.", (g) => ({ gerekce: g })),
    });
  }

  function iptalPenceresi(d: TalepDetay) {
    setKarar({
      baslik: `${d.no} talebini iptal et`,
      aciklama: "İptal edilen talep yeniden açılamaz.",
      onayMetni: "Talebi iptal et",
      tehlikeli: true,
      calistir: durumEylemi("iptal", "Talep iptal edildi.", (g) => ({ gerekce: g || undefined })),
    });
  }

  const kapsamlar: { deger: Kapsam; baslik: string }[] = [
    ...(secenekler?.yetkiler.talepAcabilir ? [{ deger: "benim" as const, baslik: "Taleplerim" }] : []),
    ...(secenekler?.yetkiler.tumunuGorur ? [{ deger: "onay" as const, baslik: "Onayımda" }, { deger: "tum" as const, baslik: "Tümü" }] : []),
  ];

  const seciliTeklif = detay?.teklifler.find((t) => t.secildi) ?? null;
  const sagPanelAcik = !!(detay || form);
  const enYuksekTeklif = detay ? Math.max(sinir ?? 0, ...detay.teklifler.map((t) => Number(t.toplamTry))) : 0;

  return (
    <div className="stack">
      <PageHeader
        title="Satın Alma Talepleri"
        subtitle={secenekler ? <>Onay eşiği <Para deger={secenekler.onayEsigi} />: eşiğe kadar muhasebe, üstünü yönetici onaylar. Onaydan sonra seçilen teklif onaylanan tutarı %10&apos;dan fazla aşarsa talep yeniden onaya gider.</> : "Talep, onay, teklif ve alış siparişi."}
        actions={secenekler?.yetkiler.talepAcabilir ? <Button disabled={islemde} variant="primary" onClick={() => { setDetay(null); aktarimiKapat(); setForm(bosTalep()); }}>Yeni talep</Button> : undefined}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className={`sat-yerlesim${sagPanelAcik ? " is-sag-acik" : ""}`}>
        {/* ─── Liste ─────────────────────────────────────────────────── */}
        <section className="sat-liste card" aria-label="Talep listesi">
          {kapsamlar.length > 1 && <Tabs items={kapsamlar} value={kapsam} onChange={kapsamDegistir} ariaLabel="Talep listeleri" />}
          <div className="sat-liste__suzgec">
            <SearchInput aria-label="Taleplerde ara" placeholder="No, gerekçe ya da kişi" value={arama} onChange={(e) => setArama(e.target.value)} />
            <Select aria-label="Durum" value={durumSuzgeci} onChange={(e) => setDurumSuzgeci(e.target.value as DurumSuzgeci)}>
              <option value="hepsi">Tüm durumlar</option>
              <option value="acik">Açık talepler</option>
              {(Object.keys(DURUM) as Durum[]).map((d) => <option key={d} value={d}>{DURUM[d].ad}</option>)}
            </Select>
          </div>
          {liste.length >= LISTE_SINIRI && <p className="sat-liste__not">Son {LISTE_SINIRI} talep gösteriliyor; daha eskisini aramayla bulamazsınız.</p>}
          <ul className="sat-liste__ogeler">
            {!listeYuklendi ? <li className="sat-liste__bos">Yükleniyor…</li>
              : suzulmus.length === 0 ? (
                <li className="sat-liste__bos">
                  {liste.length > 0 ? "Bu süzgece uyan talep yok." : kapsam === "onay" ? "Onayınızı bekleyen talep yok." : "Henüz talep yok."}
                  {liste.length === 0 && kapsam === "benim" && secenekler?.yetkiler.talepAcabilir && <><br />İlk talebinizi <strong>Yeni talep</strong> ile açın.</>}
                </li>
              ) : suzulmus.map((t) => (
                <li key={t.id}>
                  <button type="button" className={`sat-satir${detay?.id === t.id ? " is-secili" : ""}`} aria-current={detay?.id === t.id || undefined} onClick={() => talepSec(t.id)}>
                    <span className="sat-satir__ust">
                      <span className="sat-satir__no">{t.no}</span>
                      <Badge variant={DURUM[t.durum].ton}>{t.yenidenOnay ? "Yeniden onay" : DURUM[t.durum].ad}</Badge>
                    </span>
                    <span className="sat-satir__gerekce">{t.gerekce}</span>
                    <span className="sat-satir__alt">
                      <span>{t.talepEden}{t.departman ? `, ${t.departman}` : ""}</span>
                      <Para deger={t.etkinTutar} />
                    </span>
                    {t.durum === "onay_bekliyor" && t.onaylayabilecekRoller.length > 0 && (
                      <span className="sat-satir__not">Onaylayabilir: {t.onaylayabilecekRoller.map((r) => ROL_ADI[r] ?? r).join(" ya da ")}</span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        </section>

        {/* ─── Sağ panel: form ya da ayrıntı ─────────────────────────── */}
        <div className="sat-panel">
          {sagPanelAcik && <Button size="sm" className="sat-geri" onClick={listeyeDon}>Talepler listesine dön</Button>}

          {form && secenekler && (
            <Card title={form.id ? "Talebi düzenle" : "Yeni satın alma talebi"}>
              {aktarim && <div className="stack" style={{ marginBottom: "1rem" }}><Alert tone="warning">Eksik miktar {aktarim.sonuc.depo.ad} deposundan, ana birimde aktarıldı. Bu form stok ayırmaz; taslak kaydından sonra onaya gönderilmelidir.</Alert><div><Button disabled={islemde} onClick={() => void calistir(async () => {
                const sonuc = await api<IhtiyacSonucu>(ihtiyacSorgusu(aktarim.girdi), { cache: "no-store" });
                const yeni = ihtiyactanTalep(sonuc);
                setForm({ ...yeni, departmanId: form.departmanId, butceAnahtari: form.butceAnahtari, kalemler: [{ ...yeni.kalemler[0], tahminiBirimFiyat: form.kalemler[0]?.tahminiBirimFiyat ?? "" }] });
                setAktarim({ ...aktarim, sonuc }); setBasari("İhtiyaç güncellendi. Miktarı kontrol edip taslağı kaydedebilirsiniz.");
              })}>İhtiyacı yeniden yükle</Button></div></div>}
              <div className="form-grid form-grid--2">
                <Field label="Gerekçe" className="sat-tam"><Input disabled={islemde} value={form.gerekce} onChange={(e) => setForm({ ...form, gerekce: e.target.value })} placeholder="Neden gerekli, nerede kullanılacak?" /></Field>
                <Field label="İhtiyaç tarihi"><Input disabled={!!aktarim || islemde} type="date" value={form.ihtiyacTarihi} onChange={(e) => setForm({ ...form, ihtiyacTarihi: e.target.value })} /></Field>
                <Field label="Bütçe kalemi">
                  <Select disabled={islemde} value={form.butceAnahtari} onChange={(e) => setForm({ ...form, butceAnahtari: e.target.value })}>
                    {aktarim && <option value="">Bütçe kalemi seçin</option>}
                    {secenekler.butceKalemleri.map((k) => <option key={k.anahtar} value={k.anahtar}>{k.ad}</option>)}
                  </Select>
                </Field>
                <Field label="Departman (isteğe bağlı)">
                  <Select disabled={islemde} value={form.departmanId} onChange={(e) => setForm({ ...form, departmanId: e.target.value })}>
                    <option value="">Seçilmedi</option>
                    {secenekler.departmanlar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}
                  </Select>
                </Field>
              </div>
              <h3 className="sat-alt-baslik">Kalemler</h3>
              <TableWrap>
                <thead><tr><th>Stok / hizmet kartı</th><th className="num">Miktar</th><th className="num">Tahmini birim fiyat (TL, KDV hariç)</th><th className="num">Tutar</th><th /></tr></thead>
                <tbody>
                  {form.kalemler.map((k, i) => {
                    const stok = secenekler.stoklar.find((s) => s.id === k.stokId);
                    const kalemGuncelle = (yeni: Partial<KalemFormu>) => setForm({ ...form, kalemler: form.kalemler.map((x, j) => (j === i ? { ...x, ...yeni } : x)) });
                    return (
                      <tr key={i}>
                        <td style={{ minWidth: 240 }}>
                          {aktarim || islemde ? <Input aria-label={`${i + 1}. kalem kartı`} readOnly value={stok ? `${stok.kod} — ${stok.ad}` : k.stokId} /> : <AramaSecici
                            ariaLabel={`${i + 1}. kalem kartı`}
                            deger={k.stokId}
                            secenekler={stokSecenekleri}
                            onChange={(stokId) => {
                              const secilen = secenekler.stoklar.find((s) => s.id === stokId);
                              kalemGuncelle({ stokId, tahminiBirimFiyat: k.tahminiBirimFiyat || (secilen?.alisFiyati ? String(Number(secilen.alisFiyati)) : "") });
                            }}
                          />}
                        </td>
                        <td className="num"><span className="sat-miktar"><Input aria-label={`${i + 1}. kalem miktarı`} disabled={!!aktarim || islemde} type="number" min="0" step="0.001" value={k.miktar} onChange={(e) => kalemGuncelle({ miktar: e.target.value })} /> <small className="muted">{stok?.anaBirim}</small></span></td>
                        <td className="num"><Input aria-label={`${i + 1}. kalem tahmini birim fiyatı`} disabled={islemde} type="number" min="0" step="0.0001" value={k.tahminiBirimFiyat} onChange={(e) => kalemGuncelle({ tahminiBirimFiyat: e.target.value })} style={{ maxWidth: 140 }} /></td>
                        <td className="num"><Para deger={sayi(k.miktar) * sayi(k.tahminiBirimFiyat)} /></td>
                        <td><Button size="sm" variant="ghost" aria-label={`${i + 1}. kalemi kaldır`} disabled={!!aktarim || islemde || form.kalemler.length === 1} onClick={() => setForm({ ...form, kalemler: form.kalemler.filter((_, j) => j !== i) })}>Kaldır</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              <div className="between sat-form-alt">
                <Button disabled={!!aktarim || islemde} size="sm" onClick={() => setForm({ ...form, kalemler: [...form.kalemler, { stokId: "", miktar: "1", tahminiBirimFiyat: "" }] })}>Kalem ekle</Button>
                <span>Tahmini toplam <strong><Para deger={form.kalemler.reduce((t, k) => t + sayi(k.miktar) * sayi(k.tahminiBirimFiyat), 0)} /></strong></span>
              </div>
              <div className="row-tight">
                <Button variant="primary" disabled={islemde} onClick={talepKaydet}>{form.id ? "Kaydet" : "Taslak kaydet"}</Button>
                <Button variant="ghost" disabled={islemde} onClick={() => { setForm(null); aktarimiKapat(); }}>Vazgeç</Button>
              </div>
            </Card>
          )}

          {!form && detay && (
            <article className="sat-detay card">
              <header className="sat-detay__bas">
                <div>
                  <h2 className="sat-detay__no">{detay.no}</h2>
                  <p className="sat-detay__gerekce">{detay.gerekce}</p>
                </div>
                <Badge variant={DURUM[detay.durum].ton}>{detay.yenidenOnayNedeni ? "Yeniden onay bekliyor" : DURUM[detay.durum].ad}</Badge>
              </header>

              <AkisGostergesi durum={detay.durum} yenidenOnay={!!detay.yenidenOnayNedeni} />

              {(detay.yetkiler.duzenle || detay.yetkiler.gonder || detay.yetkiler.geriCek || detay.yetkiler.onayla || detay.yetkiler.iptal) && (
                <EylemCubugu etiket="Talep işlemleri">
                  {detay.yetkiler.onayla && <Button variant="primary" disabled={islemde} onClick={() => onayPenceresi(detay)}>Onayla</Button>}
                  {detay.yetkiler.onayla && <Button variant="danger" disabled={islemde} onClick={() => redPenceresi(detay)}>Reddet</Button>}
                  {detay.yetkiler.gonder && <Button variant="primary" disabled={islemde} onClick={() => void calistir(async () => { await post(`/satin-alma/talepler/${detay.id}/gonder`); await yenile("Talep onaya gönderildi.", detay.id); })}>Onaya gönder</Button>}
                  {detay.yetkiler.duzenle && <Button disabled={islemde} onClick={() => talepDuzenle(detay)}>Düzenle</Button>}
                  {detay.yetkiler.geriCek && <Button disabled={islemde} onClick={() => void calistir(async () => { await post(`/satin-alma/talepler/${detay.id}/geri-cek`); await yenile("Talep taslağa geri çekildi.", detay.id); })}>Geri çek</Button>}
                  {detay.yetkiler.iptal && <Button variant="ghost" disabled={islemde} onClick={() => iptalPenceresi(detay)}>İptal et</Button>}
                </EylemCubugu>
              )}

              {detay.durum === "onay_bekliyor" && detay.onayEngeli && <p className="sat-not">{detay.onayEngeli}</p>}
              {detay.yenidenOnayNedeni && <Alert tone="warning">{detay.yenidenOnayNedeni}. Önceki onay kaldırıldı; sipariş yeni onaydan sonra verilebilir.</Alert>}
              {detay.redGerekcesi && <Alert tone="error">Red gerekçesi: {detay.redGerekcesi}</Alert>}

              <StatGrid>
                <Stat label={seciliTeklif ? "Seçili teklif" : "Tahmini tutar"} value={<Para deger={detay.etkinTutar} />} hint="KDV hariç" />
                {detay.onaylananTutar && <Stat label="Onaylanan tutar" value={<Para deger={detay.onaylananTutar} />} hint={detay.yenidenOnaySiniri ? <>Yeniden onay sınırı <Para deger={detay.yenidenOnaySiniri} /></> : detay.onaylayan ? `Onaylayan: ${detay.onaylayan}` : undefined} />}
                <ButceKarti butce={detay.butce} />
              </StatGrid>

              <dl className="sat-ozet">
                <div><dt>Talep eden</dt><dd>{detay.talepEden.adSoyad}{detay.departman ? `, ${detay.departman.ad}` : ""}</dd></div>
                <div><dt>İhtiyaç tarihi</dt><dd><Tarih deger={detay.ihtiyacTarihi} /></dd></div>
                <div><dt>Bütçe kalemi</dt><dd>{detay.butceKalemi}</dd></div>
                {detay.onaylayan && <div><dt>{detay.durum === "reddedildi" ? "Reddeden" : "Onaylayan"}</dt><dd>{detay.onaylayan}{detay.onayZamani && <span className="subtle">, <Tarih deger={detay.onayZamani} saatli /></span>}</dd></div>}
                {detay.siparisBelge && <div><dt>Alış siparişi</dt><dd><a className="btn-link" href={`/panel/belgeler?yon=alis&tur=siparis&odak=${detay.siparisBelge.id}`}>{detay.siparisBelge.no ?? "Taslak sipariş"}</a></dd></div>}
                {detay.butceAsimGerekcesi && <div className="sat-ozet__genis"><dt>Bütçe aşımı gerekçesi</dt><dd>{detay.butceAsimGerekcesi}</dd></div>}
              </dl>

              <section>
                <h3 className="sat-alt-baslik">Kalemler</h3>
                <TableWrap>
                  <thead><tr><th>Kart</th><th className="num">Miktar</th><th className="num">Tahmini birim fiyat</th><th className="num">Tahmini tutar</th></tr></thead>
                  <tbody>{detay.kalemler.map((k) => <tr key={k.id}><td>{k.stokKod} — {k.stokAd}</td><td className="num">{Number(k.miktar).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {k.birim}</td><td className="num"><Para deger={k.tahminiBirimFiyat} basamak={4} /></td><td className="num"><Para deger={k.tutar} /></td></tr>)}</tbody>
                </TableWrap>
              </section>

              {(detay.teklifler.length > 0 || detay.yetkiler.teklifYonet) && (
                <section className="stack">
                  <div className="between">
                    <h3 className="sat-alt-baslik" style={{ margin: 0 }}>Teklifler</h3>
                    {detay.yetkiler.teklifYonet && <Button size="sm" disabled={islemde} onClick={() => teklifPenceresiniAc("teklif")}>Teklif ekle</Button>}
                  </div>
                  {detay.teklifler.length === 0 ? (
                    <p className="subtle">Henüz teklif girilmedi. Tedarikçilerden aldığınız teklifleri ekleyip karşılaştırın ya da tek tedarikçiyle doğrudan sipariş verin.</p>
                  ) : (<>
                    <TableWrap className="sat-teklif-tablosu">
                      <thead>
                        <tr>
                          <th>Kalem</th>
                          {detay.teklifler.map((t) => (
                            <th key={t.id} className={`num${t.secildi ? " sat-secili-sutun" : ""}`}>
                              <span className="sat-teklif-baslik">
                                <span>{t.tedarikci.unvan}</span>
                                <span className="row-tight" style={{ justifyContent: "flex-end", gap: ".25rem" }}>
                                  {t.secildi && <Badge variant="info">Seçili</Badge>}
                                  {t.enDusuk && <Badge variant="success">En düşük</Badge>}
                                  {t.suresiDoldu && <Badge variant="danger">Süresi doldu</Badge>}
                                </span>
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detay.kalemler.map((k) => (
                          <tr key={k.id}>
                            <td>{k.stokKod} <span className="subtle">{Number(k.miktar).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {k.birim}</span></td>
                            {detay.teklifler.map((t) => {
                              const f = t.kalemler.find((x) => x.talepKalemiId === k.id);
                              return <td key={t.id} className={`num${t.secildi ? " sat-secili-sutun" : ""}`}>{f ? <><Para deger={f.birimFiyat} dovizCinsi={t.dovizCinsi} basamak={4} /><br /><small className="subtle">KDV %{Number(f.kdvOrani).toLocaleString("tr-TR")}</small></> : "—"}</td>;
                            })}
                          </tr>
                        ))}
                        <tr className="sat-toplam-satiri">
                          <td>Toplam (KDV hariç)</td>
                          {detay.teklifler.map((t) => (
                            <td key={t.id} className={`num${t.secildi ? " sat-secili-sutun" : ""}`}>
                              <strong><Para deger={t.toplam} dovizCinsi={t.dovizCinsi} /></strong>
                              {t.dovizCinsi !== "TRY" && <><br /><small className="subtle"><Para deger={t.toplamTry} />, kur {t.kur}</small></>}
                            </td>
                          ))}
                        </tr>
                        {sinir !== null && (
                          <tr>
                            <td>Yeniden onay sınırına göre</td>
                            {detay.teklifler.map((t) => <td key={t.id} className={t.secildi ? "sat-secili-sutun" : undefined}><TutarCubugu tutar={Number(t.toplamTry)} sinir={sinir} olcek={enYuksekTeklif * 1.05} /></td>)}
                          </tr>
                        )}
                        <tr>
                          <td>Teslim süresi</td>
                          {detay.teklifler.map((t) => <td key={t.id} className={`num${t.secildi ? " sat-secili-sutun" : ""}`}>{t.teslimSuresiGun != null ? `${t.teslimSuresiGun} gün` : "—"}</td>)}
                        </tr>
                        <tr>
                          <td>Geçerlilik</td>
                          {detay.teklifler.map((t) => <td key={t.id} className={`num${t.secildi ? " sat-secili-sutun" : ""}`}>{t.gecerlilikTarihi ? <Tarih deger={t.gecerlilikTarihi} /> : "—"}</td>)}
                        </tr>
                        <tr>
                          <td />
                          {detay.teklifler.map((t) => (
                            <td key={t.id} className={`num${t.secildi ? " sat-secili-sutun" : ""}`}>
                              <span className="row-tight" style={{ justifyContent: "flex-end" }}>
                                {detay.yetkiler.teklifYonet && !t.secildi && <Button size="sm" variant="primary" disabled={islemde || t.suresiDoldu} title={t.suresiDoldu ? "Süresi dolmuş teklif seçilemez" : undefined} onClick={() => teklifSecimi(t)}>Seç</Button>}
                                <Button size="sm" aria-expanded={ekAcik === t.id} onClick={() => void ekleriAc(t.id)}>Ekler</Button>
                                {detay.yetkiler.teklifYonet && <Button size="sm" variant="ghost" disabled={islemde} onClick={() => teklifSil(t)}>Sil</Button>}
                              </span>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </TableWrap>
                    <ul className="sat-teklif-kartlari" aria-label="Teklifler">
                      {detay.teklifler.map((t) => (
                        <li key={t.id} className={`sat-teklif-karti${t.secildi ? " is-secili" : ""}`}>
                          <div className="sat-teklif-karti__bas">
                            <strong>{t.tedarikci.unvan}</strong>
                            <span className="row-tight" style={{ gap: ".25rem", justifyContent: "flex-end" }}>
                              {t.secildi && <Badge variant="info">Seçili</Badge>}
                              {t.enDusuk && <Badge variant="success">En düşük</Badge>}
                              {t.suresiDoldu && <Badge variant="danger">Süresi doldu</Badge>}
                            </span>
                          </div>
                          <div>
                            <span className="sat-teklif-karti__toplam"><Para deger={t.toplam} dovizCinsi={t.dovizCinsi} /></span>
                            <small className="subtle"> KDV hariç{t.dovizCinsi !== "TRY" && <>, <Para deger={t.toplamTry} /></>}</small>
                          </div>
                          {sinir !== null && <TutarCubugu tutar={Number(t.toplamTry)} sinir={sinir} olcek={enYuksekTeklif * 1.05} />}
                          <dl>
                            {detay.kalemler.map((k) => {
                              const f = t.kalemler.find((x) => x.talepKalemiId === k.id);
                              return <div key={k.id}><dt>{k.stokKod}</dt><dd>{f ? <Para deger={f.birimFiyat} dovizCinsi={t.dovizCinsi} basamak={4} /> : "—"}</dd></div>;
                            })}
                            <div><dt>Teslim süresi</dt><dd>{t.teslimSuresiGun != null ? `${t.teslimSuresiGun} gün` : "—"}</dd></div>
                            <div><dt>Geçerlilik</dt><dd>{t.gecerlilikTarihi ? <Tarih deger={t.gecerlilikTarihi} /> : "—"}</dd></div>
                          </dl>
                          <span className="row-tight">
                            {detay.yetkiler.teklifYonet && !t.secildi && <Button size="sm" variant="primary" disabled={islemde || t.suresiDoldu} onClick={() => teklifSecimi(t)}>Seç</Button>}
                            <Button size="sm" aria-expanded={ekAcik === t.id} onClick={() => void ekleriAc(t.id)}>Ekler</Button>
                            {detay.yetkiler.teklifYonet && <Button size="sm" variant="ghost" disabled={islemde} onClick={() => teklifSil(t)}>Sil</Button>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>)}
                  {detay.teklifSecimGerekcesi && <p className="sat-not">Teklif seçim gerekçesi: {detay.teklifSecimGerekcesi}</p>}
                  {ekAcik && (
                    <div className="document-attachments__saved">
                      <h4>{detay.teklifler.find((t) => t.id === ekAcik)?.tedarikci.unvan ?? "Teklif"} ekleri</h4>
                      {ekler.length === 0 ? <p className="muted">Bu teklife dosya eklenmemiş.</p> : ekler.map((ek) => <KayitliEkSatiri ek={ek} key={ek.id} onSil={() => undefined} />)}
                    </div>
                  )}
                </section>
              )}

              {detay.yetkiler.siparis && (
                <section className="sat-siparis">
                  <h3 className="sat-alt-baslik">Alış siparişi</h3>
                  <div className="form-grid form-grid--2"><DepoSecici deger={depoId} onChange={setDepoId} label="Teslim alınacak depo" /></div>
                  <div className="row-tight">
                    {seciliTeklif ? (
                      <Button variant="primary" disabled={islemde || seciliTeklif.suresiDoldu} onClick={siparisOlustur}>{seciliTeklif.tedarikci.unvan} teklifinden sipariş oluştur</Button>
                    ) : detay.teklifler.length > 0 ? (
                      <p className="subtle" style={{ margin: 0 }}>Sipariş için karşılaştırmadan bir teklif seçin.</p>
                    ) : (
                      <Button disabled={islemde} onClick={() => teklifPenceresiniAc("dogrudan")}>Teklif girmeden doğrudan sipariş ver</Button>
                    )}
                  </div>
                  {seciliTeklif?.suresiDoldu && <p className="sat-not">Seçili teklifin süresi dolmuş. Tedarikçiden güncel teklif alıp ekleyin ve onu seçin.</p>}
                </section>
              )}

              <section>
                <h3 className="sat-alt-baslik">Geçmiş</h3>
                <Gecmis olaylar={detay.olaylar} />
              </section>
            </article>
          )}

          {!sagPanelAcik && (
            <div className="sat-bos-panel">
              <p><strong>Ayrıntısını görmek için listeden bir talep seçin.</strong></p>
              <p className="muted">Talep onaylandıktan sonra teklifler girilir ve seçilen tekliften alış siparişi oluşturulur.</p>
            </div>
          )}
        </div>
      </div>

      {karar && <KararPenceresi karar={karar} isleniyor={islemde} onKapat={() => !islemde && setKarar(null)} />}

      {teklifPenceresi && detay && (
        <Modal
          genis
          baslik={teklifPenceresi === "dogrudan" ? "Doğrudan sipariş" : "Teklif ekle"}
          aciklama={teklifPenceresi === "dogrudan" ? "Tedarikçi ve fiyatlar teklif olarak kaydedilir, ardından taslak alış siparişi oluşturulur." : "Tedarikçiden aldığınız fiyatları KDV hariç girin. Tüm kalemlere fiyat verilmelidir."}
          onKapat={() => !islemde && setTeklifPenceresi(null)}
        >
          <div className="stack">
            <div className="form-grid form-grid--2">
              <Field label="Tedarikçi" className="sat-tam"><AramaSecici ariaLabel="Tedarikçi" deger={teklif.tedarikciCariId} secenekler={tedarikciSecenekleri} onChange={(v) => setTeklif({ ...teklif, tedarikciCariId: v })} /></Field>
              <Field label="Döviz">
                <Select value={teklif.dovizCinsi} onChange={(e) => setTeklif({ ...teklif, dovizCinsi: e.target.value, kur: e.target.value === "TRY" ? "1" : "" })}>
                  <DovizSecenekleri />
                </Select>
              </Field>
              {teklif.dovizCinsi !== "TRY" ? <Field label="Kur (teklif tarihindeki)"><Input type="number" min="0" step="0.0001" value={teklif.kur} onChange={(e) => setTeklif({ ...teklif, kur: e.target.value })} /></Field> : <span />}
              {teklifPenceresi === "teklif" && <>
                <Field label="Teslim süresi (gün)"><Input type="number" min="0" value={teklif.teslimSuresiGun} onChange={(e) => setTeklif({ ...teklif, teslimSuresiGun: e.target.value })} /></Field>
                <Field label="Geçerlilik tarihi"><Input type="date" min={bugun()} value={teklif.gecerlilikTarihi} onChange={(e) => setTeklif({ ...teklif, gecerlilikTarihi: e.target.value })} /></Field>
                <Field label="Not" className="sat-tam"><Input value={teklif.aciklama} onChange={(e) => setTeklif({ ...teklif, aciklama: e.target.value })} /></Field>
              </>}
            </div>
            <TableWrap>
              <thead><tr><th>Kalem</th><th className="num">Birim fiyat ({teklif.dovizCinsi}, KDV hariç)</th><th className="num">KDV %</th><th className="num">Tutar</th></tr></thead>
              <tbody>
                {detay.kalemler.map((k) => {
                  const f = teklif.fiyatlar[k.id] ?? { birimFiyat: "", kdvOrani: "20" };
                  const fiyatGuncelle = (yeni: Partial<typeof f>) => setTeklif({ ...teklif, fiyatlar: { ...teklif.fiyatlar, [k.id]: { ...f, ...yeni } } });
                  return (
                    <tr key={k.id}>
                      <td>{k.stokKod} — {k.stokAd}<br /><small className="subtle">{Number(k.miktar).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {k.birim}, tahmini <Para deger={k.tahminiBirimFiyat} basamak={4} /></small></td>
                      <td className="num"><Input aria-label={`${k.stokKod} birim fiyatı`} type="number" min="0" step="0.0001" required value={f.birimFiyat} onChange={(e) => fiyatGuncelle({ birimFiyat: e.target.value })} style={{ maxWidth: 150 }} /></td>
                      <td className="num"><KdvOraniSecimi aria-label={`${k.stokKod} KDV oranı`} tablo={kodTablosu} value={f.kdvOrani} onDegis={(o) => fiyatGuncelle({ kdvOrani: o })} style={{ maxWidth: 110 }} /></td>
                      <td className="num"><Para deger={sayi(k.miktar) * sayi(f.birimFiyat)} dovizCinsi={teklif.dovizCinsi} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            <div className="sat-teklif-ozet">
              <span>Toplam (KDV hariç) <strong><Para deger={teklifToplami} dovizCinsi={teklif.dovizCinsi} /></strong>{teklif.dovizCinsi !== "TRY" && teklifKur > 0 && <span className="muted">, TL karşılığı <Para deger={teklifToplamiTry} /></span>}</span>
              {sinir !== null && teklifToplami > 0 && <TutarCubugu tutar={teklifToplamiTry} sinir={sinir} olcek={Math.max(sinir, teklifToplamiTry) * 1.05} />}
            </div>
            {sinir !== null && teklifToplamiTry > sinir && (
              <Alert tone="warning">
                {teklifPenceresi === "dogrudan"
                  ? "Bu tutar yeniden onay sınırını aşıyor. Sipariş oluşturulmaz; teklif kaydedilir ve talep yeniden onaya gider."
                  : "Bu tutar yeniden onay sınırını aşıyor. Teklifi kaydedebilirsiniz; ancak seçilirse talep yeniden onaya gider."}
              </Alert>
            )}
            {teklifPenceresi === "teklif" && <BelgeDosyalari dosyalar={teklifDosyalari} onChange={setTeklifDosyalari} />}
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <Button onClick={() => setTeklifPenceresi(null)} disabled={islemde}>Vazgeç</Button>
              <Button variant="primary" disabled={islemde || teklifEksik} onClick={teklifKaydet}>
                {islemde ? "İşleniyor…" : teklifPenceresi === "dogrudan" ? "Siparişi oluştur" : "Teklifi kaydet"}
              </Button>
            </div>
            {teklifEksik && <p className="subtle" style={{ margin: 0, textAlign: "right" }}>Kaydetmek için tedarikçi seçin ve her kaleme sıfırdan büyük birim fiyat girin.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Bütçe kartı: kalan tutar ve bu talep dahil doluluk. */
function ButceKarti({ butce }: { butce: TalepDetay["butce"] }) {
  if (!butce?.tanimli) return <Stat label="Bütçe" value="Tanımsız" hint="Bu yıl için onaylı bütçe yok; aşım kontrolü yapılamıyor." />;
  const kullanilan = butce.gerceklesen + butce.digerTalepler + butce.talep;
  const doluluk = butce.butce > 0 ? Math.min(100, (kullanilan / butce.butce) * 100) : 100;
  const ay = `${String(butce.ay).padStart(2, "0")}/${butce.yil}`;
  return (
    <div className="stat">
      <p className="stat__label">Bütçe kalanı, {ay}</p>
      <p className={`stat__value${butce.asim > 0 ? " is-danger" : ""}`}><Para deger={butce.kalan} /></p>
      <div className={`meter sat-butce-olcer${butce.asim > 0 ? " is-asim" : ""}`} role="img" aria-label={`Bütçenin yüzde ${Math.round(doluluk)} kadarı bu talep dahil kullanılıyor`}><span style={{ width: `${doluluk}%` }} /></div>
      <p className="stat__hint">{butce.asim > 0 ? <>Bu talep bütçeyi <Para deger={butce.asim} /> aşıyor</> : <>Bütçe <Para deger={butce.butce} />, gerçekleşen <Para deger={butce.gerceklesen} />, diğer onaylı talepler <Para deger={butce.digerTalepler} /></>}</p>
    </div>
  );
}
