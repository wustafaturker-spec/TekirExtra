import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { yerTutucuVar, hazirTakipMetni, isGunuEkle, kapanisNedeni, konudaNumaraVar, mesajKimligi, teklifAcikMi, yanitlananKimlikler } from "./teklif-takip.kurallari";
import { teklifYanitiniEslestir } from "./teklif-yaniti";
import { teklifGonderiminiKaydet } from "./teklif-takip.kayit";
import { TeklifTakipService } from "./teklif-takip.service";

describe("teklif takibi kuralları (AI-38…41)", () => {
  it("iş günü ekler: hafta sonu ve tam gün tatil atlanır, arife iş günüdür", () => {
    expect(isGunuEkle("2026-10-16", 3)).toBe("2026-10-21"); // cuma + 3 → çarşamba
    expect(isGunuEkle("2026-10-27", 3, new Map([["2026-10-29", 0], ["2026-10-28", 0.5]]))).toBe("2026-11-02");
    expect(isGunuEkle("2026-10-19", 0)).toBe("2026-10-19");
  });

  it("yanıt başlıklarından ileti kimliklerini toplar", () => {
    expect(yanitlananKimlikler("<a@x>", ["<b@x>", "<a@x>"])).toEqual(["<a@x>", "<b@x>"]);
    expect(yanitlananKimlikler(undefined, "<c@x> <d@x>")).toEqual(["<c@x>", "<d@x>"]);
    expect(yanitlananKimlikler("e@x", undefined)).toEqual(["<e@x>"]);
    expect(yanitlananKimlikler(undefined, undefined)).toEqual([]);
    expect(mesajKimligi("abc@smtp")).toBe("<abc@smtp>");
    expect(mesajKimligi("<abc@smtp>")).toBe("<abc@smtp>");
    expect(mesajKimligi(null)).toBeNull();
  });

  it("konuda teklif numarasını tam numara olarak arar", () => {
    expect(konudaNumaraVar("Re: Satış Teklifi TKF2026000023", "TKF2026000023")).toBe(true);
    expect(konudaNumaraVar("YNT: Satış Teklifi TKF2026000023-R1", "TKF2026000023")).toBe(true);
    expect(konudaNumaraVar("Re: TKF20260000231", "TKF2026000023")).toBe(false);
    expect(konudaNumaraVar("Re: teklif", "TKF2026000023")).toBe(false);
  });

  it("yalnız onaylı teklif açıktır; kapanış nedeni duruma göre", () => {
    expect(teklifAcikMi("onaylandi")).toBe(true);
    for (const d of ["taslak", "kismen_kapandi", "kapandi", "iptal", "revize_edildi"]) expect(teklifAcikMi(d)).toBe(false);
    expect(kapanisNedeni("kapandi")).toBe("Teklif siparişe dönüştü");
    expect(kapanisNedeni("revize_edildi")).toBe("Teklifin yeni sürümü açıldı");
  });

  it("hazır takip metni geçerliliği ve imzayı yazar; yer tutucu tanınır", () => {
    const m = hazirTakipMetni({ unvan: "A Ltd", no: "TKF1", gecerlilik: "31.10.2026", firma: "Tekir Ltd", gonderen: "Meral" }).metin;
    expect(m).toContain("31.10.2026 tarihine kadar geçerlidir");
    expect(m.endsWith("Meral\nTekir Ltd")).toBe(true);
    expect(yerTutucuVar("Saygılarımızla,\n[Şirket Adınız]")).toBe(true);
    expect(yerTutucuVar("TKF-2026-0022 numaralı teklif")).toBe(false);
  });
});

function yanitTx(o: { baslikla?: object | null; adaylar?: object[] } = {}) {
  return {
    teklifTakibi: {
      findFirst: vi.fn().mockResolvedValue(o.baslikla ?? null),
      findMany: vi.fn().mockResolvedValue(o.adaylar ?? []),
      update: vi.fn(),
    },
    gelenEposta: { update: vi.fn() },
    crmGorev: { updateMany: vi.fn() },
  };
}
const E = { id: "e1", konu: "Re: Satış Teklifi TKF2026000023", gonderenEposta: "ali@m.com", yanitlananMesajIdleri: ["<g1@smtp>"], tarih: new Date("2026-10-20T10:00:00Z") };

