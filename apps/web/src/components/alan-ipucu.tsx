/**
 * Alanın uzun açıklaması için küçük "?" ipucu. Kalabalık formlarda yardım
 * metni alanın altını doldurmasın diye tıklanınca (ya da klavyeyle) açılır.
 */
import type { ReactNode } from "react";

export function AlanIpucu({ children }: { children: ReactNode }) {
  return (
    <details className="alan-ipucu">
      <summary aria-label="Açıklamayı göster" title="Açıklama">?</summary>
      <small>{children}</small>
    </details>
  );
}
