import { describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async () => ({ messageId: "<giden@tekir>" }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }));

import { EpostaService } from "./eposta.service";
import { ImapService } from "./imap.service";

const ASIL = { mesajId: "<asil@musteri.com>", yanitlananMesajIdleri: ["<ilk@tekir>"] };

function kur(asil: typeof ASIL | null = ASIL, kendi = ["satis@tekir.com"]) {
  const tx = { gelenEposta: { findFirst: vi.fn().mockResolvedValue(asil) } };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const eposta = new EpostaService({} as never, { tasiyici: async () => ({ transport: { sendMail }, from: "TekirExtra <p@t.co>" }) } as never);
  vi.spyOn(eposta, "kendiAdresleri").mockResolvedValue(kendi);
  const service = new ImapService(prisma as never, {} as never, eposta, {} as never);
  sendMail.mockClear();
  return { service, tx };
}

describe("e-posta ekranından ileti gönderimi", () => {
  it("yanıt asıl iletinin zincirini taşır", async () => {
    const k = kur();
    await k.service.iletiGonder("t1", { kime: ["ayse@musteri.com"], konu: "Ynt: Fiyat", metin: "Merhaba", yanitlananId: "e1" });
    expect(k.tx.gelenEposta.findFirst).toHaveBeenCalledWith({ where: { id: "e1", tenantId: "t1" }, select: { mesajId: true, yanitlananMesajIdleri: true } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ayse@musteri.com", subject: "Ynt: Fiyat", inReplyTo: "<asil@musteri.com>", references: ["<ilk@tekir>", "<asil@musteri.com>"] }));
  });

  it("yeni iletide zincir yok; kiracının kendi adresi alıcılardan düşer", async () => {
    const k = kur();
    const sonuc = await k.service.iletiGonder("t1", { kime: ["Ayse@Musteri.com", "satis@tekir.com", "ayse@musteri.com"], konu: "Fiyat", metin: "Merhaba" });
    expect(sonuc.alicilar).toEqual(["ayse@musteri.com"]);
    expect(k.tx.gelenEposta.findFirst).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ayse@musteri.com", inReplyTo: undefined, references: undefined }));
  });

  it("yalnız kendine yazılan ileti yine gönderilir", async () => {
    const k = kur();
    expect((await k.service.iletiGonder("t1", { kime: ["satis@tekir.com"], konu: "Not", metin: "x" })).alicilar).toEqual(["satis@tekir.com"]);
  });

  it("başka kiracının iletisine yanıt reddedilir", async () => {
    const k = kur(null);
    await expect(k.service.iletiGonder("t1", { kime: ["a@b.com"], konu: "Ynt", metin: "x", yanitlananId: "baskasi" })).rejects.toThrow("Yanıtlanan e-posta bulunamadı");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("SMTP hatası kullanıcıya iletilir", async () => {
    const k = kur();
    sendMail.mockRejectedValueOnce(Object.assign(new Error("535 Authentication failed"), { code: "EAUTH", responseCode: 535 }));
    await expect(k.service.iletiGonder("t1", { kime: ["a@b.com"], konu: "K", metin: "x" })).rejects.toThrow("İleti gönderilemedi: 535 Authentication failed");
  });
});
