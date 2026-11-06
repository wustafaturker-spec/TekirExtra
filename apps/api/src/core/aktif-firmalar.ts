import { PrismaClient } from "@prisma/client";

/**
 * BLD-11: tüm firmaları tarayan zamanlayıcıların ortak seçimi. Aktif firma her
 * çalışmada taranır; pasif firma saatte bir, firma kimliğinden türeyen dilimde
 * (saate eşit yayılır, yeniden başlatmada yığılmaz). Bildirim ve düzeltme
 * taramaları aynı kuralı kullanır.
 */

const SAAT_MS = 60 * 60 * 1000;

/** BLD-11: son bu kadar günde girişi ya da kaydı olan firma aktif sayılır. */
export const AKTIF_FIRMA_GUN = 7;

/** Firma kimliğinden kararlı dilim; pasif firmalar saate eşit yayılır. */
export function firmaDilimi(tenantId: string, dilimSayisi: number): number {
  let h = 0;
  for (let i = 0; i < tenantId.length; i++) h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
  return h % dilimSayisi;
}

/**
 * BLD-11: bu çalışmada taranacak firmalar. Aktifler her çalışmada; pasifler
 * yalnız kendi diliminde (aralık 5 dk ise 12 dilim → saatte bir).
 */
export function taranacakFirmalar(tumu: string[], aktifler: ReadonlySet<string>, aralikMs: number, simdiMs = Date.now()): { taranacak: string[]; aktif: number; pasifTaranan: number; atlanan: number } {
  const dilimSayisi = Math.max(1, Math.round(SAAT_MS / aralikMs));
  const dilim = Math.floor(simdiMs / aralikMs) % dilimSayisi;
  const taranacak: string[] = []; let aktif = 0; let pasifTaranan = 0;
  for (const id of tumu) {
    if (aktifler.has(id)) { aktif++; taranacak.push(id); }
    else if (firmaDilimi(id, dilimSayisi) === dilim) { pasifTaranan++; taranacak.push(id); }
  }
  return { taranacak, aktif, pasifTaranan, atlanan: tumu.length - taranacak.length };
}

/** Tüm firmalar ve aktif olanlar (son AKTIF_FIRMA_GUN günde giriş ya da kayıt); RLS dışı yönetim bağlantısıyla. */
export async function firmaListesiAl(isAdi: string): Promise<{ tumu: string[]; aktifler: Set<string> }> {
  const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
  if (!yonetimUrl) throw new Error(`${isAdi} için DATABASE_URL_MIGRATE tanımlı olmalıdır`);
  const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
  const sinir = new Date(Date.now() - AKTIF_FIRMA_GUN * 24 * SAAT_MS);
  try {
    const [tenantlar, girisler] = await Promise.all([
      yonetim.tenant.findMany({ select: { id: true, createdAt: true } }),
      yonetim.user.findMany({ where: { sonGirisAt: { gte: sinir } }, select: { tenantId: true }, distinct: ["tenantId"] }),
    ]);
    const aktifler = new Set(girisler.map((g) => g.tenantId));
    for (const t of tenantlar) if (t.createdAt >= sinir) aktifler.add(t.id);
    return { tumu: tenantlar.map((t) => t.id), aktifler };
  } finally {
    await yonetim.$disconnect();
  }
}
