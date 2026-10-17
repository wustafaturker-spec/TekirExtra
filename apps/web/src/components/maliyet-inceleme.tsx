"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card } from "@/components/ui";

interface Kayit {
  id: string; durum: string; updatedAt: string; aciklama?: string;
  _count: { olaylar: number };
  olaylar: { id: string; aciklama: string | null; olayTuru: string; createdAt: string; user: { adSoyad: string } | null }[];
}
const adlar: Record<string, string> = { acik: "Açık", incelemede: "İncelemede", beklemede: "Beklemede", cozuldu: "Çözüldü", yoksayildi: "Yoksayıldı" };
interface Dogrulama { uygun: boolean; neden: string; kanit: string | null; kayitId: string | null; kayitSurumu: string | null; maliyet: string | null; ciro: string | null; hareketSayisi: number; alindigiZaman: string; faturaNo?: string; stokKod?: string; stokAd?: string; tarih?: string; varyantKod?: string | null; varyantAd?: string | null; varyantId?: string | null; kapsamSatirSayisi?: number; kapsamMiktari?: string }

export function MaliyetInceleme({ satirId, etiket, yazabilir, kapat, cozuldu, yenidenBaslatilabilir = true }: { satirId: string; etiket: string; yazabilir: boolean; kapat: () => void; cozuldu?: () => void; yenidenBaslatilabilir?: boolean }) {
  const bolum = useRef<HTMLElement>(null);
  const [kayit, setKayit] = useState<Kayit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [not, setNot] = useState("");
  const [durum, setDurum] = useState("incelemede");
  const [yenile, setYenile] = useState(0);
  const [dogrulama, setDogrulama] = useState<Dogrulama | null>(null);
  const yol = `/rapor/maliyet-eksikleri/${satirId}/takip`;
  useEffect(() => { bolum.current?.scrollIntoView({ block: "start" }); bolum.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let etkin = true;
    setYukleniyor(true); setHata(""); setDogrulama(null);
    void api<{ kayit: Kayit | null }>(yol).then((r) => {
      if (etkin) { setKayit(r.kayit); setDurum(r.kayit?.durum === "beklemede" ? "beklemede" : "incelemede"); }
    }).catch((e) => { if (etkin) setHata(e instanceof Error ? e.message : "İnceleme geçmişi alınamadı."); })
      .finally(() => { if (etkin) setYukleniyor(false); });
    return () => { etkin = false; };
  }, [yol, yenile]);
  const kapali = Boolean(kayit && ["cozuldu", "yoksayildi"].includes(kayit.durum));
  const kaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!yazabilir || kaydediliyor || yukleniyor || hata || not.trim().length < 2) return;
    setKaydediliyor(true); setHata(""); setBilgi(""); setDogrulama(null);
    try {
      const yeni = !kayit || kapali;
      const r = await api<{ kayit: Kayit; zatenVardi?: boolean }>(yol, { method: yeni ? "POST" : "PATCH", body: JSON.stringify(yeni
        ? { aciklama: not } : { aciklama: not, durum, beklenenGuncelleme: kayit!.updatedAt }) });
      setKayit(r.kayit);
      setDurum(r.kayit.durum === "beklemede" ? "beklemede" : "incelemede");
      if (r.zatenVardi) setBilgi("Bu satır için inceleme zaten açılmış. Notunuzu mevcut kayda ekleyebilirsiniz.");
      else { setNot(""); setBilgi("İnceleme kaydedildi. Maliyet ve kâr tutarları değiştirilmedi."); }
    } catch (e) { setHata(e instanceof Error ? e.message : "İnceleme kaydedilemedi."); }
    finally { setKaydediliyor(false); }
  };
  const dogrula = async () => {
    if (!kayit || kapali || kaydediliyor || yukleniyor || hata) return;
    setKaydediliyor(true); setBilgi(""); setDogrulama(null);
    try {
      const r = await api<Dogrulama>(`${yol}/dogrulama`);
      if (r.kayitId !== kayit.id || r.kayitSurumu !== kayit.updatedAt) throw new Error("İnceleme değişti. Geçmişi yenileyip yeniden doğrulayın.");
      setDogrulama(r);
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaynak doğrulanamadı."); }
    finally { setKaydediliyor(false); }
  };
  const incelemeyiKapat = async () => {
    if (!yazabilir || !kayit || kapali || !dogrulama?.uygun || !dogrulama.kanit || kaydediliyor || yukleniyor || hata || not.trim().length < 2) return;
    setKaydediliyor(true); setBilgi("");
    try {
      const r = await api<{ kayit: Kayit }>(`${yol}/kapat`, { method: "POST", body: JSON.stringify({ kayitId: dogrulama.kayitId, beklenenGuncelleme: dogrulama.kayitSurumu, kanit: dogrulama.kanit, aciklama: not }) });
      setKayit(r.kayit); setNot(""); setDogrulama(null); setBilgi("Kayıtlı maliyet doğrulanarak inceleme kapatıldı. Mali tutarlar değiştirilmedi.");
      cozuldu?.();
    } catch (e) { setDogrulama(null); setHata(e instanceof Error ? e.message : "İnceleme kapatılamadı."); }
    finally { setKaydediliyor(false); }
  };
  return <Card><section ref={bolum} tabIndex={-1} aria-label="Maliyet inceleme kaydı" className="stack">
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}><h2>İnceleme · {etiket}</h2><Button disabled={kaydediliyor} onClick={kapat}>İncelemeyi kapat</Button></div>
    <p>Bu kayıt Düzeltme Merkezi'nde saklanır. İnceleme durumu, kaynağın maliyet uyarısını kaldırmaz ve maliyet doğrulaması anlamına gelmez.</p>
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    <Button disabled={yukleniyor || kaydediliyor} onClick={() => setYenile((v) => v + 1)}>Geçmişi yenile</Button>
    {yukleniyor ? <p role="status">İnceleme geçmişi yükleniyor…</p> : <>
      <p>Takip durumu: <strong>{kayit ? adlar[kayit.durum] ?? kayit.durum : "Henüz kayıt yok"}</strong></p>
      {kayit?.aciklama && <p>{kayit.aciklama}</p>}
      {kayit && !kapali && <>
        <p>Kayıtlı maliyet doğrulaması satış ve stok hareketlerini yeniden okur; alış maliyetinin muhasebesel doğruluğu ayrıca incelenmelidir.</p>
        <Button disabled={yukleniyor || kaydediliyor || Boolean(hata)} onClick={() => void dogrula()}>Kayıtlı maliyeti doğrula</Button>
        {dogrulama && (dogrulama.faturaNo || dogrulama.stokKod) && <p>Doğrulanan kaynak: {[dogrulama.faturaNo, dogrulama.stokKod, dogrulama.stokAd, dogrulama.tarih].filter(Boolean).join(" · ")}</p>}
        {(dogrulama?.varyantKod || dogrulama?.varyantAd) && <p>Varyant: {[dogrulama.varyantKod, dogrulama.varyantAd].filter(Boolean).join(" · ")}</p>}
        {dogrulama?.varyantId && dogrulama.kapsamSatirSayisi !== undefined && <p>Bu varyantın faturadaki {dogrulama.kapsamSatirSayisi} satış satırı birlikte kontrol edildi. Toplam miktar: {dogrulama.kapsamMiktari} (ana birim).</p>}
        {dogrulama && <Alert tone={dogrulama.uygun ? "success" : "warning"}>{dogrulama.neden}{dogrulama.maliyet !== null && <> Seçili satırın kayıtlı maliyeti: {dogrulama.maliyet} TRY · İlişkili hareket: {dogrulama.hareketSayisi}.</>}</Alert>}
      </>}
      {yazabilir && (!kapali || yenidenBaslatilabilir) && <form onSubmit={(e) => void kaydet(e)} className="stack">
        {kayit && !kapali && <label>İnceleme durumu<select aria-label="İnceleme durumu" value={durum} onChange={(e) => setDurum(e.target.value)} disabled={kaydediliyor}><option value="incelemede">İncelemede</option><option value="beklemede">Beklemede</option></select></label>}
        <label htmlFor="maliyet-inceleme-notu">İnceleme notu</label>
        <textarea id="maliyet-inceleme-notu" className="textarea" minLength={2} maxLength={2000} value={not} onChange={(e) => setNot(e.target.value)} disabled={kaydediliyor} />
        <Button type="submit" variant="primary" disabled={kaydediliyor || Boolean(hata) || not.trim().length < 2}>{kaydediliyor ? "Kaydediliyor…" : !kayit || kapali ? "İnceleme başlat" : "Not ve durumu kaydet"}</Button>
        {kayit && !kapali && <Button type="button" disabled={!dogrulama?.uygun || kaydediliyor || Boolean(hata) || not.trim().length < 2} onClick={() => void incelemeyiKapat()}>Kayıtlı maliyetle incelemeyi kapat</Button>}
      </form>}
      {kayit && <><h3>İşlem geçmişi ({Math.min(50, kayit._count.olaylar)} / {kayit._count.olaylar})</h3>{kayit.olaylar.map((o) => <article key={o.id}><strong>{o.user?.adSoyad ?? "Sistem"}</strong> · {new Date(o.createdAt).toLocaleString("tr-TR")}<p>{o.aciklama ?? o.olayTuru}</p></article>)}</>}
    </>}
  </section></Card>;
}
