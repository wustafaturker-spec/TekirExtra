import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { brifingMetni, brifingOncelikleri, brifingOnemi, brifingTamMetni, brifingVerisiTopla, oncelikleriDenetle, type UcOkuyucu } from "./gunluk-brifing";

const BUGUN = "2026-10-21";

function okuyucu(yanitlar: Record<string, () => unknown>): UcOkuyucu {
  return (async (uc: { yol: string }, arg: unknown[]) => {
    const f = yanitlar[uc.yol];
    if (!f) throw new ForbiddenException("Bu işlem için yetkiniz yok");
    return f.length ? (f as any)(...arg) : f();
  }) as UcOkuyucu;
}

/** `GET /ebelge/gelen/sayfa` sahtesi: süzgeci uygular, en fazla `adet` kayıt döner, sayacı tümünden verir. */
const gelenSayfa = (kutu: any[]) => (s: Record<string, string>) => {
  const uygun = kutu.filter((k) => (!s.durum || (k.durum ?? "beklemede") === s.durum) && (s.uyarili !== "true" || (k.denetimUyari ?? 0) > 0)
    && (!s.baslangic || k.tarih >= s.baslangic) && (!s.bitis || k.tarih <= s.bitis));
  return { kayitlar: uygun.slice(0, Number(s.adet ?? 50)), sonrakiImlec: null, ozet: { adet: uygun.length } };
};

const tam = {
  "GET /rapor/vadesi-gecenler": () => ({ toplamAlacak: "15000.00", alacakSayisi: 3, toplamBorc: "2000.00", borcSayisi: 1, alacaklar: [
    { cariUnvan: "Kaya", kalanTry: "1000.00", gecikmeGun: 40 }, { cariUnvan: "Deniz", kalanTry: "9000.00", gecikmeGun: 12 }, { cariUnvan: "Yıldız", kalanTry: "5000.00", gecikmeGun: 5 },
  ] }),
  "GET /nakit-akisi": () => ({ baslangicBakiye: 50000, senaryolar: { baz: { toplamGiris: 20000, toplamCikis: 80000, sonBakiye: -10000, ilkEksi: { tarih: "2026-10-24", bakiye: -3000 } } } }),
  "GET /ai/onay-ozeti": () => ({ bekleyen: 2, ornekler: ["Kesinleştirilecek: FTR1"] }),
  "GET /duzeltmeler/ozet": () => ({ acik: 5, kritik: 1, banaAtanan: 0, slaAsan: 2 }),
  "GET /satin-alma/talepler": () => [{ durum: "onay_bekliyor" }, { durum: "taslak" }],
  "GET /ebelge/gelen/sayfa": gelenSayfa([
    { belgeNo: "A1", gonderenUnvan: "Kaya", profilId: "TICARIFATURA", yanit: null, tarih: "2026-10-14", denetimUyari: 1 }, // son gün 22.10 → 1 gün
    { belgeNo: "A2", gonderenUnvan: "Deniz", profilId: "TICARIFATURA", yanit: null, tarih: "2026-10-01", denetimUyari: 0 }, // süresi geçmiş
    { belgeNo: "A3", gonderenUnvan: "Yıldız", profilId: "TEMELFATURA", yanit: null, tarih: "2026-10-14", denetimUyari: 0 },
    { belgeNo: "A4", gonderenUnvan: "Ece", profilId: "TICARIFATURA", yanit: null, tarih: "2026-10-12", denetimUyari: 0 }, // son gün 20.10 → geçti
    { belgeNo: "A5", gonderenUnvan: "Can", profilId: "TICARIFATURA", yanit: null, tarih: "2026-10-15", denetimUyari: 0, durum: "islendi" },
  ]),
  "GET /stok/kritik-ozeti": () => ({ kritikStok: 4 }),
};

