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

/**
 * e-İrsaliye sayacının seri anahtarı. GİB'de sıra seri (önek) ve yıl
 * başınadır; sayaç önekten bağımsız tutulunca önek değişince yeni seri 1'den
 * değil eski serinin kaldığı yerden başlıyordu (TEKİREXTRA2: IRS→TK0, TK0
 * serisi 002'den başladı, 2026-09-26). Kâğıt irsaliyenin "KIR" anahtarıyla
 * çakışmasın diye ön ek taşır.
 */
export const eirsaliyeSayacSerisi = (onek: string) => `EIRS:${onek}`;

const EIRSALIYE_NO_BOYU = 16;

/**
 * e-İrsaliye sırasını önek + yıl sayacından alır. Önek ilk kez kullanılıyorsa
 * sayaç o önek ve yılla kesilmiş belgelerin en büyük sırasından başlar (seri
 * başka entegratörden ya da eski sayaçtan devralınmış olabilir); belge yoksa
 * 1'den.
 */
export async function eirsaliyeSirasiAl(tx: Prisma.TransactionClient, girdi: { tenantId: string; onek: string; yil: number }): Promise<number> {
  const anahtar = { tenantId: girdi.tenantId, tur: "irsaliye" as const, yon: "satis" as const, seri: eirsaliyeSayacSerisi(girdi.onek), yil: girdi.yil };
  const mevcut = await tx.belgeSayac.findUnique({ where: { tenantId_tur_yon_seri_yil: anahtar }, select: { id: true } });
  if (!mevcut) {
    const onEk = `${girdi.onek}${girdi.yil}`;
    const belgeler = await tx.belge.findMany({ where: { tenantId: girdi.tenantId, tur: "irsaliye", no: { startsWith: onEk } }, select: { no: true } });
    const son = Math.max(0, ...belgeler.flatMap((b) => (b.no && b.no.length === EIRSALIYE_NO_BOYU ? [Number(b.no.slice(onEk.length))] : [])).filter(Number.isInteger));
    await tx.belgeSayac.create({ data: { ...anahtar, sonSira: son } });
  }
  const sayac = await tx.belgeSayac.update({ where: { tenantId_tur_yon_seri_yil: anahtar }, data: { sonSira: { increment: 1 } } });
  return sayac.sonSira;
}

/** EBLG-93: seri sayacının son verdiği sıra (yoksa null). */
export async function eirsaliyeSayacSonSira(tx: Prisma.TransactionClient, girdi: { tenantId: string; onek: string; yil: number }): Promise<number | null> {
  const sayac = await tx.belgeSayac.findUnique({
    where: { tenantId_tur_yon_seri_yil: { tenantId: girdi.tenantId, tur: "irsaliye", yon: "satis", seri: eirsaliyeSayacSerisi(girdi.onek), yil: girdi.yil } },
    select: { sonSira: true },
  });
  return sayac?.sonSira ?? null;
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
  if (!Number.isInteger(sira) || sira < 1 || girdi.no.length !== EIRSALIYE_NO_BOYU) return;
  // Numara kendi öneki sayacından verilmişti; eski (önekten bağımsız) sayaçla
  // verilmiş numaralar için boş anahtar da denenir.
  await tx.belgeSayac.updateMany({
    where: { tenantId: girdi.tenantId, tur: "irsaliye", yon: "satis", seri: { in: [eirsaliyeSayacSerisi(girdi.no.slice(0, 3)), ""] }, yil: girdi.yil, sonSira: sira },
    data: { sonSira: { decrement: 1 } },
  });
}

/** NES'in "otomatik seriye numara verilemez" reddine yapılacak işi ekler (EBLG-97). */
export function seriHatasiAciklamasi(mesaj: string | undefined): string | undefined {
  if (!mesaj || !/OTOMATIK NUMARALANDIRILAN SERIDIR/i.test(mesaj)) return mesaj;
  return `${mesaj} — Bağlantıdaki e-İrsaliye serisi entegratörde otomatik numaralı. Ayarlar › Entegratörler'de elle numaralı bir seri yazıp bağlantıyı yeniden etkinleştirin; yeniden gönderimde belge yeni seriden numara alır.`;
}
