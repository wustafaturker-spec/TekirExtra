import "reflect-metadata";
import "../src/ayar-tanimlari";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient, type Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { afterAll, expect, it } from "vitest";
import { AuthGuard } from "../src/auth/auth.guard";
import { RollerGuard } from "../src/auth/roller.guard";
import { baglamAl, bosTutucuylaCalistir } from "../src/core/istek-baglami";
import { RaporController } from "../src/rapor/rapor.controller";
import { RaporService } from "../src/rapor/rapor.service";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { AyarlarController } from "../src/core/ayarlar/ayarlar.controller";
import { veritabaniAdresiniDogrula } from "../scripts/ai-hazirlik-envanteri.lib.mjs";
import { maliyetOlcumunuDogrula } from "../../web/src/lib/maliyet-olcum";

const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
const db = new PrismaClient({ datasourceUrl: veritabaniAdresiniDogrula(process.env.DATABASE_URL) });
afterAll(() => db.$disconnect());

const requireArtifact = createRequire(import.meta.url);
const artifact = process.env.F01_API_DIST;
const runtime = artifact ? Object.assign({}, ...[
  "ayar-tanimlari.js", "core/ayarlar/ayarlar.service.js", "core/ayarlar/ayarlar.controller.js", "auth/auth.guard.js", "auth/roller.guard.js", "core/istek-baglami.js", "rapor/rapor.controller.js", "rapor/rapor.service.js",
].map((f) => requireArtifact(resolve(artifact, f)))) : { AuthGuard, RollerGuard, baglamAl, bosTutucuylaCalistir, RaporController, RaporService, AyarlarService, AyarlarController };

