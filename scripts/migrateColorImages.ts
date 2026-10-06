import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const variants = await prisma.productVariant.findMany({
    where: {
      colorGroupId: { not: null },
    },
    include: {
      images: true,
    },
  });

  console.log(`Variants found: ${variants.length}`);

  for (const variant of variants) {
    if (!variant.colorGroupId) continue;

    for (const img of variant.images) {
      await prisma.productColorImage.upsert({
        where: {
          colorGroupId_url: {
            colorGroupId: variant.colorGroupId,
            url: img.url,
          },
        },
        update: {},
        create: {
          colorGroupId: variant.colorGroupId,
          url: img.url,
          altText: img.altText,
          sortOrder: img.sortOrder,
        },
      });
    }
  }

  console.log("✅ DONE: Images moved to color groups");
}

main()
  .catch((e) => {
    console.error("❌ ERROR:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });