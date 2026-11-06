import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));
const uygulamaDenetimi = vi.fn(async () => undefined);
vi.mock("./ebelge-uygulamasi.guard", () => ({ ebelgeUygulamasiDenetle: (...a: unknown[]) => uygulamaDenetimi(...(a as [])) }));

import { TopluFaturaService, topluFaturaSemasi } from "./toplu-fatura.service";
import { RISK_ONAYI_ISARETI } from "../cari/cari-islem-denetimi";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Kayit = { id: string; no: string | null; tip: string; durum: string; cari: { unvan: string }; ebelge: { id: string } | null };

function duzenek(kayitlar: Kayit[]) {
  const prisma = { tenantIslem: vi.fn(async (_t: string, is: (tx: unknown) => unknown) => is({ fatura: { findMany: vi.fn(async () => kayitlar) } })) };
  const faturalar = { kesinlestir: vi.fn(async (id: string) => ({ no: `TKR2026${id.slice(-3)}` })), taslagaGeriAl: vi.fn(async () => ({})) };
  const wizard = { gonderilebilir: true, neden: null as string | null, onDenetim: { bulgular: [] as { duzey: string }[] } } as Record<string, unknown>;
  const ebelge = { wizardBilgisi: vi.fn(async () => wizard), onDenetimOnayiDenetle: vi.fn(async () => null) };
  const kuyruk = { kuyrugaEkle: vi.fn(async () => ({})) };
  const servis = new TopluFaturaService(prisma as never, faturalar as never, ebelge as never, kuyruk as never, {} as never);
  return { servis, faturalar, ebelge, kuyruk, wizard };
}
const taslak = (n: number, ek: Partial<Kayit> = {}): Kayit => ({ id: ID(n), no: null, tip: "satis", durum: "taslak", cari: { unvan: `Cari ${n}` }, ebelge: null, ...ek });

describe("EBLG-152 şema", () => {
  it("50 sınırı ve tekilleştirme", () => {
    expect(topluFaturaSemasi.safeParse({ islem: "gonder", faturaIdler: Array.from({ length: 51 }, (_, i) => ID(i)) }).success).toBe(false);
    expect(topluFaturaSemasi.parse({ islem: "gonder", faturaIdler: [ID(1), ID(1), ID(2)] }).faturaIdler).toEqual([ID(1), ID(2)]);
    expect(topluFaturaSemasi.safeParse({ islem: "sil", faturaIdler: [ID(1)] }).success).toBe(false);
  });
});

