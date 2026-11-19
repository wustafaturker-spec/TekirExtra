import { Prisma } from "@prisma/client";
import { ayBasiTR, gunEkleTR, gunTR, type TahsilatDonemi } from "@tekirextra/shared";

export function tahsilatDonemAraligi(donem: TahsilatDonemi, an = new Date()) {
  const bugun = gunTR(an);
  switch (donem) {
    case "bugun": return { baslangic: bugun, bitis: bugun };
    case "dun": {
      const dun = gunEkleTR(-1, an);
      return { baslangic: dun, bitis: dun };
    }
    case "bu_hafta": {
      const gun = new Date(`${bugun}T00:00:00Z`).getUTCDay();
      return { baslangic: gunEkleTR(-((gun + 6) % 7), an), bitis: bugun };
    }
    case "bu_ay": return { baslangic: ayBasiTR(an), bitis: bugun };
  }
}

type TahsilatTarihi = Date | { gte: Date; lte: Date };

export function tahsilatHareketFiltresi(tenantId: string, tarih: TahsilatTarihi): Prisma.KasaBankaHareketWhereInput {
  return { tenantId, tarih, tip: "tahsilat", kaynakTur: { not: "acilis" } };
}

export function tahsilatCekFiltresi(tenantId: string, islemTarihi: TahsilatTarihi): Prisma.CekSenetWhereInput {
  return { tenantId, islemTarihi, yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "tahsil_edildi"] } };
}

export function tahsilatTopla<Cek extends { id: string; tutarTry: Prisma.Decimal }>(
  hareketler: readonly { kaynakRef: string | null; tutarTry: Prisma.Decimal }[],
  cekler: readonly Cek[],
) {
  const hareketKaynaklari = new Set(hareketler.map((hareket) => hareket.kaynakRef));
  // Seçili dönemde kasa/banka hareketi bulunan çekin portföy kaydı tekrar sayılmaz.
  const yeniCekler = cekler.filter((cek) => !hareketKaynaklari.has(cek.id));
  const hareketToplami = hareketler.reduce((toplam, hareket) => toplam.add(hareket.tutarTry), new Prisma.Decimal(0));
  const toplam = yeniCekler.reduce((araToplam, cek) => araToplam.add(cek.tutarTry), hareketToplami);
  return { toplam: toplam.toFixed(2), adet: hareketler.length + yeniCekler.length, yeniCekler };
}

export function tahsilatDonemiTopla(
  hareketler: readonly { kaynakRef: string | null; tutarTry: Prisma.Decimal; tarih: Date }[],
  cekler: readonly { id: string; tutarTry: Prisma.Decimal; islemTarihi: Date }[],
  tarih: { gte: Date; lte: Date },
) {
  const { toplam, adet, yeniCekler } = tahsilatTopla(hareketler, cekler);
  const gunluk = new Map<string, Prisma.Decimal>();
  function ekle(gun: Date, tutar: Prisma.Decimal) {
    const anahtar = gun.toISOString().slice(0, 10);
    gunluk.set(anahtar, (gunluk.get(anahtar) ?? new Prisma.Decimal(0)).add(tutar));
  }

  for (const hareket of hareketler) ekle(hareket.tarih, hareket.tutarTry);
  for (const cek of yeniCekler) ekle(cek.islemTarihi, cek.tutarTry);

  const gunler = [];
  for (let an = tarih.gte.getTime(); an <= tarih.lte.getTime(); an += 86_400_000) {
    const gun = new Date(an).toISOString().slice(0, 10);
    gunler.push({ tarih: gun, tutar: gunluk.get(gun)?.toFixed(2) ?? "0.00" });
  }
  return { toplam, adet, gunler };
}