describe("teklif yanıtı eşleştirme (AI-39)", () => {
  it("yanıt başlığı gönderim kimliğini içeriyorsa kesin eşleşir, takip ve görev kapanır", async () => {
    const tx = yanitTx({ baslikla: { id: "t1", belgeId: "b1", durum: "hatirlatildi", crmGorevId: "g1" } });
    expect(await teklifYanitiniEslestir(tx as never, "t", E)).toEqual({ belgeId: "b1", yontem: "baslik" });
    expect(tx.gelenEposta.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { teklifBelgeId: "b1" } });
    expect(tx.teklifTakibi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "yanit_geldi", yanitEpostaId: "e1" }) }));
    expect(tx.crmGorev.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1", tenantId: "t", durum: "acik" } }));
  });

  it("başlık yoksa konu + gönderen carisiyle tek aday eşleşir; iki aday ya da numara yoksa eşleşmez", async () => {
    const tek = yanitTx({ adaylar: [{ id: "t1", belgeId: "b1", durum: "yanit_bekliyor", crmGorevId: null, belge: { no: "TKF2026000023" } }, { id: "t2", belgeId: "b2", durum: "yanit_bekliyor", crmGorevId: null, belge: { no: "TKF2026000024" } }] });
    expect(await teklifYanitiniEslestir(tek as never, "t", { ...E, yanitlananMesajIdleri: [] })).toEqual({ belgeId: "b1", yontem: "konu" });
    const yok = yanitTx({ adaylar: [{ id: "t1", belgeId: "b1", durum: "yanit_bekliyor", crmGorevId: null, belge: { no: "TKF2026000099" } }] });
    expect(await teklifYanitiniEslestir(yok as never, "t", { ...E, yanitlananMesajIdleri: [] })).toBeNull();
    expect(yok.gelenEposta.update).not.toHaveBeenCalled();
  });

  it("kapanmış takibin yanıtı e-postaya bağlanır ama takibi yeniden açmaz", async () => {
    const tx = yanitTx({ baslikla: { id: "t1", belgeId: "b1", durum: "kapandi", crmGorevId: null } });
    await teklifYanitiniEslestir(tx as never, "t", E);
    expect(tx.gelenEposta.update).toHaveBeenCalled();
    expect(tx.teklifTakibi.update).not.toHaveBeenCalled();
  });
});

