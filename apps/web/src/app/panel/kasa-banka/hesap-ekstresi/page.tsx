"use client";

/**
 * Kasa/banka hesap ekstresi ve açılış bakiyesi (P1-9).
 *
 * Seçilen hesabın dönem başı devri, yürüyen bakiyesi ve dönem sonu bakiyesi;
 * PDF (yatay) ve Excel olarak indirilir. Dövizli hesapta tutarlar hesabın
 * dövizindedir, TL karşılığı her hareketin kendi kuruyla gösterilir.
 * Açılış bakiyesi hesap başına tek bir açılış fişidir: bakiyeye girer,
 * tahsilat/ödeme sayılmaz. Buradan girilir, değiştirilir ya da silinir.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEkranKaydi } from "@/lib/asistan-baglami";
import { api, apiDosyaIndir, tokenAl } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, Segmented, Select, Stat, StatGrid, Table, TableSkeleton, Tarih } from "@/components/ui";

interface Acilis {
  id: string;
  tarih: string;
  tutar: string;
  kur: string;
  aciklama: string | null;
}

interface Hesap {
  id: string;
  ad: string;
  dovizCinsi: string;
  aktif: boolean;
  bakiye: string;
  bankaAdi?: string;
  acilis: Acilis | null;
}

interface EkstreSatiri {
  id: string;
  tarih: string;
  makbuzNo: string | null;
  islem: string;
  tip: string;
  kaynakTur: string;
  kaynak: string | null;
  aciklama: string | null;
  cari: string | null;
  belge: string | null;
  karsiHesap: string | null;
  giris: string | null;
  cikis: string | null;
  kur: string;
  tutarTry: string;
  bakiye: string;
}

interface Ekstre {
  hesap: { tur: "kasa" | "banka" | "pos"; id: string; ad: string; dovizCinsi: string; banka: { bankaAdi: string; iban: string | null } | null };
  baslangic: string | null;
  bitis: string | null;
  acilis: Acilis | null;
  ilkHareketTarihi: string | null;
  devir: string;
  devirTry: string;
  giris: string;
  cikis: string;
  girisTry: string;
  cikisTry: string;
  donemSonu: string;
  donemSonuTry: string;
  satirlar: EkstreSatiri[];
}

type Donem = "bu_ay" | "gecen_ay" | "bu_yil" | "tumu" | "ozel";

/** Dönem kısayolunun tarih aralığı (bitiş boşsa bugüne kadar). */
function donemAraligi(donem: Exclude<Donem, "ozel">): { baslangic: string; bitis: string } {
  const bugun = bugunTR();
  const [y, a] = bugun.split("-").map(Number);
  const iso = (yil: number, ay: number, gun: number) => `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`;
  if (donem === "bu_ay") return { baslangic: iso(y, a, 1), bitis: bugun };
  if (donem === "gecen_ay") {
    const [gy, ga] = a === 1 ? [y - 1, 12] : [y, a - 1];
    return { baslangic: iso(gy, ga, 1), bitis: iso(gy, ga, new Date(Date.UTC(gy, ga, 0)).getUTCDate()) };
  }
  if (donem === "bu_yil") return { baslangic: iso(y, 1, 1), bitis: bugun };
  return { baslangic: "", bitis: "" };
}

const ISLEM_RENGI: Record<string, "success" | "danger" | "info" | "warning" | "neutral"> = {
  Tahsilat: "success",
  "Virman girişi": "success",
  Ödeme: "danger",
  "Virman çıkışı": "danger",
  Açılış: "info",
  "Ters kayıt": "warning",
  "Bankaya aktarım": "danger",
  "Komisyon / kesinti": "warning",
  İade: "danger",
};

/** KSB-39: POS hesabının ekstresi; açılış bakiyesi POS'ta yoktur. */
interface PosHesabi { id: string; ad: string; saglayici: string; dovizCinsi: string; aktif: boolean }

