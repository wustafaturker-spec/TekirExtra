"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Button, Input, Modal } from "@/components/ui";

interface CariAdayi { id: string; kod: string | null; unvan: string; vknTckn?: string | null }

/** Kullanıcının bir cariyi aramayla açıkça seçtiği pencere; tahminle cari bağlanmaz. */
export function CariSecModali({ baslik, aciklama, onSec, onKapat }: { baslik: ReactNode; aciklama?: ReactNode; onSec: (cari: CariAdayi) => void; onKapat: () => void }) {
  const [arama, setArama] = useState("");
  const [adaylar, setAdaylar] = useState<CariAdayi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);

  useEffect(() => {
    const metin = arama.trim();
    if (metin.length < 2) { setAdaylar([]); return; }
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      setYukleniyor(true);
      api<{ kayitlar: CariAdayi[] }>(`/cari?arama=${encodeURIComponent(metin)}&adet=10`)
        .then((r) => { if (!iptal) setAdaylar(r.kayitlar); })
        .catch(() => { if (!iptal) setAdaylar([]); })
        .finally(() => { if (!iptal) setYukleniyor(false); });
    }, 250);
    return () => { iptal = true; clearTimeout(zamanlayici); };
  }, [arama]);

  return (
    <Modal baslik={baslik} aciklama={aciklama} onKapat={onKapat}>
      <div className="stack">
        <Input autoFocus aria-label="Cari ara" placeholder="Ünvan, kod ya da VKN ile ara" value={arama} onChange={(e) => setArama(e.target.value)} />
        {yukleniyor && <p className="muted">Aranıyor…</p>}
        {!yukleniyor && arama.trim().length >= 2 && adaylar.length === 0 && <p className="muted">Eşleşen cari yok.</p>}
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {adaylar.map((c) => (
            <li key={c.id} className="row" style={{ justifyContent: "space-between", gap: ".75rem" }}>
              <span><strong>{c.unvan}</strong>{c.kod ? <span className="muted"> · {c.kod}</span> : null}{c.vknTckn ? <span className="muted"> · {c.vknTckn}</span> : null}</span>
              <Button size="sm" variant="primary" type="button" onClick={() => onSec(c)}>Seç</Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
