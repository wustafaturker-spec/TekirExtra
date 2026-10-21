"use client";

import { useEkranKaydi } from "@/lib/asistan-baglami";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ihtiyacGirdisiOku, ihtiyacKaniti, ihtiyacSorgusu, ihtiyactanTalep, type IhtiyacGirdisi, type IhtiyacSonucu } from "@/lib/ihtiyac-talep";
import { AramaSecici } from "@/components/arama-secici";
import { BelgeDosyalari, belgeDosyalariniYukle, KayitliEkSatiri, type KayitliEk } from "@/components/belge-dosyalari";
import { DepoSecici } from "@/components/depo-secici";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap, Tabs } from "@/components/ui";
import { gunEkleTR } from "@tekirextra/shared";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
import { KdvOraniSecimi, useKodTablosu } from "@/components/kdv-orani-secimi";

type Durum = "taslak" | "onay_bekliyor" | "onaylandi" | "reddedildi" | "siparise_donustu" | "iptal";
type Kapsam = "benim" | "onay" | "tum";

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

const DURUM: Record<Durum, { ad: string; ton: "neutral" | "info" | "success" | "danger" | "warning" }> = {
  taslak: { ad: "Taslak", ton: "neutral" },
  onay_bekliyor: { ad: "Onay bekliyor", ton: "warning" },
  onaylandi: { ad: "Onaylandı", ton: "info" },
  reddedildi: { ad: "Reddedildi", ton: "danger" },
  siparise_donustu: { ad: "Siparişe dönüştü", ton: "success" },
  iptal: { ad: "İptal", ton: "neutral" },
};

const OLAY_ADI: Record<string, string> = {
  olusturuldu: "Oluşturuldu", guncellendi: "Güncellendi", onaya_gonderildi: "Onaya gönderildi", geri_cekildi: "Geri çekildi",
  onaylandi: "Onaylandı", reddedildi: "Reddedildi", iptal_edildi: "İptal edildi", teklif_eklendi: "Teklif eklendi",
  teklif_silindi: "Teklif silindi", teklif_secildi: "Teklif seçildi", siparise_donustu: "Siparişe dönüştü",
};

const ROL_ADI: Record<string, string> = { muhasebe: "Muhasebe", yonetici: "Yönetici" };

const tl = (v: string | number) => Number(v).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const sayi = (v: string, basamak = 2) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: basamak });
const gunSonra = (gun: number) => gunEkleTR(gun);
const bosTalep = (): TalepFormu => ({ departmanId: "", ihtiyacTarihi: gunSonra(7), gerekce: "", butceAnahtari: "mal_alis", kalemler: [{ stokId: "", miktar: "1", tahminiBirimFiyat: "" }] });
const bosTeklif = (): TeklifFormu => ({ tedarikciCariId: "", dovizCinsi: "TRY", kur: "1", teslimSuresiGun: "", gecerlilikTarihi: "", aciklama: "", fiyatlar: {} });

