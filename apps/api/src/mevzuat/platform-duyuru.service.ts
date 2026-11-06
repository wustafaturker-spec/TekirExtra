import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { dosyaIceriginiDogrula } from "../core/guvenlik/dosya-dogrulama";
import { ocrDosyasiniDogrula } from "../ai/ai.semalar";
import { DepoService } from "../ekler/depo.service";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "./platform-prisma.service";
import { duyuruIcerigiHtmlTemizle, type DuyuruHedefi, type DuyuruIcerigi, type DuyuruYayinGirdisi } from "./platform-duyuru.semalar";
import { gorselIceriginiImzala, gorselImzasiGecerli } from "./duyuru-gorsel-imza";
import type { YuklenenDosya } from "../ekler/ekler.service";

export interface Duyuru extends DuyuruIcerigi {
  id: string; durum: "taslak" | "arsiv" | "yayinlandi" | "durduruldu"; surum: number; createdAt: Date; updatedAt: Date;
  hedef: DuyuruHedefi | null; baslangic: Date | null; bitis: Date | null; yayinSurumu: number | null;
  icerikHtml?: string;
}
interface HedefOzeti { firmaSayisi: bigint; kullaniciSayisi: bigint; parmakIzi: string }
interface YayinOnizlemesi {
  id: string; duyuruId: string; kullaniciId: string; surum: number; hedef: DuyuruHedefi;
  baslangic: Date | null; bitis: Date; firmaSayisi: number; kullaniciSayisi: number; parmakIzi: string;
  sonOnayAt: Date; uygulandiAt: Date | null;
}
type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
const alanlar = Prisma.sql`id, baslik, icerik, buton_metni AS "butonMetni", buton_url AS "butonUrl", durum, surum, created_at AS "createdAt", updated_at AS "updatedAt", hedef, baslangic, bitis, yayin_surumu AS "yayinSurumu"`;
const onizlemeAlanlari = Prisma.sql`id, duyuru_id AS "duyuruId", kullanici_id AS "kullaniciId", surum, hedef, baslangic, bitis,
  firma_sayisi AS "firmaSayisi", kullanici_sayisi AS "kullaniciSayisi", parmak_izi AS "parmakIzi", son_onay_at AS "sonOnayAt", uygulandi_at AS "uygulandiAt"`;

