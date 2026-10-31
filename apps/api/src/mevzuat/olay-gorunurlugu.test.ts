import { describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";
import type { MevzuatService } from "./mevzuat.service";
import { editorGorebilirMi, MEVZUAT_EDITOR_OLAYLARI, olayDetayiniMaskele } from "./olay-gorunurlugu";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import type { PlatformPrismaService } from "./platform-prisma.service";

/** PLT-26: inceleme sırasında `notIn` listesinin dışında kalıp editöre dönebilen yönetim olayları. */
const YONETIM_OLAYLARI = [
  "abonelik_saglayicisi_guncellendi", "abonelik_fatura_ayari_degisti",
  "platform_rolu_degisti", "platform_kullanicisi_acildi", "platform_kullanicisi_aktif_edildi", "platform_kullanicisi_pasife_alindi", "platform_kullanicisi_kuruldu",
  "platform_daveti_yenilendi", "platform_daveti_kabul_edildi", "platform_2fa_sifirlandi", "platform_2fa_yeniden_kuruldu",
  "destek_oturumu_acildi", "destek_oturumu_kapatildi", "destek_istegi",
  "giris", "giris_basarisiz", "sistem_alarmi", "kuyruk_isi_yeniden_denendi",
  // PLT-06'da zaten gizli olanlar
  "platform_gorevi_olusturuldu", "platform_gorevi_guncellendi", "firma_askiya_alindi", "firma_askidan_cikarildi", "firma_plani_degisti",
  "plan_talebi_onaylandi", "plan_talebi_reddedildi", "ai_tavani_degisti", "abonelik_odemesi_alindi", "tahsilat_hatirlatma", "tahsilat_ozeti",
];

const olarak = <T>(rol: "yonetici" | "mevzuat_editoru", is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "test@example.invalid", rol }, is);

function kur(olaylar: { olay: string; detay?: unknown }[] = []) {
  const db = {
    mevzuatOlay: { findMany: vi.fn(async (_q: unknown) => []) },
    platformKullanici: { findMany: vi.fn(async (_q: unknown) => [{ id: "p2", adSoyad: "Hazırlayan" }]) },
    mevzuatDegisiklik: {
      findUnique: vi.fn(async () => ({
        id: "d1", no: 7, durum: "yayinlandi", hazirlayanId: "p2", yururlukBaslangic: new Date("2027-01-01T00:00:00Z"),
        satirlar: [], kabulSenaryolari: [], hazirlayan: null, yayinlayan: null,
        olaylar: olaylar.map((o, i) => ({ id: `o${i}`, degisiklikId: "d1", kullaniciId: "p2", zaman: new Date(), detay: null, ...o })),
      })),
    },
  };
  return { db, servis: new PlatformMevzuatService({ db } as unknown as PlatformPrismaService, {} as MevzuatService) };
}

describe("PLT-26 — editör olay görünürlüğü", () => {
  it("yönetim, giriş, destek, finans ve sistem olaylarının hiçbiri editör listesinde değil", () => {
    for (const o of YONETIM_OLAYLARI) expect(editorGorebilirMi(o), o).toBe(false);
  });

  it("bilinmeyen yeni olay varsayılan olarak kapalıdır", () => {
    expect(editorGorebilirMi("yeni_bir_yonetim_olayi")).toBe(false);
    expect(editorGorebilirMi("")).toBe(false);
  });

  it("mevzuat yaşam döngüsü olayları editöre açıktır", () => {
    for (const o of ["olusturuldu", "satirlar_guncellendi", "onaya_gonderildi", "geri_cevrildi", "yayinlandi", "kabul_senaryolari_guncellendi", "mevzuat_gorevi_olusturuldu", "ilk_dolum"]) expect(editorGorebilirMi(o), o).toBe(true);
  });

  it("editörün denetim sorgusu veritabanında açık listeyle süzülür (sayfa ve sayı sızmaz)", async () => {
    const t = kur();
    await olarak("mevzuat_editoru", () => t.servis.olaylar(2, true));
    const sorgu = t.db.mevzuatOlay.findMany.mock.calls[0][0] as { where: { olay: { in: string[] } }; skip: number; take: number };
    expect(sorgu.where).toEqual({ olay: { in: [...MEVZUAT_EDITOR_OLAYLARI] } });
    expect(sorgu).toMatchObject({ skip: 100, take: 100 });
  });

  it("yöneticinin denetim sorgusu süzülmez", async () => {
    const t = kur();
    await olarak("yonetici", () => t.servis.olaylar(1, false));
    expect((t.db.mevzuatOlay.findMany.mock.calls[0][0] as { where: unknown }).where).toBeUndefined();
  });

  it("değişiklik detayındaki olay geçmişi editöre yalnız mevzuat olaylarını taşır", async () => {
    const olaylar = [{ olay: "olusturuldu" }, { olay: "platform_rolu_degisti" }, { olay: "yayinlandi" }, { olay: "bilinmeyen_olay" }];
    const editor = await olarak("mevzuat_editoru", () => kur(olaylar).servis.getir("d1"));
    expect(editor.olaylar.map((o) => o.olay)).toEqual(["olusturuldu", "yayinlandi"]);
    const yonetici = await olarak("yonetici", () => kur(olaylar).servis.getir("d1"));
    expect(yonetici.olaylar).toHaveLength(4);
  });

  it("olay ayrıntısındaki gizli alanlar hiçbir rolde dönmez", async () => {
    const t = kur([{ olay: "guncellendi", detay: { baslik: "KDV", apiKey: "sk-123", ic: { token: "abc", parolaHash: "x" } } }]);
    const d = await olarak("yonetici", () => t.servis.getir("d1"));
    expect(d.olaylar[0].detay).toEqual({ baslik: "KDV", apiKey: "•••", ic: { token: "•••", parolaHash: "•••" } });
  });
});

describe("olayDetayiniMaskele", () => {
  it("dizi ve iç içe nesnelerde çalışır, alan adlarını değil değerleri gizler", () => {
    expect(olayDetayiniMaskele({ degisenAlanlar: ["secretKey"], liste: [{ totpSecret: "s" }, { tutar: 5 }] })).toEqual({ degisenAlanlar: ["secretKey"], liste: [{ totpSecret: "•••" }, { tutar: 5 }] });
  });

  it("mevzuat anahtarı gibi sıradan alanlara dokunmaz", () => {
    expect(olayDetayiniMaskele({ anahtar: "asgari_ucret", tur: "kanuni_deger", deger: 1 })).toEqual({ anahtar: "asgari_ucret", tur: "kanuni_deger", deger: 1 });
    expect(olayDetayiniMaskele(null)).toBeNull();
  });
});
