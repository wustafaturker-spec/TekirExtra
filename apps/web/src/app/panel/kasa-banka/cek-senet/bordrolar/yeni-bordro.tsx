"use client";

/**
 * Yeni çek/senet bordrosu (KSB-11).
 * - Giriş ve borç çeki çıkışı: satır satır tablo; her satır bir evrak, ön/arka
 *   görüntüsü satırda seçilir ve bordro kaydedilince yüklenir.
 * - Ciro, tahsile, teminata: portföydeki müşteri evrakından seçim.
 */
import { useEffect, useMemo, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, tumSayfalariAl } from "@/lib/api";
import { Alert, Button, Field, Input, Para, SearchInput, Select, Tarih } from "@/components/ui";

export type BordroTuru = "giris" | "ciro" | "tahsile" | "teminata" | "borc_cikis";
export const BORDRO_ADI: Record<BordroTuru, string> = {
  giris: "Giriş bordrosu", ciro: "Ciro bordrosu", tahsile: "Tahsile verme", teminata: "Teminata verme", borc_cikis: "Borç çeki çıkışı",
};
const BORDRO_ACIKLAMASI: Record<BordroTuru, string> = {
  giris: "Müşteriden alınan çek ve senetler portföye girer; müşteri toplam tutarla alacaklanır.",
  borc_cikis: "Kendi kestiğimiz çek ve senetler lehtara verilir; lehtar toplam tutarla borçlanır.",
  ciro: "Portföydeki müşteri evrakı tedarikçiye ciro edilir; tedarikçi toplamla borçlanır.",
  tahsile: "Portföydeki evrak tahsil için bankaya verilir; hangi hesapta olduğu kayıt altına alınır.",
  teminata: "Portföydeki evrak kredi teminatı olarak bankaya verilir.",
};

interface Cari { id: string; kod: string; unvan: string; dovizCinsi: string; aktif: boolean }
interface Banka { id: string; ad: string; dovizCinsi: string; aktif: boolean }
interface PortfoyCeki { id: string; tur: "cek" | "senet"; portfoyNo: string; cekNo: string | null; vadeTarihi: string; tutar: string; dovizCinsi: string; borclu: string; banka: string | null; cari: { unvan: string } | null; onYuzEkId: string | null }

interface Satir { anahtar: number; tur: "cek" | "senet"; cekNo: string; vadeTarihi: string; tutar: string; borclu: string; banka: string; sube: string; hesapNo: string; on: File | null; arka: File | null }

const GUN = 86_400_000;
/** Tutar ağırlıklı ortalama vade (sunucudakiyle aynı formül). */
export function ortalamaVade(liste: Array<{ vadeTarihi: string; tutar: string | number }>): string | null {
  const gecerli = liste.filter((x) => x.vadeTarihi && Number(x.tutar) > 0);
  const toplam = gecerli.reduce((t, x) => t + Number(x.tutar), 0);
  if (!toplam) return null;
  const gun = gecerli.reduce((t, x) => t + Number(x.tutar) * Math.round(Date.parse(`${x.vadeTarihi.slice(0, 10)}T00:00:00Z`) / GUN), 0) / toplam;
  return new Date(Math.round(gun) * GUN).toISOString().slice(0, 10);
}
const ayEkle = (gun: string, ay: number) => {
  if (!gun) return gun;
  const [y, a, g] = gun.split("-").map(Number);
  const son = new Date(Date.UTC(y, a + ay, 0)).getUTCDate();
  return new Date(Date.UTC(y, a - 1 + ay, Math.min(g, son))).toISOString().slice(0, 10);
};
const noArtir = (no: string) => no.replace(/(\d+)(?!.*\d)/, (m) => String(Number(m) + 1).padStart(m.length, "0"));

let sayac = 0;
const bosSatir = (onceki?: Satir): Satir => onceki
  ? { ...onceki, anahtar: ++sayac, cekNo: noArtir(onceki.cekNo), vadeTarihi: ayEkle(onceki.vadeTarihi, 1), on: null, arka: null }
  : { anahtar: ++sayac, tur: "cek", cekNo: "", vadeTarihi: "", tutar: "", borclu: "", banka: "", sube: "", hesapNo: "", on: null, arka: null };

