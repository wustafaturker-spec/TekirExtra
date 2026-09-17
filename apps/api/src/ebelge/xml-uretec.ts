import { Fatura, FaturaSatir, CariHesap } from "@prisma/client";
import { senaryoUblKodu, tevkifatKoduBul } from "@tekirextra/shared";
import { adSoyadCoz } from "../cari/ad-soyad";
import {
  type BelgeTemasi,
  VARSAYILAN_TEMA,
  sablonNormalize,
  sayfaStili,
} from "../core/pdf/belge-temasi";
import { EARSIV_ELEKTRONIK_IBARESI } from "../fatura/fatura-pdf";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { KAREKOD_YER_TUTUCU_ID } from "./karekod";

/**
 * EBLG-32: alıcının görüntüleyicisinde karekodu çizen kütüphane
 * (qrcode-generator). Her faturaya gömüldüğü için satır başı girintisi ve
 * tamamı yorum olan satırlar atılır; satır sonları korunduğu için kodun anlamı
 * değişmez. Lisans notu MIT gereği başa yeniden yazılır.
 */
const QR_KUTUPHANESI =
  "/*! QR Code Generator for JavaScript | Copyright (c) 2009 Kazuhiko Arase | MIT License */\n" +
  readFileSync(createRequire(__filename).resolve("qrcode-generator"), "utf8")
    .split("\n")
    .map((satir) => satir.trim())
    .filter((satir) => satir !== "" && !satir.startsWith("//"))
    .join("\n");

/**
 * EBLG-31: UBL'e gömülen görünüm. Alıcı belgemizi bununla görür, bu yüzden
 * kendi PDF çıktımızla aynı düzeni ve aynı stili (`sayfaStili`) üretir —
 * gönderdiğimiz belge ile bastığımız belge ayrışmamalıdır. FTR-25: kiracının
 * seçtiği şablon, vurgu rengi ve logosu buraya da işler, böylece alıcı da
 * gönderenin tasarımını görür.
 *
 * XSLT 1.0'dır: e-fatura görüntüleyicilerinin ortak paydası budur. Ad alanı
 * önekleri gönderene göre değişebildiği için düğümler `local-name()` ile
 * seçilir.
 */
