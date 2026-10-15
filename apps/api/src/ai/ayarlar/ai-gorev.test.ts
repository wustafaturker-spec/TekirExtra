import { describe, expect, it, vi } from "vitest";
import { baglamAl, istekBaglami } from "../../core/istek-baglami";
import { AiGorevYurutucu, gorevZamaniGeldiMi, trSimdi } from "./ai-gorev-yurutucu";
import { TenantAiService } from "./tenant-ai.service";
import { AiAjanService } from "../ajan/ai-ajan.service";
import { AracYurutucu } from "../ajan/arac-yurutucu";
import { SenaryoAiProvider } from "../saglayici/mock-ai.provider";

const g = (ek: Record<string, unknown> = {}) => ({
  id: "g1", tenantId: "t", ad: "Sabah özeti", tur: "ASISTAN", tetikleyici: "ZAMANLANMIS", zamanlamaCron: "09:00", gunler: [] as number[],
  esikTutar: null, gorevTalimati: "Vadesi geçen alacakları özetle", kanal: "PANEL", hedefKimlik: null, aktif: true,
  sonCalisma: null, sonSonuc: null, createdAt: new Date(), userId: "u1", sonTetikGunu: null as Date | null, ...ek,
});

describe("görev zamanlaması (AI-16)", () => {
  const pzt0905 = { gun: "2026-10-12", saat: "09:05", haftaGunu: 1 };
  it("saat geçmiş, gün uygun ve bugün tetiklenmemişse çalışır", () => {
    expect(gorevZamaniGeldiMi(g() as never, pzt0905)).toBe(true);
    expect(gorevZamaniGeldiMi(g() as never, { ...pzt0905, saat: "08:59" })).toBe(false);
    expect(gorevZamaniGeldiMi(g({ gunler: [2, 3] }) as never, pzt0905)).toBe(false);
    expect(gorevZamaniGeldiMi(g({ sonTetikGunu: new Date("2026-10-12T00:00:00Z") }) as never, pzt0905)).toBe(false);
    expect(gorevZamaniGeldiMi(g({ aktif: false }) as never, pzt0905)).toBe(false);
  });
  it("Türkiye saatini ve haftanın gününü verir", () => {
    expect(trSimdi(new Date("2026-10-12T06:30:00Z"))).toEqual({ gun: "2026-10-12", saat: "09:30", haftaGunu: 1 });
    expect(trSimdi(new Date("2026-10-18T22:30:00Z"))).toEqual({ gun: "2026-10-19", saat: "01:30", haftaGunu: 1 });
  });
});

describe("görev yürütme (AI-16)", () => {
  function kur(sahip: { id: string; rol: string } | null = { id: "u1", rol: "muhasebe" }) {
    const tx = { user: { findFirst: vi.fn().mockResolvedValue(sahip) }, tenantAiGorev: { update: vi.fn() } };
    const prisma = { tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) };
    let gorulenBaglam: unknown;
    const ajan = { gorevYurut: vi.fn(async () => { gorulenBaglam = baglamAl(); return { cevap: "3 cari, 120.000 TL", araclar: [] }; }) };
    const uc = { cagir: vi.fn() };
    const bildirimler = { uret: vi.fn().mockResolvedValue({}) };
    const icgoru = { analizEt: vi.fn(async () => { gorulenBaglam = baglamAl(); return { id: "i1", icerik: { onem: "kritik", ozet: "Baz senaryoda nakit eksiye düşüyor.", bulgular: [{ metin: "A Ltd: 10 TL", baglanti: "/panel/cari/c1" }], uyarilar: [] } }; }) };
    const y = new AiGorevYurutucu(prisma as never, ajan as never, uc as never, bildirimler as never, icgoru as never);
    return { y, tx, ajan, uc, bildirimler, icgoru, baglam: () => gorulenBaglam };
  }

  it("sahibin kimliği ve rolüyle çalışır, sonucu kaydeder, zamanlanmışta sahibine bildirir", async () => {
    const k = kur();
    const r = await k.y.yurut("t", g() as never, { bildir: true });
    expect(r.metin).toBe("3 cari, 120.000 TL");
    expect(k.baglam()).toEqual({ tenantId: "t", userId: "u1", rol: "muhasebe" });
    expect(k.tx.tenantAiGorev.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sonSonuc: "3 cari, 120.000 TL" }) }));
    expect(k.bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ tur: "yapay_zeka", kullaniciIdler: ["u1"], roller: [] }));
  });

  it("NAKIT_TAHSILAT görevi modeli çağırmadan analiz eder, önemi bildirime taşır (AI-23)", async () => {
    const k = kur();
    const r = await k.y.yurut("t", g({ tur: "NAKIT_TAHSILAT", gorevTalimati: "" }) as never, { bildir: true });
    expect(k.ajan.gorevYurut).not.toHaveBeenCalled();
    expect(k.icgoru.analizEt).toHaveBeenCalledWith({ gorevId: "g1" });
    expect(k.baglam()).toEqual({ tenantId: "t", userId: "u1", rol: "muhasebe" });
    expect(r).toEqual({ basarili: true, metin: "Baz senaryoda nakit eksiye düşüyor.\n• A Ltd: 10 TL" });
    expect(k.bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "kritik", hedefYol: "/panel/nakit-akisi" }));
  });

  it("NAKIT_TAHSILAT analizi yapılamazsa çalışma başarısızdır", async () => {
    const k = kur();
    const { AnalizYapilamadi } = await import("../icgoru/nakit-tahsilat-analizi");
    k.icgoru.analizEt.mockRejectedValueOnce(new AnalizYapilamadi("Analiz yapılamadı: hiçbir bölüm görülemiyor."));
    const r = await k.y.yurut("t", g({ tur: "NAKIT_TAHSILAT" }) as never, { bildir: true });
    expect(r).toEqual({ basarili: false, metin: "Çalışmadı: hiçbir bölüm görülemiyor." });
    expect(k.bildirimler.uret).not.toHaveBeenCalled();
  });

  it("sahibi etkin değilse çalışmaz", async () => {
    const k = kur(null);
    expect((await k.y.yurut("t", g() as never)).metin).toContain("etkin değil");
    expect(k.ajan.gorevYurut).not.toHaveBeenCalled();
  });

  it("vade ve kasa koşulları rapor uçlarından; yetkisiz rolde koşul sağlanmaz", async () => {
    const k = kur();
    k.uc.cagir.mockResolvedValueOnce({ toplamAlacak: "0.00" });
    expect(await k.y.kosulSaglandi(g({ tetikleyici: "VADE_GECIKMESI" }) as never)).toBe(false);
    k.uc.cagir.mockResolvedValueOnce({ nakitVarliklar: "4000.00" });
    expect(await k.y.kosulSaglandi(g({ tetikleyici: "KASA_KRITIK", esikTutar: 5000 }) as never)).toBe(true);
    const { ForbiddenException } = await import("@nestjs/common");
    k.uc.cagir.mockRejectedValueOnce(new ForbiddenException());
    expect(await k.y.kosulSaglandi(g({ tetikleyici: "VADE_GECIKMESI" }) as never)).toBe(false);
  });
});

