"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api, apiAkis } from "@/lib/api";
import { Alert, Badge, Button, Input } from "@/components/ui";
import { Camera, Mic, MicOff, Paperclip, Volume2, VolumeX } from "lucide-react";
import { YzGeriBildirim } from "./yz-geri-bildirim";
import { YzFinansKaynaklari, type FinansKaynagi } from "./yz-finans-kaynaklari";
import { EKRAN_ONERILERI, EKRAN_TURU_ADI, type AsistanBaglami } from "@/lib/asistan-baglami";

/** AI-04: kullanıcının onayını bekleyen (ya da karara bağlanmış) yapay zekâ işlemi. */
export interface OnayTalebi {
  id: string;
  arac: string;
  ozet: string;
  onizleme: { eylem: string; hedef: string; etkiler?: string[]; degisiklikler?: Array<{ alan: string; once?: unknown; sonra: unknown }> } | null;
  kaynak: "asistan" | "mcp";
  durum: "bekliyor" | "isleniyor" | "onaylandi" | "reddedildi" | "suresi_doldu" | "hata" | "hedef_degisti";
  gecerlilikSonu: string;
  createdAt: string;
  kararAt: string | null;
  sonuc: unknown;
  hata: string | null;
}

interface Mesaj {
  kaynaklar?: FinansKaynagi[];
  kaynaklarKisaltildi?: boolean;
  id?: string;
  geriBildirim?: string | null;
  geriBildirimNotu?: string | null;
  anahtar: string;
  rol: "user" | "assistant";
  icerik: string;
  talepIdleri: string[];
  secimler: Secim[];
  /** AI-81: derin analizle üretildiyse model etiketi ya da not. */
  modelNotu?: string;
}

interface Secim {
  tur: string;
  aranan: string;
  adaylar: Array<{ id?: string; kod?: string; no?: string; unvan?: string; ad?: string; durum?: string; cari?: { unvan?: string } }>;
}

interface SohbetOzeti { id: string; baslik: string | null; kanal?: string; sonEtkilesim: string; createdAt: string }

interface AjanYaniti {
  kaynaklar?: FinansKaynagi[];
  kaynaklarKisaltildi?: boolean;
  mesajId?: string;
  oturumId?: string | null;
  cevap: string;
  onayTalepleri: OnayTalebi[];
  araclar: Array<{ ad: string; sinif: string; basarili: boolean }>;
  secimler?: Secim[];
  asistanKapali?: boolean;
  model?: { saglayici: string; model: string | null; derin: boolean; not?: string };
}

/** AI-79: sohbete yüklenen ek; XML e-Fatura ise sunucunun çıkardığı özet. */
interface SohbetEki {
  ekId: string;
  dosyaAdi: string;
  mime: string;
  ubl?: { belgeNo: string; gonderen: string; genelToplam: string; doviz: string } | null;
}

interface OcrTaslagi {
  dosyaAdi: string;
  belgeTuru: string;
  saticiUnvan: string;
  saticiVknTckn: string;
  belgeNo: string;
  tarih: string;
  paraBirimi: string;
  toplamMatrah: number;
  toplamKdv: number;
  genelToplam: number;
  guvenSkoru: number;
  onerilenKategori: string;
  eslesenCari?: { id: string; unvan: string } | null;
  kalemler: Array<{ aciklama?: string; miktar?: number; birimFiyat?: number }>;
  uyarilar: string[];
  hatalar: string[];
}

const DURUM: Record<OnayTalebi["durum"], { ad: string; tur: "warning" | "info" | "success" | "neutral" | "danger" }> = {
  bekliyor: { ad: "Onayınızı bekliyor", tur: "warning" },
  isleniyor: { ad: "İşleniyor", tur: "info" },
  onaylandi: { ad: "Onaylandı, yapıldı", tur: "success" },
  reddedildi: { ad: "Reddedildi", tur: "neutral" },
  suresi_doldu: { ad: "Süresi doldu", tur: "neutral" },
  hata: { ad: "Onaylandı ama yapılamadı", tur: "danger" },
  hedef_degisti: { ad: "Kayıt değişti, yapılmadı", tur: "warning" },
};

let sayac = 0;
const yeniAnahtar = () => `m${Date.now()}-${sayac++}`;