export default function SatinAlmaTalepleriSayfasi() {
  const [secenekler, setSecenekler] = useState<Secenekler | null>(null);
  const [kapsam, setKapsam] = useState<Kapsam>("benim");
  const [liste, setListe] = useState<TalepSatiri[]>([]);
  const [detay, setDetay] = useState<TalepDetay | null>(null);
  // AI-78: açık satın alma talebi asistan bağlamı olur.
  useEkranKaydi(detay ? { tur: "satin_alma_talebi", id: detay.id, etiket: detay.no } : null);
  const aktarimSirasi = useRef(0);
  const [aktarim, setAktarim] = useState<{ girdi: IhtiyacGirdisi; sonuc: IhtiyacSonucu } | null>(null);
  const [form, setForm] = useState<TalepFormu | null>(null);
  const [gerekce, setGerekce] = useState("");
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
    }
  }, []);

  const detayAc = useCallback(async (id: string) => {
    setHata("");
    setGerekce("");
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

  const post = (yol: string, govde?: unknown) => api(yol, { method: "POST", body: JSON.stringify(govde ?? {}) });

  function kapsamDegistir(k: Kapsam) {
    setKapsam(k);
    void listeyiYukle(k);
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
      const govde = {
        departmanId: form.departmanId || null,
        ihtiyacTarihi: form.ihtiyacTarihi,
        gerekce: form.gerekce,
        butceAnahtari: form.butceAnahtari,
        kalemler: form.kalemler.map((k) => ({ stokId: k.stokId, miktar: k.miktar, tahminiBirimFiyat: k.tahminiBirimFiyat || "0" })),
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

  function durumEylemi(yol: string, mesaj: string, govde?: unknown) {
    if (!detay) return;
    const id = detay.id;
    void calistir(async () => {
      await post(`/satin-alma/talepler/${id}/${yol}`, govde);
      setGerekce("");
      await yenile(mesaj, id);
    });
  }

  function teklifGovdesi(d: TalepDetay) {
    return {
      tedarikciCariId: teklif.tedarikciCariId,
      dovizCinsi: teklif.dovizCinsi,
      kur: teklif.dovizCinsi === "TRY" ? "1" : teklif.kur,
      kalemler: d.kalemler.map((k) => ({ talepKalemiId: k.id, birimFiyat: teklif.fiyatlar[k.id]?.birimFiyat || "0", kdvOrani: teklif.fiyatlar[k.id]?.kdvOrani || "20" })),
    };
  }

  function teklifEkle() {
    if (!detay) return;
    const d = detay;
    void calistir(async () => {
      const sonuc = await api<{ id: string }>(`/satin-alma/talepler/${d.id}/teklifler`, {
        method: "POST",
        body: JSON.stringify({
          ...teklifGovdesi(d),
          teslimSuresiGun: teklif.teslimSuresiGun === "" ? null : Number(teklif.teslimSuresiGun),
          gecerlilikTarihi: teklif.gecerlilikTarihi || null,
          aciklama: teklif.aciklama || null,
        }),
      });
      if (teklifDosyalari.length) await belgeDosyalariniYukle("satin_alma_teklif", sonuc.id, teklifDosyalari);
      await yenile("Teklif eklendi.", d.id);
    });
  }

  function teklifSec(t: Teklif) {
    if (!detay) return;
    const id = detay.id;
    void calistir(async () => {
      await post(`/satin-alma/teklifler/${t.id}/sec`, { gerekce: t.enDusuk ? undefined : gerekce });
      setGerekce("");
      await yenile(`${t.tedarikci.unvan} teklifi seçildi.`, id);
    });
  }

  function teklifSil(t: Teklif) {
    if (!detay || !confirm(`${t.tedarikci.unvan} teklifi silinsin mi?`)) return;
    const id = detay.id;
    void calistir(async () => {
      await api(`/satin-alma/teklifler/${t.id}`, { method: "DELETE" });
      await yenile("Teklif silindi.", id);
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

  function siparisOlustur(dogrudan: boolean) {
    if (!detay) return;
    const d = detay;
    void calistir(async () => {
      const sonuc = await api<{ siparisBelgeId: string }>(`/satin-alma/talepler/${d.id}/siparis`, {
        method: "POST",
        body: JSON.stringify({ depoId: depoId || null, ...(dogrudan ? { dogrudan: teklifGovdesi(d) } : {}) }),
      });
      await yenile("Taslak alış siparişi oluşturuldu; Belgeler ekranından kontrol edip onaylayın.", d.id);
      void sonuc;
    });
  }

  const kapsamlar: { deger: Kapsam; baslik: string }[] = [
    ...(secenekler?.yetkiler.talepAcabilir ? [{ deger: "benim" as const, baslik: "Taleplerim" }] : []),
    ...(secenekler?.yetkiler.tumunuGorur ? [{ deger: "onay" as const, baslik: "Onay bekleyenler" }, { deger: "tum" as const, baslik: "Tüm talepler" }] : []),
  ];

  const seciliTeklif = detay?.teklifler.find((t) => t.secildi) ?? null;
  const gerekceGerekli = detay?.durum === "onay_bekliyor" && detay.butce.asim > 0;

  return (
    <div className="stack">
      <PageHeader
        title="Satın Alma Talepleri"
        subtitle={`Talep → onay → teklif → alış siparişi. ${secenekler ? `Onay eşiği ${tl(secenekler.onayEsigi)}: eşiğe kadar muhasebe, üstünü yönetici onaylar.` : ""}`}
        actions={secenekler?.yetkiler.talepAcabilir ? <Button disabled={islemde} variant="primary" onClick={() => { setDetay(null); aktarimiKapat(); setForm(bosTalep()); }}>Yeni talep</Button> : undefined}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {form && secenekler && (
        <Card title={form.id ? "Talebi düzenle" : "Yeni satın alma talebi"}>
          {aktarim && <div><Alert tone="warning">Eksik miktar {aktarim.sonuc.depo.ad} deposundan, ana birimde aktarıldı. Bu form stok ayırmaz; taslak kaydından sonra onaya gönderilmelidir.</Alert><Button disabled={islemde} onClick={() => void calistir(async () => {
            const sonuc = await api<IhtiyacSonucu>(ihtiyacSorgusu(aktarim.girdi), { cache: "no-store" });
            const yeni = ihtiyactanTalep(sonuc);
            setForm({ ...yeni, departmanId: form.departmanId, butceAnahtari: form.butceAnahtari, kalemler: [{ ...yeni.kalemler[0], tahminiBirimFiyat: form.kalemler[0]?.tahminiBirimFiyat ?? "" }] });
            setAktarim({ ...aktarim, sonuc }); setBasari("İhtiyaç güncellendi. Miktarı kontrol edip taslağı kaydedebilirsiniz.");
          })}>İhtiyacı yeniden yükle</Button></div>}
          <div className="form-grid">
            <Field label="İhtiyaç tarihi"><Input disabled={!!aktarim || islemde} type="date" value={form.ihtiyacTarihi} onChange={(e) => setForm({ ...form, ihtiyacTarihi: e.target.value })} /></Field>
            <Field label="Bütçe kalemi">
              <Select disabled={islemde} value={form.butceAnahtari} onChange={(e) => setForm({ ...form, butceAnahtari: e.target.value })}>
                {aktarim && <option value="">Bütçe kalemi seçin</option>}
                {secenekler.butceKalemleri.map((k) => <option key={k.anahtar} value={k.anahtar}>{k.ad}</option>)}
              </Select>
            </Field>
            <Field label="Departman (isteğe bağlı)">
              <Select disabled={islemde} value={form.departmanId} onChange={(e) => setForm({ ...form, departmanId: e.target.value })}>
                <option value="">—</option>
                {secenekler.departmanlar.map((d) => <option key={d.id} value={d.id}>{d.ad}</option>)}
              </Select>
            </Field>
            <Field label="Gerekçe"><Input disabled={islemde} value={form.gerekce} onChange={(e) => setForm({ ...form, gerekce: e.target.value })} placeholder="Neden gerekli?" /></Field>
          </div>
          <TableWrap>
            <thead><tr><th>Stok / hizmet kartı</th><th className="num">Miktar</th><th className="num">Tahmini birim fiyat (TL, KDV hariç)</th><th className="num">Tutar</th><th /></tr></thead>
            <tbody>
              {form.kalemler.map((k, i) => {
                const stok = secenekler.stoklar.find((s) => s.id === k.stokId);
                const kalemGuncelle = (yeni: Partial<KalemFormu>) => setForm({ ...form, kalemler: form.kalemler.map((x, j) => (j === i ? { ...x, ...yeni } : x)) });
                return (
                  <tr key={i}>
                    <td style={{ minWidth: 260 }}>
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
                    <td className="num"><Input aria-label={`${i + 1}. kalem miktarı`} disabled={!!aktarim || islemde} type="number" min="0" step="0.001" value={k.miktar} onChange={(e) => kalemGuncelle({ miktar: e.target.value })} style={{ maxWidth: 110 }} /> {stok?.anaBirim}</td>
                    <td className="num"><Input aria-label={`${i + 1}. kalem tahmini birim fiyatı`} disabled={islemde} type="number" min="0" step="0.0001" value={k.tahminiBirimFiyat} onChange={(e) => kalemGuncelle({ tahminiBirimFiyat: e.target.value })} style={{ maxWidth: 140 }} /></td>
                    <td className="num">{tl(Number(k.miktar || 0) * Number(k.tahminiBirimFiyat || 0))}</td>
                    <td><Button size="sm" variant="ghost" disabled={!!aktarim || islemde || form.kalemler.length === 1} onClick={() => setForm({ ...form, kalemler: form.kalemler.filter((_, j) => j !== i) })}>Kaldır</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <div className="between">
            <Button disabled={!!aktarim || islemde} size="sm" onClick={() => setForm({ ...form, kalemler: [...form.kalemler, { stokId: "", miktar: "1", tahminiBirimFiyat: "" }] })}>Kalem ekle</Button>
            <strong>Tahmini toplam: {tl(form.kalemler.reduce((t, k) => t + Number(k.miktar || 0) * Number(k.tahminiBirimFiyat || 0), 0))}</strong>
          </div>
          <div className="row-tight">
            <Button variant="primary" disabled={islemde} onClick={talepKaydet}>{form.id ? "Kaydet" : "Taslak kaydet"}</Button>
            <Button variant="ghost" disabled={islemde} onClick={() => { setForm(null); aktarimiKapat(); }}>Vazgeç</Button>
          </div>
        </Card>
      )}

      {kapsamlar.length > 0 && <Tabs items={kapsamlar} value={kapsam} onChange={kapsamDegistir} ariaLabel="Talep listeleri" />}
      <Card pad={false}>
        <TableWrap>
          <thead><tr><th>No</th><th>İhtiyaç</th><th>Talep eden</th><th>Departman</th><th className="num">Tutar</th><th>Durum</th><th className="num">Teklif</th><th>Sipariş</th></tr></thead>
          <tbody>
            {liste.length === 0 ? (
              <tr><td colSpan={8} className="empty">{kapsam === "onay" ? "Onayınızı bekleyen talep yok." : "Henüz talep yok."}</td></tr>
            ) : liste.map((t) => (
              <tr key={t.id} onClick={() => void detayAc(t.id)} style={{ cursor: "pointer" }} className={detay?.id === t.id ? "is-selected" : undefined}>
                <td className="mono">{t.no}</td>
                <td>{t.ihtiyacTarihi}</td>
                <td>{t.talepEden}</td>
                <td>{t.departman ?? "—"}</td>
                <td className="num">{tl(t.etkinTutar)}</td>
                <td><Badge variant={DURUM[t.durum].ton}>{DURUM[t.durum].ad}</Badge>{t.durum === "onay_bekliyor" && <small className="subtle"> {t.onaylayabilecekRoller.map((r) => ROL_ADI[r] ?? r).join(" / ")}</small>}</td>
                <td className="num">{t.teklifSayisi}</td>
                <td>{t.siparisBelge ? <a className="btn-link" href={`/panel/belgeler?yon=alis&tur=siparis&odak=${t.siparisBelge.id}`} onClick={(e) => e.stopPropagation()}>{t.siparisBelge.no ?? "Taslak"}</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {detay && (
        <Card title={`${detay.no} · ${DURUM[detay.durum].ad}`}>
          <div className="stack">
            <dl className="form-grid">
              <div><dt>Talep eden</dt><dd>{detay.talepEden.adSoyad}{detay.departman ? ` · ${detay.departman.ad}` : ""}</dd></div>
              <div><dt>İhtiyaç tarihi</dt><dd>{detay.ihtiyacTarihi}</dd></div>
              <div><dt>Bütçe kalemi</dt><dd>{detay.butceKalemi}</dd></div>
              <div><dt>Tutar (KDV hariç)</dt><dd>{tl(detay.etkinTutar)}{seciliTeklif ? " · seçili teklif" : " · tahmini"}</dd></div>
              <div><dt>Gerekçe</dt><dd>{detay.gerekce}</dd></div>
              {detay.onaylayan && <div><dt>{detay.durum === "reddedildi" ? "Reddeden" : "Onaylayan"}</dt><dd>{detay.onaylayan}{detay.onayZamani ? ` · ${new Date(detay.onayZamani).toLocaleString("tr-TR")}` : ""}</dd></div>}
              {detay.siparisBelge && <div><dt>Alış siparişi</dt><dd><a className="btn-link" href={`/panel/belgeler?yon=alis&tur=siparis&odak=${detay.siparisBelge.id}`}>{detay.siparisBelge.no ?? "Taslak sipariş"}</a></dd></div>}
            </dl>
            {detay.redGerekcesi && <div className="approval-impact is-warning">Red gerekçesi: {detay.redGerekcesi}</div>}
            {detay.butceAsimGerekcesi && <div className="approval-impact is-warning">Bütçe aşımı gerekçesi: {detay.butceAsimGerekcesi}</div>}

            <TableWrap>
              <thead><tr><th>Kart</th><th className="num">Miktar</th><th className="num">Tahmini birim fiyat</th><th className="num">Tahmini tutar</th></tr></thead>
              <tbody>{detay.kalemler.map((k) => <tr key={k.id}><td>{k.stokKod} — {k.stokAd}</td><td className="num">{sayi(k.miktar, 3)} {k.birim}</td><td className="num">{tl(k.tahminiBirimFiyat)}</td><td className="num">{tl(k.tutar)}</td></tr>)}</tbody>
            </TableWrap>

            <div className={`approval-impact ${detay.butce.asim > 0 ? "is-warning" : ""}`}>
              <strong>Bütçe · {String(detay.butce.ay).padStart(2, "0")}/{detay.butce.yil}</strong>{" "}
              {detay.butce.tanimli
                ? `Bütçe ${tl(detay.butce.butce)} − gerçekleşen ${tl(detay.butce.gerceklesen)} − diğer onaylı talepler ${tl(detay.butce.digerTalepler)} = kalan ${tl(detay.butce.kalan)}. ${detay.butce.asim > 0 ? `Bu talep bütçeyi ${tl(detay.butce.asim)} aşıyor.` : "Talep bütçe içinde."}`
                : "Bu yıl için onaylı bütçe tanımsız; aşım kontrolü yapılamıyor."}
            </div>

            {detay.durum === "onay_bekliyor" && detay.onayEngeli && <div className="approval-impact">{detay.onayEngeli}</div>}

            {(detay.yetkiler.onayla || detay.yetkiler.iptal || detay.yetkiler.teklifYonet) && (
              <Field label={gerekceGerekli ? "Gerekçe (bütçe aşımı nedeniyle onay için zorunlu)" : "Gerekçe (red, iptal veya en düşük olmayan teklif seçimi için)"}>
                <Input value={gerekce} onChange={(e) => setGerekce(e.target.value)} />
              </Field>
            )}

            <div className="row-tight">
              {detay.yetkiler.duzenle && <Button onClick={() => talepDuzenle(detay)}>Düzenle</Button>}
              {detay.yetkiler.gonder && <Button variant="primary" disabled={islemde} onClick={() => durumEylemi("gonder", "Talep onaya gönderildi.")}>Onaya gönder</Button>}
              {detay.yetkiler.geriCek && <Button disabled={islemde} onClick={() => durumEylemi("geri-cek", "Talep taslağa geri çekildi.")}>Geri çek</Button>}
              {detay.yetkiler.onayla && <Button variant="primary" disabled={islemde || (gerekceGerekli && gerekce.trim().length < 5)} onClick={() => durumEylemi("onayla", "Talep onaylandı.", { butceAsimGerekcesi: gerekce || undefined })}>Onayla</Button>}
              {detay.yetkiler.onayla && <Button variant="danger" disabled={islemde || gerekce.trim().length < 5} onClick={() => durumEylemi("reddet", "Talep reddedildi.", { gerekce })}>Reddet</Button>}
              {detay.yetkiler.iptal && <Button variant="ghost" disabled={islemde} onClick={() => confirm("Talep iptal edilsin mi?") && durumEylemi("iptal", "Talep iptal edildi.", { gerekce: gerekce || undefined })}>İptal et</Button>}
            </div>

            {(detay.teklifler.length > 0 || detay.yetkiler.teklifYonet) && (
              <div className="stack">
                <h3 className="card__title" style={{ margin: 0 }}>Teklif karşılaştırması</h3>
                {detay.teklifler.length === 0 ? <p className="subtle">Henüz teklif girilmedi.</p> : (
                  <TableWrap>
                    <thead>
                      <tr>
                        <th>Kalem</th>
                        {detay.teklifler.map((t) => (
                          <th key={t.id} className="num">
                            {t.tedarikci.unvan}
                            {t.enDusuk && <> <Badge variant="success">En düşük</Badge></>}
                            {t.secildi && <> <Badge variant="info">Seçili</Badge></>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detay.kalemler.map((k) => (
                        <tr key={k.id}>
                          <td>{k.stokKod} — {sayi(k.miktar, 3)} {k.birim}</td>
                          {detay.teklifler.map((t) => {
                            const f = t.kalemler.find((x) => x.talepKalemiId === k.id);
                            return <td key={t.id} className="num">{f ? `${sayi(f.birimFiyat, 4)} ${t.dovizCinsi} · KDV %${sayi(f.kdvOrani)}` : "—"}</td>;
                          })}
                        </tr>
                      ))}
                      <tr><td><strong>Toplam (KDV hariç)</strong></td>{detay.teklifler.map((t) => <td key={t.id} className="num"><strong>{sayi(t.toplam)} {t.dovizCinsi}</strong>{t.dovizCinsi !== "TRY" && <><br /><small>{tl(t.toplamTry)} · kur {t.kur}</small></>}</td>)}</tr>
                      <tr><td>Teslim / geçerlilik</td>{detay.teklifler.map((t) => <td key={t.id} className="num">{t.teslimSuresiGun != null ? `${t.teslimSuresiGun} gün` : "—"} / {t.gecerlilikTarihi ?? "—"}</td>)}</tr>
                      <tr>
                        <td />
                        {detay.teklifler.map((t) => (
                          <td key={t.id} className="num">
                            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                              {detay.yetkiler.teklifYonet && !t.secildi && <Button size="sm" variant="primary" disabled={islemde || (!t.enDusuk && gerekce.trim().length < 5)} onClick={() => teklifSec(t)}>Seç</Button>}
                              <Button size="sm" onClick={() => void ekleriAc(t.id)}>Ekler</Button>
                              {detay.yetkiler.teklifYonet && <Button size="sm" variant="ghost" disabled={islemde} onClick={() => teklifSil(t)}>Sil</Button>}
                            </div>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </TableWrap>
                )}
                {detay.teklifSecimGerekcesi && <div className="approval-impact">Teklif seçim gerekçesi: {detay.teklifSecimGerekcesi}</div>}
                {ekAcik && (
                  <div className="document-attachments__saved">
                    <h4>Teklif ekleri</h4>
                    {ekler.length === 0 ? <p className="muted">Bu teklife dosya eklenmemiş.</p> : ekler.map((ek) => <KayitliEkSatiri ek={ek} key={ek.id} onSil={() => undefined} />)}
                  </div>
                )}

                {detay.yetkiler.teklifYonet && (
                  <Card title={detay.teklifler.length === 0 ? "Teklif gir ya da doğrudan sipariş ver" : "Yeni teklif"}>
                    <div className="form-grid">
                      <Field label="Tedarikçi"><AramaSecici ariaLabel="Tedarikçi" deger={teklif.tedarikciCariId} secenekler={tedarikciSecenekleri} onChange={(v) => setTeklif({ ...teklif, tedarikciCariId: v })} /></Field>
                      <Field label="Döviz">
                        <Select value={teklif.dovizCinsi} onChange={(e) => setTeklif({ ...teklif, dovizCinsi: e.target.value, kur: e.target.value === "TRY" ? "1" : "" })}>
                          <DovizSecenekleri />
                        </Select>
                      </Field>
                      {teklif.dovizCinsi !== "TRY" && <Field label="Kur"><Input type="number" min="0" step="0.0001" value={teklif.kur} onChange={(e) => setTeklif({ ...teklif, kur: e.target.value })} /></Field>}
                      <Field label="Teslim süresi (gün)"><Input type="number" min="0" value={teklif.teslimSuresiGun} onChange={(e) => setTeklif({ ...teklif, teslimSuresiGun: e.target.value })} /></Field>
                      <Field label="Geçerlilik tarihi"><Input type="date" value={teklif.gecerlilikTarihi} onChange={(e) => setTeklif({ ...teklif, gecerlilikTarihi: e.target.value })} /></Field>
                      <Field label="Not"><Input value={teklif.aciklama} onChange={(e) => setTeklif({ ...teklif, aciklama: e.target.value })} /></Field>
                    </div>
                    <TableWrap>
                      <thead><tr><th>Kalem</th><th className="num">Birim fiyat ({teklif.dovizCinsi}, KDV hariç)</th><th className="num">KDV %</th></tr></thead>
                      <tbody>
                        {detay.kalemler.map((k) => {
                          const f = teklif.fiyatlar[k.id] ?? { birimFiyat: "", kdvOrani: "20" };
                          const fiyatGuncelle = (yeni: Partial<typeof f>) => setTeklif({ ...teklif, fiyatlar: { ...teklif.fiyatlar, [k.id]: { ...f, ...yeni } } });
                          return (
                            <tr key={k.id}>
                              <td>{k.stokKod} — {k.stokAd} · {sayi(k.miktar, 3)} {k.birim}</td>
                              <td className="num"><Input type="number" min="0" step="0.0001" value={f.birimFiyat} onChange={(e) => fiyatGuncelle({ birimFiyat: e.target.value })} style={{ maxWidth: 150 }} /></td>
                              <td className="num"><KdvOraniSecimi tablo={kodTablosu} value={f.kdvOrani} onDegis={(o) => fiyatGuncelle({ kdvOrani: o })} style={{ maxWidth: 110 }} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </TableWrap>
                    <BelgeDosyalari dosyalar={teklifDosyalari} onChange={setTeklifDosyalari} />
                    <div className="row-tight">
                      <Button variant="primary" disabled={islemde || !teklif.tedarikciCariId} onClick={teklifEkle}>Teklifi kaydet</Button>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {detay.yetkiler.siparis && (
              <Card title="Alış siparişine dönüştür">
                <div className="form-grid"><DepoSecici deger={depoId} onChange={setDepoId} label="Teslim alınacak depo" /></div>
                {seciliTeklif ? (
                  <Button variant="primary" disabled={islemde} onClick={() => siparisOlustur(false)}>{seciliTeklif.tedarikci.unvan} teklifinden sipariş oluştur</Button>
                ) : detay.teklifler.length > 0 ? (
                  <p className="subtle">Sipariş için karşılaştırmadan bir teklif seçin.</p>
                ) : (
                  <Button disabled={islemde || !teklif.tedarikciCariId} onClick={() => siparisOlustur(true)}>Yukarıdaki tedarikçi ve fiyatlarla doğrudan sipariş oluştur</Button>
                )}
              </Card>
            )}

            <div>
              <h3 className="card__title">Geçmiş</h3>
              <ul className="stack" style={{ gap: ".35rem", paddingLeft: "1rem" }}>
                {detay.olaylar.map((o, i) => (
                  <li key={i}><strong>{OLAY_ADI[o.tur] ?? o.tur}</strong> · {o.kullanici} · {new Date(o.zaman).toLocaleString("tr-TR")}{o.aciklama ? ` — ${o.aciklama}` : ""}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
