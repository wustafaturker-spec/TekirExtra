import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ebelgeUygulamalariCoz, mukellefiyetCelismeleri, type EbelgeUygulamalari } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

/** Mükellef listesi bu süreden eskiyse "bilinmiyor" sayılır. */
const LISTE_TAZELIK_SURESI_MS = 48 * 60 * 60 * 1000;

/**
 * EBLG-77: firmanın kendi e-belge mükellefiyetleri. Firma ayarında elle
 * belirtilen değer önce gelir; boş bırakılanlar GİB mükellef listesinden
 * okunur. Liste hiç çekilmemişse ya da 48 saatten eskiyse durum "bilinmiyor"
 * olur — listeye güvenip sessizce "kayıtlı değil" saymak, e-Fatura mükellefi
 * alıcıya yanlış belge kesmek olurdu.
 */
@Injectable()
export class EbelgeUygulamalariService {
  constructor(private readonly prisma: PrismaService) {}

  /** İstek bağlamındaki kiracının uygulamaları. */
  async uygulamalar(): Promise<EbelgeUygulamalari> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => ebelgeUygulamalariniOku(tx, tenantId));
  }
}

/**
 * Açık işlemde kiracının uygulamalarını çözer. Servis dışından (guard,
 * denetleyici, gönderim akışı) da kullanılabilsin diye ayrı işlev.
 */
export async function ebelgeUygulamalariniOku(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<EbelgeUygulamalari> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { vkn: true, efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: true },
  });
  if (!tenant) {
    return ebelgeUygulamalariCoz({
      elle: { efatura: null, earsiv: null, eirsaliye: null },
      liste: { efatura: false, eirsaliye: false, guncel: false },
    });
  }
  return ebelgeUygulamalariCozTenant(tx, tenant);
}

export async function ebelgeUygulamalariCozTenant(
  tx: Prisma.TransactionClient,
  tenant: { vkn: string; efaturaMukellefi: boolean | null; earsivMukellefi: boolean | null; eirsaliyeMukellefi: boolean | null },
): Promise<EbelgeUygulamalari> {
  // Listeye yalnız elle belirtilmemiş uygulama için bakılır; hepsi elle
  // söylenmişse sorgu hiç yapılmaz (e-Arşiv kullanıcısında liste zaten boştur).
  const listeGerekli = tenant.efaturaMukellefi === null || tenant.eirsaliyeMukellefi === null;
  const liste = listeGerekli ? await listeDurumu(tx, tenant.vkn) : { efatura: false, eirsaliye: false, guncel: false };
  return ebelgeUygulamalariCoz({
    elle: { efatura: tenant.efaturaMukellefi, earsiv: tenant.earsivMukellefi, eirsaliye: tenant.eirsaliyeMukellefi },
    liste,
  });
}

/**
 * Firma ayarı "kayıtlı değiliz" derken GİB listesi aksini söylüyorsa firma
 * kartında gösterilecek uyarılar. Liste yalnız bir ayar "hayır" ise sorulur.
 */
export async function mukellefiyetCelismeleriniOku(
  tx: Prisma.TransactionClient,
  tenant: { vkn: string; efaturaMukellefi: boolean | null; eirsaliyeMukellefi: boolean | null },
): Promise<string[]> {
  if (tenant.efaturaMukellefi !== false && tenant.eirsaliyeMukellefi !== false) return [];
  return mukellefiyetCelismeleri({
    elle: { efatura: tenant.efaturaMukellefi, eirsaliye: tenant.eirsaliyeMukellefi },
    liste: await listeDurumu(tx, tenant.vkn),
  });
}

async function listeDurumu(tx: Prisma.TransactionClient, vkn: string) {
  const [efaturaKaydi, eirsaliyeKaydi, listeVar, senkron] = await Promise.all([
    tx.gibMukellef.findFirst({ where: { vknTckn: vkn, belgeTuru: "efatura" }, select: { vknTckn: true } }),
    tx.gibMukellef.findFirst({ where: { vknTckn: vkn, belgeTuru: "eirsaliye" }, select: { vknTckn: true } }),
    tx.gibMukellef.findFirst({ select: { vknTckn: true } }),
    tx.gibMukellefSenkron.findUnique({ where: { id: "tek" }, select: { sonSenkronAt: true } }),
  ]);
  return {
    efatura: Boolean(efaturaKaydi),
    eirsaliye: Boolean(eirsaliyeKaydi),
    guncel: Boolean(listeVar && senkron?.sonSenkronAt && Date.now() - senkron.sonSenkronAt.getTime() < LISTE_TAZELIK_SURESI_MS),
  };
}
