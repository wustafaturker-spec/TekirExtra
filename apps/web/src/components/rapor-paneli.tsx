"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir, tokenAl, tumSayfalariAl } from "@/lib/api";
import { AramaSecici } from "@/components/arama-secici";
import { Alert, Badge, Button, Card, EylemMenusu, Field, Input, Modal, ModalEylem, SearchInput, TableSkeleton } from "@/components/ui";
import { AbonelikPenceresi } from "@/components/rapor-abonelik";

/**
 * Ortak rapor paneli (RPR-06/08): rapor kataloğunu API meta verisinden çizer —
 * gruplu ve aranabilir katalog, filtreler (hazır dönemler, aramalı cari/stok),
 * kırılım, sıralama, toplam satırı, Excel/PDF ve kayıtlı görünümler tüm
 * raporlar için buradan gelir. Seçili rapor ve filtreler adreste tutulur:
 * bağlantı paylaşılabilir, geri tuşu çalışır.
 */

interface RaporFiltreTanimi {
  alan: string;
  ad: string;
  tip: "tarih" | "metin" | "sayi" | "secim" | "onay" | "cari" | "stok" | "depo" | "etiket" | "hesap";
  zorunlu?: boolean;
  secenekler?: { deger: string; ad: string }[];
}

interface RaporKolon {
  alan: string;
  baslik: string;
  tip: "metin" | "sayi" | "para" | "yuzde" | "tarih";
  dovizAlani?: string;
  /** RPR-09: hücre satırın bu alanındaki panel yoluna bağlantı olur. */
  baglantiAlani?: string;
  /** Toplam satırında toplanır (yalnız anlamlı sütunlar işaretlidir). */
  toplam?: boolean;
}

interface RaporMeta {
  kod: string;
  modul: string;
  ad: string;
  aciklama: string | null;
  filtreler: RaporFiltreTanimi[];
  gruplamalar: { deger: string; ad: string }[];
  kolonlar: RaporKolon[];
}

type Satir = Record<string, string | number | boolean | null>;
type Siralama = { alan: string; yon: "asc" | "desc" };
type FiltreDegerleri = Record<string, string | number | boolean>;

type ToplamHucresi = { deger: number; doviz?: string } | "karisik";

interface RaporSonucu {
  kolonlar: RaporKolon[];
  /** RPR-17: sunucu en çok AZAMI_SATIR satır gönderir. */
  satirlar: Satir[];
  /** Kesilmeden önceki satır sayısı. */
  satirSayisi?: number;
  /** Bütün satırlardan sunucuda hesaplanan toplam satırı (kesildiğinde de doğru). */
  toplamlar?: Record<string, ToplamHucresi> | null;
}

interface Gorunum {
  id: string;
  ad: string;
  firmaGeneli: boolean;
  girdi: { filtreler?: FiltreDegerleri; gruplama?: string; siralama?: Siralama };
}

interface SecimKaydi {
  id: string;
  ad?: string;
  unvan?: string;
  kod?: string;
}

/** Katalog dışında kendi ekranı olan rapor (ör. Gelir - Gider); listede bağlantı olarak durur. */
export interface AyriEkranRaporu {
  modul: string;
  ad: string;
  aciklama: string;
  href: string;
}

const MODUL_ADLARI: Record<string, string> = {
  fatura: "Satış & Fatura",
  cari: "Cari",
  stok: "Stok",
  urun_hareket: "Ürün Hareketleri",
  kasa_banka: "Kasa & Banka",
  vergi: "Vergi",
  genel: "Genel",
};
const MODUL_SIRASI = Object.keys(MODUL_ADLARI);

/** Ekranda gösterilen en çok satır; fazlası Excel/PDF ile alınır. */
const AZAMI_SATIR = 500;

// ─── Tarih yardımcıları (Türkiye günü, YYYY-AA-GG) ───────────────────────────

const gunMetni = (d: Date) => d.toISOString().slice(0, 10);
const utc = (yil: number, ay: number, gun: number) => new Date(Date.UTC(yil, ay, gun));
const trTarih = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "UTC" }) : "");

