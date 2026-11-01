"use client";

/**
 * Tek talimat (ENT-07): kaynak hesap ve cari seçilir; IBAN carinin banka
 * hesaplarından gelir (yoksa elle), açık faturalar tutarıyla seçilir.
 * Tutar boş bırakılırsa fatura toplamıdır; fazlası carinin bakiyesine işler.
 */
import { useEffect, useMemo, useState } from "react";
import { bugunTR, ibanGecerliMi } from "@tekirextra/shared";
import { api, tumSayfalariAl } from "@/lib/api";
import { Button, Field, Input, Para, Select, Tarih } from "@/components/ui";
import { ibanBicimle, type Banka } from "./tipler";
import { CariSecici } from "@/components/cari-secici";

interface Cari { id: string; kod: string; unvan: string; dovizCinsi: string; aktif: boolean }
interface CariBanka { id: string; bankaAdi: string; iban: string; hesapSahibi: string | null; paraBirimi: string }
export interface AdayCari {
  cari: { id: string; kod: string; unvan: string; vknTckn: string | null };
  bankaHesaplari: Array<{ id: string; bankaAdi: string; iban: string; hesapSahibi: string | null }>;
  toplam: string;
  faturalar: Array<{ id: string; no: string | null; tip: string; tarih: string; vadeTarihi: string; genelToplam: string; kalan: string; planlanan: string }>;
}

