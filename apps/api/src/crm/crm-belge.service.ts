import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../core/prisma.service";
import { aktifBaglam } from "../core/istek-baglami";
import { CRM_BELGE_MODULU, crmBelgeAyariSemasi, crmBelgeBaglaSemasi, crmBelgeCozSemasi, crmBelgeAdaySemasi, crmTeklifOlusturSemasi } from "./crm-belge.semalar";
import { BelgelerService } from "../belgeler/belgeler.service";
import { ticariSonucuOku } from "./crm-ticari-sonuc";
import { kapamaPayiKaynak, kapamaPayiGorunumu } from "./crm-kapama-paylari";
import { crmKapamaPayiSemasi } from "./crm-belge.semalar";
type Tx = Prisma.TransactionClient;
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const r = schema.safeParse(value); if (!r.success) throw new BadRequestException(r.error.issues.map(i => i.message).join("; ")); return r.data; }
const uuid = (s: string) => parse(z.uuid().transform(s => s.toLowerCase()), s);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const teklifSecimi = { id: true, no: true, durum: true, tarih: true, gecerlilikTarihi: true, dovizCinsi: true, genelToplam: true, updatedAt: true, revizyonNo: true, revizyonKokId: true } satisfies Prisma.BelgeSelect;
const teklifGorunumu = (b: Prisma.BelgeGetPayload<{ select: typeof teklifSecimi }>) => ({ ...b, genelToplam: b.genelToplam.toFixed(2) });
// Yalnız ilişki görünümü: belge/fatura toplamları fırsata gelir olarak dağıtılmaz.
const zincirSecimi = { id: true, no: true, tur: true, durum: true, tarih: true, kaynakBelgeId: true, faturaId: true } satisfies Prisma.BelgeSelect;
@Injectable()
export class CrmBelgeService {
 constructor(private readonly prisma: PrismaService, private readonly belgeler: BelgelerService) {}
 private yaz<T>(tenantId: string, is: (tx: Tx) => Promise<T>, serial=false) {
  return this.prisma.tenantIslem(tenantId,is,serial?{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}:undefined).catch((error: unknown) => {
   if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new ConflictException("Belge bağı veya istek anahtarı değişti; listeyi yenileyin");
   throw error;
  });
 }
 private async erisim(tx: Tx, yaz = false) {
  const { tenantId, userId, rol } = aktifBaglam();
  if (!["yonetici", "satis", "muhasebe"].includes(rol) || yaz && !["yonetici", "satis"].includes(rol)) throw new ForbiddenException("Fırsat belge işlemi için yetkiniz yok");
  const rows = await tx.$queryRaw<{ ayarlar: unknown }[]>`SELECT ayarlar FROM modul_ayarlari WHERE tenant_id=${tenantId}::uuid AND modul=${CRM_BELGE_MODULU} FOR SHARE`;
  const r = crmBelgeAyariSemasi.safeParse(rows[0]?.ayarlar ?? {});
  if (!r.success || r.data.mod === "kapali" || yaz && r.data.mod === "salt_okunur") throw new ForbiddenException("Fırsat belge bağları bu şirket için yazmaya veya kullanıma açık değil");
  if (yaz && !await tx.user.findFirst({ where: { id: userId, tenantId, aktif: true, rol: { in: ["yonetici", "satis"] } }, select: { id: true } })) throw new ForbiddenException("Aktif yönetici veya satış hesabı gerekli");
  return r.data.mod;
 }
 private async firsat(tx: Tx, id: string, kilit = false) {
  const { tenantId } = aktifBaglam();
  if (kilit) await tx.$queryRaw`SELECT id FROM crm_firsatlari WHERE id=${id}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
  const f = await tx.crmFirsat.findFirst({ where: { id, tenantId }, select: { id: true, cariId: true, baslik: true, updatedAt: true } });
  if (!f) throw new NotFoundException("Fırsat bulunamadı"); return f;
 }
 async kapamaPaylari(id:string,invoiceId:string){
  const firsatId=uuid(id),faturaId=uuid(invoiceId),{tenantId}=aktifBaglam();
  return this.prisma.tenantIslem(tenantId,async tx=>{
   const mod=await this.erisim(tx),f=await this.firsat(tx,firsatId);
   const c=await kapamaPayiKaynak(tx,tenantId,f.cariId,firsatId,faturaId);
   if(!c.pay.gt(0) && !c.history.some(r=>r.firsatId===firsatId))throw new NotFoundException('Bu fırsata ait doğrulanmış fatura payı yok');
   return {...kapamaPayiGorunumu(c,firsatId),mod};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 async kapamaPayiYaz(id:string,invoiceId:string,body:unknown){
  const firsatId=uuid(id),faturaId=uuid(invoiceId),raw=parse(crmKapamaPayiSemasi,body),g={...raw,tutar:new Prisma.Decimal(raw.tutar).toFixed(2)}, {tenantId,userId,rol}=aktifBaglam();
  const ozet=hash({firsatId,faturaId,...g});
  return this.yaz(tenantId,async tx=>{
   const mod=await this.erisim(tx);
   if(!['pilot','acik'].includes(mod) || !['yonetici','muhasebe'].includes(rol) || !await tx.user.findFirst({where:{id:userId,tenantId,aktif:true,rol:{in:['yonetici','muhasebe']}},select:{id:true}}))throw new ForbiddenException('Kapama payını aktif yönetici veya muhasebe düzenleyebilir');
   const f=await this.firsat(tx,firsatId);
   const replay=await tx.firsatKapamaPayi.findUnique({where:{tenantId_istekAnahtari:{tenantId,istekAnahtari:g.istekAnahtari}}});
   if(replay){if(replay.girdiOzeti!==ozet)throw new ConflictException('İstek anahtarı farklı dağıtım için kullanılmış');return {id:replay.id,surum:replay.surum};}
   await tx.$queryRaw`SELECT id FROM cari_hesaplar WHERE id=${f.cariId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM faturalar WHERE id=${faturaId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
   const c=await kapamaPayiKaynak(tx,tenantId,f.cariId,firsatId,faturaId),view=kapamaPayiGorunumu(c,firsatId),k=view.kapamalar.find(k=>k.id===g.kapamaId);
   if(!k)throw new NotFoundException('Kapama bu faturada bulunamadı');
   if(!c.pay.gt(0) && !c.history.some(r=>r.firsatId===firsatId))throw new NotFoundException('Bu fırsata ait doğrulanmış fatura payı yok');
   if(g.kanitOzeti!==c.kanitOzeti || g.kaynakOzeti!==k.kaynakOzeti || g.beklenenSurum!==k.surum)throw new ConflictException('Fatura, kaynak veya dağıtım değişti; dağıtımı yenileyin');
   if(!k.gecerli || new Prisma.Decimal(g.tutar).gt(k.azamiTutar))throw new ConflictException('Pay, kapamanın boşta kalan tutarını veya fırsatın fatura payını aşıyor');
   if(c.history.length>=5000 || k.surum>=200)throw new ConflictException('Dağıtım geçmişi sınırına ulaşıldı');
   const row=await tx.firsatKapamaPayi.create({data:{tenantId,cariId:f.cariId,firsatId,faturaId,kapamaId:k.id,surum:k.surum+1,tutar:g.tutar,kaynakOzeti:k.kaynakOzeti,kanitOzeti:c.kanitOzeti,istekAnahtari:g.istekAnahtari,girdiOzeti:ozet,gerekce:g.gerekce,olusturanUserId:userId}});
   await tx.auditLog.create({data:{tenantId,userId,islem:'firsat_kapama_payi_belirtildi',varlik:'firsat_kapama_payi',varlikId:row.id,detay:{firsatId,faturaId,kapamaId:k.id,tutar:g.tutar,surum:row.surum,gerekce:g.gerekce}}});
   return {id:row.id,surum:row.surum};
  },true);
 }
 async listele(id: string) {
  const firsatId = uuid(id), { tenantId } = aktifBaglam();
  return this.prisma.tenantIslem(tenantId, async tx => {
   const mod = await this.erisim(tx), firsat = await this.firsat(tx, firsatId);
   const rows = await tx.firsatBelgeBagi.findMany({ where: { tenantId, firsatId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 201 });
   if (rows.length > 200) throw new ConflictException("Fırsatın belge geçmişi 200 kayıt sınırını aşıyor; eksik liste gösterilmedi");
   const docs = await tx.belge.findMany({ where: { id: { in: rows.map(r => r.belgeId) }, tenantId, cariId: firsat.cariId }, select: teklifSecimi });
   const byId = new Map(docs.map(b => [b.id, teklifGorunumu(b)]));
   const zincir = await this.zinciriOku(tx, tenantId, firsat.cariId, rows.filter(r => !r.cozulduAt && byId.has(r.belgeId)).map(r => r.belgeId));
   const ticariSonuc = await ticariSonucuOku(tx, tenantId, firsat.cariId, rows.filter(r=>!r.cozulduAt).map(r=>r.belgeId), zincir.belgeler.map(b=>b.id), zincir.faturalar.map(f=>f.id));
   const payHistory=await tx.firsatKapamaPayi.findMany({where:{tenantId,cariId:firsat.cariId,firsatId},select:{faturaId:true},take:5001});
   if(payHistory.length>5000)throw new ConflictException('Kapama payı geçmişi sınırı aşıldı');
   const payFaturaGecmisi=await tx.fatura.findMany({where:{tenantId,cariId:firsat.cariId,id:{in:[...new Set(payHistory.map(r=>r.faturaId))]}},select:{id:true,no:true},orderBy:{id:'asc'}});
   return { mod, firsat, zincir, ticariSonuc, payFaturaGecmisi, baglar: rows.map(r => ({ id: r.id, belgeId: r.belgeId, gerekce: r.gerekce, createdAt: r.createdAt, surum: r.surum, cozulduAt: r.cozulduAt, cozmeGerekcesi: r.cozmeGerekcesi, belge: byId.get(r.belgeId) ?? null })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
 }
 private async zinciriOku(tx: Tx, tenantId: string, cariId: string, teklifIds: string[]) {
  type Belge = Prisma.BelgeGetPayload<{ select: typeof zincirSecimi }>;
  const belgeler: Belge[] = [];
  // Desteklenen dönüşüm zinciri teklif -> sipariş -> irsaliye. Revizyonlar
  // kendiliğinden fırsata aktarılmaz; yeni teklif açıkça bağlanmalıdır.
  let kaynakIds = teklifIds;
  for (const tur of ["siparis", "irsaliye"] as const) {
   if (!kaynakIds.length) break;
   const bulunan = await tx.belge.findMany({ where: { tenantId, cariId, yon: "satis", tur, kaynakBelgeId: { in: kaynakIds } }, select: zincirSecimi, orderBy: [{ tarih: "asc" }, { id: "asc" }], take: 1001 });
   if (belgeler.length + bulunan.length > 1000) throw new ConflictException("Belge zinciri 1000 kayıt sınırını aşıyor; eksik zincir gösterilmedi");
   belgeler.push(...bulunan);
   // İptal edilmiş bir kaynaktan türemiş belgeler tarihsel ilişkidir;
   // sonuç tutarı hesaplanmadığı için durumlarıyla birlikte korunur.
   kaynakIds = bulunan.map(b => b.id);
  }
  const faturaIds = [...new Set(belgeler.flatMap(b => b.faturaId ? [b.faturaId] : []))];
  const faturalar = faturaIds.length ? await tx.fatura.findMany({ where: { tenantId, cariId, tip: "satis", id: { in: faturaIds } }, select: { id: true, no: true, durum: true, tarih: true }, orderBy: [{ tarih: "asc" }, { id: "asc" }] }) : [];
  const kaynaklar = faturalar.length ? await tx.belge.findMany({ where: { tenantId, cariId, yon: "satis", faturaId: { in: faturalar.map(f => f.id) } }, select: { id: true, faturaId: true }, take: 1001 }) : [];
  if (kaynaklar.length > 1000) throw new ConflictException("Fatura kaynakları 1000 kayıt sınırını aşıyor; eksik zincir gösterilmedi");
  const zincirIds = new Set(belgeler.map(b => b.id));
  return { belgeler, faturalar: faturalar.map(f => ({ ...f, kaynakBelgeIds: belgeler.filter(b => b.faturaId === f.id).map(b => b.id), ortakKaynak: kaynaklar.some(b => b.faturaId === f.id && !zincirIds.has(b.id)) })) };
 }
 async adaylar(id: string, query: unknown) {
  const firsatId = uuid(id), g = parse(crmBelgeAdaySemasi, query), { tenantId } = aktifBaglam();
  return this.prisma.tenantIslem(tenantId, async tx => {
   await this.erisim(tx); const firsat = await this.firsat(tx, firsatId);
   const filtre: Prisma.BelgeWhereInput = { tenantId, cariId: firsat.cariId, tur: "teklif", yon: "satis", durum: { notIn: ["iptal", "revize_edildi"] }, ...(g.arama ? { no: { contains: g.arama, mode: "insensitive" } } : {}) };
   if (g.imlec && !await tx.belge.findFirst({ where: { ...filtre, id: g.imlec }, select: { id: true } })) throw new ConflictException("Aday listesi değişti; aramayı yenileyin");
   const all = await tx.belge.findMany({ where: filtre, select: teklifSecimi, orderBy: { id: "asc" }, take: 51, ...(g.imlec ? { cursor: { id: g.imlec }, skip: 1 } : {}) });
   const docs = all.slice(0,50), links = await tx.firsatBelgeBagi.findMany({ where: { tenantId, belgeId: { in: docs.map(b => b.id) }, cozulduAt: null }, select: { belgeId: true } });
   const linked = new Set(links.map(b => b.belgeId));
   return { firsat, kayitlar: docs.map(b => ({ ...teklifGorunumu(b), bagli: linked.has(b.id) })), sonrakiImlec: all.length > 50 ? docs.at(-1)!.id : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
 }
 async teklifOlustur(id: string, body: unknown) {
  const firsatId = uuid(id), g = parse(crmTeklifOlusturSemasi, body), { tenantId, userId } = aktifBaglam();
  const ozet = hash({ islem: "teklif_olustur", firsatId, ...g });
  const tekrar = async (tx: Tx) => {
   const link = await tx.firsatBelgeBagi.findUnique({ where: { tenantId_istekAnahtari: { tenantId, istekAnahtari: g.istekAnahtari } } });
   if (!link) return null;
   if (link.girdiOzeti !== ozet) throw new ConflictException("İstek anahtarı başka bir işlem veya içerik için kullanılmış");
   return { id: link.belgeId, bagId: link.id, surum: link.surum, cozulduAt: link.cozulduAt };
  };
  // Tekrar, değişmiş kaynak/dönem/vergi kurallarından bağımsız olarak mevcut
  // sonucu verir. İlk okuma yetki ve kapsamı doğrulamadan ön kontrol çalışmaz.
  const onceki = await this.prisma.tenantIslem(tenantId, async tx => {
   await this.erisim(tx, true); await this.firsat(tx, firsatId);
   return tekrar(tx);
  });
  if (onceki) return onceki;
  await this.belgeler.olusturmaOnKontrolu(g.belge);
  return this.yaz(tenantId, async tx => {
   await this.erisim(tx, true); const f = await this.firsat(tx, firsatId, true);
   const replay = await tekrar(tx); if (replay) return replay;
   if (f.updatedAt.toISOString() !== g.beklenenFirsatZamani) throw new ConflictException("Fırsat değişti; fırsatı yenileyip yeniden deneyin");
   if (g.belge.cariId !== f.cariId) throw new ConflictException("Teklifin müşterisi fırsatın carisiyle aynı olmalı");
   if (await tx.firsatBelgeBagi.count({ where: { tenantId, firsatId } }) >= 200) throw new ConflictException("Fırsat başına belge geçmişi sınırına ulaşıldı");
   const belge = await this.belgeler.olusturIslemde(tx, g.belge);
   const link = await tx.firsatBelgeBagi.create({ data: { tenantId, firsatId, cariId: f.cariId, belgeId: belge.id, olusturanUserId: userId, gerekce: g.gerekce, istekAnahtari: g.istekAnahtari, girdiOzeti: ozet } });
   await tx.auditLog.create({ data: { tenantId, userId, islem: "firsattan_teklif_olusturuldu", varlik: "firsat_belge_bagi", varlikId: link.id, detay: { firsatId, belgeId: belge.id, cariId: f.cariId, gerekce: g.gerekce, surum: 1 } } });
   return { id: belge.id, bagId: link.id, surum: link.surum, cozulduAt: link.cozulduAt };
  });
 }
 async bagla(id: string, body: unknown) {
  const firsatId = uuid(id), g = parse(crmBelgeBaglaSemasi, body), { tenantId, userId } = aktifBaglam(), ozet = hash({ firsatId, ...g });
  return this.yaz(tenantId, async tx => {
   await this.erisim(tx, true); const f = await this.firsat(tx, firsatId, true);
   const replay = await tx.firsatBelgeBagi.findUnique({ where: { tenantId_istekAnahtari: { tenantId, istekAnahtari: g.istekAnahtari } } });
   if (replay) { if (replay.girdiOzeti !== ozet) throw new ConflictException("İstek anahtarı başka bir bağ için kullanılmış"); return { id: replay.id, surum: replay.surum, cozulduAt: replay.cozulduAt }; }
   await tx.$queryRaw`SELECT id FROM belgeler WHERE id=${g.belgeId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
   const b = await tx.belge.findFirst({ where: { id: g.belgeId, tenantId, cariId: f.cariId, tur: "teklif", yon: "satis" }, select: { ...teklifSecimi } });
   if (!b) throw new NotFoundException("Bu cariye ait satış teklifi bulunamadı");
   if (f.updatedAt.toISOString() !== g.beklenenFirsatZamani || b.updatedAt.toISOString() !== g.beklenenBelgeZamani) throw new ConflictException("Fırsat veya teklif değişti; listeyi yenileyin");
   if (["iptal", "revize_edildi"].includes(b.durum)) throw new ConflictException("İptal veya eski sürüm teklif bağlanamaz");
   if (await tx.firsatBelgeBagi.findFirst({ where: { tenantId, belgeId: b.id, cozulduAt: null }, select: { id: true } })) throw new ConflictException("Teklifin zaten aktif fırsat bağı var");
   if (await tx.firsatBelgeBagi.count({ where: { tenantId, firsatId } }) >= 200) throw new ConflictException("Fırsat başına belge geçmişi sınırına ulaşıldı");
   const link = await tx.firsatBelgeBagi.create({ data: { tenantId, firsatId, cariId: f.cariId, belgeId: b.id, olusturanUserId: userId, gerekce: g.gerekce, istekAnahtari: g.istekAnahtari, girdiOzeti: ozet } });
   await tx.auditLog.create({ data: { tenantId, userId, islem: "firsat_teklif_baglandi", varlik: "firsat_belge_bagi", varlikId: link.id, detay: { firsatId, belgeId: b.id, cariId: f.cariId, gerekce: g.gerekce, surum: 1 } } });
   return { id: link.id, surum: link.surum, cozulduAt: link.cozulduAt };
  });
 }
 async coz(id: string, bagId: string, body: unknown) {
  const firsatId = uuid(id), linkId = uuid(bagId), g = parse(crmBelgeCozSemasi, body), { tenantId, userId } = aktifBaglam(), ozet = hash({ firsatId, linkId, ...g });
  return this.yaz(tenantId, async tx => {
   await this.erisim(tx,true); await this.firsat(tx,firsatId,true);
   const link = await tx.firsatBelgeBagi.findFirst({ where: { id: linkId, tenantId, firsatId } }); if (!link) throw new NotFoundException("Belge bağı bulunamadı");
   if (link.cozmeIstekAnahtari === g.istekAnahtari) { if (link.cozmeGirdiOzeti !== ozet) throw new ConflictException("İstek anahtarı farklı çözme gerekçesiyle kullanılmış"); return { id: link.id, surum: link.surum, cozulduAt: link.cozulduAt }; }
   if (link.cozulduAt || link.surum !== g.beklenenSurum) throw new ConflictException("Belge bağı değişti; listeyi yenileyin");
   await tx.$queryRaw`SELECT id FROM belgeler WHERE id=${link.belgeId}::uuid AND tenant_id=${tenantId}::uuid FOR UPDATE`;
   if (await tx.firsatBelgeBagi.findUnique({ where: { tenantId_cozmeIstekAnahtari: { tenantId, cozmeIstekAnahtari: g.istekAnahtari } } })) throw new ConflictException("Çözme anahtarı başka bir bağda kullanılmış");
   const closed = await tx.firsatBelgeBagi.update({ where: { id: linkId }, data: { cozulduAt: new Date(), cozenUserId: userId, cozmeGerekcesi: g.gerekce, cozmeIstekAnahtari: g.istekAnahtari, cozmeGirdiOzeti: ozet, surum: 2 } });
   await tx.auditLog.create({ data: { tenantId,userId,islem:"firsat_teklif_bagi_cozuldu",varlik:"firsat_belge_bagi",varlikId:linkId,detay:{firsatId,belgeId:link.belgeId,gerekce:g.gerekce,surum:2} } });
   return { id: closed.id, surum: closed.surum, cozulduAt: closed.cozulduAt };
  });
 }
}
