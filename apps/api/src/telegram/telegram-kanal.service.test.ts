import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DAKIKA_SINIRI, guncellemeIstekKimligi, onayKlavyesiKur, TelegramKanalService, telegramYaniti } from "./telegram-kanal.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Telegram kanalı yardımcıları", () => {
  it("güncelleme numarasından kararlı ve asistanın kabul ettiği istek kimliği üretir", () => {
    for (const no of [0, 1, 42, 987_654_321]) expect(guncellemeIstekKimligi(no)).toMatch(UUID);
    expect(guncellemeIstekKimligi(7)).toBe(guncellemeIstekKimligi(7));
    expect(guncellemeIstekKimligi(7)).not.toBe(guncellemeIstekKimligi(8));
  });

  it("AI-108: talepler yanıt metnine eklenmez; risk sınıfına göre düğmeli mesaj kurulur", () => {
    expect(telegramYaniti({ cevap: "Hazırladım." })).toBe("Hazırladım.");
    const panel = "https://panel.ornek";
    const dusuk = { id: "t1", surum: 2, ozet: "Cari\noluştur", risk: "dusuk" as const };
    const finansal = { id: "t2", surum: 1, ozet: "FTR001 kesinleştir", risk: "finansal" as const };
    expect(onayKlavyesiKur([dusuk], false, panel)).toEqual({
      metin: "Onayınızı bekleyen işlem:\n• Cari oluştur",
      klavye: [[{ text: "✅ Onayla", callback_data: "onay:t1:2" }, { text: "❌ Reddet", callback_data: "red:t1:2" }]],
    });
    const kodlu = onayKlavyesiKur([dusuk, finansal], true, panel);
    expect(kodlu.klavye[1]).toEqual([{ text: "🔐 2. Kodla onayla", callback_data: "kod:t2:1" }, { text: "❌ 2. Reddet", callback_data: "red:t2:1" }]);
    expect(kodlu.metin).toContain("2. FTR001 kesinleştir\n  Finansal işlem: onay için iki adımlı doğrulama kodu istenir.");
    // Kodu olmayan kullanıcıda finansal talep yalnız panel bağlantısı ve reddet düğmesiyle gelir.
    const kodsuz = onayKlavyesiKur([finansal], false, panel);
    expect(kodsuz.klavye).toEqual([[{ text: "❌ Reddet", callback_data: "red:t2:1" }]]);
    expect(kodsuz.metin).toContain("panelde onaylayın https://panel.ornek/panel/ai?talep=t2");
    expect(JSON.stringify(kodsuz.klavye)).not.toContain("onay:");
    const cok = onayKlavyesiKur(Array.from({ length: 7 }, (_, i) => ({ ...dusuk, id: `t${i}` })), false, panel);
    expect(cok.klavye).toHaveLength(5);
    expect(cok.metin).toContain("Diğer 2 talep panelde: https://panel.ornek/panel/ai");
    const uzun = onayKlavyesiKur([{ ...finansal, id: "a1d2e3f4-4b5c-4d6e-8f70-81920a1b2c3d", surum: 999 }], true, panel);
    for (const d of uzun.klavye.flat()) expect(Buffer.byteLength(d.callback_data)).toBeLessThanOrEqual(64);
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

  it("cari talebi üretildiğinde satır içi hızlı onay/red klavyesi eklenir", async () => {
    const masrafBelge = { yetkiDenetle: vi.fn(), belgedenMasraf: vi.fn() };
    const cariBelge = {
      yetkiDenetle: vi.fn(),
      yetkiVar: vi.fn(() => true),
      belgedenCari: vi.fn(async () => ({ sonuc: "Cari kartı taslağı", talepId: "talep-123" })),
    };
    const tx = {
      aiOnayTalebi: { findMany: vi.fn().mockResolvedValue([{ id: "talep-123", surum: 1, ozet: "Cari kartı aç: AKN BOYA", arac: "cari_olustur", createdAt: new Date() }]) },
      modulAyar: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn().mockResolvedValue({ totpAktif: false }) },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    const kanal = new TelegramKanalService(prisma as never, {} as never, {} as never, undefined, undefined, masrafBelge as never, undefined, cariBelge as never);
    const klavyeliGonderilen: unknown[] = [];
    Object.assign(kanal as object, {
      firmayaKlavyeliGonder: vi.fn(async (_t: string, _u: string, _tur: string, metin: string, klavye: unknown) => {
        klavyeliGonderilen.push({ metin, klavye });
      }),
    });
    const bot = { istemci: { yaziyor: vi.fn(), dosyaIndir: vi.fn(async () => Buffer.from("pdf")) } };
    await (kanal as unknown as { belgeIsle: (b: unknown, m: unknown, bot: unknown) => Promise<void> }).belgeIsle(
      baglam,
      {
        message_id: 10,
        date: 0,
        chat: { id: 1, type: "private" },
        from: { id: 1 },
        caption: "müşteri cari aç",
        document: { file_id: "doc-1", file_name: "vergi.pdf" },
      },
      bot,
    );
    expect(klavyeliGonderilen).toHaveLength(1);
    expect(klavyeliGonderilen[0]).toEqual({
      metin: "Cari kartı taslağı\n\nOnayınızı bekleyen işlem:\n• Cari kartı aç: AKN BOYA",
      klavye: [
        [
          { text: "✅ Onayla", callback_data: "onay:talep-123:1" },
          { text: "❌ Reddet", callback_data: "red:talep-123:1" },
        ],
      ],
    });
    expect(tx.aiOnayTalebi.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["talep-123"] }, userId: "u", durum: "bekliyor" } }));
  });
});

