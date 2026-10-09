"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { MEVZUAT_TUR_TANIMLARI, MEVZUAT_TURLERI, mevzuatDegerHatalari, mevzuatDegerOzeti, type MevzuatTuru } from "@tekirextra/shared";
import { DURUM_ADI, DURUM_ROZETI, ISLEM_ADI, OLAY_ADI, tarihTR, type MevzuatDurum } from "@/lib/mevzuat-gorunum";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

type Islem = "ekle" | "degistir" | "kaldir";
interface Satir { tur: string; anahtar: string; islem: Islem; deger: Record<string, unknown> | null; oncekiDeger?: unknown; oncekiYururluk?: string | null }
interface Detay {
  id: string; no: number; baslik: string; dayanak: string; aciklama: string | null; yururlukBaslangic: string; durum: MevzuatDurum;
  retGerekcesi: string | null; yayinZamani: string | null;
  hazirlayan: { adSoyad: string }; yayinlayan: { adSoyad: string } | null;
  satirlar: Satir[]; planHatalari: string[];
  /** MVZ-06: etkilenecek taslak belge sayıları (kiracı bilgisi yok). */
  etki: { kalemler: { ad: string; taslakFatura: number; firma: number }[]; hesaplanmayan: string[] } | null;
  olaylar: { id: string; olay: string; zaman: string; kullanici: string | null; detay: Record<string, unknown> | null }[];
  izinler: { duzenle: boolean; onayaGonder: boolean; taslagaCek: boolean; yayinla: boolean; geriCevir: boolean };
}

/** Düzenleyicideki satır: alan değerleri metin olarak tutulur, kaydederken türüne çevrilir. */
interface TaslakSatir { tur: MevzuatTuru; anahtar: string; islem: Islem; alanlar: Record<string, string>; oncekiDeger?: unknown; oncekiYururluk?: string | null }

function taslagaCevir(s: Satir): TaslakSatir {
  const tanim = MEVZUAT_TUR_TANIMLARI[s.tur as MevzuatTuru];
  const alanlar: Record<string, string> = {};
  for (const a of tanim?.alanlar ?? []) {
    const v = s.deger?.[a.ad];
    alanlar[a.ad] = v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  }
  return { tur: s.tur as MevzuatTuru, anahtar: s.anahtar, islem: s.islem, alanlar, oncekiDeger: s.oncekiDeger, oncekiYururluk: s.oncekiYururluk };
}

function degereCevir(s: TaslakSatir): Record<string, unknown> | null {
  if (s.islem === "kaldir") return null;
  const deger: Record<string, unknown> = {};
  for (const a of MEVZUAT_TUR_TANIMLARI[s.tur].alanlar) {
    const metin = (s.alanlar[a.ad] ?? "").trim();
    if (!metin) continue;
    deger[a.ad] = a.tip === "oranlar" ? metin.split(/[,;\s]+/).filter(Boolean) : a.tip === "sayi" ? Number(metin.replace(",", ".")) : metin;
  }
  return deger;
}

