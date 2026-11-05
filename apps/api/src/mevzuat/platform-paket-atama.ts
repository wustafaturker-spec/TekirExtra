import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { abonelikKosullariniOku, abonelikModulleriniOku } from "../tenant/abonelik-kosullari";
import { PAKET_MODUL_KODLARI } from "@tekirextra/shared";
import { paketFiyatEtkisi } from "./platform-paket-etki";

export interface PaketAtamaGirdisi { surumId: string; tenantIds: string[]; uygulamaTarihi: string | null; neden: string; uygulamaTuru?: "bugun" | "tarih" | "donem_sonu"; atamaKapsami?: "fiyat" | "kapsam" }
export interface PaketAtamaKaydi {
  id: string; uygulamaTarihi: string; sonOnayAt: string; neden: string; hedefSurumId: string;
  uygulamaTuru?: "bugun" | "tarih" | "donem_sonu"; uygulanacakAt?: string;
  atamaKapsami?: "fiyat" | "kapsam";
  veri: { hedefPlanKodu: string; hedefPaketAdi: string; hedefSurumNo: number; fiyatlandirma: unknown;
    kayitlar: { tenantId: string; unvan: string; abonelik: { plan_kodu: string; paket_surum_id: string; paket_kosullari: unknown }; hedefKosullar: unknown; kullanim?: Record<string, number> }[] };
}
export function atamaOnizlemesiniSun(r: PaketAtamaKaydi) {
  return { id: r.id, uygulamaTarihi: r.uygulamaTarihi, sonOnayAt: r.sonOnayAt, neden: r.neden, hedefSurumId: r.hedefSurumId,
    uygulamaTuru: r.uygulamaTuru ?? "bugun", uygulanacakAt: r.uygulanacakAt ?? null,
    atamaKapsami: r.atamaKapsami ?? "fiyat",
    hedefPaketAdi: r.veri.hedefPaketAdi, hedefSurumNo: r.veri.hedefSurumNo,
    kayitlar: r.veri.kayitlar.map((x) => {
      const a = { planKodu: x.abonelik.plan_kodu, paketSurumId: x.abonelik.paket_surum_id, paketKosullari: x.abonelik.paket_kosullari };
      const once = abonelikKosullariniOku(a);
      const sonra = abonelikKosullariniOku({ planKodu: r.veri.hedefPlanKodu, paketSurumId: r.hedefSurumId, paketKosullari: x.hedefKosullar });
      if (!once || !sonra) throw new BadRequestException("Atama önizlemesinin kayıtlı koşulları eksik.");
      const oncekiModuller = abonelikModulleriniOku(a) ?? [...PAKET_MODUL_KODLARI];
      const sonrakiModuller = sonra.semaSurumu === 2 ? sonra.kapsamSozlesmesi.moduller : oncekiModuller;
      return { tenantId: x.tenantId, unvan: x.unvan, kaynakSurumId: a.paketSurumId,
        kullanim: x.kullanim ?? null, oncekiModuller, sonrakiModuller,
        kapananModuller: oncekiModuller.filter((m) => !sonrakiModuller.includes(m)), acilanModuller: sonrakiModuller.filter((m) => !oncekiModuller.includes(m)),
        oncekiLimitler: once.limitler, sonrakiLimitler: sonra.limitler,
        oncekiDepolama: once.semaSurumu === 2 ? once.kapsamSozlesmesi.depolama ?? null : null,
        sonrakiDepolama: sonra.semaSurumu === 2 ? sonra.kapsamSozlesmesi.depolama ?? null : null,
        ...paketFiyatEtkisi(a, { planKodu: r.veri.hedefPlanKodu, fiyatlandirma: r.veri.fiyatlandirma }) };
    }),
  };
}

/** Yalnız tanınan işlev hataları çevrilir; bağlantı/SQL hataları gizlenmez. */
export function atamaHatasiniCevir(e: unknown): never {
  const hata = e as { meta?: { message?: string }; message?: string };
  const m = hata.meta?.message ?? hata.message ?? "";
  if (m.includes("istisna_onayli_fiyat_once_iptal")) throw new ConflictException("Paket değiştirmeden önce onaylı özel koşulları iptal edin.");
  if (m.includes("atama_yetki")) throw new ForbiddenException("Aktif platform yöneticisi yetkisi gerekir.");
  if (m.includes("atama_surum_yok") || m.includes("atama_onizleme_yok")) throw new NotFoundException("Paket sürümü veya size ait atama önizlemesi bulunamadı.");
  if (/atama_(kaynak_degisti|hedef_degisti|onizleme_suresi_doldu)/.test(m)) throw new ConflictException("Abonelik, hedef sürüm veya onay süresi değişti. Yeni bir atama önizlemesi hazırlayın.");
  if (/atama_plan_(cakismasi|kapali|uygulanmis)/.test(m)) throw new ConflictException("Firma için bekleyen bir plan var veya bu plan kapanmış. Planlı atamalar listesini inceleyin; gerekiyorsa mevcut planı iptal edip yeni önizleme hazırlayın.");
  const mesajlar: Record<string, string> = {
    atama_yalniz_bugun: "Bu atama akışı yalnız bugünün Türkiye tarihiyle uygulanabilir.",
    atama_neden: "Atama nedeni 5–1000 karakter olmalı.",
    atama_firma_secimi: "Birbirinden farklı 1–25 firma seçin.",
    atama_hedef_uygun_degil: "Yayınlanmış, fiyatlı ve kapsam sözleşmesi olan bir sürüm seçin.",
    atama_fiyat_henuz_gecerli_degil: "Hedef sürümün fiyat geçerlilik tarihi henüz gelmedi.",
    atama_abonelik_yok: "Seçilen firmanın abonelik kaydı yok.",
    atama_abonelik_uygun_degil: "Yalnız kayıtlı fiyatı olan aktif veya deneme abonelikleri atanabilir.",
    atama_zaten_hedefte: "Seçilen firma zaten hedef sürümde.",
    atama_donem_eksik: "Hedef sürüm, mevcut aboneliğin tüm fiyat dönemlerini içermeli.",
    atama_plan_tarih: "İleri tarih yarından başlayarak en çok 366 gün sonrası olabilir.",
    atama_plan_tek_firma: "Dönem sonunda uygulamak için tek firma seçin; uygulama tarihini sunucu belirler.",
    atama_plan_donem: "Firmanın gelecek 366 gün içinde geçerli bir dönem sonu bulunmalı.",
    atama_plan_tur: "Geçerli bir uygulama türü seçin.",
    atama_kapsam_desteklenmiyor: "Bu sürüm erişim ve kota sözleşmesi içeriyor. Kapsam ataması seçerek modül, kota ve fiyat değişikliğini birlikte onaylayın.",
    atama_kapsam_eksik: "Kapsam ataması için yayınlanmış bir modül ve kota sözleşmesi gerekir.",
    atama_kota_asimi: "Mevcut kullanım hedef kotanın üzerinde. Önce kullanımı azaltın veya hedef kotayı artırın.",
    atama_depolama_asimi: "Dosyalar ve devam eden yüklemeler hedef depolama sınırını aşıyor.",
  };
  for (const [kod, mesaj] of Object.entries(mesajlar)) if (m.includes(kod)) throw new BadRequestException(mesaj);
  throw e;
}
