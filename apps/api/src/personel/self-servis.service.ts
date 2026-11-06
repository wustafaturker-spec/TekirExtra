import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { z } from "zod";
import { parolaSemasi } from "../auth/parola-kurali";
import { anahtarBicimiGecerli, anahtarOzeti, anahtarUret } from "../cari/cari-mutabakat";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "../tenant/eposta.service";
import { BordroPusulaService } from "./bordro-pusula.service";
import { donemAdi } from "./bordro-pusula";
import { IzinService } from "./izin.service";
import { hassasCoz, hassasSifrele, ibanMaskele } from "./personel-hassas";
import { PersonelService } from "./personel.service";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";

/**
 * PRS-21 (P3-4, karar 2026-10-04): çalışan self-servisi. Çalışan kendi
 * kullanıcı hesabıyla `calisan` rolünde girer; hesap personel kartına bağlıdır
 * (user.personelId) ve yalnız o kartın verisini görür. Hesap İK'nın davetiyle
 * açılır: bağlantıdaki anahtarla çalışan parolasını belirler (7 gün geçerli).
 * Talepler mevcut İK onay akışına düşer. Çalışan hesabı kullanıcı sınırına
 * sayılmaz; işten çıkışta kapanır.
 */

const DAVET_GECERLILIK_GUN = 7;
const ONAYLI_BORDRO: ("onaylandi" | "kismen_odendi" | "odendi")[] = ["onaylandi", "kismen_odendi", "odendi"];
const BULUNAMADI = "Davet bağlantısı geçersiz ya da yenilendi; İK'dan yeni davet isteyin";

export const davetSemasi = z.object({ epostaGonder: z.boolean().default(true) });
export const parolaBelirleSemasi = z.object({
  parola: parolaSemasi,
});
export const calisanIzinSemasi = z.object({
  izinTuruId: z.string().uuid(),
  baslangicTarihi: z.coerce.date(),
  bitisTarihi: z.coerce.date(),
  aciklama: z.string().trim().max(500).optional().nullable(),
});

export const calisanAvansSemasi = z.object({
  tutar: z.coerce.number().positive("Avans tutarı sıfırdan büyük olmalıdır").max(10_000_000),
  aciklama: z.string().trim().max(500).optional().nullable(),
});
/** PRS-22: değişmesi istenen alanlar; boş bırakılan alan değişmez. IBAN TR biçiminde. */
export const bilgiTalebiSemasi = z.object({
  telefon: z.string().trim().max(30).optional(),
  adres: z.string().trim().max(500).optional(),
  iban: z.string().transform((d) => d.replace(/\s/g, "").toUpperCase()).pipe(z.string().regex(/^TR\d{24}$/, "Geçerli bir TR IBAN giriniz")).optional(),
  aciklama: z.string().trim().max(500).optional().nullable(),
}).refine((v) => Boolean(v.telefon || v.adres || v.iban), "En az bir alanı doldurun");
export const bilgiRetSemasi = z.object({ neden: z.string().trim().min(3, "Ret nedeni en az 3 karakter olmalıdır").max(500) });

type BilgiAlanlari = { telefon?: string; adres?: string; iban?: string };
/** IBAN şifreli saklanır; ekranlarda maskeli gösterilir. */
const alanlariGoster = (alanlar: Prisma.JsonValue) => {
  const a = (alanlar ?? {}) as BilgiAlanlari;
  return { ...(a.telefon !== undefined && { telefon: a.telefon }), ...(a.adres !== undefined && { adres: a.adres }), ...(a.iban !== undefined && { iban: ibanMaskele(a.iban) }) };
};

export const davetAdresi = (tenantId: string, anahtar: string) => `${(process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}/davet/${tenantId}/${anahtar}`;

