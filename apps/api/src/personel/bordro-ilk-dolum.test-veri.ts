import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bordroParametreleri } from "./bordro-mevzuati";

/**
 * Yalnız testler için: MVZ-14 göçündeki ilk dolum kayıtları (2026 Ocak–Nisan,
 * Mayıs'tan itibaren). Tek kaynak göç dosyasıdır.
 */
const sql = readFileSync(join(__dirname, "../../prisma/migrations/20261010140000_mevzuat_bordro/migration.sql"), "utf8");
export const ILK_DOLUM_KAYITLARI = [...sql.matchAll(/'bordro_parametreleri', 'genel', '(\{.*?\})'::jsonb/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
/** 2026 Mayıs–Aralık bordro parametreleri (hesap biçiminde). */
export const PARAMETRELER_2026_2 = bordroParametreleri(ILK_DOLUM_KAYITLARI[1]);
