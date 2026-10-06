import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    include: {
      variants: true,
    },
  });

  console.log(`Products found: ${products.length}`);

  for (const product of products) {
    const colorMap = new Map<string, number>();

    for (const variant of product.variants) {
      if (!variant.color) continue;

      const colorKey = variant.color.toLowerCase();

     let groupId = colorMap.get(colorKey);

if (!groupId) {
  const group = await prisma.productColorGroup.create({
    data: {
      productId: product.id,
      color: variant.color,
      colorHex: variant.colorHex || null,
    },
  });

  groupId = group.id;
  colorMap.set(colorKey, groupId);
}

// ✅ ensure it's always number
if (!groupId) continue;

await prisma.productVariant.update({
  where: { id: variant.id },
  data: {
    colorGroupId: groupId,
  },
});

      if (!groupId) {
        const group = await prisma.productColorGroup.create({
          data: {
            productId: product.id,
            color: variant.color,
            colorHex: variant.colorHex || null,
          },
        });

        groupId = group.id;
        colorMap.set(colorKey, groupId);
      }

      await prisma.productVariant.update({
        where: { id: variant.id },
        data: {
          colorGroupId: groupId,
        },
      });
    }
  }

  console.log("✅ DONE: Color groups created & linked");
}

main()
  .catch((e) => {
    console.error("❌ ERROR:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });