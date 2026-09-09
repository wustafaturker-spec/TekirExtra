import { afterEach, describe, expect, it, vi } from "vitest";
import { NesEntegratorAdapter, nesBelgeDurumu, type EntegratorConfig } from "@tekirextra/baglanti";

const config: EntegratorConfig = {
  saglayici: "nes",
  kullaniciAdi: "test01@nes.com.tr",
  apiAnahtari: "nes-api-anahtari",
  servisAdresi: "https://apitest.nes.com.tr",
  vknTckn: "1234567801",
  gondericiBirimEtiketi: "urn:mail:defaultgb@firma.test",
  postaKutusuEtiketi: "urn:mail:defaultpk@firma.test",
};

function yanit(govde: unknown, durum = 200) {
  return {
    ok: durum >= 200 && durum < 300,
    status: durum,
    text: async () => (typeof govde === "string" ? govde : JSON.stringify(govde)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("NesEntegratorAdapter", () => {
  it("e-Faturayı çok parçalı gövdeyle yükler ve Bearer anahtarı gönderir", async () => {
    const fetchMock = vi.fn().mockResolvedValue(yanit({ uuid: "belge-1", documentNumber: "TKR2026000000001" }));
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-1",
      belgeNo: "TKR2026000000001",
      xml: "<Invoice/>",
      tur: "efatura",
      aliciPostaKutusu: "urn:mail:defaultpk@alici.test",
    });

    expect(sonuc).toEqual({ basarili: true, belgeRef: "belge-1" });
    const [adres, istek] = fetchMock.mock.calls[0];
    expect(adres).toBe("https://apitest.nes.com.tr/einvoice/v1/uploads/document");
    expect(istek.headers.authorization).toBe("Bearer nes-api-anahtari");
    // FormData sınırını fetch kendisi kurar; elle content-type yazılmamalı.
    expect(istek.headers["content-type"]).toBeUndefined();
    expect(istek.body.get("SenderAlias")).toBe("urn:mail:defaultgb@firma.test");
    expect(istek.body.get("ReceiverAlias")).toBe("urn:mail:defaultpk@alici.test");
    expect(istek.body.get("SourceApp")).toBe("TekirExtra");
    expect(istek.body.get("SourceAppRecordId")).toBe("fatura-1");
  });

  it("e-Arşivi earchive ailesine yükler ve referansı ön ekle ayırır", async () => {
    const fetchMock = vi.fn().mockResolvedValue(yanit({ uuid: "arsiv-9" }));
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-2",
      belgeNo: "TKR2026000000002",
      xml: "<Invoice/>",
      tur: "earsiv",
    });

    expect(sonuc).toEqual({ basarili: true, belgeRef: "EARSIV:arsiv-9" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://apitest.nes.com.tr/earchive/v1/uploads/document");
  });

  it("alıcı posta kutusu yoksa e-Faturayı göndermez", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-3",
      belgeNo: "TKR2026000000003",
      xml: "<Invoice/>",
      tur: "efatura",
    });

    expect(sonuc.basarili).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("alıcının reddi zarf durumunu ezer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      outgoingStatus: "EnvelopeHasBeenTransferredToReceiverSuccessfully",
      documentAnswer: "Rejected",
      incomingAnswer: { answerNote: "Sipariş edilmeyen ürün" },
    })));

    await expect(new NesEntegratorAdapter().durumSorgula(config, "belge-1")).resolves.toEqual({
      belgeRef: "belge-1",
      durum: "ret",
      detay: "Sipariş edilmeyen ürün",
    });
  });

  it("tanınmayan durumu hata değil kuyrukta sayar", () => {
    // "hata" desek belge takipten düşer ve bir daha sorgulanmazdı.
    expect(nesBelgeDurumu("UnknownStatus", "None")).toBe("kuyrukta");
    expect(nesBelgeDurumu(undefined, undefined)).toBe("kuyrukta");
    expect(nesBelgeDurumu("XmlParseError", "None")).toBe("hata");
    expect(nesBelgeDurumu("EnvelopeSystemResponseIsBeingWaitedFromReceiver", "Waiting")).toBe("iletildi");
  });

  it("mükellefin posta kutusunu döndürür", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      identifier: "1234567802",
      aliases: [{ alias: "urn:mail:defaultpk@alici.test", type: "Pk" }],
    })));

    await expect(new NesEntegratorAdapter().mukellefSorgula(config, "1234567802")).resolves.toEqual({
      vknTckn: "1234567802",
      eFaturaMukellefi: true,
      postaKutusu: "urn:mail:defaultpk@alici.test",
    });
  });

  it("404'ü mükellef değil sayar, 401'i yukarı taşır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit("", 404)));
    await expect(new NesEntegratorAdapter().mukellefSorgula(config, "1234567802")).resolves.toEqual({
      vknTckn: "1234567802",
      eFaturaMukellefi: false,
    });

    // Yetki hatası yutulursa e-Fatura mükellefine e-Arşiv kesilirdi.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit("", 401)));
    await expect(new NesEntegratorAdapter().mukellefSorgula(config, "1234567802")).rejects.toThrow("NES 401");
  });

  it("gelen faturaya kabul/ret cevabını NES uçlarına bırakır", async () => {
    const fetchMock = vi.fn().mockResolvedValue(yanit(""));
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().yanitGonder(config, "gelen-7", "ret", "Sipariş edilmemiş");

    expect(sonuc).toEqual({ basarili: true, belgeRef: "gelen-7" });
    const [adres, istek] = fetchMock.mock.calls[0];
    expect(adres).toBe("https://apitest.nes.com.tr/einvoice/v1/incoming/invoices/gelen-7/documentAnswer");
    expect(JSON.parse(istek.body)).toEqual({ answerNote: "Sipariş edilmemiş", incomingInvoiceAnswerParameter: "RED" });
  });

  it("gelen faturaları sayfalayarak çeker ve mükerrer kaydı atlar", async () => {
    const satir = (id: string) => ({
      id,
      documentNumber: `FTR-${id}`,
      issueDate: "2026-09-01",
      accountingSupplierParty: { partyIdentification: "1234567890", partyName: "Tedarikçi AŞ" },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(yanit({ data: [satir("a"), satir("b")] }))
      .mockResolvedValueOnce(yanit("<Invoice>a</Invoice>"))
      .mockResolvedValueOnce(yanit("<Invoice>b</Invoice>"));
    vi.stubGlobal("fetch", fetchMock);

    const belgeler = await new NesEntegratorAdapter().gelenBelgeleriCek(config, new Date("2026-09-01T00:00:00Z"));

    expect(belgeler.map((b) => b.uuid)).toEqual(["a", "b"]);
    expect(belgeler[0]).toMatchObject({
      belgeNo: "FTR-a",
      gonderenVkn: "1234567890",
      gonderenUnvan: "Tedarikçi AŞ",
      xml: "<Invoice>a</Invoice>",
    });
    // İlk sayfa dolmadığı için ikinci sayfa istenmez.
    const listeCagrilari = fetchMock.mock.calls.filter(([adres]) => String(adres).includes("/incoming/invoices?"));
    expect(listeCagrilari).toHaveLength(1);
    expect(String(listeCagrilari[0][0])).toContain("pageSize=100");
  });

  it("e-Arşiv iptalinde fatura numarasını UUID'ye çevirip iptal eder", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(yanit({ data: [{ id: "arsiv-uuid-1" }] }))
      .mockResolvedValueOnce(yanit(""));
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().earsivIptal(config, {
      faturaNo: "TKR2026000000002",
      toplamTutar: "1180.00",
      iptalTarihi: new Date("2026-09-09T00:00:00Z"),
    });

    expect(sonuc.basarili).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("documentNumber=TKR2026000000002");
    expect(fetchMock.mock.calls[1][0]).toBe("https://apitest.nes.com.tr/earchive/v1/invoices/cancel");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ uuids: ["arsiv-uuid-1"] });
  });

  it("API anahtarı yoksa bağlantı testi ağ çağrısı yapmaz", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().baglantiTest({ ...config, apiAnahtari: undefined });

    expect(sonuc).toEqual({ basarili: false, mesaj: "NES API anahtarı zorunludur" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toplu durum ve zarf uçlarını NES desteklemediği için tanımlamaz", () => {
    const adapter = new NesEntegratorAdapter();
    // Tanımsız bırakılınca çağıran tekil sorguya düşer (EBLG-13, EBLG-14).
    expect(adapter.durumSorgulaToplu).toBeUndefined();
    expect(adapter.gelenZarflariCek).toBeUndefined();
  });
});
