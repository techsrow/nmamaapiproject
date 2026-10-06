import { z } from "zod";

export const CreateSliderItemSchema = z.object({
  device: z.enum(["DESKTOP", "MOBILE"]),
  imageUrl: z.string().min(1, "imageUrl is required"),

  heading: z.string().min(1).nullable().optional(),
  subHeading: z.string().min(1).nullable().optional(),

  ctaText: z.string().min(1).nullable().optional(),
  ctaHref: z.string().min(1).nullable().optional(),

  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const UpdateSliderItemSchema = CreateSliderItemSchema.partial().extend({
  device: z.enum(["DESKTOP", "MOBILE"]).optional(),
  imageUrl: z.string().min(1).optional(),
});

export const ReorderItemsSchema = z.object({
  device: z.enum(["DESKTOP", "MOBILE"]),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number().int(),
      })
    )
    .min(1),
});
