"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, ButtonLabel, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";
import { CariSecici, type CariSecenegi } from "@/components/cari-secici";

/**
 * PZR-13: pazaryeri hakedişi ve banka mutabakatı. Banka girişi seçilir, sistem
 * dönemin siparişlerini ve kesintilerini önerir; kayıtta sipariş alacakları son
 * müşteriden pazaryeri carisine aktarılır, stopaj 193'e mahsup edilir, kesintiler
 * pazaryeri carisinde netleşir. Fark engel değildir; onayda gösterilir.
 */
interface Baglanti { id: string; saglayici: string; faturaKesenVkn: string | null; pazaryeriCariId: string | null; pazaryeriCari: { id: string; unvan: string } | null; cariOnerisi: { id: string; unvan: string } | null }
interface EkstreSatiri { id: string; tarih: string; tutar: string; aciklama: string; karsiUnvan: string | null; bankaHesap: { ad: string; dovizCinsi: string }; onerilenBaglantiId: string | null }
interface Adaylar {
  satir: { id: string; tarih: string; tutar: string; aciklama: string; dovizCinsi: string; bankaHesap: string };
  baglanti: { id: string; saglayici: string; pazaryeriCariId: string | null };
  siparisler: { id: string; siparisNo: string; faturaNo: string | null; tarih: string; tutar: string; faturaToplami: string; cari: string }[];
  kesintiler: { id: string; tur: string; sinif: string; durum: string; tarih: string; tutar: string; dovizCinsi: string; siparisNo: string | null }[];
  oneri: { siparisIds: string[]; kesintiIds: string[]; net: string; fark: string; kaynak: "tahmin" | "odeme_donemi" };
  /** PZR-16: banka girişine uyan pazaryeri ödeme dönemi. */
  odemeDonemi: { no: string; tarih: string; tutar: string; siparisSayisi: number; kesintiSayisi: number } | null;
  uyarilar: string[];
}
interface Hakedis { id: string; tarih: string; saglayici: string; pazaryeriCari: string; aciklama: string; dovizCinsi: string; bankaTutari: string; siparisToplami: string; kesintiToplami: string; stopajToplami: string; fark: string; siparisSayisi: number; kesintiSayisi: number }

const para = (v: string | number, d = "TRY") => Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });
const tarih = (v: string) => new Date(v).toLocaleDateString("tr-TR");
const SINIF: Record<string, string> = { faturali: "Faturalı", stopaj: "Stopaj (193)", ceza: "Ceza (masraf)", diger_faturasiz: "Faturasız (masraf)" };
const saglayiciAdi = (s: string) => ({ amazon_tr: "Amazon", trendyol: "Trendyol", hepsiburada: "Hepsiburada", n11: "n11" }[s] ?? s);

