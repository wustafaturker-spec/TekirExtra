"use client";

import { useEffect, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input, Para, Segmented, Select, TableWrap } from "@/components/ui";
import { SINIFLAR, sayi, type FaturaSatirSecenegi, type ListeKalemi, type Sinif } from "./ortak";

type Kaynak = "fatura" | "elle" | "acilis";
interface Sinirlar { dogrudanGider: number | null; binek: number | null; binekVergili: number | null; defterTuru: "bilanco" | "isletme" }

/**
 * DMR-01/02/03/11: yeni demirbaş kartı. Alış faturasının satırından (adet
 * başına bölünebilir), elle ya da açılış kaydı olarak açılır. Doğrudan gider
 * sınırı uyarısı sunucudan gelir; kullanıcı görüp yine de açabilir.
 */
export function KartFormu({ liste, onKaydedildi }: { liste: ListeKalemi[]; onKaydedildi: (id: string) => void }) {
  const [kaynak, setKaynak] = useState<Kaynak>("fatura");
  const [faturaNo, setFaturaNo] = useState("");
  const [faturalar, setFaturalar] = useState<FaturaSatirSecenegi[] | null>(null);
  const [satir, setSatir] = useState<{ id: string; ad: string; tutarTl: string; miktar: number; tarih: string } | null>(null);
  const [f, setF] = useState({
    ad: "", sinif: "demirbas" as Sinif, listeKodu: "", faydaliOmur: "5", yontem: "normal" as "normal" | "azalan",
    binekOto: false, binekVergili: false, binekSinirYok: false, edinmeTarihi: bugunTR(), edinmeBedeli: "", adet: "1",
    acilisBirikmis: "0", acilisSonYil: String(Number(bugunTR().slice(0, 4)) - 1), seriNo: "", konum: "", aciklama: "", hesapKodu: "", giderHesapKodu: "",
  });
  const [sinirlar, setSinirlar] = useState<Sinirlar | null>(null);
  const [uyarilar, setUyarilar] = useState<string[]>([]);
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const guncelle = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setUyarilar([]); };

  const edinmeYili = (satir?.tarih ?? f.edinmeTarihi).slice(0, 4);
  useEffect(() => {
    if (!/^\d{4}$/.test(edinmeYili)) return;
    void api<Sinirlar>(`/demirbas/sinirlar?yil=${edinmeYili}`).then(setSinirlar).catch(() => setSinirlar(null));
  }, [edinmeYili]);

  async function faturaAra(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    try { setFaturalar(await api<FaturaSatirSecenegi[]>(`/demirbas/fatura-satirlari?tip=alis&no=${encodeURIComponent(faturaNo)}`)); }
    catch (h) { setHata(h instanceof ApiHata ? h.message : "Fatura aranamadı"); }
  }

  function listeSec(kod: string) {
    const k = liste.find((x) => x.kod === kod);
    if (!k) return guncelle({ listeKodu: "" });
    guncelle({ listeKodu: kod, sinif: k.sinif, faydaliOmur: String(k.omur), binekOto: Boolean(k.binekOto), yontem: k.binekOto ? "normal" : f.yontem });
  }

  async function kaydet(kabul = false) {
    setHata("");
    setIsleniyor(true);
    try {
      const govde = {
        ad: f.ad.trim(), sinif: f.sinif, listeKodu: f.listeKodu || null, faydaliOmur: Number(f.faydaliOmur), yontem: f.yontem,
        binekOto: f.binekOto, binekVergili: f.binekOto && f.binekVergili, binekSinirYok: f.binekOto && f.binekSinirYok,
        seriNo: f.seriNo || null, konum: f.konum || null, aciklama: f.aciklama || null, hesapKodu: f.hesapKodu || null, giderHesapKodu: f.giderHesapKodu || null,
        uyarilariKabulEt: kabul,
        ...(kaynak === "fatura"
          ? { faturaSatirId: satir?.id, adet: Number(f.adet) || 1 }
          : { edinmeTarihi: f.edinmeTarihi, edinmeBedeli: sayi(f.edinmeBedeli) }),
        ...(kaynak === "acilis" ? { acilis: true, acilisBirikmis: sayi(f.acilisBirikmis), acilisSonYil: sayi(f.acilisBirikmis) > 0 ? Number(f.acilisSonYil) : null } : {}),
      };
      const sonuc = await api<{ olusturuldu: boolean; idler?: string[]; uyarilar: string[] }>("/demirbas", { method: "POST", body: JSON.stringify(govde) });
      if (!sonuc.olusturuldu) { setUyarilar(sonuc.uyarilar); return; }
      onKaydedildi(sonuc.idler![0]);
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Kart açılamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  const azalanOlmaz = f.binekOto || sinirlar?.defterTuru === "isletme";
  const bedel = kaynak === "fatura" ? sayi(satir?.tutarTl ?? "0") / (Number(f.adet) || 1) : sayi(f.edinmeBedeli);
  const binekSiniri = f.binekOto && !f.binekSinirYok ? (f.binekVergili ? sinirlar?.binekVergili : sinirlar?.binek) : null;
  const hazir = f.ad.trim() && Number(f.faydaliOmur) > 0 && (kaynak === "fatura" ? Boolean(satir) : bedel > 0 && f.edinmeTarihi);

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void kaydet(false); }}>
      {hata && <Alert tone="error">{hata}</Alert>}
      <Segmented ariaLabel="Kartın kaynağı" value={kaynak} onChange={(k) => { setKaynak(k); setUyarilar([]); }}
        items={[{ deger: "fatura", baslik: "Alış faturasından" }, { deger: "elle", baslik: "Elle" }, { deger: "acilis", baslik: "Açılış kaydı (sistem öncesi)" }]} />

      {kaynak === "fatura" && (
        <div className="stack">
          <div className="row-tight">
            <Field label="Kesin alış faturası no"><Input value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} placeholder="ör. ABC2026000000012" /></Field>
            <Button type="button" onClick={(e) => void faturaAra(e)} disabled={faturaNo.trim().length < 3}>Ara</Button>
          </div>
          {faturalar && faturalar.length === 0 && <p className="muted">Bu numarayla kesinleşmiş alış faturası bulunamadı.</p>}
          {faturalar?.map((fa) => (
            <TableWrap key={fa.id}>
              <table className="table">
                <caption className="demirbas__fatura-baslik">{fa.no ?? "(numarasız)"} · {fa.tarih} · {fa.cari}{fa.dovizCinsi !== "TRY" ? ` · ${fa.dovizCinsi}` : ""}</caption>
                <thead><tr><th /><th>Kalem</th><th>Miktar</th><th className="num">TL tutar</th><th>Bağlı kart</th></tr></thead>
                <tbody>
                  {fa.satirlar.map((s) => (
                    <tr key={s.id}>
                      <td><input type="radio" name="satir" aria-label={s.stokAdi} disabled={s.bagliKartlar.length > 0} checked={satir?.id === s.id}
                        onChange={() => { setSatir({ id: s.id, ad: s.stokAdi, tutarTl: s.tutarTl, miktar: Number(s.miktar), tarih: fa.tarih }); setF({ ...f, ad: f.ad || s.stokAdi, adet: String(Number.isInteger(Number(s.miktar)) && Number(s.miktar) <= 500 ? Number(s.miktar) : 1) }); setUyarilar([]); }} /></td>
                      <td>{s.stokAdi}{s.stokTipi === "urun" && <small className="muted"> · ürün kartı</small>}</td>
                      <td>{Number(s.miktar).toLocaleString("tr-TR")} {s.birim}</td>
                      <td className="num"><Para deger={s.tutarTl} /></td>
                      <td>{s.bagliKartlar.map((k) => k.kod).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ))}
          {satir && satir.miktar > 1 && (
            <Field label={`Kaç karta bölünsün? (satırda ${satir.miktar.toLocaleString("tr-TR")} adet)`}>
              <Input type="number" min={1} max={500} value={f.adet} onChange={(e) => guncelle({ adet: e.target.value })} />
            </Field>
          )}
        </div>
      )}

      <div className="form-grid form-grid--2">
        <Field label="Ad"><Input required value={f.ad} onChange={(e) => guncelle({ ad: e.target.value })} /></Field>
        <Field label="Amortisman listesi (VUK)">
          <Select value={f.listeKodu} onChange={(e) => listeSec(e.target.value)}>
            <option value="">Listede yok / elle ömür</option>
            {liste.map((k) => <option key={k.kod} value={k.kod}>{k.kod} · {k.ad} ({k.omur} yıl)</option>)}
          </Select>
        </Field>
        <Field label="Sınıf">
          <Select value={f.sinif} onChange={(e) => guncelle({ sinif: e.target.value as Sinif })}>
            {Object.entries(SINIFLAR).map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}
          </Select>
        </Field>
        <Field label={`Faydalı ömür (yıl) · oran %${(100 / (Number(f.faydaliOmur) || 1)).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`}>
          <Input type="number" min={1} max={100} required value={f.faydaliOmur} onChange={(e) => guncelle({ faydaliOmur: e.target.value })} />
        </Field>
        <Field label="Yöntem">
          <Select value={f.yontem} onChange={(e) => guncelle({ yontem: e.target.value as "normal" | "azalan" })}>
            <option value="normal">Normal</option>
            <option value="azalan" disabled={azalanOlmaz}>Azalan bakiyeler{azalanOlmaz ? (f.binekOto ? " (binek otoda yok)" : " (yalnız bilanço esası)") : ""}</option>
          </Select>
        </Field>
        {kaynak !== "fatura" && <>
          <Field label="Edinme tarihi"><Input type="date" required value={f.edinmeTarihi} onChange={(e) => guncelle({ edinmeTarihi: e.target.value })} /></Field>
          <Field label="Bedel (TL, amortismana esas)"><Input inputMode="decimal" required value={f.edinmeBedeli} onChange={(e) => guncelle({ edinmeBedeli: e.target.value })} /></Field>
        </>}
        {kaynak === "acilis" && <>
          <Field label="Bugüne kadar ayrılmış birikmiş amortisman (TL)"><Input inputMode="decimal" value={f.acilisBirikmis} onChange={(e) => guncelle({ acilisBirikmis: e.target.value })} /></Field>
          <Field label="Birikmişin son yılı"><Input type="number" min={1950} max={2100} value={f.acilisSonYil} onChange={(e) => guncelle({ acilisSonYil: e.target.value })} /></Field>
        </>}
        <Field label="Seri no / plaka"><Input value={f.seriNo} onChange={(e) => guncelle({ seriNo: e.target.value })} /></Field>
        <Field label="Konum"><Input value={f.konum} onChange={(e) => guncelle({ konum: e.target.value })} /></Field>
      </div>

      <fieldset className="demirbas__binek">
        <label><input type="checkbox" checked={f.binekOto} onChange={(e) => guncelle({ binekOto: e.target.checked, yontem: e.target.checked ? "normal" : f.yontem })} /> Binek otomobil (ilk yıl kıst, GVK 40/5 sınırı)</label>
        {f.binekOto && <>
          <label><input type="checkbox" checked={f.binekVergili} onChange={(e) => guncelle({ binekVergili: e.target.checked })} /> ÖTV/KDV maliyete eklendi ya da ikinci el</label>
          <label><input type="checkbox" checked={f.binekSinirYok} onChange={(e) => guncelle({ binekSinirYok: e.target.checked })} /> Faaliyetimiz binek oto kiralama/işletme — sınır uygulanmaz</label>
          {binekSiniri != null && <p className="muted">{edinmeYili} sınırı: <Para deger={binekSiniri} /> {bedel > binekSiniri ? "— bedel sınırı aşıyor, aşan kısmın amortismanı KKEG olarak ayrılır." : ""}</p>}
          {binekSiniri == null && !f.binekSinirYok && sinirlar && <p className="muted">{edinmeYili} için Mevzuat Merkezi'nde binek sınırı yok; KKEG hesaplanmaz.</p>}
        </>}
      </fieldset>

      <details>
        <summary>Muhasebe hesapları ve açıklama</summary>
        <div className="form-grid form-grid--2">
          <Field label="Varlık hesabı (boşsa sınıfın hesabı)"><Input value={f.hesapKodu} onChange={(e) => guncelle({ hesapKodu: e.target.value })} placeholder="ör. 255.01" /></Field>
          <Field label="Amortisman gider hesabı (boşsa 770)"><Input value={f.giderHesapKodu} onChange={(e) => guncelle({ giderHesapKodu: e.target.value })} placeholder="ör. 730.01" /></Field>
          <Field label="Açıklama" className="span-2"><Input value={f.aciklama} onChange={(e) => guncelle({ aciklama: e.target.value })} /></Field>
        </div>
      </details>

      {uyarilar.length > 0 && (
        <Alert tone="warning">
          <ul>{uyarilar.map((u) => <li key={u}>{u}</li>)}</ul>
          <div className="row-tight"><Button type="button" variant="primary" disabled={isleniyor} onClick={() => void kaydet(true)}>Yine de demirbaş olarak aç</Button></div>
        </Alert>
      )}
      {uyarilar.length === 0 && <div className="row-tight" style={{ justifyContent: "flex-end" }}><Button type="submit" variant="primary" disabled={!hazir || isleniyor}>{isleniyor ? "Kaydediliyor…" : "Kartı aç"}</Button></div>}
    </form>
  );
}
