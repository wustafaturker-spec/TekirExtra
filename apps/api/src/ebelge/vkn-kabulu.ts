import type { EntegratorConfig } from "@tekirextra/baglanti";
import { vknTcknGecerliMi } from "@tekirextra/shared";
import { coz } from "../core/kripto";

/**
 * VKN/TCKN kabul kuralı (EBLG-47).
 *
 * Entegratörlerin test ortamları sentetik firma kimliği dağıtır ve bunlar VKN
 * kontrol hanesini tutmaz; gönderim bu yüzden test bağlantısında kontrol
 * hanesini aramaz. Aynı gevşetme cari kaydında da geçerli olmalıdır, yoksa
 * fatura kesebildiğimiz bir alıcıyı cari olarak kaydedemeyiz — kaydı elle
 * veritabanına yazmak gerekirdi. Kural tek yerde durur ki iki taraf ayrışmasın.
 *
 * Gevşeyen yalnız kontrol hanesidir: hane sayısı (10 = VKN, 11 = TCKN) her
 * ortamda aranır.
 */
export function vknTcknKabulEdilebilirMi(deger: string | null | undefined, testOrtami: boolean): deger is string {
  if (!deger || !/^\d{10}$|^\d{11}$/.test(deger)) return false;
  return vknTcknGecerliMi(deger) || testOrtami;
}

/** Kiracının aktif e-belge bağlantısı test ortamına mı bakıyor? Bağlantı yoksa hayır. */
export async function ebelgeTestOrtamiMi(
  tx: { baglanti: { findFirst(args: unknown): Promise<{ sifreliConfig: string } | null> } },
  tenantId: string,
): Promise<boolean> {
  const baglanti = await tx.baglanti.findFirst({
    where: { tenantId, aile: "ebelge", durum: "aktif" },
    select: { sifreliConfig: true },
  });
  if (!baglanti) return false;
  try {
    return Boolean((JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).testOrtami);
  } catch {
    return false;
  }
}
