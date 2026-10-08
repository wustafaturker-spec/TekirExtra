/**
 * PRS-25/26/28 (P3-3): onaylı bordronun hesap izinden MUHSGK hizmet satırı.
 * Hesap izi olmayan (net ücretli, mevzuat setsiz) bordro satırı uyarıyla
 * gösterilir; toplamlara ve APHB dosyasına girmez.
 */
import { Prisma } from "@prisma/client";
import { hesapOzetiTutari } from "./personel-rapor-yardimci";
import { EKSIK_GUN_KODU, KANUN_NO_DESENI, MESLEK_KODU_DESENI } from "./sgk-kodlari";
import type { AphbBildirge } from "./sgk-xml";

export const ONAYLI_BORDRO_DURUMLARI = ["onaylandi", "kismen_odendi", "odendi"] as const;

export interface HizmetGirdisi {
  personelId: string; personelNo: string; ad: string; soyad: string; tckn: string | null; belgeTuru: string; kanunNo: string; meslekKodu: string | null;
  primGunu: number; istihdamGunu: number; eksikGunNedeni: string | null; girisTarihi: string | null; cikisTarihi: string | null; cikisKodu: string | null;
  hesapOzeti: Prisma.JsonValue | null;
}

export interface HizmetSatiri {
  personelId: string; personelNo: string; adSoyad: string; ad: string; soyad: string; tckn: string | null; belgeTuru: string; kanunNo: string; meslekKodu: string | null;
  primGunu: number; eksikGunSayisi: number; eksikGunKodu: string | null; girisTarihi: string | null; cikisTarihi: string | null; cikisKodu: string | null;
  hesapIzi: boolean; uyarilar: string[];
  hakEdilenUcret: string; primIkramiye: string; pek: string; gayrisafi: string; gvMatrahi: string; hesaplananGv: string; asgariGvIstisnasi: string; kesilenGv: string;
  hesaplananDv: string; dvIstisnasi: string; kesilenDv: string; sgkIsci: string; issizlikIsci: string; isverenSgk: string; tesvikIndirimi: string; isverenSgkNet: string; isverenIssizlik: string;
}

const PARA_ALANLARI = ["hakEdilenUcret", "primIkramiye", "pek", "gayrisafi", "gvMatrahi", "hesaplananGv", "asgariGvIstisnasi", "kesilenGv", "hesaplananDv", "dvIstisnasi", "kesilenDv", "sgkIsci", "issizlikIsci", "isverenSgk", "tesvikIndirimi", "isverenSgkNet", "isverenIssizlik"] as const;
export type MuhsgkOzeti = Record<(typeof PARA_ALANLARI)[number], string> & { kisiSayisi: number; primGunu: number };

