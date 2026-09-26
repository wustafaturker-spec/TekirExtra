import type { EntegratorConfig, SeriTanimi } from "@tekirextra/baglanti";

/**
 * EBLG-97: bağlantıdaki seri önekleri entegratördeki seri tanımlarına uymalı.
 * e-Fatura, e-Arşiv ve e-İrsaliye yanıtında numarayı entegratör verir, seri
 * otomatik olmalı; e-İrsaliye'de numarayı biz veririz (EBLG-83), seri elle
 * numaralı olmalı. Uymayan önek gönderimde entegratörden şematron hatası
 * olarak dönüyordu (TEKİREXTRA2, IRS2026000000001: "OTOMATIK NUMARALANDIRILAN
 * SERIDIR", 2026-09-25).
 */
const KURALLAR: { alan: keyof EntegratorConfig; tur: SeriTanimi["tur"]; ad: string; otomatik: boolean }[] = [
  { alan: "belgeSeriOneki", tur: "efatura", ad: "e-Fatura", otomatik: true },
  { alan: "earsivSeriOneki", tur: "earsiv", ad: "e-Arşiv", otomatik: true },
  { alan: "eirsaliyeSeriOneki", tur: "eirsaliye", ad: "e-İrsaliye", otomatik: false },
  { alan: "eirsaliyeYanitSeriOneki", tur: "eirsaliye_yanit", ad: "e-İrsaliye yanıt", otomatik: true },
];

const TUR_ADI: Record<SeriTanimi["tur"], string> = { efatura: "e-Fatura", earsiv: "e-Arşiv", eirsaliye: "e-İrsaliye", eirsaliye_yanit: "e-İrsaliye yanıt" };

export function seriEngelleri(cfg: EntegratorConfig, tanimlar: SeriTanimi[], secenek: { eirsaliyeKullanicisi: boolean | null }): string[] {
  const engeller: string[] = [];
  // e-İrsaliye kullanıcısı firmada önek zorunlu: boşken sessizce varsayılan
  // IRS kullanılıyordu ve o seri hesapta otomatik olabiliyordu.
  if (secenek.eirsaliyeKullanicisi !== false && !cfg.eirsaliyeSeriOneki?.trim()) {
    engeller.push("e-İrsaliye seri öneki girilmemiş; entegratörde elle numaralı bir e-İrsaliye serisi seçip öneki yazın");
  }
  for (const kural of KURALLAR) {
    const onek = (cfg[kural.alan] as string | undefined)?.trim();
    if (!onek) continue;
    const tanim = tanimlar.find((t) => t.tur === kural.tur && t.seri === onek);
    const yer = `${kural.ad} serisi ${onek}`;
    if (!tanim) {
      // Önek çoğu zaman portalda yanlış belge türünün altında açılmış oluyor
      // (TEKİREXTRA2: TKR e-Fatura'da, AST e-Arşiv'de tanımlıydı, 2026-09-25).
      const baska = [...new Set(tanimlar.filter((t) => t.seri === onek && t.tur !== kural.tur).map((t) => TUR_ADI[t.tur]))];
      engeller.push(baska.length
        ? `${yer} entegratörde ${kural.ad} serisi olarak tanımlı değil; ${baska.join(" ve ")} serisi olarak tanımlı. Seriyi portalda ${kural.ad} bölümünde açın`
        : `${yer} entegratörde tanımlı değil`);
    } else if (!tanim.aktif) engeller.push(`${yer} entegratörde ${tanim.durum === "Deleted" ? "silinmiş" : "pasif"}`);
    else if (tanim.otomatik !== kural.otomatik) {
      engeller.push(kural.otomatik
        ? `${yer} entegratörde elle numaralı; ${kural.ad} için numarayı entegratörün verdiği otomatik bir seri gerekir`
        : `${yer} entegratörde otomatik numaralı; e-İrsaliye numarasını program verir, elle numaralı bir seri gerekir`);
    }
  }
  return engeller;
}
