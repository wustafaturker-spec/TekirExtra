import { describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import { PlatformFirmaService } from "./platform-firma.service";

function kur(hata?: string) {
  const olaylar: { olay: string; detay: unknown; kullaniciId: string }[] = [];
  const db = {
    $queryRaw: vi.fn(async () => {
      if (hata) throw new Error(`Raw query failed. Message: ERROR: ${hata}`);
      return [{ tenant_id: "t1", unvan: "ÖRNEK A.Ş. ", vkn: "1", kayit_tarihi: new Date(), plan_kodu: "v1", durum: "aktif", donem_sonu: null, iptal_tarihi: null, aktif_kullanici: 3n, son_giris: null, ebelge_saglayici: "nes", bekleyen_talep_id: "r1", bekleyen_plan: "kurumsal" }];
    }),
    $executeRaw: vi.fn(async () => { if (hata) throw new Error(`ERROR: ${hata}`); return 1; }),
    mevzuatOlay: { create: vi.fn(async ({ data }: { data: { olay: string; detay: unknown; kullaniciId: string } }) => { olaylar.push(data); return data; }) },
  };
  const erisim = { unut: vi.fn() };
  const servis = new PlatformFirmaService({ db } as never, erisim as never);
  const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "ekip@tekirextra.com" }, is);
  return { servis, db, olaylar, erisim, olarak };
}

describe("platform firma yönetimi (platform P0-1 / P1-1)", () => {
  it("listede plan adları okunur; bekleyen talep ayrı alan", async () => {
    const [f] = await kur().servis.listele();
    expect(f).toMatchObject({ tenantId: "t1", unvan: "ÖRNEK A.Ş.", planAdi: "Profesyonel (eski kayıt)", aktifKullanici: 3, bekleyenTalep: { id: "r1", istenenPlanAdi: "Kurumsal" } });
  });

  it("askıya alma olay kaydı yazar, nedeni platform kullanıcısıyla geçmişe taşır, erişim önbelleğini tazeler", async () => {
    const k = kur();
    await k.olarak(() => k.servis.durumDegistir("t1", "askida", "Ödeme 30 gün gecikti"));
    expect(JSON.stringify(k.db.$executeRaw.mock.calls[0])).toContain("Askıya alındı (ekip@tekirextra.com): Ödeme 30 gün gecikti");
    expect(k.olaylar).toEqual([{ kullaniciId: "p1", olay: "firma_askiya_alindi", detay: { tenantId: "t1", neden: "Ödeme 30 gün gecikti" } }]);
    expect(k.erisim.unut).toHaveBeenCalledWith("t1");
  });

  it("katalogda olmayan plan reddedilir, veritabanına gidilmez", async () => {
    const k = kur();
    await expect(k.olarak(() => k.servis.planDegistir("t1", "sinirsiz-bedava", "deneme"))).rejects.toThrow(/Geçersiz plan/);
    expect(k.db.$executeRaw).not.toHaveBeenCalled();
  });

  it("veritabanı hataları anlamlı HTTP hatasına çevrilir", async () => {
    const a = kur("firma_yok");
    await expect(a.olarak(() => a.servis.durumDegistir("t9", "aktif", "geri açılış"))).rejects.toMatchObject({ status: 404 });
    const b = kur("talep_bekliyor_degil");
    await expect(b.olarak(() => b.servis.talepKarar("r1", true, null))).rejects.toMatchObject({ status: 409 });
    expect(b.olaylar).toEqual([]);
  });
});
