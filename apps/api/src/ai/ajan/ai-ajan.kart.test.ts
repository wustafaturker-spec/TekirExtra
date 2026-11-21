import { kapiAcikTx } from "../ozellik-kapisi.test-veri";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { SenaryoAiProvider } from "../saglayici/mock-ai.provider";
import { AiAjanService } from "./ai-ajan.service";
import { AracYurutucu } from "./arac-yurutucu";
import { KART_NOTU } from "./tablo-kartlari";

const KIMLIK = { tenantId: "11111111-1111-1111-1111-111111111111", userId: "22222222-2222-2222-2222-222222222222" };
const CARI = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";

/** AI-117: araç çıktısından tablo kartı; web'de yanıtta ve kayıtta, Telegram'da yok. */
function kur() {
  const tx = {
    ...kapiAcikTx(),
    user: { findFirst: vi.fn().mockResolvedValue({ adSoyad: "Ayşe Muhasebe" }) },
    ajanOturumu: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "oturum-1", userId: KIMLIK.userId }),
      update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]),
    },
    ajanMesajGecmisi: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "mesaj-1" }), update: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const uc = {
    yetkiliMi: vi.fn(() => true),
    cagir: vi.fn(async () => [
      { cariId: CARI, cariUnvan: "Deneme Otomotiv", kalanTry: 125430.55, enEskiGecikmeGun: 12, faturaSayisi: 3, puan: 180.2, risk: "yuksek" },
    ]),
  };
  const saglayici = new SenaryoAiProvider([
    { metin: "", aracCagrilari: [{ id: "c1", ad: "tahsilat_oncelikleri", girdi: {} }] },
    { metin: "Öncelik listesi aşağıdaki kartta.", aracCagrilari: [] },
  ]);
  const service = new AiAjanService(prisma as never, new AracYurutucu(uc as never, {} as never));
  service.saglayiciBul = async () => ({ saglayici, ozelTalimatlar: null });
  service.duzeltmeSaglayicisiBul = async () => saglayici;
  const calistir = (kanal: "WEB" | "TELEGRAM" = "WEB") =>
    istekBaglami.run({ deger: { ...KIMLIK, rol: "muhasebe" as never } }, () => service.mesajiIsle("Bugün kimi aramalıyım?", "33333333-3333-4333-8333-333333333333", undefined, [], { kanal }));
  return { tx, saglayici, calistir };
}

describe("asistan tablo kartı (AI-117)", () => {
  it("web: kart araç çıktısındaki değerle yanıtta ve kayıtta; model kart notunu görür", async () => {
    const k = kur();
    const y = await k.calistir();
    expect(y.kartlar).toHaveLength(1);
    expect(y.kartlar![0]).toMatchObject({ arac: "tahsilat_oncelikleri", baslik: "Tahsilat öncelikleri", satirSayisi: 1 });
    expect(y.kartlar![0].satirlar[0]).toMatchObject({ cariUnvan: "Deneme Otomotiv", kalanTry: "125430.55", puan: "180.2" });
    const kayit = k.tx.ajanMesajGecmisi.create.mock.calls.find(([a]) => a.data.rol === "assistant")![0];
    expect(kayit.data.aracCagrisi.kartlar).toEqual(y.kartlar);
    expect(JSON.stringify(k.saglayici.girdiler[1])).toContain(JSON.stringify(KART_NOTU).slice(1, 40));
  });

  it("Telegram: kart üretilmez, modele kart notu gitmez", async () => {
    const k = kur();
    const y = await k.calistir("TELEGRAM");
    expect(y.kartlar).toBeUndefined();
    expect(JSON.stringify(k.saglayici.girdiler[1] ?? {})).not.toContain("tablo kartı olarak");
  });
});
