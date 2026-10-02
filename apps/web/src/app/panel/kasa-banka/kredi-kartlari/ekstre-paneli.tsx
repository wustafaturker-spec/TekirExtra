"use client";

/**
 * Kartın dönem ekstreleri (KSB-10). Üstte dönem şeridi (yeniden eskiye,
 * gelecek taksit dönemleri dahil), altta seçili dönemin özeti, bankayla
 * kesinleştirme ve kalemleri. Kaleme tıklanınca hareket ayrıntısı ve geri
 * alma açılır.
 */
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GeriAlmaFormu, type GeriAlmaYontemi } from "@/components/geri-alma-formu";
import { Alert, Badge, Button, Field, Input, Para, TableWrap, Tarih } from "@/components/ui";
import { ayAdi, DURUM, TIP_ADI, type DonemOzeti, type EkstreAyrintisi, type Kart } from "./tipler";

export function EkstrePaneli({ kart, yenile, onMesaj }: { kart: Kart; yenile: number; onMesaj: (mesaj: string, hata?: boolean) => void }) {
  const [donemler, setDonemler] = useState<DonemOzeti[]>([]);
  const [secili, setSecili] = useState<string | null>(null);
  const [ayrinti, setAyrinti] = useState<EkstreAyrintisi | null>(null);
  const [seciliHareket, setSeciliHareket] = useState<string | null>(null);
  const [geriAl, setGeriAl] = useState(false);
  const [bankaTutari, setBankaTutari] = useState("");
  const [bankaAsgari, setBankaAsgari] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [icYenile, setIcYenile] = useState(0);

  useEffect(() => {
    void api<DonemOzeti[]>(`/kasa-banka/kredi-kartlari/${kart.id}/ekstreler`).then((liste) => {
      setDonemler(liste);
      // Varsayılan: son kesilen ekstre; yoksa açık dönem.
      setSecili((onceki) => (onceki && liste.some((d) => d.kesimTarihi === onceki) ? onceki : (liste.find((d) => d.tur === "kesilmis") ?? liste.find((d) => d.tur === "acik") ?? liste[0])?.kesimTarihi ?? null));
    }).catch((e) => onMesaj(e instanceof Error ? e.message : "Ekstreler yüklenemedi", true));
  }, [kart.id, yenile, icYenile, onMesaj]);

  const ayrintiYukle = useCallback(async () => {
    if (!secili) { setAyrinti(null); return; }
    try {
      const veri = await api<EkstreAyrintisi>(`/kasa-banka/kredi-kartlari/${kart.id}/ekstreler/${secili}`);
      setAyrinti(veri);
      setBankaTutari(veri.hesaplananBorc);
      setBankaAsgari("");
    } catch (e) {
      onMesaj(e instanceof Error ? e.message : "Ekstre yüklenemedi", true);
    }
  }, [kart.id, secili, onMesaj]);
  useEffect(() => { void ayrintiYukle(); setSeciliHareket(null); setGeriAl(false); }, [ayrintiYukle, yenile, icYenile]);

  async function kesinlestir(e: FormEvent) {
    e.preventDefault();
    if (!ayrinti) return;
    setIsleniyor(true);
    try {
      const sonuc = await api<{ fark: string }>(`/kasa-banka/kredi-kartlari/${kart.id}/ekstreler/${ayrinti.kesimTarihi}/kesinlestir`, {
        method: "POST", body: JSON.stringify({ bankaTutari, bankaAsgariTutari: bankaAsgari || null }),
      });
      const fark = Number(sonuc.fark);
      onMesaj(`${ayAdi(ayrinti.kesimTarihi)} ekstresi bankayla kesinleşti.${Math.abs(fark) >= 0.01 ? ` Banka tutarı hesaplanandan ${Math.abs(fark).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${kart.dovizCinsi} ${fark > 0 ? "fazla" : "az"}; eksik faiz/ücret varsa hareket olarak girin.` : ""}`);
      setIcYenile((x) => x + 1);
    } catch (err) {
      onMesaj(err instanceof Error ? err.message : "Ekstre kesinleştirilemedi", true);
    } finally {
      setIsleniyor(false);
    }
  }

  async function kesinlestirmeyiGeriAl() {
    if (!ayrinti) return;
    setIsleniyor(true);
    try {
      await api(`/kasa-banka/kredi-kartlari/${kart.id}/ekstreler/${ayrinti.kesimTarihi}/kesinlestir`, { method: "DELETE" });
      onMesaj("Kesinleştirme geri alındı; ekstre yeniden hareketlerden hesaplanıyor.");
      setIcYenile((x) => x + 1);
    } catch (err) {
      onMesaj(err instanceof Error ? err.message : "Kesinleştirme geri alınamadı", true);
    } finally {
      setIsleniyor(false);
    }
  }

  const sonKesinlesen = donemler.find((d) => d.kesinlesti)?.kesimTarihi;
  const hareket = ayrinti?.hareketler.find((h) => h.id === seciliHareket) ?? null;
  const fark = ayrinti ? Number(bankaTutari || 0) - Number(ayrinti.hesaplananBorc) : 0;
  const d = kart.dovizCinsi;

  return (
    <section className="cc-statement" aria-label="Dönem ekstreleri">
      <div className="cc-statement__strip" role="tablist" aria-label="Dönemler">
        {donemler.map((x) => (
          <button key={x.kesimTarihi} role="tab" type="button" aria-selected={x.kesimTarihi === secili} className={`cc-period is-${x.tur}${x.kesimTarihi === secili ? " is-selected" : ""}`} onClick={() => setSecili(x.kesimTarihi)}>
            <span>{ayAdi(x.kesimTarihi)}</span>
            <strong><Para deger={x.tur === "gelecek" ? x.harcamalar : x.tur === "kesilmis" ? x.donemBorcu : x.harcamalar} dovizCinsi={d} /></strong>
            <small className={`is-${DURUM[x.durum].ton}`}>{x.kesinlesti ? "✓ " : ""}{DURUM[x.durum].ad}</small>
          </button>
        ))}
        {!donemler.length && <p className="cc-empty">Bu kartta henüz hareket yok.</p>}
      </div>

      {ayrinti && (
        <>
          <header className="cc-statement__head">
            <div>
              <span>{ayrinti.tur === "kesilmis" ? "KESİLEN EKSTRE" : ayrinti.tur === "acik" ? "AÇIK DÖNEM" : "GELECEK DÖNEM"}</span>
              <h3>{ayAdi(ayrinti.kesimTarihi)}</h3>
              <p><Tarih deger={ayrinti.baslangic} /> – <Tarih deger={ayrinti.kesimTarihi} /> · son ödeme <strong><Tarih deger={ayrinti.sonOdemeTarihi} /></strong></p>
            </div>
            <Badge variant={DURUM[ayrinti.durum].ton}>{DURUM[ayrinti.durum].ad}</Badge>
          </header>

          <dl className="cc-statement__sums">
            <div><dt>Devreden</dt><dd><Para deger={ayrinti.devreden} dovizCinsi={d} /></dd></div>
            <div><dt>Dönem içi ödeme</dt><dd className="is-credit">−<Para deger={ayrinti.donemIciOdeme} dovizCinsi={d} /></dd></div>
            <div><dt>Harcama ve taksitler</dt><dd><Para deger={ayrinti.harcamalar} dovizCinsi={d} /></dd></div>
            <div className="is-total"><dt>{ayrinti.tur === "kesilmis" ? "Dönem borcu" : "Birikmiş borç"}</dt><dd><Para deger={ayrinti.donemBorcu} dovizCinsi={d} /></dd></div>
            {ayrinti.tur === "kesilmis" && (
              <>
                <div><dt>Asgari ödeme</dt><dd><Para deger={ayrinti.asgari} dovizCinsi={d} /></dd></div>
                <div><dt>Kesimden sonra ödenen</dt><dd className="is-credit"><Para deger={ayrinti.odenen} dovizCinsi={d} /></dd></div>
                <div className="is-total"><dt>Kalan</dt><dd><Para deger={ayrinti.kalan} dovizCinsi={d} /></dd></div>
              </>
            )}
          </dl>

          {ayrinti.tur === "kesilmis" && !ayrinti.kesinlesti && (
            <form className="cc-reconcile" onSubmit={kesinlestir}>
              <div>
                <strong>Bankanın ekstresiyle kesinleştir</strong>
                <small>Banka ekstresindeki dönem borcunu girin. Kesinleşen ekstre sonradan girilen kayıtlarla değişmez; geç girilen kalem bir sonraki döneme düşer.</small>
              </div>
              <Field label="Ekstre dönem borcu"><Input type="number" step="0.01" required value={bankaTutari} onChange={(e) => setBankaTutari(e.target.value)} /></Field>
              <Field label="Bankanın asgari tutarı"><Input type="number" min="0" step="0.01" value={bankaAsgari} onChange={(e) => setBankaAsgari(e.target.value)} placeholder={`Hesaplanan ${Number(ayrinti.asgari).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`} /></Field>
              <div className={`cc-reconcile__diff${Math.abs(fark) >= 0.01 ? " is-off" : ""}`}>
                <span>Hesaplanana göre fark</span>
                <b>{fark > 0 ? "+" : fark < 0 ? "−" : ""}<Para deger={Math.abs(fark)} dovizCinsi={d} /></b>
              </div>
              <Button type="submit" variant="primary" disabled={isleniyor}>Kesinleştir</Button>
            </form>
          )}
          {ayrinti.kesinlesti && (
            <div className="cc-reconciled">
              <span>✓ Bankayla kesinleşti · banka tutarı <Para deger={ayrinti.bankaTutari ?? ayrinti.donemBorcu} dovizCinsi={d} />{Math.abs(Number(ayrinti.bankaTutari) - Number(ayrinti.hesaplananBorc)) >= 0.01 && <> · hesaplanan <Para deger={ayrinti.hesaplananBorc} dovizCinsi={d} /></>}</span>
              {sonKesinlesen === ayrinti.kesimTarihi && <Button size="sm" disabled={isleniyor} onClick={() => void kesinlestirmeyiGeriAl()}>Kesinleştirmeyi geri al</Button>}
            </div>
          )}

          <TableWrap>
            <thead><tr><th>Tarih</th><th>İşlem</th><th>Açıklama</th><th className="num">Tutar</th></tr></thead>
            <tbody>
              {ayrinti.kalemler.map((k) => {
                const h = ayrinti.hareketler.find((x) => x.id === k.hareketId);
                const alacak = Number(k.tutar) < 0;
                return (
                  <tr key={k.id} className={`row-link${h?.geriAlindi ? " is-reversed" : ""}${seciliHareket === k.hareketId ? " is-selected" : ""}`} tabIndex={0}
                    onClick={() => { setSeciliHareket(k.hareketId); setGeriAl(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSeciliHareket(k.hareketId); setGeriAl(false); } }}>
                    <td><Tarih deger={k.tarih} /></td>
                    <td>
                      <Badge variant={alacak ? "success" : k.tip === "harcama" ? "neutral" : "warning"}>{k.tersKayit ? "Ters kayıt" : TIP_ADI[k.tip]}</Badge>
                      {k.sira && k.taksitSayisi > 1 && <small className="cc-installment">Taksit {k.sira}/{k.taksitSayisi}</small>}
                    </td>
                    <td>
                      <strong>{k.aciklama}</strong>
                      {h?.cari && <small className="cc-installment">{h.cari.unvan}{h.fatura?.no ? ` · Fatura ${h.fatura.no}` : ""}</small>}
                      {h?.masraf && <small className="cc-installment">Masraf · {h.masraf.kategori}</small>}
                    </td>
                    <td className={`num cc-amount${alacak ? " is-credit" : ""}`}>{alacak ? "−" : "+"}<Para deger={Math.abs(Number(k.tutar))} dovizCinsi={d} /></td>
                  </tr>
                );
              })}
              {ayrinti.odemeler.map((o) => (
                <tr key={`o-${o.hareketId}`} className={`row-link cc-payment-row${seciliHareket === o.hareketId ? " is-selected" : ""}`} tabIndex={0} onClick={() => { setSeciliHareket(o.hareketId); setGeriAl(false); }}>
                  <td><Tarih deger={o.tarih} /></td>
                  <td><Badge variant="success">{Number(o.tutar) < 0 ? "Ödeme tersi" : "Ödeme"}</Badge></td>
                  <td><strong>{o.aciklama}</strong><small className="cc-installment">Dönem içinde yapılan ekstre ödemesi</small></td>
                  <td className="num cc-amount is-credit">−<Para deger={o.tutar} dovizCinsi={d} /></td>
                </tr>
              ))}
              {!ayrinti.kalemler.length && !ayrinti.odemeler.length && <tr><td colSpan={4} className="empty">Bu döneme düşen kalem yok.</td></tr>}
            </tbody>
          </TableWrap>

          {hareket && (
            <div className="cc-movement-detail">
              <div className="between">
                <div>
                  <strong>{hareket.aciklama}</strong>
                  <small><Tarih deger={hareket.tarih} /> · {TIP_ADI[hareket.tip]}{hareket.cari ? ` · ${hareket.cari.unvan}` : ""} · <Para deger={hareket.tutar} dovizCinsi={d} />{hareket.taksitSayisi > 1 ? ` · ${hareket.taksitSayisi} taksit` : ""}</small>
                </div>
                <div className="row-tight">
                  {!hareket.geriAlinanHareketId && !hareket.geriAlindi && (!hareket.masraf || hareket.masraf.kaynakTur === "kredi_karti") && !geriAl && <Button size="sm" variant="danger" onClick={() => setGeriAl(true)}>Geri al</Button>}
                  <Button size="sm" onClick={() => { setSeciliHareket(null); setGeriAl(false); }}>Kapat</Button>
                </div>
              </div>
              {hareket.geriAlinanHareketId && <Alert tone="warning">Bu kayıt bir hareketin ters kaydıdır.</Alert>}
              {hareket.geriAlindi && <Alert tone="warning">Bu hareket ters kayıtla geri alındı.</Alert>}
              {hareket.masraf?.kaynakTur === "manuel" && <p className="slip-detail__note">Bu harcama Masraflar ekranında kartla ödendi; düzeltme ve geri alma oradan yapılır.</p>}
              {geriAl && (
                <GeriAlmaFormu<{ yontem: GeriAlmaYontemi; ekstreKesinlesti?: boolean }>
                  baslik="Hareketi geri al"
                  uc={`/kasa-banka/kredi-kartlari/hareketler/${hareket.id}/geri-al`}
                  aciklama={<>
                    {hareket.ekstresiKesinlesti && "Ekstresi bankayla kesinleştiği için hareket silinmez; bugün tarihli ters kayıt atılır ve açık döneme düşer. "}
                    {hareket.tip === "odeme" && "Ekstre ödemesinin banka fişi de geri alınır. "}
                    {hareket.cari && "Cariye yazılan ödeme de geri alınır. "}
                    {hareket.masraf && "Bağlı gider (masraf) kaydı da silinir. "}
                    {hareket.taksitSayisi > 1 && "Vadesi gelmemiş taksitler plandan kaldırılır."}
                  </>}
                  onVazgec={() => setGeriAl(false)}
                  onTamam={(sonuc) => {
                    setSeciliHareket(null);
                    setGeriAl(false);
                    onMesaj(sonuc.yontem === "silindi" ? "Kredi kartı hareketi geri alındı ve silindi." : sonuc.ekstreKesinlesti ? "Ekstresi kesinleştiği için bugün tarihli ters hareket atıldı; açık döneme alacak olarak girdi." : "Dönem kapalı olduğu için bugün tarihli ters hareket atıldı; vadesi gelmemiş taksitler plandan düştü.");
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
