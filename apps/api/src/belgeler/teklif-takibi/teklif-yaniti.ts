import type { Prisma } from "@prisma/client";
import { ACIK_TAKIP, konudaNumaraVar } from "./teklif-takip.kurallari";

type Tx = Prisma.TransactionClient;

/**
 * AI-39: gelen e-postayı gönderilmiş bir teklifin yanıtı olarak eşleştirir;
 * model kullanılmaz. Önce yanıt başlıkları (In-Reply-To/References bir gönderim
 * kimliğini içeriyorsa kesin), yoksa konu: teklif numarası geçiyor ve gönderen
 * o teklifin carisine (kart ya da ilgili kişi) ait; aday tekse eşleşir.
 * Eşleşen yanıt takibi "yanıt geldi" yapar ve takip görevini tamamlar.
 */
export async function teklifYanitiniEslestir(
  tx: Tx,
  tenantId: string,
  e: { id: string; konu: string; gonderenEposta: string; yanitlananMesajIdleri: string[]; tarih: Date },
): Promise<{ belgeId: string; yontem: "baslik" | "konu" } | null> {
  let takip: { id: string; belgeId: string; durum: string; crmGorevId: string | null } | null = null;
  let yontem: "baslik" | "konu" = "baslik";
  if (e.yanitlananMesajIdleri.length) {
    takip = await tx.teklifTakibi.findFirst({
      where: { tenantId, mesajIdleri: { hasSome: e.yanitlananMesajIdleri } },
      select: { id: true, belgeId: true, durum: true, crmGorevId: true },
    });
  }
  if (!takip && e.gonderenEposta.trim()) {
    yontem = "konu";
    const adres = e.gonderenEposta.trim();
    const adaylar = await tx.teklifTakibi.findMany({
      where: {
        tenantId, durum: { in: ACIK_TAKIP },
        belge: { cari: { OR: [{ eposta: { equals: adres, mode: "insensitive" } }, { kisiler: { some: { eposta: { equals: adres, mode: "insensitive" } } } }] } },
      },
      select: { id: true, belgeId: true, durum: true, crmGorevId: true, belge: { select: { no: true } } },
      take: 50,
    });
    const konudakiler = adaylar.filter((a) => a.belge.no && konudaNumaraVar(e.konu, a.belge.no));
    if (konudakiler.length === 1) takip = konudakiler[0];
  }
  if (!takip) return null;

  await tx.gelenEposta.update({ where: { id: e.id }, data: { teklifBelgeId: takip.belgeId } });
  if (takip.durum !== "kapandi") {
    await tx.teklifTakibi.update({ where: { id: takip.id }, data: { durum: "yanit_geldi", yanitEpostaId: e.id, yanitAt: e.tarih, updatedAt: new Date() } });
    if (takip.crmGorevId) {
      await tx.crmGorev.updateMany({ where: { id: takip.crmGorevId, tenantId, durum: "acik" }, data: { durum: "tamamlandi", tamamlanmaZamani: new Date() } });
    }
  }
  return { belgeId: takip.belgeId, yontem };
}