describe("EBLG-152 toplu işlem", () => {
  beforeEach(() => { uygulamaDenetimi.mockReset(); uygulamaDenetimi.mockResolvedValue(undefined); });

  it("kesinleştir ve gönder: sırayla, seçim sırasında işler", async () => {
    const { servis, faturalar, kuyruk } = duzenek([taslak(2), taslak(1)]);
    const r = await servis.calistir("kesinlestir_gonder", [ID(1), ID(2)]);
    expect(faturalar.kesinlestir.mock.calls.map((c) => c[0])).toEqual([ID(1), ID(2)]);
    expect(kuyruk.kuyrugaEkle).toHaveBeenCalledTimes(2);
    expect(r.sonuclar.map((s) => [s.sonuc, s.no])).toEqual([["tamam", "TKR2026001"], ["tamam", "TKR2026002"]]);
  });

  it("uygun olmayanları atlar, diğerlerini sürdürür", async () => {
    const { servis, faturalar } = duzenek([taslak(1, { tip: "alis" }), taslak(2, { durum: "kesin", no: "X" }), taslak(3, { ebelge: { id: "e" } }), taslak(4)]);
    const r = await servis.calistir("kesinlestir", [ID(1), ID(2), ID(3), ID(4), ID(5)]);
    expect(r.sonuclar.map((s) => s.mesaj)).toEqual([
      "Toplu işlem yalnız satış ve satış iade faturalarında yapılır", "Fatura taslak değil",
      "Faturanın e-Belge kaydı var; durumunu e-Belge ayrıntısından izleyin", null, "Fatura bulunamadı"]);
    expect(faturalar.kesinlestir).toHaveBeenCalledTimes(1);
    expect(uygulamaDenetimi).not.toHaveBeenCalled();
  });

  it("kesinleştirme hatası satıra yazılır; risk onayı tek tek yönlendirilir", async () => {
    const { servis, faturalar, kuyruk } = duzenek([taslak(1), taslak(2)]);
    faturalar.kesinlestir.mockRejectedValueOnce(new ConflictException(`Cari risk limiti aşılıyor; ${RISK_ONAYI_ISARETI}`));
    const r = await servis.calistir("kesinlestir_gonder", [ID(1), ID(2)]);
    expect(r.sonuclar[0]).toMatchObject({ sonuc: "atlandi", kesinlesti: false, mesaj: expect.stringContaining("tek tek kesinleştirin") });
    expect(r.sonuclar[1]).toMatchObject({ sonuc: "tamam", kesinlesti: true, kuyrugaAlindi: true });
    expect(kuyruk.kuyrugaEkle).toHaveBeenCalledTimes(1);
  });

  it("sihirbaz engeli: fatura kesin kalır, kısmi sonuç ve neden", async () => {
    const { servis, kuyruk, wizard } = duzenek([taslak(1)]);
    wizard.kamu = { engeller: [{ mesaj: "Kamu alıcısının IBAN bilgisi eksik" }] };
    const r = await servis.calistir("kesinlestir_gonder", [ID(1)]);
    expect(r.sonuclar[0]).toMatchObject({ sonuc: "kismi", kesinlesti: true, kuyrugaAlindi: false, mesaj: expect.stringContaining("IBAN") });
    expect(kuyruk.kuyrugaEkle).not.toHaveBeenCalled();
  });

  it("onaylanmamış ön denetim uyarısı varsa gönderilmez", async () => {
    const { servis, ebelge, kuyruk, wizard } = duzenek([taslak(1, { durum: "kesin", no: "TKR1" })]);
    (wizard.onDenetim as { bulgular: { duzey: string }[] }).bulgular = [{ duzey: "uyari" }, { duzey: "bilgi" }];
    ebelge.onDenetimOnayiDenetle.mockRejectedValueOnce(new BadRequestException("onaylanmamış"));
    const r = await servis.calistir("gonder", [ID(1)]);
    expect(r.sonuclar[0]).toMatchObject({ sonuc: "atlandi", mesaj: "Ön denetimde onay bekleyen 1 uyarı var; e-Belge sihirbazında uyarıları görüp tek tek gönderin" });
    expect(ebelge.onDenetimOnayiDenetle).toHaveBeenCalledWith({ faturaId: ID(1) }, expect.any(Array), undefined);
    expect(kuyruk.kuyrugaEkle).not.toHaveBeenCalled();
  });

  it("gönderim içeren işlem e-Belge uygulaması yoksa başlamaz", async () => {
    const { servis, faturalar } = duzenek([taslak(1)]);
    uygulamaDenetimi.mockRejectedValueOnce(new ForbiddenException("kayıtlı değil"));
    await expect(servis.calistir("kesinlestir_gonder", [ID(1)])).rejects.toBeInstanceOf(ForbiddenException);
    expect(faturalar.kesinlestir).not.toHaveBeenCalled();
  });

  it("taslağa geri al: yalnız kesinler, hata satırda", async () => {
    const { servis, faturalar } = duzenek([taslak(1, { durum: "kesin", no: "A" }), taslak(2, { durum: "kesin", no: "B" }), taslak(3)]);
    faturalar.taslagaGeriAl.mockResolvedValueOnce({}).mockRejectedValueOnce(new BadRequestException("Tahsilat bağlı"));
    const r = await servis.calistir("taslaga_geri_al", [ID(1), ID(2), ID(3)]);
    expect(r.sonuclar.map((s) => [s.sonuc, s.taslagaAlindi, s.mesaj])).toEqual([["tamam", true, null], ["atlandi", false, "Tahsilat bağlı"], ["atlandi", false, "Fatura kesinleşmemiş"]]);
  });
});
