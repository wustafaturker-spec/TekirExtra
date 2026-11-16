import type { Rol } from "@tekirextra/shared";
import type { AiSohbetMesaji } from "../saglayici/ai-provider.interface";
import type { EkranKaydi } from "../ajan/ai-ajan.service";

/**
 * AI-100 (P-15): asistan değerlendirme senaryosu. Girdi, izinli araçlar
 * (rol/özel rol/kanaldan türetilir), sahte araç çıktıları, beklenen karar ve
 * yanıt kuralları. Veriler yapaydır; gerçek vakalar kişi, firma, VKN, IBAN ve
 * tutarları değiştirilerek yazılır, ham içerik depoya girmez.
 */
export const KATEGORILER = ["yetki", "finans", "arac_secimi", "belirsizlik", "hata_iptal"] as const;
export type Kategori = (typeof KATEGORILER)[number];

/** Senaryonun kaynağı: eski üç kalite senaryosu, anonimleştirilmiş olumsuz geri bildirim, sentetik. */
export type SenaryoKaynagi = "mevcut" | "geri_bildirim" | "sentetik";

/**
 * Sahte araç çıktısı: düz değer başarılı sonuçtur (JSON'a çevrilir);
 * `{ hata }` aracın hata döndürmesidir. Fonksiyon verilirse modelin girdisiyle çağrılır.
 */
export type SahteCikti = unknown | { hata: string } | ((girdi: Record<string, unknown>) => unknown);

/** Aynı araca ardışık çağrıların çıktıları; son eleman tekrar eder. */
export class Sirali {
  constructor(readonly ciktilar: SahteCikti[]) {}
}
export const sirayla = (...ciktilar: SahteCikti[]) => new Sirali(ciktilar);

/**
 * Girdi alanı beklentisi: düzenli ifade metne çevrilmiş değerle, işlev değerin
 * kendisiyle, diğerleri eşitlikle karşılaştırılır.
 */
export type AlanBeklentisi = RegExp | string | number | boolean | ((deger: unknown) => boolean);

export interface AracBeklentisi {
  ad: string;
  /** Alan alan beklenti ya da girdinin tamamını denetleyen işlev; çağrılardan biri uymalı. */
  girdi?: Record<string, AlanBeklentisi> | ((girdi: Record<string, unknown>) => boolean);
}

export type Karar =
  /** Doğru araç(lar) doğru girdiyle çağrılır; onay talebi açılmaz. */
  | "arac"
  /** Kullanıcıya seçim/eksik bilgi sorulur; yazan araç çalışmaz. */
  | "soru"
  /** İş yapılmaz, nedeni söylenir (yetki, silme, Telegram kısıtı…). */
  | "ret"
  /** Onaya tabi araç çağrılır ve onay talebi açılır; yapılmış gibi söylenmez. */
  | "onay";

export interface Beklenen {
  karar: Karar;
  /** Hepsi çağrılmış olmalı (sıra serbest). */
  araclar?: AracBeklentisi[];
  /** En az biri çağrılmış olmalı. */
  herhangiBiri?: string[];
  /** Hiçbiri çağrılmamalı. */
  yasakAraclar?: string[];
  /** Son yanıt hepsini içermeli. */
  icermeli?: RegExp[];
  /** Son yanıt hiçbirini içermemeli. */
  icermemeli?: RegExp[];
}

export interface SenaryoGirdisi {
  mesaj: string;
  /** Varsayılan yönetici. */
  rol?: Rol;
  /** KLN-20: özel rolün kapattığı kutular, ör. "kasa_banka.duzenle". */
  ozelRolKapali?: string[];
  kanal?: "WEB" | "TELEGRAM";
  /** AI-84: panel sayfası (araç grubu seçimine girer). */
  sayfa?: string;
  /** AI-78: ekran kaydı. */
  ekran?: EkranKaydi;
  /** Önceki konuşma. */
  gecmis?: AiSohbetMesaji[];
  /** Firmanın asistan talimatı. */
  ozelTalimatlar?: string;
}

export interface DegerlendirmeSenaryosu {
  id: string;
  kategori: Kategori;
  /** Kritik senaryolar 3 kez koşar; kapı bunların gerilemesine bakar. */
  kritik?: boolean;
  kaynak: SenaryoKaynagi;
  aciklama: string;
  girdi: SenaryoGirdisi;
  /** Araç adı → çıktı (`sirayla(...)` ardışık çağrılar için). Tanımsız araç "okunamadı" hatası döner. */
  ciktilar?: Record<string, SahteCikti>;
  /** Yazan araçlarda ad → kimlik çözümü (ekrandaki kimlikleriCoz yerine). Birden çok aday seçim hatası döner. */
  kimlikler?: Array<{ tur: "cari" | "stok" | "belge" | "fatura"; ad: string; id: string }>;
  beklenen: Beklenen;
}
