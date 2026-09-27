import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CariService } from "./cari.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
}));
vi.mock("../core/kripto", () => ({ coz: () => "{}" }));

/** EBLG-86: cari kartında alıcının GİB posta kutusunu elle seçme. */
describe("CariService.postaKutusuSec", () => {
  /** `canli`: entegratörün canlı e-İrsaliye kutuları; verilmezse aktif bağlantı yok sayılır. */
  function kur(listede: boolean, canli?: string[]) {
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue(canli ? { saglayici: "nes", sifreliConfig: "x" } : null) },
      cariHesap: { findUnique: vi.fn().mockResolvedValue({ vknTckn: " 1234567803 " }), update: vi.fn().mockResolvedValue({}) },
      gibMukellef: { findFirst: vi.fn().mockResolvedValue(listede ? { vknTckn: "1234567803" } : null) },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as never;
    const irsaliyePostaKutulariSorgula = vi.fn().mockResolvedValue(canli ?? []);
    const servis = new CariService(prisma, {} as never, {} as never, {} as never, { adapterCoz: () => ({ irsaliyePostaKutulariSorgula }) } as never);
    vi.spyOn(servis, "getir").mockResolvedValue({} as never);
    return { servis, tx };
  }

  it("alıcının GİB listesindeki kutuyu kaydeder", async () => {
    const { servis, tx } = kur(true);
    await servis.postaKutusuSec("c1", { belgeTuru: "eirsaliye", postaKutusu: "urn:mail:defaultpk@nes.com.tr" });
    expect(tx.gibMukellef.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vknTckn: "1234567803", belgeTuru: "eirsaliye", postaKutusu: "urn:mail:defaultpk@nes.com.tr" } }));
    expect(tx.cariHesap.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { eirsaliyePostaKutusu: "urn:mail:defaultpk@nes.com.tr" } });
  });

  it("toplu listede olup entegratörün canlı listesinde olmayan e-İrsaliye kutusunu kaydetmez (EBLG-110)", async () => {
    const { servis, tx } = kur(true, ["urn:mail:defaultpki@ticari1as_edesp.com.tr"]);
    await expect(servis.postaKutusuSec("c1", { belgeTuru: "eirsaliye", postaKutusu: "urn:mail:defaultpk@nes.com.tr" })).rejects.toThrow(/güncel listesinde yok/);
    expect(tx.cariHesap.update).not.toHaveBeenCalled();
    await servis.postaKutusuSec("c1", { belgeTuru: "eirsaliye", postaKutusu: "urn:mail:defaultpki@ticari1as_edesp.com.tr" });
    expect(tx.cariHesap.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { eirsaliyePostaKutusu: "urn:mail:defaultpki@ticari1as_edesp.com.tr" } });
  });

  it("listede olmayan kutuyu kaydetmez", async () => {
    const { servis, tx } = kur(false);
    await expect(servis.postaKutusuSec("c1", { belgeTuru: "efatura", postaKutusu: "urn:mail:uydurma@x.com" })).rejects.toThrow(BadRequestException);
    expect(tx.cariHesap.update).not.toHaveBeenCalled();
  });

  it("seçimi kaldırınca kurala döner, liste sorulmaz", async () => {
    const { servis, tx } = kur(false);
    await servis.postaKutusuSec("c1", { belgeTuru: "efatura", postaKutusu: null });
    expect(tx.gibMukellef.findFirst).not.toHaveBeenCalled();
    expect(tx.cariHesap.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { efaturaPostaKutusu: null } });
  });
});
