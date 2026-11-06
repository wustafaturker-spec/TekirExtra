import { forwardRef, HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { RISK_ONAYI_ISARETI } from "../cari/cari-islem-denetimi";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { FaturaService } from "../fatura/fatura.service";
import { ebelgeUygulamasiDenetle } from "./ebelge-uygulamasi.guard";
import { EbelgeUygulamalariService } from "./ebelge-uygulamalari.service";
import { EbelgeKuyrukService } from "./ebelge-kuyruk.service";
import { EbelgeService } from "./ebelge.service";
import { sihirbazEngelleri } from "./gonderim-engelleri";

/** EBLG-152: tek istekte en çok bu kadar fatura işlenir. */
export const TOPLU_FATURA_SINIRI = 50;

export const TOPLU_ISLEMLER = ["kesinlestir", "kesinlestir_gonder", "gonder", "taslaga_geri_al"] as const;
export type TopluIslem = (typeof TOPLU_ISLEMLER)[number];

export const topluFaturaSemasi = z.object({
  islem: z.enum(TOPLU_ISLEMLER),
  faturaIdler: z.array(z.string().uuid()).min(1, "En az bir fatura seçin").max(TOPLU_FATURA_SINIRI, `Tek seferde en çok ${TOPLU_FATURA_SINIRI} fatura işlenebilir`)
    .transform((idler) => [...new Set(idler)]),
});

/** Toplu işleme yalnız giden satış belgeleri girer. */
const TOPLU_TIPLER = new Set(["satis", "satis_iade"]);

export interface TopluSonuc {
  faturaId: string;
  no: string | null;
  cari: string | null;
  /** tamam: istenen her adım yapıldı; kismi: kesinleşti ama kuyruğa alınmadı; atlandi: hiçbir şey değişmedi. */
  sonuc: "tamam" | "kismi" | "atlandi";
  kesinlesti: boolean;
  kuyrugaAlindi: boolean;
  taslagaAlindi: boolean;
  mesaj: string | null;
}

const hataMetni = (hata: unknown) => {
  if (hata instanceof HttpException) {
    const yanit = hata.getResponse();
    const mesaj = typeof yanit === "string" ? yanit : (yanit as { message?: string | string[] }).message;
    return Array.isArray(mesaj) ? mesaj.join("; ") : mesaj ?? hata.message;
  }
  return hata instanceof Error ? hata.message : String(hata);
};

/**
 * EBLG-152: seçilen faturaları sırayla kesinleştirir / kuyruğa alır / taslağa
 * geri alır. Her fatura tek tek işlemlerle aynı kurallardan geçer; bir
 * faturadaki hata diğerlerini durdurmaz, sonucu satırına yazılır.
 */
@Injectable()
export class TopluFaturaService {
  private readonly logger = new Logger(TopluFaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => FaturaService)) private readonly faturalar: FaturaService,
    private readonly ebelge: EbelgeService,
    private readonly kuyruk: EbelgeKuyrukService,
    private readonly uygulamalar: EbelgeUygulamalariService,
  ) {}

  async calistir(islem: TopluIslem, faturaIdler: string[]): Promise<{ islem: TopluIslem; sonuclar: TopluSonuc[] }> {
    const { tenantId } = aktifBaglam();
    // Gönderim içeren işlem, firma e-Belge uygulamasına kayıtlı değilse hiç başlamaz (EBLG-77).
    if (islem === "kesinlestir_gonder" || islem === "gonder") await ebelgeUygulamasiDenetle(["efatura", "earsiv"], this.uygulamalar);
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { id: { in: faturaIdler } },
      select: { id: true, no: true, tip: true, durum: true, cari: { select: { unvan: true } }, ebelge: { select: { id: true } } },
    }));
    const harita = new Map(kayitlar.map((k) => [k.id, k]));
    const sonuclar: TopluSonuc[] = [];
    // Sıra kullanıcının seçim sırasıdır; numaralar da bu sırayla verilir.
    for (const id of faturaIdler) {
      const k = harita.get(id);
      const sonuc: TopluSonuc = { faturaId: id, no: k?.no ?? null, cari: k?.cari.unvan ?? null, sonuc: "atlandi", kesinlesti: false, kuyrugaAlindi: false, taslagaAlindi: false, mesaj: null };
      sonuclar.push(sonuc);
      const engel = !k ? "Fatura bulunamadı"
        : !TOPLU_TIPLER.has(k.tip) ? "Toplu işlem yalnız satış ve satış iade faturalarında yapılır"
        : (islem === "kesinlestir" || islem === "kesinlestir_gonder") && k.durum !== "taslak" ? "Fatura taslak değil"
        : (islem === "gonder" || islem === "taslaga_geri_al") && k.durum !== "kesin" ? "Fatura kesinleşmemiş"
        : islem !== "taslaga_geri_al" && k.ebelge ? "Faturanın e-Belge kaydı var; durumunu e-Belge ayrıntısından izleyin"
        : null;
      if (engel) { sonuc.mesaj = engel; continue; }

      if (islem === "taslaga_geri_al") {
        try { await this.faturalar.taslagaGeriAl(id); sonuc.taslagaAlindi = true; sonuc.sonuc = "tamam"; }
        catch (hata) { sonuc.mesaj = hataMetni(hata); }
        continue;
      }

      if (islem !== "gonder") {
        try {
          const kesin = await this.faturalar.kesinlestir(id) as { no?: string | null };
          sonuc.kesinlesti = true; sonuc.no = kesin?.no ?? sonuc.no;
        } catch (hata) {
          const mesaj = hataMetni(hata);
          // Risk onayı gerekçe ister; toplu işte gerekçe alınmaz (karar 2026-11-06).
          sonuc.mesaj = mesaj.includes(RISK_ONAYI_ISARETI) ? `${mesaj} — risk onayı için faturayı tek tek kesinleştirin` : mesaj;
          continue;
        }
        if (islem === "kesinlestir") { sonuc.sonuc = "tamam"; continue; }
      }

      try {
        await this.varsayilanlaKuyrugaAl(id);
        sonuc.kuyrugaAlindi = true; sonuc.sonuc = "tamam";
      } catch (hata) {
        sonuc.mesaj = hataMetni(hata);
        sonuc.sonuc = sonuc.kesinlesti ? "kismi" : "atlandi";
      }
    }
    const ozet = sonuclar.reduce((t, s) => ({ ...t, [s.sonuc]: (t[s.sonuc] ?? 0) + 1 }), {} as Record<string, number>);
    this.logger.log(JSON.stringify({ event: "toplu_fatura", tenantId, islem, adet: faturaIdler.length, ...ozet }));
    return { islem, sonuclar };
  }

  /**
   * Sihirbazın varsayılan seçimleriyle tek gönderimin denetimleri: bağlantı ve
   * kimlik, türe özel engeller, onaylanmamış ön denetim uyarısı (EBLG-141).
   * Uyarılar toplu işte onaylanmaz; uyarılı belge sihirbazdan gönderilir.
   */
  private async varsayilanlaKuyrugaAl(faturaId: string) {
    const wizard = await this.ebelge.wizardBilgisi(faturaId);
    if (!wizard.gonderilebilir) throw new Error(wizard.neden || "Fatura e-Belge gönderimine uygun değil");
    const engeller = sihirbazEngelleri(wizard);
    if (engeller.length) throw new Error(`${engeller.map((e) => e.mesaj).join("; ")} — eksikleri tamamlayıp sihirbazdan gönderin`);
    const bulgular = "onDenetim" in wizard && wizard.onDenetim ? wizard.onDenetim.bulgular : [];
    try { await this.ebelge.onDenetimOnayiDenetle({ faturaId }, bulgular, undefined); }
    catch { throw new Error(`Ön denetimde onay bekleyen ${bulgular.filter((b) => b.duzey === "uyari").length} uyarı var; e-Belge sihirbazında uyarıları görüp tek tek gönderin`); }
    await this.kuyruk.kuyrugaEkle(faturaId);
  }
}