@Injectable()
export class SelfServisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eposta: EpostaService,
    private readonly pusula: BordroPusulaService,
    private readonly izin: IzinService,
    private readonly personel: PersonelService,
  ) {}

  // ─── İK tarafı ───────────────────────────────────────────────────────────

  async durum(tenantId: string, personelId: string) {
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { personelId }, select: { id: true, eposta: true, aktif: true, davetAnahtarOzeti: true, davetSonGecerlilik: true } }));
    if (!k) return { durum: "yok" as const };
    const durum = !k.aktif ? "kapali" : k.davetAnahtarOzeti ? (k.davetSonGecerlilik && k.davetSonGecerlilik < new Date() ? "davet_suresi_doldu" : "davet_bekliyor") : "aktif";
    return { durum, eposta: k.eposta, davetSonGecerlilik: k.davetSonGecerlilik };
  }

  /**
   * Davet: hesap yoksa açar (girilemeyen rastgele parolayla), varsa ve kapalı
   * ya da parolası belirlenmemişse yeni anahtar üretir. E-posta gönderilemezse
   * ya da İK istemezse bağlantı İK'ya döner (elden iletmek için).
   */
  async davetEt(tenantId: string, personelId: string, userId: string, girdi: unknown) {
    const { epostaGonder } = davetSemasi.parse(girdi ?? {});
    const { anahtar, ozet } = anahtarUret();
    const son = new Date(Date.now() + DAVET_GECERLILIK_GUN * 86_400_000);
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const p = await tx.personel.findFirst({ where: { id: personelId, tenantId }, select: { id: true, ad: true, soyad: true, eposta: true, durum: true, kullanici: { select: { id: true, eposta: true, aktif: true, davetAnahtarOzeti: true } } } });
      if (!p) throw new NotFoundException("Personel bulunamadı");
      if (p.durum === "isten_ayrildi") throw new BadRequestException("İşten ayrılmış personele self-servis daveti gönderilmez");
      const eposta = p.eposta?.trim().toLowerCase();
      if (!eposta) throw new BadRequestException("Personel kartında e-posta yok; önce e-posta adresini girin");
      const adSoyad = `${p.ad} ${p.soyad}`;
      if (p.kullanici) {
        if (p.kullanici.aktif && !p.kullanici.davetAnahtarOzeti) throw new ConflictException("Çalışan self-servis hesabını zaten kullanıyor");
        await tx.user.update({ where: { id: p.kullanici.id }, data: { aktif: true, davetAnahtarOzeti: ozet, davetSonGecerlilik: son } });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "SELF_SERVIS_DAVET", varlik: "personel", varlikId: personelId, detay: { yenilendi: true } } });
        return { eposta: p.kullanici.eposta, adSoyad };
      }
      const kimlik = await this.prisma.authKimlik.findFirst({ where: { eposta: { equals: eposta, mode: "insensitive" } } });
      if (kimlik) throw new ConflictException("Bu e-posta başka bir kullanıcı hesabında kayıtlı; personel kartına çalışanın kendi e-postasını girin");
      const yeniId = randomUUID();
      await tx.user.create({ data: { id: yeniId, tenantId, eposta, adSoyad, rol: "calisan", parolaHash: await argon2.hash(randomBytes(32).toString("base64url")), epostaDogrulandi: true, personelId, davetAnahtarOzeti: ozet, davetSonGecerlilik: son } });
      await tx.authKimlik.create({ data: { eposta, tenantId, userId: yeniId } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "SELF_SERVIS_DAVET", varlik: "personel", varlikId: personelId, detay: { yenilendi: false } } });
      return { eposta, adSoyad };
    });
    const adres = davetAdresi(tenantId, anahtar);
    let gonderildi = false;
    let hata: string | null = null;
    if (epostaGonder) {
      try {
        const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }));
        await this.eposta.iletiGonder({
          alici: sonuc.eposta,
          konu: `${firma?.unvan ?? "TekirExtra"} — çalışan self-servis daveti`,
          metin: `Merhaba ${sonuc.adSoyad},\n\n${firma?.unvan ?? "Firmanız"} sizi çalışan self-servisine davet etti. Ücret pusulalarınızı görmek, izin ve avans talebi oluşturmak için aşağıdaki bağlantıdan parolanızı belirleyin:\n\n${adres}\n\nBağlantı ${DAVET_GECERLILIK_GUN} gün geçerlidir. Giriş adınız: ${sonuc.eposta}`,
        });
        gonderildi = true;
      } catch (e) {
        hata = e instanceof Error ? e.message : String(e);
      }
    }
    // Bağlantı yalnız e-posta gitmediğinde İK'ya gösterilir.
    return { eposta: sonuc.eposta, epostaGonderildi: gonderildi, epostaHatasi: hata, davetAdresi: gonderildi ? null : adres, sonGecerlilik: son };
  }

  async erisimKapat(tenantId: string, personelId: string, userId: string) {
    const r = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const n = await tx.user.updateMany({ where: { personelId, aktif: true }, data: { aktif: false, davetAnahtarOzeti: null, davetSonGecerlilik: null } });
      if (n.count) await tx.auditLog.create({ data: { tenantId, userId, islem: "SELF_SERVIS_KAPAT", varlik: "personel", varlikId: personelId, detay: {} } });
      return n.count;
    });
    if (!r) throw new NotFoundException("Açık self-servis hesabı yok");
    return { kapatildi: true };
  }

  // ─── Davet bağlantısı (girişsiz) ──────────────────────────────────────────

  private async davetliBul(tenantId: string, anahtar: string) {
    if (!anahtarBicimiGecerli(anahtar)) throw new NotFoundException(BULUNAMADI);
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { davetAnahtarOzeti: anahtarOzeti(anahtar), rol: "calisan" }, select: { id: true, eposta: true, adSoyad: true, aktif: true, davetSonGecerlilik: true } }));
    if (!k || !k.aktif) throw new NotFoundException(BULUNAMADI);
    if (k.davetSonGecerlilik && k.davetSonGecerlilik < new Date()) throw new GoneException("Davetin süresi doldu; İK'dan yeni davet isteyin");
    return k;
  }

  async davetGoruntule(tenantId: string, anahtar: string) {
    const k = await this.davetliBul(tenantId, anahtar);
    const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } }));
    return { firma: firma?.unvan ?? "", adSoyad: k.adSoyad, eposta: k.eposta };
  }

  async parolaBelirle(tenantId: string, anahtar: string, girdi: unknown) {
    const { parola } = parolaBelirleSemasi.parse(girdi);
    const k = await this.davetliBul(tenantId, anahtar);
    const hash = await argon2.hash(parola);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const n = await tx.user.updateMany({ where: { id: k.id, davetAnahtarOzeti: anahtarOzeti(anahtar) }, data: { parolaHash: hash, davetAnahtarOzeti: null, davetSonGecerlilik: null } });
      if (!n.count) throw new NotFoundException(BULUNAMADI);
      await tx.auditLog.create({ data: { tenantId, userId: k.id, islem: "SELF_SERVIS_PAROLA_BELIRLE", varlik: "user", varlikId: k.id, detay: {} } });
    });
    return { eposta: k.eposta };
  }

  // ─── Çalışan tarafı ───────────────────────────────────────────────────────

  /** Oturumdaki çalışanın personel kartı; yönetici gibi bağsız hesaplar reddedilir. */
  async benimPersonelim(tenantId: string, userId: string) {
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { personelId: true } }));
    if (!k?.personelId) throw new ForbiddenException("Hesabınız bir personel kartına bağlı değil");
    return k.personelId;
  }

  async ben(tenantId: string, userId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const [p, turler, bakiyeler] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) => tx.personel.findFirst({ where: { id: personelId }, select: { personelNo: true, ad: true, soyad: true, eposta: true, telefon: true, adres: true, departman: true, unvan: true, girisTarihi: true, iban: true, departmanKaydi: { select: { ad: true } }, pozisyon: { select: { ad: true } } } })),
      this.prisma.tenantIslem(tenantId, (tx) => tx.personelIzinTuru.findMany({ where: { aktif: true }, select: { id: true, ad: true, kod: true, bakiyeTakibi: true }, orderBy: { ad: "asc" } })),
      this.izin.bakiyeler(tenantId, personelId),
    ]);
    if (!p) throw new NotFoundException("Personel bulunamadı");
    const { iban, departmanKaydi, pozisyon, ...kalan } = p;
    // IBAN şifreli saklanır; çalışana yalnız son 4 hanesi gösterilir.
    return { ...kalan, departman: departmanKaydi?.ad ?? p.departman, unvan: pozisyon?.ad ?? p.unvan, ibanKayitli: Boolean(iban), izinTurleri: turler, izinBakiyeleri: bakiyeler };
  }

  async pusulalar(tenantId: string, userId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const liste = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findMany({ where: { personelId, durum: { in: ONAYLI_BORDRO } }, orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }], select: { id: true, donemYil: true, donemAy: true, durum: true, netMaas: true, odenecekTutar: true, odenenTutar: true } }));
    return liste.map((b) => ({ ...b, donem: donemAdi(b.donemYil, b.donemAy) }));
  }

  async pusulaPdf(tenantId: string, userId: string, bordroId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const b = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findFirst({ where: { id: bordroId, personelId, durum: { in: ONAYLI_BORDRO } }, select: { id: true } }));
    if (!b) throw new NotFoundException("Pusula bulunamadı");
    return this.pusula.pdfUret(b.id);
  }

  async izinler(tenantId: string, userId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    return this.izin.talepleriListele(tenantId, personelId);
  }

  async izinTalebi(tenantId: string, userId: string, girdi: unknown) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const veri = calisanIzinSemasi.parse(girdi);
    return this.izin.talepOlustur(tenantId, userId, { ...veri, personelId });
  }

  /** Çalışan yalnız henüz karara bağlanmamış kendi talebini geri çeker. */
  async izinGeriCek(tenantId: string, userId: string, talepId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const n = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelIzinTalebi.updateMany({ where: { id: talepId, personelId, durum: "talep" }, data: { durum: "iptal" } }));
    if (!n.count) throw new BadRequestException("Yalnız onay bekleyen kendi talebinizi geri çekebilirsiniz");
    return { geriCekildi: true };
  }

  // ─── PRS-22: avans ve bilgi güncelleme talepleri ──────────────────────────

  async avanslar(tenantId: string, userId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findMany({ where: { personelId }, orderBy: { tarih: "desc" }, select: { id: true, tutar: true, tarih: true, aciklama: true, durum: true, retNedeni: true, odenenTutar: true, mahsupEdilenTutar: true, kalanTutar: true } }));
  }

  /** Avans talebi İK'nın mevcut avans onayına düşer; aynı anda tek açık talep. */
  async avansTalebi(tenantId: string, userId: string, girdi: unknown) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const veri = calisanAvansSemasi.parse(girdi);
    const acik = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.count({ where: { personelId, durum: "talep" } }));
    if (acik) throw new BadRequestException("Onay bekleyen avans talebiniz var; karar verilince yenisini oluşturabilirsiniz");
    const bugun = new Date(`${bugunTR()}T00:00:00.000Z`);
    return this.personel.avansVer(tenantId, userId, { personelId, tutar: veri.tutar, tarih: bugun, aciklama: veri.aciklama || null });
  }

  async avansGeriCek(tenantId: string, userId: string, avansId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const n = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.updateMany({ where: { id: avansId, personelId, durum: "talep" }, data: { durum: "iptal" } }));
    if (!n.count) throw new BadRequestException("Yalnız onay bekleyen kendi talebinizi geri çekebilirsiniz");
    return { geriCekildi: true };
  }

  async bilgiTalepleri(tenantId: string, userId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const liste = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBilgiTalebi.findMany({ where: { personelId }, orderBy: { createdAt: "desc" } }));
    return liste.map((t) => ({ id: t.id, durum: t.durum, aciklama: t.aciklama, retNedeni: t.retNedeni, createdAt: t.createdAt, kararTarihi: t.kararTarihi, alanlar: alanlariGoster(t.alanlar) }));
  }

  async bilgiTalebi(tenantId: string, userId: string, girdi: unknown) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const v = bilgiTalebiSemasi.parse(girdi);
    const alanlar: BilgiAlanlari = { ...(v.telefon && { telefon: v.telefon }), ...(v.adres && { adres: v.adres }), ...(v.iban && { iban: hassasSifrele(v.iban)! }) };
    try {
      const t = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBilgiTalebi.create({ data: { tenantId, personelId, alanlar, aciklama: v.aciklama || null, olusturanUserId: userId } }));
      return { id: t.id, durum: t.durum, alanlar: alanlariGoster(t.alanlar) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BadRequestException("Onay bekleyen bilgi güncelleme talebiniz var; geri çekip yenisini oluşturabilirsiniz");
      throw e;
    }
  }

  async bilgiGeriCek(tenantId: string, userId: string, talepId: string) {
    const personelId = await this.benimPersonelim(tenantId, userId);
    const n = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBilgiTalebi.updateMany({ where: { id: talepId, personelId, durum: "bekliyor" }, data: { durum: "iptal" } }));
    if (!n.count) throw new BadRequestException("Yalnız onay bekleyen kendi talebinizi geri çekebilirsiniz");
    return { geriCekildi: true };
  }

  /** İK listesi: istenen değerin yanında kartta şu an kayıtlı değer (IBAN maskeli). */
  async bilgiTalepleriIk(tenantId: string, durum = "bekliyor", personelId?: string) {
    const liste = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBilgiTalebi.findMany({
      where: { ...(durum !== "hepsi" && { durum }), ...(personelId && { personelId }) },
      orderBy: { createdAt: "desc" }, take: 200,
      include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true, telefon: true, adres: true, iban: true } } },
    }));
    return liste.map((t) => ({
      id: t.id, durum: t.durum, aciklama: t.aciklama, retNedeni: t.retNedeni, createdAt: t.createdAt, kararTarihi: t.kararTarihi,
      personel: { id: t.personel.id, personelNo: t.personel.personelNo, ad: t.personel.ad, soyad: t.personel.soyad },
      istenen: alanlariGoster(t.alanlar),
      mevcut: { telefon: t.personel.telefon, adres: t.personel.adres, iban: ibanMaskele(t.personel.iban) },
    }));
  }

  /**
   * Onay: talep önce sahiplenilir (çift onay olmaz), sonra alanlar personel
   * güncellemesinden geçer (cari eşitleme, şifreleme, denetim kaydı orada);
   * güncelleme düşerse talep yeniden beklemeye döner.
   */
  async bilgiOnayla(tenantId: string, talepId: string, userId: string) {
    const t = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const talep = await tx.personelBilgiTalebi.findFirst({ where: { id: talepId, durum: "bekliyor" } });
      if (!talep) throw new NotFoundException("Onay bekleyen talep bulunamadı");
      if (talep.olusturanUserId === userId) throw new BadRequestException("Kendi bilgi güncelleme talebinizi onaylayamazsınız");
      const n = await tx.personelBilgiTalebi.updateMany({ where: { id: talepId, durum: "bekliyor" }, data: { durum: "onaylandi", kararVerenUserId: userId, kararTarihi: new Date() } });
      if (!n.count) throw new BadRequestException("Talep bu arada karara bağlandı");
      return talep;
    });
    const a = (t.alanlar ?? {}) as BilgiAlanlari;
    try {
      await this.personel.guncelle(tenantId, t.personelId, { ...(a.telefon !== undefined && { telefon: a.telefon }), ...(a.adres !== undefined && { adres: a.adres }), ...(a.iban !== undefined && { iban: hassasCoz(a.iban) }) } as never, userId);
    } catch (e) {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBilgiTalebi.update({ where: { id: talepId }, data: { durum: "bekliyor", kararVerenUserId: null, kararTarihi: null } }));
      throw e;
    }
    return { onaylandi: true };
  }

  async bilgiReddet(tenantId: string, talepId: string, userId: string, girdi: unknown) {
    const { neden } = bilgiRetSemasi.parse(girdi);
    const n = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBilgiTalebi.updateMany({ where: { id: talepId, durum: "bekliyor" }, data: { durum: "reddedildi", retNedeni: neden, kararVerenUserId: userId, kararTarihi: new Date() } }));
    if (!n.count) throw new NotFoundException("Onay bekleyen talep bulunamadı");
    return { reddedildi: true };
  }

}