const FATURA_XSLT_SABLONU = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="no"/>
  <xsl:decimal-format name="tr" decimal-separator="," grouping-separator="."/>

  <!--
    EBLG-32: karekodun KDV kırılımı. Bu görünüm yalnız kendi ürettiğimiz UBL'e
    gömülür; üreteç başlığa tek, oransız KDV alt toplamı yazdığı için kırılım
    satırların alt toplamlarından orana göre gruplanır (Muenchian yöntemi).
  -->
  <xsl:key name="kdvOrani"
    match="*[local-name()='InvoiceLine']/*[local-name()='TaxTotal']/*[local-name()='TaxSubtotal'][*[local-name()='TaxCategory']/*[local-name()='TaxScheme']/*[local-name()='TaxTypeCode'] = '0015']"
    use="number(*[local-name()='Percent'])"/>

  <xsl:variable name="fatura" select="/*[local-name()='Invoice']"/>
  <xsl:variable name="paraKodu" select="$fatura/*[local-name()='DocumentCurrencyCode']"/>
  <xsl:variable name="para">
    <xsl:choose>
      <xsl:when test="$paraKodu = 'TRY'">TL</xsl:when>
      <xsl:otherwise><xsl:value-of select="$paraKodu"/></xsl:otherwise>
    </xsl:choose>
  </xsl:variable>

  <!-- Sağlayıcının atadığı tam numara: 3 karakter seri + 13 hane. Yalnız önek varsa karekod basılmaz. -->
  <xsl:variable name="belgeNo" select="normalize-space($fatura/*[local-name()='ID'])"/>
  <xsl:variable name="karekodlu" select="string-length($belgeNo) = 16
    and translate(substring($belgeNo, 1, 3), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '') = ''
    and translate(substring($belgeNo, 4), '0123456789', '') = ''"/>

  <!-- UBL tarihi YYYY-AA-GG; PDF ile aynı biçimde gösterilir. -->
  <xsl:template name="tarih">
    <xsl:param name="deger"/>
    <xsl:if test="string-length($deger) = 10">
      <xsl:value-of select="concat(substring($deger,9,2),'.',substring($deger,6,2),'.',substring($deger,1,4))"/>
    </xsl:if>
  </xsl:template>

  <!-- UN/ECE Rec 20 kodları; ubl-oku.ts ile aynı karşılıklar. -->
  <xsl:template name="birim">
    <xsl:param name="kod"/>
    <xsl:choose>
      <xsl:when test="$kod = 'C62' or $kod = 'NIU' or $kod = 'PCE'">adet</xsl:when>
      <xsl:when test="$kod = 'KGM'">kg</xsl:when>
      <xsl:when test="$kod = 'GRM'">gram</xsl:when>
      <xsl:when test="$kod = 'TNE'">ton</xsl:when>
      <xsl:when test="$kod = 'LTR'">litre</xsl:when>
      <xsl:when test="$kod = 'MLT'">ml</xsl:when>
      <xsl:when test="$kod = 'MTR'">metre</xsl:when>
      <xsl:when test="$kod = 'MTK'">m2</xsl:when>
      <xsl:when test="$kod = 'MTQ'">m3</xsl:when>
      <xsl:when test="$kod = 'CMT'">cm</xsl:when>
      <xsl:when test="$kod = 'MMT'">mm</xsl:when>
      <xsl:when test="$kod = 'PA'">paket</xsl:when>
      <xsl:when test="$kod = 'PR'">çift</xsl:when>
      <xsl:when test="$kod = 'DAY'">gün</xsl:when>
      <xsl:when test="$kod = 'HUR'">saat</xsl:when>
      <xsl:when test="$kod = 'MON'">ay</xsl:when>
      <xsl:when test="$kod = 'ANN'">yıl</xsl:when>
      <xsl:otherwise><xsl:value-of select="$kod"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="tutar">
    <xsl:param name="deger"/>
    <xsl:value-of select="format-number($deger, '#.##0,00', 'tr')"/>
  </xsl:template>

  <xsl:template name="toplamSatiri">
    <xsl:param name="etiket"/>
    <xsl:param name="deger"/>
    <xsl:param name="kalin" select="0"/>
    <tr>
      <xsl:if test="$kalin = 1"><xsl:attribute name="style">font-weight:bold</xsl:attribute></xsl:if>
      <td style="padding:3px 8px"><xsl:value-of select="$etiket"/></td>
      <td class="sag" style="padding:3px 8px">
        <xsl:call-template name="tutar"><xsl:with-param name="deger" select="$deger"/></xsl:call-template>
        <xsl:text> </xsl:text><xsl:value-of select="$para"/>
      </td>
    </tr>
  </xsl:template>

  <!-- Taraf kimliği: schemeID'si VKN/TCKN olan, yoksa ilki (ubl-oku.ts vknBul). -->
  <xsl:template name="vknTckn">
    <xsl:param name="taraf"/>
    <xsl:variable name="kimlikler" select="$taraf/*[local-name()='PartyIdentification']/*[local-name()='ID']"/>
    <xsl:variable name="uygun" select="$kimlikler[translate(@schemeID, 'vkntc', 'VKNTC') = 'VKN' or translate(@schemeID, 'vkntc', 'VKNTC') = 'TCKN']"/>
    <xsl:choose>
      <xsl:when test="$uygun"><xsl:value-of select="normalize-space($uygun[1])"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="normalize-space($kimlikler[1])"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="jsonAlan">
    <xsl:param name="ad"/>
    <xsl:param name="deger"/>
    <xsl:param name="ilk" select="0"/>
    <xsl:if test="$ilk = 0"><xsl:text>,</xsl:text></xsl:if>
    <xsl:text>"</xsl:text><xsl:value-of select="$ad"/><xsl:text>":"</xsl:text><xsl:value-of select="$deger"/><xsl:text>"</xsl:text>
  </xsl:template>

  <!--
    EBLG-32: GİB Karekod Standardı Kılavuzu v1.0 §2.1–2.2 JSON'u. Alan sırası ve
    biçimi sunucudaki faturaKarekodVerisi (ubl-oku.ts) ile birebir aynıdır;
    karekod-xslt kabul testi ikisini tarayıcıda karşılaştırır.
  -->
  <xsl:template name="karekodVerisi">
    <xsl:variable name="parasal" select="$fatura/*[local-name()='LegalMonetaryTotal']"/>
    <xsl:text>{</xsl:text>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">vkntckn</xsl:with-param>
      <xsl:with-param name="ilk" select="1"/>
      <xsl:with-param name="deger">
        <xsl:call-template name="vknTckn">
          <xsl:with-param name="taraf" select="$fatura/*[local-name()='AccountingSupplierParty']/*[local-name()='Party']"/>
        </xsl:call-template>
      </xsl:with-param>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">avkntckn</xsl:with-param>
      <xsl:with-param name="deger">
        <xsl:call-template name="vknTckn">
          <xsl:with-param name="taraf" select="$fatura/*[local-name()='AccountingCustomerParty']/*[local-name()='Party']"/>
        </xsl:call-template>
      </xsl:with-param>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">senaryo</xsl:with-param>
      <xsl:with-param name="deger" select="normalize-space($fatura/*[local-name()='ProfileID'])"/>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">tip</xsl:with-param>
      <xsl:with-param name="deger" select="normalize-space($fatura/*[local-name()='InvoiceTypeCode'])"/>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">tarih</xsl:with-param>
      <xsl:with-param name="deger" select="normalize-space($fatura/*[local-name()='IssueDate'])"/>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">no</xsl:with-param>
      <xsl:with-param name="deger" select="$belgeNo"/>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">ettn</xsl:with-param>
      <xsl:with-param name="deger" select="normalize-space($fatura/*[local-name()='UUID'])"/>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">parabirimi</xsl:with-param>
      <xsl:with-param name="deger">
        <xsl:choose>
          <xsl:when test="normalize-space($paraKodu) != ''"><xsl:value-of select="normalize-space($paraKodu)"/></xsl:when>
          <xsl:otherwise>TRY</xsl:otherwise>
        </xsl:choose>
      </xsl:with-param>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">malhizmettoplam</xsl:with-param>
      <xsl:with-param name="deger" select="format-number($parasal/*[local-name()='LineExtensionAmount'], '0.00')"/>
    </xsl:call-template>
    <xsl:variable name="kdvAltToplamlari" select="$fatura/*[local-name()='InvoiceLine']/*[local-name()='TaxTotal']/*[local-name()='TaxSubtotal'][*[local-name()='TaxCategory']/*[local-name()='TaxScheme']/*[local-name()='TaxTypeCode'] = '0015']"/>
    <xsl:for-each select="$kdvAltToplamlari[generate-id() = generate-id(key('kdvOrani', number(*[local-name()='Percent']))[1])]">
      <xsl:sort select="number(*[local-name()='Percent'])" data-type="number"/>
      <xsl:variable name="oran" select="number(*[local-name()='Percent'])"/>
      <xsl:variable name="grup" select="key('kdvOrani', $oran)"/>
      <xsl:call-template name="jsonAlan">
        <xsl:with-param name="ad" select="concat('kdvmatrah(', format-number($oran, '0.##'), ')')"/>
        <xsl:with-param name="deger" select="format-number(sum($grup/*[local-name()='TaxableAmount']), '0.00')"/>
      </xsl:call-template>
      <xsl:call-template name="jsonAlan">
        <xsl:with-param name="ad" select="concat('hesaplanankdv(', format-number($oran, '0.##'), ')')"/>
        <xsl:with-param name="deger" select="format-number(sum($grup/*[local-name()='TaxAmount']), '0.00')"/>
      </xsl:call-template>
    </xsl:for-each>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">vergidahil</xsl:with-param>
      <xsl:with-param name="deger" select="format-number($parasal/*[local-name()='TaxInclusiveAmount'], '0.00')"/>
    </xsl:call-template>
    <xsl:call-template name="jsonAlan">
      <xsl:with-param name="ad">odenecek</xsl:with-param>
      <xsl:with-param name="deger" select="format-number($parasal/*[local-name()='PayableAmount'], '0.00')"/>
    </xsl:call-template>
    <xsl:text>}</xsl:text>
  </xsl:template>

  <xsl:template match="/">
    <html lang="tr">
      <head>
        <meta charset="UTF-8"/>
        <title><xsl:value-of select="$fatura/*[local-name()='ID']"/></title>
        <style>__STIL__</style>
      </head>
      <body class="sablon-__SABLON__">
        <!-- EBLG-32: karekod sağ üstte. Veri gizli metin olarak durur, aşağıdaki betik çizer. -->
        <xsl:if test="$karekodlu">
          <div style="text-align:right;margin:0 0 6px">
            <div id="${KAREKOD_YER_TUTUCU_ID}" style="display:inline-block;width:35mm;height:35mm"></div>
          </div>
          <div id="${KAREKOD_YER_TUTUCU_ID}-veri" style="display:none"><xsl:call-template name="karekodVerisi"/></div>
        </xsl:if>
        <div class="ust-serit">
          <h1>
            <xsl:choose>
              <xsl:when test="$fatura/*[local-name()='ProfileID'] = 'EARSIVFATURA'">e-ARŞİV FATURA</xsl:when>
              <xsl:otherwise>e-FATURA</xsl:otherwise>
            </xsl:choose>
          </h1>
          __MARKA__
        </div>

        <table style="width:100%;margin-bottom:12px;font-size:9pt">
          <tr>
            <td style="vertical-align:top;width:50%">
              <div class="kutu">
                <xsl:variable name="satici" select="$fatura/*[local-name()='AccountingSupplierParty']/*[local-name()='Party']"/>
                <strong><xsl:value-of select="$satici/*[local-name()='PartyName']/*[local-name()='Name']"/></strong><br/>
                <xsl:text>VKN: </xsl:text>
                <xsl:value-of select="$satici/*[local-name()='PartyIdentification']/*[local-name()='ID'][1]"/>
                <xsl:if test="$satici/*[local-name()='PartyTaxScheme']/*[local-name()='TaxScheme']/*[local-name()='Name']">
                  <xsl:text> — </xsl:text>
                  <xsl:value-of select="$satici/*[local-name()='PartyTaxScheme']/*[local-name()='TaxScheme']/*[local-name()='Name']"/>
                </xsl:if>
              </div>
            </td>
            <td style="width:4%"></td>
            <td style="vertical-align:top;width:46%">
              <div class="kutu">
                <xsl:variable name="alici" select="$fatura/*[local-name()='AccountingCustomerParty']/*[local-name()='Party']"/>
                <strong>
                  <xsl:text>Sayın </xsl:text>
                  <xsl:choose>
                    <xsl:when test="$alici/*[local-name()='PartyName']/*[local-name()='Name']">
                      <xsl:value-of select="$alici/*[local-name()='PartyName']/*[local-name()='Name']"/>
                    </xsl:when>
                    <xsl:otherwise>
                      <xsl:value-of select="concat($alici/*[local-name()='Person']/*[local-name()='FirstName'],' ',$alici/*[local-name()='Person']/*[local-name()='FamilyName'])"/>
                    </xsl:otherwise>
                  </xsl:choose>
                </strong><br/>
                <xsl:text>VKN/TCKN: </xsl:text>
                <xsl:value-of select="$alici/*[local-name()='PartyIdentification']/*[local-name()='ID'][1]"/><br/>
                <xsl:text>Fatura No: </xsl:text>
                <strong><xsl:value-of select="$fatura/*[local-name()='ID']"/></strong><br/>
                <xsl:text>Tarih: </xsl:text>
                <xsl:call-template name="tarih">
                  <xsl:with-param name="deger" select="$fatura/*[local-name()='IssueDate']"/>
                </xsl:call-template>
                <xsl:if test="$fatura/*[local-name()='PaymentMeans']/*[local-name()='PaymentDueDate']">
                  <xsl:text> • Vade: </xsl:text>
                  <xsl:call-template name="tarih">
                    <xsl:with-param name="deger" select="$fatura/*[local-name()='PaymentMeans']/*[local-name()='PaymentDueDate']"/>
                  </xsl:call-template>
                </xsl:if>
                <br/>
                <xsl:text>ETTN: </xsl:text><xsl:value-of select="$fatura/*[local-name()='UUID']"/><br/>
                <xsl:text>Senaryo: </xsl:text><xsl:value-of select="$fatura/*[local-name()='InvoiceTypeCode']"/>
                <xsl:text> • Profil: </xsl:text><xsl:value-of select="$fatura/*[local-name()='ProfileID']"/>
              </div>
            </td>
          </tr>
        </table>

        <table class="veri">
          <thead>
            <tr>
              <th>#</th><th>Kod</th><th>Ürün / Hizmet</th>
              <th class="sag">Miktar</th><th class="sag">Birim Fiyat</th>
              <th class="sag">İsk.</th><th class="sag">Matrah</th>
              <th class="sag">KDV %</th><th class="sag">KDV</th><th class="sag">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <xsl:for-each select="$fatura/*[local-name()='InvoiceLine']">
              <xsl:variable name="kalem" select="*[local-name()='Item']"/>
              <xsl:variable name="vergi" select="*[local-name()='TaxTotal']/*[local-name()='TaxSubtotal']"/>
              <xsl:variable name="matrah" select="*[local-name()='LineExtensionAmount']"/>
              <xsl:variable name="kdv" select="*[local-name()='TaxTotal']/*[local-name()='TaxAmount']"/>
              <tr>
                <td class="orta"><xsl:value-of select="*[local-name()='ID']"/></td>
                <td><xsl:value-of select="$kalem/*[local-name()='SellersItemIdentification']/*[local-name()='ID']"/></td>
                <td>
                  <xsl:value-of select="$kalem/*[local-name()='Name']"/>
                  <xsl:if test="$vergi/*[local-name()='TaxCategory']/*[local-name()='TaxExemptionReasonCode']">
                    <br/><span style="color:#6b7280;font-size:8pt">
                      <xsl:text>KDV istisna kodu: </xsl:text>
                      <xsl:value-of select="$vergi/*[local-name()='TaxCategory']/*[local-name()='TaxExemptionReasonCode']"/>
                    </span>
                  </xsl:if>
                </td>
                <td class="sag">
                  <xsl:value-of select="format-number(*[local-name()='InvoicedQuantity'], '#.##0,###', 'tr')"/>
                  <xsl:text> </xsl:text>
                  <xsl:call-template name="birim">
                    <xsl:with-param name="kod" select="*[local-name()='InvoicedQuantity']/@unitCode"/>
                  </xsl:call-template>
                </td>
                <td class="sag">
                  <xsl:call-template name="tutar">
                    <xsl:with-param name="deger" select="*[local-name()='Price']/*[local-name()='PriceAmount']"/>
                  </xsl:call-template>
                </td>
                <td class="sag">
                  <xsl:if test="*[local-name()='AllowanceCharge']/*[local-name()='MultiplierFactorNumeric'] &gt; 0">
                    <xsl:value-of select="concat('%', format-number(*[local-name()='AllowanceCharge']/*[local-name()='MultiplierFactorNumeric'] * 100, '#.##0,###', 'tr'))"/>
                  </xsl:if>
                </td>
                <td class="sag">
                  <xsl:call-template name="tutar"><xsl:with-param name="deger" select="$matrah"/></xsl:call-template>
                </td>
                <td class="sag">
                  <xsl:value-of select="concat('%', format-number($vergi/*[local-name()='Percent'], '#.##0,###', 'tr'))"/>
                </td>
                <td class="sag">
                  <xsl:call-template name="tutar"><xsl:with-param name="deger" select="$kdv"/></xsl:call-template>
                </td>
                <td class="sag">
                  <xsl:call-template name="tutar"><xsl:with-param name="deger" select="$matrah + $kdv"/></xsl:call-template>
                </td>
              </tr>
            </xsl:for-each>
          </tbody>
        </table>

        <xsl:variable name="parasal" select="$fatura/*[local-name()='LegalMonetaryTotal']"/>
        <table style="margin-top:12px;margin-left:auto;border:1px solid #e5e7eb;border-radius:4px;font-size:9pt">
          <xsl:call-template name="toplamSatiri">
            <xsl:with-param name="etiket">Brüt Toplam</xsl:with-param>
            <xsl:with-param name="deger" select="$parasal/*[local-name()='LineExtensionAmount']"/>
          </xsl:call-template>
          <xsl:if test="$parasal/*[local-name()='AllowanceTotalAmount'] &gt; 0">
            <xsl:call-template name="toplamSatiri">
              <xsl:with-param name="etiket">İskonto</xsl:with-param>
              <xsl:with-param name="deger" select="0 - $parasal/*[local-name()='AllowanceTotalAmount']"/>
            </xsl:call-template>
          </xsl:if>
          <xsl:call-template name="toplamSatiri">
            <xsl:with-param name="etiket">KDV Matrahı</xsl:with-param>
            <xsl:with-param name="deger" select="$parasal/*[local-name()='TaxExclusiveAmount']"/>
          </xsl:call-template>
          <xsl:call-template name="toplamSatiri">
            <xsl:with-param name="etiket">Hesaplanan KDV</xsl:with-param>
            <xsl:with-param name="deger" select="$fatura/*[local-name()='TaxTotal'][1]/*[local-name()='TaxAmount']"/>
          </xsl:call-template>
          <xsl:if test="$fatura/*[local-name()='WithholdingTaxTotal']">
            <xsl:call-template name="toplamSatiri">
              <xsl:with-param name="etiket">KDV Tevkifatı</xsl:with-param>
              <xsl:with-param name="deger" select="0 - sum($fatura/*[local-name()='WithholdingTaxTotal']/*[local-name()='TaxAmount'])"/>
            </xsl:call-template>
          </xsl:if>
          <xsl:call-template name="toplamSatiri">
            <xsl:with-param name="etiket">Genel Toplam</xsl:with-param>
            <xsl:with-param name="deger" select="$parasal/*[local-name()='PayableAmount']"/>
            <xsl:with-param name="kalin" select="1"/>
          </xsl:call-template>
        </table>

        <xsl:if test="$fatura/*[local-name()='Note']">
          <p style="margin-top:10px;color:#6b7280"><xsl:value-of select="$fatura/*[local-name()='Note'][1]"/></p>
        </xsl:if>
        <xsl:if test="$fatura/*[local-name()='ProfileID'] = 'EARSIVFATURA' and not($fatura//*[local-name()='SendType'] = 'KAGIT')">
          <p style="margin-top:10px;font-size:9pt">__EARSIV_IBARESI__</p>
        </xsl:if>
        <xsl:if test="$karekodlu">
          <script type="text/javascript"><![CDATA[__QR_KUTUPHANESI__
(function () {
  var hedef = document.getElementById("${KAREKOD_YER_TUTUCU_ID}");
  var veri = document.getElementById("${KAREKOD_YER_TUTUCU_ID}-veri");
  if (!hedef || !veri || hedef.firstChild) return;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  var qr = qrcode(0, "M");
  qr.addData(veri.textContent);
  qr.make();
  hedef.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
  var svg = hedef.firstChild;
  if (svg && svg.style) { svg.style.width = "100%"; svg.style.height = "100%"; }
})();
]]></script>
        </xsl:if>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;

