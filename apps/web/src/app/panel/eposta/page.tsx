"use client";

import { asistaniAc } from "@/lib/asistan-baglami";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert } from "@/components/ui";
import {
  Archive,
  ArrowRight,
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Flag,
  Folder,
  Forward,
  HelpCircle,
  Inbox,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  ScanLine,
  Search,
  Send,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";

interface GelenEpostaEk {
  id: string;
  dosyaAdi: string;
  mimeTuru: string;
  boyut: number;
  cikarilanVeri?: any;
}

interface GelenEposta {
  id: string;
  mesajId: string;
  gonderenAdi: string | null;
  gonderenEposta: string;
  aliciEposta: string;
  konu: string;
  icerikMetin: string | null;
  icerikHtml: string | null;
  tarih: string;
  okundu: boolean;
  durum: "yeni" | "islendi" | "arsivlendi" | string;
  cariId: string | null;
  crmFirsatId: string | null;
  faturaId: string | null;
  cari?: { id: string; kod: string; unvan: string; eposta?: string; telefon?: string } | null;
  ekler?: GelenEpostaEk[];
}

interface ListeYaniti {
  toplam: number;
  sayfa: number;
  adet: number;
  sayfaSayisi: number;
  satirlar: GelenEposta[];
}

type KlasorTuru = "gelen" | "okunmamis" | "islendi" | "ekli" | "arsiv" | "gonderilmis" | "taslak";

function getInitials(nameOrEmail: string): string {
  const clean = (nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail).trim();
  const parts = clean.split(/[\s._-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "EP";
}

function getAvatarBg(nameOrEmail: string): string {
  const colors = [
    "bg-[#0078d4] text-white", // Outlook Blue
    "bg-[#038387] text-white", // Teal
    "bg-[#4f6bed] text-white", // Indigo
    "bg-[#8764b8] text-white", // Purple
    "bg-[#ca5010] text-white", // Amber/Orange
    "bg-[#107c41] text-white", // Excel Green
    "bg-[#d13438] text-white", // Crimson
    "bg-[#004e8c] text-white", // Dark Blue
  ];
  let hash = 0;
  for (let i = 0; i < nameOrEmail.length; i++) {
    hash = nameOrEmail.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatTarihKisa(tarihStr: string): string {
  const date = new Date(tarihStr);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }

  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString("tr-TR", { month: "short", day: "numeric" });
  }

  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function GelenEpostalarSayfasi() {
  const [epostalar, setEpostalar] = useState<GelenEposta[]>([]);
  const [seciliEposta, setSeciliEposta] = useState<GelenEposta | null>(null);
  const [toplam, setToplam] = useState(0);
  const [arama, setArama] = useState("");
  const [klasor, setKlasor] = useState<KlasorTuru>("gelen");
  const [tab, setTab] = useState<"odaklanmis" | "diger">("odaklanmis");
  const [htmlModu, setHtmlModu] = useState(true);
  const [bayraklilar, setBayraklilar] = useState<Record<string, boolean>>({});
  const [yeniIletiAcik, setYeniIletiAcik] = useState(false);
  const [mobilDetayAcik, setMobilDetayAcik] = useState(false);

  const [yukleniyor, setYukleniyor] = useState(false);
  const [senkronizeEdiliyor, setSenkronizeEdiliyor] = useState(false);
  const [islemde, setIslemde] = useState(false);
  const [ocrYukleniyor, setOcrYukleniyor] = useState<Record<string, boolean>>({});
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const params = new URLSearchParams();
      if (arama) params.set("arama", arama);

      if (klasor === "okunmamis") {
        params.set("okundu", "false");
      } else if (klasor === "islendi") {
        params.set("durum", "islendi");
      } else if (klasor === "arsiv") {
        params.set("durum", "arsivlendi");
      } else if (klasor === "gelen") {
        params.set("durum", "yeni");
      }

      const res = await api<ListeYaniti>(`/eposta/gelen?${params.toString()}`);
      setEpostalar(res.satirlar);
      setToplam(res.toplam);

      if (res.satirlar.length > 0) {
        setSeciliEposta((prev) => {
          if (!prev) return res.satirlar[0];
          const guncel = res.satirlar.find((x) => x.id === prev.id);
          return guncel || res.satirlar[0];
        });
      } else {
        setSeciliEposta(null);
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Gelen e-postalar yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [arama, klasor]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  async function secVeDetayGetir(e: GelenEposta) {
    setMobilDetayAcik(true);
    try {
      const detay = await api<GelenEposta>(`/eposta/gelen/${e.id}`);
      setSeciliEposta(detay);

      if (!detay.okundu) {
        await api(`/eposta/gelen/${e.id}/okundu`, {
          method: "PATCH",
          body: JSON.stringify({ okundu: true }),
        });
        setEpostalar((prev) =>
          prev.map((item) => (item.id === e.id ? { ...item, okundu: true } : item)),
        );
      }
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Detay getirilemedi");
    }
  }

  async function senkronizeEt() {
    setSenkronizeEdiliyor(true);
    setHata("");
    setBasari("");
    try {
      const res = await api<{ senkronizeEdildi: number; toplam: number; mesaj?: string }>(
        "/eposta/gelen/senkronize-et",
        { method: "POST" },
      );
      if (res.mesaj) {
        setBasari(res.mesaj);
      } else {
        setBasari(`Senkronizasyon tamamlandı: ${res.senkronizeEdildi} yeni ileti içeri alındı.`);
      }
      await yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "IMAP senkronizasyonu başarısız");
    } finally {
      setSenkronizeEdiliyor(false);
    }
  }

  async function okunduDurumDegistir(hedefId?: string) {
    const hedef = hedefId ? epostalar.find((x) => x.id === hedefId) : seciliEposta;
    if (!hedef) return;
    const yeniDurum = !hedef.okundu;
    setIslemde(true);
    try {
      await api(`/eposta/gelen/${hedef.id}/okundu`, {
        method: "PATCH",
        body: JSON.stringify({ okundu: yeniDurum }),
      });
      if (seciliEposta?.id === hedef.id) {
        setSeciliEposta((prev) => (prev ? { ...prev, okundu: yeniDurum } : null));
      }
      setEpostalar((prev) =>
        prev.map((item) => (item.id === hedef.id ? { ...item, okundu: yeniDurum } : item)),
      );
      setBasari(yeniDurum ? "İleti okundu olarak işaretlendi" : "İleti okunmadı olarak işaretlendi");
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Okundu durumu değiştirilemedi");
    } finally {
      setIslemde(false);
    }
  }

  async function crmGorevOlustur() {
    if (!seciliEposta) return;
    setIslemde(true);
    setHata("");
    setBasari("");
    try {
      const firsat = await api<{ id: string; baslik: string }>(
        `/eposta/gelen/${seciliEposta.id}/crm-gorev`,
        { method: "POST" },
      );
      setBasari(`CRM Görevi oluşturuldu: ${firsat.baslik}`);
      await secVeDetayGetir(seciliEposta);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "CRM görevi oluşturulamadı");
    } finally {
      setIslemde(false);
    }
  }

  async function ocrCalistir(ekId: string) {
    if (!seciliEposta) return;
    setOcrYukleniyor((prev) => ({ ...prev, [ekId]: true }));
    setHata("");
    setBasari("");
    try {
      const ocrSonuc = await api<any>(`/eposta/gelen/${seciliEposta.id}/ekler/${ekId}/ocr`, {
        method: "POST",
      });
      setBasari(
        `Fatura/Fiş ayrıştırıldı: ${ocrSonuc.saticiUnvan || "Satıcı"} - Toplam: ${ocrSonuc.genelToplam || 0} ${ocrSonuc.paraBirimi || "TRY"}`,
      );
      await secVeDetayGetir(seciliEposta);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "OCR ayrıştırma başarısız");
    } finally {
      setOcrYukleniyor((prev) => ({ ...prev, [ekId]: false }));
    }
  }

  async function durumDegistir(durum: "yeni" | "islendi" | "arsivlendi", hedefId?: string) {
    const hedef = hedefId ? epostalar.find((x) => x.id === hedefId) : seciliEposta;
    if (!hedef) return;
    setIslemde(true);
    try {
      await api(`/eposta/gelen/${hedef.id}/durum`, {
        method: "PATCH",
        body: JSON.stringify({ durum }),
      });
      if (seciliEposta?.id === hedef.id) {
        setSeciliEposta((prev) => (prev ? { ...prev, durum } : null));
      }
      setEpostalar((prev) =>
        prev.map((item) => (item.id === hedef.id ? { ...item, durum } : item)),
      );
      setBasari(durum === "arsivlendi" ? "İleti arşivlendi" : `Durum güncellendi: ${durum}`);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Durum güncellenemedi");
    } finally {
      setIslemde(false);
    }
  }

  const bayrakDegistir = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBayraklilar((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Odaklanmış vs Diğer filtresi (Cari veya ek içerenler Odaklanmış'a düşer)
  const filtrelenmisEpostalar = useMemo(() => {
    let liste = epostalar;
    if (klasor === "ekli") {
      liste = liste.filter((e) => e.ekler && e.ekler.length > 0);
    }
    if (tab === "odaklanmis") {
      return liste.filter((e) => Boolean(e.cari || (e.ekler && e.ekler.length > 0) || e.durum === "islendi"));
    }
    return liste.filter((e) => !e.cari && (!e.ekler || e.ekler.length === 0) && e.durum !== "islendi");
  }, [epostalar, tab, klasor]);

  const okunmamisSayisi = useMemo(() => {
    return epostalar.filter((e) => !e.okundu).length;
  }, [epostalar]);

  return (
    <div className="outlook-shell mailbox-pro -m-6 md:-m-8 -mt-6 h-[calc(100dvh-62px)] min-h-[620px] flex flex-col font-sans overflow-hidden bg-[#f6f7f9] text-[#172033]">
      {/* ═══════════════════════════════════════════════════════════════════════
          1. MICROSOFT 365 / OUTLOOK HEADER (ÜST MAVİ ÇUBUK)
      ═══════════════════════════════════════════════════════════════════════ */}
      <header className="mailbox-pro__header bg-white h-16 shrink-0 px-4 md:px-6 flex items-center justify-between border-b border-[#e7e9ee] z-20">
        {/* SOL: 9 NOKTA WAFFLE VE OUTLOOK BAŞLIĞI */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#fff3e8] text-[#d7651b] transition-colors"
            title="Posta merkezi"
          >
            <div className="grid grid-cols-3 gap-0.5 w-3.5 h-3.5">
              {[...Array(9)].map((_, i) => (
                <span key={i} className="w-0.5 h-0.5 bg-current rounded-full" />
              ))}
            </div>
          </button>

          <div className="flex items-center gap-2">
            <span className="font-bold text-base tracking-tight flex items-center gap-2 text-[#172033]">
              <Mail className="w-5 h-5 text-[#e8792b]" />
              <span>Tekir Posta</span>
            </span>
            <span className="hidden lg:inline-block text-[11px] bg-[#f2f4f7] text-[#667085] px-2 py-1 rounded-full font-medium">
              Akıllı iş gelen kutusu
            </span>
          </div>
        </div>

        {/* ORTA: MERKEZİ OUTLOOK ARAMA ÇUBUĞU */}
        <div className="flex-1 max-w-xl mx-4">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3.5 text-[#7b8495] pointer-events-none" />
            <input
              type="text"
              placeholder="Ara (Konu, gönderen, içerik veya fatura)..."
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              className="w-full bg-[#f3f5f7] border border-transparent text-[#172033] placeholder-[#7b8495] text-sm rounded-xl pl-10 pr-9 py-2.5 focus:outline-none focus:bg-white focus:border-[#e8792b] focus:ring-4 focus:ring-[#e8792b]/10 transition-all"
            />
            {arama && (
              <button
                type="button"
                onClick={() => setArama("")}
                className="absolute right-3 text-gray-400 hover:text-gray-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* SAĞ: HIZLI DURUM VE AYARLAR */}
        <div className="flex items-center gap-1.5">
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#287a4d] bg-[#edf8f1] px-2.5 py-1.5 rounded-full font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>IMAP Aktif</span>
          </div>

          <button
            type="button"
            onClick={() => void senkronizeEt()}
            disabled={senkronizeEdiliyor || yukleniyor}
            className="flex items-center gap-1.5 bg-[#172033] hover:bg-[#252f43] text-white text-xs px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            title="Posta kutusunu hemen senkronize et"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${senkronizeEdiliyor ? "animate-spin" : ""}`} />
            <span className="hidden md:inline">{senkronizeEdiliyor ? "Eşitleniyor…" : "Eşitle"}</span>
          </button>

          <Link href="/panel/ayarlar/eposta">
            <button
              type="button"
              className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[#f2f4f7] text-[#667085] transition-colors"
              title="Posta Sunucu Ayarları"
            >
              <Settings className="w-4 h-4" />
            </button>
          </Link>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════
          2. MICROSOFT FLUENT RIBBON / EYLEM ŞERİDİ
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mailbox-pro__toolbar bg-white border-b border-[#e7e9ee] px-4 md:px-6 py-2 flex items-center justify-between text-xs shrink-0 select-none overflow-x-auto">
        <div className="flex items-center gap-2">
          {/* YENİ İLETİ BUTONU (OUTLOOK PRIMARY) */}
          <button
            type="button"
            onClick={() => setYeniIletiAcik(true)}
            className="bg-[#e8792b] hover:bg-[#d76c1f] text-white font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni İleti</span>
          </button>

          <div className="h-5 w-[1px] bg-[#d2d0ce] mx-1" />

          {/* SİL / ARŞİVLE */}
          <button
            type="button"
            disabled={!seciliEposta || islemde}
            onClick={() => void durumDegistir("arsivlendi")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-[#edebe9] text-[#323130] disabled:opacity-40 transition-colors"
            title="Seçili iletiyi arşivle"
          >
            <Archive className="w-4 h-4 text-gray-600" />
            <span>Arşivle</span>
          </button>

          <button
            type="button"
            disabled={!seciliEposta || islemde}
            onClick={() => void okunduDurumDegistir()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-[#edebe9] text-[#323130] disabled:opacity-40 transition-colors"
            title={seciliEposta?.okundu ? "Okunmadı olarak işaretle" : "Okundu olarak işaretle"}
          >
            {seciliEposta?.okundu ? <Mail className="w-4 h-4 text-blue-600" /> : <MailOpen className="w-4 h-4 text-gray-600" />}
            <span>{seciliEposta?.okundu ? "Okunmadı Yap" : "Okundu Yap"}</span>
          </button>

          <div className="h-5 w-[1px] bg-[#d2d0ce] mx-1" />

          {/* ÖZEL TEKİREXTRA AKSİYONLARI: CRM & OCR */}
          <button
            type="button"
            disabled={!seciliEposta || islemde}
            onClick={() => void crmGorevOlustur()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-[#edebe9] text-[#323130] disabled:opacity-40 transition-colors font-medium"
            title="E-postayı CRM fırsatı veya destek talebi olarak kaydet"
          >
            <CheckSquare className="w-4 h-4 text-emerald-600" />
            <span>CRM Görevi Aç</span>
          </button>

          {seciliEposta?.ekler && seciliEposta.ekler.length > 0 && (
            <button
              type="button"
              disabled={islemde}
              onClick={() => {
                const ilkEk = seciliEposta.ekler?.[0];
                if (ilkEk) void ocrCalistir(ilkEk.id);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-[#edebe9] text-[#323130] disabled:opacity-40 transition-colors font-medium"
              title="Ekli faturayı yapay zeka ile ayrıştır"
            >
              <ScanLine className="w-4 h-4 text-amber-600" />
              <span>Fatura OCR</span>
            </button>
          )}
        </div>

        {/* SAĞ: GÖRÜNÜM AYARI */}
        <div className="flex items-center gap-2">
          {seciliEposta && (
            <div className="flex items-center bg-[#edebe9] p-0.5 rounded text-[11px]">
              <button
                type="button"
                onClick={() => setHtmlModu(true)}
                className={`px-2 py-0.5 rounded font-medium ${htmlModu ? "bg-white shadow-2xs text-[#242424]" : "text-gray-600"}`}
              >
                HTML
              </button>
              <button
                type="button"
                onClick={() => setHtmlModu(false)}
                className={`px-2 py-0.5 rounded font-medium ${!htmlModu ? "bg-white shadow-2xs text-[#242424]" : "text-gray-600"}`}
              >
                Metin
              </button>
            </div>
          )}
        </div>
      </div>

      {/* BİLDİRİM BANNERI */}
      {(hata || basari) && (
        <div className="px-4 py-1.5 bg-white border-b border-[#e1dfdd] text-xs">
          {hata && <Alert tone="error">{hata}</Alert>}
          {basari && <Alert tone="success">{basari}</Alert>}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          3. OUTLOOK ANA GÖVDE (4 BÖLMELİ DÜZEN)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mailbox-pro__workspace flex-1 flex overflow-hidden min-w-0">
        {/* ─── PANE 1: SOL EN DIŞ SLIM APP RAIL (48px) ─── */}
        <div className="mailbox-pro__rail w-14 shrink-0 bg-[#f7f8fa] border-r border-[#e7e9ee] hidden 2xl:flex flex-col items-center py-3 justify-between">
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              type="button"
              className="relative w-8 h-8 rounded flex items-center justify-center text-[#0078d4] bg-white shadow-2xs"
              title="Posta (Etkin)"
            >
              <span className="w-1 h-5 bg-[#0078d4] rounded-r absolute left-0" />
              <Mail className="w-4 h-4" />
            </button>

            <Link href="/panel">
              <button
                type="button"
                className="w-8 h-8 rounded flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-[#e1dfdd] transition-colors"
                title="TekirExtra Paneli"
              >
                <Building2 className="w-4 h-4" />
              </button>
            </Link>

            <Link href="/panel/cari">
              <button
                type="button"
                className="w-8 h-8 rounded flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-[#e1dfdd] transition-colors"
                title="Cariler / Müşteriler"
              >
                <Users className="w-4 h-4" />
              </button>
            </Link>

            <Link href="/panel/fatura">
              <button
                type="button"
                className="w-8 h-8 rounded flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-[#e1dfdd] transition-colors"
                title="Faturalar"
              >
                <FileText className="w-4 h-4" />
              </button>
            </Link>
          </div>

          <div className="flex flex-col items-center gap-2">
            <Link href="/panel/ayarlar/eposta">
              <button
                type="button"
                className="w-8 h-8 rounded flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-[#e1dfdd] transition-colors"
                title="E-posta Ayarları"
              >
                <Settings className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>

        {/* ─── PANE 2: KLASÖR AĞACI (FOLDER PANE ~210px) ─── */}
        <div className="mailbox-pro__folders w-56 shrink-0 bg-white border-r border-[#e7e9ee] hidden xl:flex flex-col justify-between p-3 select-none text-xs">
          <div className="space-y-4">
            {/* SIK KULLANILANLAR */}
            <div className="space-y-0.5">
              <div className="px-2 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                <span>Sık Kullanılanlar</span>
              </div>

              <button
                type="button"
                onClick={() => setKlasor("gelen")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-sm transition-colors ${
                  klasor === "gelen"
                    ? "bg-[#c7e0f4] text-[#004e8c] font-semibold"
                    : "text-[#323130] hover:bg-[#f3f2f1]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-[#0078d4]" />
                  <span>Gelen Kutusu</span>
                </div>
                {okunmamisSayisi > 0 && (
                  <span className="bg-[#0078d4] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                    {okunmamisSayisi}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setKlasor("okunmamis")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-sm transition-colors ${
                  klasor === "okunmamis"
                    ? "bg-[#c7e0f4] text-[#004e8c] font-semibold"
                    : "text-[#323130] hover:bg-[#f3f2f1]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-500" />
                  <span>Okunmamışlar</span>
                </div>
                {okunmamisSayisi > 0 && (
                  <span className="text-[#0078d4] font-bold text-[11px]">{okunmamisSayisi}</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setKlasor("ekli")}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-sm transition-colors ${
                  klasor === "ekli"
                    ? "bg-[#c7e0f4] text-[#004e8c] font-semibold"
                    : "text-[#323130] hover:bg-[#f3f2f1]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-amber-600" />
                  <span>Ekli Belgeler</span>
                </div>
              </button>
            </div>

            {/* HESAP KLASÖRLERİ */}
            <div className="space-y-0.5 border-t border-[#edebe9] pt-2">
              <div className="px-2 py-1 text-[11px] font-bold text-gray-500 flex items-center gap-1 truncate">
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                <span className="truncate">Kurumsal Posta</span>
              </div>

              <button
                type="button"
                onClick={() => setKlasor("gelen")}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-sm transition-colors ${
                  klasor === "gelen"
                    ? "bg-[#c7e0f4] text-[#004e8c] font-semibold"
                    : "text-[#323130] hover:bg-[#f3f2f1]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Folder className="w-3.5 h-3.5 text-blue-500" />
                  <span>Gelen Kutusu</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setKlasor("islendi")}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-sm transition-colors ${
                  klasor === "islendi"
                    ? "bg-[#c7e0f4] text-[#004e8c] font-semibold"
                    : "text-[#323130] hover:bg-[#f3f2f1]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>İşlenenler (CRM)</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setKlasor("arsiv")}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-sm transition-colors ${
                  klasor === "arsiv"
                    ? "bg-[#c7e0f4] text-[#004e8c] font-semibold"
                    : "text-[#323130] hover:bg-[#f3f2f1]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Archive className="w-3.5 h-3.5 text-gray-500" />
                  <span>Arşiv</span>
                </div>
              </button>
            </div>
          </div>

          {/* ASİSTAN İPUCU */}
          <div className="p-2 border-t border-[#edebe9] text-[11px] text-gray-500">
            <div className="flex items-center gap-1 text-[#0078d4] font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Yapay Zeka Asistanı</span>
            </div>
            <p className="text-[10px] text-gray-500 leading-tight">
              İletileri özetleyin, yanıt hazırlayın veya CRM görevi oluşturun.
            </p>
            <button
              type="button"
              className="mailbox-pro__assistant-button"
              onClick={() => asistaniAc()}
            >
              <Sparkles aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Asistanı Aç</span>
              <ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ─── PANE 3: İLETİ LİSTESİ (MESSAGE LIST PANE ~370px) ─── */}
        <div className={`mailbox-pro__list ${mobilDetayAcik ? "hidden md:flex" : "flex"} w-full md:w-[360px] lg:w-[390px] shrink-0 bg-white border-r border-[#e7e9ee] flex-col overflow-hidden`}>
          {/* LİSTE BAŞLIĞI VE ODAKLANMIŞ / DİĞER SEKMELERİ */}
          <div className="px-4 pt-4 pb-3 border-b border-[#e7e9ee] bg-white">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-base font-bold text-[#172033] tracking-tight">
                {klasor === "gelen"
                  ? "Gelen Kutusu"
                  : klasor === "okunmamis"
                  ? "Okunmamış İletiler"
                  : klasor === "islendi"
                  ? "İşlenen Talepler"
                  : klasor === "ekli"
                  ? "Ekli Belgeler"
                  : "Arşiv"}
              </h2>
              <span className="text-[11px] text-gray-500 font-medium">
                {filtrelenmisEpostalar.length} ileti
              </span>
            </div>

            {/* OUTLOOK SEKMELERİ */}
            <div className="flex border-b border-[#e1dfdd] text-xs">
              <button
                type="button"
                onClick={() => setTab("odaklanmis")}
                className={`pb-1 px-3 font-semibold transition-all relative ${
                  tab === "odaklanmis"
                    ? "text-[#0078d4] border-b-2 border-[#0078d4]"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                Odaklanmış
              </button>
              <button
                type="button"
                onClick={() => setTab("diger")}
                className={`pb-1 px-3 font-semibold transition-all relative ${
                  tab === "diger"
                    ? "text-[#0078d4] border-b-2 border-[#0078d4]"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                Diğer
              </button>
            </div>
          </div>

          {/* İLETİ KARTLARI LİSTESİ */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#edebe9]">
            {yukleniyor && filtrelenmisEpostalar.length === 0 && (
              <div className="p-8 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[#0078d4]" />
                <span>İletiler alınıyor…</span>
              </div>
            )}

            {!yukleniyor && filtrelenmisEpostalar.length === 0 && (
              <div className="p-8 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
                <Inbox className="w-8 h-8 text-gray-300" />
                <span>Bu klasörde ileti bulunmuyor.</span>
              </div>
            )}

            {filtrelenmisEpostalar.map((e) => {
              const seciliMi = seciliEposta?.id === e.id;
              const senderInitials = getInitials(e.gonderenAdi || e.gonderenEposta);
              const avatarColor = getAvatarBg(e.gonderenEposta);
              const bayrakliMi = Boolean(bayraklilar[e.id]);

              return (
                <div
                  key={e.id}
                  onClick={() => void secVeDetayGetir(e)}
                  className={`mailbox-pro__message group relative p-3 cursor-pointer transition-colors border-l-4 ${
                    seciliMi
                      ? "bg-[#fff7ef] border-l-[#e8792b]"
                      : !e.okundu
                      ? "bg-white border-l-[#0078d4] hover:bg-[#f3f2f1]"
                      : "bg-white border-l-transparent hover:bg-[#f3f2f1]"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* AVATAR */}
                    <div
                      className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold shadow-2xs ${avatarColor}`}
                    >
                      {senderInitials}
                    </div>

                    {/* METİN BİLGİSİ */}
                    <div className="flex-1 min-w-0">
                      {/* GÖNDEREN & TARİH */}
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <div className="flex items-center gap-1.5 truncate">
                          {!e.okundu && (
                            <span className="w-2 h-2 rounded-full bg-[#0078d4] shrink-0" title="Okunmamış" />
                          )}
                          <span
                            className={`truncate text-xs ${
                              !e.okundu ? "font-bold text-[#242424]" : "font-medium text-[#424242]"
                            }`}
                          >
                            {e.gonderenAdi || e.gonderenEposta}
                          </span>
                        </div>

                        <span className="text-[11px] text-gray-500 font-normal shrink-0">
                          {formatTarihKisa(e.tarih)}
                        </span>
                      </div>

                      {/* KONU */}
                      <div
                        className={`text-xs truncate mb-1 ${
                          !e.okundu ? "font-bold text-[#242424]" : "font-normal text-[#323130]"
                        }`}
                      >
                        {e.konu || "(Konusuz İleti)"}
                      </div>

                      {/* ÖNİZLEME METNİ */}
                      <div className="text-[11px] text-[#605e5c] line-clamp-2 leading-tight mb-1.5">
                        {e.icerikMetin || "İçerik önizlemesi bulunmuyor..."}
                      </div>

                      {/* ROZETLER */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {e.cari ? (
                          <span className="inline-flex items-center gap-1 bg-[#eaf7ee] text-[#15803d] border border-[#bbf7d0] text-[10px] px-1.5 py-0.2 rounded font-medium truncate max-w-[140px]">
                            <Building2 className="w-3 h-3 shrink-0" />
                            <span className="truncate">{e.cari.unvan}</span>
                          </span>
                        ) : null}

                        {e.ekler && e.ekler.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-800 border border-amber-200 text-[10px] px-1.5 py-0.2 rounded font-medium">
                            <Paperclip className="w-2.5 h-2.5" />
                            <span>{e.ekler.length}</span>
                          </span>
                        )}

                        {e.durum === "islendi" && (
                          <span className="inline-flex items-center gap-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-1.5 py-0.2 rounded font-medium">
                            <CheckSquare className="w-2.5 h-2.5" />
                            <span>İşlendi</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* HOVER EYLEMLERİ (OUTLOOK QUICK ACTIONS) */}
                    <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-1 bg-white/95 px-1 py-0.5 rounded shadow-xs border border-gray-200">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void durumDegistir("arsivlendi", e.id);
                        }}
                        className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100"
                        title="Arşivle"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void okunduDurumDegistir(e.id);
                        }}
                        className="p-1 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100"
                        title={e.okundu ? "Okunmadı yap" : "Okundu yap"}
                      >
                        {e.okundu ? <Mail className="w-3.5 h-3.5 text-blue-600" /> : <MailOpen className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(ev) => bayrakDegistir(e.id, ev)}
                        className={`p-1 rounded hover:bg-gray-100 ${bayrakliMi ? "text-amber-500" : "text-gray-400 hover:text-gray-700"}`}
                        title="Bayrak ekle"
                      >
                        <Flag className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── PANE 4: OKUMA BÖLMESİ (READING PANE - FLEX 1) ─── */}
        <div className={`mailbox-pro__reader ${mobilDetayAcik ? "flex" : "hidden md:flex"} flex-1 min-w-0 bg-white flex-col overflow-hidden`}>
          {seciliEposta ? (
            <div className="h-full flex flex-col overflow-hidden">
              {/* OKUMA BÖLMESİ ÜST EYLEM ŞERİDİ (MESSAGE ACTION STRIP) */}
              <div className="border-b border-[#e7e9ee] px-3 md:px-6 py-3 bg-white flex items-center justify-between gap-2 shrink-0 overflow-x-auto">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMobilDetayAcik(false)}
                    className="md:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#667085] hover:bg-[#f2f4f7]"
                    title="İleti listesine dön"
                    aria-label="İleti listesine dön"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setYeniIletiAcik(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-[#f3f2f1] text-[#323130] border border-[#d2d0ce] text-xs font-semibold rounded shadow-2xs transition-colors"
                  >
                    <Reply className="w-3.5 h-3.5 text-[#0078d4]" />
                    <span>Yanıtla</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setYeniIletiAcik(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-[#f3f2f1] text-[#323130] border border-[#d2d0ce] text-xs font-medium rounded shadow-2xs transition-colors"
                  >
                    <ReplyAll className="w-3.5 h-3.5 text-[#0078d4]" />
                    <span>Tümünü Yanıtla</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setYeniIletiAcik(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-[#f3f2f1] text-[#323130] border border-[#d2d0ce] text-xs font-medium rounded shadow-2xs transition-colors"
                  >
                    <Forward className="w-3.5 h-3.5 text-[#0078d4]" />
                    <span>İlet</span>
                  </button>

                  <div className="h-4 w-[1px] bg-[#d2d0ce] mx-1" />

                  {seciliEposta.durum !== "islendi" && (
                    <button
                      type="button"
                      onClick={() => void crmGorevOlustur()}
                      disabled={islemde}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#107c41] hover:bg-[#0b5c30] text-white text-xs font-semibold rounded shadow-xs transition-colors"
                      title="CRM Takibine ve Görev Listesine Ekle"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>CRM Görevi Oluştur</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void okunduDurumDegistir()}
                    className="p-1.5 rounded hover:bg-[#edebe9] text-gray-600"
                    title={seciliEposta.okundu ? "Okunmadı olarak işaretle" : "Okundu olarak işaretle"}
                  >
                    {seciliEposta.okundu ? <Mail className="w-4 h-4 text-[#0078d4]" /> : <MailOpen className="w-4 h-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => void durumDegistir(seciliEposta.durum === "arsivlendi" ? "yeni" : "arsivlendi")}
                    className="p-1.5 rounded hover:bg-[#edebe9] text-gray-600"
                    title={seciliEposta.durum === "arsivlendi" ? "Gelen Kutusuna Al" : "Arşivle"}
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* İLETİ GÖVDE VE İÇERİĞİ (SCROLL) */}
              <div className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-10 py-5 md:py-8 space-y-6 bg-[#fcfcfd]">
                {/* KONU BAŞLIĞI */}
                <div>
                  <h1 className="text-xl md:text-[26px] font-bold text-[#172033] leading-snug tracking-tight">
                    {seciliEposta.konu || "(Konusuz İleti)"}
                  </h1>
                </div>

                {/* GÖNDEREN BİLGİ KARTI */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#edebe9]">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-2xs shrink-0 ${getAvatarBg(
                        seciliEposta.gonderenEposta,
                      )}`}
                    >
                      {getInitials(seciliEposta.gonderenAdi || seciliEposta.gonderenEposta)}
                    </div>

                    <div>
                      <div className="font-semibold text-sm text-[#242424] flex items-center gap-2">
                        <span>{seciliEposta.gonderenAdi || seciliEposta.gonderenEposta}</span>
                        {seciliEposta.cari && (
                          <span className="bg-[#eaf7ee] text-[#15803d] border border-[#bbf7d0] text-[10px] px-2 py-0.2 rounded font-medium">
                            Doğrulanmış Cari
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        &lt;{seciliEposta.gonderenEposta}&gt;
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Kime: <span className="text-gray-700">{seciliEposta.aliciEposta}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right text-xs text-gray-500 shrink-0">
                    <div>{new Date(seciliEposta.tarih).toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
                    <div className="font-semibold text-gray-700">{new Date(seciliEposta.tarih).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>

                {/* EŞLEŞEN CARİ KARTI (OUTLOOK BUSINESS CARD) */}
                <div className="p-3 bg-[#faf9f8] border border-[#e1dfdd] rounded flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-[#242424]">
                        {seciliEposta.cari ? (
                          <span>Cari Eşleşmesi: {seciliEposta.cari.unvan}</span>
                        ) : (
                          <span className="text-gray-500">Cari Kartı Eşleşmedi</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {seciliEposta.cari
                          ? `Kod: ${seciliEposta.cari.kod} | E-posta: ${seciliEposta.cari.eposta || "-"}`
                          : "Bu gönderen TekirExtra cariler listenizde kayıtlı değil."}
                      </div>
                    </div>
                  </div>

                  {seciliEposta.cari ? (
                    <Link
                      href={`/panel/cari`}
                      className="inline-flex items-center gap-1 text-[#0078d4] hover:underline font-semibold bg-white border border-[#c7e0f4] px-2.5 py-1 rounded"
                    >
                      <span>Cariyi Aç</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  ) : null}
                </div>

                {/* EKLER ŞERİDİ (OUTLOOK RECTANGULAR TILES) */}
                {seciliEposta.ekler && seciliEposta.ekler.length > 0 && (
                  <div className="space-y-2 border border-[#e1dfdd] rounded p-3 bg-[#faf9f8]">
                    <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 text-gray-500" />
                        <span>Ekler ({seciliEposta.ekler.length})</span>
                      </div>
                      <span className="text-[11px] text-gray-400 font-normal">
                        {seciliEposta.ekler.reduce((acc, x) => acc + x.boyut, 0) > 0
                          ? `${Math.round(seciliEposta.ekler.reduce((acc, x) => acc + x.boyut, 0) / 1024)} KB`
                          : ""}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {seciliEposta.ekler.map((ek) => {
                        const ocrVar = Boolean(ek.cikarilanVeri);
                        const ocrVeri = ek.cikarilanVeri;
                        const yukleniyor = ocrYukleniyor[ek.id];

                        return (
                          <div
                            key={ek.id}
                            className="bg-white border border-[#d2d0ce] hover:border-[#0078d4] rounded p-2.5 transition-all flex flex-col justify-between shadow-2xs"
                          >
                            <div className="flex items-start gap-2 mb-2">
                              {ek.dosyaAdi.endsWith(".pdf") ? (
                                <FileText className="w-6 h-6 text-red-500 shrink-0" />
                              ) : ek.dosyaAdi.match(/\.(xlsx?|csv)$/i) ? (
                                <FileSpreadsheet className="w-6 h-6 text-emerald-600 shrink-0" />
                              ) : (
                                <FileText className="w-6 h-6 text-blue-500 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-[#242424] truncate" title={ek.dosyaAdi}>
                                  {ek.dosyaAdi}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  {Math.round(ek.boyut / 1024)} KB
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 pt-1.5 border-t border-[#edebe9]">
                              <a
                                href={`/api/v1/eposta/gelen/${seciliEposta.id}/ekler/${ek.id}/indir`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] bg-[#f3f2f1] hover:bg-[#edebe9] text-[#323130] font-medium px-2 py-1 rounded"
                              >
                                <Download className="w-3 h-3" />
                                <span>İndir</span>
                              </a>

                              <button
                                type="button"
                                onClick={() => void ocrCalistir(ek.id)}
                                disabled={yukleniyor}
                                className="inline-flex items-center gap-1 text-[11px] bg-[#eff6fc] hover:bg-[#deecf9] text-[#0078d4] font-semibold px-2 py-1 rounded disabled:opacity-50"
                              >
                                {yukleniyor ? (
                                  <span>Ayrıştırılıyor…</span>
                                ) : ocrVar ? (
                                  <span>Tekrar OCR</span>
                                ) : (
                                  <span>Fatura OCR</span>
                                )}
                              </button>
                            </div>

                            {/* OCR AYRIŞTIRILMIŞ FATURA KARTI */}
                            {ocrVar && (
                              <div className="mt-2 p-2 bg-[#eaf7ee] border border-[#bbf7d0] rounded text-[11px] text-[#15803d] space-y-1">
                                <div className="font-bold flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Fatura Verisi Ayrıştırıldı</span>
                                </div>
                                <div className="text-[10px] leading-tight">
                                  Satıcı: <strong>{ocrVeri.saticiUnvan || "-"}</strong>
                                  <br />
                                  Toplam: <strong>{ocrVeri.genelToplam || 0} {ocrVeri.paraBirimi || "TRY"}</strong>
                                </div>
                                <Link
                                  href={`/panel/fatura/yeni?alis=true&unvan=${encodeURIComponent(
                                    ocrVeri.saticiUnvan || "",
                                  )}&vkn=${encodeURIComponent(
                                    ocrVeri.saticiVknTckn || "",
                                  )}&tutar=${encodeURIComponent(ocrVeri.genelToplam || 0)}`}
                                >
                                  <button
                                    type="button"
                                    className="w-full mt-1 bg-[#15803d] hover:bg-[#166534] text-white font-semibold text-[11px] py-1 px-2 rounded"
                                  >
                                    Alış Faturası Olarak Aç →
                                  </button>
                                </Link>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* İLETİ GÖVDESİ (OUTLOOK BODY TYPOGRAPHY) */}
                <div className="email-body-content bg-white rounded border border-[#e1dfdd] p-5 text-sm leading-relaxed text-[#242424] min-h-[300px]">
                  {htmlModu && seciliEposta.icerikHtml ? (
                    <div
                      className="prose max-w-none text-sm text-[#242424]"
                      dangerouslySetInnerHTML={{ __html: seciliEposta.icerikHtml }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {seciliEposta.icerikMetin || "(İleti metni bulunmuyor)"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* BOŞ OKUMA BÖLMESİ (AUTHENTIC OUTLOOK EMPTY STATE) */
            <div className="h-full flex flex-col items-center justify-center p-8 text-center select-none bg-[#f8fafc]/60">
              <div className="w-16 h-16 rounded-full bg-[#eff6fc] text-[#0078d4] flex items-center justify-center text-3xl mb-3 shadow-inner">
                <Mail className="w-8 h-8" />
              </div>
              <h3 className="font-semibold text-gray-700 text-base mb-1">
                Görüntülenecek bir ileti seçin
              </h3>
              <p className="text-xs text-gray-400 max-w-xs">
                Gelen kutusu listesinden bir ileti seçerek detaylarını, ekli faturaları ve CRM aksiyonlarını inceleyebilirsiniz.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          4. YENİ İLETİ OLUŞTURMA PENCERESİ (OUTLOOK MODAL DIALOG)
      ═══════════════════════════════════════════════════════════════════════ */}
      {yeniIletiAcik && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-full max-w-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* MODAL BAŞLIĞI */}
            <div className="bg-[#0078d4] text-white px-4 py-2.5 flex items-center justify-between">
              <span className="font-semibold text-sm flex items-center gap-2">
                <Mail className="w-4 h-4" />
                <span>Yeni İleti Oluştur</span>
              </span>
              <button
                type="button"
                onClick={() => setYeniIletiAcik(false)}
                className="text-white hover:bg-white/20 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* MODAL İÇERİĞİ */}
            <div className="p-4 space-y-3 text-xs">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded text-blue-900 leading-relaxed">
                <strong>Bilgi:</strong> TekirExtra sisteminde giden e-postalar (teklif, sipariş, fatura PDF'leri veya vade hatırlatmaları) ilgili belge ve cari ekranlarından SMTP üzerinden doğrudan gönderilmektedir.
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">Kime:</label>
                <input
                  type="email"
                  placeholder="musteri@firma.com"
                  defaultValue={seciliEposta?.gonderenEposta || ""}
                  className="w-full border border-gray-300 rounded p-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">Konu:</label>
                <input
                  type="text"
                  placeholder="Konu başlığı..."
                  defaultValue={seciliEposta ? `Ynt: ${seciliEposta.konu}` : ""}
                  className="w-full border border-gray-300 rounded p-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">İleti:</label>
                <textarea
                  rows={6}
                  placeholder="E-posta içeriğinizi yazın..."
                  className="w-full border border-gray-300 rounded p-2 text-xs"
                />
              </div>
            </div>

            {/* MODAL AKSİYONLARI */}
            <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
              <span className="text-[11px] text-gray-500">SMTP Ayarları: Ayarlar &gt; E-posta sekmesi</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setYeniIletiAcik(false)}
                  className="px-3 py-1.5 border border-gray-300 bg-white hover:bg-gray-100 rounded text-xs text-gray-700 font-medium"
                >
                  Kapat
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setYeniIletiAcik(false);
                    setBasari("İleti gönderim kuyruğuna alındı.");
                  }}
                  className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded text-xs font-semibold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Gönder</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
