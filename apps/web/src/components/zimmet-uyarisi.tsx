"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert } from "@/components/ui";

interface AcikZimmet { id: string; baslangic: string; demirbas: { id: string; kod: string; ad: string; seriNo: string | null } }

/** DMR-10: işten çıkışta iade edilmemiş demirbaş zimmetleri; çıkışı engellemez. */
export function ZimmetUyarisi({ personelId }: { personelId: string }) {
  const [zimmetler, setZimmetler] = useState<AcikZimmet[]>([]);
  useEffect(() => {
    // Demirbaş uçlarına yetkisi olmayan rol (ör. İK) uyarıyı görmez; çıkış yine yapılır.
    void api<AcikZimmet[]>(`/demirbas/zimmetler?personelId=${personelId}`).then(setZimmetler).catch(() => setZimmetler([]));
  }, [personelId]);
  if (!zimmetler.length) return null;
  return (
    <Alert tone="warning">
      Personelin iade edilmemiş {zimmetler.length} zimmeti var; çıkıştan önce iade alın:
      <ul>{zimmetler.map((z) => <li key={z.id}><a href={`/panel/demirbas/${z.demirbas.id}`}>{z.demirbas.kod} {z.demirbas.ad}</a>{z.demirbas.seriNo ? ` (${z.demirbas.seriNo})` : ""}</li>)}</ul>
    </Alert>
  );
}
