export function getMainImage(product: any) {
  return (
    product.images?.find((img: any) => img.isMain) ||
    product.images?.[0] ||
    (product.imageUrl ? { url: product.imageUrl } : null)
  );
}

export function getEffectivePrice(v: any) {
  const dp = v.discountPrice ? Number(v.discountPrice) : null;
  const p = Number(v.price);

  return dp !== null ? dp : p;
}

/**
 * Group variants by color
 */
export function groupVariantsByColor(variants: any[] = []) {
  const map = new Map();

  for (const v of variants) {
    const key = v.color || "default";

    if (!map.has(key)) {
      map.set(key, {
        color: v.color,
        colorHex: v.colorHex,
        colorImageUrl: v.colorImageUrl,

        images: [],
        sizes: [],
      });
    }

    const group = map.get(key);

    // =============================
    // SAFE SIZE IMAGES
    // =============================
    const SIZE_IMAGE_LIMIT = 3;

    const safeImages = (v.images || [])
      .filter((img: any) => img?.url)
      .slice(0, SIZE_IMAGE_LIMIT)
      .map((img: any) => ({
        id: img.id,
        url: img.url,
        altText: img.altText || null,
      }));

    // =============================
    // SIZE OBJECT
    // =============================
    group.sizes.push({
      id: v.id,

      size: v.size,
      weight: v.weight,

      price: Number(v.price),

      discountPrice: v.discountPrice
        ? Number(v.discountPrice)
        : null,

      effectivePrice: getEffectivePrice(v),

      stockQuantity: v.stockQuantity,
      sku: v.sku,

      images: safeImages,
    });

    // =============================
    // DEDUPE COLOR IMAGES
    // =============================
    for (const img of safeImages) {
      const exists = group.images.find(
        (x: any) =>
          (x.id || x.url) === (img.id || img.url)
      );

      if (!exists) {
        group.images.push(img);
      }
    }
  }

  // =============================
  // FINAL IMAGE LIMIT
  // =============================
  const IMAGE_LIMIT = 4;

  return Array.from(map.values()).map((group: any) => {
    const uniqueImagesMap = new Map();

    for (const img of group.images) {
      const key = img.id
        ? `id_${img.id}`
        : `url_${img.url}`;

      if (!uniqueImagesMap.has(key)) {
        uniqueImagesMap.set(key, img);
      }
    }

    return {
      ...group,

      images: Array.from(uniqueImagesMap.values()).slice(
        0,
        IMAGE_LIMIT
      ),
    };
  });
}

export function mapProductListItem(
  p: any,
  colors: any[]
) {
  const firstVariant = p.variants?.[0];

  const mainImage = getMainImage(p);

  return {
    id: p.id,

    name: p.name,
    slug: p.slug,
    description: p.description,

    productType: p.productType,
    isActive: p.isActive,

    category: p.category,
    subCategory: p.subCategory,

    imageUrl: p.imageUrl,
    mainImageUrl: mainImage?.url ?? null,

    images: p.images,

    price: firstVariant
      ? getEffectivePrice(firstVariant)
      : 0,

    discountPrice: firstVariant?.discountPrice
      ? Number(firstVariant.discountPrice)
      : null,

    colors,
  };
}

export function mapProductDetail(
  p: any,
  colors: any[]
) {
  const mainImage = getMainImage(p);

  const firstVariant = p.variants?.[0];

  return {
    id: p.id,
    slug: p.slug,

    name: p.name,
    description: p.description,

    shortDescriptionHtml: p.shortDescriptionHtml,

    apContentHtml: p.apContentHtml,
    apContentImageUrl: p.apContentImageUrl,
    apContentVideoUrl: p.apContentVideoUrl,

    productType: p.productType,
    isActive: p.isActive,

    category: p.category,
    subCategory: p.subCategory,

    imageUrl: p.imageUrl,
    mainImageUrl: mainImage?.url ?? null,

    images: p.images,

    price: firstVariant
      ? getEffectivePrice(firstVariant)
      : 0,

    discountPrice: firstVariant?.discountPrice
      ? Number(firstVariant.discountPrice)
      : null,

    tags:
      p.productTags?.map((pt: any) => pt.tag) || [],

    colors,
  };
}