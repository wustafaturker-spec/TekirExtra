import { describe, expect, it, vi } from "vitest";
import { OdemeSozuHatirlatmaService } from "../cari/odeme-sozu-hatirlatma.service";
import { DuzeltmeTaramaZamanlayiciService } from "../duzeltmeler/duzeltme-tarama-zamanlayici.service";
import { BankaSenkronZamanlayiciService } from "../kasa-banka/banka-senkron-zamanlayici.service";
import { RaporAbonelikZamanlayiciService } from "../rapor-abonelik/rapor-abonelik-zamanlayici.service";
import { EpostaZamanlayiciService } from "../tenant/eposta-zamanlayici.service";
import { AbonelikErisimService } from "./abonelik-erisim.service";

const ASKIDA = "11111111-1111-4111-8111-1111111111a1";
const ACIK = "11111111-1111-4111-8111-1111111111a2";
const erisim = { otomasyonDurdu: vi.fn(async (tenantId: string) => tenantId === ASKIDA) } as unknown as AbonelikErisimService;
/** Firma keşfi DB'ye gider; test için özel yöntem iki firma döndürür. */
const kesif = <T extends object>(servis: T, yontem: string, deger: unknown) => vi.spyOn(servis as never, yontem as never).mockResolvedValue(deger as never);

describe("askıdaki firmada zamanlanmış işler durur (PLT-05)", () => {
  it("banka çekimi yalnız açık firmada çalışır", async () => {
    const entegrasyon = { vadesiGelenleriCek: vi.fn(async () => ({ denenen: 0 })) };
    const s = new BankaSenkronZamanlayiciService(entegrasyon as never, erisim);
    kesif(s, "adayKiracilar", [ASKIDA, ACIK]);
    await s.calistir();
    expect(entegrasyon.vadesiGelenleriCek).toHaveBeenCalledTimes(1);
  });

  it("gelen e-posta eşitlemesi askıdaki firmayı atlar", async () => {
    const imap = { senkronizeEt: vi.fn(async () => ({ senkronizeEdildi: 0 })) };
    const s = new EpostaZamanlayiciService(imap as never, erisim);
    kesif(s, "imapAktifKiracilar", [{ tenant_id: ASKIDA }, { tenant_id: ACIK }]);
    await s.calistir();
    expect(imap.senkronizeEt.mock.calls).toEqual([[ACIK]]);
  });

  it("rapor aboneliği askıdaki firmaya gönderilmez", async () => {
    const servis = { gonder: vi.fn(async () => ({ durum: "gonderildi" })) };
    const s = new RaporAbonelikZamanlayiciService(servis as never, { increment: vi.fn() } as never, erisim);
    kesif(s, "vaktiGelenler", [{ id: "r1", tenant_id: ASKIDA }, { id: "r2", tenant_id: ACIK }]);
    await s.calistir();
    expect(servis.gonder.mock.calls).toEqual([[ACIK, "r2"]]);
  });

  it("düzeltme taraması askıdaki firmada kayıt üretmez", async () => {
    const duzeltmeler = { tara: vi.fn(async () => ({ bulunan: 0, otomatikCozulen: 0 })) };
    const s = new DuzeltmeTaramaZamanlayiciService(duzeltmeler as never, { increment: vi.fn(), set: vi.fn() } as never, erisim);
    kesif(s, "tenantIdleriAl", [ASKIDA, ACIK]);
    await s.calistir();
    expect(duzeltmeler.tara).toHaveBeenCalledTimes(1);
  });

  it("ödeme sözü e-postası askıdaki firmada hiç gönderilmez", async () => {
    const prisma = { tenantIslem: vi.fn() };
    const s = new OdemeSozuHatirlatmaService(prisma as never, { odemeSozuHatirlat: vi.fn() } as never, erisim);
    await expect(s.taraTenant(ASKIDA)).resolves.toEqual({ gonderilen: 0, atlanan: 0, hatali: 0 });
    expect(prisma.tenantIslem).not.toHaveBeenCalled();
  });

  it("abonelik okunamazsa iş durdurulmaz (geçici DB hatası otomasyonu kesmesin)", async () => {
    const prisma = { tenantIslem: vi.fn(async () => { throw new Error("bağlantı koptu"); }) };
    await expect(new AbonelikErisimService(prisma as never).otomasyonDurdu(ACIK)).resolves.toBe(false);
    const askida = { tenantIslem: vi.fn(async () => ({ durum: "askida", donemSonu: null, iptalTarihi: null })) };
    await expect(new AbonelikErisimService(askida as never).otomasyonDurdu(ASKIDA)).resolves.toBe(true);
  });
});
