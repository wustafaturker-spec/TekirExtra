/**
 * Yönetim P1-4: denetim izine "ne değişti" yazmak için iki kaydın farkı.
 * Gizli alanların değeri yazılmaz, yalnız değiştiği belirtilir.
 */
export type Degisiklikler = Record<string, { eski: unknown; yeni: unknown }>;

export const GIZLI_DEGER = "•••";

const GIZLI_ALAN = /(parola|sifre|şifre|secret|token|anahtar|apikey|api_key|password|sifreli)/i;

function duz(deger: unknown, onek: string, cikti: Record<string, unknown>, derinlik: number): void {
  if (deger && typeof deger === "object" && !Array.isArray(deger) && !(deger instanceof Date) && derinlik < 3) {
    for (const [k, v] of Object.entries(deger as Record<string, unknown>)) duz(v, onek ? `${onek}.${k}` : k, cikti, derinlik + 1);
    return;
  }
  cikti[onek] = deger instanceof Date ? deger.toISOString() : deger;
}

function yaz(deger: unknown): unknown {
  if (deger === undefined) return null;
  if (typeof deger === "string" && deger.length > 300) return `${deger.slice(0, 300)}…`;
  // Dizi ve büyük nesneler tek alan olarak karşılaştırılır; denetim kaydı şişmesin.
  if (Array.isArray(deger)) return deger.length > 20 ? `[${deger.length} öğe]` : deger;
  if (typeof deger === "object" && deger !== null && !Array.isArray(deger)) {
    const metin = JSON.stringify(deger);
    return metin.length > 300 ? `${metin.slice(0, 300)}…` : deger;
  }
  return deger;
}

/**
 * Değişen alanlar (iç içe nesneler `a.b` yoluyla); fark yoksa boş nesne.
 * `gizli`: adı genel kalıba uymasa da değeri yazılmayacak alanlar (ör. kullanıcı adı).
 */
export function degisiklikleriBul(eski: unknown, yeni: unknown, secenek: { haric?: readonly string[]; gizli?: readonly string[] } = {}): Degisiklikler {
  const haric = secenek.haric ?? [];
  const gizliMi = (alan: string) => GIZLI_ALAN.test(alan) || (secenek.gizli ?? []).some((g) => alan === g || alan.endsWith(`.${g}`));
  const a: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  duz(eski ?? {}, "", a, 0);
  duz(yeni ?? {}, "", b, 0);
  const sonuc: Degisiklikler = {};
  for (const alan of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (haric.some((h) => alan === h || alan.startsWith(`${h}.`))) continue;
    if (JSON.stringify(a[alan] ?? null) === JSON.stringify(b[alan] ?? null)) continue;
    sonuc[alan] = gizliMi(alan)
      ? { eski: a[alan] == null || a[alan] === "" ? null : GIZLI_DEGER, yeni: b[alan] == null || b[alan] === "" ? null : GIZLI_DEGER }
      : { eski: yaz(a[alan]), yeni: yaz(b[alan]) };
  }
  return sonuc;
}