describe("CNL-27 Hızlı onay ve dosya gönderimi", () => {
  it("onay callback'i aiOnay.onayla çağırır ve klavyeyi kaldırır", async () => {
    const aiOnay = { onayla: vi.fn().mockResolvedValue({ ozet: "Cari oluştur: AKN BOYA" }), reddet: vi.fn() };
    const prisma = {
      tenantIslem: vi.fn().mockImplementation((_t, cb) => cb({
        telegramBagi: { findFirst: vi.fn().mockResolvedValue({ oturumSurumu: 1, botKimlik: "platform" }) },
        telegramMesaji: { create: vi.fn().mockResolvedValue({ id: "m1" }) },
      })),
    };
    const telegram = {
      bagKarari: vi.fn().mockResolvedValue({ rol: "yonetici", moduller: [] }),
    };
    const kanal = new TelegramKanalService(
      prisma as never,
      {} as never,
      telegram as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      aiOnay as never,
    );
    Object.assign(kanal as object, {
      coz: vi.fn().mockResolvedValue({ tenantId: "t1", userId: "u1", botKimlik: "platform" }),
      gelenIz: vi.fn().mockResolvedValue(true),
      firmayaGonder: vi.fn().mockResolvedValue("gonderildi"),
    });

    const bot = {
      kimlik: "platform",
      tenantId: null,
      istemci: {
        dugmeYanitla: vi.fn().mockResolvedValue(undefined),
        klavyeKaldir: vi.fn().mockResolvedValue(undefined),
      },
    };

    const dugme = {
      id: "cb-1",
      data: "onay:talep-123",
      from: { id: 100, is_bot: false },
      message: { message_id: 50, chat: { id: 100, type: "private" } },
    };

    await (kanal as unknown as { dugmeIsle: (g: unknown, d: unknown, bot: unknown) => Promise<void> }).dugmeIsle(
      { update_id: 1, callback_query: dugme } as never,
      dugme as never,
      bot as never,
    );

    // AI-107: sürümsüz eski düğme ilk sürümü, Telegram kanalıyla onaylar.
    expect(aiOnay.onayla).toHaveBeenCalledWith("talep-123", { surum: 1, kanal: "TELEGRAM" });
    expect(bot.istemci.klavyeKaldir).toHaveBeenCalledWith(100, 50);
    expect(bot.istemci.dugmeYanitla).toHaveBeenCalledWith("cb-1", "Onaylandı");
  });

  it("AI-108: 'Kodla onayla' sonraki 6 haneli mesajı bekler; kod silinir, onay kodla istenir, yanlış kodda bekleme sürer", async () => {
    const aiOnay = {
      onayla: vi.fn()
        .mockRejectedValueOnce(new ForbiddenException({ message: "Doğrulama kodu geçersiz.", kod: "KOD_GECERSIZ" }))
        .mockResolvedValueOnce({ ozet: "Masraf tamamla", durum: "onaylandi" }),
      reddet: vi.fn(),
    };
    const kanal = new TelegramKanalService({} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, undefined, aiOnay as never);
    const gonderilen: string[] = [];
    const baglamHazir = { baglam: { tenantId: "t1", userId: "u1", rol: "yonetici" }, karar: { tutarGoster: true, neden: null } };
    Object.assign(kanal as object, {
      coz: vi.fn().mockResolvedValue({ tenantId: "t1", userId: "u1", botKimlik: "platform" }),
      baglamHazirla: vi.fn().mockResolvedValue(baglamHazir),
      gelenIz: vi.fn().mockResolvedValue(true),
      firmayaGonder: vi.fn(async (_t: string, _u: string, _id: unknown, _tur: string, metin: string) => { gonderilen.push(metin); return "gonderildi"; }),
    });
    const bot = { kimlik: "platform", tenantId: null, istemci: { dugmeYanitla: vi.fn(), klavyeKaldir: vi.fn().mockResolvedValue(undefined), mesajSil: vi.fn().mockResolvedValue(undefined), yaziyor: vi.fn() } };
    const dugme = { id: "cb-9", data: "kod:talep-9:2", from: { id: 100, is_bot: false }, message: { message_id: 70, chat: { id: 100, type: "private" } } };
    const k = kanal as unknown as {
      dugmeIsle: (g: unknown, d: unknown, bot: unknown) => Promise<void>;
      firmaMesaji: (g: unknown, m: unknown, metin: string, c: unknown, bot: unknown) => Promise<void>;
    };
    await k.dugmeIsle({ update_id: 1 }, dugme, bot);
    expect(aiOnay.onayla).not.toHaveBeenCalled();
    expect(gonderilen[0]).toContain("6 haneli kodu");

    const mesaj = (no: number, text: string) => ({ message_id: no, date: 0, chat: { id: 100, type: "private" }, from: { id: 100 }, text });
    const cozum = { tenantId: "t1", userId: "u1" };
    await k.firmaMesaji({ update_id: 2 }, mesaj(71, "111111"), "111111", cozum, bot);
    expect(bot.istemci.mesajSil).toHaveBeenCalledWith(100, 71);
    expect(aiOnay.onayla).toHaveBeenLastCalledWith("talep-9", { surum: 2, kanal: "TELEGRAM", dogrulamaKodu: "111111" });
    expect(gonderilen.at(-1)).toBe("Doğrulama kodu geçersiz. Yeniden yazabilirsiniz.");

    await k.firmaMesaji({ update_id: 3 }, mesaj(72, " 222222 "), " 222222 ", cozum, bot);
    expect(aiOnay.onayla).toHaveBeenLastCalledWith("talep-9", { surum: 2, kanal: "TELEGRAM", dogrulamaKodu: "222222" });
    expect(bot.istemci.klavyeKaldir).toHaveBeenCalledWith(100, 70);
    expect(gonderilen.at(-1)).toBe("✅ Masraf tamamla onaylandı ve tamamlandı.");

    // Bekleme bitti: sonraki 6 haneli mesaj artık onaya gitmez.
    Object.assign(kanal as object, { ajan: { mesajiIsle: vi.fn().mockResolvedValue({ cevap: "Merhaba", onayTalepleri: [] }) } });
    await k.firmaMesaji({ update_id: 4 }, mesaj(73, "333333"), "333333", cozum, bot).catch(() => undefined);
    expect(aiOnay.onayla).toHaveBeenCalledTimes(2);
  });

  it("tutarGoster false olduğunda firmayaDosyaGonder uyarı verir ve dosya iletmez", async () => {
    const prisma = {
      tenantIslem: vi.fn().mockImplementation((_t, cb) => cb({
        telegramBagi: {
          findUnique: vi.fn().mockResolvedValue({ tenantId: "t1", telegramKullaniciId: BigInt(100), sohbetId: BigInt(100), botKimlik: "platform" }),
        },
        modulAyar: { findUnique: vi.fn().mockResolvedValue({ ayarlar: { etkin: true, tutarGoster: true } }) },
        telegramMesaji: { create: vi.fn().mockResolvedValue({ id: "m1" }) },
      })),
    };
    const kanal = new TelegramKanalService(prisma as never, {} as never, {} as never);
    const firmayaGonder = vi.fn().mockResolvedValue("gonderildi");
    const dosyaGonder = vi.fn().mockResolvedValue(undefined);
    Object.assign(kanal as object, {
      firmayaGonder,
      gonderenBot: vi.fn(() => ({ istemci: { dosyaGonder } })),
    });

    // tutarGoster = false veriliyor
    const sonuc = await kanal.firmayaDosyaGonder(
      "t1",
      "u1",
      Buffer.from("dummy-pdf"),
      "ekstre.pdf",
      "Ekstre",
      "application/pdf",
      false, // tutarGoster
    );

    expect(sonuc).toBe("gonderildi");
    expect(dosyaGonder).not.toHaveBeenCalled();
    expect(firmayaGonder).toHaveBeenCalledWith(
      "t1",
      "u1",
      null,
      "bilgi",
      expect.stringContaining("tutar gösterimi kapalı"),
    );
  });
});
