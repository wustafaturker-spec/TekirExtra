import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { denklestir, mahsupEsle, type AcikFatura, type OdemeKaynagi } from "./denklestirme-hesap";

const D = (n: number) => new Prisma.Decimal(n);
const t = (g: string) => new Date(`2026-${g}T00:00:00Z`);
const f = (id: string, tip: AcikFatura["tip"], kalan: number, tarih: string, vade?: string, ek: Partial<AcikFatura> = {}): AcikFatura =>
  ({ id, no: id, tip, kalan: D(kalan), tarih: t(tarih), vadeTarihi: vade ? t(vade) : null, createdAt: t(tarih), ...ek });
const o = (id: string, yon: "A" | "B", tutar: number, tarih: string, tur: OdemeKaynagi["tur"] = "kasa_banka"): OdemeKaynagi =>
  ({ id, tur, yon, tutar: D(tutar), tarih: t(tarih), createdAt: t(tarih) });
const ozet = (k: ReturnType<typeof denklestir>) => k.map((x) => `${x.kaynakId}→${x.faturaId}:${x.tutar.toNumber()}`);

describe("vadeye göre denkleştirme (KSB-16)", () => {
  it("ödeme vadesi en erken faturayı önce kapatır (fatura tarihi sırasından bağımsız)", () => {
    const r = denklestir([f("F1", "satis", 100, "01-01", "03-01"), f("F2", "satis", 100, "01-10", "02-01")], [o("T1", "A", 150, "02-15")]);
    expect(ozet(r)).toEqual(["T1→F2:100", "T1→F1:50"]);
  });

  it("vadesiz fatura kendi tarihiyle sıralanır; avans sonradan kesilen faturayı kapatır", () => {
    const r = denklestir([f("F1", "satis", 80, "03-01")], [o("T0", "A", 50, "01-01"), o("T1", "A", 40, "03-05")]);
    expect(ozet(r)).toEqual(["T0→F1:50", "T1→F1:30"]);
  });

  it("satış iadesi önce açık satış faturasını kapatır, kalanı ödeme bekler", () => {
    const r = denklestir([f("F1", "satis", 100, "01-01"), f("I1", "satis_iade", 30, "01-05")], [o("T1", "A", 100, "01-10")]);
    expect(ozet(r)).toEqual(["I1→F1:30", "T1→F1:70"]);
  });

  it("göç öncesi iade kaynak olmaz; yönler karışmaz (tahsilat alış faturasını kapatmaz)", () => {
    const r = denklestir(
      [f("F1", "satis", 100, "01-01"), f("I1", "satis_iade", 30, "01-05", undefined, { kaynakOlabilir: false }), f("A1", "alis", 60, "01-01")],
      [o("T1", "A", 100, "01-10"), o("O1", "B", 20, "01-11", "kredi_karti")],
    );
    expect(ozet(r)).toEqual(["T1→F1:100", "O1→A1:20"]);
  });

  it("tedarikçiden alınan fazla tahsilat, ona yapılan ödemeden düşülür", () => {
    // 400 fazla tahsilat geri gelen paradır; 20'lik kart ödemesi alış faturasını kapatmaz.
    const r = denklestir([f("F1", "satis", 100, "01-01"), f("A1", "alis", 60, "01-01")], [o("T1", "A", 500, "01-10"), o("O1", "B", 20, "01-11", "kredi_karti")]);
    expect(ozet(r)).toEqual(["T1→F1:100"]);
  });

  it("alış iadesi tahsilatla kapanır (A yönü), alış faturasını da kapatabilir", () => {
    const r = denklestir([f("A1", "alis", 100, "01-01"), f("AI", "alis_iade", 130, "01-02")], [o("T1", "A", 30, "01-03")]);
    expect(ozet(r)).toEqual(["AI→A1:100", "T1→AI:30"]);
  });

  it("aynı vadede fatura tarihi, sonra numara; aynı tarihli kaynaklar kayıt sırasıyla", () => {
    const r = denklestir([f("F2", "satis", 10, "01-02", "02-01"), f("F1", "satis", 10, "01-01", "02-01")], [o("T2", "A", 10, "03-01"), o("T1", "A", 10, "03-01")]);
    expect(ozet(r)).toEqual(["T1→F1:10", "T2→F2:10"]);
  });

  it("müşteriye geri ödenen tutar tahsilattan düşülür; kapanan, carinin bakiyesini aşmaz", () => {
    // 100 tahsil edildi, 30 geri ödendi: 80'lik faturanın yalnız 70'i kapanır.
    const r = denklestir([f("F1", "satis", 80, "01-01")], [o("T1", "A", 100, "01-02"), o("O1", "B", 30, "01-03")]);
    expect(ozet(r)).toEqual(["T1→F1:70"]);
  });

  it("geri ödeme önce aynı yöndeki faturaları kapatır, yalnız artanı karşı yönden düşülür", () => {
    // Tedarikçiye 50 ödendi, 40'lık alış faturası var: yalnız 10 tahsilattan düşülür.
    const r = denklestir([f("F1", "satis", 100, "01-01"), f("A1", "alis", 40, "01-01")], [o("T1", "A", 60, "01-02"), o("O1", "B", 50, "01-03")]);
    expect(ozet(r)).toEqual(["T1→F1:50", "O1→A1:40"]);
  });

  it("iki yönde de fazla varsa her yön kendi faturalarını kapatır", () => {
    const r = denklestir([f("F1", "satis", 50, "01-01"), f("A1", "alis", 50, "01-01")], [o("T1", "A", 100, "01-02"), o("O1", "B", 200, "01-03")]);
    // Geri ödenen 150 tahsilatın tamamını götürür; satış açık kalır, alış kapanır.
    expect(ozet(r)).toEqual(["O1→A1:50"]);
  });
});

describe("alış–satış mahsubu eşleştirme (KSB-25)", () => {
  const f = (id: string, tip: "satis" | "alis" | "satis_iade" | "alis_iade", vade: string, kalan: string) =>
    ({ id, no: id, tip, tarih: new Date(vade), vadeTarihi: new Date(vade), createdAt: new Date(vade), kalan: new Prisma.Decimal(kalan) });

  it("tutar iki tarafın açık toplamının küçüğüdür; her taraf vade sırasıyla kapanır", () => {
    const r = mahsupEsle([f("s2", "satis", "2026-10-20", "300"), f("s1", "satis", "2026-10-01", "100"), f("a1", "alis", "2026-10-05", "250")]);
    expect(r.tutar.toFixed(2)).toBe("250.00");
    expect(r.satis.map((x) => [x.faturaId, x.tutar.toFixed(2)])).toEqual([["s1", "100.00"], ["s2", "150.00"]]);
    expect(r.alis.map((x) => [x.faturaId, x.tutar.toFixed(2)])).toEqual([["a1", "250.00"]]);
  });

  it("alış iadesi satış tarafında, satış iadesi alış tarafında sayılır; tek taraf boşsa mahsup yok", () => {
    const r = mahsupEsle([f("ai", "alis_iade", "2026-10-01", "40"), f("si", "satis_iade", "2026-10-02", "60")]);
    expect(r.tutar.toFixed(2)).toBe("40.00");
    expect(r.satis[0].faturaId).toBe("ai");
    expect(r.alis[0].faturaId).toBe("si");
    expect(mahsupEsle([f("s1", "satis", "2026-10-01", "100")]).tutar.toFixed(2)).toBe("0.00");
  });
});
