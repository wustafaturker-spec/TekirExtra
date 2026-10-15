import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { AiIcgoruService } from "./ai-icgoru.service";
import { AnalizYapilamadi, icgoruMetni, nakitTahsilatAnalizi, type NakitGirdisi } from "./nakit-tahsilat-analizi";

const senaryo = (sonBakiye: number, ilkEksi: { tarih: string; bakiye: number } | null, enDusuk = { tarih: "2026-10-20", bakiye: sonBakiye }) => ({ sonBakiye, ilkEksi, enDusuk });
const nakit = (ek: Partial<NakitGirdisi["senaryolar"]> = {}): NakitGirdisi => ({
  ufukGun: 30,
  ufukSonu: "2026-11-13",
  baslangicBakiye: 50_000,
  senaryolar: { baz: senaryo(40_000, null), kotumser: senaryo(20_000, null), ...ek },
  uyarilar: [],
  hesapEsaslari: { surum: "nakit-kapsam-v1" },
});
const bos = { nakit: null, vadesiGecenler: null, oncelikler: null, erisimYok: [] };

describe("nakit ve tahsilat analizi (AI-23/AI-24)", () => {
  it("baz senaryoda eksiye düşen nakit kritiktir", () => {
    const r = nakitTahsilatAnalizi({ ...bos, nakit: nakit({ baz: senaryo(-5_000, { tarih: "2026-10-22", bakiye: -1_250.5 }, { tarih: "2026-10-25", bakiye: -8_000 }) }) });
    expect(r.onem).toBe("kritik");
    expect(r.ozet).toContain("Baz senaryoda nakit 22.10.2026 tarihinde eksiye düşüyor (-1.250,50 TL)");
    expect(r.metrikler).toMatchObject({ baslangicBakiye: 50_000, bazSonBakiye: -5_000, ufukSonu: "2026-11-13" });
    expect(r.kanitlar[0]).toEqual({ kaynak: "GET /nakit-akisi", aciklama: "30 günlük tahmin, nakit-kapsam-v1 hesap esası" });
  });

  it("yalnız kötümser senaryoda düşüş uyarıdır ve senaryo adıyla söylenir", () => {
    const r = nakitTahsilatAnalizi({ ...bos, nakit: nakit({ kotumser: senaryo(-100, { tarih: "2026-11-01", bakiye: -100 }) }) });
    expect(r.onem).toBe("uyari");
    expect(r.ozet).toMatch(/^Kötümser senaryoda .* baz senaryoda düşmüyor\.$/);
  });

  it("vadesi geçen alacak uyarı yapar; öncelikler cari bağlantısıyla sıralanır", () => {
    const r = nakitTahsilatAnalizi({
      ...bos,
      nakit: nakit(),
      vadesiGecenler: { toplamAlacak: "12500.00", alacakSayisi: 3 },
      oncelikler: [
        { cariId: "c1", cariUnvan: "Alfa Ltd", kalanTry: 10_000, enEskiGecikmeGun: 40, faturaSayisi: 2, puan: 46_666.7, risk: "yuksek" },
        { cariId: "c2", cariUnvan: "Beta AŞ", kalanTry: 2_500, enEskiGecikmeGun: -3, faturaSayisi: 1, puan: 2_250, risk: "dusuk" },
      ],
    });
    expect(r.onem).toBe("uyari");
    expect(r.metrikler.vadesiGecenAlacak).toBe(12_500);
    expect(r.bulgular.map((b) => b.baglanti)).toEqual(["/panel/cari/vade-hatirlatma", "/panel/cari/c1", "/panel/cari/c2"]);
    expect(r.bulgular[1].metin).toBe("Alfa Ltd: 10.000,00 TL, 40 gün gecikmiş, risk yuksek, puan 46.667.");
    expect(r.bulgular[2].metin).toContain("3 gün içinde vadesi doluyor");
    expect(r.ozet).toContain("Bugün öncelikle aranacak cari: Alfa Ltd.");
  });

  it("sorun yoksa bilgi; erişilemeyen bölüm uyarılara yazılır", () => {
    const r = nakitTahsilatAnalizi({ ...bos, vadesiGecenler: { toplamAlacak: "0.00", alacakSayisi: 0 }, erisimYok: ["nakit"] });
    expect(r.onem).toBe("bilgi");
    expect(r.ozet).toBe("Dikkat gerektiren bir bulgu yok.");
    expect(r.uyarilar).toEqual(["Nakit akışı tahmini rolünüzle görülemiyor; analize katılmadı."]);
  });

  it("hiçbir bölüm görülemezse analiz yapılmaz", () => {
    expect(() => nakitTahsilatAnalizi({ ...bos, erisimYok: ["nakit", "vadesiGecenler", "oncelikler"] })).toThrow(AnalizYapilamadi);
  });

  it("düz metin özet, bulgular ve notları içerir", () => {
    expect(icgoruMetni({ ozet: "Ö", bulgular: [{ metin: "B", baglanti: null }], uyarilar: ["U"] })).toBe("Ö\n• B\nNot: U");
  });
});

describe("içgörü servisi", () => {
  function kur(cagir: (yol: string) => unknown) {
    const tx = { aiIcgoru: { upsert: vi.fn().mockResolvedValue({ id: "i1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = { tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) };
    const uc = { cagir: vi.fn(async (u: { yol: string }) => cagir(u.yol)) };
    return { s: new AiIcgoruService(prisma as never, uc as never), tx, uc };
  }
  const calistir = <T>(fn: () => T) => istekBaglami.run({ deger: { tenantId: "t", userId: "u1", rol: "satis" } }, fn);

  it("rolün göremediği uç atlanır, kayıt görev + gün anahtarıyla yazılır", async () => {
    const k = kur((yol) => {
      if (yol !== "GET /cari/vade-hatirlatma/oncelikler") throw new ForbiddenException();
      return [];
    });
    const r = await calistir(() => k.s.analizEt({ gorevId: "g1" }));
    expect(k.uc.cagir.mock.calls.map((c) => c[1])).toEqual([["30"], [], ["5"]]);
    expect(r.icerik.uyarilar).toHaveLength(2);
    const arg = k.tx.aiIcgoru.upsert.mock.calls[0][0];
    expect(arg.where.tenantId_tekilAnahtar.tekilAnahtar).toMatch(/^gorev:g1:\d{4}-\d{2}-\d{2}$/);
    expect(arg.create).toMatchObject({ tenantId: "t", gorevId: "g1", userId: "u1", onem: "bilgi", durum: "yeni" });
  });

  it("yetki dışı olmayan hata yukarı çıkar (görev yeniden dener)", async () => {
    const k = kur(() => { throw new Error("veritabanı kapalı"); });
    await expect(calistir(() => k.s.analizEt({ gorevId: null }))).rejects.toThrow("veritabanı kapalı");
    expect(k.tx.aiIcgoru.upsert).not.toHaveBeenCalled();
  });

  it("durum yalnız yeni/görüldü/çözüldü olabilir", async () => {
    const k = kur(() => null);
    await expect(calistir(() => k.s.durumGuncelle("i1", { durum: "silindi" }))).rejects.toThrow(/Durum/);
    await expect(calistir(() => k.s.durumGuncelle("i1", { durum: "cozuldu" }))).resolves.toEqual({ id: "i1", durum: "cozuldu" });
  });
});