/**
 * Logo XSLT'ye data URI olarak gömülür (alıcının görüntüleyicisi dış kaynak
 * yükleyemez). Karekod zaten ~52 KB ekliyor; bu yüzden logo LOGO_SINIRI'ni
 * aşarsa belgeye konmaz, marka yazısı kalır — fatura logonun boyutu yüzünden
 * şişmesin.
 */
const LOGO_SINIRI = 50 * 1024;

function markaHtml(tema: BelgeTemasi): string {
  const logo = tema.logoDataUri;
  if (logo && logo.length <= LOGO_SINIRI) {
    return `<img class="logo" src="${logo.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" alt=""/>`;
  }
  return `<span class="marka">TekirExtra</span>`;
}

/** Kiracının temasıyla üretilmiş gömülü görünüm (FTR-25). */
export function faturaXslt(tema: BelgeTemasi = VARSAYILAN_TEMA): string {
  return FATURA_XSLT_SABLONU
    .replace("__STIL__", sayfaStili(tema))
    .replace("__SABLON__", sablonNormalize(tema.sablon))
    .replace("__MARKA__", () => markaHtml(tema))
    .replace("__EARSIV_IBARESI__", EARSIV_ELEKTRONIK_IBARESI)
    // İşlev biçimi: kütüphanedeki "$" dizileri değiştirme kalıbı olarak yorumlanmasın.
    .replace("__QR_KUTUPHANESI__", () => QR_KUTUPHANESI);
}

