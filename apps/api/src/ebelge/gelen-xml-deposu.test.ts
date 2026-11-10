import { describe, expect, it, vi, afterEach } from "vitest";
import { GelenXmlDeposu, gelenXmlOku, gelenXmlYaz } from "./gelen-xml-deposu.service";
import { gelenXmlAc, gelenXmlAnahtari, gelenXmlOzeti, gelenXmlSikistir } from "./gelen-xml-kurallari";

const XML = "<Invoice>Türkçe içerik ğüşıöç</Invoice>";
function kur(yukle: () => Promise<void> = async () => undefined) {
  const yuklenen = new Map<string, Buffer>();
  const depo = { yukle: vi.fn(async (a: string, b: Buffer) => { await yukle(); yuklenen.set(a, b); }), indir: vi.fn(async (a: string) => yuklenen.get(a)!) };
  return { servis: new GelenXmlDeposu(depo as never), depo, yuklenen };
}
afterEach(() => vi.unstubAllEnvs());

describe("gelen XML deposu", () => {
  it("anahtar kiracıyla başlar, UUID özetlenir", () => {
    const a = gelenXmlAnahtari("t1", "../../baska/firma");
    expect(a).toMatch(/^t1\/gelen-ebelge\/[0-9a-f]{64}\.xml\.gz$/);
  });
  it("sıkıştırılan içerik birebir geri açılır, özet tutmazsa okunmaz", () => {
    const z = gelenXmlSikistir(XML);
    expect(gelenXmlAc(z, gelenXmlOzeti(XML))).toBe(XML);
    expect(() => gelenXmlAc(gelenXmlSikistir(`${XML} `), gelenXmlOzeti(XML))).toThrow("özet");
  });
  it("geçişte hem depoya hem veritabanına yazar", async () => {
    const { servis, yuklenen } = kur();
    const k = await servis.yaz("t1", "u1", XML);
    expect(k).toEqual({ xmlIcerik: XML, xmlAnahtar: gelenXmlAnahtari("t1", "u1"), xmlOzet: gelenXmlOzeti(XML) });
    expect(yuklenen.size).toBe(1);
  });
  it("veritabanı kopyası varken depo hatası belge alımını durdurmaz", async () => {
    const { servis } = kur(async () => { throw new Error("depo kapalı"); });
    expect(await servis.yaz("t1", "u1", XML)).toEqual({ xmlIcerik: XML, xmlAnahtar: null, xmlOzet: null });
  });
  it("kopya kapalıyken depo hatası belgeyi kaybettirmez, hata fırlatır", async () => {
    vi.stubEnv("GELEN_XML_DB_KOPYASI", "0");
    await expect(kur(async () => { throw new Error("depo kapalı"); }).servis.yaz("t1", "u1", XML)).rejects.toThrow("depo kapalı");
  });
  it("kopya kapalıyken yalnız depoya yazar ve oradan okur", async () => {
    vi.stubEnv("GELEN_XML_DB_KOPYASI", "0");
    const { servis, depo } = kur();
    const k = await servis.yaz("t1", "u1", XML);
    expect(k.xmlIcerik).toBeNull();
    expect(await servis.oku(k)).toBe(XML);
    expect(depo.indir).toHaveBeenCalledTimes(1);
  });
  it("veritabanı kopyası varsa depoya gitmez", async () => {
    const { servis, depo } = kur();
    expect(await servis.oku({ xmlIcerik: XML, xmlAnahtar: "x", xmlOzet: "y" })).toBe(XML);
    expect(depo.indir).not.toHaveBeenCalled();
  });
  it("kopya da anahtar da yoksa açık hata verir", async () => {
    await expect(kur().servis.oku({ xmlIcerik: null, xmlAnahtar: null, xmlOzet: null })).rejects.toThrow("bulunamadı");
    expect(() => gelenXmlOku({ xmlIcerik: null, xmlAnahtar: "a", xmlOzet: "b" })).toThrow("deposu bağlı değil");
  });
  it("depo bağlı değilse veritabanı kopyasıyla çalışır", async () => {
    expect(await gelenXmlYaz(undefined, "t1", "u1", XML)).toEqual({ xmlIcerik: XML });
    expect(await gelenXmlOku({ xmlIcerik: XML, xmlAnahtar: null, xmlOzet: null })).toBe(XML);
  });
});
