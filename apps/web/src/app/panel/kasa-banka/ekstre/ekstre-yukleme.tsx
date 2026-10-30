"use client";

/**
 * Banka ekstresi yükleme sihirbazı (KSB-06): dosya → sütun eşleme → aktarım.
 * CSV/TXT ve Excel (.xlsx) okunur. Sütun düzeni bankadan bankaya değiştiği için
 * ilk yüklemede kullanıcı eşler; eşleme hesaba kaydedilir.
 * KSB-32: MT940 ve camt.052/053 standart dosyalarda eşleme adımı yoktur; özet
 * (hesap, dönem, açılış/kapanış, uyarılar) gösterilip doğrudan aktarılır.
 * KSB-34: metin katmanlı PDF tabloya çevrilip aynı eşleme adımına gelir; PDF
 * eşlemesi ayrı saklanır, bakiye sağlaması ve tarih çakışması uyarı olarak gösterilir.
 */
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, TableWrap } from "@/components/ui";

export interface BankaHesap {
  id: string;
  ad: string;
  bankaAdi: string;
  dovizCinsi: string;
}

interface SutunEslemesi {
  baslikSatiri: number;
  tarih: number;
  aciklama: number;
  tutar?: number | null;
  borc?: number | null;
  alacak?: number | null;
  dekontNo?: number | null;
  karsiIban?: number | null;
  karsiUnvan?: number | null;
  bakiye?: number | null;
}

interface StandartOzet {
  bicim: "mt940" | "camt053" | "camt052";
  hesap: string | null;
  dovizCinsi: string | null;
  satirSayisi: number;
  ilkTarih: string | null;
  sonTarih: string | null;
  acilis: string | null;
  kapanis: string | null;
  uyarilar: string[];
  ornekSatirlar: { tarih: string; tutar: string; aciklama: string; karsiUnvan: string | null; bakiye: string | null }[];
}

interface BakiyeSaglamasi {
  denetlenen: number;
  tutarsizSayisi: number;
  tutarsizlar: { tarih: string; tutar: string; bakiye: string; beklenen: string; aciklama: string }[];
}

interface PdfOzet {
  sayfaSayisi: number;
  bakiyeSaglamasi: BakiyeSaglamasi;
  cakisma: { mevcutSatir: number; ilkTarih: string; sonTarih: string } | null;
}

interface Onizleme {
  bankaHesapId: string;
  bankaHesapAdi: string;
  basliklar: string[];
  ornekSatirlar: string[][];
  toplamSatir: number;
  esleme: SutunEslemesi;
  eslemeKayitli: boolean;
  /** MT940/camt dosyası; varsa eşleme adımı atlanır. */
  standart?: StandartOzet;
  /** KSB-34: dosya PDF'ten okunduysa. */
  pdf?: PdfOzet;
}

const BICIM_ADI: Record<StandartOzet["bicim"], string> = { mt940: "MT940", camt053: "camt.053 gün sonu", camt052: "camt.052 gün içi" };
const tutar = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Eşlemede seçilebilecek alanlar; tarih ve açıklama zorunlu. */
const ESLEME_ALANLARI: { anahtar: keyof SutunEslemesi; baslik: string }[] = [
  { anahtar: "tarih", baslik: "Tarih *" },
  { anahtar: "aciklama", baslik: "Açıklama *" },
  { anahtar: "tutar", baslik: "Tutar (işaretli)" },
  { anahtar: "borc", baslik: "Borç (çıkış)" },
  { anahtar: "alacak", baslik: "Alacak (giriş)" },
  { anahtar: "dekontNo", baslik: "Dekont / Referans" },
  { anahtar: "karsiIban", baslik: "Karşı IBAN" },
  { anahtar: "karsiUnvan", baslik: "Karşı Ünvan" },
  { anahtar: "bakiye", baslik: "Bakiye (mutabakat için)" },
];

