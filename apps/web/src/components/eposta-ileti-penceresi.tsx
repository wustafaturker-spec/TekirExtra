"use client";

import { useState } from "react";
import { Mail, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import { adresleriAyikla, type IletiTaslagi } from "@/lib/eposta-ileti";
import { AiMetinAlani } from "@/components/ai-metin-alani";

const BASLIK: Record<IletiTaslagi["mod"], string> = {
  yeni: "Yeni İleti",
  yanitla: "Yanıtla",
  tumunu: "Tümünü Yanıtla",
  ilet: "İlet",
};

/** E-posta ekranından ileti yazma; kiracının SMTP ayarıyla gerçekten gönderir. */
export function EpostaIletiPenceresi({
  taslak,
  onKapat,
  onGonderildi,
}: {
  taslak: IletiTaslagi;
  onKapat: () => void;
  onGonderildi: (mesaj: string) => void;
}) {
  const [kime, setKime] = useState(taslak.kime);
  const [konu, setKonu] = useState(taslak.konu);
  const [metin, setMetin] = useState(taslak.metin);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState("");

  async function gonder() {
    const alicilar = adresleriAyikla(kime);
    if (!alicilar.length) return setHata("En az bir geçerli alıcı adresi girin.");
    if (!konu.trim()) return setHata("Konu zorunludur.");
    if (!metin.trim()) return setHata("İleti boş olamaz.");
    setGonderiliyor(true);
    setHata("");
    try {
      const sonuc = await api<{ alicilar: string[] }>("/eposta/gelen/ileti", {
        method: "POST",
        body: JSON.stringify({ kime: alicilar, konu, metin, yanitlananId: taslak.yanitlananId }),
      });
      onGonderildi(`İleti gönderildi: ${sonuc.alicilar.join(", ")}`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İleti gönderilemedi");
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
      <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-full max-w-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-[#0078d4] text-white px-4 py-2.5 flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-2">
            <Mail className="w-4 h-4" />
            <span>{BASLIK[taslak.mod]}</span>
          </span>
          <button type="button" onClick={onKapat} disabled={gonderiliyor} className="text-white hover:bg-white/20 p-1 rounded" aria-label="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          {hata && <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-800">{hata}</div>}
          <div>
            <label className="block font-semibold text-gray-700 mb-1">Kime:</label>
            <input
              type="text"
              value={kime}
              onChange={(e) => setKime(e.target.value)}
              placeholder="musteri@firma.com (birden çok adresi virgülle ayırın)"
              className="w-full border border-gray-300 rounded p-2 text-xs"
            />
          </div>
          <div>
            <label className="block font-semibold text-gray-700 mb-1">Konu:</label>
            <input
              type="text"
              value={konu}
              onChange={(e) => setKonu(e.target.value)}
              placeholder="Konu başlığı..."
              maxLength={300}
              className="w-full border border-gray-300 rounded p-2 text-xs"
            />
          </div>
          <div>
            <label className="block font-semibold text-gray-700 mb-1">İleti:</label>
            <AiMetinAlani
              alan="eposta_govdesi"
              rows={10}
              value={metin}
              onDegis={setMetin}
              placeholder="E-posta içeriğinizi yazın..."
              autoFocus
              className="w-full border border-gray-300 rounded p-2 text-xs font-mono"
            />
          </div>
          {taslak.mod === "ilet" && <p className="text-[11px] text-gray-500">Asıl iletinin ekleri iletilmez; yalnız metni gönderilir.</p>}
        </div>

        <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Ayarlar &gt; E-posta&apos;daki SMTP hesabıyla gönderilir</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onKapat}
              disabled={gonderiliyor}
              className="px-3 py-1.5 border border-gray-300 bg-white hover:bg-gray-100 rounded text-xs text-gray-700 font-medium"
            >
              Kapat
            </button>
            <button
              type="button"
              onClick={() => void gonder()}
              disabled={gonderiliyor}
              className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-60 text-white rounded text-xs font-semibold flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{gonderiliyor ? "Gönderiliyor…" : "Gönder"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
