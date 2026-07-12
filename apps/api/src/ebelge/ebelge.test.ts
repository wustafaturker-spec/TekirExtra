import { describe, expect, it, vi } from "vitest";
import { EbelgeService } from "./ebelge.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    rol: "muhasebe",
  }),
}));

vi.mock("../core/kripto", () => ({
  coz: (val: string) => val, // pass-through for config JSON
}));

describe("EbelgeService (EBLG-01..08)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;

  const mockAdapter = {
    mukellefSorgula: vi.fn().mockResolvedValue({ eFaturaMukellefi: true }),
    belgeGonder: vi.fn().mockResolvedValue({ basarili: true, belgeRef: "REF-123" }),
    durumSorgula: vi.fn().mockResolvedValue({ durum: "kabul" }),
    gelenBelgeleriCek: vi.fn().mockResolvedValue([
      {
        belgeNo: "GIB2026000000001",
        gonderenVkn: "1234567890",
        gonderenUnvan: "Tedarikçi A.Ş.",
        tarih: new Date(),
        xml: "<xml></xml>",
      },
    ]),
  };

  const mockBaglantilar = {
    adapterCoz: vi.fn().mockReturnValue(mockAdapter),
  } as any;

  const service = new EbelgeService(mockPrisma, mockBaglantilar);

  it("gonder alıcının e-Fatura mükellefiyetini sorgular, UBL uretir ve gönderir (EBLG-01/02/03)", async () => {
    const mockTx = {
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1",
          tip: "satis",
          durum: "kesin",
          tarih: new Date(),
          no: "TKR2026000000001",
          toplamBrut: 100,
          toplamMatrah: 100,
          toplamKdv: 20,
          genelToplam: 120,
          dovizCinsi: "TRY",
          toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          cari: { vknTckn: "1234567890", unvan: "Müşteri" },
        }),
      },
      baglanti: {
        findFirst: vi.fn().mockResolvedValue({
          saglayici: "izibiz",
          sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }),
        }),
      },
      cariHesap: {
        update: vi.fn().mockResolvedValue({}),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "9876543210" }),
      },
      ebelgeKayit: {
        upsert: vi.fn().mockResolvedValue({ id: "eb1" }),
      },
      ebelgeArsiv: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const sonuc = await service.gonder("f1");

    expect(mockAdapter.mukellefSorgula).toHaveBeenCalledWith(
      expect.any(Object),
      "1234567890",
    );
    expect(mockAdapter.belgeGonder).toHaveBeenCalled();
    expect(mockTx.ebelgeKayit.upsert).toHaveBeenCalledWith({
      where: { faturaId: "f1" },
      create: {
        tenantId: "t1-uuid",
        faturaId: "f1",
        tur: "efatura",
        durum: "iletildi",
        entegratorRef: "REF-123",
        hataMesaji: null,
      },
      update: {
        tur: "efatura",
        durum: "iletildi",
        entegratorRef: "REF-123",
        hataMesaji: null,
      },
    });
    expect(sonuc.basarili).toBe(true);
  });

  it("gelenBelgeleriCek entegratördeki gelen faturaları çekip sisteme taslak alış faturası olarak aktarır (EBLG-08)", async () => {
    const mockTx = {
      baglanti: {
        findFirst: vi.fn().mockResolvedValue({
          saglayici: "izibiz",
          sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }),
        }),
      },
      fatura: {
        findFirst: vi.fn().mockResolvedValue(null), // henüz eklenmemiş feneri
        create: vi.fn().mockResolvedValue({ id: "yeni-alis-faturasi-id" }),
      },
      cariHesap: {
        findFirst: vi.fn().mockResolvedValue({ id: "tedarikci-cari-id" }),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const sonuc = await service.gelenBelgeleriCek();

    expect(mockAdapter.gelenBelgeleriCek).toHaveBeenCalled();
    expect(mockTx.fatura.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tip: "alis",
        durum: "taslak",
        no: "GIB2026000000001",
        cariId: "tedarikci-cari-id",
      }),
    });
    expect(sonuc.yeniFaturaSayisi).toBe(1);
    expect(sonuc.eklenenFaturaIdler[0]).toBe("yeni-alis-faturasi-id");
  });
});
