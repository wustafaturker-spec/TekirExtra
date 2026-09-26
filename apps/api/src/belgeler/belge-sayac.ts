import type { BelgeTur, BelgeYon, Prisma } from "@prisma/client";

/**
 * Belge sayacını bir ilerletir ve yeni sırayı döndürür. Sayaç tür, yön, seri
 * ve yıl başınadır: satış irsaliyesinin giden e-İrsaliye serisi (seri boş),
 * kâğıt irsaliye (EBLG-83) ve alış irsaliyesi (FTR-27) birbirinin sırasını
 * tüketmez.
 */
export async function belgeSirasiAl(
  tx: Prisma.TransactionClient,
  anahtar: { tenantId: string; tur: BelgeTur; yon: BelgeYon; seri?: string; yil: number },
): Promise<number> {
  const kayit = { ...anahtar, seri: anahtar.seri ?? "" };
  const sayac = await tx.belgeSayac.upsert({
    where: { tenantId_tur_yon_seri_yil: kayit },
    create: { ...kayit, sonSira: 1 },
    update: { sonSira: { increment: 1 } },
  });
  return sayac.sonSira;
}

/** GİB e-İrsaliye numarası 16 karakterdir: 3 harf önek + 4 hane yıl + 9 hane sıra. */
export function eirsaliyeNumarasi(onek: string, yil: number, sira: number): string {
  return `${onek}${yil}${String(sira).padStart(9, "0")}`;
}

/**
 * EBLG-97: numara almış ama entegratöre hiç ulaşmamış (referanssız, hatalı)
 * e-İrsaliyenin numarası bağlantıdaki önekle uyuşmuyorsa serbesttir: seri
 * yanlış ayarlanmıştı, numara GİB'e gitmedi ve önek düzeltilince belge yeni
 * seriden numara alır.
 */
export function eirsaliyeNumarasiSerbestMi(
  no: string,
  onek: string,
  kayit: { durum: string; entegratorRef: string | null } | null | undefined,
): boolean {
  return !no.startsWith(onek) && kayit?.durum === "hata" && !kayit.entegratorRef;
}

/**
 * Serbest kalan numara sayacın son verdiği numaraysa sayaç geri alınır; yeni
 * seri 1'den başlar, seride boşluk kalmaz. Arada başka numara verildiyse sayaç
 * olduğu gibi kalır (o numara zaten GİB'e gitmedi, eski önekte kalır).
 */
export async function eirsaliyeNumarasiniGeriAl(tx: Prisma.TransactionClient, girdi: { tenantId: string; yil: number; no: string }): Promise<void> {
  const sira = Number(girdi.no.slice(-9));
  if (!Number.isInteger(sira) || sira < 1) return;
  await tx.belgeSayac.updateMany({
    where: { tenantId: girdi.tenantId, tur: "irsaliye", yon: "satis", seri: "", yil: girdi.yil, sonSira: sira },
    data: { sonSira: { decrement: 1 } },
  });
}

/** NES'in "otomatik seriye numara verilemez" reddine yapılacak işi ekler (EBLG-97). */
export function seriHatasiAciklamasi(mesaj: string | undefined): string | undefined {
  if (!mesaj || !/OTOMATIK NUMARALANDIRILAN SERIDIR/i.test(mesaj)) return mesaj;
  return `${mesaj} — Bağlantıdaki e-İrsaliye serisi entegratörde otomatik numaralı. Ayarlar › Entegratörler'de elle numaralı bir seri yazıp bağlantıyı yeniden etkinleştirin; yeniden gönderimde belge yeni seriden numara alır.`;
}
