import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";

/**
 * SMTP e-posta gönderimi (KLN-09). Geliştirmede Mailpit'e (localhost:1025),
 * üretimde gerçek SMTP sağlayıcısına bağlanır.
 */
@Injectable()
export class EpostaService {
  private readonly logger = new Logger(EpostaService.name);
  private readonly transport: Transporter;

  constructor() {
    this.transport = createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
    });
  }

  async dogrulamaGonder(eposta: string, adSoyad: string, link: string): Promise<void> {
    await this.transport.sendMail({
      from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>",
      to: eposta,
      subject: "TekirExtra — e-posta adresinizi doğrulayın",
      text: `Merhaba ${adSoyad},\n\nTekirExtra kaydınızı tamamlamak için e-posta adresinizi doğrulayın:\n${link}\n\nBu link 24 saat geçerlidir. Kaydı siz başlatmadıysanız bu iletiyi yok sayın.`,
      html: `<p>Merhaba ${adSoyad},</p><p>TekirExtra kaydınızı tamamlamak için e-posta adresinizi doğrulayın:</p><p><a href="${link}">E-postamı doğrula</a></p><p>Bu link 24 saat geçerlidir. Kaydı siz başlatmadıysanız bu iletiyi yok sayın.</p>`,
    });
    this.logger.log(`Doğrulama e-postası gönderildi: ${eposta}`);
  }
}
