import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { coz, sifrele } from "../core/kripto";

export const epostaAyarlariSemasi = z.object({
  host: z.string().min(1).max(255), port: z.number().int().min(1).max(65535),
  guvenlik: z.enum(["yok", "starttls", "ssl"]), kullaniciAdi: z.string().max(255).optional(), parola: z.string().max(500).optional(),
  gondericiAdi: z.string().min(1).max(120), gondericiEposta: z.email(), yanitAdresi: z.email().optional().or(z.literal("")),
});
type EpostaAyari = z.infer<typeof epostaAyarlariSemasi>;
type SaklananAyar = Omit<EpostaAyari, "parola"> & { sifreliParola?: string };

@Injectable()
export class EpostaService {
  private readonly logger = new Logger(EpostaService.name);
  constructor(private readonly prisma: PrismaService) {}

  private baglam(): { tenantId: string } | null { try { return aktifBaglam(); } catch { return null; } }
  private async saklananAyar(tenantId: string): Promise<SaklananAyar | null> {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: "eposta" } } }));
    return kayit?.ayarlar as SaklananAyar | null;
  }
  private async transporter(): Promise<{ transport: Transporter; from: string; replyTo?: string }> {
    const baglam = this.baglam(); const ayar = baglam ? await this.saklananAyar(baglam.tenantId) : null;
    if (!ayar) return { transport: createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false }), from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>" };
    const parola = ayar.sifreliParola ? coz(ayar.sifreliParola) : undefined;
    return { transport: createTransport({ host: ayar.host, port: ayar.port, secure: ayar.guvenlik === "ssl", requireTLS: ayar.guvenlik === "starttls", auth: ayar.kullaniciAdi ? { user: ayar.kullaniciAdi, pass: parola ?? "" } : undefined }), from: `"${ayar.gondericiAdi.replaceAll('"', "")}" <${ayar.gondericiEposta}>`, replyTo: ayar.yanitAdresi || undefined };
  }
  private async kaydet(alici: string, konu: string, tur: string, durum: string, ekSayisi: number, hata?: unknown) {
    const baglam = this.baglam(); if (!baglam) return;
    const hataMesaji = hata instanceof Error ? hata.message.slice(0, 1000) : hata ? String(hata).slice(0, 1000) : null;
    await this.prisma.tenantIslem(baglam.tenantId, (tx) => tx.epostaGonderim.create({ data: { tenantId: baglam.tenantId, alici, konu, tur, durum, ekSayisi, hataMesaji } })).catch(() => undefined);
  }
  private async gonder(girdi: { alici: string; konu: string; metin: string; html?: string; tur?: string; ekler?: { dosyaAdi: string; icerik: Buffer; mime: string }[] }) {
    try { const { transport, from, replyTo } = await this.transporter(); await transport.sendMail({ from, replyTo, to: girdi.alici, subject: girdi.konu, text: girdi.metin, html: girdi.html, attachments: girdi.ekler?.map((e) => ({ filename: e.dosyaAdi, content: e.icerik, contentType: e.mime })) }); await this.kaydet(girdi.alici, girdi.konu, girdi.tur ?? "genel", "gonderildi", girdi.ekler?.length ?? 0); this.logger.log(`E-posta gönderildi: ${girdi.alici} (${girdi.konu})`); }
    catch (hata) { await this.kaydet(girdi.alici, girdi.konu, girdi.tur ?? "genel", "basarisiz", girdi.ekler?.length ?? 0, hata); throw hata; }
  }
  async ayarlariGetir() { const { tenantId } = aktifBaglam(); const a = await this.saklananAyar(tenantId); return a ? { ...a, sifreliParola: undefined, parolaKayitli: Boolean(a.sifreliParola), yapilandirildi: true } : { host: "", port: 587, guvenlik: "starttls", kullaniciAdi: "", gondericiAdi: "", gondericiEposta: "", yanitAdresi: "", parolaKayitli: false, yapilandirildi: false }; }
  async ayarlariGuncelle(girdi: EpostaAyari) { const { tenantId } = aktifBaglam(); const mevcut = await this.saklananAyar(tenantId); const saklanan: SaklananAyar = { host: girdi.host, port: girdi.port, guvenlik: girdi.guvenlik, kullaniciAdi: girdi.kullaniciAdi, gondericiAdi: girdi.gondericiAdi, gondericiEposta: girdi.gondericiEposta, yanitAdresi: girdi.yanitAdresi, sifreliParola: girdi.parola ? sifrele(girdi.parola) : mevcut?.sifreliParola }; if (saklanan.kullaniciAdi && !saklanan.sifreliParola) throw new BadRequestException("SMTP parolası zorunludur"); await this.prisma.tenantIslem(tenantId, (tx) => tx.modulAyar.upsert({ where: { tenantId_modul: { tenantId, modul: "eposta" } }, create: { tenantId, modul: "eposta", ayarlar: saklanan }, update: { ayarlar: saklanan } })); return this.ayarlariGetir(); }
  async baglantiTest(alici: string) { const { transport, from, replyTo } = await this.transporter(); try { await transport.verify(); await transport.sendMail({ from, replyTo, to: alici, subject: "TekirExtra e-posta bağlantı testi", text: "SMTP bağlantınız başarıyla yapılandırıldı. Bu ileti TekirExtra test ekranından gönderilmiştir." }); await this.kaydet(alici, "TekirExtra e-posta bağlantı testi", "test", "gonderildi", 0); return { basarili: true, mesaj: `Test e-postası ${alici} adresine gönderildi` }; } catch (hata) { await this.kaydet(alici, "TekirExtra e-posta bağlantı testi", "test", "basarisiz", 0, hata); throw new BadRequestException(hata instanceof Error ? `SMTP bağlantısı başarısız: ${hata.message}` : "SMTP bağlantısı başarısız"); } }
  async gecmis(adet = 50) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.epostaGonderim.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(adet, 100) })); }
  dogrulamaGonder(eposta: string, adSoyad: string, link: string) { return this.gonder({ alici: eposta, konu: "TekirExtra — e-posta adresinizi doğrulayın", tur: "dogrulama", metin: `Merhaba ${adSoyad},\n\nTekirExtra kaydınızı tamamlamak için e-posta adresinizi doğrulayın:\n${link}\n\nBu link 24 saat geçerlidir.`, html: `<p>Merhaba ${adSoyad},</p><p><a href="${link}">E-postamı doğrula</a></p>` }); }
  iletiGonder(girdi: { alici: string; konu: string; metin: string; html?: string }) { return this.gonder(girdi); }
  ekliIletiGonder(girdi: { alici: string; konu: string; metin: string; html?: string; ekler: { dosyaAdi: string; icerik: Buffer; mime: string }[] }) { return this.gonder({ ...girdi, tur: "belge" }); }
}
