import { describe, expect, it } from "vitest";
import { icerikDenetle } from "../core/guvenlik/dosya-denetimi";
import { camtOku, mt940Oku, standartBicimBul, standartEkstreOku } from "./ekstre-standart";

const MT940 = `{1:F01BANKTRISAXXX0000000000}{2:I940BANKTRISXXXXN}{4:
:20:STMT20261023
:25:TR330006100519786457841326
:28C:00123/001
:60F:C261022TRY10000,00
:61:2610231023C1500,00NTRFNONREF//BANKREF001
:86:EFT GELEN ABC LTD FATURA 2026/145
TR120006400000112345678901
:61:2610231023D250,75NTRFODM2026000017//BANKREF002
:86:?20HAVALE ODM2026000017?32XYZ TEKSTIL ?33SAN. A.S.
:61:2610231023RD50,00NMSCREF/A/1
:86:IADE MASRAF
:62F:C261023TRY11299,25
-}`;

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>M1</MsgId><CreDtTm>2026-10-23T18:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>S1</Id>
      <Acct><Id><IBAN>TR330006100519786457841326</IBAN></Id><Ccy>TRY</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="TRY">10000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-22</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="TRY">8749.25</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-23</Dt></Dt></Bal>
      <Ntry>
        <Amt Ccy="TRY">1500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-23</Dt></BookgDt><AcctSvcrRef>BR-001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
          <RltdPties><Dbtr><Nm>ABC LTD ŞTİ</Nm></Dbtr><DbtrAcct><Id><IBAN>TR12 0006 4000 0011 2345 6789 01</IBAN></Id></DbtrAcct></RltdPties>
          <RmtInf><Ustrd>FATURA 2026/145</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="TRY">2750.75</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><DtTm>2026-10-23T10:15:00</DtTm></BookgDt><AcctSvcrRef>BR-002</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>ODM2026000017</EndToEndId></Refs>
          <RltdPties><Cdtr><Pty><Nm>XYZ TEKSTIL SAN. A.S.</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>TR560001000000000000000001</IBAN></Id></CdtrAcct></RltdPties>
          <RmtInf><Ustrd>EKIM KIRA</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="TRY">999.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts>
        <BookgDt><Dt>2026-10-23</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe("MT940 (KSB-32)", () => {
  it("biçimi tanır; tablo dosyasını tanımaz", () => {
    expect(standartBicimBul(Buffer.from(MT940))).toBe("mt940");
    expect(standartBicimBul(Buffer.from(CAMT))).toBe("camt053");
    expect(standartBicimBul(Buffer.from("Tarih;Açıklama;Tutar\n23.10.2026;EFT;1500,00"))).toBeNull();
  });

  it("satırları işaret, açıklama, dekont, karşı taraf ve yürüyen bakiyeyle okur", () => {
    const e = mt940Oku(Buffer.from(MT940));
    expect(e.hesaplar).toEqual([{ hesap: "TR330006100519786457841326", dovizCinsi: "TRY" }]);
    expect(e.acilis).toBe(10000);
    expect(e.kapanis).toBe(11299.25);
    expect(e.uyarilar).toEqual([]);
    expect(e.satirlar.map((s) => [s.tarih.toISOString().slice(0, 10), s.tutar, s.bakiye])).toEqual([
      ["2026-10-23", 1500, 11500],
      ["2026-10-23", -250.75, 11249.25],
      // RD: borç iptali, hesaba giriş; müşteri referansındaki tek "/" satırı bozmaz.
      ["2026-10-23", 50, 11299.25],
    ]);
    expect(e.satirlar[0]).toMatchObject({ aciklama: "EFT GELEN ABC LTD FATURA 2026/145 TR120006400000112345678901", dekontNo: "BANKREF001", karsiIban: "TR120006400000112345678901" });
    expect(e.satirlar[1]).toMatchObject({ aciklama: "HAVALE ODM2026000017", dekontNo: "BANKREF002", karsiUnvan: "XYZ TEKSTIL SAN. A.S." });
    expect(e.satirlar[2]).toMatchObject({ aciklama: "IADE MASRAF", dekontNo: "REF/A/1" });
    expect(new Set(e.satirlar.map((s) => s.satirOzeti)).size).toBe(3);
  });

  it("kapanış bakiyesi tutmazsa dosyanın eksik olabileceğini söyler", () => {
    const e = mt940Oku(Buffer.from(MT940.replace(":62F:C261023TRY11299,25", ":62F:C261023TRY12000,00")));
    expect(e.uyarilar[0]).toMatch(/kapanış 12000\.00.*eksik/);
  });

  it("Türkçe Windows kod sayfasıyla (1254) yazılmış dosyayı çözer", () => {
    const [once, sonra] = MT940.split("IADE MASRAF");
    const dosya = Buffer.concat([Buffer.from(once, "latin1"), Buffer.from([0xde, 0x45, 0x4b, 0x45, 0x52, 0x20, 0xdd, 0x41, 0x44, 0x45]), Buffer.from(sonra, "latin1")]);
    expect(mt940Oku(dosya).satirlar[2].aciklama).toBe("ŞEKER İADE");
  });

  it("aynı dosya aynı satır özetlerini üretir (ikinci yükleme yinelenen sayılır)", () => {
    expect(mt940Oku(Buffer.from(MT940)).satirlar.map((s) => s.satirOzeti)).toEqual(mt940Oku(Buffer.from(MT940)).satirlar.map((s) => s.satirOzeti));
  });
});

