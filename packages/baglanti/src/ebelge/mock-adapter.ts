import type { EbelgeSaglayici } from "@tekirextra/shared";
import type { EntegratorAdapter } from "./adapter";
import type {
  BaglantiSonuc,
  BelgeDurumSonuc,
  EntegratorConfig,
  GelenBelge,
  GonderimSonuc,
  MukellefDurum,
  UblBelge,
} from "./types";

/**
 * Geliştirme/test için sahte entegratör (T-01): gerçek sağlayıcı hesapları
 * edinilene kadar tüm e-belge akışı bu adaptörle uçtan uca çalıştırılır.
 * Davranış deterministiktir ki testler tekrarlanabilir olsun.
 */
export class MockEntegratorAdapter implements EntegratorAdapter {
  readonly saglayici: EbelgeSaglayici;

  private readonly gonderilenler = new Map<string, number>();

  constructor(saglayici: EbelgeSaglayici = "izibiz") {
    this.saglayici = saglayici;
  }

  async baglantiTest(cfg: EntegratorConfig): Promise<BaglantiSonuc> {
    if (!cfg.kullaniciAdi) {
      return { basarili: false, mesaj: "Kullanıcı adı boş olamaz" };
    }
    return { basarili: true, mesaj: "Mock bağlantı başarılı" };
  }

  /** Son hanesi çift olan VKN/TCKN e-Fatura mükellefi kabul edilir. */
  async mukellefSorgula(_cfg: EntegratorConfig, vknTckn: string): Promise<MukellefDurum> {
    const sonHane = Number(vknTckn.at(-1));
    const mukellef = sonHane % 2 === 0;
    return {
      vknTckn,
      eFaturaMukellefi: mukellef,
      postaKutusu: mukellef ? `urn:mail:defaultpk@${vknTckn}` : undefined,
    };
  }

  async belgeGonder(_cfg: EntegratorConfig, belge: UblBelge): Promise<GonderimSonuc> {
    const belgeRef = `MOCK-${belge.uuid}`;
    this.gonderilenler.set(belgeRef, 0);
    return { basarili: true, belgeRef };
  }

  /** Her sorguda durum bir adım ilerler: kuyrukta → iletildi → kabul. */
  async durumSorgula(_cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    const sorguSayisi = this.gonderilenler.get(belgeRef);
    if (sorguSayisi === undefined) {
      return { belgeRef, durum: "hata", detay: "Belge bulunamadı" };
    }
    this.gonderilenler.set(belgeRef, sorguSayisi + 1);
    const durumlar = ["kuyrukta", "iletildi", "kabul"] as const;
    return { belgeRef, durum: durumlar[Math.min(sorguSayisi, 2)] };
  }

  /**
   * Deterministik tek bir gelen e-Fatura döner; belge numarası sabit olduğu
   * için ebelge servisi tekrarlı çekimlerde onu yinelemez (EBLG-05).
   */
  async gelenBelgeleriCek(_cfg: EntegratorConfig, _sonrasi: Date): Promise<GelenBelge[]> {
    const belgeNo = "MCK2026000000001";
    const gonderenVkn = "4840847211";
    return [
      {
        uuid: "00000000-0000-4000-8000-000000000001",
        belgeNo,
        gonderenVkn,
        gonderenUnvan: "Mock Tedarik A.Ş.",
        tarih: new Date("2026-01-15T00:00:00Z"),
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <ID>${belgeNo}</ID>
  <IssueDate>2026-01-15</IssueDate>
  <AccountingSupplierParty><Party><PartyIdentification><ID schemeID="VKN">${gonderenVkn}</ID></PartyIdentification></Party></AccountingSupplierParty>
</Invoice>`,
      },
    ];
  }

  async yanitGonder(
    _cfg: EntegratorConfig,
    belgeRef: string,
    _yanit: "kabul" | "ret",
  ): Promise<GonderimSonuc> {
    return { basarili: true, belgeRef };
  }
}