export function EkstreYukleme({
  hesaplar,
  varsayilanHesap,
  onKapat,
  onYuklendi,
}: {
  hesaplar: BankaHesap[];
  varsayilanHesap?: string;
  onKapat: () => void;
  onYuklendi: (mesaj: string, bankaHesapId: string) => void;
}) {
  const [secilenHesap, setSecilenHesap] = useState(varsayilanHesap ?? "");
  const [dosya, setDosya] = useState<File | null>(null);
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [esleme, setEsleme] = useState<SutunEslemesi | null>(null);
  const [eslemeyiKaydet, setEslemeyiKaydet] = useState(true);
  const [islemde, setIslemde] = useState<"onizle" | "yukle" | null>(null);
  const [hata, setHata] = useState("");

  async function onizle() {
    if (!dosya || !secilenHesap) return;
    setHata("");
    setIslemde("onizle");
    try {
      const govde = new FormData();
      govde.append("dosya", dosya);
      govde.append("bankaHesapId", secilenHesap);
      const veri = await api<Onizleme>("/kasa-banka/ekstre/onizle", { method: "POST", body: govde });
      setOnizleme(veri);
      setEsleme(veri.esleme ?? null);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dosya okunamadı");
    } finally {
      setIslemde(null);
    }
  }

  async function aktar() {
    if (!dosya || !onizleme || (!onizleme.standart && !esleme)) return;
    setHata("");
    setIslemde("yukle");
    try {
      const govde = new FormData();
      govde.append("dosya", dosya);
      govde.append("veri", JSON.stringify(onizleme.standart ? { bankaHesapId: onizleme.bankaHesapId, eslemeyiKaydet: false } : { bankaHesapId: onizleme.bankaHesapId, esleme, eslemeyiKaydet }));
      const veri = await api<{ okunanSatir: number; yeniSatir: number; yinelenenSatir: number; atlananSatir: number; uyarilar?: string[]; pdf?: PdfOzet }>("/kasa-banka/ekstre/yukle", { method: "POST", body: govde });
      const tutmayan = veri.pdf?.bakiyeSaglamasi.tutarsizSayisi ?? 0;
      onYuklendi(
        `${veri.okunanSatir} hareket okundu; ${veri.yeniSatir} yeni satır eklendi`
          + (veri.yinelenenSatir > 0 ? `, ${veri.yinelenenSatir} satır daha önce yüklenmişti (atlandı)` : "")
          + (veri.atlananSatir > 0 ? `, ${veri.atlananSatir} veri dışı satır atlandı` : "")
          + "."
          + (veri.uyarilar?.length ? ` Uyarı: ${veri.uyarilar.join(" ")}` : "")
          + (tutmayan > 0 ? ` Uyarı: bakiye sağlaması ${tutmayan} satırda tutmadı; bu satırları ekstreyle karşılaştırın.` : ""),
        onizleme.bankaHesapId,
      );
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme başarısız");
    } finally {
      setIslemde(null);
    }
  }

  return (
    <Card className="statement-upload stack">
      <div className="between">
        <div>
          <span className="statement-upload__step">{!onizleme ? "1 / 2 · Dosyayı seçin" : onizleme.standart ? "2 / 2 · Kontrol edip aktarın" : "2 / 2 · Sütunları eşleyin"}</span>
          <h2>Ekstre dosyası yükle</h2>
        </div>
        <Button size="sm" onClick={onKapat} disabled={islemde !== null}>Kapat</Button>
      </div>
      {hata && <Alert tone="error">{hata}</Alert>}

      {!onizleme ? (
        <>
          <p className="muted statement-upload__hint">
            İnternet şubesinden hesap hareketlerini <strong>Excel (.xlsx)</strong>, <strong>CSV</strong> ya da <strong>PDF</strong> olarak indirin. İlk
            yüklemede hangi sütunun ne olduğunu siz eşlersiniz; eşleme hesaba kaydedilir ve sonraki yüklemelerde sorulmaz.
            Bankanız <strong>MT940</strong> ya da <strong>camt.053</strong> veriyorsa onu tercih edin: sütun eşlemesi gerekmez,
            bakiye de dosyadan okunur. PDF yalnız internet şubesinden indirilen dijital dosyadan okunur; taranmış ya da
            fotoğraflanmış ekstre okunmaz. Aynı dosyayı ikinci kez yüklemek çift kayıt oluşturmaz.
          </p>
          <div className="treasury-form-grid">
            <Field label="Banka hesabı *">
              <Select value={secilenHesap} onChange={(e) => setSecilenHesap(e.target.value)}>
                <option value="">Seçin…</option>
                {hesaplar.map((h) => <option key={h.id} value={h.id}>{h.ad} — {h.bankaAdi} ({h.dovizCinsi})</option>)}
              </Select>
            </Field>
            <Field label="Ekstre dosyası (.xlsx, .csv, .pdf, MT940, camt.053) *">
              <Input type="file" accept=".xlsx,.csv,.txt,.pdf,.sta,.mt940,.940,.xml,text/csv,application/pdf,application/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setDosya(e.target.files?.[0] ?? null)} />
            </Field>
          </div>
          <div className="row-tight">
            <Button variant="primary" onClick={() => void onizle()} disabled={!dosya || !secilenHesap || islemde !== null}>
              {islemde === "onizle" ? "Okunuyor…" : "Dosyayı oku"}
            </Button>
          </div>
        </>
      ) : onizleme.standart ? (
        <>
          <div className="row-tight">
            <Badge variant="info">{onizleme.bankaHesapAdi}</Badge>
            <Badge variant="success">{BICIM_ADI[onizleme.standart.bicim]}</Badge>
            <Badge variant="neutral">{onizleme.standart.satirSayisi} hareket</Badge>
          </div>
          <dl className="statement-upload__summary">
            <div><dt>Dosyadaki hesap</dt><dd className="mono">{onizleme.standart.hesap ?? "—"} {onizleme.standart.dovizCinsi ?? ""}</dd></div>
            <div><dt>Dönem</dt><dd>{onizleme.standart.ilkTarih ?? "—"} – {onizleme.standart.sonTarih ?? "—"}</dd></div>
            <div><dt>Açılış bakiyesi</dt><dd className="num">{tutar(onizleme.standart.acilis)}</dd></div>
            <div><dt>Kapanış bakiyesi</dt><dd className="num">{tutar(onizleme.standart.kapanis)}</dd></div>
          </dl>
          {onizleme.standart.uyarilar.map((u, i) => <Alert key={i} tone="warning">{u}</Alert>)}
          <TableWrap>
            <thead><tr><th>Tarih</th><th>Açıklama</th><th>Karşı taraf</th><th className="num">Tutar</th><th className="num">Bakiye</th></tr></thead>
            <tbody>
              {onizleme.standart.ornekSatirlar.map((s, i) => (
                <tr key={i}><td>{s.tarih}</td><td>{s.aciklama}</td><td>{s.karsiUnvan ?? "—"}</td><td className="num">{tutar(s.tutar)}</td><td className="num">{tutar(s.bakiye)}</td></tr>
              ))}
            </tbody>
          </TableWrap>
          {onizleme.standart.satirSayisi > onizleme.standart.ornekSatirlar.length && <p className="muted">İlk {onizleme.standart.ornekSatirlar.length} hareket gösteriliyor.</p>}
          <div className="row-tight">
            <Button variant="primary" onClick={() => void aktar()} disabled={islemde !== null}>
              {islemde === "yukle" ? "Aktarılıyor…" : `${onizleme.standart.satirSayisi} hareketi aktar`}
            </Button>
            <Button onClick={() => setOnizleme(null)} disabled={islemde !== null}>← Dosya seçimine dön</Button>
          </div>
        </>
      ) : (
        <>
          <div className="row-tight">
            <Badge variant="info">{onizleme.bankaHesapAdi}</Badge>
            <Badge variant="neutral">{onizleme.toplamSatir} satır</Badge>
            {onizleme.pdf && <Badge variant="neutral">PDF · {onizleme.pdf.sayfaSayisi} sayfa</Badge>}
            {onizleme.eslemeKayitli ? <Badge variant="success">Kayıtlı eşleme kullanılıyor</Badge> : <Badge variant="warning">Eşleme tahmin edildi — kontrol edin</Badge>}
            {onizleme.pdf && onizleme.pdf.bakiyeSaglamasi.denetlenen > 0 && onizleme.pdf.bakiyeSaglamasi.tutarsizSayisi === 0 && <Badge variant="success">Bakiye sağlaması tuttu</Badge>}
          </div>
          {onizleme.pdf?.cakisma && (
            <Alert tone="warning">
              Bu hesaba {onizleme.pdf.cakisma.ilkTarih} – {onizleme.pdf.cakisma.sonTarih} arasında daha önce {onizleme.pdf.cakisma.mevcutSatir} satır
              yüklenmiş. Aynı dönemin CSV/Excel'i yüklendiyse PDF'teki açıklamalar farklı olabileceği için satırlar mükerrer
              korumasına takılmaz; aktarmadan önce dönemi kontrol edin.
            </Alert>
          )}
          {onizleme.pdf && onizleme.pdf.bakiyeSaglamasi.tutarsizSayisi > 0 && (
            <Alert tone="warning">
              Önceki bakiye + tutar = bakiye sağlaması {onizleme.pdf.bakiyeSaglamasi.tutarsizSayisi} satırda tutmadı; satır yanlış okunmuş ya da
              sütun eşlemesi hatalı olabilir.
              <ul>
                {onizleme.pdf.bakiyeSaglamasi.tutarsizlar.slice(0, 5).map((t, i) => (
                  <li key={i}>{t.tarih} · {t.aciklama} · tutar {tutar(t.tutar)}, bakiye {tutar(t.bakiye)} (beklenen {tutar(t.beklenen)})</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="statement-upload__preview">
            <TableWrap>
              <thead>
                <tr>
                  {onizleme.basliklar.map((b, i) => (
                    <th key={i}><small>sütun {i}</small><br />{b || <em>(boş)</em>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {onizleme.ornekSatirlar.map((satir, i) => (
                  <tr key={i}>{onizleme.basliklar.map((_, j) => <td key={j} className="mono">{satir[j] ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
          <p className="muted statement-upload__hint">
            Tutar tek sütunda işaretli geliyorsa <strong>Tutar</strong>'ı seçin; banka ayrı sütunlar veriyorsa <strong>Borç</strong>{" "}
            ve <strong>Alacak</strong>'ın ikisini birden seçin. <strong>Bakiye</strong> sütunu bakiye mutabakatı için gereklidir.
          </p>
          <div className="statement-upload__mapping">
            {ESLEME_ALANLARI.map((alan) => (
              <Field key={alan.anahtar} label={alan.baslik}>
                <Select
                  value={esleme?.[alan.anahtar] === null || esleme?.[alan.anahtar] === undefined ? "" : String(esleme[alan.anahtar])}
                  onChange={(e) => setEsleme((m) => (m ? { ...m, [alan.anahtar]: e.target.value === "" ? null : Number(e.target.value) } : m))}
                >
                  <option value="">— yok —</option>
                  {onizleme.basliklar.map((b, i) => <option key={i} value={i}>{i}: {b || "(boş)"}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={eslemeyiKaydet} onChange={(e) => setEslemeyiKaydet(e.target.checked)} />
            {onizleme.pdf ? "Bu PDF eşlemesini hesaba kaydet (aynı düzendeki PDF'lerde sorulmasın; CSV/Excel eşlemesi ayrı kalır)" : "Bu eşlemeyi hesaba kaydet (sonraki yüklemede sorulmasın)"}
          </label>
          <div className="row-tight">
            <Button variant="primary" onClick={() => void aktar()} disabled={islemde !== null}>
              {islemde === "yukle" ? "Aktarılıyor…" : "Satırları aktar"}
            </Button>
            <Button onClick={() => setOnizleme(null)} disabled={islemde !== null}>← Dosya seçimine dön</Button>
          </div>
        </>
      )}
    </Card>
  );
}
