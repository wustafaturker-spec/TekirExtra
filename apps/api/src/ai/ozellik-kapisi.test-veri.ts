import { vi } from "vitest";

/**
 * AI-109: birim testlerindeki sahte işlem nesnelerine eklenir; özellik kapısı açık okunur.
 * Dosyanın kendi `tenantAiAyari` sahtesi varsa spread sırasıyla onu ezmez (önce yayılır).
 */
export const kapiAcikTx = () => ({
  platformAiOzellikDurumu: { findMany: vi.fn().mockResolvedValue([]) },
  tenantAiAyari: { findUnique: vi.fn().mockResolvedValue(null) },
});
