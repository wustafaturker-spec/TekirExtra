import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/ayar-tanimlari";
import { BildirimService } from "../src/bildirimler/bildirim.service";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
import { KasaBankaService } from "../src/kasa-banka/kasa-banka.service";
import { MasraflarService } from "../src/masraflar/masraflar.service";
import { OnayGerekliHatasi } from "../src/onay/onay-kurallari";
import { OnayService } from "../src/onay/onay.service";

/**
 * ONY-01…10: genel onay akışı gerçek PostgreSQL'de, uygulama rolüyle (RLS). Kapı, onaycı listesi,
 * görev ayrılığı, iki adım, talep edenin adına yürütme, kayıt değişince geçersizlik, ret ve geri çekme.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const tenantId = randomUUID();
const [muhasebe, yonetici1, yonetici2] = [randomUUID(), randomUUID(), randomUUID()];
const [kategoriId, kucukMasraf, buyukMasraf, ikinciMasraf, ucuncuMasraf, kasaId] = Array.from({ length: 6 }, () => randomUUID());
let aktifKullanici = muhasebe;

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${aktifKullanici}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 60_000 }),
};
const donem = new DonemKilidiService(prisma as never);
const ayarlar = new AyarlarService(prisma as never);
const onay = new OnayService(prisma as never, ayarlar, new BildirimService(prisma as never));
const masraf = new MasraflarService(prisma as never, donem, {} as never, undefined, onay);
const kasa = new KasaBankaService(prisma as never, {} as never, donem, onay);
const olarak = <T>(userId: string, rol: string, fn: () => Promise<T>) => { aktifKullanici = userId; return baglamlaCalistir({ tenantId, userId, rol } as never, fn); };
const oku = <T>(fn: (t: PrismaClient) => Promise<T>) => prisma.tenantIslem(tenantId, (t: never) => fn(t as PrismaClient));
async function onayaTakilir(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (e) {
    if (e instanceof OnayGerekliHatasi) return (e.getResponse() as { onayTalebiId: string }).onayTalebiId;
    throw e;
  }
  throw new Error("İşlem onaya takılmadı");
}

beforeAll(async () => {
  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Onay Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  for (const [id, ad, rol] of [[muhasebe, "Meral Muhasebe", "muhasebe"], [yonetici1, "Yeliz Yönetici", "yonetici"], [yonetici2, "Yusuf Yönetici", "yonetici"]] as const) {
    await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${tenantId}::uuid, ${`ony-${id}@test.local`}, 'x', ${ad}, ${rol}::"Rol", now())`;
  }
  await y.$executeRaw`INSERT INTO masraf_kategorileri (id, tenant_id, ad, updated_at) VALUES (${kategoriId}::uuid, ${tenantId}::uuid, 'Kırtasiye', now())`;
  for (const [id, toplam] of [[kucukMasraf, 5000], [buyukMasraf, 50000], [ikinciMasraf, 30000], [ucuncuMasraf, 20000]] as const) {
    await y.$executeRawUnsafe(`INSERT INTO masraflar (id, tenant_id, kategori_id, belge_turu, tarih, matrah, kdv_tutari, toplam, durum, aciklama, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'fis', '2026-11-10', $4, 0, $4, 'taslak', 'deneme', now())`, id, tenantId, kategoriId, toplam);
  }
  await y.$executeRaw`INSERT INTO kasalar (id, tenant_id, ad, created_at, updated_at) VALUES (${kasaId}::uuid, ${tenantId}::uuid, 'Merkez', now(), now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("genel onay akışları (ONY-01…10)", () => {
  it("eşiğin altı geçer; üstü onaya takılır, işlem yapılmaz, onaycıya bildirim düşer", async () => {
    await olarak(yonetici1, "yonetici", () => onay.kuralKaydet(null, { islem: "masraf_onayla", ad: "Büyük masraf", tutarEsigi: 10000, adimlar: [{ rol: "yonetici" }] }));
    await olarak(muhasebe, "muhasebe", () => masraf.onayla(kucukMasraf));
    const talepId = await onayaTakilir(() => olarak(muhasebe, "muhasebe", () => masraf.onayla(buyukMasraf)));
    expect((await oku((t) => t.masraf.findUnique({ where: { id: buyukMasraf } })))?.durum).toBe("taslak");
    expect((await oku((t) => t.masraf.findUnique({ where: { id: kucukMasraf } })))?.durum).toBe("onaylandi");
    const bildirim = await oku((t) => t.bildirim.findFirst({ where: { tur: "onay", kaynakRef: talepId } }));
    expect(bildirim?.baslik).toContain("Masraf onaylama");
    // Aynı kayıt için ikinci talep açılmaz.
    await expect(olarak(muhasebe, "muhasebe", () => masraf.onayla(buyukMasraf))).rejects.toThrow(/bekleyen bir onay talebi/);
  });

  it("talep eden kendi kutusunda göremez ve onaylayamaz; yönetici onaylayınca talep edenin adına yürütülür", async () => {
    expect((await olarak(muhasebe, "muhasebe", () => onay.liste("bekleyen"))).talepler).toHaveLength(0);
    const kutu = await olarak(yonetici1, "yonetici", () => onay.liste("bekleyen"));
    expect(kutu.talepler).toHaveLength(1);
    const talepId = kutu.talepler[0].id;
    await expect(olarak(muhasebe, "muhasebe", () => onay.karar(talepId, "onay"))).rejects.toThrow(/onaycısı değilsiniz/);
    const sonuc = await olarak(yonetici1, "yonetici", () => onay.karar(talepId, "onay"));
    expect(sonuc.durum).toBe("onaylandi");
    expect((await oku((t) => t.masraf.findUnique({ where: { id: buyukMasraf } })))?.durum).toBe("onaylandi");
    const iz = await oku((t) => t.auditLog.findMany({ where: { varlik: "onay_talebi", varlikId: talepId }, select: { islem: true, userId: true } }));
    expect(iz.map((x) => x.islem)).toEqual(expect.arrayContaining(["onay_talebi_acildi", "onay_talebi_onaylandi", "onay_talebi_yurutuldu"]));
    expect((await olarak(muhasebe, "muhasebe", () => onay.liste("taleplerim"))).talepler[0].durum).toBe("onaylandi");
  });

  it("iki adımlı kural: görev ayrılığı, aynı kişi iki adımı onaylayamaz, son adımda yürütülür", async () => {
    await olarak(yonetici1, "yonetici", () => onay.kuralKaydet(null, { islem: "kasa_banka_odeme", ad: "Ödeme", tutarEsigi: 1000, adimlar: [{ rol: "muhasebe" }, { rol: "yonetici" }] }));
    await olarak(yonetici1, "yonetici", () => kasa.hareketEkle({ kasaId, tip: "tahsilat", tutar: "10000", dovizCinsi: "TRY", tarih: "2026-11-10" } as never));
    const talepId = await onayaTakilir(() => olarak(yonetici1, "yonetici", () => kasa.hareketEkle({ kasaId, tip: "tediye", tutar: "2000", dovizCinsi: "TRY", tarih: "2026-11-10", aciklama: "Kira" } as never)));
    await expect(olarak(yonetici1, "yonetici", () => onay.karar(talepId, "onay"))).rejects.toThrow(/görev ayrılığı/);
    expect((await olarak(muhasebe, "muhasebe", () => onay.karar(talepId, "onay"))).adim).toBe(1);
    await expect(olarak(muhasebe, "muhasebe", () => onay.karar(talepId, "onay"))).rejects.toThrow(/onaycısı değilsiniz|iki adımı/);
    expect((await olarak(yonetici2, "yonetici", () => onay.karar(talepId, "onay"))).durum).toBe("onaylandi");
    const odeme = await oku((t) => t.kasaBankaHareket.findFirst({ where: { kasaId, tip: "tediye" }, select: { tutar: true, aciklama: true } }));
    expect([Number(odeme?.tutar), odeme?.aciklama]).toEqual([2000, "Kira"]);
  });

  it("talepten sonra kayıt değişirse geçersiz olur; ret gerekçe ister; talep eden geri çekebilir", async () => {
    const t1 = await onayaTakilir(() => olarak(muhasebe, "muhasebe", () => masraf.onayla(ikinciMasraf)));
    await yonetim.$executeRaw`UPDATE masraflar SET aciklama = 'değişti', updated_at = now() + interval '1 second' WHERE id = ${ikinciMasraf}::uuid`;
    const gecersiz = await olarak(yonetici1, "yonetici", () => onay.karar(t1, "onay"));
    expect(gecersiz.durum).toBe("gecersiz");
    expect((await oku((t) => t.masraf.findUnique({ where: { id: ikinciMasraf } })))?.durum).toBe("taslak");
    const t2 = await onayaTakilir(() => olarak(muhasebe, "muhasebe", () => masraf.onayla(ucuncuMasraf)));
    await expect(olarak(yonetici1, "yonetici", () => onay.karar(t2, "ret", " "))).rejects.toThrow(/gerekçe/);
    expect((await olarak(yonetici1, "yonetici", () => onay.karar(t2, "ret", "Bütçe yok"))).durum).toBe("reddedildi");
    const t3 = await onayaTakilir(() => olarak(muhasebe, "muhasebe", () => masraf.onayla(ucuncuMasraf)));
    await expect(olarak(yonetici1, "yonetici", () => onay.geriCek(t3))).rejects.toThrow(/yalnız açan/);
    expect((await olarak(muhasebe, "muhasebe", () => onay.geriCek(t3))).durum).toBe("geri_cekildi");
    const gecmis = await olarak(yonetici1, "yonetici", () => onay.liste("gecmis"));
    expect(gecmis.talepler.map((t) => t.durum)).toEqual(expect.arrayContaining(["gecersiz", "reddedildi", "geri_cekildi"]));
  });

  it("görev ayrılığı yalnız tek yöneticili firmada kapatılabilir", async () => {
    await expect(olarak(yonetici1, "yonetici", () => onay.gorevAyriligiKaydet(true))).rejects.toThrow(/tek etkin yöneticisi/);
  });
});