export function YeniBordro({ tur, onKaydedildi, onVazgec }: { tur: BordroTuru; onKaydedildi: (id: string, mesaj: string) => void; onVazgec: () => void }) {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [bankalar, setBankalar] = useState<Banka[]>([]);
  const [tarih, setTarih] = useState(bugunTR());
  const [cariId, setCariId] = useState("");
  const [bankaHesapId, setBankaHesapId] = useState("");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [kur, setKur] = useState("1");
  const [aciklama, setAciklama] = useState("");
  const [satirlar, setSatirlar] = useState<Satir[]>(() => [bosSatir()]);
  const [portfoy, setPortfoy] = useState<PortfoyCeki[]>([]);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const girisli = tur === "giris" || tur === "borc_cikis";
  const bankali = tur === "tahsile" || tur === "teminata";

  useEffect(() => {
    void tumSayfalariAl<Cari>("/cari").then((c) => setCariler(c.filter((x) => x.aktif))).catch(() => undefined);
    if (bankali) void api<Banka[]>("/kasa-banka/bankalar").then((b) => setBankalar(b.filter((x) => x.aktif))).catch(() => undefined);
    if (!girisli) void api<PortfoyCeki[]>("/kasa-banka/cek-senet?yon=alinan&durum=portfoyde").then(setPortfoy).catch((e) => setHata(e instanceof Error ? e.message : "Portföy yüklenemedi"));
  }, [girisli, bankali]);

  const gorunenPortfoy = useMemo(() => {
    const a = arama.trim().toLocaleLowerCase("tr");
    return portfoy.filter((c) => !a || `${c.portfoyNo} ${c.cekNo ?? ""} ${c.borclu} ${c.cari?.unvan ?? ""} ${c.banka ?? ""}`.toLocaleLowerCase("tr").includes(a));
  }, [portfoy, arama]);
  const seciliCekler = portfoy.filter((c) => secili.has(c.id));
  const evraklar = girisli ? satirlar.filter((s) => Number(s.tutar) > 0 && s.vadeTarihi) : seciliCekler;
  const toplam = evraklar.reduce((t, x) => t + Number(x.tutar), 0);
  const ortalama = ortalamaVade(evraklar);
  const evrakDovizi = girisli ? dovizCinsi : seciliCekler[0]?.dovizCinsi ?? "TRY";
  const karisikDoviz = !girisli && new Set(seciliCekler.map((c) => c.dovizCinsi)).size > 1;

  function satirDegistir(anahtar: number, alan: Partial<Satir>) {
    setSatirlar((liste) => liste.map((s) => (s.anahtar === anahtar ? { ...s, ...alan } : s)));
  }

  async function kaydet() {
    setHata("");
    setKaydediliyor(true);
    try {
      if (girisli) {
        const dolu = satirlar.filter((s) => s.tutar || s.vadeTarihi || s.cekNo);
        const sonuc = await api<{ id: string; no: string; cekler: Array<{ id: string; portfoyNo: string }> }>("/kasa-banka/cek-bordrolari/giris", {
          method: "POST",
          body: JSON.stringify({
            tur, tarih, cariId, dovizCinsi, kur, aciklama,
            satirlar: dolu.map((s) => ({ tur: s.tur, cekNo: s.cekNo, vadeTarihi: s.vadeTarihi, tutar: s.tutar, borclu: s.borclu, banka: s.banka, sube: s.sube, hesapNo: s.hesapNo })),
          }),
        });
        // Görüntüler evrak oluştuktan sonra, satır sırasıyla yüklenir.
        let yuklenemeyen = 0;
        for (const [i, s] of dolu.entries()) {
          for (const [yuz, dosya] of [["on", s.on], ["arka", s.arka]] as const) {
            if (!dosya) continue;
            const fd = new FormData();
            fd.append("dosya", dosya);
            await api(`/kasa-banka/cek-senet/${sonuc.cekler[i].id}/gorunum/${yuz}`, { method: "POST", body: fd }).catch(() => { yuklenemeyen += 1; });
          }
        }
        onKaydedildi(sonuc.id, `${sonuc.no} kaydedildi: ${sonuc.cekler.length} evrak (portföy ${sonuc.cekler[0].portfoyNo}${sonuc.cekler.length > 1 ? `–${sonuc.cekler.at(-1)!.portfoyNo}` : ""}).${yuklenemeyen ? ` ${yuklenemeyen} görüntü yüklenemedi; evrak ayrıntısından yeniden ekleyin.` : ""}`);
      } else {
        const sonuc = await api<{ id: string; no: string }>("/kasa-banka/cek-bordrolari/cikis", {
          method: "POST",
          body: JSON.stringify({ tur, tarih, cariId: tur === "ciro" ? cariId : null, bankaHesapId: bankali ? bankaHesapId : null, aciklama, cekIdleri: [...secili] }),
        });
        onKaydedildi(sonuc.id, `${sonuc.no} kaydedildi: ${secili.size} evrak ${tur === "ciro" ? "ciro edildi" : tur === "tahsile" ? "tahsile verildi" : "teminata verildi"}.`);
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Bordro kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  const cariGerekli = tur !== "tahsile" && tur !== "teminata";
  const hazir = evraklar.length > 0 && !karisikDoviz && (!cariGerekli || cariId) && (!bankali || bankaHesapId);

  return (
    <section className="bordro-new" aria-label={BORDRO_ADI[tur]}>
      <header className="bordro-new__head">
        <div>
          <span>YENİ BORDRO</span>
          <h2>{BORDRO_ADI[tur]}</h2>
          <p>{BORDRO_ACIKLAMASI[tur]}</p>
        </div>
        <Button onClick={onVazgec}>Vazgeç</Button>
      </header>

      <div className="bordro-new__fields">
        <Field label="Bordro tarihi"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
        {cariGerekli && (
          <Field label={tur === "giris" ? "Teslim eden müşteri" : tur === "ciro" ? "Ciro edilecek cari" : "Lehtar"}>
            <Select value={cariId} onChange={(e) => setCariId(e.target.value)}>
              <option value="">Cari seçin</option>
              {cariler.filter((c) => !girisli || c.dovizCinsi === dovizCinsi).map((c) => <option key={c.id} value={c.id}>{c.kod} · {c.unvan}</option>)}
            </Select>
          </Field>
        )}
        {bankali && (
          <Field label="Banka hesabı">
            <Select value={bankaHesapId} onChange={(e) => setBankaHesapId(e.target.value)}>
              <option value="">Hesap seçin</option>
              {bankalar.filter((b) => !seciliCekler.length || b.dovizCinsi === evrakDovizi).map((b) => <option key={b.id} value={b.id}>{b.ad} · {b.dovizCinsi}</option>)}
            </Select>
          </Field>
        )}
        {girisli && (
          <>
            <Field label="Para birimi"><Select value={dovizCinsi} onChange={(e) => { setDovizCinsi(e.target.value); setCariId(""); if (e.target.value === "TRY") setKur("1"); }}><option>TRY</option><option>USD</option><option>EUR</option></Select></Field>
            {dovizCinsi !== "TRY" && <Field label="Kur"><Input type="number" step="any" min="0" value={kur} onChange={(e) => setKur(e.target.value)} /></Field>}
          </>
        )}
        <Field label="Açıklama"><Input value={aciklama} maxLength={500} onChange={(e) => setAciklama(e.target.value)} placeholder="İsteğe bağlı" /></Field>
      </div>

      {girisli ? (
        <div className="bordro-rows">
          <div className="bordro-rows__table" role="table" aria-label="Evraklar">
            <div className="bordro-row bordro-row--head" role="row">
              <span>#</span><span>Tür</span><span>Evrak no</span><span>Vade</span><span>Tutar</span><span>{tur === "giris" ? "Keşideci" : "Borçlu (boşsa firma)"}</span><span>Banka</span><span>Şube</span><span>Görüntü</span><span />
            </div>
            {satirlar.map((s, i) => (
              <div key={s.anahtar} className="bordro-row" role="row">
                <span className="bordro-row__no">{i + 1}</span>
                <Select aria-label="Tür" value={s.tur} onChange={(e) => satirDegistir(s.anahtar, { tur: e.target.value as Satir["tur"] })}><option value="cek">Çek</option><option value="senet">Senet</option></Select>
                <Input aria-label="Evrak no" value={s.cekNo} onChange={(e) => satirDegistir(s.anahtar, { cekNo: e.target.value })} />
                <Input aria-label="Vade" type="date" value={s.vadeTarihi} onChange={(e) => satirDegistir(s.anahtar, { vadeTarihi: e.target.value })} />
                <Input aria-label="Tutar" type="number" min="0.01" step="0.01" value={s.tutar} onChange={(e) => satirDegistir(s.anahtar, { tutar: e.target.value })} />
                <Input aria-label="Keşideci" value={s.borclu} onChange={(e) => satirDegistir(s.anahtar, { borclu: e.target.value })} />
                <Input aria-label="Banka" value={s.banka} onChange={(e) => satirDegistir(s.anahtar, { banka: e.target.value })} />
                <Input aria-label="Şube" value={s.sube} onChange={(e) => satirDegistir(s.anahtar, { sube: e.target.value })} />
                <span className="bordro-row__files">
                  {(["on", "arka"] as const).map((yuz) => (
                    <label key={yuz} className={s[yuz] ? "is-set" : undefined} title={s[yuz]?.name ?? (yuz === "on" ? "Ön yüz görüntüsü" : "Arka yüz görüntüsü")}>
                      {yuz === "on" ? "Ön" : "Arka"}{s[yuz] ? " ✓" : ""}
                      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(e) => satirDegistir(s.anahtar, { [yuz]: e.target.files?.[0] ?? null })} />
                    </label>
                  ))}
                </span>
                <span className="bordro-row__actions">
                  <button type="button" title="Satırı çoğalt (sonraki evrak no, bir ay sonraki vade)" onClick={() => setSatirlar((l) => [...l.slice(0, i + 1), bosSatir(s), ...l.slice(i + 1)])}>⧉</button>
                  <button type="button" title="Satırı sil" disabled={satirlar.length === 1} onClick={() => setSatirlar((l) => l.filter((x) => x.anahtar !== s.anahtar))}>×</button>
                </span>
              </div>
            ))}
          </div>
          <Button size="sm" onClick={() => setSatirlar((l) => [...l, bosSatir()])}>+ Satır ekle</Button>
          <p className="bordro-note">Portföy numaraları kayıtta otomatik verilir. ⧉ ile aynı keşidecinin sıradaki çeki (evrak no +1, vade +1 ay) hızlıca eklenir.</p>
        </div>
      ) : (
        <div className="bordro-pick">
          <div className="bordro-pick__bar">
            <SearchInput value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Portföy no, çek no, keşideci, müşteri…" />
            <Button size="sm" onClick={() => setSecili(new Set(gorunenPortfoy.map((c) => c.id)))} disabled={!gorunenPortfoy.length}>Görünenlerin hepsini seç</Button>
            {secili.size > 0 && <Button size="sm" onClick={() => setSecili(new Set())}>Seçimi temizle</Button>}
          </div>
          <div className="bordro-pick__list">
            {gorunenPortfoy.map((c) => (
              <label key={c.id} className={secili.has(c.id) ? "is-selected" : undefined}>
                <input type="checkbox" checked={secili.has(c.id)} onChange={(e) => setSecili((s) => { const y = new Set(s); if (e.target.checked) y.add(c.id); else y.delete(c.id); return y; })} />
                <span className="mono">{c.portfoyNo}</span>
                <span><strong>{c.borclu}</strong><small>{c.tur === "senet" ? "Senet" : `Çek ${c.cekNo ?? ""}`}{c.banka ? ` · ${c.banka}` : ""}{c.cari ? ` · ${c.cari.unvan}` : ""}{c.onYuzEkId ? " · 📷" : ""}</small></span>
                <span><Tarih deger={c.vadeTarihi} /></span>
                <b><Para deger={c.tutar} dovizCinsi={c.dovizCinsi} /></b>
              </label>
            ))}
            {!gorunenPortfoy.length && <p className="bordro-note">Portföyde uygun evrak yok.</p>}
          </div>
        </div>
      )}

      {hata && <Alert tone="error">{hata}</Alert>}
      {karisikDoviz && <Alert tone="warning">Seçilen evraklar farklı para birimlerinde; bir bordroda tek para birimi olur.</Alert>}

      <footer className="bordro-new__foot">
        <div className="bordro-new__totals">
          <span><small>Evrak</small><b>{evraklar.length}</b></span>
          <span><small>Toplam</small><b><Para deger={toplam} dovizCinsi={evrakDovizi} /></b></span>
          <span><small>Ortalama vade</small><b>{ortalama ? <Tarih deger={ortalama} /> : "—"}</b></span>
        </div>
        <Button variant="primary" disabled={!hazir || kaydediliyor} onClick={() => void kaydet()}>{kaydediliyor ? "Kaydediliyor…" : "Bordroyu kaydet"}</Button>
      </footer>
    </section>
  );
}