function hazirDonemler(): { ad: string; baslangic: string; bitis: string }[] {
  const bugun = bugunTR();
  const [y, a] = bugun.split("-").map(Number) as [number, number];
  const ay = a - 1;
  const ceyrek = Math.floor(ay / 3) * 3;
  return [
    { ad: "Bu ay", baslangic: gunMetni(utc(y, ay, 1)), bitis: bugun },
    { ad: "Geçen ay", baslangic: gunMetni(utc(y, ay - 1, 1)), bitis: gunMetni(utc(y, ay, 0)) },
    { ad: "Bu çeyrek", baslangic: gunMetni(utc(y, ceyrek, 1)), bitis: bugun },
    { ad: "Bu yıl", baslangic: `${y}-01-01`, bitis: bugun },
    { ad: "Geçen yıl", baslangic: `${y - 1}-01-01`, bitis: `${y - 1}-12-31` },
    { ad: "Son 30 gün", baslangic: gunMetni(new Date(Date.parse(`${bugun}T00:00:00Z`) - 29 * 86_400_000)), bitis: bugun },
  ];
}

/** Raporda başlangıç–bitiş çifti varsa varsayılan dönem "bu ay" (kullanıcı kararı 2026-10-11). */
function varsayilanFiltreler(r: RaporMeta): FiltreDegerleri {
  const alanlar = new Set(r.filtreler.map((f) => f.alan));
  if (!alanlar.has("baslangic") || !alanlar.has("bitis")) return {};
  const buAy = hazirDonemler()[0]!;
  return { baslangic: buAy.baslangic, bitis: buAy.bitis };
}

// ─── Biçimleme ───────────────────────────────────────────────────────────────

const SAYISAL = ["sayi", "para", "yuzde"];

