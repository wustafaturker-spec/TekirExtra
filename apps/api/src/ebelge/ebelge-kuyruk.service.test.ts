import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { EbelgeKuyrukService, listeSenkronKiracisi } from "./ebelge-kuyruk.service";

const bull = vi.hoisted(() => ({
  add: vi.fn(), getJob: vi.fn(), getJobs: vi.fn(), close: vi.fn(), on: vi.fn(), getWorkersCount: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class { add = bull.add; getJob = bull.getJob; getJobs = bull.getJobs; close = bull.close; on = bull.on; getWorkersCount = bull.getWorkersCount; },
  QueueEvents: class { on = vi.fn(); waitUntilReady = vi.fn(); close = vi.fn(); },
  Worker: class {},
  UnrecoverableError: class extends Error { name = "UnrecoverableError"; },
  DelayedError: class extends Error { name = "DelayedError"; },
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
    expect(bull.add).toHaveBeenCalledWith("ebelge-gonder", expect.objectContaining({ tenantId: "tenant-1", userId: "user-1", faturaId: "fatura-1" }), expect.objectContaining({ jobId: "ebelge-gonder-tenant-1-fatura-1", attempts: 8 }));
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
    expect(bull.add).toHaveBeenCalledWith("ebelge-gonder", expect.objectContaining({ faturaId: "fatura-1" }), expect.objectContaining({ jobId: "ebelge-gonder-tenant-1-fatura-1", attempts: 8 }));
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

  it("gelen e-İrsaliye taramasını kiracı başına tek işte açar (EBLG-109)", async () => {
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "system", rol: "muhasebe" }, () => service.gelenIrsaliyeleriKuyrugaEkle());
    expect(sonuc).toMatchObject({ isId: "eirsaliye-gelen-tenant-1", durum: "waiting" });
    expect(bull.add).toHaveBeenCalledWith("eirsaliye-gelen-cek", expect.objectContaining({ isTuru: "eirsaliye-gelen-cek" }), { jobId: "eirsaliye-gelen-tenant-1" });
  });

  it("gelen e-İrsaliye işinde bizim taraftaki reddi atlar, entegratör hatasını yeniden denemeye bırakır (EBLG-109)", async () => {
    const eirsaliye = { gelenleriCek: vi.fn().mockRejectedValue(new BadRequestException("Aktif e-belge entegratör bağlantısı bulunamadı")) };
    const irsaliyeli = new EbelgeKuyrukService(ebelge as never, metrics as never, eirsaliye as never);
    const is = { id: "eirsaliye-gelen-tenant-1", name: "eirsaliye-gelen-cek", data: { tenantId: "tenant-1", userId: "system", rol: "muhasebe", isTuru: "eirsaliye-gelen-cek" } };
    const isle = (irsaliyeli as unknown as { isle(is: unknown): Promise<unknown> }).isle.bind(irsaliyeli);
    await expect(isle(is)).resolves.toMatchObject({ atlandi: true });
    eirsaliye.gelenleriCek.mockRejectedValue(new Error("fetch failed"));
    await expect(isle(is)).rejects.toThrow("fetch failed");
  });

  it("devam eden gelen belge senkronunu ikinci kez oluşturmaz", async () => {
    bull.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "gelen-belge-tenant-1", getState: vi.fn().mockResolvedValue("active") });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.gelenBelgeleriKuyrugaEkle());
    expect(sonuc).toEqual({ isId: "gelen-belge-tenant-1", durum: "active", tekrar: true });
    expect(bull.add).not.toHaveBeenCalled();
  });

  it("planlayıcı taze dead-letter kaydını bekler, gelen işini yeniden açmaz", async () => {
    const remove = vi.fn();
    bull.getJob.mockResolvedValueOnce({ id: "dead-gelen-belge-tenant-1", data: { deadLetterZamani: new Date(Date.now() - 10 * 60_000).toISOString() }, remove });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "system", rol: "muhasebe" }, () => service.gelenBelgeleriKuyrugaEkle());
    expect(sonuc).toEqual({ isId: "dead-gelen-belge-tenant-1", durum: "dead-letter", tekrar: true });
    expect(remove).not.toHaveBeenCalled();
    expect(bull.add).not.toHaveBeenCalled();
  });

  it("bekleme süresi dolan dead-letter kaydını temizleyip periyodik işi yeniden açar (EBLG-98)", async () => {
    // Bağlantı pasifken düşen gelen işi kutuyu bir gün boyunca durdurmuştu (2026-09-25).
    const remove = vi.fn();
    bull.getJob.mockResolvedValueOnce({ id: "dead-ebelge-durum-toplu-tenant-1", data: { deadLetterZamani: new Date(Date.now() - 2 * 3_600_000).toISOString() }, remove });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "system", rol: "muhasebe" }, () => service.durumlariTopluKuyrugaEkle());
    expect(remove).toHaveBeenCalled();
    expect(bull.add).toHaveBeenCalledWith("ebelge-durum-toplu", expect.anything(), { jobId: "ebelge-durum-toplu-tenant-1" });
    expect(sonuc).toMatchObject({ durum: "waiting", tekrar: false });
  });

  it("elle tazeleme taze dead-letter kaydını da temizler (EBLG-98)", async () => {
    const remove = vi.fn();
    bull.getJob.mockResolvedValueOnce({ id: "dead-gelen-belge-tenant-1", data: { deadLetterZamani: new Date().toISOString() }, remove });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.gelenBelgeleriKuyrugaEkle(true));
    expect(remove).toHaveBeenCalled();
    expect(sonuc).toMatchObject({ isId: "gelen-belge-tenant-1", durum: "waiting", tekrar: false });
  });

  it("periyodik olmayan işin dead-letter kaydı süre dolsa da beklenir", async () => {
    const remove = vi.fn();
    bull.getJob.mockResolvedValueOnce({ id: "dead-earsiv-rapor-tenant-1-r-1", data: { deadLetterZamani: new Date(Date.now() - 24 * 3_600_000).toISOString() }, remove });
    const sonuc = await baglamlaCalistir({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }, () => service.earsivRaporKuyrugaEkle("r-1"));
    expect(sonuc).toMatchObject({ durum: "dead-letter" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("bağlantısı pasife çekilen kiracının gelen işini yeniden denemeden atlar (EBLG-98)", async () => {
    ebelge.gelenBelgeleriCek.mockRejectedValue(new BadRequestException("Aktif e-belge bağlantısı bulunamadı"));
    const sonuc = await (service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ id: "gelen-belge-tenant-1", name: "gelen-belge-cek", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", isTuru: "gelen-belge-cek" } });
    expect(sonuc).toEqual({ atlandi: true, neden: "Aktif e-belge bağlantısı bulunamadı" });
  });

  it("gelen işinde entegratör hatası yeniden deneme için yükselir", async () => {
    ebelge.gelenBelgeleriCek.mockRejectedValue(new Error("NES 503"));
    await expect((service as unknown as { isle(is: unknown): Promise<unknown> }).isle({ id: "gelen-belge-tenant-1", name: "gelen-belge-cek", data: { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe", isTuru: "gelen-belge-cek" } })).rejects.toThrow("NES 503");
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

  describe("askıdaki firma (PLT-05)", () => {
    const erisim = { otomasyonDurdu: vi.fn(async (tenantId: string) => tenantId === "askida"), modulKapali: vi.fn().mockResolvedValue(false) };
    const isle = (svc: EbelgeKuyrukService, is: unknown, token?: string) => (svc as unknown as { isle(is: unknown, token?: string): Promise<unknown> }).isle(is, token);
    const veri = (tenantId: string) => ({ tenantId, userId: "user-1", rol: "muhasebe", faturaId: "fatura-1", correlationId: "c", kuyrugaAlinmaZamani: new Date().toISOString() });
    beforeEach(() => { service = new EbelgeKuyrukService(ebelge as never, metrics as never, undefined, erisim as never); });

    it("gönderim deneme hakkı harcanmadan ertelenir, entegratöre gidilmez", async () => {
      const moveToDelayed = vi.fn();
      const hata = await isle(service, { id: "j1", name: "ebelge-gonder", data: veri("askida"), moveToDelayed }, "tok").catch((e: Error) => e);
      expect((hata as Error).name).toBe("DelayedError");
      expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
      expect((moveToDelayed.mock.calls[0][0] as number) - Date.now()).toBeGreaterThan(14 * 60_000);
      expect(ebelge.gonder).not.toHaveBeenCalled();
    });

    it("gelen tarama atlanır; mükellef listesi ve açık firmanın işi sürer", async () => {
      await expect(isle(service, { id: "j2", name: "gelen-belge-cek", data: veri("askida") })).resolves.toEqual({ atlandi: true, neden: "firma askıda" });
      expect(ebelge.gelenBelgeleriCek).not.toHaveBeenCalled();
      const mukellef = vi.fn(async () => ({ eklenen: 0 }));
      (ebelge as Record<string, unknown>).mukellefListesiSenkronEt = mukellef;
      await isle(service, { id: "j3", name: "gib-mukellef-senkron", data: veri("askida") });
      expect(mukellef).toHaveBeenCalled();
      ebelge.gonder.mockResolvedValue({ basarili: true });
      await isle(service, { id: "j4", name: "ebelge-gonder", data: veri("acik") });
      expect(ebelge.gonder).toHaveBeenCalledWith("fatura-1");
    });
  });
});

describe("listeSenkronKiracisi", () => {
  const acik = { efatura: { acik: null, kaynak: "bilinmiyor" }, earsiv: { acik: null, kaynak: "bilinmiyor" }, eirsaliye: { acik: null, kaynak: "bilinmiyor" } } as const;
  const kapali = { ...acik, efatura: { acik: false, kaynak: "elle" } } as const;

  it("üretimde mock'lu sağlayıcının kiracısını atlar, çalışan bağlantılı kiracıyı seçer", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_MOCK_ENTEGRATIONS", "");
    try {
      const tenantlar = [
        { id: "izibiz", baglantilar: [{ saglayici: "izibiz" }] },
        { id: "kapali", baglantilar: [{ saglayici: "nes" }] },
        { id: "nes", baglantilar: [{ saglayici: "nes" }] },
      ];
      const uygulamalar = new Map<string, never>([["izibiz", acik as never], ["kapali", kapali as never], ["nes", acik as never]]);
      expect(listeSenkronKiracisi(tenantlar, uygulamalar)?.id).toBe("nes");
      expect(listeSenkronKiracisi(tenantlar.slice(0, 2), uygulamalar)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
