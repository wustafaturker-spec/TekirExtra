"use client";

/**
 * Vadesi gelen borçlardan toplu talimat (ENT-07): seçilen tarihe kadar vadesi
 * gelen ödenecek faturalar carilere göre listelenir; işaretlenenler için cari
 * başına bir talimat oluşur. Açık talimatlardaki tutar zaten düşülmüştür.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Button, Field, Input, Para, Select, Tarih } from "@/components/ui";
import { ibanBicimle, type Banka } from "./tipler";
import type { AdayCari } from "./yeni-talimat";

export function TopluTalimat({ bankalar, onKaydedildi }: { bankalar: Banka[]; onKaydedildi: (mesaj: string) => void }) {
  const [bankaHesapId, setBankaHesapId] = useState(bankalar[0]?.id ?? "");
  const [vadeBitis, setVadeBitis] = useState(bugunTR());
  const [odemeTarihi, setOdemeTarihi] = useState(bugunTR());
  const [adaylar, setAdaylar] = useState<AdayCari[]>([]);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [ibanlar, setIbanlar] = useState<Record<string, string>>({});
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const hesap = bankalar.find((b) => b.id === bankaHesapId);

  const yukle = useCallback(async () => {
    if (!bankaHesapId) return;
    setYukleniyor(true); setHata("");
    try {
      const liste = await api<AdayCari[]>(`/kasa-banka/odeme-talimatlari/aday-borclar?bankaHesapId=${bankaHesapId}&vadeBitis=${vadeBitis}`);
      setAdaylar(liste);
      // Varsayılan: IBAN'ı olan carilerin bütün faturaları seçili.
      setSecili(new Set(liste.filter((a) => a.bankaHesaplari.length).flatMap((a) => a.faturalar.map((f) => f.id))));
      setIbanlar(Object.fromEntries(liste.map((a) => [a.cari.id, a.bankaHesaplari[0]?.id ?? ""])));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Borçlar yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [bankaHesapId, vadeBitis]);
  useEffect(() => { void yukle(); }, [yukle]);

  const kalemler = useMemo(() => adaylar
    .map((a) => ({ a, faturalar: a.faturalar.filter((f) => secili.has(f.id)) }))
    .filter((x) => x.faturalar.length), [adaylar, secili]);
  const toplam = kalemler.reduce((s, x) => s + x.faturalar.reduce((t, f) => t + Number(f.kalan), 0), 0);
  const ibansiz = kalemler.filter((x) => !ibanlar[x.a.cari.id]);

  async function olustur() {
    setHata("");
    try {
      const sonuc = await api<{ adet: number; toplam: string }>("/kasa-banka/odeme-talimatlari/toplu", {
        method: "POST",
        body: JSON.stringify({
          bankaHesapId, odemeTarihi,
          kalemler: kalemler.map((x) => ({ cariId: x.a.cari.id, cariBankaHesapId: ibanlar[x.a.cari.id], faturalar: x.faturalar.map((f) => ({ faturaId: f.id, tutar: f.kalan })) })),
        }),
      });
      onKaydedildi(`${sonuc.adet} talimat (${Number(sonuc.toplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${hesap?.dovizCinsi}) oluşturuldu ve onaya gönderildi.`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Talimatlar oluşturulamadı");
    }
  }

  return (
    <section className="ot-form">
      <div className="ot-form__grid">
        <Field label="Kaynak banka hesabı">
          <Select value={bankaHesapId} onChange={(e) => setBankaHesapId(e.target.value)}>
            {bankalar.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {b.ad} · {b.dovizCinsi}</option>)}
          </Select>
        </Field>
        <Field label="Bu tarihe kadar vadesi gelenler"><Input type="date" value={vadeBitis} onChange={(e) => setVadeBitis(e.target.value)} /></Field>
        <Field label="Ödeme (valör) tarihi"><Input type="date" value={odemeTarihi} onChange={(e) => setOdemeTarihi(e.target.value)} /></Field>
      </div>

      {yukleniyor ? <p className="ot-note">Yükleniyor…</p> : (
        <div className="ot-groups">
          {adaylar.map((a) => {
            const ids = a.faturalar.map((f) => f.id);
            const hepsi = ids.every((id) => secili.has(id));
            return (
              <div key={a.cari.id} className={`ot-group${a.bankaHesaplari.length ? "" : " is-noiban"}`}>
                <header>
                  <label><input type="checkbox" checked={hepsi} onChange={(e) => setSecili((s) => { const y = new Set(s); ids.forEach((id) => (e.target.checked ? y.add(id) : y.delete(id))); return y; })} /> <strong>{a.cari.unvan}</strong> <small>{a.cari.kod}</small></label>
                  {a.bankaHesaplari.length ? (
                    <Select aria-label="IBAN" value={ibanlar[a.cari.id] ?? ""} onChange={(e) => setIbanlar((m) => ({ ...m, [a.cari.id]: e.target.value }))}>
                      {a.bankaHesaplari.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {ibanBicimle(b.iban)}</option>)}
                    </Select>
                  ) : <span className="ot-warn">IBAN kayıtlı değil — cari kartına ekleyin</span>}
                  <b><Para deger={a.toplam} dovizCinsi={hesap?.dovizCinsi} /></b>
                </header>
                {a.faturalar.map((f) => (
                  <label key={f.id} className="ot-group__row">
                    <input type="checkbox" checked={secili.has(f.id)} onChange={(e) => setSecili((s) => { const y = new Set(s); if (e.target.checked) y.add(f.id); else y.delete(f.id); return y; })} />
                    <span>{f.no ?? "Numarasız"}{f.tip === "satis_iade" ? " · satış iadesi" : ""}</span>
                    <span className={f.vadeTarihi < bugunTR() ? "ot-late" : undefined}>vade <Tarih deger={f.vadeTarihi} /></span>
                    <span><Para deger={f.kalan} dovizCinsi={hesap?.dovizCinsi} /></span>
                  </label>
                ))}
              </div>
            );
          })}
          {!adaylar.length && <p className="ot-note">Bu tarihe kadar vadesi gelen, ödenmemiş ve talimata bağlanmamış borç yok.</p>}
        </div>
      )}

      {hata && <p className="ot-warn">{hata}</p>}
      <footer className="ot-form__foot">
        <div className="ot-form__sum">
          <span>{kalemler.length} cari · {kalemler.reduce((s, x) => s + x.faturalar.length, 0)} fatura</span>
          <span>Toplam <b><Para deger={toplam} dovizCinsi={hesap?.dovizCinsi} /></b></span>
          {ibansiz.length > 0 && <span className="ot-warn">{ibansiz.length} carinin IBAN'ı yok; seçimden çıkarın ya da IBAN ekleyin</span>}
        </div>
        <Button variant="primary" disabled={!kalemler.length || ibansiz.length > 0} onClick={() => void olustur()}>Seçilenler için talimat oluştur</Button>
      </footer>
    </section>
  );
}
