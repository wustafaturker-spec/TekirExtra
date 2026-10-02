"use client";

/**
 * Döviz alım/satımı (P1-2a).
 *
 * Çıkan hesaptan bir dövizde, giren hesaba başka bir dövizde para geçer (ör.
 * USD hesaptan bozdurulup TL hesaba). Kullanıcı iki tarafın gerçek tutarını
 * girer; banka kuru bunlardan çıkar. Döviz bacakları işlem günü TCMB alış
 * kuruyla değerlenir ve TL karşılıkları arasındaki fark kambiyo kârı/zararı
 * olarak yazılır. Önizleme sunucunun hesabıyla aynı kuralı izler.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiHata } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Button, Field, Input, Para, Select } from "@/components/ui";
import type { FisHesabi } from "./odeme-fisi";

interface KurYaniti { kurTarihi: string; oncekiIsGunuKullanildi: boolean; kurlar: Record<string, number> }

const sayi = (v: string) => Number(v.replace(",", "."));
const kurBicim = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function DovizIslemFormu({ hesaplar, onKapat, onKaydedildi }: { hesaplar: FisHesabi[]; onKapat: () => void; onKaydedildi: (mesaj: string) => void }) {
  const aktifler = hesaplar.filter((h) => h.aktif);
  const [kaynak, setKaynak] = useState("");
  const [hedef, setHedef] = useState("");
  const [cikan, setCikan] = useState("");
  const [giren, setGiren] = useState("");
  const [tarih, setTarih] = useState(bugunTR());
  const [aciklama, setAciklama] = useState("");
  const [masraf, setMasraf] = useState("");
  const [masrafHesabi, setMasrafHesabi] = useState<"cikan" | "giren">("cikan");
  const [kurlar, setKurlar] = useState<KurYaniti | null>(null);
  const [hata, setHata] = useState("");
  const [eksiUyari, setEksiUyari] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const k = aktifler.find((h) => `${h.tur}:${h.id}` === kaynak);
  const h = aktifler.find((x) => `${x.tur}:${x.id}` === hedef);
  const hedefler = aktifler.filter((x) => !k || x.dovizCinsi !== k.dovizCinsi);

  useEffect(() => {
    if (!tarih) return;
    let iptal = false;
    api<KurYaniti>(`/doviz-kurlari?tarih=${tarih}&tip=alis`).then((y) => { if (!iptal) setKurlar(y); }).catch(() => { if (!iptal) setKurlar(null); });
    return () => { iptal = true; };
  }, [tarih]);

  const onizleme = useMemo(() => {
    if (!k || !h || !(sayi(cikan) > 0) || !(sayi(giren) > 0)) return null;
    const tcmb = (d: string) => (d === "TRY" ? 1 : kurlar?.kurlar[d]);
    const [kk, hk] = [tcmb(k.dovizCinsi), tcmb(h.dovizCinsi)];
    const bankaKuru = h.dovizCinsi === "TRY" ? { deger: sayi(giren) / sayi(cikan), metin: `1 ${k.dovizCinsi} = ? TL` }
      : k.dovizCinsi === "TRY" ? { deger: sayi(cikan) / sayi(giren), metin: `1 ${h.dovizCinsi} = ? TL` }
        : { deger: sayi(giren) / sayi(cikan), metin: `1 ${k.dovizCinsi} = ? ${h.dovizCinsi}` };
    const fark = kk && hk ? Math.round((sayi(giren) * hk - sayi(cikan) * kk) * 100) / 100 : null;
    return { bankaKuru: bankaKuru.metin.replace("?", kurBicim(bankaKuru.deger)), tcmb: [k, h].filter((x) => x.dovizCinsi !== "TRY").map((x) => `1 ${x.dovizCinsi} = ${tcmb(x.dovizCinsi) ? kurBicim(tcmb(x.dovizCinsi)!) : "?"} TL`).join(" · "), fark };
  }, [k, h, cikan, giren, kurlar]);

  async function kaydet(e?: FormEvent, onayli = false) {
    e?.preventDefault();
    if (!k || !h) return;
    setKaydediliyor(true);
    setHata("");
    setEksiUyari(null);
    try {
      await api("/kasa-banka/doviz-islemleri", {
        method: "POST",
        body: JSON.stringify({
          kaynakKasaId: k.tur === "kasa" ? k.id : null, kaynakBankaHesapId: k.tur === "banka" ? k.id : null,
          hedefKasaId: h.tur === "kasa" ? h.id : null, hedefBankaHesapId: h.tur === "banka" ? h.id : null,
          cikanTutar: sayi(cikan).toFixed(2), girenTutar: sayi(giren).toFixed(2), tarih, aciklama: aciklama || null,
          masrafTutar: sayi(masraf) > 0 ? sayi(masraf).toFixed(2) : null, masrafHesabi,
          ...(onayli ? { eksiBakiyeOnay: true } : {}),
        }),
      });
      const fark = onizleme?.fark;
      onKaydedildi(`Döviz ${h.dovizCinsi === "TRY" ? "bozdurma" : "alımı"} kaydedildi (${onizleme?.bankaKuru}).${fark ? ` ${Math.abs(fark).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL kambiyo ${fark > 0 ? "kârı" : "zararı"} yazıldı.` : ""}`);
    } catch (err) {
      if (err instanceof ApiHata && err.durum === 409 && !onayli && /eksi bakiye/i.test(err.message)) setEksiUyari(err.message);
      else setHata(err instanceof Error ? err.message : "Döviz işlemi kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <form onSubmit={kaydet}>
      <div className="treasury-form-grid">
        <Field label="Çıkan hesap (sattığınız / ödediğiniz)">
          <Select autoFocus required value={kaynak} onChange={(e) => { setKaynak(e.target.value); setHedef(""); }}>
            <option value="">Hesap seçin</option>
            {aktifler.map((x) => <option key={`${x.tur}-${x.id}`} value={`${x.tur}:${x.id}`}>{x.ad} · {x.dovizCinsi}</option>)}
          </Select>
        </Field>
        <Field label="Giren hesap (aldığınız)">
          <Select required disabled={!k} value={hedef} onChange={(e) => setHedef(e.target.value)}>
            <option value="">{k ? "Başka dövizde hesap seçin" : "Önce çıkan hesabı seçin"}</option>
            {hedefler.map((x) => <option key={`${x.tur}-${x.id}`} value={`${x.tur}:${x.id}`}>{x.ad} · {x.dovizCinsi}</option>)}
          </Select>
        </Field>
        <Field label={`Çıkan tutar${k ? ` (${k.dovizCinsi})` : ""}`}>
          <Input required type="number" inputMode="decimal" min="0.01" step="any" value={cikan} onChange={(e) => setCikan(e.target.value)} />
        </Field>
        <Field label={`Giren tutar${h ? ` (${h.dovizCinsi})` : ""}`}>
          <Input required type="number" inputMode="decimal" min="0.01" step="any" value={giren} onChange={(e) => setGiren(e.target.value)} placeholder="Bankanın yatırdığı tutar" />
        </Field>
        <Field label="İşlem tarihi">
          <Input required type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
        </Field>
        <Field label="Açıklama">
          <Input maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Ör. Dekont no" />
        </Field>
        <Field label={<>Banka masrafı <small className="muted">· isteğe bağlı (komisyon/BSMV)</small></>}>
          <Input type="number" inputMode="decimal" min="0" step="any" value={masraf} onChange={(e) => setMasraf(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Masrafın kesildiği hesap">
          <Select value={masrafHesabi} disabled={!(sayi(masraf) > 0)} onChange={(e) => setMasrafHesabi(e.target.value as "cikan" | "giren")}>
            <option value="cikan">{k ? `${k.ad} (${k.dovizCinsi})` : "Çıkan hesap"}</option>
            <option value="giren">{h ? `${h.ad} (${h.dovizCinsi})` : "Giren hesap"}</option>
          </Select>
        </Field>
      </div>

      {onizleme && (
        <div className="fx-exchange-preview">
          <div><span>Banka kuru</span><strong>{onizleme.bankaKuru}</strong></div>
          <div><span>TCMB alış ({kurlar?.kurTarihi ? new Date(kurlar.kurTarihi).toLocaleDateString("tr-TR") : tarih})</span><strong>{onizleme.tcmb || "—"}</strong></div>
          <div className={onizleme.fark === null ? "" : onizleme.fark >= 0 ? "is-gain" : "is-loss"}>
            <span>Kambiyo {onizleme.fark !== null && onizleme.fark < 0 ? "zararı" : "kârı"}</span>
            <strong>{onizleme.fark === null ? "TCMB kuru bekleniyor" : <Para deger={Math.abs(onizleme.fark)} dovizCinsi="TRY" />}</strong>
          </div>
        </div>
      )}
      <p className="treasury-hint">İki bacak tek işlemde yazılır. Döviz bacağı TCMB alış kuruyla değerlenir; bankanın kuruyla aradaki fark kambiyo kârı (faaliyet dışı gelir) ya da kambiyo zararı (masraf) olarak kaydedilir.</p>

      {hata && <Alert tone="error">{hata}</Alert>}
      {eksiUyari && (
        <div className="treasury-confirm" role="alertdialog" aria-label="Eksi bakiye uyarısı">
          <Alert tone="warning"><span><strong>Çıkan hesap eksi bakiyeye düşüyor.</strong> {eksiUyari}</span></Alert>
          <div>
            <Button type="button" size="sm" onClick={() => setEksiUyari(null)}>Vazgeç</Button>
            <Button type="button" size="sm" variant="primary" disabled={kaydediliyor} onClick={() => void kaydet(undefined, true)}>Yine de kaydet</Button>
          </div>
        </div>
      )}
      <footer>
        <Button type="button" onClick={onKapat} disabled={kaydediliyor}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={kaydediliyor || !k || !h || !(sayi(cikan) > 0) || !(sayi(giren) > 0)}>{kaydediliyor ? "Kaydediliyor…" : "Döviz işlemini kaydet"}</Button>
      </footer>
    </form>
  );
}
