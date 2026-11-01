import { describe, expect, it } from "vitest";
import { baglantiOlusturSemasi, servisAdresiHatasi } from "./baglantilar.service";
import { epostaAyarlariSemasi } from "./eposta.service";

const mesajlar = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe("SEC-03 bağlantı servis adresleri", () => {
  it("iyzico adresi yalnız iyzipay.com altında olur", () => {
    const g = (servisAdresi: string) => baglantiOlusturSemasi.safeParse({ aile: "pos", saglayici: "iyzico", config: { kullaniciAdi: "k", parola: "p", servisAdresi } });
    expect(g("https://api.iyzipay.com").success).toBe(true);
    expect(mesajlar(g("http://redis:6379"))).toEqual([expect.stringMatching(/^Servis adresi: Adres https/)]);
    expect(mesajlar(g("https://169.254.169.254/latest/meta-data"))).toEqual([expect.stringMatching(/IP/)]);
    expect(mesajlar(g("https://kotu.example"))).toEqual([expect.stringMatching(/iyzipay\.com/)]);
  });

  it("e-Belge entegratöründe genel https adresi yeter; üç adres de denetlenir", () => {
    expect(servisAdresiHatasi("sovos", { servisAdresi: "https://efaturaws.fitbulut.com/x.svc", earsivServisAdresi: "https://earsivws.fitbulut.com/x.svc" })).toBeNull();
    expect(servisAdresiHatasi("sovos", { servisAdresi: "https://efaturaws.fitbulut.com/x.svc", irsaliyeServisAdresi: "https://localhost/x" })).toMatch(/^e-İrsaliye servis adresi/);
    expect(servisAdresiHatasi("sovos", { servisAdresi: "" })).toBeNull();
  });
});

describe("SEC-03 SMTP/IMAP ayarı", () => {
  const temel = { host: "smtp.gmail.com", port: 587, guvenlik: "starttls", gondericiAdi: "Firma", gondericiEposta: "a@firma.com", imapHost: "imap.gmail.com", imapPort: 993 };
  it("genel sunucu ve posta portları kabul edilir", () => {
    expect(epostaAyarlariSemasi.safeParse(temel).success).toBe(true);
    expect(epostaAyarlariSemasi.safeParse({ ...temel, imapHost: "" }).success).toBe(true);
  });
  it("iç ağ sunucusu ve posta dışı port reddedilir", () => {
    expect(mesajlar(epostaAyarlariSemasi.safeParse({ ...temel, host: "redis" }))).toEqual([expect.stringMatching(/SMTP sunucusu/)]);
    expect(mesajlar(epostaAyarlariSemasi.safeParse({ ...temel, host: "10.0.0.5" }))).toEqual([expect.stringMatching(/SMTP sunucusu/)]);
    expect(mesajlar(epostaAyarlariSemasi.safeParse({ ...temel, port: 6379 }))).toEqual([expect.stringMatching(/SMTP portu/)]);
    expect(mesajlar(epostaAyarlariSemasi.safeParse({ ...temel, imapHost: "postgres", imapPort: 5432 }))).toHaveLength(2);
  });
});