export default function HesapEkstresiSayfasi() {
  const [kasalar, setKasalar] = useState<Hesap[]>([]);
  const [bankalar, setBankalar] = useState<Hesap[]>([]);
  const [poslar, setPoslar] = useState<PosHesabi[]>([]);
  const [hesapAnahtari, setHesapAnahtari] = useState("");
  const [donem, setDonem] = useState<Donem>("bu_ay");
  const [baslangic, setBaslangic] = useState(() => donemAraligi("bu_ay").baslangic);
  const [bitis, setBitis] = useState(() => donemAraligi("bu_ay").bitis);
  const [ekstre, setEkstre] = useState<Ekstre | null>(null);
  // AI-113: ekstresi açık kasa/banka hesabı asistanın ekran kaydıdır (POS hesabı ekran kaydı değildir).
  useEkranKaydi(ekstre && ekstre.hesap.tur !== "pos" ? { tur: "kasa_banka_hesabi", id: `${ekstre.hesap.tur}:${ekstre.hesap.id}`, etiket: ekstre.hesap.ad } : null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [indiriliyor, setIndiriliyor] = useState<"" | "pdf" | "excel">("");

  const hesaplariYukle = useCallback(async () => {
    const [k, b, p] = await Promise.all([
      api<Hesap[]>("/kasa-banka/kasalar"),
      api<Hesap[]>("/kasa-banka/bankalar"),
      api<PosHesabi[]>("/kasa-banka/pos-hesaplari").catch(() => [] as PosHesabi[]),
    ]);
    setKasalar(k);
    setBankalar(b);
    setPoslar(p);
    return [...k.map((x) => `kasa:${x.id}`), ...b.map((x) => `banka:${x.id}`), ...p.map((x) => `pos:${x.id}`)];
  }, []);

  useEffect(() => {
    if (!tokenAl()) return;
    const istenen = new URLSearchParams(location.search).get("hesap") ?? "";
    hesaplariYukle()
      .then((anahtarlar) => setHesapAnahtari(anahtarlar.includes(istenen) ? istenen : anahtarlar[0] ?? ""))
      .catch((e) => setHata(e instanceof Error ? e.message : "Hesaplar yüklenemedi"));
  }, [hesaplariYukle]);

  const sorgu = useMemo(() => {
    const qs = new URLSearchParams();
    if (baslangic) qs.set("baslangic", baslangic);
    if (bitis) qs.set("bitis", bitis);
    return qs.toString();
  }, [baslangic, bitis]);

  const ekstreYukle = useCallback(async () => {
    if (!hesapAnahtari) return;
    if (baslangic && bitis && baslangic > bitis) { setHata("Başlangıç tarihi bitişten sonra olamaz"); return; }
    setYukleniyor(true);
    setHata("");
    try {
      setEkstre(await api<Ekstre>(`/kasa-banka/hesaplar/${hesapAnahtari}/ekstre${sorgu ? `?${sorgu}` : ""}`));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Ekstre yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [hesapAnahtari, sorgu, baslangic, bitis]);

  useEffect(() => { void ekstreYukle(); }, [ekstreYukle]);

  useEffect(() => {
    if (!hesapAnahtari) return;
    const url = new URL(location.href);
    url.searchParams.set("hesap", hesapAnahtari);
    history.replaceState(null, "", url);
  }, [hesapAnahtari]);

  function donemSec(d: Donem) {
    setDonem(d);
    if (d === "ozel") return;
    const aralik = donemAraligi(d);
    setBaslangic(aralik.baslangic);
    setBitis(aralik.bitis);
  }

  async function indir(tur: "pdf" | "excel") {
    if (!ekstre) return;
    setIndiriliyor(tur);
    setHata("");
    try {
      const ad = ekstre.hesap.ad.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9ğüşıöç]+/g, "-");
      await apiDosyaIndir(`/kasa-banka/hesaplar/${hesapAnahtari}/ekstre/${tur}${sorgu ? `?${sorgu}` : ""}`, `hesap-ekstresi-${ad}.${tur === "pdf" ? "pdf" : "xlsx"}`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Dosya indirilemedi");
    } finally {
      setIndiriliyor("");
    }
  }

  const seciliHesap = hesapAnahtari.startsWith("pos:") ? null : [...kasalar, ...bankalar].find((h) => hesapAnahtari.endsWith(h.id)) ?? null;
  const doviz = ekstre?.hesap.dovizCinsi ?? seciliHesap?.dovizCinsi ?? poslar.find((p) => hesapAnahtari.endsWith(p.id))?.dovizCinsi ?? "TRY";
  const dovizli = doviz !== "TRY";
  const kolonSayisi = dovizli ? 10 : 8;

  return (
    <div className="account-statement">
      <PageHeader
        title="Hesap ekstresi"
        subtitle="Kasa, banka ya da POS hesabının dönem başı devrini, yürüyen bakiyesini ve dönem sonu bakiyesini görün; PDF ya da Excel olarak indirin."
        actions={
          <>
            <Button onClick={() => void indir("excel")} disabled={!ekstre || Boolean(indiriliyor)}>{indiriliyor === "excel" ? "Hazırlanıyor…" : "Excel"}</Button>
            <Button variant="primary" onClick={() => void indir("pdf")} disabled={!ekstre || Boolean(indiriliyor)}>{indiriliyor === "pdf" ? "Hazırlanıyor…" : "PDF indir"}</Button>
          </>
        }
      />

      <div className="account-statement__toolbar">
        <Field label="Hesap">
          <Select value={hesapAnahtari} onChange={(e) => setHesapAnahtari(e.target.value)}>
            {!kasalar.length && !bankalar.length && !poslar.length && <option value="">Hesap yok</option>}
            {kasalar.length > 0 && (
              <optgroup label="Kasalar">
                {kasalar.map((k) => <option key={k.id} value={`kasa:${k.id}`}>{k.ad} · {k.dovizCinsi}{k.aktif ? "" : " (pasif)"}</option>)}
              </optgroup>
            )}
            {bankalar.length > 0 && (
              <optgroup label="Banka hesapları">
                {bankalar.map((b) => <option key={b.id} value={`banka:${b.id}`}>{b.ad} · {b.bankaAdi} · {b.dovizCinsi}{b.aktif ? "" : " (pasif)"}</option>)}
              </optgroup>
            )}
            {poslar.length > 0 && (
              <optgroup label="POS hesapları">
                {poslar.map((p) => <option key={p.id} value={`pos:${p.id}`}>{p.ad} · {p.saglayici === "banka" ? "Banka POS'u" : p.saglayici} · {p.dovizCinsi}{p.aktif ? "" : " (pasif)"}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
        <Segmented<Donem>
          ariaLabel="Dönem"
          value={donem}
          onChange={donemSec}
          items={[
            { deger: "bu_ay", baslik: "Bu ay" },
            { deger: "gecen_ay", baslik: "Geçen ay" },
            { deger: "bu_yil", baslik: "Bu yıl" },
            { deger: "tumu", baslik: "Tümü" },
            { deger: "ozel", baslik: "Özel" },
          ]}
        />
        <Field label="Başlangıç">
          <Input type="date" value={baslangic} onChange={(e) => { setDonem("ozel"); setBaslangic(e.target.value); }} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={bitis} min={baslangic || undefined} onChange={(e) => { setDonem("ozel"); setBitis(e.target.value); }} />
        </Field>
      </div>

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      {seciliHesap && (
        <AcilisPaneli
          key={`${hesapAnahtari}:${seciliHesap.acilis?.id ?? "yok"}:${seciliHesap.acilis?.tutar ?? ""}:${seciliHesap.acilis?.tarih ?? ""}:${ekstre?.ilkHareketTarihi ?? ""}`}
          hesapAnahtari={hesapAnahtari}
          hesap={seciliHesap}
          ilkHareketTarihi={ekstre?.hesap.id === seciliHesap.id ? ekstre.ilkHareketTarihi : null}
          onKaydedildi={async (mesaj) => {
            setBasari(mesaj);
            setHata("");
            await hesaplariYukle();
            await ekstreYukle();
          }}
        />
      )}

      {ekstre && (
        <StatGrid>
          <Stat label="Devir bakiyesi" value={<Para deger={ekstre.devir} dovizCinsi={doviz} />} hint={ekstre.baslangic ? <>{<Tarih deger={ekstre.baslangic} />} öncesi{dovizli && <> · <Para deger={ekstre.devirTry} dovizCinsi="TRY" /></>}</> : "Tüm hareketler gösteriliyor"} />
          <Stat label="Dönem girişleri" value={<Para deger={ekstre.giris} dovizCinsi={doviz} />} hint={dovizli ? <Para deger={ekstre.girisTry} dovizCinsi="TRY" /> : `${ekstre.satirlar.filter((s) => s.giris).length} hareket`} tone="success" />
          <Stat label="Dönem çıkışları" value={<Para deger={ekstre.cikis} dovizCinsi={doviz} />} hint={dovizli ? <Para deger={ekstre.cikisTry} dovizCinsi="TRY" /> : `${ekstre.satirlar.filter((s) => s.cikis).length} hareket`} tone="danger" />
          <Stat
            label="Dönem sonu bakiyesi"
            value={<Para deger={ekstre.donemSonu} dovizCinsi={doviz} />}
            hint={dovizli ? <>İşlem kurlarıyla <Para deger={ekstre.donemSonuTry} dovizCinsi="TRY" /></> : ekstre.bitis ? <Tarih deger={ekstre.bitis} /> : "Bugün"}
            tone={Number(ekstre.donemSonu) < 0 ? "danger" : "accent"}
          />
        </StatGrid>
      )}

      {yukleniyor && !ekstre ? <TableSkeleton rows={6} cols={kolonSayisi} /> : ekstre && (
        <Table density="compact" stickyHeader className="account-statement__table">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Makbuz no</th>
              <th>İşlem</th>
              <th>Açıklama</th>
              <th>Cari / belge</th>
              <th className="num">Giriş</th>
              <th className="num">Çıkış</th>
              {dovizli && <th className="num">Kur</th>}
              {dovizli && <th className="num">TL karşılığı</th>}
              <th className="num">Bakiye</th>
            </tr>
          </thead>
          <tbody>
            {ekstre.baslangic && (
              <tr className="table-subtotal">
                <td><Tarih deger={ekstre.baslangic} /></td>
                <td />
                <td><Badge variant="neutral">Devir</Badge></td>
                <td colSpan={dovizli ? 6 : 4}>Dönem başı bakiyesi</td>
                <td className={`num${Number(ekstre.devir) < 0 ? " is-negative" : ""}`}><strong><Para deger={ekstre.devir} dovizCinsi={doviz} /></strong></td>
              </tr>
            )}
            {ekstre.satirlar.map((s) => {
              const ek = [s.kaynak, s.karsiHesap ? `${s.tip === "virman_gelis" ? "Kaynak" : "Hedef"}: ${s.karsiHesap}` : null].filter(Boolean).join(" · ");
              return (
                <tr key={s.id} className={s.kaynakTur === "acilis" ? "is-opening" : s.kaynakTur === "ters_kayit" ? "is-reversed" : undefined}>
                  <td><Tarih deger={s.tarih} /></td>
                  <td className="mono">{s.makbuzNo ?? ""}</td>
                  <td><Badge variant={ISLEM_RENGI[s.islem] ?? "neutral"}>{s.islem}</Badge></td>
                  <td>{s.aciklama || "—"}{ek && <small className="muted account-statement__sub">{ek}</small>}</td>
                  <td>{s.cari ?? "—"}{s.belge && <small className="muted account-statement__sub">Fatura {s.belge}</small>}</td>
                  <td className="num is-in">{s.giris ? <Para deger={s.giris} dovizCinsi={doviz} /> : ""}</td>
                  <td className="num is-out">{s.cikis ? <Para deger={s.cikis} dovizCinsi={doviz} /> : ""}</td>
                  {dovizli && <td className="num">{Number(s.kur).toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>}
                  {dovizli && <td className="num"><Para deger={s.tutarTry} dovizCinsi="TRY" /></td>}
                  <td className={`num${Number(s.bakiye) < 0 ? " is-negative" : ""}`}><Para deger={s.bakiye} dovizCinsi={doviz} /></td>
                </tr>
              );
            })}
            {!ekstre.satirlar.length && (
              <tr><td colSpan={kolonSayisi}><div className="fx-empty"><strong>Bu dönemde hareket yok.</strong><span>Dönemi genişletin ya da başka bir hesap seçin.</span></div></td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}><strong>Dönem toplamı</strong> <small className="muted">· {ekstre.satirlar.length} hareket</small></td>
              <td className="num"><strong><Para deger={ekstre.giris} dovizCinsi={doviz} /></strong></td>
              <td className="num"><strong><Para deger={ekstre.cikis} dovizCinsi={doviz} /></strong></td>
              {dovizli && <td />}
              {dovizli && <td className="num"><strong><Para deger={Number(ekstre.girisTry) - Number(ekstre.cikisTry)} dovizCinsi="TRY" /></strong></td>}
              <td className={`num${Number(ekstre.donemSonu) < 0 ? " is-negative" : ""}`}><strong><Para deger={ekstre.donemSonu} dovizCinsi={doviz} /></strong></td>
            </tr>
          </tfoot>
        </Table>
      )}
      {dovizli && ekstre && (
        <p className="fx-note">TL karşılıkları her hareketin kayıt kuruyla hesaplanır; dönem sonu değerlemesi için Finans › Kur Farkı › Dönem sonu değerleme ekranına bakın.</p>
      )}
    </div>
  );
}

/**
 * Hesabın açılış bakiyesi: yoksa girilir, varsa değiştirilir ya da silinir.
 * Değiştirme ve silme gerekçe ister (denetim izine yazılır).
 */
function AcilisPaneli({ hesapAnahtari, hesap, ilkHareketTarihi, onKaydedildi }: { hesapAnahtari: string; hesap: Hesap; ilkHareketTarihi: string | null; onKaydedildi: (mesaj: string) => Promise<void> }) {
  const mevcut = hesap.acilis;
  const [mod, setMod] = useState<"goster" | "duzenle" | "sil">("goster");
  const [yon, setYon] = useState<"arti" | "eksi">(mevcut && Number(mevcut.tutar) < 0 ? "eksi" : "arti");
  const [tutar, setTutar] = useState(mevcut ? String(Math.abs(Number(mevcut.tutar))) : "");
  // Açılış ilk hareketten sonraya konamaz; yeni açılış o tarihle başlar.
  const [tarih, setTarih] = useState(mevcut?.tarih ?? ilkHareketTarihi ?? bugunTR());
  const [kur, setKur] = useState(mevcut && hesap.dovizCinsi !== "TRY" ? String(Number(mevcut.kur)) : "");
  const [aciklama, setAciklama] = useState(mevcut?.aciklama ?? "");
  const [neden, setNeden] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const dovizli = hesap.dovizCinsi !== "TRY";

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setIsleniyor(true);
    setHata("");
    try {
      const isaretli = (yon === "eksi" ? "-" : "") + Number(tutar.replace(",", ".")).toFixed(2);
      await api(`/kasa-banka/hesaplar/${hesapAnahtari}/acilis`, {
        method: "PUT",
        body: JSON.stringify({ tutar: isaretli, tarih, kur: dovizli && kur ? kur.replace(",", ".") : null, aciklama: aciklama || null, neden: mevcut ? neden : null }),
      });
      setMod("goster");
      await onKaydedildi(mevcut ? "Açılış bakiyesi değiştirildi; eski değer denetim izine yazıldı." : "Açılış bakiyesi kaydedildi.");
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Açılış bakiyesi kaydedilemedi");
    } finally {
      setIsleniyor(false);
    }
  }

  async function sil(e: React.FormEvent) {
    e.preventDefault();
    setIsleniyor(true);
    setHata("");
    try {
      await api(`/kasa-banka/hesaplar/${hesapAnahtari}/acilis/sil`, { method: "POST", body: JSON.stringify({ neden }) });
      setMod("goster");
      await onKaydedildi("Açılış bakiyesi silindi; kaydın görüntüsü denetim izine yazıldı.");
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Açılış bakiyesi silinemedi");
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <Card
      className="opening-panel"
      title={<div><span className="opening-panel__eyebrow">AÇILIŞ (DEVİR) BAKİYESİ</span><h2>{hesap.ad}</h2></div>}
      actions={mod === "goster" && (
        <div className="row-tight">
          {mevcut && <Button size="sm" variant="danger" onClick={() => { setNeden(""); setMod("sil"); }}>Sil</Button>}
          <Button size="sm" variant={mevcut ? "ghost" : "primary"} onClick={() => { setNeden(""); setMod("duzenle"); }}>{mevcut ? "Değiştir" : "Açılış bakiyesi gir"}</Button>
        </div>
      )}
    >
      {mod === "goster" && (mevcut ? (
        <p className="opening-panel__summary">
          <strong><Para deger={mevcut.tutar} dovizCinsi={hesap.dovizCinsi} /></strong>
          <span><Tarih deger={mevcut.tarih} /> tarihli açılış{mevcut.aciklama && mevcut.aciklama !== "Açılış bakiyesi" ? ` · ${mevcut.aciklama}` : ""}{dovizli ? ` · kur ${Number(mevcut.kur).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}` : ""}</span>
        </p>
      ) : (
        <p className="opening-panel__summary is-missing">
          <span>Bu hesabın açılış bakiyesi girilmemiş. Sisteme geçmeden önceki bakiyeyi açılış olarak girin: bakiyeye eklenir, tahsilat ya da ödeme sayılmaz, makbuz numarası almaz.</span>
        </p>
      ))}

      {mod === "duzenle" && (
        <form className="opening-panel__form" onSubmit={kaydet}>
          <Segmented<"arti" | "eksi">
            ariaLabel="Bakiye yönü"
            value={yon}
            onChange={setYon}
            items={[{ deger: "arti", baslik: "Artı bakiye" }, { deger: "eksi", baslik: hesap.bankaAdi ? "Eksi bakiye (KMH)" : "Eksi bakiye" }]}
          />
          <div className="opening-panel__grid">
            <Field label={`Tutar (${hesap.dovizCinsi})`}>
              <Input autoFocus required inputMode="decimal" type="number" min="0.01" step="any" value={tutar} onChange={(e) => setTutar(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label={<>Açılış tarihi <small className="muted">· ilk hareketten sonra olamaz</small></>}>
              <Input required type="date" value={tarih} max={ilkHareketTarihi ?? undefined} onChange={(e) => setTarih(e.target.value)} />
            </Field>
            {dovizli && (
              <Field label={<>Kur (TL) <small className="muted">· boşsa açılış gününün kuru</small></>}>
                <Input inputMode="decimal" type="number" min="0.000001" step="any" value={kur} onChange={(e) => setKur(e.target.value)} />
              </Field>
            )}
            <Field label="Açıklama">
              <Input maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Açılış bakiyesi" />
            </Field>
            {mevcut && (
              <Field label="Değişiklik gerekçesi">
                <Input required minLength={3} maxLength={300} value={neden} onChange={(e) => setNeden(e.target.value)} placeholder="Ör. Banka hesap cüzdanıyla düzeltildi" />
              </Field>
            )}
          </div>
          {hata && <Alert tone="error">{hata}</Alert>}
          <footer>
            <Button type="button" onClick={() => { setMod("goster"); setHata(""); }} disabled={isleniyor}>Vazgeç</Button>
            <Button type="submit" variant="primary" disabled={isleniyor || !(Number(tutar) > 0) || (Boolean(mevcut) && neden.trim().length < 3)}>
              {isleniyor ? "Kaydediliyor…" : mevcut ? "Değişikliği kaydet" : "Açılışı kaydet"}
            </Button>
          </footer>
        </form>
      )}

      {mod === "sil" && (
        <form className="opening-panel__form" onSubmit={sil}>
          <Alert tone="warning">Açılış fişi silinince hesabın bakiyesi açılış tutarı kadar değişir. Kaydın görüntüsü denetim izinde kalır.</Alert>
          <Field label="Gerekçe">
            <Input autoFocus required minLength={3} maxLength={300} value={neden} onChange={(e) => setNeden(e.target.value)} placeholder="Ör. Yanlış hesaba girilmişti" />
          </Field>
          {hata && <Alert tone="error">{hata}</Alert>}
          <footer>
            <Button type="button" onClick={() => { setMod("goster"); setHata(""); }} disabled={isleniyor}>Vazgeç</Button>
            <Button type="submit" variant="danger" disabled={isleniyor || neden.trim().length < 3}>{isleniyor ? "Siliniyor…" : "Açılışı sil"}</Button>
          </footer>
        </form>
      )}
    </Card>
  );
}