it("maliyet listesi: gerçek PostgreSQL RLS + JWT/HTTP yetkileri + kâr eşitliği; tüm test kayıtları rollback", async () => {
  const { AuthGuard, RollerGuard, baglamAl, bosTutucuylaCalistir, RaporController, RaporService, AyarlarService, AyarlarController } = runtime;
  const a = randomUUID(), b = randomUUID(), rollback = new Error("F01 izole test rollback");
  let tamam = false;
  try {
    await db.$transaction(async tx => {
      expect((await tx.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).toEqual([{ rolsuper: false, rolbypassrls: false }]);
      const rls = await tx.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('duzeltme_kayitlari', 'duzeltme_olaylari')`;
      expect(rls).toHaveLength(2);
      expect(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
      const baglam = async (id: string) => { await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`; };
      const kur = async (id: string) => {
        await baglam(id);
        await tx.tenant.create({ data: { id, vkn: id, unvan: "F01 izole test" } });
        const user = await tx.user.create({ data: { tenantId: id, eposta: `${id}@test.local`, parolaHash: "test", adSoyad: "Test", rol: "yonetici" } });
        await tx.modulAyar.create({ data: { tenantId: id, modul: "maliyet_kontrolu", ayarlar: { surum: 1, mod: "pilot" } } });
        const cari = await tx.cariHesap.create({ data: { tenantId: id, kod: "C1", unvan: "Test cari", tip: "musteri" } });
        const stok = await tx.stokKart.create({ data: { tenantId: id, kod: "U1", ad: "Test ürün", tip: "urun", mevcutMiktar: "-2" } });
        const hizmet = await tx.stokKart.create({ data: { tenantId: id, kod: "H1", ad: "Test hizmet", tip: "hizmet" } });
        const depo = await tx.depo.create({ data: { tenantId: id, kod: "D1", ad: "Test depo" } });
        return { tenantId: id, user, cari, stok, hizmet, depo };
      };
      const A = await kur(a), B = await kur(b);
      const fatura = async (s: typeof A, tutar: string, ek: Partial<Prisma.FaturaUncheckedCreateInput> = {}, stokId = s.stok.id) => {
        await baglam(s.tenantId);
        return tx.fatura.create({ data: {
          tenantId: s.tenantId, cariId: s.cari.id, tip: "satis", durum: "kesin", tarih: new Date("2026-10-01"),
          toplamBrut: tutar, toplamMatrah: tutar, genelToplam: tutar, toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0", ...ek,
          satirlar: { create: [{ tenantId: s.tenantId, stokId, miktar: "1", birimFiyat: tutar, matrah: tutar, toplamTutar: tutar, kdvOrani: "0", kdvTutari: "0", netKdvTutari: "0" }] },
        }, include: { satirlar: true } });
      };
      const hareket = async (f: Awaited<ReturnType<typeof fatura>>, maliyet: string, miktar = "-1", kaynakTur = "fatura") => tx.stokHareket.create({ data: {
        tenantId: a, stokId: A.stok.id, depoId: A.depo.id, tip: miktar.startsWith("-") ? "cikis" : "giris", miktar, girilenBirim: "adet", girilenMiktar: miktar.replace("-", ""), maliyet,
        tarih: new Date("2026-10-01"), kaynakTur, kaynakRef: f.id,
      } });
      const bKaynak = await fatura(B, "999999");
      const kaynak = await fatura(A, "100.10");
      await hareket(await fatura(A, "40"), "0"); // Meşru sıfır da olabilir: neden tahmin edilmez.
      const maliyetli = await fatura(A, "50");
      await hareket(maliyetli, "10");
      await fatura(A, "200", {}, A.hizmet.id);
      await fatura(A, "20", { tip: "satis_iade" });
      await fatura(A, "999", { durum: "iptal" });
      await fatura(A, "999", { durum: "taslak" });
      await fatura(A, "999", { tarih: new Date("2026-09-30") });
      await fatura(A, "999", { tarih: new Date("2026-10-16") });
      await fatura(A, "2", { dovizCinsi: "USD", kur: "40", tarih: new Date("2026-10-15") });
      await fatura(A, "0.10"); await fatura(A, "0.20");
      const snapshot = async () => {
        await baglam(a);
        return JSON.stringify({
          faturalar: await tx.fatura.findMany({ orderBy: { id: "asc" } }),
          hareketler: await tx.stokHareket.findMany({ orderBy: { id: "asc" } }),
          stoklar: await tx.stokKart.findMany({ orderBy: { id: "asc" } }),
        });
      };
      const once = await snapshot();
      await tx.duzeltmeKaydi.create({ data: { tenantId: a, tur: "stok", kaynakTur: "fatura_satiri", kaynakRef: kaynak.satirlar[0].id, nedenKodu: "DIGER_INCELEME", aciklama: "F01 dışı kayıt ölçüme katılmaz" } });
      const prisma = { tenantIslem: async (id: string, fn: (t: Prisma.TransactionClient) => Promise<unknown>) => {
        if (![a, b].includes(id)) throw new Error("TEST_KAPSAMI_DISI");
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true), set_config('app.user_id', ${baglamAl()?.userId ?? ""}, true)`;
        return fn(tx);
      } };
      Reflect.defineMetadata("design:paramtypes", [RaporService], RaporController);
      Reflect.defineMetadata("design:paramtypes", [AyarlarService], AyarlarController);
      class TestModule {}
      Module({ controllers: [RaporController, AyarlarController], providers: [Reflector, { provide: RaporService, useValue: new RaporService(prisma as never) }, { provide: AyarlarService, useValue: new AyarlarService(prisma as never) }] })(TestModule);
      const app = await NestFactory.create(TestModule, { logger: false });
      const jwt = new JwtService({ secret: randomUUID() }), reflector = app.get(Reflector);
      app.setGlobalPrefix("api/v1");
      app.use((_req: unknown, _res: unknown, next: () => void) => bosTutucuylaCalistir(next));
      app.useGlobalGuards(new AuthGuard(jwt, reflector), new RollerGuard(reflector));
      await app.listen(0, "127.0.0.1");
      const url = await app.getUrl();
      const istek = (path: string, rol = "yonetici", tenantId = a, token?: string) => fetch(`${url}/api/v1${path}`, {
        headers: { Authorization: `Bearer ${token ?? jwt.sign({ sub: tenantId === a ? A.user.id : B.user.id, tenantId, rol })}` },
      });
      const path = "/rapor/maliyet-eksikleri?baslangic=2026-10-01&bitis=2026-10-15";
      const izlemePath = path.replace("maliyet-eksikleri?", "maliyet-eksikleri/izleme?");
      const excelPath = path.replace("maliyet-eksikleri?", "maliyet-eksikleri/excel?");
      const excelOku = async (yol: string, tenantId = a) => {
        const r = await istek(yol, "yonetici", tenantId);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toContain("spreadsheetml.sheet");
        expect(r.headers.get("content-disposition")).toContain("maliyet-kontrolu_2026-10-01_2026-10-15.xlsx");
        expect(r.headers.get("cache-control")).toBe("no-store");
        const w = new ExcelJS.Workbook();
        await w.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
        return w;
      };
      try {
        expect((await istek(path, "yonetici", a, "bozuk")).status).toBe(401);
        expect((await istek(izlemePath, "yonetici", a, "bozuk")).status).toBe(401);
        expect((await istek(excelPath, "yonetici", a, "bozuk")).status).toBe(401);
        for (const rol of ["satis", "depo", "uretim_planlama", "b2b_bayi", "calisan"]) {
          expect((await istek(izlemePath, rol)).status).toBe(403);
          expect((await istek(path, rol)).status).toBe(403);
          expect((await istek(excelPath, rol)).status).toBe(403);
        }
        expect((await istek(path.replace("2026-10-01", "2026-02-30"))).status).toBe(400);
        expect((await istek(excelPath.replace("2026-10-01", "2026-02-30"))).status).toBe(400);
        const yanit = await istek(path); expect(yanit.status).toBe(200);
        const liste = await yanit.json();
        const olcumYanit = await istek(izlemePath); expect(olcumYanit.headers.get("cache-control")).toBe("no-store");
        const olcum = await olcumYanit.json();
        expect(maliyetOlcumunuDogrula(olcum)).toEqual(olcum);
        expect(olcum).toMatchObject({ surum: 1, olcumTuru: "anlik", firma: { id: a }, uyari: { satir: 5, ciro: "220.40", aktifTakipsizSatir: 5 }, incelemeler: { toplam: 0, medyanSureSaniye: null } });
        expect((await istek(`${izlemePath}&stokId=${A.stok.id}`)).status).toBe(400);
        expect((await istek(izlemePath.replace("2026-10-01", "2026-02-30"))).status).toBe(400);
        expect((await (await istek(izlemePath, "yonetici", b)).json()).uyari).toMatchObject({ satir: 1, ciro: "999999.00", aktifTakipsizSatir: 1 });
        expect(liste.donemOzeti).toEqual({ satir: 5, ciro: "220.40" });
        expect(liste.satirlar.map((s: any) => s.id)).toContain(kaynak.satirlar[0].id);
        expect(liste.satirlar.filter((s: any) => s.neden === "sifir_maliyet")).toHaveLength(1);
        const rapor = await (await istek("/rapor/gelir-gider?baslangic=2026-10-01&bitis=2026-10-15")).json();
        expect(rapor.karZarar.maliyetsizSatis).toEqual({ satir: liste.donemOzeti.satir, ciro: Number(liste.donemOzeti.ciro) });
        const sayfa = await (await istek(`${path}&sayfaBoyutu=2&sayfa=2`)).json();
        expect(sayfa.satirlar).toHaveLength(2); expect(sayfa.donemOzeti).toEqual(liste.donemOzeti);
        const excel = await excelOku(`${excelPath}&sayfaBoyutu=2&sayfa=2`);
        expect(excel.getWorksheet("Satışlar")!.rowCount).toBe(6);
        expect(excel.getWorksheet("Özet")!.getCell("B10").value).toBe(5);
        expect(excel.getWorksheet("Özet")!.getCell("B11").value).toBe(220.4);
        expect(new Set(excel.getWorksheet("Satışlar")!.getColumn(11).values.slice(2))).toEqual(new Set(liste.satirlar.map((s: any) => s.id)));
        const filtre = await (await istek(`${path}&neden=hareket_yok`)).json();
        expect(filtre.filtreOzeti).toEqual({ satir: 4, ciro: "180.40" });
        expect(filtre.donemOzeti).toEqual(liste.donemOzeti);
        const filtreExcel = await excelOku(`${excelPath}&neden=hareket_yok&stokId=${A.stok.id}`);
        expect(filtreExcel.getWorksheet("Satışlar")!.rowCount).toBe(5);
        expect(filtreExcel.getWorksheet("Özet")!.getCell("B11").value).toBe(180.4);
        const yabanci = await (await istek(`${path}&stokId=${B.stok.id}`)).json();
        expect(yabanci.filtreOzeti).toEqual({ satir: 0, ciro: "0.00" });
        expect(yabanci.satirlar).toEqual([]);
        const yabanciExcel = await excelOku(`${excelPath}&stokId=${B.stok.id}`);
        expect(yabanciExcel.getWorksheet("Satışlar")!.rowCount).toBe(1);
        expect(yabanciExcel.getWorksheet("Özet")!.getCell("B11").value).toBe(0);
        expect((await (await istek(path, "yonetici", b)).json()).donemOzeti).toEqual({ satir: 1, ciro: "999999.00" });
        const bExcel = await excelOku(excelPath, b);
        expect(bExcel.getWorksheet("Satışlar")!.rowCount).toBe(2);
        expect(bExcel.getWorksheet("Özet")!.getCell("B11").value).toBe(999999);
        for (const rol of ["muhasebe", "salt_okunur", "mali_musavir", "maliyet_muhasebesi"]) {
          const r = await istek(path, rol); expect(r.status).toBe(200);
          expect((await r.json()).izinler).toEqual({ fatura: rol !== "maliyet_muhasebesi", stok: rol !== "mali_musavir", onizleme: false, takipYazma: rol === "muhasebe" });
          const er = await istek(excelPath, rol); expect(er.status).toBe(200); await er.arrayBuffer();
        }
        const takipYol = `/rapor/maliyet-eksikleri/${kaynak.satirlar[0].id}/takip`;
        const yaz = (yol: string, govde: unknown, method = "POST", rol = "muhasebe") => fetch(`${url}/api/v1${yol}`, {
          method, headers: { Authorization: `Bearer ${jwt.sign({ sub: A.user.id, tenantId: a, rol })}`, "Content-Type": "application/json" }, body: JSON.stringify(govde),
        });
        expect((await (await istek(takipYol)).json()).kayit).toBeNull();
        for (const rol of ["salt_okunur", "mali_musavir", "maliyet_muhasebesi", "satis", "depo"]) {
          expect((await yaz(takipYol, { aciklama: "İlk kontrol" }, "POST", rol)).status).toBe(403);
          expect((await yaz(takipYol, {}, "PATCH", rol)).status).toBe(403);
        }
        const yabanciTakip = `/rapor/maliyet-eksikleri/${bKaynak.satirlar[0].id}/takip`;
        expect((await istek(yabanciTakip)).status).toBe(404);
        expect((await yaz(yabanciTakip, { aciklama: "İlk kontrol" })).status).toBe(404);
        expect((await yaz(`/rapor/maliyet-eksikleri/${maliyetli.satirlar[0].id}/takip`, { aciklama: "Kaynak maliyetli" })).status).toBe(409);
        expect((await yaz(takipYol, { aciklama: " " })).status).toBe(400);
        const ac = await yaz(takipYol, { aciklama: "Alış belgesi araştırılıyor" });
        expect(ac.status).toBe(201);
        const ilk = (await ac.json()).kayit;
        expect((await (await istek(izlemePath)).json()).uyari).toMatchObject({ aktifTakipliSatir: 1, aktifTakipsizSatir: 4 });
        expect(ilk._count.olaylar).toBe(1);
        expect(ilk.olaylar[0].user.adSoyad).toBe("Test");
        const tekrar = await (await yaz(takipYol, { aciklama: "Alış belgesi araştırılıyor" })).json();
        expect(tekrar.zatenVardi).toBe(true); expect(tekrar.kayit.id).toBe(ilk.id); expect(tekrar.kayit._count.olaylar).toBe(1);
        expect((await yaz(takipYol, { aciklama: "Doğrulanmadan kapatma", durum: "cozuldu", beklenenGuncelleme: ilk.updatedAt }, "PATCH")).status).toBe(400);
        const girdi = { aciklama: "Tedarikçiden belge bekleniyor", durum: "beklemede", beklenenGuncelleme: ilk.updatedAt };
        const degisen = await yaz(takipYol, girdi, "PATCH"); expect(degisen.status).toBe(200);
        const son = (await degisen.json()).kayit;
        expect(son.durum).toBe("beklemede"); expect(son._count.olaylar).toBe(2);
        expect((await yaz(takipYol, girdi, "PATCH")).status).toBe(409);
        for (const rol of ["muhasebe", "salt_okunur", "mali_musavir", "maliyet_muhasebesi"]) {
          const r = await istek(takipYol, rol); expect(r.status).toBe(200); expect((await r.json()).kayit._count.olaylar).toBe(2);
        }
        // Eski merkezde kapatılmış kaydı yeniden açmak yerine yeni inceleme oluşturulur.
        await tx.duzeltmeKaydi.update({ where: { id: son.id }, data: { durum: "yoksayildi", tekillikAnahtari: null } });
        const yeniden = await (await yaz(takipYol, { aciklama: "Yeni belgeyle inceleme" })).json();
        expect(yeniden.kayit.id).not.toBe(son.id);
        expect(yeniden.kayit.durum).toBe("acik");
        expect(await tx.duzeltmeOlayi.count({ where: { duzeltmeKaydiId: son.id } })).toBe(2);
        expect((await (await istek(path)).json()).donemOzeti).toEqual(liste.donemOzeti);
        expect(await snapshot()).toBe(once);
        const dogrulaYol = `${takipYol}/dogrulama`, kapatYol = `${takipYol}/kapat`;
        for (const rol of ["salt_okunur", "mali_musavir", "maliyet_muhasebesi", "satis", "depo"]) expect((await yaz(kapatYol, {}, "POST", rol)).status).toBe(403);
        expect((await istek(`${yabanciTakip}/dogrulama`)).status).toBe(404);
        expect((await (await istek(dogrulaYol)).json()).uygun).toBe(false);
        // Bundan sonraki hareket değişiklikleri yalnız fixture'dır; kapanış maliyet yazmaz.
        const duzelen = await hareket(kaynak, "10");
        const ilkKanit = await (await istek(dogrulaYol)).json();
        expect(ilkKanit).toMatchObject({ uygun: true, maliyet: "10.00", kayitId: yeniden.kayit.id });
        const kapatmaGovdesi = (r: any) => ({ kayitId: r.kayitId, beklenenGuncelleme: r.kayitSurumu, kanit: r.kanit, aciklama: "Kayıtlı maliyet ve hareketler incelendi" });
        const ayarYol = "/ayarlar/maliyet_kontrolu";
        expect((await yaz(ayarYol, { mod: "acik" }, "PUT")).status).toBe(403);
        expect((await yaz(ayarYol, { mod: "bilinmeyen" }, "PUT", "yonetici")).status).toBe(400);
        expect((await yaz(ayarYol, { surum: 2, mod: "acik" }, "PUT", "yonetici")).status).toBe(400);
        for (const mod of ["kapali", "salt_okunur", "acik", "pilot"]) {
          expect((await yaz(ayarYol, { mod }, "PUT", "yonetici")).status).toBe(200);
          for (const rol of ["yonetici", "muhasebe", "salt_okunur", "mali_musavir", "maliyet_muhasebesi"]) {
            for (const yol of [path, excelPath, takipYol, dogrulaYol, izlemePath]) {
              const cevap = await istek(yol, rol);
              expect(cevap.status).toBe(mod === "kapali" ? 403 : 200);
              if (yol === path && mod !== "kapali") {
                const veri = await cevap.json();
                expect(veri.kullanimModu).toBe(mod);
                expect(veri.izinler.takipYazma).toBe(["pilot", "acik"].includes(mod) && ["yonetici", "muhasebe"].includes(rol));
                expect(veri.izinler.onizleme).toBe(mod !== "salt_okunur" && rol === "yonetici");
              } else await cevap.arrayBuffer();
            }
            if (["kapali", "salt_okunur"].includes(mod)) {
              expect((await yaz(takipYol, { aciklama: "Engellenmeli" }, "POST", rol)).status).toBe(403);
              expect((await yaz(takipYol, { aciklama: "Engellenmeli", durum: "beklemede", beklenenGuncelleme: ilkKanit.kayitSurumu }, "PATCH", rol)).status).toBe(403);
              // Önceden alınmış geçerli kapanış kanıtı da modu aşamaz.
              expect((await yaz(kapatYol, kapatmaGovdesi(ilkKanit), "POST", rol)).status).toBe(403);
            }
          }
          expect((await (await istek(path, "yonetici", b)).json()).kullanimModu).toBe("pilot");
          expect((await (await istek("/rapor/gelir-gider?baslangic=2026-10-01&bitis=2026-10-15")).json()).karZarar.maliyetsizSatis.satir).toBe(4);
          expect((await tx.duzeltmeKaydi.findUniqueOrThrow({ where: { id: yeniden.kayit.id } })).durum).toBe("acik");
        }
        expect(await tx.auditLog.count({ where: { tenantId: a, islem: "maliyet_kontrol_modu_guncellendi" } })).toBe(4);
        await tx.modulAyar.delete({ where: { tenantId_modul: { tenantId: a, modul: "maliyet_kontrolu" } } });
        expect((await istek(path)).status).toBe(403); // Kaydı olmayan şirket varsayılan kapalı.
        await tx.modulAyar.create({ data: { tenantId: a, modul: "maliyet_kontrolu", ayarlar: { surum: 2, mod: "acik" } } });
        expect((await istek(path)).status).toBe(403); // Desteklenmeyen saklı sürüm de açılmaz.
        expect((await yaz(ayarYol, { mod: "pilot" }, "PUT", "yonetici")).status).toBe(200);
        await tx.stokHareket.update({ where: { id: duzelen.id }, data: { maliyet: "20" } });
        expect((await yaz(kapatYol, kapatmaGovdesi(ilkKanit))).status).toBe(409);
        await tx.faturaSatir.update({ where: { id: kaynak.satirlar[0].id }, data: { birim: "tanimsiz" } });
        expect((await (await istek(dogrulaYol)).json()).uygun).toBe(false);
        await tx.faturaSatir.update({ where: { id: kaynak.satirlar[0].id }, data: { birim: "adet" } });
        await tx.fatura.update({ where: { id: kaynak.id }, data: { durum: "taslak" } });
        expect((await (await istek(dogrulaYol)).json()).uygun).toBe(false);
        await tx.fatura.update({ where: { id: kaynak.id }, data: { durum: "kesin" } });
        await hareket(kaynak, "0");
        await tx.faturaSatir.update({ where: { id: kaynak.satirlar[0].id }, data: { miktar: "2" } });
        expect((await (await istek(dogrulaYol)).json()).uygun).toBe(false);
        await hareket(kaynak, "0", "1", "fatura_geri_alma");
        await tx.faturaSatir.update({ where: { id: kaynak.satirlar[0].id }, data: { miktar: "1" } });
        const sonKanit = await (await istek(dogrulaYol)).json();
        expect(sonKanit).toMatchObject({ uygun: true, maliyet: "20.00" });
        const kapanisOncesi = await snapshot();
        const kapanis = await yaz(kapatYol, kapatmaGovdesi(sonKanit)); expect(kapanis.status).toBe(201);
        const kapandi = (await kapanis.json()).kayit;
        expect(kapandi.id).toBe(yeniden.kayit.id); expect(kapandi.durum).toBe("cozuldu");
        expect(kapandi.olaylar.some((o: any) => o.olayTuru === "kayitli_maliyet_dogrulandi" && o.aciklama.includes("20.00 TRY"))).toBe(true);
        const denetim = await tx.auditLog.findMany({ where: { tenantId: a, varlikId: kapandi.id, islem: "maliyet_incelemesi_kapatildi" } });
        expect(denetim).toHaveLength(1);
        expect(denetim[0].detay).toMatchObject({ satirId: kaynak.satirlar[0].id, kanit: sonKanit.kanit, maliyet: "20.00" });
        expect((await yaz(kapatYol, kapatmaGovdesi(sonKanit))).status).toBe(409);
        expect(await snapshot()).toBe(kapanisOncesi);
        const sonrakiListe = await (await istek(path)).json();
        const sonrakiRapor = await (await istek("/rapor/gelir-gider?baslangic=2026-10-01&bitis=2026-10-15")).json();
        expect(sonrakiListe.donemOzeti).toEqual({ satir: 4, ciro: "120.30" });
        expect(sonrakiRapor.karZarar.maliyetsizSatis).toEqual({ satir: 4, ciro: 120.3 });
        const sonOlcum = await (await istek(izlemePath)).json();
        expect(maliyetOlcumunuDogrula(sonOlcum)).toEqual(sonOlcum);
        expect(sonOlcum.uyari).toMatchObject({ satir: 4, ciro: "120.30", aktifTakipsizSatir: 4 });
        expect(sonOlcum.incelemeler).toMatchObject({ toplam: 2, yoksayildi: 1, dogrulanmisKapanis: 1, digerKapanis: 0, sureOrnekSayisi: 1 });
        expect(Number(sonOlcum.incelemeler.medyanSureSaniye)).toBeGreaterThanOrEqual(0);
      } finally { await app.close(); }
      tamam = true; throw rollback;
    }, { timeout: 60000 });
  } catch (h) { if (h !== rollback) throw h; }
  expect(tamam).toBe(true);
  for (const id of [a, b]) await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    expect(await tx.tenant.findUnique({ where: { id } })).toBeNull();
  });
});
