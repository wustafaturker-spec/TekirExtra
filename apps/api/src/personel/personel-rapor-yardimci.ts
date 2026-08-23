import { Prisma } from "@prisma/client";

export function hesapOzetiTutari(ozet:Prisma.JsonValue|null,alan:string,varsayilan:Prisma.Decimal.Value=0){
  if(!ozet||typeof ozet!=="object"||Array.isArray(ozet))return new Prisma.Decimal(varsayilan);
  const deger=(ozet as Record<string,Prisma.JsonValue>)[alan];
  if(typeof deger!=="string"&&typeof deger!=="number")return new Prisma.Decimal(varsayilan);
  try{return new Prisma.Decimal(deger);}catch{return new Prisma.Decimal(varsayilan);}
}