export function YeniTalimat({ bankalar, onKaydedildi }: { bankalar: Banka[]; onKaydedildi: (mesaj: string) => void }) {
  const [bankaHesapId, setBankaHesapId] = useState(bankalar[0]?.id ?? "");
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [cariId, setCariId] = useState("");
  const [cariBankalari, setCariBankalari] = useState<CariBanka[]>([]);
  const [cariBankaHesapId, setCariBankaHesapId] = useState("");
  const [elleIban, setElleIban] = useState("");
  const [elleUnvan, setElleUnvan] = useState("");
  const [faturalar, setFaturalar] = useState<AdayCari["faturalar"]>([]);
  const [paylar, setPaylar] = useState<Record<string, string>>({});
  const [tutar, setTutar] = useState("");
  const [odemeTarihi, setOdemeTarihi] = useState(bugunTR());
  const [aciklama, setAciklama] = useState("");
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const hesap = bankalar.find((b) => b.id === bankaHesapId);

  useEffect(() => { void tumSayfalariAl<Cari>("/cari").then((c) => setCariler(c.filter((x) => x.aktif))).catch(() => undefined); }, []);
  useEffect(() => {
    setCariBankalari([]); setCariBankaHesapId(""); setFaturalar([]); setPaylar({});
    if (!cariId || !bankaHesapId) return;
    void api<{ bankaHesaplari: CariBanka[] }>(`/cari/${cariId}`).then((c) => {
      const uygun = c.bankaHesaplari.filter((b) => b.paraBirimi === hesap?.dovizCinsi);
      setCariBankalari(uygun);
      setCariBankaHesapId(uygun[0]?.id ?? "");
    }).catch(() => undefined);
    void api<AdayCari[]>(`/kasa-banka/odeme-talimatlari/aday-borclar?bankaHesapId=${bankaHesapId}&cariId=${cariId}`).then((a) => setFaturalar(a[0]?.faturalar ?? [])).catch(() => undefined);
  }, [cariId, bankaHesapId, hesap?.dovizCinsi]);

  const faturaToplami = useMemo(() => Object.values(paylar).reduce((s, v) => s + (Number(v) || 0), 0), [paylar]);
  const odenecek = tutar ? Number(tutar) : faturaToplami;
  const elleGecerli = !cariBankaHesapId ? ibanGecerliMi(elleIban.replace(/\s/g, "").toUpperCase()) : true;
  const hazir = bankaHesapId && odenecek > 0 && faturaToplami <= odenecek + 0.001 && (cariBankaHesapId || (elleGecerli && (cariId || elleUnvan.trim().length >= 2)));

  async function kaydet() {
    setHata(""); setKaydediliyor(true);
    try {
      const t = await api<{ no: string }>("/kasa-banka/odeme-talimatlari", {
        method: "POST",
        body: JSON.stringify({
          bankaHesapId, cariId: cariId || null, cariBankaHesapId: cariBankaHesapId || null, aliciIban: cariBankaHesapId ? null : elleIban, aliciUnvan: cariBankaHesapId ? null : elleUnvan || null,
          tutar: tutar || null, odemeTarihi, aciklama: aciklama || null,
          faturalar: Object.entries(paylar).filter(([, v]) => Number(v) > 0).map(([faturaId, v]) => ({ faturaId, tutar: Number(v).toFixed(2) })),
        }),
      });
      onKaydedildi(`${t.no} oluşturuldu ve ikinci kullanıcı onayına gönderildi.`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Talimat oluşturulamadı");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <section className="ot-form">
      <div className="ot-form__grid">
        <Field label="Kaynak banka hesabı">
          <Select value={bankaHesapId} onChange={(e) => { setBankaHesapId(e.target.value); }}>
            {bankalar.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {b.ad} · {b.dovizCinsi}</option>)}
          </Select>
        </Field>
        <Field label="Cari">
          <CariSecici cariler={cariler.filter((c) => !hesap || c.dovizCinsi === hesap.dovizCinsi)} deger={cariId} onChange={setCariId} placeholder="Cari ara… (boş bırakılırsa yalnız IBAN)" />
        </Field>
        <Field label="Alıcı IBAN">
          <Select value={cariBankaHesapId} onChange={(e) => setCariBankaHesapId(e.target.value)}>
            {cariBankalari.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {ibanBicimle(b.iban)}</option>)}
            <option value="">Elle gir…</option>
          </Select>
        </Field>
        {!cariBankaHesapId && (
          <>
            <Field label="IBAN"><Input value={elleIban} onChange={(e) => setElleIban(e.target.value)} placeholder="TR00 0000 …" aria-invalid={elleIban.length > 0 && !elleGecerli} /></Field>
            <Field label="Alıcı unvanı"><Input value={elleUnvan} onChange={(e) => setElleUnvan(e.target.value)} placeholder={cariId ? "Boşsa cari unvanı" : "Hesap sahibinin adı"} /></Field>
          </>
        )}
        <Field label="Ödeme (valör) tarihi"><Input type="date" value={odemeTarihi} onChange={(e) => setOdemeTarihi(e.target.value)} /></Field>
        <Field label="Açıklama"><Input value={aciklama} maxLength={140} onChange={(e) => setAciklama(e.target.value)} placeholder="Boşsa fatura numaraları" /></Field>
      </div>
      {!cariBankaHesapId && elleIban.length > 0 && !elleGecerli && <p className="ot-warn">IBAN geçersiz görünüyor (TR ile başlayan 26 karakter ve doğru kontrol hanesi gerekir).</p>}
      {cariId && !cariBankalari.length && <p className="ot-note">Bu carinin {hesap?.dovizCinsi} IBAN'ı kayıtlı değil; elle girin ya da cari kartına ekleyin.</p>}

      {cariId && (
        <div className="ot-invoices">
          <header>
            <strong>Açık faturalar</strong>
            {faturalar.length > 0 && <Button size="sm" onClick={() => setPaylar(Object.fromEntries(faturalar.map((f) => [f.id, f.kalan])))}>Hepsini tam öde</Button>}
          </header>
          {faturalar.map((f) => (
            <label key={f.id} className={Number(paylar[f.id]) > 0 ? "is-selected" : undefined}>
              <input type="checkbox" checked={Number(paylar[f.id]) > 0} onChange={(e) => setPaylar((p) => ({ ...p, [f.id]: e.target.checked ? f.kalan : "" }))} />
              <span><strong>{f.no ?? "Numarasız"}</strong><small>vade <Tarih deger={f.vadeTarihi} /> · kalan <Para deger={f.kalan} dovizCinsi={hesap?.dovizCinsi} />{Number(f.planlanan) > 0 ? ` · ${Number(f.planlanan).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} başka talimatta` : ""}</small></span>
              <Input aria-label="Ödenecek" type="number" min="0" step="0.01" max={f.kalan} value={paylar[f.id] ?? ""} onChange={(e) => setPaylar((p) => ({ ...p, [f.id]: e.target.value }))} />
            </label>
          ))}
          {!faturalar.length && <p className="ot-note">Bu carinin ödenecek açık faturası yok; tutar girerek cari bakiyesine ödeme yapabilirsiniz.</p>}
        </div>
      )}

      {hata && <p className="ot-warn">{hata}</p>}
      <footer className="ot-form__foot">
        <Field label="Talimat tutarı"><Input type="number" min="0.01" step="0.01" value={tutar} onChange={(e) => setTutar(e.target.value)} placeholder={faturaToplami ? faturaToplami.toFixed(2) : "0,00"} /></Field>
        <div className="ot-form__sum">
          <span>Faturalara <b><Para deger={faturaToplami} dovizCinsi={hesap?.dovizCinsi} /></b></span>
          {odenecek > faturaToplami + 0.001 && faturaToplami > 0 && <span>Cari bakiyesine <b><Para deger={odenecek - faturaToplami} dovizCinsi={hesap?.dovizCinsi} /></b></span>}
          {faturaToplami > odenecek + 0.001 && <span className="ot-warn">Faturalara dağıtılan tutar talimat tutarını aşıyor</span>}
        </div>
        <Button variant="primary" disabled={!hazir || kaydediliyor} onClick={() => void kaydet()}>{kaydediliyor ? "Kaydediliyor…" : "Talimatı onaya gönder"}</Button>
      </footer>
    </section>
  );
}