function hucreBicimle(kolon: RaporKolon, deger: string | number | boolean | null | undefined, satir?: Satir): string {
  if (deger === null || deger === undefined || deger === "") return "—";
  switch (kolon.tip) {
    case "para": {
      const doviz = kolon.dovizAlani ? String(satir?.[kolon.dovizAlani] ?? "TRY") : "TRY";
      return `${Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;
    }
    case "sayi":
      return Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });
    case "yuzde":
      return `%${Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "tarih":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(deger)) ? trTarih(String(deger)) : String(deger);
    default:
      return String(deger);
  }
}

/**
 * Toplam satırı: yalnız `toplam` işaretli sütunlar. Dövizli sütun, satırların
 * hepsi aynı dövizdeyse toplanır; karışıksa "—" (farklı para birimi toplanmaz).
 */
function toplamlar(kolonlar: RaporKolon[], satirlar: Satir[]): Map<string, string> | null {
  const sonuc = new Map<string, string>();
  for (const k of kolonlar.filter((x) => x.toplam)) {
    const dovizler = k.dovizAlani ? new Set(satirlar.map((s) => String(s[k.dovizAlani!] ?? "TRY"))) : new Set(["TRY"]);
    if (dovizler.size > 1) { sonuc.set(k.alan, "—"); continue; }
    const toplam = satirlar.reduce((t, s) => t + (Number(s[k.alan]) || 0), 0);
    sonuc.set(k.alan, hucreBicimle(k, Math.round(toplam * 100) / 100, { [k.dovizAlani ?? ""]: [...dovizler][0] ?? "TRY" }));
  }
  return sonuc.size ? sonuc : null;
}

/** RPR-17: sunucunun bütün satırlardan hesapladığı toplam satırını biçimler. */
function sunucuToplamlari(kolonlar: RaporKolon[], t: Record<string, ToplamHucresi> | null): Map<string, string> | null {
  if (!t) return null;
  const sonuc = new Map<string, string>();
  for (const k of kolonlar) {
    const h = t[k.alan];
    if (!h) continue;
    sonuc.set(k.alan, h === "karisik" ? "—" : hucreBicimle(k, h.deger, { [k.dovizAlani ?? ""]: h.doviz ?? "TRY" }));
  }
  return sonuc.size ? sonuc : null;
}

// ─── Adres durumu ────────────────────────────────────────────────────────────

/** `?rapor=kod&f.baslangic=…&g=ay&s=alan:desc` */
function adrestenOku(): { kod?: string; filtreler: FiltreDegerleri; gruplama?: string; siralama?: Siralama } {
  const p = new URLSearchParams(window.location.search);
  const filtreler: FiltreDegerleri = {};
  p.forEach((deger, anahtar) => {
    if (!anahtar.startsWith("f.")) return;
    filtreler[anahtar.slice(2)] = deger === "true" ? true : deger === "false" ? false : deger;
  });
  const [alan, yon] = (p.get("s") ?? "").split(":");
  return {
    kod: p.get("rapor") ?? undefined,
    filtreler,
    gruplama: p.get("g") ?? undefined,
    siralama: alan ? { alan, yon: yon === "asc" ? "asc" : "desc" } : undefined,
  };
}

function adreseYaz(kod: string, filtreler: FiltreDegerleri, gruplama: string, siralama: Siralama | null, yeniKayit: boolean) {
  const p = new URLSearchParams(window.location.search);
  for (const anahtar of [...p.keys()]) if (anahtar.startsWith("f.") || ["rapor", "g", "s"].includes(anahtar)) p.delete(anahtar);
  p.set("rapor", kod);
  for (const [alan, deger] of Object.entries(filtreler)) if (deger !== "" && deger !== undefined) p.set(`f.${alan}`, String(deger));
  if (gruplama) p.set("g", gruplama);
  if (siralama) p.set("s", `${siralama.alan}:${siralama.yon}`);
  const url = `${window.location.pathname}?${p.toString()}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (yeniKayit) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

// ─── Bileşen ─────────────────────────────────────────────────────────────────

export function RaporPaneli({ modul, ayriEkranlar = [] }: { modul?: string; ayriEkranlar?: AyriEkranRaporu[] }) {
  const [raporlar, setRaporlar] = useState<RaporMeta[]>([]);
  const [arama, setArama] = useState("");
  const [secilenKod, setSecilenKod] = useState("");
  const [filtreler, setFiltreler] = useState<FiltreDegerleri>({});
  const [gruplama, setGruplama] = useState("");
  const [siralama, setSiralama] = useState<Siralama | null>(null);
  const [sonuc, setSonuc] = useState<(RaporSonucu & { zaman: Date; girdi: FiltreDegerleri; gruplama: string }) | null>(null);
  const [eksikler, setEksikler] = useState<string[]>([]);
  const [gorunumler, setGorunumler] = useState<Gorunum[]>([]);
  const [gorunumPenceresi, setGorunumPenceresi] = useState(false);
  // RPR-24: kayıtlı görünümün zamanlanmış e-postası.
  const [abonelikPenceresi, setAbonelikPenceresi] = useState(false);
  const [gorunumAdi, setGorunumAdi] = useState("");
  const [firmaGeneli, setFirmaGeneli] = useState(false);
  const [kayitlar, setKayitlar] = useState<Record<"cari" | "stok" | "depo" | "hesap" | "etiket", SecimKaydi[]>>({ cari: [], stok: [], depo: [], hesap: [], etiket: [] });
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [indiriliyor, setIndiriliyor] = useState<"" | "excel" | "pdf">("");
  /** Adresten açılınca seçimle birlikte gelen filtreler (rapor değişince sıfırlanmasın diye). */
  const bekleyenAdres = useRef<ReturnType<typeof adrestenOku> | null>(null);

  const secilen = useMemo(() => raporlar.find((r) => r.kod === secilenKod) ?? null, [raporlar, secilenKod]);

  // Katalog
  useEffect(() => {
    if (!tokenAl()) return;
    api<RaporMeta[]>(`/raporlar${modul ? `?modul=${modul}` : ""}`)
      .then((veri) => {
        setRaporlar(veri);
        const adres = adrestenOku();
        const kod = adres.kod && veri.some((r) => r.kod === adres.kod) ? adres.kod : veri[0]?.kod ?? "";
        if (kod === adres.kod) bekleyenAdres.current = adres;
        setSecilenKod(kod);
      })
      .catch((h) => setHata(h instanceof Error ? h.message : "Rapor kataloğu yüklenemedi"));
  }, [modul]);

  // Geri/ileri: adresteki rapora dön
  useEffect(() => {
    const geri = () => {
      const adres = adrestenOku();
      if (adres.kod && raporlar.some((r) => r.kod === adres.kod)) {
        bekleyenAdres.current = adres;
        setSecilenKod(adres.kod);
      }
    };
    window.addEventListener("popstate", geri);
    return () => window.removeEventListener("popstate", geri);
  }, [raporlar]);

  // Rapor değişince: filtreler (adresten ya da varsayılan), görünümler, seçim listeleri
  useEffect(() => {
    if (!secilen) return;
    const adres = bekleyenAdres.current;
    bekleyenAdres.current = null;
    setFiltreler(adres && Object.keys(adres.filtreler).length ? adres.filtreler : varsayilanFiltreler(secilen));
    setGruplama(adres?.gruplama && secilen.gruplamalar.some((g) => g.deger === adres.gruplama) ? adres.gruplama : secilen.gruplamalar[0]?.deger ?? "");
    setSiralama(adres?.siralama ?? null);
    setSonuc(null);
    setEksikler([]);
    setHata("");
    setBilgi("");
    void api<Gorunum[]>(`/raporlar/${secilen.kod}/gorunumler`).then(setGorunumler).catch(() => setGorunumler([]));

    const tipler = new Set(secilen.filtreler.map((f) => f.tip));
    const yukle = (tur: keyof typeof kayitlar, getir: () => Promise<SecimKaydi[]>) => {
      if (!tipler.has(tur) || kayitlar[tur].length) return;
      void getir().then((liste) => setKayitlar((eski) => ({ ...eski, [tur]: liste }))).catch(() => undefined);
    };
    yukle("cari", () => tumSayfalariAl<SecimKaydi>("/cari"));
    yukle("stok", () => tumSayfalariAl<SecimKaydi>("/stok"));
    yukle("depo", () => api<SecimKaydi[]>("/depo?yalnizAktif=true"));
    yukle("etiket", () => api<SecimKaydi[]>("/cari/etiketler"));
    // KSB-14: kasa/banka/POS hesapları tek listede; değer "tur:id".
    yukle("hesap", async () => {
      type Hesap = { id: string; ad: string; dovizCinsi: string };
      const [k, b, p] = await Promise.all([
        api<Hesap[]>("/kasa-banka/kasalar"),
        api<Hesap[]>("/kasa-banka/bankalar"),
        api<Hesap[]>("/kasa-banka/pos-hesaplari").catch(() => [] as Hesap[]),
      ]);
      return [
        ...k.map((h) => ({ id: `kasa:${h.id}`, ad: `Kasa · ${h.ad} (${h.dovizCinsi})` })),
        ...b.map((h) => ({ id: `banka:${h.id}`, ad: `Banka · ${h.ad} (${h.dovizCinsi})` })),
        ...p.map((h) => ({ id: `pos:${h.id}`, ad: `POS · ${h.ad} (${h.dovizCinsi})` })),
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secilen?.kod]);

  const girdiOlustur = useCallback(
    (f: FiltreDegerleri = filtreler, g: string = gruplama, s: Siralama | null = siralama) => {
      const temiz: FiltreDegerleri = {};
      for (const [alan, deger] of Object.entries(f)) if (deger !== "" && deger !== undefined) temiz[alan] = deger;
      return { filtreler: temiz, ...(g ? { gruplama: g } : {}), ...(s ? { siralama: s } : {}) };
    },
    [filtreler, gruplama, siralama],
  );

  const calistir = useCallback(
    async (f: FiltreDegerleri = filtreler, g: string = gruplama, s: Siralama | null = siralama) => {
      if (!secilen) return;
      // Zorunlu alan sunucuya gitmeden alanın altında söylenir.
      const eksik = secilen.filtreler.filter((x) => x.zorunlu && (f[x.alan] === undefined || f[x.alan] === "")).map((x) => x.alan);
      setEksikler(eksik);
      if (eksik.length) return;
      setYukleniyor(true);
      setHata("");
      try {
        const girdi = girdiOlustur(f, g, s);
        const veri = await api<RaporSonucu>(`/raporlar/${secilen.kod}/calistir`, { method: "POST", body: JSON.stringify(girdi) });
        setSonuc({ ...veri, zaman: new Date(), girdi: girdi.filtreler, gruplama: g });
        adreseYaz(secilen.kod, f, g, s, false);
      } catch (h) {
        setHata(h instanceof Error ? h.message : "Rapor çalıştırılamadı");
      } finally {
        setYukleniyor(false);
      }
    },
    [secilen, filtreler, gruplama, siralama, girdiOlustur],
  );

  function raporSec(kod: string) {
    if (kod === secilenKod) return;
    setSecilenKod(kod);
    const r = raporlar.find((x) => x.kod === kod);
    if (r) adreseYaz(kod, varsayilanFiltreler(r), r.gruplamalar[0]?.deger ?? "", null, true);
  }

  function basligaTiklandi(alan: string) {
    const yeni: Siralama = siralama?.alan === alan && siralama.yon === "desc" ? { alan, yon: "asc" } : { alan, yon: "desc" };
    setSiralama(yeni);
    void calistir(filtreler, gruplama, yeni);
  }

  async function disaAktar(tur: "excel" | "pdf") {
    if (!secilen) return;
    setHata("");
    setIndiriliyor(tur);
    try {
      const donem = filtreler.baslangic && filtreler.bitis ? `-${filtreler.baslangic}_${filtreler.bitis}` : `-${bugunTR()}`;
      await apiDosyaIndir(`/raporlar/${secilen.kod}/${tur}`, `${secilen.kod.replace(/\./g, "-")}${donem}.${tur === "excel" ? "xlsx" : "pdf"}`, {
        method: "POST",
        body: JSON.stringify(girdiOlustur()),
      });
    } catch (h) {
      setHata(h instanceof Error ? h.message : `${tur === "excel" ? "Excel" : "PDF"} indirilemedi`);
    } finally {
      setIndiriliyor("");
    }
  }

  async function gorunumKaydet(e: React.FormEvent) {
    e.preventDefault();
    if (!secilen || !gorunumAdi.trim()) return;
    try {
      await api(`/raporlar/${secilen.kod}/gorunumler`, {
        method: "POST",
        body: JSON.stringify({ ad: gorunumAdi.trim(), girdi: girdiOlustur(), firmaGeneli }),
      });
      setGorunumler(await api<Gorunum[]>(`/raporlar/${secilen.kod}/gorunumler`));
      setBilgi(`"${gorunumAdi.trim()}" görünümü kaydedildi.`);
      setGorunumAdi("");
      setFirmaGeneli(false);
      setGorunumPenceresi(false);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Görünüm kaydedilemedi");
    }
  }

  /** Görünüm uygulanınca rapor hemen çalışır; sıralama da görünümle gelir. */
  function gorunumUygula(g: Gorunum) {
    const f = g.girdi.filtreler ?? {};
    const gr = g.girdi.gruplama ?? gruplama;
    const s = g.girdi.siralama ?? null;
    setFiltreler(f);
    setGruplama(gr);
    setSiralama(s);
    void calistir(f, gr, s);
  }

  async function gorunumSil(g: Gorunum) {
    try {
      await api(`/raporlar/gorunumler/${g.id}`, { method: "DELETE" });
      setGorunumler((eski) => eski.filter((x) => x.id !== g.id));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Görünüm silinemedi");
    }
  }

  // ─── Katalog ──────────────────────────────────────────────────────────────

  const aranan = arama.trim().toLocaleLowerCase("tr");
  const eslesir = (metin: string) => !aranan || metin.toLocaleLowerCase("tr").includes(aranan);
  const gruplar = useMemo(() => {
    const harita = new Map<string, { raporlar: RaporMeta[]; ayrilar: AyriEkranRaporu[] }>();
    for (const r of raporlar) if (eslesir(`${r.ad} ${r.aciklama ?? ""} ${MODUL_ADLARI[r.modul] ?? r.modul}`)) {
      const g = harita.get(r.modul) ?? { raporlar: [], ayrilar: [] };
      g.raporlar.push(r);
      harita.set(r.modul, g);
    }
    for (const a of ayriEkranlar) if (eslesir(`${a.ad} ${a.aciklama}`)) {
      const g = harita.get(a.modul) ?? { raporlar: [], ayrilar: [] };
      g.ayrilar.push(a);
      harita.set(a.modul, g);
    }
    const sira = (m: string) => (MODUL_SIRASI.includes(m) ? MODUL_SIRASI.indexOf(m) : MODUL_SIRASI.length);
    return [...harita.entries()].sort(([a], [b]) => sira(a) - sira(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raporlar, ayriEkranlar, aranan]);
  const katalogGoster = raporlar.length + ayriEkranlar.length > 1;

  // ─── Filtre alanları ──────────────────────────────────────────────────────

  function filtreGirdisi(f: RaporFiltreTanimi) {
    const deger = filtreler[f.alan] ?? "";
    const guncelle = (yeni: string | number | boolean) => {
      setFiltreler((eski) => ({ ...eski, [f.alan]: yeni }));
      setEksikler((eski) => eski.filter((a) => a !== f.alan));
    };
    const hatali = eksikler.includes(f.alan);
    switch (f.tip) {
      case "tarih":
        return <Input type="date" value={String(deger)} aria-invalid={hatali} onChange={(e) => guncelle(e.target.value)} />;
      case "sayi":
        return <Input type="number" value={deger === "" ? "" : Number(deger)} aria-invalid={hatali} onChange={(e) => guncelle(e.target.value === "" ? "" : Number(e.target.value))} />;
      case "onay":
        return (
          <label className="rapor-onay">
            <input type="checkbox" checked={deger === true} onChange={(e) => guncelle(e.target.checked)} />
            <span>Evet</span>
          </label>
        );
      case "secim":
        return (
          <select className="select" value={String(deger)} aria-invalid={hatali} onChange={(e) => guncelle(e.target.value)}>
            <option value="">{f.zorunlu ? "Seçiniz…" : "Tümü"}</option>
            {f.secenekler?.map((s) => <option key={s.deger} value={s.deger}>{s.ad}</option>)}
          </select>
        );
      case "cari":
      case "stok":
        return (
          <AramaSecici
            deger={String(deger)}
            onChange={(v) => guncelle(v)}
            ariaLabel={f.ad}
            ariaInvalid={hatali}
            placeholder={f.zorunlu ? `${f.ad} arayın` : `Tümü — ${f.ad.toLocaleLowerCase("tr")} arayın`}
            secenekler={kayitlar[f.tip].map((k) => ({ deger: k.id, baslik: k.unvan ?? k.ad ?? k.kod ?? k.id, aciklama: k.kod, aramaMetni: `${k.kod ?? ""} ${k.unvan ?? k.ad ?? ""}` }))}
          />
        );
      case "depo":
      case "hesap":
      case "etiket":
        return (
          <select aria-label={f.ad} className="select" value={String(deger)} aria-invalid={hatali} onChange={(e) => guncelle(e.target.value)}>
            <option value="">{f.zorunlu ? "Seçiniz…" : "Tümü"}</option>
            {kayitlar[f.tip].map((k) => <option key={k.id} value={k.id}>{k.unvan ?? k.ad ?? k.kod ?? k.id}</option>)}
          </select>
        );
      default:
        return <Input type="text" value={String(deger)} aria-invalid={hatali} onChange={(e) => guncelle(e.target.value)} />;
    }
  }

  const donemVar = secilen ? ["baslangic", "bitis"].every((a) => secilen.filtreler.some((f) => f.alan === a)) : false;
  const seciliDonem = hazirDonemler().find((d) => d.baslangic === filtreler.baslangic && d.bitis === filtreler.bitis)?.ad;

  /** Sonucun hangi girdiyle üretildiği (RPR-08: kaynak, dönem, zaman). */
  function sonucOzeti() {
    if (!sonuc || !secilen) return "";
    const parcalar: string[] = [];
    const g = sonuc.girdi;
    if (g.baslangic || g.bitis) parcalar.push(`Dönem ${trTarih(String(g.baslangic ?? ""))} – ${g.bitis ? trTarih(String(g.bitis)) : "bugün"}`);
    else if (g.tarih) parcalar.push(`${trTarih(String(g.tarih))} itibarıyla`);
    else if (secilen.filtreler.some((f) => f.alan === "tarih")) parcalar.push("Bugün itibarıyla");
    const kirilim = secilen.gruplamalar.find((x) => x.deger === sonuc.gruplama)?.ad;
    if (kirilim) parcalar.push(`Kırılım: ${kirilim}`);
    const diger = secilen.filtreler.filter((f) => !["baslangic", "bitis", "tarih"].includes(f.alan) && g[f.alan] !== undefined && g[f.alan] !== "");
    if (diger.length) parcalar.push(`${diger.length} ek filtre`);
    parcalar.push(`Oluşturuldu ${sonuc.zaman.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}`);
    return parcalar.join(" · ");
  }

  const gosterilen = sonuc ? sonuc.satirlar.slice(0, AZAMI_SATIR) : [];
  const satirSayisi = sonuc ? (sonuc.satirSayisi ?? sonuc.satirlar.length) : 0;
  const toplamSatiri = !sonuc ? null
    : sonuc.toplamlar !== undefined ? sunucuToplamlari(sonuc.kolonlar, sonuc.toplamlar)
    : sonuc.satirlar.length > 1 ? toplamlar(sonuc.kolonlar, sonuc.satirlar) : null;

  // ─── Çizim ────────────────────────────────────────────────────────────────

  return (
    <div className={katalogGoster ? "rapor-duzen" : undefined}>
      {katalogGoster && (
        <aside className="rapor-katalog" aria-label="Rapor kataloğu">
          <SearchInput value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Rapor ara…" aria-label="Rapor ara" />
          {/* Dar ekranda liste yerine tek seçim kutusu (rapor seçmeden önce uzun kaydırma olmasın). */}
          <select className="select rapor-katalog__secim" aria-label="Rapor seç" value={secilenKod} onChange={(e) => raporSec(e.target.value)}>
            {gruplar.map(([m, g]) => (
              <optgroup key={m} label={MODUL_ADLARI[m] ?? m}>
                {g.raporlar.map((r) => <option key={r.kod} value={r.kod}>{r.ad}</option>)}
              </optgroup>
            ))}
          </select>
          <nav className="rapor-katalog__liste">
            {gruplar.length === 0 && <p className="muted" style={{ fontSize: "0.85rem" }}>“{arama}” ile eşleşen rapor yok.</p>}
            {gruplar.map(([m, g]) => (
              <div key={m} className="rapor-katalog__grup">
                {!modul && <h4>{MODUL_ADLARI[m] ?? m}</h4>}
                {g.raporlar.map((r) => (
                  <button key={r.kod} type="button" className={`rapor-katalog__oge${r.kod === secilenKod ? " is-secili" : ""}`} aria-current={r.kod === secilenKod ? "true" : undefined} onClick={() => raporSec(r.kod)}>
                    <strong>{r.ad}</strong>
                    {r.aciklama && <span>{r.aciklama}</span>}
                  </button>
                ))}
                {g.ayrilar.map((a) => (
                  <a key={a.href} className="rapor-katalog__oge" href={a.href}>
                    <strong>{a.ad} ↗</strong>
                    <span>{a.aciklama}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </aside>
      )}

      <div className="rapor-icerik">
        <Alert tone="error">{hata}</Alert>
        <Alert tone="success">{bilgi}</Alert>

        {!secilen ? (
          !hata && <Card><p className="muted" style={{ margin: 0 }}>Raporlar yükleniyor…</p></Card>
        ) : (
          <>
            <Card>
              <div className="between" style={{ alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row-tight">
                    <h3 style={{ fontSize: "1.1rem", margin: 0 }}>{secilen.ad}</h3>
                    {!modul && <Badge>{MODUL_ADLARI[secilen.modul] ?? secilen.modul}</Badge>}
                  </div>
                  {secilen.aciklama && <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>{secilen.aciklama}</p>}
                </div>
                <EylemMenusu etiket={`Görünümler${gorunumler.length ? ` (${gorunumler.length})` : ""}`}>
                  {gorunumler.length === 0 && <span className="muted" style={{ fontSize: "0.8rem", padding: "0.35rem 0.5rem" }}>Kayıtlı görünüm yok</span>}
                  {gorunumler.map((g) => (
                    <div key={g.id} className="rapor-gorunum">
                      <Button size="sm" onClick={() => gorunumUygula(g)} title="Uygula ve çalıştır">{g.firmaGeneli ? "🏢" : "⭐"} {g.ad}</Button>
                      <button type="button" className="rapor-gorunum__sil" aria-label={`${g.ad} görünümünü sil`} title="Sil" onClick={(e) => { e.stopPropagation(); void gorunumSil(g); }}>✕</button>
                    </div>
                  ))}
                  <Button size="sm" onClick={() => setGorunumPenceresi(true)}>＋ Bu filtreleri kaydet…</Button>
                  <Button size="sm" onClick={() => setAbonelikPenceresi(true)} title="Kayıtlı görünümü düzenli olarak e-postayla gönder">✉ E-postayla düzenli gönder…</Button>
                  <a className="btn btn--ghost btn--sm" href="/panel/raporlar/zamanlanmis">Zamanlanmış raporlarım</a>
                </EylemMenusu>
              </div>

              {donemVar && (
                <div className="rapor-donemler" role="group" aria-label="Hazır dönemler">
                  {hazirDonemler().map((d) => (
                    <button key={d.ad} type="button" className={`chip${seciliDonem === d.ad ? " is-active" : ""}`} aria-pressed={seciliDonem === d.ad}
                      onClick={() => { setFiltreler((eski) => ({ ...eski, baslangic: d.baslangic, bitis: d.bitis })); setEksikler((e) => e.filter((a) => a !== "baslangic" && a !== "bitis")); }}>
                      {d.ad}
                    </button>
                  ))}
                </div>
              )}

              <form className="rapor-filtreler" onSubmit={(e) => { e.preventDefault(); void calistir(); }}>
                {secilen.filtreler.map((f) => (
                  <div key={f.alan} className={f.tip === "cari" || f.tip === "stok" ? "rapor-filtreler__genis" : undefined}>
                    <Field label={`${f.ad}${f.zorunlu ? " *" : ""}`}>{filtreGirdisi(f)}</Field>
                    {eksikler.includes(f.alan) && <p className="field-error" role="alert">{f.ad} seçilmeden rapor çalışmaz.</p>}
                  </div>
                ))}
                {secilen.gruplamalar.length > 0 && (
                  <Field label="Kırılım">
                    <select className="select" value={gruplama} onChange={(e) => setGruplama(e.target.value)}>
                      {secilen.gruplamalar.map((g) => <option key={g.deger} value={g.deger}>{g.ad}</option>)}
                    </select>
                  </Field>
                )}
                <div className="rapor-filtreler__eylemler">
                  <Button type="submit" variant="primary" disabled={yukleniyor}>{yukleniyor ? "Hazırlanıyor…" : "Raporu çalıştır"}</Button>
                  <Button type="button" onClick={() => void disaAktar("excel")} disabled={indiriliyor !== ""}>{indiriliyor === "excel" ? "İndiriliyor…" : "Excel"}</Button>
                  <Button type="button" onClick={() => void disaAktar("pdf")} disabled={indiriliyor !== ""}>{indiriliyor === "pdf" ? "İndiriliyor…" : "PDF"}</Button>
                </div>
              </form>
            </Card>

            {yukleniyor && !sonuc && <Card pad={false} style={{ marginTop: "1rem" }}><TableSkeleton rows={6} cols={Math.min(secilen.kolonlar.length, 6)} /></Card>}

            {!yukleniyor && !sonuc && (
              <Card style={{ marginTop: "1rem" }}>
                <p className="muted" style={{ margin: 0, textAlign: "center" }}>Filtreleri seçip <strong>Raporu çalıştır</strong>’a basın.</p>
              </Card>
            )}

            {sonuc && (
              <Card pad={false} style={{ marginTop: "1rem", opacity: yukleniyor ? 0.55 : 1 }} aria-busy={yukleniyor}>
                <div className="rapor-sonuc__bas">
                  <span>{sonucOzeti()}</span>
                  <strong>{satirSayisi.toLocaleString("tr-TR")} satır</strong>
                </div>
                {satirSayisi > AZAMI_SATIR && (
                  <p className="rapor-sonuc__uyari">İlk {AZAMI_SATIR} satır gösteriliyor; toplamlar bütün satırlardan. Tamamı için Excel ya da PDF indirin.</p>
                )}
                <div className="table-wrap rapor-sonuc__tablo">
                  <table className="table">
                    <thead>
                      <tr>
                        {sonuc.kolonlar.map((k) => (
                          <th key={k.alan} className={SAYISAL.includes(k.tip) ? "num" : undefined} aria-sort={siralama?.alan === k.alan ? (siralama.yon === "desc" ? "descending" : "ascending") : undefined}>
                            <button type="button" className="rapor-sirala" onClick={() => basligaTiklandi(k.alan)} title="Sıralamak için tıklayın">
                              {k.baslik}{siralama?.alan === k.alan ? (siralama.yon === "desc" ? " ▼" : " ▲") : ""}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gosterilen.length === 0 ? (
                        <tr><td colSpan={sonuc.kolonlar.length} className="empty">Seçilen filtrelerle kayıt bulunamadı.</td></tr>
                      ) : (
                        gosterilen.map((satir, i) => (
                          <tr key={i}>
                            {sonuc.kolonlar.map((k) => {
                              const yol = k.baglantiAlani ? satir[k.baglantiAlani] : null;
                              const metin = hucreBicimle(k, satir[k.alan], satir);
                              return (
                                <td key={k.alan} className={SAYISAL.includes(k.tip) ? "num" : undefined}>
                                  {typeof yol === "string" && yol.startsWith("/panel/") ? <a href={yol}>{metin}</a> : metin}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                    {toplamSatiri && (
                      <tfoot>
                        <tr className="rapor-sonuc__toplam">
                          {sonuc.kolonlar.map((k, i) => (
                            <td key={k.alan} className={SAYISAL.includes(k.tip) ? "num" : undefined}>
                              {toplamSatiri.get(k.alan) ?? (i === 0 ? "Toplam" : "")}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {abonelikPenceresi && secilen && (
        <AbonelikPenceresi
          raporKod={secilen.kod}
          gorunumler={gorunumler}
          donemli={secilen.filtreler.some((f) => f.alan === "baslangic") && secilen.filtreler.some((f) => f.alan === "bitis")}
          onKapat={() => setAbonelikPenceresi(false)}
          onKaydedildi={(m) => { setAbonelikPenceresi(false); setBilgi(m); }}
        />
      )}

      {gorunumPenceresi && secilen && (
        <Modal baslik="Görünüm olarak kaydet" aciklama="Bu raporun filtreleri, kırılımı ve sıralaması bir adla saklanır; Görünümler menüsünden tek tıkla çalışır." onKapat={() => setGorunumPenceresi(false)}>
          <form onSubmit={gorunumKaydet} className="stack">
            <Field label="Görünüm adı"><Input autoFocus required maxLength={80} value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Ör. Aylık satış özeti" /></Field>
            <label className="rapor-onay">
              <input type="checkbox" checked={firmaGeneli} onChange={(e) => setFirmaGeneli(e.target.checked)} />
              <span>Firmadaki herkes görsün</span>
            </label>
            <ModalEylem onVazgec={() => setGorunumPenceresi(false)} metin="Kaydet" />
          </form>
        </Modal>
      )}
    </div>
  );
}
