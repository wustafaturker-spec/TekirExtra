"use client";
import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { apiDosyaIndir } from "@/lib/api";
import { Button } from "@/components/ui";

/** AI-118: asistanın ürettiği dosya; `ekId` yoksa dosya saklanamamıştır (`hata`). */
export interface AsistanDosyasi { ekId?: string; dosyaAdi: string; mimeType: string; boyut: number; hata?: string }

const excelMi = (d: AsistanDosyasi) => d.mimeType.includes("spreadsheet") || d.dosyaAdi.toLowerCase().endsWith(".xlsx");
const boyutMetni = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024)).toLocaleString("tr-TR")} KB` : `${(b / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`);

function DosyaKarti({ dosya }: { dosya: AsistanDosyasi }) {
  const [hata, setHata] = useState<string | null>(null);
  const [iniyor, setIniyor] = useState(false);
  const Simge = excelMi(dosya) ? FileSpreadsheet : FileText;
  async function indir() {
    if (!dosya.ekId) return;
    setHata(null); setIniyor(true);
    try { await apiDosyaIndir(`/ekler/${dosya.ekId}/indir`, dosya.dosyaAdi); }
    catch (e) { setHata(e instanceof Error ? e.message : "Dosya indirilemedi"); }
    finally { setIniyor(false); }
  }
  const alt = dosya.ekId ? `${excelMi(dosya) ? "Excel" : "PDF"} · ${boyutMetni(dosya.boyut)}${hata ? ` · ${hata}` : ""}` : (dosya.hata ?? "Dosya saklanamadı");
  return (
    <div className="document-attachment">
      <span aria-hidden="true"><Simge size={20} /></span>
      <div><strong title={dosya.dosyaAdi}>{dosya.dosyaAdi}</strong><small>{alt}</small></div>
      {dosya.ekId && <Button size="sm" onClick={() => void indir()} disabled={iniyor}>{iniyor ? "İndiriliyor…" : "İndir"}</Button>}
    </div>
  );
}

export function YzDosyalar({ dosyalar = [] }: { dosyalar?: AsistanDosyasi[] }) {
  if (!dosyalar.length) return null;
  return <div className="document-attachments" style={{ marginTop: 10 }} aria-label="Asistanın hazırladığı dosyalar">
    {dosyalar.map((d, i) => <DosyaKarti key={d.ekId ?? `${d.dosyaAdi}-${i}`} dosya={d} />)}
  </div>;
}
