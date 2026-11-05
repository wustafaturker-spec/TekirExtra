import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { abonelikKosulSemasi, abonelikKosullariniOku, type BagliAbonelik } from "../tenant/abonelik-kosullari";
import { firmaIstisnasiniCoz, firmaPaketIstisnaSemasi, type FirmaPaketIstisnasi } from "../tenant/firma-paket-istisnasi";
import { PlatformPrismaService } from "./platform-prisma.service";

@Injectable()
export class PlatformFirmaIstisnaService {
  constructor(private readonly platform: PlatformPrismaService) {}
  private yonetici() {
    const b = aktifPlatformBaglam();
    if (b.rol !== "yonetici") throw new ForbiddenException("Firma istisnası için platform yöneticisi gerekir.");
    return b.kullaniciId;
  }
  async kaynak(tenantId: string) {
    this.yonetici();
    const [r] = await this.platform.db.$queryRaw<{ kaynak: BagliAbonelik | null }[]>`SELECT platform_firma_istisna_kaynak(${tenantId}::uuid) AS kaynak`;
    if (!r.kaynak) throw new NotFoundException("Firma aboneliği bulunamadı.");
    const kosullar = abonelikKosullariniOku(r.kaynak);
    if (!kosullar) throw new BadRequestException("Kayıtlı katalog koşulları gerekir.");
    return { paketSurumId: r.kaynak.paketSurumId, kosullar };
  }
  async listele(tenantId: string, sayfa: number) {
    this.yonetici();
    const [r] = await this.platform.db.$queryRaw<{ sonuc: unknown }[]>`
      WITH kaynak AS (SELECT * FROM platform_firma_istisna_taslaklari WHERE tenant_id=${tenantId}::uuid),
      sayfa AS (SELECT * FROM kaynak ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ${(sayfa - 1) * 25})
      SELECT jsonb_build_object('kayitlar',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY created_at DESC,id DESC) FROM sayfa s),'[]'::jsonb),
        'toplam',(SELECT count(*) FROM kaynak),'sayfa',${sayfa},'sayfaBoyutu',25,'fiyatEntegrasyonu',true,'kapsamEntegrasyonu',true) AS sonuc`;
    return r.sonuc;
  }
  async taslak(g: FirmaPaketIstisnasi) {
    const kullaniciId = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<{ kaynak: BagliAbonelik | null }[]>`SELECT platform_firma_istisna_kaynak(${g.tenantId}::uuid) AS kaynak`;
      if (!r.kaynak) throw new NotFoundException("Firma aboneliği bulunamadı.");
      const temel = abonelikKosullariniOku(r.kaynak);
      if (!temel) throw new BadRequestException("Kayıtlı katalog koşulları gerekir.");
      let hedef;
      try { hedef = firmaIstisnasiniCoz(temel, { tenantId: g.tenantId, paketSurumId: r.kaynak.paketSurumId! }, g, new Date(g.baslangic)).kosullar; }
      catch (e) { throw new BadRequestException(e instanceof Error ? e.message : "Geçersiz istisna."); }
      const [kayit] = await tx.$queryRaw<{ id: string }[]>`SELECT platform_firma_istisna_taslagi(${kullaniciId}::uuid,${g.tenantId}::uuid,${g.paketSurumId}::uuid,
        ${JSON.stringify(g)}::jsonb,${JSON.stringify(r.kaynak.paketKosullari)}::jsonb,${JSON.stringify(hedef)}::jsonb,${g.baslangic}::timestamptz,${g.bitis}::timestamptz) AS id`;
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "firma_istisna_taslagi_olusturuldu", detay: { tenantId: g.tenantId, istisnaId: kayit.id, neden: g.neden } } });
      return { id: kayit.id, kaynak: temel, hedef, uygulamaEntegrasyonu: false, durum: "taslak" };
    }).catch((e: unknown) => this.hata(e));
  }
  async iptal(tenantId: string, id: string, neden: string) {
    const kullaniciId = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<{ degisti: boolean }[]>`SELECT platform_firma_istisna_taslak_iptal(${kullaniciId}::uuid,${tenantId}::uuid,${id}::uuid,${neden}) AS degisti`;
      if (r.degisti) await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "firma_istisna_taslagi_iptal", detay: { tenantId, istisnaId: id, neden } } });
      return { tekrar: !r.degisti };
    }).catch((e: unknown) => this.hata(e));
  }
  async uygunluk(tenantId: string, id: string) {
    const kullaniciId = this.yonetici();
    try {
      const [r] = await this.platform.db.$queryRaw<{ sonuc: unknown }[]>`SELECT platform_firma_istisna_uygunluk(${kullaniciId}::uuid,${tenantId}::uuid,${id}::uuid) AS sonuc`;
      return r.sonuc;
    } catch (e) { this.hata(e); }
  }
  async fiyatOnayla(tenantId: string, id: string) {
    return this.onayla(tenantId, id, true);
  }
  async onayla(tenantId: string, id: string, yalnizFiyat = false) {
    const kullaniciId = this.yonetici();
    return this.platform.db.$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<{ veri: unknown; kaynak_kosullar: unknown; hedef_kosullar: unknown }[]>`SELECT veri,kaynak_kosullar,hedef_kosullar FROM platform_firma_istisna_taslaklari WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid`;
      if (!r) throw new NotFoundException("İstisna taslağı bulunamadı.");
      const g = firmaPaketIstisnaSemasi.parse(r.veri);
      if (yalnizFiyat && (g.kapsamSozlesmesi || !g.fiyatlandirma)) throw new BadRequestException("Bu uç yalnız özel fiyat taslaklarını onaylar.");
      const beklenen = firmaIstisnasiniCoz(abonelikKosulSemasi.parse(r.kaynak_kosullar), { tenantId, paketSurumId: g.paketSurumId }, g, new Date(g.baslangic)).kosullar;
      if (JSON.stringify(beklenen) !== JSON.stringify(abonelikKosulSemasi.parse(r.hedef_kosullar))) throw new ConflictException("Taslak hedef koşulları eşleşmiyor.");
      const [s] = await tx.$queryRaw<{ degisti: boolean }[]>`SELECT platform_firma_ozel_fiyat_onay(${kullaniciId}::uuid,${tenantId}::uuid,${id}::uuid) AS degisti`;
      if (s.degisti) await tx.mevzuatOlay.create({ data: { kullaniciId, olay: g.kapsamSozlesmesi ? "firma_kapsam_istisnasi_onaylandi" : "firma_ozel_fiyat_onaylandi", detay: { tenantId, istisnaId: id } } });
      return { tekrar: !s.degisti, durum: "onaylandi" };
    }).catch((e: unknown) => this.hata(e));
  }
  private hata(e: unknown): never {
    const m = (e as { meta?: { message?: string }; message?: string }).meta?.message ?? (e as Error).message ?? "";
    if (m.includes("istisna_yetki")) throw new ForbiddenException("Aktif platform yöneticisi gerekir.");
    if (/istisna_(cakisma|kaynak_degisti)/.test(m)) throw new ConflictException("Kaynak abonelik değişti veya bu dönemde başka bir istisna taslağı var.");
    if (m.includes("istisna_yok")) throw new NotFoundException("İstisna taslağı bulunamadı.");
    if (m.includes("istisna_kota_asimi")) throw new ConflictException("Güncel kullanım hedef kotayı aşıyor. Kullanımı azaltın veya yeni taslak hazırlayın.");
    if (m.includes("istisna_depolama_asimi")) throw new ConflictException("Dosyalar ve devam eden yüklemeler hedef depolama sınırını aşıyor.");
    if (m.includes("istisna_hedef_gecersiz")) throw new BadRequestException("Taslak hedef koşulları geçersiz.");
    if (m.includes("istisna_yalniz_fiyat")) throw new BadRequestException("Yalnız özel fiyat taslağı onaylanabilir.");
    if (/istisna_(tarih|neden)/.test(m)) throw new BadRequestException("Geçerli tarih aralığı ve gerekçe girin.");
    throw e;
  }
}
