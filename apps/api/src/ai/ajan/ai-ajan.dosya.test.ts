import { BadRequestException } from "@nestjs/common";
import { kapiAcikTx } from "../ozellik-kapisi.test-veri";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { SenaryoAiProvider } from "../saglayici/mock-ai.provider";
import { AiAjanService } from "./ai-ajan.service";
import { AracYurutucu } from "./arac-yurutucu";

const KIMLIK = { tenantId: "11111111-1111-1111-1111-111111111111", userId: "22222222-2222-2222-2222-222222222222" };
const BELGE_ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";

/** AI-118: üretilen dosyanın web'de sohbet ekine, Telegram'da doğrudan gönderime gitmesi. */
function kur(secenek: { ekHatasi?: Error } = {}) {
  const tx = {
    ...kapiAcikTx(),
    user: { findFirst: vi.fn().mockResolvedValue({ adSoyad: "Ayşe Muhasebe" }) },
    ajanOturumu: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "oturum-1", userId: KIMLIK.userId }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ajanMesajGecmisi: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "mesaj-1" }), update: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const uc = {
    yetkiliMi: vi.fn(() => true),
    cagir: vi.fn(async (_u: { yol: string }, arg: unknown[]) => {
      const res = arg[arg.length - 1] as { setHeader(a: string, d: string): void; send(v: Buffer): void };
      res.setHeader("Content-Disposition", 'inline; filename="FTR2026000000001.pdf"');
      res.send(Buffer.from("%PDF-1.7 icerik"));
    }),
  };
  const ekler = {
    yukle: vi.fn(async (_tur: string, _sahip: string, d: { buffer: Buffer; originalname: string }) => {
      if (secenek.ekHatasi) throw secenek.ekHatasi;
      return { id: "ek-1", dosyaAdi: d.originalname, mimeTip: "application/pdf", boyut: d.buffer.length };
    }),
  };
  const saglayici = new SenaryoAiProvider([
    { metin: "", aracCagrilari: [{ id: "c1", ad: "belge_pdf", girdi: { tur: "fatura", id: BELGE_ID } }] },
    { metin: "FTR2026000000001 faturasının PDF'i hazırlandı.", aracCagrilari: [] },
  ]);
  const service = new AiAjanService(prisma as never, new AracYurutucu(uc as never, {} as never), undefined, ekler as never);
  service.saglayiciBul = async () => ({ saglayici, ozelTalimatlar: null });
  service.duzeltmeSaglayicisiBul = async () => saglayici;
  const calistir = (kanal: "WEB" | "TELEGRAM" = "WEB") =>
    istekBaglami.run({ deger: { ...KIMLIK, rol: "muhasebe" as never } }, () => service.mesajiIsle("Faturanın PDF'ini ver", "33333333-3333-4333-8333-333333333333", undefined, [], { kanal }));
  return { tx, uc, ekler, saglayici, calistir };
}

describe("asistan dosya yanıtı (AI-118)", () => {
  it("web: dosya sohbet ekine yazılır, yanıt ve kayıt yalnız künyeyi taşır", async () => {
    const k = kur();
    const y = await k.calistir();
    expect(k.ekler.yukle).toHaveBeenCalledWith("ai_sohbet", "oturum-1", expect.objectContaining({ originalname: "FTR2026000000001.pdf", size: 15 }), { sohbetCiktisi: true });
    expect(y.dosyalar).toEqual([{ ekId: "ek-1", dosyaAdi: "FTR2026000000001.pdf", mimeType: "application/pdf", boyut: 15 }]);
    expect(y.dosyaTamponlari).toBeUndefined();
    const kayit = k.tx.ajanMesajGecmisi.create.mock.calls.find(([a]) => a.data.rol === "assistant")![0];
    expect(kayit.data.aracCagrisi.dosyalar).toEqual(y.dosyalar);
    const saklananYanit = JSON.stringify(k.tx.ajanMesajGecmisi.update.mock.calls[0]![0].data.yanit);
    expect(saklananYanit).not.toContain("%PDF");
    expect(saklananYanit).toContain("ek-1");
    // Model dosya içeriğini görmez; yalnız adı ve boyutu.
    expect(JSON.stringify(k.saglayici.girdiler[1])).not.toContain("%PDF");
  });

  it("web: saklanamayan dosya yanıtı bozmaz, kartta nedeniyle görünür", async () => {
    const k = kur({ ekHatasi: new BadRequestException("Depolama kotası dolu. Dosya silin veya depolama sınırını artırın.") });
    const y = await k.calistir();
    expect(y.cevap).toContain("hazırlandı");
    expect(y.dosyalar).toEqual([{ dosyaAdi: "FTR2026000000001.pdf", mimeType: "application/pdf", boyut: 15, hata: "Depolama kotası dolu. Dosya silin veya depolama sınırını artırın." }]);
  });

  it("Telegram: dosya eke yazılmaz, tampon yalnız gönderim için döner ve kayda girmez", async () => {
    const k = kur();
    const y = await k.calistir("TELEGRAM");
    expect(k.ekler.yukle).not.toHaveBeenCalled();
    expect(y.dosyalar).toBeUndefined();
    expect(y.dosyaTamponlari?.map((d) => d.dosyaAdi)).toEqual(["FTR2026000000001.pdf"]);
    expect(JSON.stringify(k.tx.ajanMesajGecmisi.update.mock.calls[0]![0].data.yanit)).not.toContain("tampon");
  });
});
