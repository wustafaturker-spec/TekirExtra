import { expect, it } from "vitest";
import { takipDetayiniDogrula, takipListesiniDogrula, sorumlulariDogrula } from "./tahsilat-takibi";
import { rolMenuYoluGorebilir } from "./rol-yetkileri";
const id="11111111-1111-4111-8111-111111111111", cariId="22222222-2222-4222-8222-222222222222", userId="33333333-3333-4333-8333-333333333333";
const kayit=()=>({id,cari:{id:cariId,unvan:"Test"},sorumlu:{id:userId,adSoyad:"Muhasebe",aktif:true},konu:"Tahsilat",neden:"tahsilat",durum:"acik",sonrakiIslemTarihi:"2026-10-15" as string|null,sonrakiIslem:"Telefon et" as string|null,sonIslemGerekcesi:null,surum:1,createdAt:"2026-10-14T10:00:00Z",updatedAt:"2026-10-14T10:00:00Z"});
const liste=()=>({kullanimModu:"pilot",bugun:"2026-10-15",alindigiZaman:"2026-10-15T09:00:00Z",cariId:null,gorunum:"bugun",sorumluUserId:null,toplam:1,sonrakiImlec:null,kayitlar:[kayit()]});
it("günlük liste sözleşmesi kabul edilir",()=>expect(takipListesiniDogrula(liste(),{gorunum:"bugun"}).kayitlar).toHaveLength(1));
it.each([{durum:"bilinmiyor"},{surum:0},{sonrakiIslemTarihi:null},{sonrakiIslemTarihi:"2026-02-30"},{sonrakiIslemTarihi:"2026-10-16"}])("geçersiz günlük satır reddedilir %j",(fark)=>{const r=liste();Object.assign(r.kayitlar[0],fark);expect(()=>takipListesiniDogrula(r,{gorunum:"bugun"})).toThrow();});
it("farklı cari/sorumlu/görünüm yanıtı gösterilmez",()=>{
 expect(()=>takipListesiniDogrula(liste(),{gorunum:"tum"})).toThrow();
 expect(()=>takipListesiniDogrula(liste(),{gorunum:"bugun",cariId})).toThrow();
 expect(()=>takipListesiniDogrula(liste(),{gorunum:"bugun",sorumluUserId:userId})).toThrow();
});
it("kapalı takipte sonraki işlem kalamaz",()=>{const r=liste();r.gorunum="tum";r.kayitlar[0].durum="tamamlandi";expect(()=>takipListesiniDogrula(r,{gorunum:"tum"})).toThrow();r.kayitlar[0].sonrakiIslem=null;r.kayitlar[0].sonrakiIslemTarihi=null;expect(takipListesiniDogrula(r,{gorunum:"tum"}).toplam).toBe(1);});
it("detay kapsamı ve görüşme sayacı doğrulanır",()=>{
 const r={kullanimModu:"pilot",kayit:kayit(),gorusmeler:[],olaylar:[],gorusmeSayisi:0,olaySayisi:0};
 expect(takipDetayiniDogrula(r,id,cariId).kayit.id).toBe(id);
 expect(()=>takipDetayiniDogrula(r,userId)).toThrow();
 expect(()=>takipDetayiniDogrula({...r,gorusmeSayisi:-1},id)).toThrow();
});
it("varsayılan sorumlu listede bulunmalıdır",()=>{expect(()=>sorumlulariDogrula({kayitlar:[],varsayilanUserId:userId})).toThrow();expect(sorumlulariDogrula({kayitlar:[{id:userId,adSoyad:"Muhasebe"}],varsayilanUserId:userId}).kayitlar).toHaveLength(1);});
it.each(["yonetici","muhasebe","mali_musavir","salt_okunur"])("%s iş listesine erişir",rol=>expect(rolMenuYoluGorebilir(rol,"/panel/cari/tahsilat")).toBe(true));
it.each(["satis","depo","calisan"])("%s iş listesine erişemez",rol=>expect(rolMenuYoluGorebilir(rol,"/panel/cari/tahsilat")).toBe(false));
