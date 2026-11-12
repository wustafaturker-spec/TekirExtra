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