describe("günlük brifing (AI-83)", () => {
  it("END-22: fiyat–endeks bölümü uç erişilebilirse eklenir, bulgu yoksa satır çıkmaz; uç reddederse bölüm atlanır", async () => {
    const ozet = { donem: { baslangic: "2025-10-01", bitis: "2026-09-30" }, makasAcilan: 3, endeksUstuTedarikci: { sayi: 2, ornekler: [] }, reelGerileyen: { sayi: 5, ornekler: [] }, erisilemeyen: [] };
    const v = await brifingVerisiTopla(okuyucu({ ...tam, "GET /fiyat-endeks/ozet": () => ozet }), BUGUN);
    expect(brifingMetni(v)).toContain("• Fiyat ve endeks (son 12 ay): 3 üründe marj makası açıldı; 2 tedarikçi Yİ-ÜFE'nin üzerinde zam yaptı; 5 ürünün satış fiyatı TÜFE karşısında reel geriledi.");
    const bos = await brifingVerisiTopla(okuyucu({ ...tam, "GET /fiyat-endeks/ozet": () => ({ ...ozet, makasAcilan: 0, endeksUstuTedarikci: { sayi: 0, ornekler: [] }, reelGerileyen: null }) }), BUGUN);
    expect(brifingMetni(bos)).not.toContain("Fiyat ve endeks");
    expect((await brifingVerisiTopla(okuyucu(tam), BUGUN)).fiyatEndeks).toBeUndefined();
  });

  it("bölümleri toplar; ticari faturada 8 günlük süresi dolmak üzere olanı bulur", async () => {
    const v = await brifingVerisiTopla(okuyucu(tam), BUGUN);
    expect(v.vade?.enEskiAlacaklar.map((a) => a.cari)).toEqual(["Deniz", "Yıldız", "Kaya"]);
    expect(v.nakit?.ilkEksi).toEqual({ tarih: "2026-10-24", bakiye: -3000 });
    expect(v.onaylar).toEqual({ asistan: 2, asistanOrnek: ["Kesinleştirilecek: FTR1"], satinAlma: 1 });
    expect(v.gelenFatura).toEqual({ bekleyen: 4, uyarili: 1, yanitiYaklasan: [{ no: "A1", gonderen: "Kaya", sonGun: "2026-10-22" }] });
    expect(v.kritikStok).toBe(4);
    expect(v.duzeltme).toEqual({ acik: 5, kritik: 1, banaAtanan: 0, slaAsan: 2 });
    expect(v.gelenIrsaliye).toBeUndefined();
    expect(brifingOnemi(v)).toBe("kritik");
  });

  it("gelen kutusu sayfalı uçtan okunur: sayılar sayaçtan, adaylar yalnız yaklaşan son gün aralığından", async () => {
    const cagrilar: Record<string, string>[] = [];
    const sahte = gelenSayfa([]);
    await brifingVerisiTopla(okuyucu({ "GET /ebelge/gelen/sayfa": (s: Record<string, string>) => (cagrilar.push(s), sahte(s)) }), BUGUN);
    expect(cagrilar).toEqual(expect.arrayContaining([
      { durum: "beklemede", adet: "1" },
      { durum: "beklemede", uyarili: "true", adet: "1" },
      { durum: "beklemede", baslangic: "2026-10-13", bitis: "2026-10-15", adet: "200" },
    ]));
    expect(cagrilar.every((s) => Number(s.adet) <= 200)).toBe(true);
  });

  it("e-İrsaliye tarihleri Date nesnesi gelse de süre hesaplanır", async () => {
    const v = await brifingVerisiTopla(okuyucu({ "GET /ebelge/irsaliye/gelen": () => [
      { belgeNo: "IRS1", gonderenUnvan: "Kaya", kendiSevkimiz: false, sevkTarihi: new Date("2026-10-15T09:00:00Z"), tarih: new Date("2026-10-15T00:00:00Z") },
      { belgeNo: "IRS2", gonderenUnvan: "Deniz", kendiSevkimiz: true, sevkTarihi: new Date("2026-10-15T09:00:00Z") },
    ] }), BUGUN);
    expect(v.gelenIrsaliye?.yanitBekleyen).toBe(1);
    expect(v.gelenIrsaliye?.yanitiYaklasan.map((x) => x.no)).toEqual(["IRS1"]);
  });

  it("rolün göremediği bölüm brifinge girmez", async () => {
    const v = await brifingVerisiTopla(okuyucu({ "GET /stok/kritik-ozeti": tam["GET /stok/kritik-ozeti"] }), BUGUN);
    expect(Object.keys(v).sort()).toEqual(["bugun", "kritikStok"]);
    const m = brifingMetni(v);
    expect(m).toContain("4 stok kartı");
    expect(m).not.toContain("Vadesi geçen");
    expect(brifingOnemi(v)).toBe("bilgi");
  });

  it("boş günde tek cümle yazar", () => {
    expect(brifingMetni({ bugun: BUGUN })).toContain("dikkat gerektiren bir kayıt yok");
  });

  it("metin tutarları Türkçe biçimde ve kaynaktan yazar", async () => {
    const m = brifingMetni(await brifingVerisiTopla(okuyucu(tam), BUGUN));
    expect(m).toContain("Vadesi geçen: 3 alacak (15.000,00 TL), 1 borç (2.000,00 TL)");
    expect(m).toContain("24.10.2026 günü eksiye düşüyor (-3.000,00 TL)");
    expect(m).toContain("A1 (Kaya, son gün 22.10.2026)");
  });

  it("kaynakta olmayan sayıyı kullanan öncelik atılır", () => {
    const kaynak = "Vadesi geçen: 3 alacak (15.000,00 TL)";
    expect(oncelikleriDenetle(["3 alacağı takip edin (15.000,00 TL)", "Bugün 50.000 TL tahsil edin", "Kaya'yı arayın"], kaynak)).toEqual(["3 alacağı takip edin (15.000,00 TL)", "Kaya'yı arayın"]);
  });

  it("model yoksa ya da hata verirse öncelik boş, brifing düz liste", async () => {
    expect(await brifingOncelikleri(null, "x")).toEqual([]);
    expect(await brifingOncelikleri({ saglayiciAdi: "openai", yapilandirilmisUretim: vi.fn(async () => { throw new Error("503"); }) } as any, "x")).toEqual([]);
    const s = { saglayiciAdi: "openai", yapilandirilmisUretim: vi.fn(async () => ({ oncelikler: ["Kaya'yı arayın"] })) } as any;
    expect(await brifingOncelikleri(s, "Kaya 1 gün")).toEqual(["Kaya'yı arayın"]);
    expect(s.yapilandirilmisUretim.mock.calls[0][0].dusunmeKapali).toBe(true);
    expect(brifingTamMetni("M", ["A"])).toBe("M\n\nBugünün öncelikleri (yapay zekâ önerisi):\n1. A");
  });
});
