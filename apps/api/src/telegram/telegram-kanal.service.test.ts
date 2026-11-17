import { describe, expect, it, vi } from "vitest";
import { DAKIKA_SINIRI, guncellemeIstekKimligi, TelegramKanalService, telegramYaniti } from "./telegram-kanal.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Telegram kanalı yardımcıları", () => {
  it("güncelleme numarasından kararlı ve asistanın kabul ettiği istek kimliği üretir", () => {
    for (const no of [0, 1, 42, 987_654_321]) expect(guncellemeIstekKimligi(no)).toMatch(UUID);
    expect(guncellemeIstekKimligi(7)).toBe(guncellemeIstekKimligi(7));
    expect(guncellemeIstekKimligi(7)).not.toBe(guncellemeIstekKimligi(8));
  });

  it("onay talebi yanıta özet ve panel bağlantısıyla eklenir (CNL-04)", () => {
    process.env.APP_URL = "https://panel.ornek/";
    const metin = telegramYaniti({ cevap: "Hazırladım.", onayTalepleri: [{ id: "t1", ozet: "FTR001\nkesinleştir" }] as never });
    expect(metin).toBe("Hazırladım.\n\nPanelde onayınızı bekleyen işlem:\n• FTR001 kesinleştir\n  https://panel.ornek/panel/ai?talep=t1");
    expect(telegramYaniti({ cevap: "Tamam.", onayTalepleri: [] })).toBe("Tamam.");
  });

  it("asistanın göreli panel yollarını tam adrese çevirir; tam adrese dokunmaz", () => {
    process.env.APP_URL = "https://panel.ornek";
    const cevap = "Panelde görüntüleyin: /panel/personel/a5b0\n(ayrıntı: /panel/cari/1) zaten tam: https://panel.ornek/panel/x";
    expect(telegramYaniti({ cevap, onayTalepleri: [] })).toBe("Panelde görüntüleyin: https://panel.ornek/panel/personel/a5b0\n(ayrıntı: https://panel.ornek/panel/cari/1) zaten tam: https://panel.ornek/panel/x");
  });
});

describe("Telegram kanalı giriş süzgeci", () => {
  const kur = () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const kanal = new TelegramKanalService(prisma as never, {} as never, {} as never);
    const gonder = vi.fn().mockResolvedValue(undefined);
    (kanal as unknown as { istemci: unknown }).istemci = { gonder, yaziyor: vi.fn() };
    return { kanal, prisma, gonder };
  };
  const mesaj = (no: number, tur: "private" | "group" = "private", from = 55) => ({ update_id: no, message: { message_id: no, date: 0, chat: { id: from, type: tur }, from: { id: from }, text: "selam" } });

  it("grup mesajına ve bot hesabına yanıt vermez, firma çözümüne bile gitmez (CNL-01)", async () => {
    const { kanal, prisma, gonder } = kur();
    await kanal.isle(mesaj(1, "group"));
    await kanal.isle({ update_id: 2, message: { ...mesaj(2).message, from: { id: 9, is_bot: true } } });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
  });

  it("bir hesaptan dakikada 20'den çok mesaj gelirse yanıt vermez (CNL-13)", async () => {
    const { kanal, gonder } = kur();
    for (let i = 0; i < DAKIKA_SINIRI + 5; i++) await kanal.isle(mesaj(i));
    expect(gonder).toHaveBeenCalledTimes(DAKIKA_SINIRI);
    // Başka hesap etkilenmez.
    await kanal.isle(mesaj(100, "private", 66));
    expect(gonder).toHaveBeenCalledTimes(DAKIKA_SINIRI + 1);
  });
});

describe("CNL-23 görsel yönlendirmesi", () => {
  const baglam = { tenantId: "t", userId: "u", rol: "muhasebe" as never };
  const kur = (o: { masrafHatasi?: Error; cariYetki?: boolean } = {}) => {
    const masrafBelge = {
      yetkiDenetle: vi.fn(),
      belgedenMasraf: vi.fn(async () => { if (o.masrafHatasi) throw o.masrafHatasi; return { sonuc: "masraf taslağı" }; }),
    };
    const cariBelge = { yetkiDenetle: vi.fn(), yetkiVar: vi.fn(() => o.cariYetki ?? true), belgedenCari: vi.fn(async () => ({ sonuc: "cari talebi" })) };
    const kanal = new TelegramKanalService({} as never, {} as never, {} as never, undefined, undefined, masrafBelge as never, undefined, cariBelge as never);
    const gonderilen: string[] = [];
    Object.assign(kanal as object, { firmayaGonder: vi.fn(async (_t: string, _u: string, _o: unknown, _tur: string, metin: string) => { gonderilen.push(metin); }) });
    const bot = { istemci: { yaziyor: vi.fn(), dosyaIndir: vi.fn(async () => Buffer.from("x")) } };
    const isle = (caption?: string) => (kanal as unknown as { belgeIsle: (b: unknown, m: unknown, bot: unknown) => Promise<void> })
      .belgeIsle(baglam, { message_id: 7, date: 0, chat: { id: 1, type: "private" }, from: { id: 1 }, photo: [{ file_id: "f", width: 1, height: 1, file_size: 10 }], ...(caption ? { caption } : {}) }, bot);
    return { masrafBelge, cariBelge, gonderilen, isle };
  };

  it("açıklamada cari/müşteri geçerse cari akışına gider, türü açıklamadan alır; masraf denenmez", async () => {
    const k = kur();
    await k.isle("müşteri cari aç");
    expect(k.cariBelge.belgedenCari).toHaveBeenCalledWith(expect.objectContaining({ ad: "telegram-7" }), "musteri", true);
    expect(k.masrafBelge.belgedenMasraf).not.toHaveBeenCalled();
    expect(k.gonderilen).toEqual(["cari talebi"]);
  });

  it("açıklamasız görselde tutar okunamazsa bir kez cari okuması denenir", async () => {
    const { TutarOkunamadiHatasi } = await import("../asistan-soru/masraf-belge.service");
    const k = kur({ masrafHatasi: new TutarOkunamadiHatasi("Belgeden tutar güvenle okunamadı") });
    await k.isle();
    expect(k.cariBelge.belgedenCari).toHaveBeenCalledWith(expect.anything(), undefined, false);
    expect(k.gonderilen).toEqual(["cari talebi"]);
  });

  it("açıklama varken, cari yetkisi yokken ya da başka hatada geri dönüş yapılmaz", async () => {
    const { TutarOkunamadiHatasi } = await import("../asistan-soru/masraf-belge.service");
    for (const [o, caption] of [[{ masrafHatasi: new TutarOkunamadiHatasi("Belgeden tutar güvenle okunamadı") }, "benzin"], [{ masrafHatasi: new TutarOkunamadiHatasi("Belgeden tutar güvenle okunamadı"), cariYetki: false }, undefined]] as const) {
      const k = kur(o);
      await k.isle(caption);
      expect(k.cariBelge.belgedenCari).not.toHaveBeenCalled();
      expect(k.gonderilen[0]).toContain("Belgeden tutar güvenle okunamadı");
    }
    const k = kur();
    await k.isle("fiş");
    expect(k.gonderilen).toEqual(["masraf taslağı"]);
  });
});