export function faturaUblUret(
  fatura: Fatura & {
    satirlar: (FaturaSatir & { stok: { kod: string; ad: string } })[];
    cari: CariHesap;
  },
  supplier: { unvan: string; vkn: string; vergiDairesi?: string; adres?: string },
  secenekler: { tur?: "efatura" | "earsiv"; tema?: BelgeTemasi } = {},
): string {
  // e-Arşiv, e-Fatura'dan üç noktada ayrılır: profil `EARSIVFATURA`, alıcı
  // etiketi yoktur ve gönderim şekli UBL içinde bildirilir.
  const earsiv = secenekler.tur === "earsiv";
  // ISO Tarihleri
  const tarihStr = fatura.tarih.toISOString().slice(0, 10);
  const saatStr = "12:00:00";

  // XML Karakter kaçırma yardımcısı
  const escape = (str?: string | null) => {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  const uuid = fatura.id;
  const no = fatura.no || "TASLAK";

  /**
   * Gerçek kişi alıcı. UBL-TR şematronu `schemeID="TCKN"` gördüğünde `cac:Person`
   * arar; ünvanı `cac:PartyName` içinde bırakmak e-Arşiv gönderimini reddettirir
   * (NES, 2026-09-10). Ad ve soyad kartta ayrı tutulur (CARI-21); boşsa
   * unvandan tahmin edilir.
   */
  const aliciTckn = fatura.cari.vknTckn?.length === 11;
  const { ad: aliciAd, soyad: aliciSoyad } = adSoyadCoz(fatura.cari);

  /**
   * Tevkifat, fatura düzeyinde `WithholdingTaxTotal` olarak bildirilir; vergi
   * türü kodu satırdaki GİB tevkifat kodudur (FTR-18). Aynı kodlu satırlar tek
   * blokta toplanır, çünkü kod başına bir alt toplam beklenir.
   */
  const tevkifatGruplari = new Map<string, { tutar: number; oran: number }>();
  for (const satir of fatura.satirlar) {
    if (!satir.tevkifatKodu || Number(satir.tevkifatTutari) === 0) continue;
    const mevcut = tevkifatGruplari.get(satir.tevkifatKodu) ?? { tutar: 0, oran: 0 };
    mevcut.tutar += Number(satir.tevkifatTutari);
    // Oran koddan gelir; pay/payda saklı türetilmiş değerlerdir.
    if (satir.tevkifatPay && satir.tevkifatPayda) mevcut.oran = (satir.tevkifatPay / satir.tevkifatPayda) * 100;
    tevkifatGruplari.set(satir.tevkifatKodu, mevcut);
  }
  const tevkifatBlogu = [...tevkifatGruplari.entries()]
    .filter(([kod]) => tevkifatKoduBul(kod))
    .map(([kod, deger]) => `  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${deger.tutar.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${deger.tutar.toFixed(2)}</cbc:TaxAmount>
      <cbc:Percent>${deger.oran.toFixed(2)}</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:TaxTypeCode>${kod}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${earsiv ? "EARSIVFATURA" : fatura.efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA"}</cbc:ProfileID>
  <cbc:ID>${no}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
  <cbc:IssueTime>${saatStr}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${senaryoUblKodu(fatura.senaryo)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${fatura.dovizCinsi}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${fatura.satirlar.length}</cbc:LineCountNumeric>

${earsiv ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>${fatura.earsivGonderimSekli === "kagit" ? "KAGIT" : "ELEKTRONIK"}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentTypeCode>SEND_TYPE</cbc:DocumentTypeCode>
  </cac:AdditionalDocumentReference>` : ""}
  <cac:AdditionalDocumentReference>
    <cbc:ID>${uuid}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentType>XSLT</cbc:DocumentType>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject characterSetCode="UTF-8" encodingCode="Base64" filename="${escape(no)}.xslt" mimeCode="application/xml">${Buffer.from(faturaXslt(secenekler.tema), "utf8").toString("base64")}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  
  <cac:Signature>
    <cbc:ID schemeID="VKN_TCKN">${supplier.vkn}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${supplier.vkn}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(supplier.unvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#Signature</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${supplier.vkn}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(supplier.unvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${escape(supplier.vergiDairesi || "Marmara V.D.")}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${aliciTckn ? "TCKN" : "VKN"}">${fatura.cari.vknTckn}</cbc:ID>
      </cac:PartyIdentification>
${aliciTckn ? "" : `      <cac:PartyName>
        <cbc:Name>${escape(fatura.cari.unvan)}</cbc:Name>
      </cac:PartyName>`}
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
${aliciTckn ? `      <cac:Person>
        <cbc:FirstName>${escape(aliciAd)}</cbc:FirstName>
        <cbc:FamilyName>${escape(aliciSoyad)}</cbc:FamilyName>
      </cac:Person>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamKdv.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamMatrah.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamKdv.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
${tevkifatBlogu}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamBrut.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamMatrah.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${fatura.dovizCinsi}">${fatura.genelToplam.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${fatura.dovizCinsi}">${kurusTopla(fatura.toplamSatirIskontosu, fatura.genelIskontoToplam)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${fatura.dovizCinsi}">${fatura.genelToplam.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${fatura.satirlar
    .map(
      (s, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">${s.miktar.toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      ${Number(s.iskontoOrani ?? 0) > 0 ? `<cbc:MultiplierFactorNumeric>${(Number(s.iskontoOrani) / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>` : ""}
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${s.iskontoTutari.toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>${Number(s.genelIskontoPayi ?? 0) > 0 ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReason>Genel iskonto payı</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${Number(s.genelIskontoPayi).toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>` : ""}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${s.kdvTutari.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${s.kdvTutari.toFixed(2)}</cbc:TaxAmount>
        <cbc:Percent>${s.kdvOrani.toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          ${s.gibIstisnaKodu ? `<cbc:TaxExemptionReasonCode>${escape(s.gibIstisnaKodu)}</cbc:TaxExemptionReasonCode>` : ""}
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${escape(s.stok.ad)}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>${escape(s.stok.kod)}</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${fatura.dovizCinsi}">${s.birimFiyat.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
  `,
    )
    .join("")}
</Invoice>`;
}

/**
 * EBLG-16 sonrası düzeltme: numarayı sağlayıcı attığında UBL'e yalnız seri
 * öneki yazılmış olur. Arşivlenen belge, düzenlenen belgenin kendisidir; bu
 * yüzden sağlayıcıdan dönen numara `cbc:ID` alanına geri yazılır. Yoksa
 * arşivdeki belge numarasız kalır ve ondan üretilen görünüm "SNC" der.
 *
 * Fatura numarası, `cbc:ProfileID`'yi izleyen ilk `cbc:ID`'dir — belgede
 * onlarca `cbc:ID` bulunduğu için değişiklik bu çıpaya bağlanır.
 */
export function belgeNoyuUbleYaz(xml: string, belgeNo: string): string {
  const desen = /(<cbc:ProfileID>[^<]*<\/cbc:ProfileID>\s*<cbc:ID>)([^<]*)(<\/cbc:ID>)/;
  if (!desen.test(xml)) return xml;
  return xml.replace(desen, (_tam, bas: string, _eski: string, son: string) => `${bas}${escapeXml(belgeNo)}${son}`);
}

/** Tutarları kuruşta toplar; ondalıklı toplama `0.1 + 0.2` kaymasına düşmesin. */
function kurusTopla(...tutarlar: (number | { toString(): string } | null | undefined)[]): string {
  const kurus = tutarlar.reduce<number>((t, v) => t + Math.round(Number(v ?? 0) * 100), 0);
  return (kurus / 100).toFixed(2);
}

function escapeXml(deger: string): string {
  return deger
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
