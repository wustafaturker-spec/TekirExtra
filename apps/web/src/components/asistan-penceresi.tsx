"use client";

import { Modal } from "@/components/ui";
import { AsistanSohbet } from "@/components/asistan-sohbet";
import type { AsistanBaglami } from "@/lib/asistan-baglami";
import type { EkranDurumu } from "@tekirextra/shared";

/** Her ekrandan açılan asistan penceresi (AI-05). */
export function AsistanPenceresi({ acik, baglam, durum, onBaglamKaldir, onKapat }: { acik: boolean; baglam?: AsistanBaglami | null; durum?: EkranDurumu | null; onBaglamKaldir?: () => void; onKapat: () => void }) {
  if (!acik) return null;
  return (
    <Modal aciklama={<>Onay gerektiren işlemler düğmeyle onaylanır. <a href="/panel/ai">Tüm onay talepleri</a></>} baslik="Asistan" genis onKapat={onKapat}>
      <AsistanSohbet yukseklik="min(60vh, 34rem)" baglam={baglam} durum={durum} onBaglamKaldir={onBaglamKaldir} />
    </Modal>
  );
}
