import type { OdemeSozu } from "@prisma/client";

/** İstek anahtarı/hash ve saklama ayrıntıları API yanıtına taşınmaz. */
export const odemeSozuGorunumu = (s: OdemeSozu) => ({
  id: s.id, cariId: s.cariId, faturaId: s.faturaId, dovizCinsi: s.dovizCinsi, tutar: s.tutar.toFixed(2),
  sozTarihi: s.sozTarihi.toISOString().slice(0, 10), verildigiZaman: s.verildigiZaman.toISOString(),
  olusturanUserId: s.olusturanUserId, aciklama: s.aciklama, kayitDurumu: s.kayitDurumu,
  sonlandirmaNedeni: s.sonlandirmaNedeni, surum: s.surum, oncekiSozId: s.oncekiSozId,
});
