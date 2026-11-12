import { describe, expect, it } from "vitest";
import {
  bildirimMesaji, brifingMaddeleri, brifingZamaniMi, gunSonu, isGunuMu, ritimKomutu, teslimatlariSec, VARSAYILAN_TERCIH, type AdayTeslimat,
} from "./telegram-bildirim.kurallari";

const aday = (id: string, tur: string, onem: string, ek: Partial<AdayTeslimat["bildirim"]> = {}): AdayTeslimat =>
  ({ id, bildirim: { tur, onem, baslik: `Başlık ${id}`, aciklama: `Açıklama ${id}`, hedefYol: "/panel/x", kapandiAt: null, ...ek } }) as AdayTeslimat;
const simdi = new Date("2026-11-12T09:00:00Z");

describe("Telegram'a giden bildirim seçimi (CNL-06/07)", () => {
  it("konu ve önem süzülür; kritik her konuda gider; çözülen atlanır; kritik öne alınır", () => {
    const { uygun, atlanan } = teslimatlariSec([
      aday("1", "vade", "uyari"), aday("2", "stok", "uyari"), aday("3", "stok", "kritik"), aday("4", "ebelge", "bilgi"), aday("5", "onay", "uyari", { kapandiAt: new Date() }),
    ], VARSAYILAN_TERCIH, simdi);
    expect(uygun.map((x) => x.id)).toEqual(["3", "1"]);
    expect(atlanan).toEqual([{ id: "2", neden: "konu_disi" }, { id: "4", neden: "konu_disi" }, { id: "5", neden: "cozuldu" }]);
  });

  it("sus süresince kritik dahil hiçbir şey gitmez; süre bitince gider", () => {
    const sus = { ...VARSAYILAN_TERCIH, susBitis: new Date(simdi.getTime() + 60_000) };
    expect(teslimatlariSec([aday("1", "vade", "kritik")], sus, simdi)).toEqual({ uygun: [], atlanan: [{ id: "1", neden: "sus" }] });
    expect(teslimatlariSec([aday("1", "vade", "kritik")], { ...sus, susBitis: new Date(simdi.getTime() - 1) }, simdi).uygun).toHaveLength(1);
  });

  it("tek bildirim ayrıntıyla, birden çoğu tek özetle; panel bağlantısı ve susturma notu", () => {
    process.env.APP_URL = "https://panel.ornek";
    const tek = bildirimMesaji([aday("1", "vade", "kritik")]);
    expect(tek).toContain("🔴 Başlık 1\n\nAçıklama 1\n\nhttps://panel.ornek/panel/x");
    expect(tek).toMatch(/“sus”/);
    const ozet = bildirimMesaji(Array.from({ length: 12 }, (_, i) => aday(String(i), "vade", "uyari")));
    expect(ozet.startsWith("12 yeni bildirim:\n🟠 Başlık 0")).toBe(true);
    expect(ozet).toContain("… ve 2 bildirim daha.");
    expect(ozet).toContain("https://panel.ornek/panel/bildirimler");
  });
});

describe("sabah brifingi (CNL-08)", () => {
  it("iş günü: hafta sonu ve tam gün resmî tatil değil; arife iş günüdür", () => {
    expect(isGunuMu("2026-11-12", 4)).toBe(true);
    expect(isGunuMu("2026-11-14", 6)).toBe(false);
    expect(isGunuMu("2026-10-29", 4)).toBe(false); // Cumhuriyet Bayramı
    expect(isGunuMu("2026-10-28", 3)).toBe(true); // arife, yarım gün
  });

  it("brifing penceresi Türkiye saatiyle 08:30–11:00", () => {
    expect(brifingZamaniMi(new Date("2026-11-12T05:29:00Z"))).toBe(false); // 08:29
    expect(brifingZamaniMi(new Date("2026-11-12T05:30:00Z"))).toBe(true); // 08:30
    expect(brifingZamaniMi(new Date("2026-11-12T08:00:00Z"))).toBe(false); // 11:00
    expect(brifingZamaniMi(new Date("2026-11-14T06:00:00Z"))).toBe(false); // cumartesi
  });

  it("en çok beş madde; nakit eksi uyarısı en üste, alt satırlarıyla", () => {
    const metin = ["Günlük brifing — 12.11.2026", "• A", "  a alt", "• B", "• Nakit", "  Bakiye 13.11.2026 günü eksiye düşüyor (-5 TL).", "• D", "• E", "• F"].join("\n");
    const m = brifingMaddeleri(metin);
    expect(m.split("\n").filter((s) => s.startsWith("•"))).toEqual(["• Nakit", "• A", "• B", "• D", "• E"]);
    expect(m).toContain("• Nakit\n  Bakiye 13.11.2026 günü eksiye düşüyor");
    expect(m.startsWith("☀️ Günlük brifing")).toBe(true);
  });
});

describe("ritim komutları (CNL-07)", () => {
  it("yalnız tam eşleşme komut sayılır", () => {
    expect(ritimKomutu("Sus")).toBe("sus");
    expect(ritimKomutu("sus!")).toBe("sus");
    expect(ritimKomutu("Bugünlük yeter.")).toBe("bugunluk");
    expect(ritimKomutu("/devam")).toBe("devam");
    expect(ritimKomutu("bu ay susmuş müşteriler kim")).toBeNull();
    expect(ritimKomutu("devam et")).toBeNull();
  });

  it("bugünlük yeter Türkiye'de gece yarısına dek", () => {
    expect(gunSonu(new Date("2026-11-12T20:30:00Z")).toISOString()).toBe("2026-11-12T21:00:00.000Z"); // TR 23:30 → 00:00
    expect(gunSonu(new Date("2026-11-12T21:30:00Z")).toISOString()).toBe("2026-11-13T21:00:00.000Z"); // TR 00:30 ertesi gün
  });
});
