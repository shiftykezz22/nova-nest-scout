// Deterministic hierarchical category synthesis for cases where SerpAPI
// returns no `categories` array or a single-node breadcrumb. Rules are
// keyword-based and never guess beyond the table — callers should treat a
// null return as "leave category empty".

export type CategoryRule = {
  keywords: string[]; // matched (case-insensitive) against title + product_type + manufacturer
  path: string[];
};

const RULES: CategoryRule[] = [
  // Beauty & personal care
  { keywords: ["bar soap", "beauty bar", "body bar"], path: ["Beauty", "Bath & Body", "Bar Soap"] },
  { keywords: ["body wash", "shower gel"], path: ["Beauty", "Bath & Body", "Body Wash"] },
  { keywords: ["shampoo"], path: ["Beauty", "Hair Care", "Shampoo"] },
  { keywords: ["conditioner"], path: ["Beauty", "Hair Care", "Conditioner"] },
  { keywords: ["deodorant", "antiperspirant"], path: ["Beauty", "Personal Care", "Deodorant"] },
  { keywords: ["lotion", "moisturizer"], path: ["Beauty", "Skin Care", "Body Lotion"] },
  { keywords: ["face cream", "facial moisturizer"], path: ["Beauty", "Skin Care", "Face"] },
  { keywords: ["lipstick", "lip gloss"], path: ["Beauty", "Makeup", "Lips"] },
  { keywords: ["mascara"], path: ["Beauty", "Makeup", "Eyes"] },
  { keywords: ["foundation", "concealer"], path: ["Beauty", "Makeup", "Face"] },
  { keywords: ["perfume", "cologne", "fragrance"], path: ["Beauty", "Fragrance"] },

  // Oral / health
  { keywords: ["toothpaste"], path: ["Health", "Oral Care", "Toothpaste"] },
  { keywords: ["toothbrush"], path: ["Health", "Oral Care", "Toothbrushes"] },
  { keywords: ["mouthwash"], path: ["Health", "Oral Care", "Mouthwash"] },
  { keywords: ["vitamin", "supplement", "multivitamin"], path: ["Health", "Vitamins & Supplements"] },
  { keywords: ["pain reliever", "ibuprofen", "acetaminophen"], path: ["Health", "Medicine Cabinet"] },

  // Kitchen / small appliances
  { keywords: ["air fryer"], path: ["Home", "Kitchen", "Small Appliances", "Air Fryers"] },
  { keywords: ["blender"], path: ["Home", "Kitchen", "Small Appliances", "Blenders"] },
  { keywords: ["coffee maker", "espresso machine"], path: ["Home", "Kitchen", "Small Appliances", "Coffee Makers"] },
  { keywords: ["toaster"], path: ["Home", "Kitchen", "Small Appliances", "Toasters"] },
  { keywords: ["microwave"], path: ["Home", "Kitchen", "Small Appliances", "Microwaves"] },
  { keywords: ["food storage", "container"], path: ["Home", "Kitchen", "Storage & Organization"] },
  { keywords: ["cookware", "frying pan", "saucepan", "skillet"], path: ["Home", "Kitchen", "Cookware"] },

  // Electronics
  { keywords: ["gaming mouse", "wireless mouse", "computer mouse"], path: ["Electronics", "Computers", "Accessories", "Mice"] },
  { keywords: ["keyboard"], path: ["Electronics", "Computers", "Accessories", "Keyboards"] },
  { keywords: ["headphones", "earbuds", "airpods"], path: ["Electronics", "Audio", "Headphones"] },
  { keywords: ["speaker", "soundbar"], path: ["Electronics", "Audio", "Speakers"] },
  { keywords: ["television", "\\btv\\b", "smart tv"], path: ["Electronics", "TV & Video", "Televisions"] },
  { keywords: ["laptop", "notebook computer"], path: ["Electronics", "Computers", "Laptops"] },
  { keywords: ["tablet", "ipad"], path: ["Electronics", "Computers", "Tablets"] },
  { keywords: ["cell phone case", "phone case"], path: ["Electronics", "Cell Phones", "Accessories"] },

  // Toys
  { keywords: ["action figure", "lego", "toy"], path: ["Toys", "Playsets & Figures"] },
  { keywords: ["board game"], path: ["Toys", "Games", "Board Games"] },

  // Apparel / footwear
  { keywords: ["men's shoe", "running shoe", "sneaker"], path: ["Clothing", "Shoes"] },
  { keywords: ["t-shirt", "tee shirt"], path: ["Clothing", "Tops"] },

  // Grocery / beverage
  { keywords: ["bottled water", "drinking water"], path: ["Food", "Beverages", "Water"] },
  { keywords: ["coffee beans", "ground coffee"], path: ["Food", "Beverages", "Coffee"] },
  { keywords: ["cereal"], path: ["Food", "Breakfast", "Cereal"] },

  // Home / cleaning
  { keywords: ["laundry detergent"], path: ["Household", "Cleaning", "Laundry"] },
  { keywords: ["paper towel"], path: ["Household", "Paper & Plastic"] },
  { keywords: ["trash bag", "garbage bag"], path: ["Household", "Cleaning", "Trash Bags"] },

  // Baby
  { keywords: ["diaper", "diapers"], path: ["Baby", "Diapering"] },
  { keywords: ["baby formula", "infant formula"], path: ["Baby", "Feeding", "Formula"] },
];

export function synthesizeCategoryPath(input: {
  title?: string;
  product_type?: string;
  manufacturer?: string;
  brand?: string;
}): string[] | undefined {
  const hay = [input.title, input.product_type, input.manufacturer, input.brand]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return undefined;
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const rx = new RegExp(kw, "i");
      if (rx.test(hay)) return rule.path.slice();
    }
  }
  // Product-type fallback: at minimum wrap product_type as a leaf under a
  // guessed root, but only when product_type is unambiguously category-ish.
  return undefined;
}

export function formatCategoryPath(path: string[] | undefined): string | undefined {
  if (!path || !path.length) return undefined;
  return path.join(" > ");
}