import { ShippingProvider } from "@prisma/client";
export type PackageInput={weightKg:number;lengthCm:number;widthCm:number;heightCm:number};
export type RateInput={pickupPincode:string;deliveryPincode:string;cod:boolean;declaredValue:number;country?:string;region?:string;package:PackageInput};
export type ShippingRate={provider:ShippingProvider;courierName:string;courierCode?:string;rate:number;estimatedDays?:number;codAvailable:boolean;meta?:any};
export interface ShippingAdapter{testConnection():Promise<{ok:boolean;message:string}>;getRates(input:RateInput):Promise<ShippingRate[]>;track(awb:string):Promise<any>;cancel?(input:any):Promise<any>}
