import { NextRequest, NextResponse } from "next/server";
import { bugunTR, gunTR } from "@tekirextra/shared";

const iso = (tarih: Date) => gunTR(tarih);
function kurOku(xml: string, doviz: "USD" | "EUR") {
  const blok = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${doviz}"[\\s\\S]*?<\\/Currency>`))?.[0];
  const deger = blok?.match(/<ForexBuying>([^<]+)<\/ForexBuying>/)?.[1];
  const sayi = Number(deger?.replace(",", "."));
  return Number.isFinite(sayi) && sayi > 0 ? sayi : null;
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
      const xml = await yanit.text(); const USD = kurOku(xml, "USD"); const EUR = kurOku(xml, "EUR");
      if (USD && EUR) return NextResponse.json({ kaynak: "TCMB_XML", istenenTarih: tarihMetni, kurTarihi: iso(gun), oncekiIsGunuKullanildi: iso(gun) !== tarihMetni, kurlar: { USD, EUR } });
    } catch { /* önceki güne devam */ }
  }
  return NextResponse.json({ message: "TCMB kur dosyasına ulaşılamadı" }, { status: 502 });
}
