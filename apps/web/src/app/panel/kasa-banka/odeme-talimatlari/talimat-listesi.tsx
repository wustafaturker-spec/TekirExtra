"use client";

/**
 * Talimat listesi (ENT-07): duruma göre süzülür, satırlar seçilir. Onay
 * bekleyenler tek TOTP ile toplu onaylanır (oluşturan kendi talimatını
 * onaylayamaz); onaylılar aynı kaynak hesaptan pakete alınır. Satır
 * eylemleri: gerçekleşti, başarısız, iptal, gerçekleşmeyi geri al.
 */
import { useEffect, useMemo, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { GeriAlmaFormu, type GeriAlmaYontemi } from "@/components/geri-alma-formu";
import { Alert, Badge, Button, Field, Input, Para, Segmented, Tarih } from "@/components/ui";
import { DURUM, ibanBicimle, type Talimat, type TalimatDurumu } from "./tipler";

type Suzgec = TalimatDurumu | "acik" | "hepsi";

export function TalimatListesi({ userId, yenile, onMesaj, onPaketlendi }: { userId: string; yenile: number; onMesaj: (m: string, hata?: boolean) => void; onPaketlendi: () => void }) {
  const [talimatlar, setTalimatlar] = useState<Talimat[]>([]);
  const [suzgec, setSuzgec] = useState<Suzgec>("acik");
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [totp, setTotp] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [eylem, setEylem] = useState<{ id: string; tur: "gerceklesti" | "basarisiz" | "geri_al" } | null>(null);
  const [tarih, setTarih] = useState(bugunTR());
  const [icYenile, setIcYenile] = useState(0);

  useEffect(() => {
    void api<Talimat[]>("/kasa-banka/odeme-talimatlari").then((t) => { setTalimatlar(t); setSecili(new Set()); }).catch((e) => onMesaj(e instanceof Error ? e.message : "Talimatlar yüklenemedi", true));
  }, [yenile, icYenile, onMesaj]);

  const gorunen = useMemo(() => talimatlar.filter((t) => suzgec === "hepsi" || (suzgec === "acik" ? ["onay_bekliyor", "onaylandi", "gonderildi"].includes(t.durum) : t.durum === suzgec)), [talimatlar, suzgec]);
  const sayilar = useMemo(() => ({
    onay: talimatlar.filter((t) => t.durum === "onay_bekliyor").length,
    onayli: talimatlar.filter((t) => t.durum === "onaylandi" && !t.paket).length,
    gonderildi: talimatlar.filter((t) => t.durum === "gonderildi").length,
  }), [talimatlar]);
  const secililer = talimatlar.filter((t) => secili.has(t.id));
  const toplam = secililer.reduce((s, t) => s + Number(t.tutar), 0);
  const onaylanabilir = secililer.length > 0 && secililer.every((t) => t.durum === "onay_bekliyor" && t.olusturan.id !== userId);
  const paketlenebilir = secililer.length > 0 && secililer.every((t) => t.durum === "onaylandi" && !t.paket) && new Set(secililer.map((t) => t.bankaHesap.id)).size === 1;
  const kendiSecimi = secililer.some((t) => t.durum === "onay_bekliyor" && t.olusturan.id === userId);

  async function gonder(yol: string, govde: unknown, mesaj: string) {
    setIsleniyor(true);
    try {
      await api(yol, { method: "POST", body: JSON.stringify(govde) });
      onMesaj(mesaj);
      setEylem(null);
      setTotp("");
      setIcYenile((x) => x + 1);
      return true;
    } catch (e) {
      onMesaj(e instanceof Error ? e.message : "İşlem yapılamadı", true);
      return false;
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <section className="ot-list">
      <div className="ot-list__bar">
        <Segmented<Suzgec>
          ariaLabel="Durum"
          value={suzgec}
          onChange={(s) => { setSuzgec(s); setSecili(new Set()); }}
          items={[
            { deger: "acik", baslik: "Açık" },
            { deger: "onay_bekliyor", baslik: `Onay bekleyen${sayilar.onay ? ` (${sayilar.onay})` : ""}` },
            { deger: "onaylandi", baslik: `Onaylı${sayilar.onayli ? ` (${sayilar.onayli})` : ""}` },
            { deger: "gonderildi", baslik: `Gönderildi${sayilar.gonderildi ? ` (${sayilar.gonderildi})` : ""}` },
            { deger: "gerceklesti", baslik: "Gerçekleşti" },
            { deger: "hepsi", baslik: "Tümü" },
          ]}
        />
      </div>

      {secililer.length > 0 && (
        <div className="ot-selection" role="region" aria-label="Seçili talimatlar">
          <div><strong>{secililer.length} talimat · <Para deger={toplam} dovizCinsi={secililer[0].dovizCinsi} /></strong>
            <small>{kendiSecimi ? "Kendi oluşturduğunuz talimatı onaylayamazsınız (görev ayrılığı)." : onaylanabilir ? "Onay için authenticator kodunuzu girin." : paketlenebilir ? `Kaynak: ${secililer[0].bankaHesap.ad}` : secililer.some((t) => t.durum === "onaylandi") && new Set(secililer.map((t) => t.bankaHesap.id)).size > 1 ? "Bir pakette tek kaynak hesap olur." : ""}</small>
          </div>
          <div className="row-tight">
            <Button size="sm" onClick={() => setSecili(new Set())}>Seçimi temizle</Button>
            {onaylanabilir && (
              <>
                <Input aria-label="Authenticator kodu" className="ot-totp" inputMode="numeric" maxLength={6} placeholder="6 haneli kod" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} />
                <Button size="sm" variant="primary" disabled={totp.length !== 6 || isleniyor} onClick={() => void gonder("/kasa-banka/odeme-talimatlari/onayla", { idler: [...secili], totpKodu: totp }, `${secililer.length} talimat onaylandı; planlı ödeme olarak nakit akışına girdi.`)}>Onayla</Button>
              </>
            )}
            {paketlenebilir && (
              <Button size="sm" variant="primary" disabled={isleniyor} onClick={() => void gonder("/kasa-banka/odeme-paketleri", { bankaHesapId: secililer[0].bankaHesap.id, talimatIdleri: [...secili] }, `${secililer.length} talimat ödeme paketine alındı; dosyayı Ödeme paketleri sekmesinden indirin.`).then((t) => { if (t) onPaketlendi(); })}>Ödeme paketi oluştur</Button>
            )}
          </div>
        </div>
      )}

      <div className="ot-table">
        {gorunen.map((t) => {
          const secilebilir = t.durum === "onay_bekliyor" || (t.durum === "onaylandi" && !t.paket);
          const acik = eylem?.id === t.id;
          return (
            <article key={t.id} className={`ot-row${secili.has(t.id) ? " is-selected" : ""}`}>
              <div className="ot-row__main">
                <input type="checkbox" aria-label="Seç" disabled={!secilebilir} checked={secili.has(t.id)} onChange={(e) => setSecili((s) => { const y = new Set(s); if (e.target.checked) y.add(t.id); else y.delete(t.id); return y; })} />
                <span className="ot-row__no"><span className="mono">{t.no ?? "—"}</span><small><Tarih deger={t.odemeTarihi} /></small></span>
                <span className="ot-row__who">
                  <strong>{t.aliciUnvan}</strong>
                  <small className="mono">{ibanBicimle(t.aliciIban)}</small>
                  <small>{t.aciklama}{t.faturalar.length ? ` · ${t.faturalar.length} fatura` : t.cari ? " · cari bakiyesine" : ""}</small>
                </span>
                <span className="ot-row__meta">
                  <Badge variant={DURUM[t.durum].ton}>{DURUM[t.durum].ad}</Badge>
                  <small>{t.bankaHesap.ad}{t.paket ? ` · ${t.paket.no}` : ""}</small>
                  <small>{t.olusturan.adSoyad}{t.onaylayan ? ` → ${t.onaylayan.adSoyad}` : ""}</small>
                </span>
                <b className="ot-row__amount"><Para deger={t.tutar} dovizCinsi={t.dovizCinsi} /></b>
                <span className="ot-row__actions">
                  {(t.durum === "onaylandi" || t.durum === "gonderildi") && <Button size="sm" onClick={() => { setEylem({ id: t.id, tur: "gerceklesti" }); setTarih(t.odemeTarihi.slice(0, 10) > bugunTR() ? bugunTR() : t.odemeTarihi.slice(0, 10)); }}>Gerçekleşti</Button>}
                  {(t.durum === "onaylandi" || t.durum === "gonderildi") && <Button size="sm" variant="danger" onClick={() => setEylem({ id: t.id, tur: "basarisiz" })}>Başarısız</Button>}
                  {t.durum === "onay_bekliyor" && t.olusturan.id === userId && <Button size="sm" onClick={() => void gonder(`/kasa-banka/odeme-talimatlari/${t.id}/iptal`, {}, `${t.no ?? "Talimat"} iptal edildi.`)}>İptal</Button>}
                  {t.durum === "gerceklesti" && <Button size="sm" onClick={() => setEylem({ id: t.id, tur: "geri_al" })}>Geri al</Button>}
                </span>
              </div>
              {t.faturalar.length > 0 && (
                <div className="ot-row__invoices">
                  {t.faturalar.map((f) => <span key={f.fatura.id}>{f.fatura.no ?? "Numarasız"} · <Para deger={f.tutar} dovizCinsi={t.dovizCinsi} /></span>)}
                </div>
              )}
              {t.durum === "basarisiz" && t.hataMesaji && <p className="ot-row__note">Başarısız: {t.hataMesaji}</p>}
              {t.durum === "gerceklesti" && t.gerceklesmeTarihi && <p className="ot-row__note">Bankada gerçekleşti: <Tarih deger={t.gerceklesmeTarihi} /> · tediye fişi yazıldı</p>}
              {acik && eylem.tur === "gerceklesti" && (
                <div className="ot-row__form">
                  <Field label="Bankada gerçekleşme tarihi"><Input type="date" value={tarih} max={bugunTR()} onChange={(e) => setTarih(e.target.value)} /></Field>
                  <p>{t.faturalar.length ? `${t.faturalar.length} faturaya` : "Cariye"} tediye fişi yazılır{t.faturalar.length && t.faturalar.reduce((s, f) => s + Number(f.tutar), 0) < Number(t.tutar) ? "; artanı carinin bakiyesine işlenir" : ""}. Banka ekstresi yüklüyorsanız eşleştirmeyi oradan yapmanız önerilir.</p>
                  <div className="row-tight"><Button size="sm" onClick={() => setEylem(null)}>Vazgeç</Button><Button size="sm" variant="primary" disabled={isleniyor} onClick={() => void gonder(`/kasa-banka/odeme-talimatlari/${t.id}/gerceklesti`, { tarih }, `${t.no} gerçekleşti; tediye fişi yazıldı.`)}>Kaydet</Button></div>
                </div>
              )}
              {acik && eylem.tur === "basarisiz" && (
                <GeriAlmaFormu<{ yontem: GeriAlmaYontemi }>
                  baslik="Başarısız işaretle"
                  uc={`/kasa-banka/odeme-talimatlari/${t.id}/basarisiz`}
                  aciklama="Banka talimatı reddettiyse ya da ödeme yapılmayacaksa işaretleyin. Bağlı faturalar yeniden ödenebilir olur; kayıt yazılmaz."
                  onVazgec={() => setEylem(null)}
                  onTamam={() => { setEylem(null); onMesaj(`${t.no} başarısız işaretlendi.`); setIcYenile((x) => x + 1); }}
                />
              )}
              {acik && eylem.tur === "geri_al" && (
                <GeriAlmaFormu<{ yontem: GeriAlmaYontemi }>
                  baslik="Gerçekleşmeyi geri al"
                  uc={`/kasa-banka/odeme-talimatlari/${t.id}/gerceklesme-geri-al`}
                  aciklama="Yazılan tediye fişleri geri alınır (açık dönemde silinir, kapalı dönemde ters kayıt); talimat bankaya gönderilmiş duruma döner."
                  onVazgec={() => setEylem(null)}
                  onTamam={() => { setEylem(null); onMesaj(`${t.no} gerçekleşmesi geri alındı.`); setIcYenile((x) => x + 1); }}
                />
              )}
            </article>
          );
        })}
        {!gorunen.length && <p className="ot-empty">Bu süzgece uyan talimat yok.</p>}
      </div>
      {suzgec === "onay_bekliyor" && sayilar.onay > 0 && <Alert tone="warning">Talimatı oluşturan kullanıcı onaylayamaz; onay ikinci bir kullanıcının authenticator koduyla verilir.</Alert>}
    </section>
  );
}
