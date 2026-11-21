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

/** Portföye alınmış ve henüz karşılıksız/iade olmamış çek ve senetler tahsilat sayılır. */
const TAHSILAT_CEK_DURUMLARI = ["portfoyde", "tahsile_verildi", "teminata_verildi", "tahsil_edildi"] as const;

export function tahsilatCekFiltresi(tenantId: string, islemTarihi: TahsilatTarihi): Prisma.CekSenetWhereInput {
  return { tenantId, islemTarihi, yon: "alinan", durum: { in: [...TAHSILAT_CEK_DURUMLARI] } };
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

export type TahsilatGunu = { gun: string; tutar: Prisma.Decimal; adet: number };

/**
 * Dönem tahsilatını gün gün veritabanında toplar; satırlar belleğe alınmaz (Rapor V-2).
 * Kurallar `tahsilatHareketFiltresi`, `tahsilatCekFiltresi` ve `tahsilatTopla` ile aynıdır:
 * açılış fişi sayılmaz, dönemde kasa/banka hareketi bulunan çek ikinci kez sayılmaz.
 */
export function tahsilatGunleriniOku(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  tenantId: string,
  aralik: { baslangic: string; bitis: string },
) {
  return tx.$queryRaw<TahsilatGunu[]>`
    WITH hareket AS (
      SELECT tarih, tutar_try, kaynak_ref FROM kasa_banka_hareketleri
      WHERE tenant_id = ${tenantId}::uuid AND tarih BETWEEN ${aralik.baslangic}::date AND ${aralik.bitis}::date
        AND tip = 'tahsilat' AND kaynak_tur <> 'acilis'
    )
    SELECT to_char(gun, 'YYYY-MM-DD') AS gun, SUM(tutar_try) AS tutar, COUNT(*)::int AS adet FROM (
      SELECT tarih AS gun, tutar_try FROM hareket
      UNION ALL
      SELECT c.islem_tarihi, c.tutar_try FROM cek_senetler c
      WHERE c.tenant_id = ${tenantId}::uuid AND c.islem_tarihi BETWEEN ${aralik.baslangic}::date AND ${aralik.bitis}::date
        AND c.yon = 'alinan' AND c.durum::text IN (${Prisma.join([...TAHSILAT_CEK_DURUMLARI])})
        AND NOT EXISTS (SELECT 1 FROM hareket h WHERE h.kaynak_ref = c.id::text)
    ) t
    GROUP BY gun ORDER BY gun`;
}

export function tahsilatDonemiTopla(satirlar: readonly TahsilatGunu[], aralik: { baslangic: string; bitis: string }) {
  const gunluk = new Map(satirlar.map((s) => [s.gun, new Prisma.Decimal(s.tutar)]));
  const toplam = satirlar.reduce((araToplam, s) => araToplam.add(s.tutar), new Prisma.Decimal(0));
  const adet = satirlar.reduce((araToplam, s) => araToplam + Number(s.adet), 0);
  const gunler = [];
  const son = new Date(`${aralik.bitis}T00:00:00Z`).getTime();
  for (let an = new Date(`${aralik.baslangic}T00:00:00Z`).getTime(); an <= son; an += 86_400_000) {
    const gun = new Date(an).toISOString().slice(0, 10);
    gunler.push({ tarih: gun, tutar: gunluk.get(gun)?.toFixed(2) ?? "0.00" });
  }
  return { toplam: toplam.toFixed(2), adet, gunler };
}
