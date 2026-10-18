"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Button, Input, Modal } from "@/components/ui";

interface CariAdayi { id: string; kod: string | null; unvan: string; vknTckn?: string | null }
/** AI-47: sunucunun önerdiği olası cari (gerekçesiyle); yine kullanıcı seçer. */
export interface OnerilenCari { cariId: string; kod: string | null; unvan: string; vknTckn: string | null; gerekceler: string[] }

/** Kullanıcının bir cariyi aramayla açıkça seçtiği pencere; tahminle cari bağlanmaz. */
export function CariSecModali({ baslik, aciklama, onSec, onKapat, onerilenler }: { baslik: ReactNode; aciklama?: ReactNode; onSec: (cari: CariAdayi) => void; onKapat: () => void; onerilenler?: OnerilenCari[] }) {
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
        {!!onerilenler?.length && (
          <div className="stack cari-sec__oneriler" aria-label="Olası cariler">
            <strong>Olası cariler</strong>
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {onerilenler.map((c) => (
                <li key={c.cariId} className="row" style={{ justifyContent: "space-between", gap: ".75rem" }}>
                  <span><strong>{c.unvan}</strong>{c.kod ? <span className="muted"> · {c.kod}</span> : null}<small className="muted" style={{ display: "block" }}>{c.gerekceler.join(" · ")}</small></span>
                  <Button size="sm" variant="primary" type="button" onClick={() => onSec({ id: c.cariId, kod: c.kod, unvan: c.unvan, vknTckn: c.vknTckn })}>Bu cari</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
