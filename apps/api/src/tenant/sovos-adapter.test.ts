import { afterEach, describe, expect, it, vi } from "vitest";
import { SovosEntegratorAdapter, tekDosyaZipBase64, zipIlkXml, type EntegratorConfig } from "@tekirextra/baglanti";

const config: EntegratorConfig = {
  saglayici: "sovos",
  kullaniciAdi: "ws-user",
  parola: "ws-pass",
  servisAdresi: "https://sovos.test/einvoice.svc",
  earsivServisAdresi: "https://sovos.test/earchive.svc",
  vknTckn: "1234567890",
  gondericiBirimEtiketi: "urn:mail:defaultgb@firma.test",
  postaKutusuEtiketi: "urn:mail:defaultpk@firma.test",
};

afterEach(() => vi.unstubAllGlobals());

describe("SovosEntegratorAdapter", () => {
  it("tek UBL'i geçerli ZIP başlığıyla base64 kodlar", () => {
    const zip = Buffer.from(tekDosyaZipBase64("fatura.xml", "<Invoice/>"), "base64");
    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(zip.includes(Buffer.from("fatura.xml"))).toBe(true);
    expect(zip.includes(Buffer.from("<Invoice/>"))).toBe(true);
    expect(zipIlkXml(zip.toString("base64"))).toBe("<Invoice/>");
  });

  it("SOAP Basic Auth ile e-Fatura gönderir ve zarf UUID'sini döndürür", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<S:Envelope><S:Body><sendUBLResponse><EnvUUID>zarf-123</EnvUUID></sendUBLResponse></S:Body></S:Envelope>`,
    });
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new SovosEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-1",
      belgeNo: "TKR2026000000001",
      xml: "<Invoice/>",
      tur: "efatura",
      aliciPostaKutusu: "urn:mail:defaultpk@alici.test",
    });

    expect(sonuc).toEqual({ basarili: true, belgeRef: "zarf-123" });
    const [adres, istek] = fetchMock.mock.calls[0];
    expect(adres).toBe(config.servisAdresi);
    expect(istek.headers.authorization).toBe(`Basic ${Buffer.from("ws-user:ws-pass").toString("base64")}`);
    expect(istek.body).toContain("<ein:ReceiverIdentifier>urn:mail:defaultpk@alici.test</ein:ReceiverIdentifier>");
    expect(istek.body).toContain("<ein:DocType>INVOICE</ein:DocType>");
  });

  it("Sovos 1300 durumunu kabul olarak normalize eder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<S:Envelope><S:Body><getEnvelopeStatusResponse><StatusCode>1300</StatusCode><StatusDescription>Başarıyla tamamlandı</StatusDescription></getEnvelopeStatusResponse></S:Body></S:Envelope>`,
    }));
    await expect(new SovosEntegratorAdapter().durumSorgula(config, "zarf-123")).resolves.toEqual({
      belgeRef: "zarf-123",
      durum: "kabul",
      detay: "Başarıyla tamamlandı",
    });
  });

  it("eksik Sovos yapılandırmasını ağ çağrısı yapmadan reddeder", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SovosEntegratorAdapter().baglantiTest({ saglayici: "sovos", kullaniciAdi: "x" }))
      .resolves.toEqual({ basarili: false, mesaj: "Sovos kullanıcı adı ve parolası zorunludur" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gelen listesindeki faturayı indirip ZIP içindeki UBL'yi çözer", async () => {
    const ubl = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>TED2026000000001</cbc:ID><cbc:UUID>fatura-uuid-1</cbc:UUID><cbc:IssueDate>2026-08-11</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cbc:EndpointID>urn:mail:defaultgb@tedarikci.test</cbc:EndpointID><cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Tedarikçi A.Ş.</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty></Invoice>`;
    const fetchMock = vi.fn().mockImplementation((_adres, istek) => {
      if (istek.body.includes("getUBLListRequest")) return Promise.resolve({ ok: true, text: async () => `<Envelope><Body><getUBLListResponse><UBLList><UUID>fatura-uuid-1</UUID><Identifier>pk</Identifier><VKN_TCKN>1111111111</VKN_TCKN><InsertDateTime>2026-08-11T10:00:00Z</InsertDateTime></UBLList></getUBLListResponse></Body></Envelope>` });
      return Promise.resolve({ ok: true, text: async () => `<Envelope><Body><getUBLResponse><DocData>${tekDosyaZipBase64("fatura-uuid-1.xml", ubl)}</DocData></getUBLResponse></Body></Envelope>` });
    });
    vi.stubGlobal("fetch", fetchMock);
    const belgeler = await new SovosEntegratorAdapter().gelenBelgeleriCek(config, new Date(Date.now() - 60_000));
    expect(belgeler).toHaveLength(1);
    expect(belgeler[0]).toMatchObject({ uuid: "fatura-uuid-1", belgeNo: "TED2026000000001", gonderenVkn: "1111111111", gonderenUnvan: "Tedarikçi A.Ş." });
  });

  it("ticari faturaya APP_RESP KABUL yanıtı gönderir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => `<Envelope><Body><sendUBLResponse><Response><EnvUUID>yanit-zarfi-1</EnvUUID></Response></sendUBLResponse></Body></Envelope>` });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new SovosEntegratorAdapter().yanitGonder(config, "fatura-uuid-1", "kabul", undefined, {
      gonderenVkn: "1111111111",
      xml: `<Invoice><cac:AccountingSupplierParty xmlns:cac="x" xmlns:cbc="y"><cbc:EndpointID>urn:mail:defaultgb@tedarikci.test</cbc:EndpointID></cac:AccountingSupplierParty></Invoice>`,
    });
    expect(sonuc).toEqual({ basarili: true, belgeRef: "yanit-zarfi-1" });
    expect(fetchMock.mock.calls[0][1].body).toContain("<ein:DocType>APP_RESP</ein:DocType>");
    expect(fetchMock.mock.calls[0][1].body).toContain("<ein:SenderIdentifier>urn:mail:defaultpk@firma.test</ein:SenderIdentifier>");
  });

  it("e-Arşiv UBL ZIP'ini ayrı servise gönderir ve durumunu sorgular", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => `<Envelope><Body><sendInvoiceResponseType><Detail>130:OK</Detail><Result><Result>SUCCESS</Result></Result><preCheckSuccessResults><preCheckSuccess><UUID>earsiv-uuid-1</UUID></preCheckSuccess></preCheckSuccessResults></sendInvoiceResponseType></Body></Envelope>` })
      .mockResolvedValueOnce({ ok: true, text: async () => `<Envelope><Body><getStatusResponseType><UUID>earsiv-uuid-1</UUID><statusCode>130</statusCode><Detail>Invoice is signed successfully</Detail></getStatusResponseType></Body></Envelope>` });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SovosEntegratorAdapter();
    const gonderim = await adapter.belgeGonder(config, {
      uuid: "fatura-2", belgeNo: "TKR2026000000002", tur: "earsiv",
      xml: `<Invoice><cac:AccountingCustomerParty xmlns:cac="x" xmlns:cbc="y"><cac:PartyIdentification><cbc:ID schemeID="TCKN">11111111111</cbc:ID></cac:PartyIdentification></cac:AccountingCustomerParty></Invoice>`,
    });
    expect(gonderim).toEqual({ basarili: true, belgeRef: "EARSIV:earsiv-uuid-1" });
    expect(fetchMock.mock.calls[0][0]).toBe(config.earsivServisAdresi);
    expect(fetchMock.mock.calls[0][1].body).toContain("<svc:sendInvoiceRequestType>");
    expect(fetchMock.mock.calls[0][1].body).toMatch(/<hash>[A-F0-9]{32}<\/hash>/);
    await expect(adapter.durumSorgula(config, "EARSIV:earsiv-uuid-1")).resolves.toEqual({ belgeRef: "EARSIV:earsiv-uuid-1", durum: "kabul", detay: "Invoice is signed successfully" });
  });

  it("e-Arşiv iptalini bildirir, raporları listeler ve rapor durumunu sorgular", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => `<Envelope><Body><invoiceCancellationServiceResponseType><Result><Result>SUCCESS</Result></Result><invoiceCancellation><message>Fatura iptal bilgileri kaydedildi.</message><code>1</code></invoiceCancellation></invoiceCancellationServiceResponseType></Body></Envelope>` })
      .mockResolvedValueOnce({ ok: true, text: async () => `<Envelope><Body><getReportListResponse><Result><Result>SUCCESS</Result></Result><Reports><uuid>rapor-1</uuid><periodCode>2026-08</periodCode><sectionStartDate>2026-08-11</sectionStartDate><sectionEndDate>2026-08-11</sectionEndDate><invoiceCount>3</invoiceCount><invoiceTotalAmount>1250.50</invoiceTotalAmount><gibStatus>190:Rapor henüz onaylanmadı</gibStatus></Reports></getReportListResponse></Body></Envelope>` })
      .mockResolvedValueOnce({ ok: true, text: async () => `<Envelope><Body><getReportStatusResponseType><Result><Result>SUCCESS</Result></Result><StatusCode>200</StatusCode><Detail>Report reached to the system</Detail></getReportStatusResponseType></Body></Envelope>` });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SovosEntegratorAdapter();
    await expect(adapter.earsivIptal(config, { faturaNo: "TKR2026000000003", toplamTutar: "1250.50", iptalTarihi: new Date("2026-08-12T00:00:00Z") })).resolves.toEqual({ basarili: true, mesaj: "Fatura iptal bilgileri kaydedildi." });
    await expect(adapter.earsivRaporListele(config, new Date("2026-08-11T00:00:00Z"), new Date("2026-08-12T00:00:00Z"))).resolves.toEqual([{ uuid: "rapor-1", donem: "2026-08", baslangic: "2026-08-11", bitis: "2026-08-11", faturaSayisi: 3, toplamTutar: "1250.50", gibDurumu: "190:Rapor henüz onaylanmadı" }]);
    await expect(adapter.earsivRaporDurum(config, "rapor-1")).resolves.toEqual({ basarili: true, kod: "200", mesaj: "Report reached to the system" });
    expect(fetchMock.mock.calls[0][1].body).toContain("<invoiceId>TKR2026000000003</invoiceId>");
    expect(fetchMock.mock.calls[1][1].body).toContain("<startDate>2026-08-11</startDate>");
  });
});