@Injectable()
export class PlatformDuyuruService {
  constructor(private readonly platform: PlatformPrismaService, private readonly depo: DepoService) {}
  private html(metin: string) { return gorselIceriginiImzala(duyuruIcerigiHtmlTemizle(metin)); }
  private goruntule(r: Duyuru): Duyuru { return { ...r, icerikHtml: this.html(r.icerik) }; }
  private yonetici() {
    const b = aktifPlatformBaglam();
    if (b.rol === "mevzuat_editoru") throw new ForbiddenException("Duyuru yönetimi için platform yöneticisi yetkisi gerekir.");
    return b;
  }
  private async oku(db: Db, id: string, kilitle = false) {
    const [r] = await db.$queryRaw<Duyuru[]>`SELECT ${alanlar} FROM platform_duyurular WHERE id = ${id}::uuid ${kilitle ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    if (!r) throw new NotFoundException("Duyuru bulunamadı.");
    return r;
  }
  async listele(g: { sayfa: number; durum?: Duyuru["durum"] }) {
    this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const filtre = g.durum ? Prisma.sql`WHERE durum = ${g.durum}` : Prisma.empty;
      const kayitlar = await tx.$queryRaw<Duyuru[]>`SELECT ${alanlar} FROM platform_duyurular ${filtre} ORDER BY updated_at DESC, id DESC LIMIT 25 OFFSET ${(g.sayfa - 1) * 25}`;
      const [s] = await tx.$queryRaw<{ toplam: bigint }[]>`SELECT count(*) AS toplam FROM platform_duyurular ${filtre}`;
      return { kayitlar: kayitlar.map((r) => this.goruntule(r)), toplam: Number(s.toplam), sayfa: g.sayfa, sayfaBoyutu: 25 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async getir(id: string) { this.yonetici(); return this.goruntule(await this.oku(this.platform.db, id)); }
  async onizle(g: DuyuruIcerigi) { this.yonetici(); return { ...g, icerikHtml: this.html(g.icerik) }; }
  async gorselYukle(duyuruId: string, dosya: YuklenenDosya | undefined) {
    const { kullaniciId } = this.yonetici();
    if (!dosya) throw new BadRequestException("Görsel dosyası gerekli.");
    if (!Number.isSafeInteger(dosya.size) || dosya.size !== dosya.buffer.length || dosya.size < 1 || dosya.size > 5 * 1024 * 1024) throw new BadRequestException("Görsel 1 bayt ile 5 MB arasında olmalı.");
    const mime = await dosyaIceriginiDogrula(dosya, "sohbet");
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") throw new BadRequestException("Yalnız JPEG, PNG veya WebP görsel yüklenebilir.");
    try { ocrDosyasiniDogrula({ mimeType: mime, belgeTipi: "otomatik", gorselBase64: `data:${mime};base64,${dosya.buffer.toString("base64")}` }); }
    catch (e) { throw new BadRequestException(e instanceof Error ? e.message : "Görsel doğrulanamadı."); }
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
    const id = randomUUID(), storageKey = `platform-duyurular/${duyuruId}/${id}.${ext}`;
    const [taslak] = await this.platform.db.$queryRaw<{ durum: string }[]>`SELECT durum FROM platform_duyurular WHERE id=${duyuruId}::uuid`;
    if (!taslak || taslak.durum !== "taslak") throw new NotFoundException("Düzenlenebilir duyuru taslağı bulunamadı.");
    await this.depo.yukle(storageKey, dosya.buffer, mime);
    try {
      await this.platform.db.$transaction(async (tx) => {
        const [kilit] = await tx.$queryRaw<{ durum: string }[]>`SELECT durum FROM platform_duyurular WHERE id=${duyuruId}::uuid FOR UPDATE`;
        if (!kilit || kilit.durum !== "taslak") throw new NotFoundException("Düzenlenebilir duyuru taslağı bulunamadı.");
        const [sayac] = await tx.$queryRaw<{ toplam: bigint }[]>`SELECT count(*) AS toplam FROM platform_duyuru_gorselleri WHERE duyuru_id=${duyuruId}::uuid`;
        if (sayac.toplam >= 20n) throw new BadRequestException("Bir duyuru taslağına en fazla 20 görsel eklenebilir.");
        await tx.$executeRaw`INSERT INTO platform_duyuru_gorselleri(id,duyuru_id,dosya_adi,mime_tip,boyut,depo_anahtari,yukleyen_kullanici_id)
          VALUES(${id}::uuid,${duyuruId}::uuid,${dosya.originalname.slice(0,240)},${mime},${dosya.size},${storageKey},${kullaniciId}::uuid)`;
      });
    } catch (e) { await this.depo.sil(storageKey).catch(() => undefined); throw e; }
    return { id, url: `/api/v1/duyurular/gorseller/${id}`, markdown: `![Görsel açıklaması](/api/v1/duyurular/gorseller/${id})` };
  }
  async gorselIndir(id: string, bitis: number, imza: string) {
    if (!gorselImzasiGecerli(id, bitis, imza)) throw new NotFoundException("Görsel bulunamadı veya bağlantı süresi doldu.");
    const [r] = await this.platform.db.$queryRaw<{ mimeTip: string; depoAnahtari: string }[]>`SELECT mime_tip AS "mimeTip",depo_anahtari AS "depoAnahtari" FROM platform_duyuru_gorselleri WHERE id=${id}::uuid`;
    if (!r) throw new NotFoundException("Görsel bulunamadı.");
    return { mimeTip: r.mimeTip, icerik: await this.depo.indir(r.depoAnahtari) };
  }
  private async gorselleriDogrula(tx: Db, duyuruId: string, icerik: string) {
    const ids = [...new Set([...icerik.matchAll(/!\[[^\]]{0,200}\]\(\/api\/v1\/duyurular\/gorseller\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/giu)].map((m) => m[1]))];
    if (!ids.length) return;
    const bulunanlar = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM platform_duyuru_gorselleri WHERE duyuru_id=${duyuruId}::uuid AND id=ANY(${ids}::uuid[])`;
    if (bulunanlar.length !== ids.length) throw new BadRequestException("Duyuruda bu taslağa ait olmayan veya bulunamayan bir görsel var.");
  }
  private async gecmisYaz(tx: Db, r: Duyuru, kullaniciId: string) {
    await tx.$executeRaw`INSERT INTO platform_duyuru_gecmisi (duyuru_id, surum, kullanici_id, icerik) VALUES (${r.id}::uuid, ${r.surum}, ${kullaniciId}::uuid, ${JSON.stringify(r)}::jsonb)`;
  }
  async olustur(g: DuyuruIcerigi) {
    const { kullaniciId } = this.yonetici();
    const r = await this.platform.db.$transaction(async (tx) => {
      if (/!\[[^\]]{0,200}\]\(\/api\/v1\/duyurular\/gorseller\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/iu.test(g.icerik)) throw new BadRequestException("Görsel eklemek için önce duyuru taslağını kaydedin.");
      const [r] = await tx.$queryRaw<Duyuru[]>`INSERT INTO platform_duyurular (baslik, icerik, buton_metni, buton_url)
        VALUES (${g.baslik}, ${g.icerik}, ${g.butonMetni}, ${g.butonUrl}) RETURNING ${alanlar}`;
      await this.gecmisYaz(tx, r, kullaniciId);
      return r;
    });
    return this.goruntule(r);
  }
  async guncelle(id: string, g: DuyuruIcerigi & { surum: number }) {
    const { kullaniciId } = this.yonetici();
    const r = await this.platform.db.$transaction(async (tx) => {
      this.duzenlenebilir(await this.oku(tx, id, true), g.surum);
      await this.gorselleriDogrula(tx, id, g.icerik);
      const [r] = await tx.$queryRaw<Duyuru[]>`UPDATE platform_duyurular SET baslik = ${g.baslik}, icerik = ${g.icerik},
        buton_metni = ${g.butonMetni}, buton_url = ${g.butonUrl}, surum = surum + 1, updated_at = now()
        WHERE id = ${id}::uuid RETURNING ${alanlar}`;
      await this.gecmisYaz(tx, r, kullaniciId);
      return r;
    });
    return this.goruntule(r);
  }
  private duzenlenebilir(r: Duyuru, surum: number) {
    if (r.surum !== surum) throw new ConflictException("Duyuru değişti. Taslağınızı koruyup güncel kaydı yükleyin.");
    if (r.durum !== "taslak") throw new ConflictException(r.durum === "arsiv" ? "Arşivlenmiş duyuru değiştirilemez." : "Yayınlanmış duyurunun içeriği değiştirilemez.");
  }
  async arsivle(id: string, surum: number) {
    const { kullaniciId } = this.yonetici();
    const r = await this.platform.db.$transaction(async (tx) => {
      const eski = await this.oku(tx, id, true);
      if (eski.surum !== surum || eski.durum === "arsiv") throw new ConflictException("Duyuru değişti veya zaten arşivlenmiş.");
      const [r] = await tx.$queryRaw<Duyuru[]>`UPDATE platform_duyurular SET durum = 'arsiv', surum = surum + 1, updated_at = now() WHERE id = ${id}::uuid RETURNING ${alanlar}`;
      await this.gecmisYaz(tx, r, kullaniciId);
      return r;
    });
    return this.goruntule(r);
  }
  async gecmis(id: string, sayfa: number) {
    this.yonetici(); await this.oku(this.platform.db, id);
    const kayitlar = await this.platform.db.$queryRaw<{ surum: number; zaman: Date; kullaniciId: string; icerik: unknown }[]>`
      SELECT surum, zaman, kullanici_id AS "kullaniciId", icerik FROM platform_duyuru_gecmisi
      WHERE duyuru_id = ${id}::uuid ORDER BY surum DESC LIMIT 25 OFFSET ${(sayfa - 1) * 25}`;
    return kayitlar.map((g) => {
      const icerik = g.icerik as Duyuru;
      return { ...g, icerik: { ...icerik, icerikHtml: this.html(icerik.icerik) } };
    });
  }