function DegisiklikDetayi() {
  const id = useSearchParams().get("id") ?? "";
  const yonlendir = useRouter();
  const [d, setD] = useState<Detay | null>(null);
  const [satirlar, setSatirlar] = useState<TaslakSatir[]>([]);
  const [degisti, setDegisti] = useState(false);
  const [gerekce, setGerekce] = useState("");
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);

  const yansit = useCallback((v: Detay) => { setD(v); setSatirlar(v.satirlar.map(taslagaCevir)); setDegisti(false); }, []);
  const yukle = useCallback(async () => yansit(await platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}`)), [id, yansit]);
  useEffect(() => { if (id && platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [id, yukle]);

  async function calis(is: () => Promise<Detay | void>, mesaj: string) {
    setIslem(true); setHata(""); setBasari("");
    try { const v = await is(); if (v) yansit(v); else await yukle(); setBasari(mesaj); } catch (h) { setHata(h instanceof Error ? h.message : "İşlem başarısız"); } finally { setIslem(false); }
  }
  const post = (yol: string, govde?: unknown) => platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}/${yol}`, { method: "POST", body: govde ? JSON.stringify(govde) : undefined });

  function bilgiKaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    void calis(() => platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}`, { method: "PATCH", body: JSON.stringify({ baslik: v.get("baslik"), dayanak: v.get("dayanak"), yururlukBaslangic: v.get("yururlukBaslangic"), aciklama: v.get("aciklama") || null }) }), "Bilgiler kaydedildi.");
  }
  const satirlariKaydet = () => calis(() => platformApi<Detay>(`/platform/mevzuat/degisiklikler/${id}/satirlar`, {
    method: "PUT", body: JSON.stringify({ satirlar: satirlar.map((s) => ({ tur: s.tur, anahtar: s.anahtar.trim(), islem: s.islem, deger: degereCevir(s) })) }),
  }), "Kalemler kaydedildi.");
  const guncelle = (i: number, ek: Partial<TaslakSatir>) => { setSatirlar((eski) => eski.map((s, j) => (j === i ? { ...s, ...ek } : s))); setDegisti(true); };
  const satirEkle = () => { setSatirlar((eski) => [...eski, { tur: "tevkifat_kodu", anahtar: "", islem: "ekle", alanlar: {} }]); setDegisti(true); };
  const satirSil = (i: number) => { setSatirlar((eski) => eski.filter((_, j) => j !== i)); setDegisti(true); };

  if (!id) return <Alert tone="error">Değişiklik seçilmedi.</Alert>;
  if (!d) return <><Alert tone="error">{hata}</Alert><p className="muted">Yükleniyor…</p></>;
  const duzenle = d.izinler.duzenle;

  return <>
    <PageHeader title={`#${d.no} ${d.baslik}`} subtitle={`Dayanak: ${d.dayanak} · Yürürlük: ${tarihTR(d.yururlukBaslangic)} · Hazırlayan: ${d.hazirlayan.adSoyad}${d.yayinlayan ? ` · Yayınlayan: ${d.yayinlayan.adSoyad}` : ""}`} />
    <div className="row-tight"><Link href="/platform">← Değişiklikler</Link><Badge variant={DURUM_ROZETI[d.durum]}>{DURUM_ADI[d.durum]}</Badge></div>
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    {d.durum === "taslak" && d.retGerekcesi && <Alert tone="warning">Geri çevrildi: {d.retGerekcesi}</Alert>}
    {d.durum !== "yayinlandi" && d.satirlar.length > 0 && d.planHatalari.length > 0 && <Alert tone="warning"><strong>Yayınlanamaz:</strong><ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>{d.planHatalari.map((h) => <li key={h}>{h}</li>)}</ul></Alert>}

    {duzenle && <Card title="Bilgiler">
      <form className="form-grid" onSubmit={bilgiKaydet}>
        <Field label="Başlık"><Input name="baslik" defaultValue={d.baslik} required minLength={3} maxLength={200} /></Field>
        <Field label="Mevzuat dayanağı"><Input name="dayanak" defaultValue={d.dayanak} required minLength={5} maxLength={500} /></Field>
        <Field label="Yürürlük başlangıcı"><Input name="yururlukBaslangic" type="date" defaultValue={d.yururlukBaslangic} required /></Field>
        <Field label="Açıklama"><Input name="aciklama" defaultValue={d.aciklama ?? ""} maxLength={2000} /></Field>
        <div><Button type="submit" disabled={islem}>Bilgileri kaydet</Button></div>
      </form>
    </Card>}

    <Card title="Kalemler" pad={false} actions={duzenle ? <div className="row-tight"><Button size="sm" onClick={satirEkle}>+ Kalem</Button><Button size="sm" variant="primary" disabled={islem || !degisti} onClick={() => void satirlariKaydet()}>Kalemleri kaydet</Button></div> : undefined}>
      <TableWrap>
        <thead><tr><th>Tür</th><th>Anahtar</th><th>İşlem</th><th>Yeni değer</th><th>Önceki değer</th>{duzenle && <th />}</tr></thead>
        <tbody>
          {satirlar.map((s, i) => {
            const tanim = MEVZUAT_TUR_TANIMLARI[s.tur];
            const sorunlar = s.islem === "kaldir" || !s.anahtar ? [] : mevzuatDegerHatalari(s.tur, s.anahtar.trim(), degereCevir(s));
            return <tr key={i}>
              <td>{duzenle
                ? <Select aria-label="Tür" value={s.tur} onChange={(e) => guncelle(i, { tur: e.target.value as MevzuatTuru, anahtar: "", alanlar: {} })}>{MEVZUAT_TURLERI.map((t) => <option key={t} value={t}>{MEVZUAT_TUR_TANIMLARI[t].ad}</option>)}</Select>
                : tanim.ad}</td>
              <td>{duzenle
                ? tanim.anahtarSecenekleri
                  ? <Select aria-label={tanim.anahtarEtiketi} value={s.anahtar} onChange={(e) => guncelle(i, { anahtar: e.target.value })}><option value="">Seçin</option>{tanim.anahtarSecenekleri.map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select>
                  : <Input aria-label={tanim.anahtarEtiketi} value={s.anahtar} placeholder={tanim.anahtarIpucu} onChange={(e) => guncelle(i, { anahtar: e.target.value })} style={{ maxWidth: "8rem" }} />
                : <strong>{tanim.anahtarSecenekleri?.find(([k]) => k === s.anahtar)?.[1] ?? s.anahtar}</strong>}</td>
              <td>{duzenle
                ? <Select aria-label="İşlem" value={s.islem} onChange={(e) => guncelle(i, { islem: e.target.value as Islem })}>{(["ekle", "degistir", "kaldir"] as const).map((x) => <option key={x} value={x}>{ISLEM_ADI[x]}</option>)}</Select>
                : ISLEM_ADI[s.islem]}</td>
              <td>{s.islem === "kaldir" ? <span className="muted">Yürürlükten kalkar</span> : duzenle
                ? <div className="mevzuat-deger">
                    {tanim.alanlar.map((a) => a.tip === "secim"
                      ? <Select key={a.ad} aria-label={a.etiket} value={s.alanlar[a.ad] ?? ""} onChange={(e) => guncelle(i, { alanlar: { ...s.alanlar, [a.ad]: e.target.value } })}><option value="">{a.etiket}</option>{a.secenekler?.map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}</Select>
                      : <Input key={a.ad} aria-label={a.etiket} placeholder={`${a.etiket}${a.ipucu ? ` (${a.ipucu})` : ""}${a.zorunlu ? "" : " — isteğe bağlı"}`} value={s.alanlar[a.ad] ?? ""} onChange={(e) => guncelle(i, { alanlar: { ...s.alanlar, [a.ad]: e.target.value } })} />)}
                    {sorunlar.length > 0 && <span className="is-negative" style={{ fontSize: "0.8rem" }}>{sorunlar[0]}</span>}
                  </div>
                : mevzuatDegerOzeti(s.tur, degereCevir(s))}</td>
              <td className="mevzuat-onceki">{s.oncekiDeger ? <>{mevzuatDegerOzeti(s.tur, s.oncekiDeger)}<br />{tarihTR(s.oncekiYururluk ?? null)}'den beri</> : "—"}</td>
              {duzenle && <td><Button size="sm" variant="danger" onClick={() => satirSil(i)}>Sil</Button></td>}
            </tr>;
          })}
          {!satirlar.length && <tr><td colSpan={6}>Henüz kalem yok.</td></tr>}
        </tbody>
      </TableWrap>
      {duzenle && degisti && <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>Kaydedilmemiş değişiklik var; onaya göndermeden önce kalemleri kaydedin.</p>}
    </Card>

    <Card title="Onay ve yayın">
      {d.etki && d.satirlar.length > 0 && <div style={{ marginBottom: "1rem" }}>
        <strong>Etki</strong>
        <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
          {d.etki.kalemler.map((k) => <li key={k.ad}>{k.ad}: yürürlük tarihinden sonraki <strong>{k.taslakFatura}</strong> taslak fatura ({k.firma} firma) bir sonraki kaydedişte yeni değerle hesaplanır. Kesinleşmiş belgeler değişmez.</li>)}
          {!d.etki.kalemler.length && !d.etki.hesaplanmayan.length && <li>Yalnız yeni kalem ekleniyor; mevcut belgeler etkilenmez.</li>}
          {d.etki.hesaplanmayan.map((t) => <li key={t} className="muted">{MEVZUAT_TUR_TANIMLARI[t as MevzuatTuru]?.ad ?? t}: etki hesabı bu tür merkeze bağlandığında eklenecek.</li>)}
        </ul>
      </div>}
      <div className="row-tight">
        {d.izinler.onayaGonder && <Button variant="primary" disabled={islem || degisti} onClick={() => void calis(() => post("onaya-gonder"), "Onaya gönderildi. Başka bir platform yetkilisi yayınlayacak.")}>Onaya gönder</Button>}
        {d.izinler.taslagaCek && <Button disabled={islem} onClick={() => void calis(() => post("taslaga-cek"), "Taslağa çekildi.")}>Taslağa çek</Button>}
        {d.izinler.yayinla && <Button variant="primary" disabled={islem || d.planHatalari.length > 0} onClick={() => { if (window.confirm(`#${d.no} ${d.baslik} yayınlanacak ve ${tarihTR(d.yururlukBaslangic)} tarihinden itibaren tüm kiracılar için geçerli olacak. Yayınlanan değişiklik geri alınamaz. Devam edilsin mi?`)) void calis(async () => (await platformApi<{ degisiklik: Detay }>(`/platform/mevzuat/degisiklikler/${id}/yayinla`, { method: "POST" })).degisiklik, "Yayınlandı. Kiracılara bildirim bir sonraki taramada düşer."); }}>Yayınla</Button>}
        {d.izinler.duzenle && <Button variant="danger" disabled={islem} onClick={() => { if (window.confirm("Taslak silinsin mi?")) void calis(async () => { await platformApi(`/platform/mevzuat/degisiklikler/${id}`, { method: "DELETE" }); yonlendir.replace("/platform"); }, "Silindi."); }}>Taslağı sil</Button>}
      </div>
      {d.izinler.geriCevir && <div className="form-grid" style={{ marginTop: "1rem" }}>
        <Field label="Geri çevirme gerekçesi"><Input value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="ör. dayanak sayısı eksik, 603 oranı kılavuzla tutmuyor" /></Field>
        <div><Button variant="danger" disabled={islem || gerekce.trim().length < 5} onClick={() => void calis(() => post("geri-cevir", { gerekce }), "Geri çevrildi; hazırlayan düzeltecek.")}>Geri çevir</Button></div>
      </div>}
      {d.durum === "onay_bekliyor" && !d.izinler.yayinla && <p className="muted">Bu değişikliği siz hazırladınız ya da düzenlediniz; dört göz ilkesi gereği başka bir platform yetkilisi yayınlamalı.</p>}
      {d.durum === "yayinlandi" && <p className="muted">Yayınlandı: {d.yayinZamani ? new Date(d.yayinZamani).toLocaleString("tr-TR") : ""}. Yayınlanan değişiklik değiştirilemez; düzeltme yeni bir değişiklikle yapılır.</p>}
    </Card>

    <Card title="Geçmiş">
      <ul className="mevzuat-olaylar">
        {d.olaylar.map((o) => <li key={o.id}><time>{new Date(o.zaman).toLocaleString("tr-TR")}</time><span><strong>{o.kullanici ?? "Sistem"}</strong> — {OLAY_ADI[o.olay] ?? o.olay}{o.olay === "geri_cevrildi" && o.detay?.gerekce ? `: ${String(o.detay.gerekce)}` : ""}</span></li>)}
      </ul>
    </Card>
  </>;
}

export default function DegisiklikSayfasi() {
  return <Suspense fallback={<p className="muted">Yükleniyor…</p>}><DegisiklikDetayi /></Suspense>;
}
