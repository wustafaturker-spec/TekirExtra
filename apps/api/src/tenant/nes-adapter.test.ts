import { afterEach, describe, expect, it, vi } from "vitest";
import { NesEntegratorAdapter, nesBelgeDurumu, tekDosyaZipBase64, type EntegratorConfig } from "@tekirextra/baglanti";

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

/** Toplu mükellef listesi ucu ZIP döner; gövde ikili okunur. */
function zipYanit(xml: string) {
  const zip = Buffer.from(tekDosyaZipBase64("user_list.xml", xml), "base64");
  return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
}

const KULLANICI_LISTESI = `<?xml version="1.0" encoding="utf-8"?>
<UserList>
  <User>
    <Identifier>1234567802</Identifier>
    <Title>TEST &amp; KURUM - 02</Title>
    <Type>OZEL</Type>
    <AccountType>OZELENTEGRASYON</AccountType>
    <Aliases>
      <Alias><Name>urn:mail:eski_pk@turktelekom.com.tr</Name><CreationTime>2014-07-18T16:07:05</CreationTime></Alias>
      <Alias><Name>urn:mail:guncel_pk@mersel.io</Name><CreationTime>2025-05-26T13:31:39</CreationTime></Alias>
    </Aliases>
  </User>
</UserList>`;

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

    expect(sonuc).toEqual({ basarili: true, belgeRef: "belge-1", belgeNo: "TKR2026000000001" });
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

  it("otomatik seride entegratörün attığı numarayı geri döndürür", async () => {
    // Seri otomatikse UBL'e yalnız önek yazılır, numarayı NES atar (EBLG-16).
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({ uuid: "belge-9", documentNumber: "K072026000000014" })));

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-9", belgeNo: "K07", xml: "<Invoice/>", tur: "efatura",
      aliciPostaKutusu: "urn:mail:defaultpk@alici.test",
    });

    expect(sonuc).toEqual({ basarili: true, belgeRef: "belge-9", belgeNo: "K072026000000014" });
    expect(new NesEntegratorAdapter().belgeNoAtar).toBe(true);
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

  it("kaynak kaydımızla sağlayıcıda duran belgeyi bulur", async () => {
    // NES, UBL'deki cbc:UUID değerini belge kimliği olarak saklar; oraya
    // fatura kimliğimizi yazdığımız için uuid filtresiyle bulunur.
    const fetchMock = vi.fn().mockResolvedValue(yanit({ data: [{ id: "fatura-uuid-1", documentNumber: "K072026000000015" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const sonuc = await new NesEntegratorAdapter().belgeAra(config, "fatura-uuid-1", "efatura");

    expect(sonuc).toEqual({ basarili: true, belgeRef: "fatura-uuid-1", belgeNo: "K072026000000015" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("uuid=fatura-uuid-1");
  });

  it("e-Arşiv aramasında referansı ön ekle döndürür", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({ data: [{ id: "arsiv-1", documentNumber: "K072026000000015" }] })));
    await expect(new NesEntegratorAdapter().belgeAra(config, "fatura-uuid-1", "earsiv")).resolves.toEqual({
      basarili: true, belgeRef: "EARSIV:arsiv-1", belgeNo: "K072026000000015",
    });
  });

  it("belge yoksa arama tanımsız döner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({ data: [] })));
    await expect(new NesEntegratorAdapter().belgeAra(config, "fatura-uuid-1", "efatura")).resolves.toBeUndefined();
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

  it("çok etiketli mükellefte kendi entegratörümüzdeki varsayılan kutuyu seçer", async () => {
    // Canlı karşılığı: Kurum 02'nin 225 etiketi içinden gerçek trafiğin
    // kullandığı urn:mail:defaultpk@nes.com.tr seçilmeli. "En yeni" kuralı
    // burada mersel.io etiketini seçip yanlış kutuya gönderim yapardı.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      identifier: "1234567802",
      aliases: [
        { alias: "urn:mail:defaultpk@elogo.com.tr", creationTime: "2014-07-22T00:00:00" },
        { alias: "urn:mail:defaultpk@firma.test", creationTime: "2021-03-25T14:30:41" },
        { alias: "urn:mail:merkezpk@firma.test", creationTime: "2021-03-25T15:05:36" },
        { alias: "urn:mail:defaultpk-cgbilgi@mersel.io", creationTime: "2025-05-26T13:31:39" },
      ],
    })));

    const durum = await new NesEntegratorAdapter().mukellefSorgula(config, "1234567802");

    expect(durum.postaKutusu).toBe("urn:mail:defaultpk@firma.test");
    // Seçim bir tahmin; adaylar çağırana açılır ki gerekirse kullanıcıya sorulsun.
    expect(durum.postaKutulari).toHaveLength(4);
  });

  it("kendi entegratörümüzde etiket yoksa en yeni etikete düşer", async () => {
    // Hiçbir etiket bizim alan adımızda değil ve hiçbirinin yerel adı
    // "defaultpk" değil; geriye kalan tek sinyal güncelliktir.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      identifier: "1234567802",
      aliases: [
        { alias: "urn:mail:eski_pk@turktelekom.com.tr", creationTime: "2014-07-18T16:07:05", type: "Pk" },
        { alias: "urn:mail:guncel_pk@mersel.io", creationTime: "2025-05-26T13:31:39", type: "Pk" },
        { alias: "urn:mail:orta_pk@vadi.com.tr", creationTime: "2016-03-25T10:01:54", type: "Pk" },
      ],
    })));

    await expect(new NesEntegratorAdapter().mukellefSorgula(config, "1234567802")).resolves.toMatchObject({
      vknTckn: "1234567802",
      eFaturaMukellefi: true,
      postaKutusu: "urn:mail:guncel_pk@mersel.io",
    });
  });

  it("tek etiketli mükellefte aday listesi doldurulmaz", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      identifier: "1234567802",
      aliases: [{ alias: "urn:mail:defaultpk@alici.test", creationTime: "2024-01-01T00:00:00" }],
    })));

    const durum = await new NesEntegratorAdapter().mukellefSorgula(config, "1234567802");

    expect(durum.postaKutusu).toBe("urn:mail:defaultpk@alici.test");
    expect(durum.postaKutulari).toBeUndefined();
  });

  it("etiketi olmayan kaydı mükellef saymaz", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({ identifier: "1234567802", aliases: [] })));

    await expect(new NesEntegratorAdapter().mukellefSorgula(config, "1234567802")).resolves.toEqual({
      vknTckn: "1234567802",
      eFaturaMukellefi: false,
      postaKutusu: undefined,
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

  it("400 gövdesindeki alan hatasını mesaja taşır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      message: "GECERSIZ ISTEK",
      invalidFields: [{ field: "SenderAlias", description: "Gönderici Etiketi boş geçilemez!", detail: "" }],
    }, 400)));

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-4",
      belgeNo: "TKR2026000000004",
      xml: "<Invoice/>",
      tur: "earsiv",
    });

    // Yalnızca "GECERSIZ ISTEK" göstermek hangi alanın reddedildiğini gizlerdi.
    expect(sonuc.hataMesaji).toBe("NES 400: GECERSIZ ISTEK — SenderAlias: Gönderici Etiketi boş geçilemez!");
  });

  it("422 şematron hatasını kod ve açıklamasıyla birlikte verir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      message: "HATALI ISTEK",
      errors: [{ code: "1000", description: "SCHEMATRON_CHECK_RESULT_HAS_FAILED", detail: "ŞEMATRON KONTROL SONUCU HATALI" }],
    }, 422)));

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-5",
      belgeNo: "TKR2026000000005",
      xml: "<Invoice/>",
      tur: "earsiv",
    });

    expect(sonuc.hataMesaji).toBe(
      "NES 422: HATALI ISTEK — SCHEMATRON_CHECK_RESULT_HAS_FAILED (ŞEMATRON KONTROL SONUCU HATALI)",
    );
  });

  it("ProblemDetails biçimindeki hata sözlüğünü de okur", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({
      title: "One or more validation errors occurred.",
      errors: { File: ["The File field is required."] },
    }, 400)));

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-6",
      belgeNo: "TKR2026000000006",
      xml: "<Invoice/>",
      tur: "earsiv",
    });

    expect(sonuc.hataMesaji).toContain("File: The File field is required.");
  });

  it("403 yetki hatasında eksik scope'u ve ne yapılacağını söyler", async () => {
    // 403 gövdesi ötekilere benzemez; ham JSON basmak yol göstermez.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit({ role: null, scope: "earchive:outgoing:list:read" }, 403)));

    const sonuc = await new NesEntegratorAdapter().belgeGonder(config, {
      uuid: "fatura-7", belgeNo: "K07", xml: "<Invoice/>", tur: "earsiv",
    });

    expect(sonuc.hataMesaji).toContain("earchive:outgoing:list:read");
    expect(sonuc.hataMesaji).toContain("API Tanımları");
  });

  it("gövdesiz 401'de bile durum kodunu mesaja yazar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit("", 401)));

    const sonuc = await new NesEntegratorAdapter().baglantiTest(config);

    expect(sonuc).toEqual({ basarili: false, mesaj: "NES 401" });
  });

  it("mükellef listesini iki aileden indirip ayrıştırır", async () => {
    const fetchMock = vi.fn().mockResolvedValue(zipYanit(KULLANICI_LISTESI));
    vi.stubGlobal("fetch", fetchMock);

    const kayitlar = await new NesEntegratorAdapter().mukellefListesiCek(config);

    // NES listeyi belge ailesi başına ayrı ZIP'te verir, tek indirme yetmez.
    expect(fetchMock.mock.calls.map(([adres]) => String(adres))).toEqual([
      "https://apitest.nes.com.tr/einvoice/v1/users/zip/Pk",
      "https://apitest.nes.com.tr/edespatch/v1/users/zip/Pk",
    ]);
    expect(kayitlar).toEqual([
      { vknTckn: "1234567802", belgeTuru: "efatura", postaKutusu: "urn:mail:eski_pk@turktelekom.com.tr", unvan: "TEST & KURUM - 02" },
      { vknTckn: "1234567802", belgeTuru: "efatura", postaKutusu: "urn:mail:guncel_pk@mersel.io", unvan: "TEST & KURUM - 02" },
      { vknTckn: "1234567802", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:eski_pk@turktelekom.com.tr", unvan: "TEST & KURUM - 02" },
      { vknTckn: "1234567802", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:guncel_pk@mersel.io", unvan: "TEST & KURUM - 02" },
    ]);
  });

  it("e-İrsaliye modülü kapalıysa e-Fatura listesini yine de döndürür", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(zipYanit(KULLANICI_LISTESI))
      .mockResolvedValueOnce(yanit("", 403)));

    const kayitlar = await new NesEntegratorAdapter().mukellefListesiCek(config);

    expect(kayitlar).toHaveLength(2);
    expect(kayitlar.every((k) => k.belgeTuru === "efatura")).toBe(true);
  });

  it("e-Fatura listesi hata verirse eksik liste döndürmez", async () => {
    // Eksik liste tam sanılırsa gönderimler yanlış kanala kayar.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit("", 500)));

    await expect(new NesEntegratorAdapter().mukellefListesiCek(config)).rejects.toThrow("NES 500");
  });

  it("toplu durum ve zarf uçlarını NES desteklemediği için tanımlamaz", () => {
    const adapter = new NesEntegratorAdapter();
    // Tanımsız bırakılınca çağıran tekil sorguya düşer (EBLG-13, EBLG-14).
    expect(adapter.durumSorgulaToplu).toBeUndefined();
    expect(adapter.gelenZarflariCek).toBeUndefined();
  });
});
