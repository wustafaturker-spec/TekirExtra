import { NextRequest, NextResponse } from "next/server";
import { bugunTR, gunTR, YABANCI_DOVIZLER } from "@tekirextra/shared";

const iso = (tarih: Date) => gunTR(tarih);
/** Döviz alış kuru; TCMB'nin 100 birim için verdiği (JPY gibi) birime bölünür. */
function kurOku(xml: string, doviz: string) {
  const blok = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${doviz}"[\\s\\S]*?<\\/Currency>`))?.[0];
  const deger = blok?.match(/<ForexBuying>([^<]+)<\/ForexBuying>/)?.[1];
  const birim = Number(blok?.match(/<Unit>([^<]+)<\/Unit>/)?.[1] ?? 1) || 1;
  const sayi = Number(deger?.replace(",", "."));
  return Number.isFinite(sayi) && sayi > 0 ? Number((sayi / birim).toFixed(6)) : null;
}

export async function GET(istek: NextRequest) {
  const tarihMetni = istek.nextUrl.searchParams.get("tarih") ?? bugunTR();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarihMetni)) return NextResponse.json({ message: "Geçersiz tarih" }, { status: 400 });
  const hedef = new Date(`${tarihMetni}T00:00:00.000Z`);
  for (let geri = 0; geri <= 10; geri++) {
    const gun = new Date(hedef); gun.setUTCDate(gun.getUTCDate() - geri);
    const yil = gun.getUTCFullYear(); const ay = String(gun.getUTCMonth() + 1).padStart(2, "0");
    const kod = `${String(gun.getUTCDate()).padStart(2, "0")}${ay}${yil}`;
    try {
      const yanit = await fetch(`https://www.tcmb.gov.tr/kurlar/${yil}${ay}/${kod}.xml`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!yanit.ok) continue;
      const xml = await yanit.text();
      const kurlar = Object.fromEntries(YABANCI_DOVIZLER.flatMap((d) => { const k = kurOku(xml, d); return k ? [[d, k]] : []; }));
      if (kurlar.USD && kurlar.EUR) return NextResponse.json({ kaynak: "TCMB_XML", istenenTarih: tarihMetni, kurTarihi: iso(gun), oncekiIsGunuKullanildi: iso(gun) !== tarihMetni, kurlar });
    } catch { /* önceki güne devam */ }
  }
  return NextResponse.json({ message: "TCMB kur dosyasına ulaşılamadı" }, { status: 502 });
}
