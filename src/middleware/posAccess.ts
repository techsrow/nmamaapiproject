import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../lib/prisma';
export function posAccess(permission: string) {
 return async(req:AuthRequest,res:Response,next:NextFunction)=>{
  try {
   const user=await prisma.user.findUnique({where:{id:req.user!.userId},include:{staffProfile:{include:{role:true}}}});
   if(!user?.isActive)return res.status(403).json({success:false,message:'Active staff access required.'});
   req.user!.role=user.role;
   if(user.role==='Admin')return next();
   const staff=user.staffProfile;const permissions=staff?.role.permissions;
   if(staff?.isActive && Array.isArray(permissions) && (permissions.includes(permission)||permissions.includes('pos.*')))return next();
   return res.status(403).json({success:false,message:'POS permission required.'});
  }catch{return res.status(503).json({success:false,message:'Unable to check staff access.'});}
 };
}
