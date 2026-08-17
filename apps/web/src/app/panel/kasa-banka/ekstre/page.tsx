"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface BankaHesap {
  id: string;
  ad: string;
  bankaAdi: string;
  dovizCinsi: string;
}

interface PosHesap {
  id: string;
  ad: string;
  saglayici: string;
  dovizCinsi: string;
  bakiye: string;
  aktif: boolean;
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

interface OnerilenFatura {
  id: string;
  no: string | null;
  tarih: string;
  genelToplam: string;
  odenen: string;
  kalan: string;
  tamEslesme: boolean;
}

interface CariOzet {
  id: string;
  kod: string;
  unvan: string;
}

interface EkstreSatir {
  id: string;
  bankaHesap: { id: string; ad: string; dovizCinsi: string };
  tarih: string;
  tutar: string;
  yon: "tahsilat" | "tediye";
  aciklama: string;
  dekontNo: string | null;
  karsiIban: string | null;
  karsiUnvan: string | null;
  bakiye: string | null;
  durum: "beklemede" | "eslesti" | "yoksayildi";
  cari: CariOzet | null;
  fatura: { id: string; no: string | null; genelToplam: string } | null;
  hareketId: string | null;
  onerilenCari: CariOzet | null;
  cariEslesmeKaynagi: "iban" | "vkn" | "unvan" | null;
  onerilenFaturalar: OnerilenFatura[];
}

/* ─── Yardımcılar ────────────────────────────────────────────────────────── */

const para = (deger: string | number, doviz = "TRY"): string =>
  `${Number(deger).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${doviz === "TRY" ? "₺" : doviz}`;

const KAYNAK_ETIKETI: Record<string, string> = {
  iban: "IBAN",
  vkn: "VKN",
  unvan: "ünvan",
};

/** Eşlemede seçilebilecek alanlar; tarih ve açıklama zorunlu. */
const ESLEME_ALANLARI: { anahtar: keyof SutunEslemesi; baslik: string; zorunlu?: boolean }[] = [
  { anahtar: "tarih", baslik: "Tarih *", zorunlu: true },
  { anahtar: "aciklama", baslik: "Açıklama *", zorunlu: true },
  { anahtar: "tutar", baslik: "Tutar (işaretli)" },
  { anahtar: "borc", baslik: "Borç (çıkış)" },
  { anahtar: "alacak", baslik: "Alacak (giriş)" },
  { anahtar: "dekontNo", baslik: "Dekont / Referans" },
  { anahtar: "karsiIban", baslik: "Karşı IBAN" },
  { anahtar: "karsiUnvan", baslik: "Karşı Ünvan" },
  { anahtar: "bakiye", baslik: "Bakiye" },
];

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function EkstreSayfasi() {
  const [hesaplar, setHesaplar] = useState<BankaHesap[]>([]);
  const [posHesaplar, setPosHesaplar] = useState<PosHesap[]>([]);
  const [satirlar, setSatirlar] = useState<EkstreSatir[]>([]);
  const [suzgec, setSuzgec] = useState<"beklemede" | "eslesti" | "yoksayildi" | "hepsi">(
    "beklemede",
  );
  const [bankaFiltresi, setBankaFiltresi] = useState("");
  const [yonFiltresi, setYonFiltresi] = useState<"hepsi" | "tahsilat" | "tediye">("hepsi");
  const [arama, setArama] = useState("");
  const [tarihBaslangic, setTarihBaslangic] = useState("");
  const [tarihBitis, setTarihBitis] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState<string | null>(null);

  // Yükleme sihirbazı
  const [yuklemeAcik, setYuklemeAcik] = useState(false);
  const [secilenHesap, setSecilenHesap] = useState("");
  const [dosya, setDosya] = useState<File | null>(null);
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [esleme, setEsleme] = useState<SutunEslemesi | null>(null);
  const [eslemeyiKaydet, setEslemeyiKaydet] = useState(true);

  // Satır başına seçimler
  const [seciliCari, setSeciliCari] = useState<Record<string, CariOzet>>({});
  const [seciliFatura, setSeciliFatura] = useState<Record<string, string>>({});
  const [cariSecici, setCariSecici] = useState<string | null>(null);
  const [cariArama, setCariArama] = useState("");
  const [cariSonuc, setCariSonuc] = useState<CariOzet[]>([]);
  const [mutabakat, setMutabakat] = useState<EkstreSatir | null>(null);

  const listeYukle = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (suzgec !== "hepsi") qs.set("durum", suzgec);
      if (bankaFiltresi) qs.set("bankaHesapId", bankaFiltresi);
      if (arama.trim()) qs.set("arama", arama.trim());
      if (tarihBaslangic) qs.set("baslangic", tarihBaslangic);
      if (tarihBitis) qs.set("bitis", tarihBitis);
      if (yonFiltresi !== "hepsi") qs.set("yon", yonFiltresi);
      const yol =
        suzgec === "hepsi"
          ? `/kasa-banka/ekstre/satirlar?${qs}`
          : `/kasa-banka/ekstre/satirlar?${qs}`;
      setSatirlar(await api<EkstreSatir[]>(yol));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Ekstre satırları yüklenemedi");
    }
  }, [suzgec, bankaFiltresi, yonFiltresi, arama, tarihBaslangic, tarihBitis]);

  useEffect(() => {
    if (!tokenAl()) return;
    void listeYukle();
  }, [listeYukle]);

  useEffect(() => {
    if (!tokenAl()) return;
    void Promise.all([api<BankaHesap[]>("/kasa-banka/bankalar"), api<PosHesap[]>("/kasa-banka/pos-hesaplari")])
      .then(([bankalar, poslar]) => { setHesaplar(bankalar); setPosHesaplar(poslar); })
      .catch(() => undefined);
  }, []);

  // Cari seçici araması
  useEffect(() => {
    if (cariSecici === null) return;
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      void api<{ kayitlar: CariOzet[] }>(
        `/cari${cariArama.trim() ? `?arama=${encodeURIComponent(cariArama.trim())}` : ""}`,
      )
        .then((v) => {
          if (!iptal) setCariSonuc(v.kayitlar.slice(0, 25));
        })
        .catch(() => {
          if (!iptal) setCariSonuc([]);
        });
    }, 250);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [cariSecici, cariArama]);

  /* ─── Yükleme akışı ────────────────────────────────────────────────────── */

  async function onizle() {
    if (!dosya || !secilenHesap) return;
    setHata("");
    setBasari("");
    setIslemde("onizle");
    try {
      const govde = new FormData();
      govde.append("dosya", dosya);
      govde.append("bankaHesapId", secilenHesap);
      // FormData'da Content-Type'ı tarayıcı sınır bilgisiyle kendisi kurmalı
      const yanit = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/kasa-banka/ekstre/onizle`,
        {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${tokenAl() ?? ""}` },
          body: govde,
        },
      );
      const veri = await yanit.json();
      if (!yanit.ok) throw new Error(veri.message ?? "Önizleme başarısız");
      setOnizleme(veri as Onizleme);
      setEsleme((veri as Onizleme).esleme);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dosya okunamadı");
    } finally {
      setIslemde(null);
    }
  }

  async function yukle() {
    if (!dosya || !onizleme || !esleme) return;
    setHata("");
    setBasari("");
    setIslemde("yukle");
    try {
      const govde = new FormData();
      govde.append("dosya", dosya);
      govde.append(
        "veri",
        JSON.stringify({ bankaHesapId: onizleme.bankaHesapId, esleme, eslemeyiKaydet }),
      );
      const yanit = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/kasa-banka/ekstre/yukle`,
        {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${tokenAl() ?? ""}` },
          body: govde,
        },
      );
      const veri = await yanit.json();
      if (!yanit.ok) throw new Error(veri.message ?? "Yükleme başarısız");

      setBasari(
        `${veri.okunanSatir} hareket okundu; ${veri.yeniSatir} yeni satır eklendi` +
          (veri.yinelenenSatir > 0
            ? `, ${veri.yinelenenSatir} satır daha önce yüklenmişti (atlandı)`
            : "") +
          (veri.atlananSatir > 0 ? `, ${veri.atlananSatir} veri dışı satır atlandı` : "") +
          ".",
      );
      yuklemeyiKapat();
      setSuzgec("beklemede");
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme başarısız");
    } finally {
      setIslemde(null);
    }
  }

  function yuklemeyiKapat() {
    setYuklemeAcik(false);
    setDosya(null);
    setOnizleme(null);
    setEsleme(null);
  }

  /* ─── Satır eylemleri ──────────────────────────────────────────────────── */

  function cariAl(s: EkstreSatir): CariOzet | null {
    return seciliCari[s.id] ?? s.onerilenCari ?? s.cari ?? null;
  }

  async function eslestir(s: EkstreSatir) {
    const cari = cariAl(s);
    if (!cari) return;
    setHata("");
    setBasari("");
    setIslemde(`eslestir-${s.id}`);
    try {
      await api(`/kasa-banka/ekstre/satirlar/${s.id}/eslestir`, {
        method: "POST",
        body: JSON.stringify({
          cariId: cari.id,
          faturaId: seciliFatura[s.id] || null,
        }),
      });
      setBasari(
        `${para(s.tutar, s.bankaHesap.dovizCinsi)} tutarlı hareket ${cari.unvan} carisine ${
          s.yon === "tahsilat" ? "tahsilat" : "tediye"
        } fişi olarak işlendi.`,
      );
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Eşleştirme başarısız");
    } finally {
      setIslemde(null);
    }
  }

  async function satirEylemi(s: EkstreSatir, eylem: "yoksay" | "geri-al") {
    setHata("");
    setBasari("");
    setIslemde(`${eylem}-${s.id}`);
    try {
      await api(`/kasa-banka/ekstre/satirlar/${s.id}/${eylem}`, { method: "POST" });
      setBasari(
        eylem === "yoksay"
          ? "Satır yoksayıldı."
          : "Eşleştirme geri alındı; oluşan fiş ve cari hareketi silindi.",
      );
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
    } finally {
      setIslemde(null);
    }
  }

  async function posMutabakatiYap(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!mutabakat) return; const f = new FormData(e.currentTarget);
    setHata(""); setBasari(""); setIslemde(`pos-${mutabakat.id}`);
    try {
      const sonuc = await api<{ netTutar: string; komisyonTutar: string }>("/kasa-banka/pos-hesaplari/bankaya-aktar", { method: "POST", body: JSON.stringify({ posHesapId: f.get("posHesapId"), bankaHesapId: mutabakat.bankaHesap.id, ekstreSatirId: mutabakat.id, brutTutar: f.get("brutTutar"), komisyonTutar: f.get("komisyonTutar") || "0", tarih: mutabakat.tarih.slice(0, 10), aciklama: mutabakat.aciklama }) });
      setBasari(`${sonuc.netTutar} ${mutabakat.bankaHesap.dovizCinsi} sağlayıcı ödemesi POS hesabıyla mutabık hale getirildi; ${sonuc.komisyonTutar} komisyon işlendi.`);
      setMutabakat(null); await listeYukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "POS mutabakatı yapılamadı"); }
    finally { setIslemde(null); }
  }

  /* ─── Görünüm ──────────────────────────────────────────────────────────── */

  const bekleyen = satirlar.filter((s) => s.durum === "beklemede").length;
  const eslesenTutar = satirlar
    .filter((s) => s.durum === "eslesti")
    .reduce((t, s) => t + Math.abs(Number(s.tutar)), 0);

  return (
    <div className="statement-page">
      <section className="statement-hero"><div><span>BANKA MUTABAKAT MERKEZİ</span><h1>Banka ekstresi çalışma alanı</h1><p>Ekstreleri içeri alın, cari ve faturalarla eşleştirin; banka hareketlerini güvenli biçimde muhasebeleştirin.</p></div><div><ButtonLabel as="a" href="/panel/kasa-banka">← Kasa & Banka</ButtonLabel><Button variant="primary" onClick={() => setYuklemeAcik(!yuklemeAcik)} disabled={islemde !== null}>{yuklemeAcik ? "Vazgeç" : "+ Ekstre yükle"}</Button></div></section>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {yuklemeAcik && (
        <Card style={{ marginBottom: "1.5rem" }} className="stack">
          <div className="card__title" style={{ margin: 0 }}>
            Ekstre Dosyası Yükle
          </div>

          {!onizleme ? (
            <>
              <p className="muted" style={{ fontSize: "0.875rem", margin: 0 }}>
                Bankanızın internet şubesinden hesap hareketlerini <strong>CSV</strong>{" "}
                olarak indirin. Sütun düzeni bankadan bankaya değiştiği için ilk
                yüklemede hangi sütunun ne olduğunu siz eşlersiniz; eşleme hesaba
                kaydedilir ve sonraki yüklemelerde sorulmaz.
              </p>
              <div className="row">
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Banka Hesabı *">
                    <Select
                      value={secilenHesap}
                      onChange={(e) => setSecilenHesap(e.target.value)}
                    >
                      <option value="">Seçiniz...</option>
                      {hesaplar.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.ad} — {h.bankaAdi} ({h.dovizCinsi})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div style={{ flex: 2, minWidth: 240 }}>
                  <Field label="Ekstre Dosyası (CSV) *">
                    <Input
                      type="file"
                      accept=".csv,.txt,text/csv"
                      onChange={(e) => setDosya(e.target.files?.[0] ?? null)}
                    />
                  </Field>
                </div>
              </div>
              <div className="row-tight">
                <Button
                  variant="primary"
                  onClick={() => void onizle()}
                  disabled={!dosya || !secilenHesap || islemde !== null}
                >
                  {islemde === "onizle" ? "Okunuyor..." : "Dosyayı Oku"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="row-tight">
                <Badge variant="info">{onizleme.bankaHesapAdi}</Badge>
                <Badge variant="neutral">{onizleme.toplamSatir} satır</Badge>
                {onizleme.eslemeKayitli ? (
                  <Badge variant="success">KAYITLI EŞLEME KULLANILIYOR</Badge>
                ) : (
                  <Badge variant="warning">EŞLEME TAHMİN EDİLDİ — KONTROL EDİN</Badge>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <TableWrap>
                  <thead>
                    <tr>
                      {onizleme.basliklar.map((b, i) => (
                        <th key={i}>
                          <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>sütun {i}</div>
                          {b || <em>(boş)</em>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {onizleme.ornekSatirlar.map((satir, i) => (
                      <tr key={i}>
                        {onizleme.basliklar.map((_, j) => (
                          <td key={j} className="mono" style={{ fontSize: "0.8rem" }}>
                            {satir[j] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>

              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Tutar tek sütunda işaretli geliyorsa <strong>Tutar</strong>'ı seçin;
                banka ayrı sütunlar veriyorsa <strong>Borç</strong> ve{" "}
                <strong>Alacak</strong>'ın ikisini birden seçin.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                  gap: "0.75rem",
                }}
              >
                {ESLEME_ALANLARI.map((alan) => (
                  <Field key={alan.anahtar} label={alan.baslik}>
                    <Select
                      value={
                        esleme?.[alan.anahtar] === null ||
                        esleme?.[alan.anahtar] === undefined
                          ? ""
                          : String(esleme[alan.anahtar])
                      }
                      onChange={(e) =>
                        setEsleme((m) =>
                          m
                            ? {
                                ...m,
                                [alan.anahtar]:
                                  e.target.value === "" ? null : Number(e.target.value),
                              }
                            : m,
                        )
                      }
                    >
                      <option value="">— yok —</option>
                      {onizleme.basliklar.map((b, i) => (
                        <option key={i} value={i}>
                          {i}: {b || "(boş)"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>

              <label className="row-tight" style={{ fontSize: "0.9rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={eslemeyiKaydet}
                  onChange={(e) => setEslemeyiKaydet(e.target.checked)}
                />
                Bu eşlemeyi hesaba kaydet (sonraki yüklemede sorulmasın)
              </label>

              <div className="row-tight">
                <Button
                  variant="primary"
                  onClick={() => void yukle()}
                  disabled={islemde !== null}
                >
                  {islemde === "yukle" ? "Yükleniyor..." : "Satırları Aktar"}
                </Button>
                <Button onClick={() => setOnizleme(null)}>← Dosya Seçimine Dön</Button>
              </div>
            </>
          )}
        </Card>
      )}

      <div className="statement-kpis"><StatGrid>
        <Stat label="Onay Bekleyen" value={bekleyen} tone={bekleyen > 0 ? "accent" : "default"} />
        <Stat label="Görüntülenen Satır" value={satirlar.length} />
        <Stat label="Eşleşen Tutar" value={para(eslesenTutar)} tone="success" />
        <Stat label="Cari bulunamayan" value={satirlar.filter(s=>s.durum==="beklemede"&&!cariAl(s)).length} tone="danger" />
      </StatGrid></div>

      <Card className="statement-filter"><div className="statement-filter__head"><div><span>EKSTRE FİLTRELERİ</span><strong>Mutabakat görünümünü daraltın</strong></div><small>{satirlar.length} kayıt gösteriliyor</small></div><div className="statement-filter__grid">
        <Select aria-label="Banka hesabı" value={bankaFiltresi} onChange={e=>setBankaFiltresi(e.target.value)}><option value="">Tüm banka hesapları</option>{hesaplar.map(h=><option key={h.id} value={h.id}>{h.ad} · {h.dovizCinsi}</option>)}</Select>
        <Select aria-label="Hareket yönü" value={yonFiltresi} onChange={e=>setYonFiltresi(e.target.value as typeof yonFiltresi)}><option value="hepsi">Giriş ve çıkış</option><option value="tahsilat">Girişler / tahsilat</option><option value="tediye">Çıkışlar / tediye</option></Select>
        <Input aria-label="Ekstre ara" value={arama} onChange={e=>setArama(e.target.value)} placeholder="Açıklama, dekont, IBAN veya cari ara…" />
        <Input aria-label="Başlangıç tarihi" type="date" value={tarihBaslangic} onChange={e=>setTarihBaslangic(e.target.value)} />
        <Input aria-label="Bitiş tarihi" type="date" value={tarihBitis} onChange={e=>setTarihBitis(e.target.value)} />
        {(bankaFiltresi||yonFiltresi!=="hepsi"||arama||tarihBaslangic||tarihBitis)&&<Button size="sm" onClick={()=>{setBankaFiltresi("");setYonFiltresi("hepsi");setArama("");setTarihBaslangic("");setTarihBitis("");}}>Temizle</Button>}
      </div><div className="statement-filter__tabs">
        <Segmented
          value={suzgec}
          onChange={setSuzgec}
          items={[
            { deger: "beklemede", baslik: "Onay Bekleyen" },
            { deger: "eslesti", baslik: "Eşleşmiş" },
            { deger: "yoksayildi", baslik: "Yoksayılan" },
            { deger: "hepsi", baslik: "Tümü" },
          ]}
        />
      </div></Card>

      {mutabakat && <Card style={{ marginBottom: "1rem" }}><form className="stack" onSubmit={posMutabakatiYap}><div className="between"><div><h3 style={{ margin: 0 }}>POS sağlayıcı ödemesi</h3><p className="muted" style={{ marginBottom: 0 }}>Bankaya gelen net tutar: {para(mutabakat.tutar, mutabakat.bankaHesap.dovizCinsi)}. Brüt tahsilat eksi komisyon bu net tutara eşit olmalıdır.</p></div><Button onClick={() => setMutabakat(null)}>Vazgeç</Button></div><div className="row"><Field label="POS hesabı"><Select name="posHesapId" required><option value="">Hesap seçin</option>{posHesaplar.filter((p) => p.aktif && p.dovizCinsi === mutabakat.bankaHesap.dovizCinsi).map((p) => <option key={p.id} value={p.id}>{p.ad} · {p.saglayici} · bakiye {p.bakiye}</option>)}</Select></Field><Field label="Brüt sağlayıcı alacağı"><Input name="brutTutar" type="number" min="0.01" step="0.01" required defaultValue={mutabakat.tutar} /></Field><Field label="Komisyon / kesinti"><Input name="komisyonTutar" type="number" min="0" step="0.01" defaultValue="0" /></Field></div><Button type="submit" variant="primary" disabled={islemde !== null}>POS → banka mutabakatını işle</Button></form></Card>}

      <Card className="statement-register" pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Açıklama</th>
              <th className="num">Tutar</th>
              <th style={{ minWidth: 300 }}>Cari / Fatura</th>
              <th className="num">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Bu görünümde satır yok. Ekstre yükleyerek başlayın.
                </td>
              </tr>
            ) : (
              satirlar.map((s) => {
                const cari = cariAl(s);
                const bekliyor = s.durum === "beklemede";
                return (
                  <tr key={s.id}>
                    <td>{s.tarih}</td>
                    <td>
                      <div>{s.aciklama}</div>
                      <div className="muted mono" style={{ fontSize: "0.78rem" }}>
                        {[
                          s.dekontNo && `dekont: ${s.dekontNo}`,
                          s.karsiIban && s.karsiIban,
                          s.bankaHesap.ad,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td
                      className="num"
                      style={{
                        fontWeight: 700,
                        color: s.yon === "tahsilat" ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {para(s.tutar, s.bankaHesap.dovizCinsi)}
                      <div className="muted" style={{ fontWeight: 400, fontSize: "0.75rem" }}>
                        {s.yon === "tahsilat" ? "tahsilat" : "tediye"}
                      </div>
                    </td>
                    <td>
                      {s.durum === "yoksayildi" ? (
                        <Badge variant="neutral">YOKSAYILDI</Badge>
                      ) : s.durum === "eslesti" ? (
                        <div>
                          <Badge variant="success">İŞLENDİ</Badge>{" "}
                          {s.cari && (
                            <>
                              <code className="mono">{s.cari.kod}</code> {s.cari.unvan}
                            </>
                          )}
                          {s.fatura && (
                            <div className="muted" style={{ fontSize: "0.8rem" }}>
                              Fatura: {s.fatura.no ?? "(taslak)"} —{" "}
                              {para(s.fatura.genelToplam)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="stack" style={{ gap: "0.4rem" }}>
                          <div className="row-tight" style={{ flexWrap: "wrap" }}>
                            {cari ? (
                              <>
                                <span>
                                  <code className="mono">{cari.kod}</code> {cari.unvan}
                                </span>
                                {s.cariEslesmeKaynagi &&
                                  cari.id === s.onerilenCari?.id &&
                                  !seciliCari[s.id] && (
                                    <Badge variant="info">
                                      oto: {KAYNAK_ETIKETI[s.cariEslesmeKaynagi]}
                                    </Badge>
                                  )}
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setCariSecici(s.id);
                                    setCariArama("");
                                  }}
                                >
                                  Değiştir
                                </Button>
                              </>
                            ) : (
                              <>
                                <Badge variant="danger">CARİ BULUNAMADI</Badge>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setCariSecici(s.id);
                                    setCariArama("");
                                  }}
                                >
                                  Cari Seç
                                </Button>
                              </>
                            )}
                          </div>

                          {cari && s.onerilenFaturalar.length > 0 && (
                            <Select
                              value={seciliFatura[s.id] ?? ""}
                              onChange={(e) =>
                                setSeciliFatura((f) => ({ ...f, [s.id]: e.target.value }))
                              }
                            >
                              <option value="">Fatura bağlama (yalnız bakiyeye işle)</option>
                              {s.onerilenFaturalar.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.tamEslesme ? "✓ " : ""}
                                  {f.no ?? "(no yok)"} · {f.tarih} · kalan {f.kalan}
                                </option>
                              ))}
                            </Select>
                          )}

                          {cariSecici === s.id && (
                            <div
                              style={{
                                padding: "0.75rem",
                                border: "1px dashed var(--border-strong)",
                                borderRadius: "var(--radius-sm)",
                              }}
                            >
                              <SearchInput
                                value={cariArama}
                                onChange={(e) => setCariArama(e.target.value)}
                                placeholder="Cari adı, kodu veya VKN..."
                                autoFocus
                              />
                              <div
                                style={{ maxHeight: 180, overflowY: "auto", marginTop: "0.5rem" }}
                              >
                                {cariSonuc.length === 0 ? (
                                  <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                                    Sonuç yok.
                                  </p>
                                ) : (
                                  cariSonuc.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      className="btn btn--ghost btn--block btn--sm"
                                      style={{
                                        justifyContent: "flex-start",
                                        marginBottom: "0.25rem",
                                      }}
                                      onClick={() => {
                                        setSeciliCari((v) => ({ ...v, [s.id]: c }));
                                        // Cari değişti; önceki fatura seçimi geçersiz.
                                        setSeciliFatura((f) => ({ ...f, [s.id]: "" }));
                                        setCariSecici(null);
                                      }}
                                    >
                                      <code className="mono">{c.kod}</code>&nbsp;{c.unvan}
                                    </button>
                                  ))
                                )}
                              </div>
                              <Button size="sm" onClick={() => setCariSecici(null)}>
                                Kapat
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                        {bekliyor && (
                          <>
                            {s.yon === "tahsilat" && <Button size="sm" onClick={() => setMutabakat(s)} disabled={islemde !== null}>POS ödemesi</Button>}
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => void eslestir(s)}
                              disabled={!cari || islemde !== null}
                            >
                              {islemde === `eslestir-${s.id}` ? "İşleniyor..." : "Eşleştir"}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void satirEylemi(s, "yoksay")}
                              disabled={islemde !== null}
                            >
                              Yoksay
                            </Button>
                          </>
                        )}
                        {!bekliyor && (
                          <Button
                            size="sm"
                            onClick={() => void satirEylemi(s, "geri-al")}
                            disabled={islemde !== null}
                          >
                            {islemde === `geri-al-${s.id}` ? "..." : "Geri Al"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