describe("asistanın görev modu", () => {
  it("modele yalnız okuma araçları sunulur", async () => {
    const tx = { user: { findFirst: vi.fn().mockResolvedValue({ adSoyad: "A" }) } };
    const prisma = { tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) };
    const uc = { yetkiliMi: () => true, cagir: vi.fn() };
    const saglayici = new SenaryoAiProvider([{ metin: "Rapor hazır.", aracCagrilari: [] }]);
    const ajan = new AiAjanService(prisma as never, new AracYurutucu(uc as never, {} as never));
    ajan.gorevSaglayicisi = async () => ({ saglayici, ozelTalimatlar: null });
    const r = await istekBaglami.run({ deger: { tenantId: "t", userId: "u1", rol: "yonetici" } }, () => ajan.gorevYurut("Sabah", "özetle"));
    expect(r.cevap).toBe("Rapor hazır.");
    const adlar = saglayici.girdiler[0].araclar.map((a) => a.ad);
    expect(adlar).toContain("cari_ara");
    expect(adlar).not.toContain("belge_taslagi_olustur");
    expect(adlar).not.toContain("belge_onayla");
    expect(saglayici.girdiler[0].sistemRol).toContain("zamanlanmış bir görevdir");
  });
});

describe("görev tanımı", () => {
  it("kısmi güncelleme verilmeyen alanı değiştirmez; kasa görevinde eşik zorunlu", async () => {
    const tx = { tenantAiGorev: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn().mockResolvedValue(g()) } };
    const s = new TenantAiService({ tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) } as never, {} as never);
    await s.gorevGuncelle("t", "g1", { aktif: false });
    expect(tx.tenantAiGorev.update.mock.calls[0][0].data).toEqual({ aktif: false });
    await expect(s.gorevGuncelle("t", "g1", { tetikleyici: "KASA_KRITIK", esikTutar: null })).rejects.toThrow(/eşik/);
    await expect(istekBaglami.run({ deger: { tenantId: "t", userId: "u1", rol: "yonetici" } }, () =>
      s.gorevOlustur("t", { ad: "Kasa", tetikleyici: "KASA_KRITIK", gorevTalimati: "kasa durumunu yaz" }))).rejects.toThrow(/eşik/);
  });

  it("asistan görevinde talimat zorunlu; nakit-tahsilat görevi talimatsız açılır (AI-23)", async () => {
    const tx = { tenantAiGorev: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn().mockResolvedValue(g({ tur: "NAKIT_TAHSILAT", gorevTalimati: "" })) } };
    const s = new TenantAiService({ tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) } as never, {} as never);
    const calistir = <T>(fn: () => T) => istekBaglami.run({ deger: { tenantId: "t", userId: "u1", rol: "yonetici" } }, fn);
    await expect(calistir(() => s.gorevOlustur("t", { ad: "Sabah", tetikleyici: "ZAMANLANMIS" }))).rejects.toThrow(/talimat/i);
    await calistir(() => s.gorevOlustur("t", { ad: "Nakit", tur: "NAKIT_TAHSILAT", tetikleyici: "ZAMANLANMIS" }));
    expect(tx.tenantAiGorev.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ tur: "NAKIT_TAHSILAT", gorevTalimati: "" }));
    await expect(s.gorevGuncelle("t", "g1", { tur: "ASISTAN" })).rejects.toThrow(/talimat/i);
  });
});
