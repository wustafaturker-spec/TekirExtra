import { Inbox, Search } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";

export function PlatformArama({ etiket, deger, onChange, placeholder }: {
  etiket: string; deger: string; onChange: (deger: string) => void; placeholder: string;
}) {
  return <label className="platform-search"><Search size={17} aria-hidden="true" /><Input aria-label={etiket} value={deger} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

export function PlatformListeDurumu({ sutun, yukleniyor, hata, bos, baslik, aciklama, onTekrar }: {
  sutun: number; yukleniyor: boolean; hata: string; bos: boolean; baslik: string; aciklama?: string; onTekrar: () => void;
}) {
  if (!yukleniyor && !hata && !bos) return null;
  return <tr><td colSpan={sutun}>
    {hata ? <div className="platform-empty"><Alert tone="error">{hata}</Alert><Button onClick={onTekrar}>Tekrar dene</Button></div>
      : <div className="platform-empty" role="status"><Inbox size={26} aria-hidden="true" /><strong>{yukleniyor ? "Veriler yükleniyor…" : baslik}</strong>{!yukleniyor && aciklama && <span>{aciklama}</span>}</div>}
  </td></tr>;
}
