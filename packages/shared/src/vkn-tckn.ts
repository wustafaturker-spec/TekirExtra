/**
 * VKN/TCKN format ve checksum doğrulaması (CARI-14).
 * VKN: 10 haneli vergi kimlik no; TCKN: 11 haneli T.C. kimlik no.
 */

export function vknGecerliMi(vkn: string): boolean {
  if (!/^\d{10}$/.test(vkn)) return false;
  const haneler = vkn.split("").map(Number);
  let toplam = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (haneler[i] + 10 - (i + 1)) % 10;
    let sonuc = (tmp * 2 ** (9 - i)) % 9;
    if (tmp !== 0 && sonuc === 0) sonuc = 9;
    toplam += sonuc;
  }
  return haneler[9] === (10 - (toplam % 10)) % 10;
}

export function tcknGecerliMi(tckn: string): boolean {
  if (!/^[1-9]\d{10}$/.test(tckn)) return false;
  const h = tckn.split("").map(Number);
  const tekler = h[0] + h[2] + h[4] + h[6] + h[8];
  const ciftler = h[1] + h[3] + h[5] + h[7];
  const onuncu = ((tekler * 7 - ciftler) % 10 + 10) % 10;
  const onbirinci = h.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return h[9] === onuncu && h[10] === onbirinci;
}

/** 10 hane → VKN, 11 hane → TCKN olarak doğrular. */
export function vknTcknGecerliMi(deger: string): boolean {
  if (deger.length === 10) return vknGecerliMi(deger);
  if (deger.length === 11) return tcknGecerliMi(deger);
  return false;
}