  private async hedefOzeti(tx: Db, hedef: DuyuruHedefi) {
    const [r] = await tx.$queryRaw<HedefOzeti[]>`SELECT count(DISTINCT tenant_id) AS "firmaSayisi", count(*) AS "kullaniciSayisi",
      md5(COALESCE(string_agg(tenant_id::text || ':' || user_id::text, ',' ORDER BY tenant_id,user_id),'')) AS "parmakIzi"
      FROM duyuru_hedef_alicilari(${JSON.stringify(hedef)}::jsonb)`;
    return { firmaSayisi: Number(r.firmaSayisi), kullaniciSayisi: Number(r.kullaniciSayisi), parmakIzi: r.parmakIzi };
  }
  async hedefOnizle(id: string, g: DuyuruYayinGirdisi) {
    const { kullaniciId } = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      this.duzenlenebilir(await this.oku(tx, id), g.surum);
      const [saat] = await tx.$queryRaw<{ simdi: Date }[]>`SELECT clock_timestamp() AS simdi`;
      if (new Date(g.bitis) <= saat.simdi || (g.baslangic && new Date(g.baslangic) <= saat.simdi)) {
        throw new ConflictException("Yayın zamanı geçmişte olamaz. Hemen yayın için başlangıcı boş bırakın.");
      }
      const ozet = await this.hedefOzeti(tx, g.hedef);
      if (!ozet.kullaniciSayisi) throw new ConflictException("Hedefte uygun kullanıcı yok. Seçimleri kontrol edin.");
      const [r] = await tx.$queryRaw<YayinOnizlemesi[]>`INSERT INTO platform_duyuru_onizlemeleri
        (duyuru_id,kullanici_id,surum,hedef,baslangic,bitis,firma_sayisi,kullanici_sayisi,parmak_izi)
        VALUES (${id}::uuid,${kullaniciId}::uuid,${g.surum},${JSON.stringify(g.hedef)}::jsonb,${g.baslangic}::timestamptz,${g.bitis}::timestamptz,
          ${ozet.firmaSayisi},${ozet.kullaniciSayisi},${ozet.parmakIzi}) RETURNING ${onizlemeAlanlari}`;
      const { parmakIzi: _, ...gorunum } = r;
      return gorunum;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  }
  async yayinla(id: string, onizlemeId: string) {
    const { kullaniciId } = this.yonetici();
    const r = await this.platform.db.$transaction(async (tx) => {
      const eski = await this.oku(tx, id, true);
      const [p] = await tx.$queryRaw<YayinOnizlemesi[]>`SELECT ${onizlemeAlanlari} FROM platform_duyuru_onizlemeleri
        WHERE id=${onizlemeId}::uuid AND duyuru_id=${id}::uuid AND kullanici_id=${kullaniciId}::uuid FOR UPDATE`;
      if (!p) throw new NotFoundException("Yayın önizlemesi bulunamadı.");
      if (p.uygulandiAt) return eski;
      this.duzenlenebilir(eski, p.surum);
      const [saat] = await tx.$queryRaw<{ simdi: Date }[]>`SELECT clock_timestamp() AS simdi`;
      if (p.sonOnayAt <= saat.simdi || p.bitis <= saat.simdi || (p.baslangic && p.baslangic <= saat.simdi)) {
        throw new ConflictException("Önizleme veya yayın zamanı geçti. Yeniden önizleyin.");
      }
      const ozet = await this.hedefOzeti(tx, p.hedef);
      if (ozet.parmakIzi !== p.parmakIzi || !ozet.kullaniciSayisi) throw new ConflictException("Hedef kitle değişti. Yeniden önizleyin.");
      await this.gorselleriDogrula(tx, id, eski.icerik);
      const [r] = await tx.$queryRaw<Duyuru[]>`UPDATE platform_duyurular SET durum='yayinlandi',hedef=${JSON.stringify(p.hedef)}::jsonb,
        baslangic=COALESCE(${p.baslangic}::timestamptz,clock_timestamp()),bitis=${p.bitis},yayin_surumu=surum+1,surum=surum+1,updated_at=now()
        WHERE id=${id}::uuid RETURNING ${alanlar}`;
      await tx.$executeRaw`INSERT INTO platform_duyuru_alicilari(duyuru_id,tenant_id,user_id)
        SELECT ${id}::uuid,tenant_id,user_id FROM duyuru_hedef_alicilari(${JSON.stringify(p.hedef)}::jsonb)`;
      await tx.$executeRaw`UPDATE platform_duyuru_onizlemeleri SET uygulandi_at=now() WHERE id=${p.id}::uuid`;
      await this.gecmisYaz(tx, r, kullaniciId);
      return r;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
    return this.goruntule(r);
  }
  async durdur(id: string, surum: number) {
    const { kullaniciId } = this.yonetici();
    const r = await this.platform.db.$transaction(async (tx) => {
      const eski = await this.oku(tx, id, true);
      if (eski.surum !== surum || eski.durum !== "yayinlandi") throw new ConflictException("Duyuru değişti veya yayında değil.");
      const [r] = await tx.$queryRaw<Duyuru[]>`UPDATE platform_duyurular SET durum='durduruldu',surum=surum+1,updated_at=now() WHERE id=${id}::uuid RETURNING ${alanlar}`;
      await this.gecmisYaz(tx, r, kullaniciId); return r;
    });
    return this.goruntule(r);
  }
  async rapor(id: string, sayfa: number) {
    this.yonetici(); await this.oku(this.platform.db, id);
    return this.platform.db.$transaction(async (tx) => {
      const [ozet] = await tx.$queryRaw<{ firma: bigint; kullanici: bigint; gosterim: bigint; okudum: bigint; tiklama: bigint; popupKapatildi: bigint; popupErtelendi: bigint }[]>`
        SELECT (SELECT count(DISTINCT tenant_id) FROM platform_duyuru_alicilari WHERE duyuru_id=${id}::uuid) AS firma,
          (SELECT count(*) FROM platform_duyuru_alicilari WHERE duyuru_id=${id}::uuid) AS kullanici,
          count(*) FILTER (WHERE tur='gosterim') AS gosterim,count(*) FILTER (WHERE tur='okudum') AS okudum,
          count(*) FILTER (WHERE tur='tiklama') AS tiklama,
          (SELECT count(*) FROM platform_duyuru_tercihleri WHERE duyuru_id=${id}::uuid AND kapatildi_at IS NOT NULL) AS "popupKapatildi",
          (SELECT count(*) FROM platform_duyuru_tercihleri WHERE duyuru_id=${id}::uuid AND ertelendi_at IS NOT NULL) AS "popupErtelendi"
          FROM platform_duyuru_olaylari WHERE duyuru_id=${id}::uuid`;
      const firmalar = await tx.$queryRaw<{ tenantId: string; hedef: bigint; gosterim: bigint; okudum: bigint; tiklama: bigint; popupKapatildi: bigint; popupErtelendi: bigint }[]>`
        SELECT a.tenant_id AS "tenantId", count(DISTINCT a.user_id) AS hedef,
          count(*) FILTER (WHERE o.tur='gosterim') AS gosterim,count(*) FILTER (WHERE o.tur='okudum') AS okudum,
          count(*) FILTER (WHERE o.tur='tiklama') AS tiklama,
          count(DISTINCT p.user_id) FILTER (WHERE p.kapatildi_at IS NOT NULL) AS "popupKapatildi",
          count(DISTINCT p.user_id) FILTER (WHERE p.ertelendi_at IS NOT NULL) AS "popupErtelendi"
          FROM platform_duyuru_alicilari a
        LEFT JOIN platform_duyuru_olaylari o ON o.duyuru_id=a.duyuru_id AND o.tenant_id=a.tenant_id AND o.user_id=a.user_id
        LEFT JOIN platform_duyuru_tercihleri p ON p.duyuru_id=a.duyuru_id AND p.tenant_id=a.tenant_id AND p.user_id=a.user_id
        WHERE a.duyuru_id=${id}::uuid GROUP BY a.tenant_id ORDER BY a.tenant_id LIMIT 25 OFFSET ${(sayfa-1)*25}`;
      const adlar = firmalar.length ? await tx.$queryRaw<{ tenant_id: string; unvan: string }[]>`
        SELECT tenant_id,unvan FROM platform_firma_adlari(ARRAY[${Prisma.join(firmalar.map((f) => Prisma.sql`${f.tenantId}::uuid`))}])` : [];
      const adHaritasi = new Map(adlar.map((f) => [f.tenant_id,f.unvan]));
      return { zaman: new Date().toISOString(), hedefPolitikasi: "Yayın onayındaki alıcılar; sonradan uygun olanlar katılmaz.",
        firma: Number(ozet.firma), kullanici: Number(ozet.kullanici), gosterim: Number(ozet.gosterim), okudum: Number(ozet.okudum), tiklama: Number(ozet.tiklama),
        popupKapatildi: Number(ozet.popupKapatildi), popupErtelendi: Number(ozet.popupErtelendi),
        firmalar: firmalar.map((f) => ({ tenantId: f.tenantId, unvan: adHaritasi.get(f.tenantId) ?? "Firma", hedef: Number(f.hedef), gosterim: Number(f.gosterim), okudum: Number(f.okudum), tiklama: Number(f.tiklama), popupKapatildi: Number(f.popupKapatildi), popupErtelendi: Number(f.popupErtelendi) })), sayfa, sayfaBoyutu: 25 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async firmaGecmisi(tenantId: string, sayfa: number) {
    this.yonetici();
    const [firma] = await this.platform.db.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM platform_firma_adlari(ARRAY[${tenantId}::uuid])`;
    if (!firma) throw new NotFoundException("Firma bulunamadı.");
    return this.platform.db.$transaction(async (tx) => {
      const kayitlar = await tx.$queryRaw<{
        id: string; baslik: string; durum: string; surum: number; baslangic: Date; bitis: Date;
        hedefKullanici: bigint; gosterim: bigint; okudum: bigint; tiklama: bigint;
      }[]>`
        SELECT d.id,d.baslik,d.durum,d.yayin_surumu AS surum,d.baslangic,d.bitis,
          count(DISTINCT a.user_id) AS "hedefKullanici",
          count(*) FILTER (WHERE o.tur='gosterim') AS gosterim,
          count(*) FILTER (WHERE o.tur='okudum') AS okudum,
          count(*) FILTER (WHERE o.tur='tiklama') AS tiklama
        FROM platform_duyurular d JOIN platform_duyuru_alicilari a ON a.duyuru_id=d.id
        LEFT JOIN platform_duyuru_olaylari o ON o.duyuru_id=a.duyuru_id AND o.tenant_id=a.tenant_id AND o.user_id=a.user_id
        WHERE a.tenant_id=${tenantId}::uuid AND d.yayin_surumu IS NOT NULL
        GROUP BY d.id ORDER BY d.baslangic DESC,d.id DESC LIMIT 25 OFFSET ${(sayfa-1)*25}`;
      const [sonuc] = await tx.$queryRaw<{ toplam: bigint }[]>`
        SELECT count(DISTINCT d.id) AS toplam FROM platform_duyurular d
        JOIN platform_duyuru_alicilari a ON a.duyuru_id=d.id
        WHERE a.tenant_id=${tenantId}::uuid AND d.yayin_surumu IS NOT NULL`;
      return { kayitlar: kayitlar.map((d) => ({ ...d, hedefKullanici:Number(d.hedefKullanici),gosterim:Number(d.gosterim),okudum:Number(d.okudum),tiklama:Number(d.tiklama) })),
        toplam:Number(sonuc.toplam),sayfa,sayfaBoyutu:25,zaman:new Date().toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
