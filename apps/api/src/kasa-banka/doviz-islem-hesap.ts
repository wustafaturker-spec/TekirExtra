/**
 * P1-2a: döviz alım/satımının TL karşılıkları ve kambiyo farkı.
 * Döviz bacakları TCMB alış kuruyla, TL bacağı kendi tutarıyla değerlenir;
 * fark = giren TL karşılığı − çıkan TL karşılığı (artı kâr, eksi zarar).
 * Banka kuru bilgi içindir: TL'li işlemde 1 döviz kaç TL'ye alındı/satıldı,
 * iki döviz arasında 1 çıkan birim kaç giren birim etti.
 */
import { Prisma } from "@prisma/client";

export interface DovizIslemGirdisi {
  cikanTutar: Prisma.Decimal;
  cikanDoviz: string;
  cikanKur: Prisma.Decimal;
  girenTutar: Prisma.Decimal;
  girenDoviz: string;
  girenKur: Prisma.Decimal;
}

export function dovizIslemHesapla(g: DovizIslemGirdisi) {
  const cikanTry = g.cikanTutar.mul(g.cikanKur).toDecimalPlaces(2);
  const girenTry = g.girenTutar.mul(g.girenKur).toDecimalPlaces(2);
  const fark = girenTry.sub(cikanTry);
  let bankaKuru: Prisma.Decimal;
  let kurAciklamasi: string;
  if (g.girenDoviz === "TRY") {
    bankaKuru = g.girenTutar.div(g.cikanTutar).toDecimalPlaces(6);
    kurAciklamasi = `1 ${g.cikanDoviz} = ${bankaKuru.toFixed(4)} TL (satış)`;
  } else if (g.cikanDoviz === "TRY") {
    bankaKuru = g.cikanTutar.div(g.girenTutar).toDecimalPlaces(6);
    kurAciklamasi = `1 ${g.girenDoviz} = ${bankaKuru.toFixed(4)} TL (alış)`;
  } else {
    bankaKuru = g.girenTutar.div(g.cikanTutar).toDecimalPlaces(6);
    kurAciklamasi = `1 ${g.cikanDoviz} = ${bankaKuru.toFixed(4)} ${g.girenDoviz} (çapraz)`;
  }
  return { cikanTry, girenTry, fark, bankaKuru, kurAciklamasi };
}
