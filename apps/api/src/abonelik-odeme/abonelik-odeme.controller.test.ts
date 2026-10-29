import { describe, expect, it, vi } from "vitest";
import { AbonelikOdemePublicController } from "./abonelik-odeme.controller";

function yanitKur() {
  const y: any = { basliklar: {} as Record<string, string>, durum: 0, govde: "" };
  y.setHeader = (k: string, v: string) => { y.basliklar[k] = v; };
  y.status = (d: number) => { y.durum = d; return y; };
  y.send = (g: string) => { y.govde = g; return y; };
  return y;
}

describe("PayTR kart formu ve bildirim uçları (PLT-13/14)", () => {
  it("form doğrudan PayTR'a gider, gizli alanlar kaçışlanır, sayfada betik yoktur", async () => {
    const odeme = { paytrForm: vi.fn(async () => ({ durum: "baslatildi", alanlar: { merchant_id: "1", user_basket: '[["A\\"<b>","478.80",1]]', paytr_token: "x+/=" }, firmaUnvani: "ÖRNEK <A.Ş.>", aciklama: "TekirExtra Başlangıç abonelik (1 ay)", toplam: "478.80", kartKaydet: true, testOrtami: true })) };
    const y = yanitKur();
    await new AbonelikOdemePublicController(odeme as any).paytrForm("t", "d", "tok", { ip: "203.0.113.9" } as any, y);
    expect(odeme.paytrForm).toHaveBeenCalledWith("t", "d", "tok", "203.0.113.9");
    expect(y.durum).toBe(200);
    expect(y.govde).toContain('<form method="post" action="https://www.paytr.com/odeme">');
    expect(y.govde).toContain('name="user_basket" value="[[&quot;A\\&quot;&lt;b&gt;&quot;,&quot;478.80&quot;,1]]"');
    expect(y.govde).toContain("ÖRNEK &lt;A.Ş.&gt;");
    expect(y.govde).toContain('name="card_number" autocomplete="cc-number"');
    expect(y.govde).not.toMatch(/<script/i);
    expect(y.basliklar["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(y.basliklar["Cache-Control"]).toBe("no-store");
  });

  it("kapanmış girişimde kart formu yerine bilgi sayfası", async () => {
    const y = yanitKur();
    await new AbonelikOdemePublicController({ paytrForm: async () => ({ durum: "odendi", alanlar: null }) } as any).paytrForm("t", "d", "tok", { ip: "1.1.1.1" } as any, y);
    expect(y.govde).toContain("Bu ödeme tamamlandı");
    expect(y.govde).not.toContain("card_number");
  });

  it("bildirim ucu işlendikten sonra düz 'OK' döner", async () => {
    const odeme = { paytrBildirim: vi.fn(async () => undefined) };
    expect(await new AbonelikOdemePublicController(odeme as any).paytrBildirim({ merchant_oid: "x" } as any)).toBe("OK");
  });
});