describe("gönderim kaydı (AI-38)", () => {
  it("hatırlatma gününü ayar ve tatille kurar; yeniden gönderimde kimlik ekler, eski görevi tamamlar", async () => {
    const tx = {
      modulAyar: { findUnique: vi.fn().mockResolvedValue({ ayarlar: { acik: true, isGunu: 2, gecerlilikUyariGun: 2 } }) },
      personelTatilGunu: { findMany: vi.fn().mockResolvedValue([{ tarih: new Date("2026-10-19T00:00:00Z"), yarimGun: false }]) },
      teklifTakibi: { findUnique: vi.fn().mockResolvedValue({ id: "t1", crmGorevId: "g1", durum: "hatirlatildi" }), upsert: vi.fn() },
      crmGorev: { updateMany: vi.fn() },
    };
    await teklifGonderiminiKaydet(tx as never, "t", { belgeId: "b1", kaynak: "eposta", alici: "a@m.com", mesajId: "<m2@smtp>", sorumluUserId: "u1", zaman: new Date("2026-10-16T12:00:00Z") });
    const arg = tx.teklifTakibi.upsert.mock.calls[0][0];
    // cuma + 2 iş günü; pazartesi tatil → çarşamba
    expect(arg.create.hatirlatmaGunu).toEqual(new Date("2026-10-21T00:00:00Z"));
    expect(arg.update).toMatchObject({ durum: "yanit_bekliyor", mesajIdleri: { push: "<m2@smtp>" }, gonderimSayisi: { increment: 1 }, crmGorevId: null });
    expect(tx.crmGorev.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1", tenantId: "t", durum: "acik" } }));
  });
});

describe("takip taraması (AI-40/41)", () => {
  function kur(takipler: object[], ayar: object = { acik: true, isGunu: 3, gecerlilikUyariGun: 2 }) {
    const tx = {
      teklifTakibi: { findMany: vi.fn().mockResolvedValue(takipler), update: vi.fn() },
      modulAyar: { findUnique: vi.fn().mockResolvedValue({ ayarlar: ayar }) },
      personelTatilGunu: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "u1" }) },
      crmGorev: { create: vi.fn().mockResolvedValue({ id: "g9" }), updateMany: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) };
    const bildirim = { uret: vi.fn().mockResolvedValue({}) };
    const moduleRef = { get: () => bildirim };
    const s = new TeklifTakipService(prisma as never, {} as never, undefined, moduleRef as never);
    const calistir = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "00000000-0000-4000-8000-000000000000", rol: "yonetici" } }, fn);
    return { s, tx, bildirim, calistir };
  }
  const takip = (ek: object = {}, belge: object = {}) => ({
    id: "t1", belgeId: "b1", durum: "yanit_bekliyor", sorumluUserId: "u1", crmGorevId: null, gonderimSayisi: 1, alici: "a@m.com",
    gonderildiAt: new Date("2026-10-14T09:00:00Z"), hatirlatmaGunu: new Date("2026-10-19T00:00:00Z"), gecerlilikUyarisiAt: null, ...ek,
    belge: { id: "b1", durum: "onaylandi", no: "TKF2026000023", revizyonNo: 0, gecerlilikTarihi: null, cariId: "c1", cari: { unvan: "A Ltd" }, ...belge },
  });
  const an = new Date("2026-10-19T08:00:00Z");

  it("günü gelen takipte CRM görevi açar, sorumluya 'teklif' bildirimi verir, durum hatırlatıldı", async () => {
    const k = kur([takip()]);
    expect(await k.calistir(() => k.s.kiraciTara(an))).toEqual({ kapanan: 0, hatirlatilan: 1, gecerlilik: 0 });
    expect(k.tx.crmGorev.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cariId: "c1", atananUserId: "u1", baslik: "TKF2026000023 teklifi için yanıt yok — takip edin" }) });
    expect(k.tx.teklifTakibi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "hatirlatildi", crmGorevId: "g9" }) }));
    expect(k.bildirim.uret).toHaveBeenCalledWith(expect.objectContaining({ tur: "teklif", kullaniciIdler: ["u1"], birlesimAnahtari: "teklif_takip:t1:1" }));
  });

  it("günü gelmemiş ya da ayar kapalıysa hatırlatmaz", async () => {
    const erken = kur([takip({ hatirlatmaGunu: new Date("2026-10-20T00:00:00Z") })]);
    expect((await erken.calistir(() => erken.s.kiraciTara(an))).hatirlatilan).toBe(0);
    const kapali = kur([takip()], { acik: false });
    expect((await kapali.calistir(() => kapali.s.kiraciTara(an))).hatirlatilan).toBe(0);
    expect(kapali.tx.crmGorev.create).not.toHaveBeenCalled();
  });

  it("siparişe dönüşen teklifin takibi ayar kapalıyken de kapanır, görevi tamamlanır", async () => {
    const k = kur([takip({ durum: "hatirlatildi", crmGorevId: "g1" }, { durum: "kapandi" })], { acik: false });
    expect((await k.calistir(() => k.s.kiraciTara(an))).kapanan).toBe(1);
    expect(k.tx.teklifTakibi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "kapandi", kapanisNedeni: "Teklif siparişe dönüştü" }) }));
    expect(k.tx.crmGorev.updateMany).toHaveBeenCalled();
  });

  it("geçerliliğe 2 iş günü kala bir kez uyarır", async () => {
    const k = kur([takip({ hatirlatmaGunu: new Date("2026-10-30T00:00:00Z") }, { gecerlilikTarihi: new Date("2026-10-21T00:00:00Z") })]);
    expect((await k.calistir(() => k.s.kiraciTara(an))).gecerlilik).toBe(1);
    expect(k.bildirim.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "teklif_gecerlilik:t1" }));
    const uyarildi = kur([takip({ gecerlilikUyarisiAt: new Date() }, { gecerlilikTarihi: new Date("2026-10-21T00:00:00Z") })]);
    expect((await uyarildi.calistir(() => uyarildi.s.kiraciTara(an))).gecerlilik).toBe(0);
  });
});
