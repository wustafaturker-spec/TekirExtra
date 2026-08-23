import { coz, sifrele } from "../core/kripto";

const ON_EK = "enc:v1:";

export function hassasSifrele(deger: string | null | undefined): string | null {
  if (!deger) return null;
  return deger.startsWith(ON_EK) ? deger : `${ON_EK}${sifrele(deger)}`;
}
export function hassasCoz(deger: string | null | undefined): string | null {
  if (!deger) return null;
  return deger.startsWith(ON_EK) ? coz(deger.slice(ON_EK.length)) : deger;
}
export function tcknMaskele(deger: string | null | undefined): string | null {
  const acik = hassasCoz(deger); return acik ? `${"*".repeat(Math.max(0, acik.length - 4))}${acik.slice(-4)}` : null;
}
export function ibanMaskele(deger: string | null | undefined): string | null {
  const acik = hassasCoz(deger); return acik ? `${acik.slice(0, 4)} •••• •••• ${acik.slice(-4)}` : null;
}
export function personelMaskele<T extends { tckn?: string | null; iban?: string | null }>(personel: T): T {
  return { ...personel, tckn: tcknMaskele(personel.tckn), iban: ibanMaskele(personel.iban) };
}
