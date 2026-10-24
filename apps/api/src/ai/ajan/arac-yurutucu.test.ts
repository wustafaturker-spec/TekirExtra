import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { istekBaglami } from "../../core/istek-baglami";
import type { AjanAraci, AracSinifi } from "./araclar/arac";

// Gerçek araç kataloğu ve onay/uç servisleri bu testin konusu değil; Prisma çalışma zamanını yüklemesinler.
vi.mock("./araclar", () => ({ AJAN_ARACLARI: [], aracBul: () => undefined }));
vi.mock("../onay/ai-onay.service", () => ({ AiOnayService: class {} }));
vi.mock("./uc-cagirici", () => ({ UcCagirici: class {} }));
vi.mock("../../core/prisma.service", () => ({ PrismaService: class {} }));

const { AracYurutucu } = await import("./arac-yurutucu");

const TENANT = "11111111-1111-1111-1111-111111111111";
const KULLANICI = "22222222-2222-2222-2222-222222222222";
const CARI = { id: "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f", kod: "120.01", unvan: "Ahmet Yılmaz Ltd.", vknTckn: "1234567890" };
const STOK = { id: "6e7f8091-2b3c-4d4e-9f0a-1b2c3d4e5f60", kod: "STK-1", ad: "Vida M8", barkod: null };

/** Tam eşleşme sorgusu (OR) boş, kısmi (contains) sorgusu verilen kayıtları döndürür. */
function prismaKur(tam: { cari?: unknown[]; stok?: unknown[] }, kismi: { cari?: unknown[]; stok?: unknown[] }) {
  const sorgu = (tur: "cari" | "stok") => vi.fn(async ({ where }: { where: Record<string, unknown> }) => ("OR" in where ? tam[tur] : kismi[tur]) ?? []);
  const tx = { cariHesap: { findMany: sorgu("cari") }, stokKart: { findMany: sorgu("stok") }, belge: { findMany: vi.fn() }, fatura: { findMany: vi.fn() } };
  return { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
}

function arac(sinif: AracSinifi): AjanAraci {
  return {
    ad: "deneme_araci",
    aciklama: "test",
    sinif,
    girdi: z.object({ cariId: z.string().uuid().optional(), satirlar: z.array(z.object({ stokId: z.string().uuid() })).optional() }),
    uc: {} as never,
    calistir: vi.fn(async (_b, g) => ({ calisti: g })),
    ...(sinif === "onay" ? { ozetle: async () => "özet" } : {}),
  };
}

function yurut(sinif: AracSinifi, girdi: unknown, prisma: ReturnType<typeof prismaKur>) {
  const a = arac(sinif);
  const onay = { olustur: vi.fn(async () => ({ id: "talep-1" })) };
  const yurutucu = new AracYurutucu({} as never, onay as never, prisma as never);
  const sonuc = istekBaglami.run({ deger: { tenantId: TENANT, userId: KULLANICI, rol: "yonetici" as never } }, () =>
    yurutucu.yurut({ ad: a.ad, girdi }, new Map([[a.ad, a]]), { kaynak: "asistan" }),
  );
  return { sonuc, a, onay };
}

describe("AracYurutucu kimlik çözümü", () => {
  it("okuma aracında kısmi ad tek adayla otomatik çözülür", async () => {
    const { sonuc, a } = yurut("okuma", { cariId: "Ahmet" }, prismaKur({}, { cari: [CARI] }));
    const s = await sonuc;
    expect(s.hata).toBeUndefined();
    expect(a.calistir).toHaveBeenCalledWith(expect.anything(), { cariId: CARI.id });
  });

  it("taslak aracında kısmi ad tek aday olsa da seçime döner, araç çalışmaz", async () => {
    const { sonuc, a } = yurut("taslak", { cariId: "Ahmet" }, prismaKur({}, { cari: [CARI] }));
    const s = await sonuc;
    expect(s.hata).toBe(true);
    expect(s.secim).toEqual({ tur: "cari", aranan: "Ahmet", adaylar: [CARI] });
    expect(a.calistir).not.toHaveBeenCalled();
  });

  it("onay aracında kısmi ad seçime döner, onay talebi açılmaz", async () => {
    const { sonuc, onay } = yurut("onay", { cariId: "Ahmet" }, prismaKur({}, { cari: [CARI] }));
    const s = await sonuc;
    expect(s.secim?.tur).toBe("cari");
    expect(onay.olustur).not.toHaveBeenCalled();
  });

  it("yazma aracında tam eşleşen kod/unvan otomatik çözülür", async () => {
    const { sonuc, a } = yurut("taslak", { cariId: "120.01" }, prismaKur({ cari: [CARI] }, {}));
    expect((await sonuc).hata).toBeUndefined();
    expect(a.calistir).toHaveBeenCalledWith(expect.anything(), { cariId: CARI.id });
  });

  it("yazma aracında satırdaki kısmi stok adı da seçime döner", async () => {
    const { sonuc, a } = yurut("taslak", { satirlar: [{ stokId: "Vida" }] }, prismaKur({}, { stok: [STOK] }));
    const s = await sonuc;
    expect(s.secim).toEqual({ tur: "stok", aranan: "Vida", adaylar: [STOK] });
    expect(a.calistir).not.toHaveBeenCalled();
  });
});
