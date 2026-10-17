"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ayBasiTR, bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir } from "@/lib/api";
import { useAdresDurumu } from "@/lib/adres-durumu";
import { Alert, Button, Card, Field, Input, PageHeader, Para, Stat, StatGrid, Table } from "@/components/ui";
import { MaliyetInceleme } from "@/components/maliyet-inceleme";
import { MaliyetIzleme } from "@/components/maliyet-izleme";

interface Satir {
  id: string; faturaId: string; faturaNo: string; tarih: string; cariUnvan: string;
  stokId: string; kod: string; ad: string; miktar: string; ciro: string; maliyet: string;
  varyantKod?: string | null; varyantAd?: string | null;
  neden: "hareket_yok" | "sifir_maliyet"; guncelStokEksi: boolean;
}
interface Sonuc {
  kullanimModu?: "salt_okunur" | "pilot" | "acik";
  baslangic: string; bitis: string;
  donemOzeti: { satir: number; ciro: string }; filtreOzeti: { satir: number; ciro: string };
  sayfa: number; sayfaBoyutu: number; toplamSayfa: number; satirlar: Satir[];
  izinler: { fatura: boolean; stok: boolean; onizleme: boolean; takipYazma?: boolean };
}

export default function MaliyetEksikleriSayfasi() {
  const [adres, guncelle, hazir] = useAdresDurumu({ baslangic: ayBasiTR(), bitis: bugunTR(), stokId: "", neden: "hepsi", sayfa: "1", inceleme: "" });
  const { baslangic, bitis, stokId, neden, sayfa } = adres;
  const [veri, setVeri] = useState<Sonuc | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yenile, setYenile] = useState(0);
  const [sonSorgu, setSonSorgu] = useState("");
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [izlemeAcik, setIzlemeAcik] = useState(false);
  const q = new URLSearchParams({ baslangic, bitis, neden, sayfa });
  if (stokId) q.set("stokId", stokId);
  const sorgu = q.toString();
  useEffect(() => {
    if (!hazir) return;
    let etkin = true;
    setYukleniyor(true); setHata(""); setVeri(null);
    void api<Sonuc>(`/rapor/maliyet-eksikleri?${sorgu}`).then((r) => { if (etkin) { setVeri(r); setSonSorgu(sorgu); } })
      .catch((e) => { if (etkin) setHata(e instanceof Error ? e.message : "Maliyet kontrolü yüklenemedi."); })
      .finally(() => { if (etkin) setYukleniyor(false); });
    return () => { etkin = false; };
  }, [hazir, sorgu, yenile]);
  const excelIndir = async () => {
    if (!hazir || !veri || yukleniyor || indiriliyor || sonSorgu !== sorgu) return;
    setIndiriliyor(true); setHata("");
    try {
      await apiDosyaIndir(`/rapor/maliyet-eksikleri/excel?${sonSorgu}`, `maliyet-kontrolu_${veri.baslangic}_${veri.bitis}.xlsx`);
    } catch (e) { setHata(e instanceof Error ? e.message : "Excel dosyası indirilemedi."); }
    finally { setIndiriliyor(false); }
  };
  return <div className="stack">
    <PageHeader title="Satış maliyet kontrolü" subtitle="Kâr raporunda sıfır kayıtlı maliyet nedeniyle uyarı verilen mal satışları. Tutarlar TRY cinsindedir." actions={<>
      <Button disabled={yukleniyor} onClick={() => setYenile((v) => v + 1)}>Yenile</Button>
      <Button disabled={!veri || yukleniyor || sonSorgu !== sorgu} aria-expanded={izlemeAcik} onClick={() => setIzlemeAcik((v) => !v)}>Dönem inceleme özeti</Button>
      <Button variant="primary" disabled={!hazir || !veri || yukleniyor || indiriliyor || sonSorgu !== sorgu} onClick={() => void excelIndir()}>{indiriliyor ? "Excel hazırlanıyor…" : "Excel'e aktar"}</Button>
    </>} />
    <p className="muted">Excel, seçili filtrelere uyan tüm satırları içerir. İndirme sırasında kaynak yeniden okunur; ekrandaki tutarlar arada değişmiş olabilir.</p>
    <Alert tone="warning">Sıfır maliyet, tek başına eksik maliyet kanıtı değildir; bedelsiz edinim de olabilir. Hareket kaydı ve kaynak belge incelenmelidir. Bu liste mali kayıtları değiştirmez.</Alert>
    <Card><div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "end" }}>
      <Field label="Başlangıç" htmlFor="maliyet-baslangic"><Input id="maliyet-baslangic" type="date" value={baslangic} onChange={(e) => guncelle({ baslangic: e.target.value, sayfa: "1" })} /></Field>
      <Field label="Bitiş" htmlFor="maliyet-bitis"><Input id="maliyet-bitis" type="date" value={bitis} onChange={(e) => guncelle({ bitis: e.target.value, sayfa: "1" })} /></Field>
      <Field label="Kayıt bulgusu" htmlFor="maliyet-bulgusu"><select id="maliyet-bulgusu" value={neden} onChange={(e) => guncelle({ neden: e.target.value, sayfa: "1" })}>
        <option value="hepsi">Tümü</option><option value="hareket_yok">İlişkili stok hareketi yok</option><option value="sifir_maliyet">Hareket var, kayıtlı maliyet sıfır</option>
      </select></Field>
      {stokId && <Button onClick={() => guncelle({ stokId: "", sayfa: "1" })}>Ürün filtresini kaldır</Button>}
    </div></Card>
    <Alert tone="error">{hata}</Alert>
    {yukleniyor && <p role="status">Satış maliyetleri yükleniyor…</p>}
    {veri && <>
      {izlemeAcik && <MaliyetIzleme key={`${veri.baslangic}_${veri.bitis}_${yenile}`} baslangic={veri.baslangic} bitis={veri.bitis} />}
      {veri.kullanimModu === "salt_okunur" && <Alert tone="warning">Şirket modu: salt okunur. Liste, Excel ve inceleme geçmişi görüntülenebilir; inceleme kayıtları değiştirilemez.</Alert>}
      {veri.kullanimModu === "pilot" && <Alert tone="warning">Şirket modu: pilot. İnceleme işlemleri mevcut kullanıcı yetkileriyle yürütülür.</Alert>}
      {adres.inceleme && <MaliyetInceleme key={adres.inceleme} satirId={adres.inceleme} etiket={veri.satirlar.find((s) => s.id === adres.inceleme)?.faturaNo || "Kaynak satış satırı"} yazabilir={Boolean(veri.izinler.takipYazma)} yenidenBaslatilabilir={veri.satirlar.some((s) => s.id === adres.inceleme)} kapat={() => guncelle({ inceleme: "" })} cozuldu={() => setYenile((v) => v + 1)} />}
      <StatGrid>
        <Stat label="Dönemde kontrol edilecek satır" value={veri.donemOzeti.satir} hint={<>İlgili ciro <Para deger={veri.donemOzeti.ciro} /></>} />
        <Stat label="Filtredeki satır" value={veri.filtreOzeti.satir} hint={<>İlgili ciro <Para deger={veri.filtreOzeti.ciro} /></>} />
      </StatGrid>
      <p className="muted">İlgili ciro, eksik maliyet tutarı veya düzeltilecek kâr değildir. Miktarlar ana birimdedir. Güncel eksi stok bilgisi, satış tarihindeki stok durumunu göstermez.</p>
      <Card pad={false}><Table>
        <thead><tr><th>Tarih / belge</th><th>Cari</th><th>Ürün</th><th className="num">Miktar</th><th className="num">Ciro</th><th>Bulgular</th><th>İnceleme</th></tr></thead>
        <tbody>{veri.satirlar.map((s) => <tr key={s.id}>
          <td>{s.tarih.split("-").reverse().join(".")}<br />{veri.izinler.fatura ? <Link href={`/panel/fatura?fatura=${s.faturaId}`}>{s.faturaNo || "Faturayı aç"}</Link> : s.faturaNo || "Satış faturası"}</td>
          <td>{s.cariUnvan}</td>
          <td>{veri.izinler.stok ? <Link href={`/panel/stok/${s.stokId}`}>{s.kod} · {s.ad}</Link> : `${s.kod} · ${s.ad}`}{(s.varyantKod || s.varyantAd) && <><br /><small>Varyant: {[s.varyantKod, s.varyantAd].filter(Boolean).join(" · ")}</small></>}</td>
          <td className="num">{Number(s.miktar).toLocaleString("tr-TR", { maximumFractionDigits: 6 })}</td>
          <td className="num"><Para deger={s.ciro} /></td>
          <td>{s.neden === "hareket_yok" ? "İlişkili stok hareketi yok" : "Hareket var, kayıtlı maliyet sıfır"}{s.guncelStokEksi && <><br /><small>Güncel stok eksi</small></>}</td>
          <td><Button size="sm" onClick={() => guncelle({ inceleme: s.id })}>İnceleme kaydı</Button><Button size="sm" onClick={() => guncelle({ stokId: s.stokId, sayfa: "1" })}>Ürünü filtrele</Button>{veri.izinler.onizleme && <><br /><Link href={`/panel/stok/maliyet?stokId=${s.stokId}`}>Maliyet önizlemesi</Link></>}</td>
        </tr>)}{!veri.satirlar.length && <tr><td colSpan={7}>{veri.filtreOzeti.satir ? "Bu sayfada kayıt yok; ilk sayfaya dönün." : "Seçili dönem ve filtrelerde kontrol edilecek satış satırı yok."}</td></tr>}</tbody>
      </Table></Card>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <Button disabled={veri.sayfa <= 1} onClick={() => guncelle({ sayfa: String(Math.max(1, veri.sayfa - 1)) })}>Önceki</Button>
        <span>Sayfa {veri.sayfa} / {Math.max(1, veri.toplamSayfa)}</span>
        <Button disabled={veri.sayfa >= veri.toplamSayfa} onClick={() => guncelle({ sayfa: String(veri.sayfa + 1) })}>Sonraki</Button>
        {veri.sayfa > 1 && <Button onClick={() => guncelle({ sayfa: "1" })}>İlk sayfa</Button>}
      </div>
    </>}
  </div>;
}
