"use client";

/**
 * Banka ekstresi yükleme sihirbazı (KSB-06): dosya → sütun eşleme → aktarım.
 * CSV/TXT ve Excel (.xlsx) okunur. Sütun düzeni bankadan bankaya değiştiği için
 * ilk yüklemede kullanıcı eşler; eşleme hesaba kaydedilir.
 */
import { useState } from "react";
import { tokenAl } from "@/lib/api";
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

interface Onizleme {
  bankaHesapId: string;
  bankaHesapAdi: string;
  basliklar: string[];
  ornekSatirlar: string[][];
  toplamSatir: number;
  esleme: SutunEslemesi;
  eslemeKayitli: boolean;
}

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

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

async function formGonder<T>(yol: string, govde: FormData): Promise<T> {
  // FormData'da Content-Type'ı tarayıcı sınır bilgisiyle kendisi kurmalı.
  const yanit = await fetch(`${API}${yol}`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${tokenAl() ?? ""}` }, body: govde });
  const veri = await yanit.json();
  if (!yanit.ok) throw new Error(veri.message ?? "İşlem başarısız");
  return veri as T;
}

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
      const veri = await formGonder<Onizleme>("/kasa-banka/ekstre/onizle", govde);
      setOnizleme(veri);
      setEsleme(veri.esleme);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dosya okunamadı");
    } finally {
      setIslemde(null);
    }
  }

  async function aktar() {
    if (!dosya || !onizleme || !esleme) return;
    setHata("");
    setIslemde("yukle");
    try {
      const govde = new FormData();
      govde.append("dosya", dosya);
      govde.append("veri", JSON.stringify({ bankaHesapId: onizleme.bankaHesapId, esleme, eslemeyiKaydet }));
      const veri = await formGonder<{ okunanSatir: number; yeniSatir: number; yinelenenSatir: number; atlananSatir: number }>("/kasa-banka/ekstre/yukle", govde);
      onYuklendi(
        `${veri.okunanSatir} hareket okundu; ${veri.yeniSatir} yeni satır eklendi`
          + (veri.yinelenenSatir > 0 ? `, ${veri.yinelenenSatir} satır daha önce yüklenmişti (atlandı)` : "")
          + (veri.atlananSatir > 0 ? `, ${veri.atlananSatir} veri dışı satır atlandı` : "")
          + ".",
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
          <span className="statement-upload__step">{onizleme ? "2 / 2 · Sütunları eşleyin" : "1 / 2 · Dosyayı seçin"}</span>
          <h2>Ekstre dosyası yükle</h2>
        </div>
        <Button size="sm" onClick={onKapat} disabled={islemde !== null}>Kapat</Button>
      </div>
      {hata && <Alert tone="error">{hata}</Alert>}

      {!onizleme ? (
        <>
          <p className="muted statement-upload__hint">
            İnternet şubesinden hesap hareketlerini <strong>Excel (.xlsx)</strong> ya da <strong>CSV</strong> olarak indirin. İlk
            yüklemede hangi sütunun ne olduğunu siz eşlersiniz; eşleme hesaba kaydedilir ve sonraki yüklemelerde sorulmaz. Aynı
            dosyayı ikinci kez yüklemek çift kayıt oluşturmaz.
          </p>
          <div className="treasury-form-grid">
            <Field label="Banka hesabı *">
              <Select value={secilenHesap} onChange={(e) => setSecilenHesap(e.target.value)}>
                <option value="">Seçin…</option>
                {hesaplar.map((h) => <option key={h.id} value={h.id}>{h.ad} — {h.bankaAdi} ({h.dovizCinsi})</option>)}
              </Select>
            </Field>
            <Field label="Ekstre dosyası (.xlsx, .csv) *">
              <Input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setDosya(e.target.files?.[0] ?? null)} />
            </Field>
          </div>
          <div className="row-tight">
            <Button variant="primary" onClick={() => void onizle()} disabled={!dosya || !secilenHesap || islemde !== null}>
              {islemde === "onizle" ? "Okunuyor…" : "Dosyayı oku"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="row-tight">
            <Badge variant="info">{onizleme.bankaHesapAdi}</Badge>
            <Badge variant="neutral">{onizleme.toplamSatir} satır</Badge>
            {onizleme.eslemeKayitli ? <Badge variant="success">Kayıtlı eşleme kullanılıyor</Badge> : <Badge variant="warning">Eşleme tahmin edildi — kontrol edin</Badge>}
          </div>
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
            Bu eşlemeyi hesaba kaydet (sonraki yüklemede sorulmasın)
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