/** Metindeki `/panel/...` yollarını bağlantıya, `**…**` işaretini kalına çevirir; HTML yorumlanmaz. */
function baglantili(metin: string): ReactNode {
  const temiz = metin.replace(/^(\s*)[*-]\s+/gm, "$1• ");
  const parcalar = temiz.split(/(\/panel\/[^\s)\]"'`,*]+|\*\*[^*]+\*\*)/g);
  return parcalar.map((p, i) =>
    p.startsWith("/panel/") ? (
      <a href={p} key={i}>
        {p}
      </a>
    ) : p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function hataMesaji(hata: unknown): string {
  return hata instanceof Error ? hata.message : "İşlem tamamlanamadı";
}

const degerGoster = (deger: unknown) => deger === null || deger === undefined || deger === "" ? "—" : typeof deger === "object" ? JSON.stringify(deger) : String(deger);
const alanAdi = (alan: string) => alan.replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, "$1 $2").replaceAll("_", " ");

/** Onay talebi kartı: özet, durum, sonuç bağlantısı; bekleyen talepte Onayla/Reddet. */
export function TalepKarti({ talep, onDegisti }: { talep: OnayTalebi; onDegisti: (t: OnayTalebi) => void }) {
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const durum = DURUM[talep.durum];
  const sonucAdresi = (talep.sonuc as { adres?: unknown } | null)?.adres;

  async function karar(eylem: "onayla" | "reddet") {
    setIsleniyor(true);
    setHata(null);
    try {
      onDegisti(await api<OnayTalebi>(`/ai/onay-talepleri/${talep.id}/${eylem}`, { method: "POST" }));
    } catch (e) {
      setHata(hataMesaji(e));
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <div className="asistan-talep">
      <div className="asistan-talep__ust">
        <Badge variant={durum.tur}>{durum.ad}</Badge>
        {talep.kaynak === "mcp" && <Badge variant="info">MCP</Badge>}
      </div>
      <p className="asistan-talep__ozet">{talep.ozet}</p>
      {talep.onizleme && (
        <div className="asistan-talep__onizleme">
          <div><strong>İşlem:</strong> {talep.onizleme.eylem}</div>
          <div><strong>Hedef:</strong> {talep.onizleme.hedef}</div>
          {!!talep.onizleme.degisiklikler?.length && (
            <div className="asistan-talep__farklar">
              {talep.onizleme.degisiklikler.map((fark, i) => (
                <div className="asistan-talep__fark" key={`${fark.alan}-${i}`}>
                  <span>{alanAdi(fark.alan)}</span>
                  {Object.prototype.hasOwnProperty.call(fark, "once") && <del>{degerGoster(fark.once)}</del>}
                  <strong>→ {degerGoster(fark.sonra)}</strong>
                </div>
              ))}
            </div>
          )}
          {!!talep.onizleme.etkiler?.length && <small>Etkiler: {talep.onizleme.etkiler.join(" · ")}</small>}
        </div>
      )}
      {talep.hata && <Alert tone="error">{talep.hata}</Alert>}
      {hata && <Alert tone="error">{hata}</Alert>}
      {typeof sonucAdresi === "string" && talep.durum === "onaylandi" && <a href={sonucAdresi}>Kaydı aç</a>}
      {talep.durum === "bekliyor" && (
        <div className="row-tight">
          <Button size="sm" variant="primary" disabled={isleniyor} onClick={() => void karar("onayla")}>
            {isleniyor ? "İşleniyor…" : "Onayla"}
          </Button>
          <Button size="sm" disabled={isleniyor} onClick={() => void karar("reddet")}>
            Reddet
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * AI-05: panel asistanı. Kullanıcı yazar, konuşur veya fotoğraf yükler;
 * asistan araçları çalıştırır; onaya tabi işlem talep kartı olarak döner.
 */
export function AsistanSohbet({ yukseklik, onTalepDegisti, baglam, onBaglamKaldir }: { yukseklik?: string; onTalepDegisti?: () => void; baglam?: AsistanBaglami | null; onBaglamKaldir?: () => void }) {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([]);
  const [talepler, setTalepler] = useState<Record<string, OnayTalebi>>({});
  const [girdi, setGirdi] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [kapali, setKapali] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [sohbetler, setSohbetler] = useState<SohbetOzeti[]>([]);
  const [aktifSohbetId, setAktifSohbetId] = useState<string | null>(null);

  // Sesli Konuşma (Speech Recognition) ve Okuma (Speech Synthesis)
  const [dinleniyor, setDinleniyor] = useState(false);
  const [sesliOkunuyor, setSesliOkunuyor] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Kamera ve Dosya Yükleme
  const dosyaGirdisiRef = useRef<HTMLInputElement>(null);
  const [dosyaYukleniyor, setDosyaYukleniyor] = useState(false);
  const [ocrTaslagi, setOcrTaslagi] = useState<OcrTaslagi | null>(null);
  // AI-79: bir sonraki mesaja bağlanacak sohbet ekleri (şimdilik UBL XML).
  const [bekleyenEkler, setBekleyenEkler] = useState<SohbetEki[]>([]);
  // AI-81: yalnız bir sonraki mesaj için güçlü sağlayıcı.
  const [derin, setDerin] = useState(false);
  // AI-82: yanıt hazırlanırken canlı araç adımları; Durdur bağlantıyı keser.
  const [adimlar, setAdimlar] = useState<{ ad: string; etiket: string; durum: "basladi" | "bitti" | "hata" }[]>([]);
  const durdurucu = useRef<AbortController | null>(null);

  const sonRef = useRef<HTMLDivElement>(null);
  // CARI-48: bağlamlı ilk mesaj, başka konuşmanın geçmişiyle karışmasın diye yeni sohbette başlar.
  const baglamSohbeti = useRef<{ anahtar: string; sohbetId: string | null } | null>(null);
  const baglamAnahtari = baglam ? `${baglam.tur}:${baglam.id}` : "";
  const baglamBagli = !!baglam && baglamSohbeti.current?.anahtar === baglamAnahtari && baglamSohbeti.current.sohbetId === aktifSohbetId;

  useEffect(() => {
    let iptal = false;
    void Promise.all([
      api<{ oturumId: string | null; mesajlar: Array<{ kaynaklar?: FinansKaynagi[]; kaynaklarKisaltildi?: boolean; id?: string; geriBildirim?: string | null; geriBildirimNotu?: string | null; rol: string; icerik: string; talepIdleri: string[]; secimler?: Secim[] }> }>("/ai/ajan/gecmis"),
      api<OnayTalebi[]>("/ai/onay-talepleri"),
      api<SohbetOzeti[]>("/ai/ajan/sohbetler"),
    ])
      .then(([gecmis, liste, sohbetListesi]) => {
        if (iptal) return;
        const eskiler = gecmis.mesajlar
          .filter((m) => m.rol === "user" || m.rol === "assistant")
          .map((m) => ({
            anahtar: yeniAnahtar(),
            id: m.id, geriBildirim: m.geriBildirim, geriBildirimNotu: m.geriBildirimNotu,
            kaynaklar: m.kaynaklar, kaynaklarKisaltildi: m.kaynaklarKisaltildi,
            rol: m.rol as Mesaj["rol"],
            icerik: m.icerik,
            talepIdleri: m.talepIdleri,
            secimler: m.secimler ?? [],
          }));
        setMesajlar((yeniler) => [...eskiler, ...yeniler]);
        setTalepler((t) => ({ ...Object.fromEntries(liste.map((x) => [x.id, x])), ...t }));
        setSohbetler(sohbetListesi);
        setAktifSohbetId(gecmis.oturumId);
      })
      .catch((e) => {
        if (!iptal) setHata(hataMesaji(e));
      });
    return () => {
      iptal = true;
      if (recognitionRef.current) recognitionRef.current.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  async function sohbetAc(id: string) {
    setHata(null);
    await api(`/ai/ajan/sohbetler/${id}/etkinlestir`, { method: "POST" });
    const gecmis = await api<{ oturumId: string | null; mesajlar: Array<{ kaynaklar?: FinansKaynagi[]; kaynaklarKisaltildi?: boolean; id?: string; geriBildirim?: string | null; geriBildirimNotu?: string | null; rol: string; icerik: string; talepIdleri: string[]; secimler?: Secim[] }> }>(`/ai/ajan/gecmis?oturumId=${encodeURIComponent(id)}`);
    setMesajlar(gecmis.mesajlar.filter((m) => m.rol === "user" || m.rol === "assistant").map((m) => ({
      anahtar: yeniAnahtar(), rol: m.rol as Mesaj["rol"], icerik: m.icerik, talepIdleri: m.talepIdleri, secimler: m.secimler ?? [],
      id: m.id, geriBildirim: m.geriBildirim, geriBildirimNotu: m.geriBildirimNotu,
      kaynaklar: m.kaynaklar, kaynaklarKisaltildi: m.kaynaklarKisaltildi,
    })));
    setAktifSohbetId(gecmis.oturumId);
    setSohbetler(await api<SohbetOzeti[]>("/ai/ajan/sohbetler"));
  }

  async function yeniSohbet() {
    const sohbet = await api<SohbetOzeti>("/ai/ajan/sohbetler/yeni", { method: "POST" });
    setMesajlar([]);
    setAktifSohbetId(sohbet.id);
    setSohbetler(await api<SohbetOzeti[]>("/ai/ajan/sohbetler"));
  }

  async function sohbetiArsivle() {
    if (!aktifSohbetId) return;
    await api(`/ai/ajan/sohbetler/${aktifSohbetId}/arsivle`, { method: "POST" });
    setMesajlar([]);
    setAktifSohbetId(null);
    setSohbetler(await api<SohbetOzeti[]>("/ai/ajan/sohbetler"));
  }

  useEffect(() => {
    sonRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mesajlar, gonderiliyor]);

  async function gonder(istegeBagliMetin?: string) {
    const metin = (istegeBagliMetin ?? girdi).trim();
    if (!metin || gonderiliyor) return;
    setGirdi("");
    setHata(null);
    setBilgi(null);
    setGonderiliyor(true);
    try {
      if (baglam && !baglamBagli && mesajlar.length > 0) await yeniSohbet();
      setMesajlar((m) => [...m, { anahtar: yeniAnahtar(), rol: "user", icerik: metin, talepIdleri: [], secimler: [] }]);
      // Yanıt beklerken eklenen dosya bu mesaja girmez; yalnız gönderilenler kaldırılır.
      const gonderilenEkler = bekleyenEkler.map((e) => e.ekId);
      setAdimlar([]);
      const durdur = new AbortController();
      durdurucu.current = durdur;
      const y = await apiAkis<AjanYaniti>("/ai/ajan/mesaj-akis", { mesaj: metin, requestId: crypto.randomUUID(), baglam: { ...(baglam ? { kayit: { tur: baglam.tur, id: baglam.id } } : {}), sayfa: window.location.pathname }, ...(gonderilenEkler.length ? { ekler: gonderilenEkler } : {}), ...(derin ? { derin: true } : {}) },
        (olay, veri) => {
          const e = veri as { tur?: string; ad?: string; etiket?: string; durum?: "basladi" | "bitti" | "hata" };
          if (olay !== "adim" || e?.tur !== "arac" || !e.ad || !e.etiket || !e.durum) return;
          setAdimlar((o) => (e.durum === "basladi" ? [...o, { ad: e.ad!, etiket: e.etiket!, durum: "basladi" }] : o.map((a, i) => (i === o.map((x) => x.ad).lastIndexOf(e.ad!) ? { ...a, durum: e.durum! } : a))));
        }, durdur.signal);
      setDerin(false);
      if (y.asistanKapali) setKapali(y.cevap);
      setBekleyenEkler((o) => o.filter((e) => !gonderilenEkler.includes(e.ekId)));
      if (baglam) baglamSohbeti.current = { anahtar: baglamAnahtari, sohbetId: y.oturumId ?? null };
      if (y.oturumId) {
        setAktifSohbetId(y.oturumId);
        setSohbetler(await api<SohbetOzeti[]>("/ai/ajan/sohbetler"));
      }
      setTalepler((t) => ({ ...t, ...Object.fromEntries(y.onayTalepleri.map((x) => [x.id, x])) }));
      setMesajlar((m) => [
        ...m,
        { anahtar: yeniAnahtar(), id: y.mesajId, rol: "assistant", icerik: y.cevap, talepIdleri: y.onayTalepleri.map((x) => x.id), secimler: y.secimler ?? [], kaynaklar: y.kaynaklar, kaynaklarKisaltildi: y.kaynaklarKisaltildi,
          ...(y.model?.not ? { modelNotu: y.model.not } : y.model?.derin ? { modelNotu: `Derin analiz · ${y.model.model ?? y.model.saglayici}` } : {}) },
      ]);
      if (y.onayTalepleri.length) onTalepDegisti?.();
    } catch (e) {
      // AI-82: kullanıcı durdurduysa sunucu döngüyü bir sonraki turda keser; kayıt geçmişte kalır.
      if (e instanceof DOMException && e.name === "AbortError") {
        setMesajlar((m) => [...m, { anahtar: yeniAnahtar(), rol: "assistant", icerik: "Yanıt durduruldu.", talepIdleri: [], secimler: [] }]);
        onTalepDegisti?.();
      } else setHata(hataMesaji(e));
    } finally {
      durdurucu.current = null;
      setAdimlar([]);
      setGonderiliyor(false);
    }
  }

  // ─── SESLE YAZMA (SPEECH-TO-TEXT) ───
  function sesDinleBaslat() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setHata("Tarayıcınız ses tanıma özelliğini desteklemiyor. Chrome veya Safari ile deneyin.");
      return;
    }
    if (dinleniyor && recognitionRef.current) {
      recognitionRef.current.stop();
      setDinleniyor(false);
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "tr-TR";
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setDinleniyor(true);
        setBilgi("Dinleniyor… Türkçe konuşabilirsiniz.");
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((r: any) => r[0].transcript)
          .join("");
        setGirdi(transcript);
      };

      recognition.onerror = (e: any) => {
        setDinleniyor(false);
        setBilgi(null);
        if (e.error !== "no-speech") setHata(`Ses algılanamadı (${e.error}).`);
      };

      recognition.onend = () => {
        setDinleniyor(false);
        setBilgi(null);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      setDinleniyor(false);
      setHata(hataMesaji(e));
    }
  }

  // ─── SESLİ OKUMA (TEXT-TO-SPEECH) ───
  function metniSeslendir(metin: string, anahtar: string) {
    if (!("speechSynthesis" in window)) return;
    if (sesliOkunuyor === anahtar) {
      window.speechSynthesis.cancel();
      setSesliOkunuyor(null);
      return;
    }
    window.speechSynthesis.cancel();
    const temizMetin = metin
      .replace(/[*_#`[\]()]/g, "")
      .replace(/\/panel\/[^\s]+/g, "")
      .replace(/•/g, ",");
    const utterance = new SpeechSynthesisUtterance(temizMetin);
    utterance.lang = "tr-TR";
    utterance.rate = 1.05;
    utterance.onend = () => setSesliOkunuyor(null);
    utterance.onerror = () => setSesliOkunuyor(null);
    setSesliOkunuyor(anahtar);
    window.speechSynthesis.speak(utterance);
  }

  // ─── KAMERA / FOTOĞRAF / DOSYA YÜKLEME & OCR ───
  async function dosyaSecildi(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 10 * 1024 * 1024) {
      setHata("Dosya en fazla 10 MB olabilir.");
      return;
    }
    const xml = /\.xml$/i.test(file.name) || file.type.includes("xml");
    if (!xml && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      setHata("Yalnız JPEG, PNG, WebP, PDF ya da UBL XML e-Fatura yükleyebilirsiniz.");
      return;
    }
    setDosyaYukleniyor(true);
    setHata(null);
    setBilgi(`${file.name} yükleniyor ve güvenlik denetiminden geçiyor…`);
    // AI-79: dosya önce sohbete ek olarak saklanır (içerik türü ve virüs denetimi sunucuda).
    let ek: SohbetEki;
    try {
      const form = new FormData();
      form.append("dosya", file);
      ek = await api<SohbetEki>("/ai/ajan/ek", { method: "POST", body: form });
    } catch (yuklemeHatasi) {
      setBilgi(null);
      setHata(`Dosya yüklenemedi: ${hataMesaji(yuklemeHatasi)}`);
      setDosyaYukleniyor(false);
      return;
    }
    if (xml) {
      setBekleyenEkler((onceki) => [...onceki.filter((x) => x.ekId !== ek.ekId), ek].slice(-5));
      if (!girdi.trim()) setGirdi(ek.ubl ? "Bu e-Faturayı gelen kutusuna ekle ve kontrol et" : "Bu dosyaya bak");
      setBilgi(ek.ubl ? null : `${file.name} bir UBL e-Fatura olarak okunamadı; asistan yalnız dosya adını görür.`);
      setDosyaYukleniyor(false);
      return;
    }
    setBilgi(`${file.name} ayrıştırılıyor…`);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string) || "";
        const mimeType = file.type || "image/jpeg";

        if (file.type.startsWith("image/") || file.type === "application/pdf") {
          try {
            const ocrSonuc = await api<any>("/ai/ocr/tara", {
              method: "POST",
              body: JSON.stringify({
                gorselBase64: base64,
                mimeType,
                belgeTipi: "fis_fatura",
              }),
            });

            // OCR çıktısı FisFaturaTaramaCiktisi: dogrulama.veri içinde veya doğrudan objede
            const veri = ocrSonuc.dogrulama?.veri || ocrSonuc;
            const eslesenCari = ocrSonuc.eslesenCari;
            const onerilenKategori = ocrSonuc.onerilenMasrafKategorisi;

            setOcrTaslagi({
              dosyaAdi: file.name,
              belgeTuru: veri.belgeTuru || "FIS",
              saticiUnvan: veri.saticiUnvan || "",
              saticiVknTckn: veri.saticiVknTckn || "",
              belgeNo: veri.belgeNo || "",
              tarih: veri.tarih || "",
              paraBirimi: veri.paraBirimi || "TRY",
              toplamMatrah: Number(veri.toplamMatrah || 0),
              toplamKdv: Number(veri.toplamKdv || 0),
              genelToplam: Number(veri.genelToplam || 0),
              guvenSkoru: Number(veri.guvenSkoru ?? 0),
              onerilenKategori: onerilenKategori || "",
              eslesenCari,
              kalemler: veri.kalemler || [],
              uyarilar: ocrSonuc.dogrulama?.uyarilar || [],
              hatalar: ocrSonuc.dogrulama?.hatalar || [],
            });
            setBilgi(null);
            setDosyaYukleniyor(false);
            return;
          } catch (ocrHata: any) {
            setBilgi(null);
            setHata(`Görsel taranamadı: ${hataMesaji(ocrHata)}`);
            setGirdi(`[${file.name} belgesi yüklendi].`);
          }
        } else {
          setBilgi(null);
          setGirdi(`[${file.name} dosyası seçildi].`);
        }
        setDosyaYukleniyor(false);
      };

      reader.onerror = () => {
        setHata("Dosya okunamadı.");
        setDosyaYukleniyor(false);
        setBilgi(null);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      setHata(hataMesaji(err));
      setDosyaYukleniyor(false);
      setBilgi(null);
    }
  }

  function ocrAlan<K extends keyof OcrTaslagi>(alan: K, deger: OcrTaslagi[K]) {
    setOcrTaslagi((onceki) => (onceki ? { ...onceki, [alan]: deger } : onceki));
  }

  function ocrTaslakOlustur() {
    if (!ocrTaslagi) return;
    const toplam = Math.round((ocrTaslagi.toplamMatrah + ocrTaslagi.toplamKdv) * 100) / 100;
    if (!ocrTaslagi.saticiUnvan.trim() || ocrTaslagi.genelToplam <= 0) {
      setHata("Satıcı ve sıfırdan büyük genel toplam doğrulanmalıdır.");
      return;
    }
    if (Math.abs(toplam - ocrTaslagi.genelToplam) > 0.05) {
      setHata("Matrah + KDV ile genel toplam uyuşmuyor. Alanları düzeltmeden taslak oluşturulamaz.");
      return;
    }
    const satirlar = ocrTaslagi.kalemler.slice(0, 10).map((k) =>
      `${k.aciklama || "Kalem"}: ${Number(k.miktar || 1)} x ${Number(k.birimFiyat || 0)}`).join("; ");
    const talimat = [
      "Aşağıdaki kullanıcı tarafından doğrulanmış belge bilgileriyle bir masraf taslağı oluştur.",
      `Belge türü: ${ocrTaslagi.belgeTuru}`,
      `Satıcı: ${ocrTaslagi.saticiUnvan}`,
      ocrTaslagi.saticiVknTckn && `VKN/TCKN: ${ocrTaslagi.saticiVknTckn}`,
      ocrTaslagi.belgeNo && `Belge no: ${ocrTaslagi.belgeNo}`,
      ocrTaslagi.tarih && `Tarih: ${ocrTaslagi.tarih}`,
      `Matrah: ${ocrTaslagi.toplamMatrah} ${ocrTaslagi.paraBirimi}`,
      `KDV: ${ocrTaslagi.toplamKdv} ${ocrTaslagi.paraBirimi}`,
      `Genel toplam: ${ocrTaslagi.genelToplam} ${ocrTaslagi.paraBirimi}`,
      ocrTaslagi.onerilenKategori && `Önerilen kategori: ${ocrTaslagi.onerilenKategori}`,
      ocrTaslagi.eslesenCari && `Kullanıcının doğruladığı cari: ${ocrTaslagi.eslesenCari.unvan} (ID: ${ocrTaslagi.eslesenCari.id})`,
      satirlar && `Kalemler: ${satirlar}`,
      "Önce masraf kategorilerini oku; uygun kategoriyi seç ve masraf_taslagi_olustur aracını yalnız bu değerlerle çağır.",
    ].filter(Boolean).join("\n");
    setOcrTaslagi(null);
    void gonder(talimat);
  }

  const talepGuncelle = (t: OnayTalebi) => {
    setTalepler((onceki) => ({ ...onceki, [t.id]: t }));
    onTalepDegisti?.();
  };

  return (
    <div className="asistan" style={yukseklik ? { height: yukseklik } : undefined}>
      <div className="asistan__sohbet-araclari">
        <select aria-label="Sohbet seç" value={aktifSohbetId ?? ""} onChange={(e) => e.target.value && void sohbetAc(e.target.value)}>
          <option value="">Yeni/boş sohbet</option>
          {/* CNL-03: Telegram'dan yürüyen sohbetler de burada görünür ve sürdürülebilir. */}
          {sohbetler.map((s) => <option value={s.id} key={s.id}>{s.kanal === "TELEGRAM" ? "Telegram · " : ""}{s.baslik || "Adsız sohbet"}</option>)}
        </select>
        <Button size="sm" onClick={() => void yeniSohbet()}>Yeni sohbet</Button>
        <Button size="sm" disabled={!aktifSohbetId} onClick={() => void sohbetiArsivle()}>Arşivle</Button>
      </div>
      <div className="asistan__mesajlar" aria-live="polite">
        {!mesajlar.length && (
          <div className="asistan__bos">
            <strong>Ne yapmak istersiniz?</strong>
            <span>Örnek: “Yılmaz Ticaret'in bakiyesi ne?”, “A4 kağıt stoğu kaç?”, “Kaya Ltd'ye 50 koli A4 için 30 gün vadeli teklif hazırla”.</span>
            <span>Kameranızla fiş/fatura fotoğrafı çekip gönderebilir veya mikrofon butonuna basarak sesli talimat verebilirsiniz.</span>
          </div>
        )}
        {mesajlar.map((m) => (
          <div className={`asistan__mesaj asistan__mesaj--${m.rol === "user" ? "kullanici" : "asistan"}`} key={m.anahtar}>
            <div className="asistan__balon">
              {baglantili(m.icerik)}
              {m.rol === "assistant" && <YzFinansKaynaklari kaynaklar={m.kaynaklar} kisaltildi={m.kaynaklarKisaltildi} />}
              {m.rol === "assistant" && m.modelNotu && <div className="asistan__model-notu">{m.modelNotu}</div>}
              {m.rol === "assistant" && <YzGeriBildirim mesajId={m.id} deger={m.geriBildirim} not={m.geriBildirimNotu} />}
              {m.rol === "assistant" && (
                <div style={{ marginTop: "0.35rem", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => metniSeslendir(m.icerik, m.anahtar)}
                    title={sesliOkunuyor === m.anahtar ? "Seslendirmeyi durdur" : "Sesli dinle"}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "2px",
                      color: sesliOkunuyor === m.anahtar ? "var(--accent)" : "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      fontSize: "0.75rem",
                    }}
                  >
                    {sesliOkunuyor === m.anahtar ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    <span>{sesliOkunuyor === m.anahtar ? "Durdur" : "Dinle"}</span>
                  </button>
                </div>
              )}
            </div>
            {m.talepIdleri.map((id) => talepler[id] && <TalepKarti key={id} talep={talepler[id]} onDegisti={talepGuncelle} />)}
            {m.secimler.map((secim, si) => (
              <div className="asistan-secim" key={`${m.anahtar}-${si}`}>
                <strong>“{secim.aranan}” için doğru {secim.tur} kaydını seçin</strong>
                {secim.adaylar.map((aday) => (
                  <button key={aday.id} type="button" onClick={() => void gonder(`Seçimim: ${secim.tur} ${aday.unvan ?? aday.ad ?? aday.no ?? aday.kod} (ID: ${aday.id}). Önceki isteğe bu kesin kimlikle devam et.`)}>
                    <span>{aday.unvan ?? aday.ad ?? aday.no ?? aday.kod ?? "Adsız kayıt"}</span>
                    <small>{[aday.kod ?? aday.no, aday.cari?.unvan, aday.durum].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
        {gonderiliyor && (
          <div className="asistan__mesaj asistan__mesaj--asistan">
            <div className="asistan__balon asistan__balon--bekliyor">
              {adimlar.length ? (
                <ul className="asistan__adimlar">
                  {adimlar.map((a, i) => <li key={`${a.ad}-${i}`} className={`is-${a.durum}`}>{a.durum === "basladi" ? "⏳" : a.durum === "bitti" ? "✓" : "✗"} {a.etiket}{a.durum === "basladi" ? "…" : ""}</li>)}
                </ul>
              ) : "Çalışıyor…"}
              <button type="button" className="btn-link" onClick={() => durdurucu.current?.abort()}>Durdur</button>
            </div>
          </div>
        )}
        <div ref={sonRef} />
      </div>

      {bilgi && <Alert tone="warning">{bilgi}</Alert>}
      {kapali && <Alert tone="warning">{kapali}</Alert>}
      {hata && <Alert tone="error">{hata}</Alert>}

      {ocrTaslagi && (
        <section className="asistan-ocr" aria-label="OCR doğrulama">
          <div className="asistan-ocr__baslik">
            <div><strong>Belge bilgilerini doğrulayın</strong><span>{ocrTaslagi.dosyaAdi}</span></div>
            <Badge variant={ocrTaslagi.guvenSkoru < 0.8 ? "warning" : "info"}>Güven %{Math.round(ocrTaslagi.guvenSkoru * 100)}</Badge>
          </div>
          {(ocrTaslagi.uyarilar.length > 0 || ocrTaslagi.hatalar.length > 0) && (
            <Alert tone={ocrTaslagi.hatalar.length ? "error" : "warning"}>{[...ocrTaslagi.hatalar, ...ocrTaslagi.uyarilar].join(" ")}</Alert>
          )}
          <div className="asistan-ocr__alanlar">
            <label>Satıcı<input value={ocrTaslagi.saticiUnvan} onChange={(e) => ocrAlan("saticiUnvan", e.target.value)} /></label>
            <label>VKN / TCKN<input value={ocrTaslagi.saticiVknTckn} onChange={(e) => ocrAlan("saticiVknTckn", e.target.value)} /></label>
            <label>Belge no<input value={ocrTaslagi.belgeNo} onChange={(e) => ocrAlan("belgeNo", e.target.value)} /></label>
            <label>Tarih<input type="date" value={ocrTaslagi.tarih} onChange={(e) => ocrAlan("tarih", e.target.value)} /></label>
            <label>Matrah<input type="number" min="0" step="0.01" value={ocrTaslagi.toplamMatrah} onChange={(e) => ocrAlan("toplamMatrah", Number(e.target.value))} /></label>
            <label>KDV<input type="number" min="0" step="0.01" value={ocrTaslagi.toplamKdv} onChange={(e) => ocrAlan("toplamKdv", Number(e.target.value))} /></label>
            <label>Genel toplam<input type="number" min="0.01" step="0.01" value={ocrTaslagi.genelToplam} onChange={(e) => ocrAlan("genelToplam", Number(e.target.value))} /></label>
            <label>Para birimi<input maxLength={3} value={ocrTaslagi.paraBirimi} onChange={(e) => ocrAlan("paraBirimi", e.target.value.toUpperCase())} /></label>
          </div>
          {ocrTaslagi.eslesenCari && <p className="asistan-ocr__not">Eşleşen cari: <strong>{ocrTaslagi.eslesenCari.unvan}</strong></p>}
          <div className="row-tight">
            <Button variant="primary" onClick={ocrTaslakOlustur}>Bilgileri onayla ve taslak oluştur</Button>
            <Button onClick={() => setOcrTaslagi(null)}>Vazgeç</Button>
          </div>
        </section>
      )}

      {/* GİZLİ DOSYA / KAMERA GİRDİSİ */}
      <input
        ref={dosyaGirdisiRef}
        type="file"
        accept="image/*,application/pdf,.xml,text/xml,application/xml"
        capture="environment"
        style={{ display: "none" }}
        onChange={dosyaSecildi}
      />

      {baglam && (
        <div className="asistan__baglam">
          <span>
            Bu sohbette {EKRAN_TURU_ADI[baglam.tur]}: <strong>{baglam.etiket}</strong>
            {!baglamBagli && mesajlar.length > 0 && " · ilk mesajınız yeni sohbette başlar"}
          </span>
          {onBaglamKaldir && <button type="button" className="btn-link" onClick={onBaglamKaldir}>Bağlamı kaldır</button>}
        </div>
      )}
      {bekleyenEkler.length > 0 && (
        <div className="asistan__oneriler" aria-label="Mesaja eklenecek dosyalar">
          {bekleyenEkler.map((e) => (
            <span className="asistan__ek" key={e.ekId}>
              📎 {e.dosyaAdi}{e.ubl ? ` · e-Fatura ${e.ubl.belgeNo} · ${e.ubl.gonderen} · ${e.ubl.genelToplam} ${e.ubl.doviz}` : ""}
              <button type="button" className="btn-link" aria-label={`${e.dosyaAdi} ekini kaldır`} onClick={() => setBekleyenEkler((o) => o.filter((x) => x.ekId !== e.ekId))}>×</button>
            </span>
          ))}
        </div>
      )}
      {/* AI-80: ekrana göre hazır öneriler; tıklanınca metin kutuya gelir, kullanıcı düzenleyip gönderir. */}
      {!girdi && !gonderiliyor && !ocrTaslagi && (
        <div className="asistan__oneriler" aria-label="Önerilen sorular">
          {EKRAN_ONERILERI[baglam?.tur ?? "genel"].map((o) => (
            <button type="button" className="asistan__oneri" key={o} onClick={() => setGirdi(o)}>{o}</button>
          ))}
        </div>
      )}
      <form
        className="asistan__girdi"
        onSubmit={(e) => {
          e.preventDefault();
          void gonder();
        }}
      >
        {/* KAMERA & FİŞ/FATURA YÜKLEME BUTONU */}
        <button
          type="button"
          onClick={() => dosyaGirdisiRef.current?.click()}
          disabled={gonderiliyor || dosyaYukleniyor}
          className="btn btn--ghost"
          style={{ padding: "0 0.6rem", display: "flex", alignItems: "center", justifyContent: "center" }}
          title="Kamera ile fiş/fatura çek veya dosya yükle"
        >
          {dosyaYukleniyor ? <span className="animate-spin">⏳</span> : <Camera size={18} />}
        </button>

        {/* SESLE KONUŞMA (MİKROFON) BUTONU */}
        <button
          type="button"
          onClick={sesDinleBaslat}
          disabled={gonderiliyor}
          className={`btn ${dinleniyor ? "btn--danger" : "btn--ghost"}`}
          style={{
            padding: "0 0.6rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...(dinleniyor ? { animation: "pulse 1.5s infinite" } : {}),
          }}
          title={dinleniyor ? "Dinlemeyi durdur" : "Mikrofonla konuş (Türkçe)"}
        >
          {dinleniyor ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <Input
          aria-label="Asistana mesaj"
          disabled={gonderiliyor}
          maxLength={4000}
          onChange={(e) => setGirdi(e.target.value)}
          placeholder={dinleniyor ? "Konuşun, dinleniyor…" : "Talimatınızı yazın veya mikrofona konuşun…"}
          value={girdi}
        />
        <button
          type="button"
          className={`btn ${derin ? "btn--primary" : "btn--ghost"}`}
          aria-pressed={derin}
          disabled={gonderiliyor}
          onClick={() => setDerin((d) => !d)}
          title="Bu mesajı güçlü sağlayıcıya gönder (Ayarlar › Yapay Zeka › Güçlü sağlayıcı). Daha yavaş ve daha pahalı olabilir."
          style={{ padding: "0 0.6rem", whiteSpace: "nowrap" }}
        >
          Derin analiz
        </button>
        <Button disabled={gonderiliyor || !girdi.trim()} type="submit" variant="primary">
          Gönder
        </Button>
      </form>
    </div>
  );
}
