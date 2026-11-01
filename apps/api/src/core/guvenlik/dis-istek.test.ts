import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { anaMakineHatasi, disAdresHatasi, disFetch, guvenliAdresCoz, ozelIpMi } from "./dis-istek";

describe("SEC-03 özel adres sınıflaması", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "198.18.0.1", "192.0.2.1", "203.0.113.5", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe",
  ])("%s özeldir", (ip) => expect(ozelIpMi(ip)).toBe(true));

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])("%s geneldir", (ip) => expect(ozelIpMi(ip)).toBe(false));
});

describe("SEC-03 kayıt anı adres denetimi", () => {
  it("https, kimliksiz, standart port ve genel alan adı ister", () => {
    expect(disAdresHatasi("https://efaturaws.fitbulut.com/ClientEInvoiceServices/ClientEInvoiceServicesPort.svc")).toBeNull();
    expect(disAdresHatasi("http://efaturaws.fitbulut.com")).toMatch(/https/);
    expect(disAdresHatasi("https://u:p@efaturaws.fitbulut.com")).toMatch(/kullanıcı/);
    expect(disAdresHatasi("https://efaturaws.fitbulut.com:6379")).toMatch(/443/);
    expect(disAdresHatasi("https://169.254.169.254/latest")).toMatch(/IP/);
    expect(disAdresHatasi("https://redis")).toMatch(/Yerel/);
    expect(disAdresHatasi("https://api.svc.cluster.internal")).toMatch(/Yerel/);
    expect(disAdresHatasi("https://127.0.0.1.nip.io")).toMatch(/dinamik/);
    expect(disAdresHatasi("gopher://x.com")).toMatch(/https/);
  });

  it("bilinen sağlayıcıda alan adı zorunludur", () => {
    expect(disAdresHatasi("https://sandbox-api.iyzipay.com", ["iyzipay.com"])).toBeNull();
    expect(disAdresHatasi("https://api.iyzipay.com", ["iyzipay.com"])).toBeNull();
    expect(disAdresHatasi("https://iyzipay.com.kotu.example", ["iyzipay.com"])).toMatch(/alan adında/);
    expect(disAdresHatasi("https://kotuiyzipay.com", ["iyzipay.com"])).toMatch(/alan adında/);
  });

  it("SMTP/IMAP sunucu adı", () => {
    expect(anaMakineHatasi("smtp.gmail.com")).toBeNull();
    expect(anaMakineHatasi("10.0.0.5")).toMatch(/IP/);
    expect(anaMakineHatasi("postgres")).toMatch(/Yerel/);
    expect(anaMakineHatasi("mail.firma.local")).toMatch(/Yerel/);
  });

  it("geliştirme izni üretimde çalışmaz", () => {
    vi.stubEnv("DIS_ISTEK_YEREL_IZNI", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(anaMakineHatasi("localhost")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(anaMakineHatasi("localhost")).toMatch(/IP|Yerel/);
    vi.unstubAllEnvs();
  });
});

describe("SEC-03 bağlantı anı denetimi (gerçek ağ)", () => {
  let sunucu: Server;
  let port = 0;
  const gelen: string[] = [];
  beforeAll(async () => {
    sunucu = createServer((istek, yanit) => { gelen.push(istek.url ?? ""); yanit.end("ic-servis"); });
    await new Promise<void>((r) => sunucu.listen(0, "127.0.0.1", () => r()));
    port = (sunucu.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => sunucu.close(() => r())));

  it("localhost'a çözülen ada bağlantı kurulmaz; iç servise istek ulaşmaz", async () => {
    await expect(disFetch(`http://localhost:${port}/gizli`)).rejects.toThrow();
    const hata = await disFetch(`http://localhost:${port}/gizli`).catch((h: Error & { cause?: Error }) => h.cause?.message ?? h.message);
    expect(hata).toMatch(/özel veya yerel/);
    expect(gelen).toEqual([]);
    // Karşılaştırma: korumasız fetch aynı servise ulaşabiliyor.
    expect(await (await fetch(`http://localhost:${port}/acik`)).text()).toBe("ic-servis");
  });

  it("SMTP/IMAP için çözülen IP sabitlenir; özel adres reddedilir", async () => {
    await expect(guvenliAdresCoz("localhost")).rejects.toThrow(/özel veya yerel|Yerel/);
    await expect(guvenliAdresCoz("127.0.0.1")).rejects.toThrow();
  });
});
