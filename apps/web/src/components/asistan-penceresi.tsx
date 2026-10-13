"use client";

import { Modal } from "@/components/ui";
import { AsistanSohbet } from "@/components/asistan-sohbet";

/** Her ekrandan açılan asistan penceresi (AI-05). */
export function AsistanPenceresi({ acik, onKapat }: { acik: boolean; onKapat: () => void }) {
  if (!acik) return null;
  return (
    <Modal aciklama={<>Onay gerektiren işlemler düğmeyle onaylanır. <a href="/panel/ai">Tüm onay talepleri</a></>} baslik="Asistan" genis onKapat={onKapat}>
      <AsistanSohbet yukseklik="min(60vh, 34rem)" />
    </Modal>
  );
}