describe("camt.053 (KSB-32)", () => {
  it("kesinleşmiş hareketleri karşı taraf, IBAN ve EndToEndId ile okur; bekleyeni almaz", () => {
    const e = camtOku(Buffer.from(CAMT), "camt053");
    expect(e.hesaplar).toEqual([{ hesap: "TR330006100519786457841326", dovizCinsi: "TRY" }]);
    expect(e.satirlar).toHaveLength(2);
    expect(e.satirlar[0]).toMatchObject({ tutar: 1500, aciklama: "FATURA 2026/145", dekontNo: "BR-001", karsiUnvan: "ABC LTD ŞTİ", karsiIban: "TR120006400000112345678901", bakiye: 11500 });
    // Çıkışta karşı taraf alacaklıdır (v8+ Pty altında); talimat no açıklamaya eklenir.
    expect(e.satirlar[1]).toMatchObject({ tutar: -2750.75, aciklama: "EKIM KIRA Ref: ODM2026000017", karsiUnvan: "XYZ TEKSTIL SAN. A.S.", bakiye: 8749.25 });
    expect(e.satirlar[1].tarih.toISOString().slice(0, 10)).toBe("2026-10-23");
    expect(e.uyarilar).toEqual(["1. ekstrede 1 bekleyen (kesinleşmemiş) hareket alınmadı"]);
  });

  it("iptal (RvslInd) hareketin yönünü çevirir", () => {
    const iptalli = CAMT.replace("<Amt Ccy=\"TRY\">1500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>", "<Amt Ccy=\"TRY\">1500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><RvslInd>true</RvslInd>");
    expect(camtOku(Buffer.from(iptalli), "camt053").satirlar[0].tutar).toBe(-1500);
  });

  it("camt.052 (gün içi rapor) aynı biçimde okunur", () => {
    const rapor = CAMT.replace(/BkToCstmrStmt/g, "BkToCstmrAcctRpt").replace(/<(\/?)Stmt>/g, "<$1Rpt>");
    const e = standartEkstreOku(Buffer.from(rapor))!;
    expect(e.bicim).toBe("camt052");
    expect(e.satirlar).toHaveLength(2);
  });
});

describe("ekstre dosya denetimi (KSB-32)", () => {
  it("MT940 (.sta/.940) ve camt (.xml) ekstre olarak kabul edilir", () => {
    expect(icerikDenetle({ buffer: Buffer.from(MT940), originalname: "ekstre.sta" }, "ekstre").tur).toBe("metin");
    expect(icerikDenetle({ buffer: Buffer.from(MT940), originalname: "ekstre.940" }, "ekstre").tur).toBe("metin");
    expect(icerikDenetle({ buffer: Buffer.from(CAMT), originalname: "camt053.xml" }, "ekstre").tur).toBe("xml");
  });
});