export function hizmetSatiri(g: HizmetGirdisi): HizmetSatiri {
  const oz = g.hesapOzeti;
  const hesapIzi = Boolean(oz && typeof oz === "object" && !Array.isArray(oz) && "primeEsasKazanc" in oz);
  const tut = (alan: string) => hesapOzetiTutari(oz, alan);
  const pek = tut("primeEsasKazanc");
  // SGK'ya tabi prim/ikramiye: PEK'e giren ücret dışı ödeme (cari ay + önceki aylardan devreden).
  const primIkramiye = Prisma.Decimal.min(pek, tut("sgkCariAyUcretDisiUygulanan").add(tut("sgkDevredenUygulanan")));
  const eksikGunSayisi = Math.max(0, g.istihdamGunu - g.primGunu);
  const eksikGunKodu = eksikGunSayisi > 0 && g.eksikGunNedeni ? EKSIK_GUN_KODU[g.eksikGunNedeni] ?? "13" : null;
  const uyarilar = [
    !hesapIzi && "Hesap izi yok (net ücretli ya da mevzuat setsiz bordro); toplamlara girmez",
    !g.tckn && "TCKN yok",
    !g.meslekKodu ? "Meslek kodu yok" : !MESLEK_KODU_DESENI.test(g.meslekKodu) && "Meslek kodu NNNN.NN biçiminde değil",
    !KANUN_NO_DESENI.test(g.kanunNo) && "Kanun no 5 hane olmalı",
    eksikGunSayisi > 0 && !eksikGunKodu && "Eksik gün nedeni girilmemiş",
    g.cikisTarihi && !g.cikisKodu && "SGK çıkış kodu yok",
  ].filter((u): u is string => Boolean(u));
  const s = (v: Prisma.Decimal) => (hesapIzi ? v.toFixed(2) : "0.00");
  return {
    personelId: g.personelId, personelNo: g.personelNo, adSoyad: `${g.ad} ${g.soyad}`, ad: g.ad, soyad: g.soyad, tckn: g.tckn, belgeTuru: g.belgeTuru, kanunNo: g.kanunNo, meslekKodu: g.meslekKodu,
    primGunu: g.primGunu, eksikGunSayisi, eksikGunKodu, girisTarihi: g.girisTarihi, cikisTarihi: g.cikisTarihi, cikisKodu: g.cikisKodu, hesapIzi, uyarilar,
    hakEdilenUcret: s(pek.sub(primIkramiye)), primIkramiye: s(primIkramiye), pek: s(pek), gayrisafi: s(tut("brutUcret").add(tut("ihbarTazminati")).add(tut("kidemTazminati"))),
    gvMatrahi: s(tut("gelirVergisiMatrahi")), hesaplananGv: s(tut("gelirVergisiBrut")), asgariGvIstisnasi: s(tut("asgariUcretGelirVergisiIstisnasi")), kesilenGv: s(tut("gelirVergisi")),
    hesaplananDv: s(tut("damgaVergisiBrut")), dvIstisnasi: s(tut("asgariUcretDamgaVergisiIstisnasi")), kesilenDv: s(tut("damgaVergisi")),
    sgkIsci: s(tut("sgkIsci")), issizlikIsci: s(tut("issizlikIsci")), isverenSgk: s(tut("isverenSgk")), tesvikIndirimi: s(tut("isverenSgkTesvikIndirimi")), isverenSgkNet: s(tut("isverenSgkNet")), isverenIssizlik: s(tut("isverenIssizlik")),
  };
}

/** Yalnız hesap izi olan satırların toplamı. */
export function muhsgkOzeti(satirlar: HizmetSatiri[]): MuhsgkOzeti {
  const izli = satirlar.filter((s) => s.hesapIzi);
  const toplam = Object.fromEntries(PARA_ALANLARI.map((a) => [a, izli.reduce((t, s) => t.add(s[a]), new Prisma.Decimal(0)).toFixed(2)])) as Record<(typeof PARA_ALANLARI)[number], string>;
  return { ...toplam, kisiSayisi: izli.length, primGunu: izli.reduce((t, s) => t + s.primGunu, 0) };
}

/** APHB'ye girmeyecek satırın nedeni; null ise dosyaya girer. */
export function aphbDisiNedeni(s: HizmetSatiri): string | null {
  if (!s.hesapIzi) return "hesap izi yok";
  if (!s.tckn) return "TCKN yok";
  if (!KANUN_NO_DESENI.test(s.kanunNo)) return "kanun no geçersiz";
  if (s.cikisTarihi && !s.cikisKodu) return "SGK çıkış kodu yok";
  return null;
}

/** Belge türü + kanun ikilisine göre gruplanmış APHB bildirgeleri (sıra personel no). */
export function aphbBildirgeleri(satirlar: HizmetSatiri[]): AphbBildirge[] {
  const gruplar = new Map<string, AphbBildirge>();
  for (const s of [...satirlar].sort((a, b) => a.personelNo.localeCompare(b.personelNo))) {
    if (aphbDisiNedeni(s)) continue;
    const anahtar = `${Number(s.belgeTuru)}|${s.kanunNo}`;
    const grup = gruplar.get(anahtar) ?? { belgeTuru: s.belgeTuru, kanun: s.kanunNo, sigortalilar: [] };
    grup.sigortalilar.push({ tckn: s.tckn!, ad: s.ad, soyad: s.soyad, pek: s.pek, primIkramiye: s.primIkramiye, gun: s.primGunu, girisTarihi: s.girisTarihi, cikisTarihi: s.cikisTarihi, eksikGunSayisi: s.eksikGunSayisi, eksikGunNedeni: s.eksikGunKodu, cikisKodu: s.cikisKodu, meslekKodu: s.meslekKodu && MESLEK_KODU_DESENI.test(s.meslekKodu) ? s.meslekKodu : null });
    gruplar.set(anahtar, grup);
  }
  return [...gruplar.values()].sort((a, b) => Number(a.belgeTuru) - Number(b.belgeTuru) || a.kanun.localeCompare(b.kanun));
}