export default function PazaryeriHakedis() {
  const [baglantilar, setBaglantilar] = useState<Baglanti[]>([]);
  const [satirlar, setSatirlar] = useState<EkstreSatiri[]>([]);
  const [hakedisler, setHakedisler] = useState<Hakedis[]>([]);
  const [cariler, setCariler] = useState<CariSecenegi[]>([]);
  const [cariSecimi, setCariSecimi] = useState<Record<string, string>>({});
  const [satirId, setSatirId] = useState("");
  const [baglantiId, setBaglantiId] = useState("");
  const [adaylar, setAdaylar] = useState<Adaylar | null>(null);
  const [siparisSecimi, setSiparisSecimi] = useState<Set<string>>(new Set());
  const [kesintiSecimi, setKesintiSecimi] = useState<Set<string>>(new Set());
  const [islem, setIslem] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      const [b, s, h] = await Promise.all([api<Baglanti[]>("/pazaryeri/hakedis/baglantilar"), api<EkstreSatiri[]>("/pazaryeri/hakedis/ekstre-satirlari"), api<Hakedis[]>("/pazaryeri/hakedis")]);
      setBaglantilar(b); setSatirlar(s); setHakedisler(h);
      setCariSecimi(Object.fromEntries(b.map((x) => [x.id, x.pazaryeriCariId ?? x.cariOnerisi?.id ?? ""])));
      const ekCariler = b.flatMap((x) => [x.pazaryeriCari, x.cariOnerisi]).filter((x): x is { id: string; unvan: string } => Boolean(x));
      const liste = await api<{ kayitlar: CariSecenegi[] }>("/cari?adet=200");
      setCariler([...new Map([...liste.kayitlar, ...ekCariler].map((c) => [c.id, c])).values()]);
    } catch (e) { setHata(e instanceof Error ? e.message : "Hakediş bilgileri yüklenemedi"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function cariKaydet(b: Baglanti) {
    setIslem(`cari:${b.id}`); setHata(""); setBasari("");
    try {
      await api(`/pazaryeri/baglantilar/${b.id}/pazaryeri-cari`, { method: "POST", body: JSON.stringify({ cariId: cariSecimi[b.id] || null }) });
      setBasari(`${saglayiciAdi(b.saglayici)} bağlantısının pazaryeri carisi kaydedildi.`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Pazaryeri carisi kaydedilemedi"); }
    finally { setIslem(""); }
  }

  async function adaylariGetir(sId = satirId, bId = baglantiId) {
    if (!sId || !bId) return setHata("Banka girişini ve pazaryeri bağlantısını seçin.");
    setIslem("aday"); setHata(""); setBasari(""); setAdaylar(null);
    try {
      const a = await api<Adaylar>(`/pazaryeri/hakedis/adaylar?ekstreSatirId=${sId}&baglantiId=${bId}`);
      setAdaylar(a); setSiparisSecimi(new Set(a.oneri.siparisIds)); setKesintiSecimi(new Set(a.oneri.kesintiIds));
    } catch (e) { setHata(e instanceof Error ? e.message : "Adaylar getirilemedi"); }
    finally { setIslem(""); }
  }

  function satirSec(s: EkstreSatiri) {
    setSatirId(s.id); setAdaylar(null);
    const b = s.onerilenBaglantiId ?? (baglantilar.length === 1 ? baglantilar[0].id : baglantiId);
    setBaglantiId(b);
    if (b) void adaylariGetir(s.id, b);
  }

  const toplam = useMemo(() => {
    if (!adaylar) return null;
    const siparis = adaylar.siparisler.filter((s) => siparisSecimi.has(s.id)).reduce((t, s) => t + Number(s.tutar), 0);
    const secKesinti = adaylar.kesintiler.filter((k) => kesintiSecimi.has(k.id));
    const kesinti = secKesinti.reduce((t, k) => t + Number(k.tutar), 0);
    const stopaj = secKesinti.filter((k) => k.sinif === "stopaj").reduce((t, k) => t + Number(k.tutar), 0);
    const net = siparis - kesinti;
    return { siparis, kesinti, stopaj, net, fark: Math.round((net - Number(adaylar.satir.tutar)) * 100) / 100 };
  }, [adaylar, siparisSecimi, kesintiSecimi]);

  async function kaydet() {
    if (!adaylar || !toplam) return;
    if (!siparisSecimi.size) return setHata("En az bir sipariş seçin.");
    const d = adaylar.satir.dovizCinsi;
    const farkMetni = toplam.fark === 0 ? "Banka tutarı seçilen kalemlerle tam uyuşuyor." : `Seçilen kalemlerin neti banka tutarından ${para(Math.abs(toplam.fark), d)} ${toplam.fark > 0 ? "fazla" : "eksik"}; fark pazaryeri carisinde açık kalır.`;
    if (!confirm(`${para(adaylar.satir.tutar, d)} banka girişi hakediş olarak kaydedilecek.\n\n• ${siparisSecimi.size} sipariş alacağı (${para(toplam.siparis, d)}) müşterilerden pazaryeri carisine aktarılır, faturalar kapanır.\n• ${kesintiSecimi.size} kesinti (${para(toplam.kesinti, d)}) pazaryeri carisinde netleşir${toplam.stopaj ? `; stopaj ${para(toplam.stopaj, d)} 193'e mahsup edilir` : ""}.\n\n${farkMetni}\n\nDevam edilsin mi?`)) return;
    setIslem("kaydet"); setHata(""); setBasari("");
    try {
      const r = await api<{ fark: string }>("/pazaryeri/hakedis", { method: "POST", body: JSON.stringify({ ekstreSatirId: adaylar.satir.id, baglantiId: adaylar.baglanti.id, siparisIds: [...siparisSecimi], kesintiIds: [...kesintiSecimi] }) });
      setBasari(`Hakediş kaydedildi.${Number(r.fark) ? ` Fark: ${para(r.fark, d)}.` : " Fark yok."}`);
      setAdaylar(null); setSatirId("");
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Hakediş kaydedilemedi"); }
    finally { setIslem(""); }
  }

  async function geriAl(h: Hakedis) {
    if (!confirm(`${tarih(h.tarih)} tarihli ${para(h.bankaTutari, h.dovizCinsi)} hakediş geri alınacak: banka tahsilatı, cari aktarımları, stopaj mahsubu ve fatura kapamaları silinir; banka satırı bekleyene döner. Devam edilsin mi?`)) return;
    setIslem(`geri:${h.id}`); setHata(""); setBasari("");
    try { await api(`/pazaryeri/hakedis/${h.id}/geri-al`, { method: "POST", body: "{}" }); setBasari("Hakediş geri alındı; banka satırı yeniden eşleştirilebilir."); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Hakediş geri alınamadı"); }
    finally { setIslem(""); }
  }

  const secimDegistir = (set: (f: (x: Set<string>) => Set<string>) => void, id: string, deger: boolean) => set((x) => { const s = new Set(x); if (deger) s.add(id); else s.delete(id); return s; });
  const d = adaylar?.satir.dovizCinsi ?? "TRY";

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <PageHeader
        title="Pazaryeri hakedişi"
        subtitle="Pazaryerinden gelen banka girişini dönemin siparişleri ve kesintileriyle eşleştirin. Faturalar son müşteride kalır; hakedişte alacak pazaryeri carisine aktarılır, stopaj 193'e mahsup edilir."
        actions={<><ButtonLabel as="a" href="/panel/pazaryeri">Siparişler</ButtonLabel><ButtonLabel as="a" href="/panel/pazaryeri/kesintiler">Kesintiler</ButtonLabel></>}
      />
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      <Card title="Pazaryeri carileri" pad={false}>
        <div style={{ padding: "0.75rem 1rem 0" }}><small className="subtle">Hakedişte sipariş alacakları bu cariye aktarılır; komisyon faturaları ve kesinti masrafları da aynı caride netleşir. Fatura kesen VKN'si kayıtlı carisi varsa önerilir.</small></div>
        <TableWrap>
          <thead><tr><th>Bağlantı</th><th>Pazaryeri carisi</th><th></th></tr></thead>
          <tbody>
            {baglantilar.map((b) => (
              <tr key={b.id}>
                <td><strong>{saglayiciAdi(b.saglayici)}</strong>{b.faturaKesenVkn && <small> · VKN {b.faturaKesenVkn}</small>}</td>
                <td style={{ minWidth: 260 }}>
                  <CariSecici cariler={cariler} deger={cariSecimi[b.id] ?? ""} onChange={(id) => setCariSecimi((x) => ({ ...x, [b.id]: id }))} ariaLabel={`${saglayiciAdi(b.saglayici)} pazaryeri carisi`} />
                  {!b.pazaryeriCariId && b.cariOnerisi && <small className="subtle">Önerilen: {b.cariOnerisi.unvan}</small>}
                </td>
                <td><Button size="sm" variant={b.pazaryeriCariId ? "ghost" : "primary"} disabled={islem === `cari:${b.id}` || (cariSecimi[b.id] ?? "") === (b.pazaryeriCariId ?? "")} onClick={() => void cariKaydet(b)}>Kaydet</Button></td>
              </tr>
            ))}
            {!baglantilar.length && <tr><td colSpan={3}>Pazaryeri bağlantısı yok. Hakediş için önce <a href="/panel/ayarlar/pazaryerleri">Ayarlar › Pazaryerleri</a> ekranından bir bağlantı ekleyin.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Bekleyen banka girişleri" pad={false}>
        <div style={{ padding: "0.75rem 1rem 0" }}><small className="subtle">Son 120 günün eşleşmemiş girişleri. Açıklaması ya da karşı ünvanı pazaryerine benzeyenler üstte ve bağlantısı önerilmiş olarak gelir.</small></div>
        <TableWrap>
          <thead><tr><th>Tarih</th><th>Hesap</th><th>Açıklama</th><th className="num">Tutar</th><th>Öneri</th><th></th></tr></thead>
          <tbody>
            {satirlar.map((s) => {
              const oneri = baglantilar.find((b) => b.id === s.onerilenBaglantiId);
              return (
                <tr key={s.id} aria-selected={s.id === satirId}>
                  <td>{tarih(s.tarih)}</td><td>{s.bankaHesap.ad}</td>
                  <td>{s.aciklama}{s.karsiUnvan && <small> · {s.karsiUnvan}</small>}</td>
                  <td className="num">{para(s.tutar, s.bankaHesap.dovizCinsi)}</td>
                  <td>{oneri ? saglayiciAdi(oneri.saglayici) : "—"}</td>
                  <td><Button size="sm" variant={s.id === satirId ? "primary" : "ghost"} disabled={!baglantilar.length} title={baglantilar.length ? undefined : "Önce bir pazaryeri bağlantısı ekleyin"} onClick={() => satirSec(s)}>{s.id === satirId ? "Seçili" : "Hakediş olarak eşleştir"}</Button></td>
                </tr>
              );
            })}
            {!satirlar.length && <tr><td colSpan={6}>Bekleyen banka girişi yok.</td></tr>}
          </tbody>
        </TableWrap>
        {!baglantilar.length && satirlar.length > 0 && <div style={{ padding: "0.75rem 1rem" }}><Alert tone="warning">Pazaryeri bağlantısı olmadığı için banka girişleri hakediş olarak eşleştirilemez.</Alert></div>}
        {satirId && baglantilar.length > 0 && (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "end", padding: "0.75rem 1rem", flexWrap: "wrap" }}>
            <Field label="Pazaryeri bağlantısı">
              <Select value={baglantiId} onChange={(e) => { setBaglantiId(e.target.value); setAdaylar(null); }}>
                <option value="">Bağlantı seçin…</option>
                {baglantilar.map((b) => <option key={b.id} value={b.id}>{saglayiciAdi(b.saglayici)}</option>)}
              </Select>
            </Field>
            <Button disabled={!baglantiId || islem === "aday"} onClick={() => void adaylariGetir()}>{islem === "aday" ? "Getiriliyor…" : "Adayları getir"}</Button>
          </div>
        )}
      </Card>

      {adaylar && toplam && (
        <Card title={`Hakediş: ${tarih(adaylar.satir.tarih)} · ${para(adaylar.satir.tutar, d)} · ${adaylar.satir.bankaHesap}`} pad={false}>
          <div style={{ display: "grid", gap: "0.6rem", padding: "0.75rem 1rem" }}>
            {adaylar.oneri.kaynak === "odeme_donemi" && adaylar.odemeDonemi
              ? <Alert tone="success">Öneri pazaryerinin ödeme dökümünden: {saglayiciAdi(adaylar.baglanti.saglayici)} ödemesi #{adaylar.odemeDonemi.no} ({tarih(adaylar.odemeDonemi.tarih)}, {para(adaylar.odemeDonemi.tutar, d)}) — {adaylar.odemeDonemi.siparisSayisi} sipariş, {adaylar.odemeDonemi.kesintiSayisi} kesinti. Seçimi düzeltebilirsiniz.</Alert>
              : <small className="subtle">Öneri (tahmin): banka tutarına en yakın kesim tarihine kadarki siparişler ve kesintiler seçildi. Seçimi düzeltebilirsiniz.</small>}
            {adaylar.uyarilar.map((u) => <Alert key={u} tone="warning">{u}</Alert>)}
          </div>
          <div style={{ padding: "0 1rem" }}><strong>Siparişler</strong> <small className="subtle">({siparisSecimi.size}/{adaylar.siparisler.length} seçili · tutar faturanın kalanıdır)</small></div>
          <TableWrap>
            <thead><tr><th>Seç</th><th>Fatura tarihi</th><th>Sipariş / fatura</th><th>Müşteri</th><th className="num">Aktarılacak</th></tr></thead>
            <tbody>
              {adaylar.siparisler.map((s) => (
                <tr key={s.id}>
                  <td><input type="checkbox" aria-label={`${s.siparisNo} siparişini hakedişe al`} checked={siparisSecimi.has(s.id)} onChange={(e) => secimDegistir(setSiparisSecimi, s.id, e.target.checked)} /></td>
                  <td>{tarih(s.tarih)}</td><td>{s.siparisNo}<small> · {s.faturaNo ?? "—"}</small></td><td>{s.cari}</td>
                  <td className="num">{para(s.tutar, d)}{s.tutar !== s.faturaToplami && <small> / {para(s.faturaToplami, d)}</small>}</td>
                </tr>
              ))}
              {!adaylar.siparisler.length && <tr><td colSpan={5}>Hakedişe girebilecek faturalanmış sipariş yok.</td></tr>}
            </tbody>
          </TableWrap>
          <div style={{ padding: "0.75rem 1rem 0" }}><strong>Kesintiler</strong> <small className="subtle">({kesintiSecimi.size}/{adaylar.kesintiler.length} seçili)</small></div>
          <TableWrap>
            <thead><tr><th>Seç</th><th>Tarih</th><th>Tür</th><th>Sınıf</th><th className="num">Tutar</th></tr></thead>
            <tbody>
              {adaylar.kesintiler.map((k) => (
                <tr key={k.id}>
                  <td><input type="checkbox" aria-label={`${k.tur} kesintisini hakedişe al`} checked={kesintiSecimi.has(k.id)} onChange={(e) => secimDegistir(setKesintiSecimi, k.id, e.target.checked)} /></td>
                  <td>{tarih(k.tarih)}</td><td>{k.tur}{k.siparisNo && <small> · {k.siparisNo}</small>}</td><td>{SINIF[k.sinif] ?? k.sinif}</td>
                  <td className="num">{para(k.tutar, d)}</td>
                </tr>
              ))}
              {!adaylar.kesintiler.length && <tr><td colSpan={5}>Hakedişe girebilecek kesinti yok.</td></tr>}
            </tbody>
          </TableWrap>
          <div style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", padding: "0.75rem 1rem" }}>
            <div><small className="subtle">Sipariş alacakları</small><div><strong>{para(toplam.siparis, d)}</strong></div></div>
            <div><small className="subtle">Kesintiler{toplam.stopaj ? ` (stopaj ${para(toplam.stopaj, d)})` : ""}</small><div><strong>−{para(toplam.kesinti, d)}</strong></div></div>
            <div><small className="subtle">Beklenen net</small><div><strong>{para(toplam.net, d)}</strong></div></div>
            <div><small className="subtle">Banka girişi</small><div><strong>{para(adaylar.satir.tutar, d)}</strong></div></div>
            <div><small className="subtle">Fark</small><div><strong style={{ color: toplam.fark ? "var(--warning)" : undefined }}>{para(toplam.fark, d)}</strong></div></div>
          </div>
          {toplam.fark !== 0 && <div style={{ padding: "0 1rem" }}><Alert tone="warning">Seçilen kalemlerin neti banka girişinden {para(Math.abs(toplam.fark), d)} {toplam.fark > 0 ? "fazla" : "eksik"}. Kaydedebilirsiniz; fark pazaryeri carisinde açık kalır ve hakediş listesinde görünür.</Alert></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", padding: "0.75rem 1rem" }}>
            <Button onClick={() => { setAdaylar(null); setSatirId(""); }}>Vazgeç</Button>
            <Button variant="primary" disabled={islem === "kaydet" || !siparisSecimi.size || !adaylar.baglanti.pazaryeriCariId} onClick={() => void kaydet()}>{islem === "kaydet" ? "Kaydediliyor…" : "Hakedişi kaydet"}</Button>
          </div>
        </Card>
      )}

      <Card title="Kaydedilen hakedişler" pad={false}>
        <TableWrap>
          <thead><tr><th>Tarih</th><th>Pazaryeri</th><th className="num">Banka</th><th className="num">Siparişler</th><th className="num">Kesintiler</th><th className="num">Fark</th><th></th></tr></thead>
          <tbody>
            {hakedisler.map((h) => (
              <tr key={h.id}>
                <td>{tarih(h.tarih)}</td>
                <td>{saglayiciAdi(h.saglayici)}<small> · {h.pazaryeriCari}</small></td>
                <td className="num">{para(h.bankaTutari, h.dovizCinsi)}</td>
                <td className="num">{para(h.siparisToplami, h.dovizCinsi)}<small> · {h.siparisSayisi}</small></td>
                <td className="num">{para(h.kesintiToplami, h.dovizCinsi)}<small> · {h.kesintiSayisi}{Number(h.stopajToplami) ? ` · stopaj ${para(h.stopajToplami, h.dovizCinsi)}` : ""}</small></td>
                <td className="num">{Number(h.fark) ? <strong>{para(h.fark, h.dovizCinsi)}</strong> : "—"}</td>
                <td><Button size="sm" variant="danger" disabled={islem === `geri:${h.id}`} onClick={() => void geriAl(h)}>Geri al</Button></td>
              </tr>
            ))}
            {!hakedisler.length && <tr><td colSpan={7}>Henüz hakediş kaydı yok.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
