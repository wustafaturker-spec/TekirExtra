import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { bugunTR, PAKET_MODUL_KODLARI } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";

/** İzole kabul DB'sinde tarihsel rapor hazırlıklarını gerçek katalog/onay akışından geçirir. */
export function kabulPaketleri(admin: PrismaClient, platform: PrismaClient) {
  const kullaniciId = randomUUID();
  const servis = new PlatformPaketService({ db: platform } as never);
  const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId, eposta: `${kullaniciId}@kabul.invalid`, rol: "yonetici" }, is);
  let hazir: Promise<unknown> | undefined;
  const surumler = new Map<string, { paketId: string; id: string; kilitSurumu: number }>();
  async function surum(kod: string) {
    await (hazir ??= admin.platformKullanici.create({ data: { id: kullaniciId, eposta: `${kullaniciId}@kabul.invalid`, adSoyad: "Rapor paket kabulü", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } }));
    const kayit = surumler.get(kod);
    if (kayit) return kayit;
    const icerik = { ad: kod, aciklama: "Rapor kabul paket koşulları", ozellikler: ["Rapor kabulü"], siralama: 1,
      fiyatlandirma: { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: ([1, 3, 6, 12] as const).map((aySayisi) => ({ aySayisi, matrah: String(100 * aySayisi) })) },
      kapsamSozlesmesi: { semaSurumu: 1 as const, moduller: [...PAKET_MODUL_KODLARI], kotalar: { kullanici: { sinir: null, uyariYuzdesi: 80 }, cari: { sinir: null, uyariYuzdesi: 80 }, stok: { sinir: null, uyariYuzdesi: 80 }, aylikFatura: { sinir: null, uyariYuzdesi: 80 } } },
    };
    const mevcut = await admin.platformPaket.findUnique({ where: { kod }, include: { surumler: { orderBy: { surumNo: "desc" }, take: 1 } } });
    let paketId: string, taslak;
    if (mevcut) {
      paketId = mevcut.id;
      const d = await yonetici(() => servis.taslakAc(paketId, mevcut.surumler[0].id));
      taslak = await yonetici(() => servis.guncelle(paketId, d.id, { ...icerik, kilitSurumu: d.kilitSurumu }));
    } else {
      const p = await yonetici(() => servis.olustur({ kod, ...icerik }));
      paketId = p.id; taslak = p.surum;
    }
    const yayin = await yonetici(() => servis.yayinla(paketId, taslak.id, taslak.kilitSurumu));
    const sonuc = { paketId, id: yayin.id, kilitSurumu: yayin.kilitSurumu };
    surumler.set(kod, sonuc);
    return sonuc;
  }
  return {
    async olustur(data: Prisma.TenantAbonelikUncheckedCreateInput) {
      const hedef = await surum(data.planKodu ?? "v1");
      const satis = await yonetici(() => servis.satisGetir(hedef.paketId));
      await yonetici(() => servis.satisDegistir(hedef.paketId, { acik: true, surumId: hedef.id, surumKilitSurumu: hedef.kilitSurumu, kilitSurumu: satis.kilitSurumu, neden: "Rapor kabul başlangıç aboneliği" }));
      try {
        const [bag] = await admin.$queryRaw<{ kosullar: Prisma.InputJsonValue }[]>`SELECT kosullar FROM abonelik_acik_satis_bagi() WHERE surum_id=${hedef.id}::uuid`;
        return await admin.tenantAbonelik.create({ data: { ...data, paketSurumId: hedef.id, paketKosullari: bag.kosullar } });
      } finally {
        const son = await yonetici(() => servis.satisGetir(hedef.paketId));
        await yonetici(() => servis.satisDegistir(hedef.paketId, { acik: false, surumId: null, surumKilitSurumu: null, kilitSurumu: son.kilitSurumu, neden: "Rapor kabul başlangıç satışı kapandı" }));
      }
    },
    async gecir(tenantId: string, kod: string) {
      const hedef = await surum(kod);
      const p = await yonetici(() => servis.atamaOnizle({ surumId: hedef.id, tenantIds: [tenantId], uygulamaTarihi: bugunTR(), neden: "Tarihsel rapor için kontrollü paket geçişi", atamaKapsami: "kapsam" }));
      await yonetici(() => servis.atamaUygula(p.id));
      return hedef.id;
    },
  };
}
