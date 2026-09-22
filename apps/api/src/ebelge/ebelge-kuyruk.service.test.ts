import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";

const bull = vi.hoisted(() => ({
  add: vi.fn(), getJob: vi.fn(), getJobs: vi.fn(), close: vi.fn(), on: vi.fn(), getWorkersCount: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class { add = bull.add; getJob = bull.getJob; getJobs = bull.getJobs; close = bull.close; on = bull.on; getWorkersCount = bull.getWorkersCount; },
  QueueEvents: class { on = vi.fn(); waitUntilReady = vi.fn(); close = vi.fn(); },
  Worker: class {},
  UnrecoverableError: class extends Error { name = "UnrecoverableError"; },
}));

describe("EbelgeKuyrukService", () => {
  const ebelge = { gonder: vi.fn(), durumSorgula: vi.fn(), gelenBelgeleriCek: vi.fn(), earsivRaporDurum: vi.fn() };
  const metrics = { increment: vi.fn() };
  let service: EbelgeKuyrukService;

  beforeEach(() => {
    vi.clearAllMocks(); bull.getJob.mockResolvedValue(null); bull.add.mockImplementation(async (_ad, data, opts) => ({ id: opts.jobId, data })); bull.getJobs.mockResolvedValue([]); bull.getWorkersCount.mockResolvedValue(1);
    service = new EbelgeKuyrukService(ebelge as never, metrics as never);
  });

  it("aynı tenant ve fatura için deterministik, tenant bağlamlı iş oluşturur", async () => {
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.kuyrugaEkle("fatura-1"));
    expect(sonuc).toMatchObject({ isId: "ebelge-gonder-tenant-1-fatura-1", durum: "waiting", tekrar: false });
    expect(bull.add).toHaveBeenCalledWith("ebelge-gonder", expect.objectContaining({ tenantId: "tenant-1", userId: "user-1", faturaId: "fatura-1" }), { jobId: "ebelge-gonder-tenant-1-fatura-1" });
    expect(metrics.increment).toHaveBeenCalledWith("ebelge_queue_jobs_total", { result: "enqueued" });
  });

  it("biten işi kaldırıp yeniden kuyruğa alır, gönderimi sessizce yutmaz", async () => {
    // Dead-letter'a düşen gönderimden sonra fatura ekranından "yeniden gönder"
    // denendiğinde iş kuyrukta kimliğiyle duruyordu; kaldırılmazsa kullanıcı
    // "gönderildi" mesajı alır ama hiçbir şey gönderilmez.
    const remove = vi.fn();
    bull.getJob.mockResolvedValue({ id: "ebelge-gonder-tenant-1-fatura-1", getState: async () => "failed", remove });

    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.kuyrugaEkle("fatura-1"));

    expect(remove).toHaveBeenCalled();
    expect(bull.add).toHaveBeenCalled();
    expect(sonuc).toMatchObject({ durum: "waiting", tekrar: false });
  });

  it("yeniden gönderimde eski dead-letter kaydını temizler, iş atlanmaz", async () => {
    // Ana iş kuyruktan düşmüş ama `dead-…` kaydı duruyor: worker yeni işi
    // atlıyor, fatura önceki hatasıyla kalıyordu (NES ihracat denemesi, 2026-09-19).
    const remove = vi.fn();
    bull.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "dead-ebelge-gonder-tenant-1-fatura-1", remove });

    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.kuyrugaEkle("fatura-1"));

    expect(bull.getJob).toHaveBeenLastCalledWith("dead-ebelge-gonder-tenant-1-fatura-1");
    expect(remove).toHaveBeenCalled();
    expect(bull.add).toHaveBeenCalledWith("ebelge-gonder", expect.objectContaining({ faturaId: "fatura-1" }), { jobId: "ebelge-gonder-tenant-1-fatura-1" });
    expect(sonuc).toMatchObject({ durum: "waiting", tekrar: false });
  });

  it("süren işi ikinci kez kuyruğa almaz", async () => {
    bull.getJob.mockResolvedValue({ id: "ebelge-gonder-tenant-1-fatura-1", getState: async () => "active", remove: vi.fn() });

    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.kuyrugaEkle("fatura-1"));

    expect(bull.add).not.toHaveBeenCalled();
    expect(sonuc).toMatchObject({ durum: "active", tekrar: true });
  });

  it("worker işlemini işin tenant bağlamında çalıştırır", async () => {
    ebelge.gonder.mockImplementation(async () => ({ basarili: true, tenantId: aktifBaglam().tenantId }));
    const sonuc = await (service as unknown as { isle(is: unknown): Promise<{ tenantId: string }> }).isle({ name: "ebelge-gonder", data: { tenantId: "tenant-worker", userId: "user-worker", rol: "muhasebe", faturaId: "fatura-2", correlationId: "corr", kuyrugaAlinmaZamani: new Date().toISOString() } });
    expect(sonuc.tenantId).toBe("tenant-worker");
    expect(ebelge.gonder).toHaveBeenCalledWith("fatura-2");
  });

  it("başarısız entegratör sonucunu retry için hata olarak yükseltir", async () => {
    ebelge.gonder.mockResolvedValue({ basarili: false, hataMesaji: "sağlayıcı geçici olarak kapalı" });
    await expect((service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ name: "ebelge-gonder", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", faturaId: "fatura-3" } })).rejects.toThrow("sağlayıcı geçici olarak kapalı");
  });

  it("entegratörün kalıcı reddini yeniden denetmez, asıl sebep kalır", async () => {
    ebelge.gonder.mockResolvedValue({ basarili: false, kalici: true, hataMesaji: "NES 422: HATALI ISTEK — SCHEMATRON_CHECK_RESULT_HAS_FAILED (ALICI EFATURA MUKELLEFIDIR)" });
    const hata = await (service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ name: "ebelge-gonder", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", faturaId: "fatura-3" } }).catch((e: Error) => e);
    expect(hata).toMatchObject({ name: "UnrecoverableError", message: expect.stringContaining("ALICI EFATURA MUKELLEFIDIR") });
  });

  it("kendi doğrulamamızın reddini de yeniden denetmez", async () => {
    ebelge.gonder.mockRejectedValue(new BadRequestException("Sevkiyatın nasıl belgelendiğini seçin"));
    const hata = await (service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ name: "ebelge-gonder", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", faturaId: "fatura-3" } }).catch((e: Error) => e);
    expect(hata).toMatchObject({ name: "UnrecoverableError", message: "Sevkiyatın nasıl belgelendiğini seçin" });
  });

  it("durum sorgusunu tenant ve fatura bazında tekilleştirir", async () => {
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.durumSorgulaKuyrugaEkle("fatura-9"));
    expect(sonuc).toMatchObject({ isId: "ebelge-durum-tenant-1-fatura-9", durum: "waiting" });
    expect(bull.add).toHaveBeenCalledWith("ebelge-durum-sorgula", expect.objectContaining({ isTuru: "ebelge-durum-sorgula", faturaId: "fatura-9" }), { jobId: "ebelge-durum-tenant-1-fatura-9" });
  });

  it("elle durum sorgusu eski dead-letter kaydını temizleyip yeniden kuyruğa alır (EBLG-38)", async () => {
    const remove = vi.fn();
    bull.getJob.mockResolvedValueOnce({ id: "dead-ebelge-durum-tenant-1-fatura-9", remove });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.durumSorgulaKuyrugaEkle("fatura-9"));
    expect(remove).toHaveBeenCalled();
    expect(bull.add).toHaveBeenCalledWith("ebelge-durum-sorgula", expect.objectContaining({ faturaId: "fatura-9" }), { jobId: "ebelge-durum-tenant-1-fatura-9" });
    expect(sonuc).toMatchObject({ durum: "waiting", tekrar: false });
  });

  it("sorgulanamayan belgede durum işini yeniden denemeden atlar (EBLG-38)", async () => {
    ebelge.durumSorgula.mockRejectedValue(new BadRequestException("Gönderimi yapılmamış belgenin durumu sorgulanamaz"));
    const is = { id: "ebelge-durum-tenant-1-fatura-6", name: "ebelge-durum-sorgula", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", isTuru: "ebelge-durum-sorgula", faturaId: "fatura-6" } };
    await expect((service as unknown as { isle(is: unknown): Promise<unknown> }).isle(is)).resolves.toMatchObject({ atlandi: true });

    // Entegratör hatası geçicidir, yeniden denenmek üzere yükselir.
    ebelge.durumSorgula.mockRejectedValue(new Error("NES 503"));
    await expect((service as unknown as { isle(is: unknown): Promise<unknown> }).isle(is)).rejects.toThrow("NES 503");
  });

  it("devam eden gelen belge senkronunu ikinci kez oluşturmaz", async () => {
    bull.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "gelen-belge-tenant-1", getState: vi.fn().mockResolvedValue("active") });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.gelenBelgeleriKuyrugaEkle());
    expect(sonuc).toEqual({ isId: "gelen-belge-tenant-1", durum: "active", tekrar: true });
    expect(bull.add).not.toHaveBeenCalled();
  });

  it("dead-letter işi periyodik planlayıcı tarafından otomatik yeniden oluşturulmaz", async () => {
    bull.getJob.mockResolvedValueOnce({ id: "dead-gelen-belge-tenant-1" });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "system", rol: "muhasebe" }, () => service.gelenBelgeleriKuyrugaEkle());
    expect(sonuc).toEqual({ isId: "dead-gelen-belge-tenant-1", durum: "dead-letter", tekrar: true });
    expect(bull.add).not.toHaveBeenCalled();
  });

  it("worker durum ve gelen belge işlerini doğru servis metoduna yönlendirir", async () => {
    ebelge.durumSorgula.mockResolvedValue({ durum: "kabul" });
    ebelge.gelenBelgeleriCek.mockResolvedValue({ toplamCekilen: 2, yeniBelgeSayisi: 1 });
    const temel = { tenantId: "tenant-worker", userId: "user-worker", rol: "muhasebe", correlationId: "corr", kuyrugaAlinmaZamani: new Date().toISOString() };
    await (service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ name: "ebelge-durum-sorgula", data: { ...temel, isTuru: "ebelge-durum-sorgula", faturaId: "fatura-4" } });
    await (service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ name: "gelen-belge-cek", data: { ...temel, isTuru: "gelen-belge-cek" } });
    expect(ebelge.durumSorgula).toHaveBeenCalledWith("fatura-4");
    expect(ebelge.gelenBelgeleriCek).toHaveBeenCalledOnce();
  });

  it("son denemesi tükenen işi dead-letter kuyruğuna kaydeder ve alarm metriği üretir", async () => {
    const veri = { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", isTuru: "ebelge-durum-sorgula", faturaId: "fatura-5", correlationId: "corr", kuyrugaAlinmaZamani: new Date().toISOString() };
    await (service as unknown as { deadLetteraTasi(is: unknown, hata: Error): Promise<void> }).deadLetteraTasi({ id: "job-5", name: "ebelge-durum-sorgula", data: veri }, new Error("kalıcı sağlayıcı hatası"));
    expect(bull.add).toHaveBeenCalledWith("ebelge-durum-sorgula", expect.objectContaining({ asilIsId: "job-5", hata: "kalıcı sağlayıcı hatası" }), { jobId: "dead-job-5" });
    expect(metrics.increment).toHaveBeenCalledWith("ebelge_queue_dead_letter_total", { type: "ebelge-durum-sorgula" });
  });

  it("e-Arşiv rapor sorgusunu kalıcı kuyruğa alır ve worker işler", async () => {
    ebelge.earsivRaporDurum.mockResolvedValue({ basarili: true, kod: "200" });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.earsivRaporKuyrugaEkle("rapor-1"));
    expect(sonuc).toMatchObject({ isId: "earsiv-rapor-tenant-1-rapor-1", durum: "waiting" });
    expect(bull.add).toHaveBeenCalledWith("earsiv-raporla", expect.objectContaining({ isTuru: "earsiv-raporla", raporUuid: "rapor-1" }), { jobId: "earsiv-rapor-tenant-1-rapor-1" });
    await (service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ name: "earsiv-raporla", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", isTuru: "earsiv-raporla", raporUuid: "rapor-1" } });
    expect(ebelge.earsivRaporDurum).toHaveBeenCalledWith("rapor-1");
  });

  it("başarısız e-Arşiv rapor işini rapor UUID'siyle yeniden kuyruğa alır", async () => {
    const remove = vi.fn();
    bull.getJob
      .mockResolvedValueOnce({
        id: "earsiv-rapor-tenant-1-rapor-2",
        name: "earsiv-raporla",
        data: { tenantId: "tenant-1", isTuru: "earsiv-raporla", raporUuid: "rapor-2" },
        getState: vi.fn().mockResolvedValue("failed"),
        remove,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.yenidenDene("earsiv-rapor-tenant-1-rapor-2"),
    );

    expect(remove).toHaveBeenCalledOnce();
    expect(sonuc).toMatchObject({ isId: "earsiv-rapor-tenant-1-rapor-2", durum: "waiting" });
    expect(bull.add).toHaveBeenCalledWith(
      "earsiv-raporla",
      expect.objectContaining({ raporUuid: "rapor-2" }),
      { jobId: "earsiv-rapor-tenant-1-rapor-2" },
    );
  });

  it("global ilk sayfa başka tenantla dolu olsa da hedef tenantın işlerini bulur", async () => {
    bull.getJobs
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ id: `diger-${i}`, data: { tenantId: "tenant-diger" } })))
      .mockResolvedValueOnce([{ id: "hedef-1", data: { tenantId: "tenant-1" } }]);

    const isler = await (service as unknown as {
      tenantIsleriniGetir(durumlar: string[], tenantId: string): Promise<Array<{ id: string }>>;
    }).tenantIsleriniGetir(["waiting"], "tenant-1");

    expect(isler.map((is) => is.id)).toEqual(["hedef-1"]);
    expect(bull.getJobs).toHaveBeenNthCalledWith(2, ["waiting"], 500, 999, true);
  });

  it("özet, kuyruğu dinleyen worker sayısını da söyler (EBLG-48)", async () => {
    bull.getWorkersCount.mockResolvedValue(0);

    const ozet = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.ozet());

    expect(ozet.calisanWorker).toBe(0);
    expect(ozet.sayilar).toMatchObject({ waiting: 0, "dead-letter": 0 });
  });

  it("worker sayısı okunamazsa null döner, ekran yanlış alarm vermesin (EBLG-48)", async () => {
    bull.getWorkersCount.mockRejectedValue(new Error("Redis yok"));

    const ozet = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.ozet());

    expect(ozet.calisanWorker).toBeNull();
  });
});
