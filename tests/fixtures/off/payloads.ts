/**
 * REAL Open Food Facts payloads, fetched on 16 November 2026 from
 * `https://es.openfoodfacts.org/api/v2/product/{barcode}.json`, trimmed to the fields this app reads plus a few it
 * deliberately ignores. Values are untouched: `sodium_100g` really is in grams, and the `added-sugars_100g: 0` on
 * Coca-Cola and on LU Prince really is what the database says. Those two false zeros are the reason this app never
 * imports added sugars, and the test that feeds this file pins it.
 *
 * Nothing here is generated at test time and nothing in the suite goes near the network.
 */
export const coca_cola = {
  "code": "5449000054227",
  "status": 1,
  "status_verbose": "product found",
  "product": {
    "product_name": "Coca-Cola Original Taste",
    "product_name_es": "",
    "product_name_en": "Coca-Cola Original Taste",
    "generic_name": "Coca Cola",
    "brands": "Coca-Cola",
    "brands_tags": [
      "Coca-Cola"
    ],
    "quantity": "1 L",
    "serving_size": "250 ml",
    "serving_quantity": 250,
    "nutrition_data_per": "100g",
    "nova_group": 4,
    "last_modified_t": 1794469430,
    "allergens_tags": [],
    "traces_tags": [],
    "categories_tags": [
      "en:beverages-and-beverages-preparations",
      "en:beverages",
      "en:non-alcoholic-beverages",
      "en:soft-drinks",
      "en:carbonated-drinks",
      "en:flavoured-soft-drinks",
      "en:sodas",
      "en:colas",
      "en:sweetened-beverages"
    ],
    "ingredients_text": "Water, fructose - glucose syrup, carbon dioxide, colorant: e150d, acid: phosphoric acid, natural flavorings (including caffeine).",
    "data_quality_errors_tags": [],
    "nutriments": {
      "energy-kcal_100g": 42,
      "energy-kj_100g": 180,
      "proteins_100g": 0,
      "fat_100g": 0,
      "saturated-fat_100g": 0,
      "carbohydrates_100g": 10.6,
      "sugars_100g": 10.6,
      "added-sugars_100g": 0,
      "fiber_100g": 0,
      "sodium_100g": 0,
      "salt_100g": 0,
      "sodium_unit": "g",
      "nova-group": 4
    }
  }
};

export const lu_prince = {
  "code": "7622210449283",
  "status": 1,
  "status_verbose": "product found",
  "product": {
    "product_name": "Prince",
    "product_name_es": "Príncipe Galletas de Chocolate",
    "product_name_en": "Prince Goût Chocolat au Blé Complet",
    "generic_name": "BISCUITS FOURRÉS (35%) PARFUM CHOCOLAT",
    "brands": "LU, Prince",
    "brands_tags": [
      "LU",
      "Prince"
    ],
    "quantity": "300 g ℮",
    "serving_size": "20g",
    "serving_quantity": 20,
    "nutrition_data_per": "100g",
    "nova_group": 4,
    "last_modified_t": 1793958244,
    "allergens_tags": [
      "en:eggs",
      "en:gluten",
      "en:milk",
      "en:soybeans"
    ],
    "traces_tags": [
      "en:eggs"
    ],
    "categories_tags": [
      "en:snacks",
      "en:sweet-snacks",
      "en:biscuits-and-cakes",
      "en:biscuits-and-crackers",
      "en:biscuits",
      "en:chocolate-biscuits"
    ],
    "ingredients_text": "Céréale 50 % (Farine de blé 34,8 %, farine de blé complet 15,2 %), sucre, huiles végétales (palme, colza), cacao maigre en poudre 4,5 %, sirop de glucose, amidon de blé, poudres à lever (carbonates d'ammonium, carbonates de sodium), émulsifiant (lécithines de soja), sel, lait écrémé en poudre, perméat de lactosérum (de lait), arômes. Peut contenir œuf.",
    "data_quality_errors_tags": [],
    "nutriments": {
      "energy-kcal_100g": 467,
      "energy-kj_100g": 1962,
      "proteins_100g": 6.3,
      "fat_100g": 17,
      "saturated-fat_100g": 5.6,
      "carbohydrates_100g": 69,
      "sugars_100g": 32,
      "added-sugars_100g": 0,
      "fiber_100g": 4,
      "sodium_100g": 0.196,
      "salt_100g": 0.49,
      "sodium_unit": "g",
      "sodium_modifier": "~",
      "nova-group": 4
    }
  }
};

export const nutella = {
  "code": "3017620422003",
  "status": 1,
  "status_verbose": "product found",
  "product": {
    "product_name": "Nutella",
    "product_name_es": "Nutella",
    "product_name_en": "Nutella",
    "generic_name": "Hazelnut And Cocoa Spread",
    "brands": "Ferrero, Nutella",
    "brands_tags": [
      "ferrero",
      "nutella"
    ],
    "quantity": "400 g e",
    "nutrition_data_per": "100g",
    "nova_group": 3,
    "last_modified_t": 1794233882,
    "allergens_tags": [
      "en:milk",
      "en:nuts",
      "en:soybeans"
    ],
    "traces_tags": [],
    "categories_tags": [
      "en:breakfasts",
      "en:spreads",
      "en:sweet-spreads",
      "fr:pates-a-tartiner",
      "en:hazelnut-spreads",
      "en:confectionary-based-spreads",
      "fr:Nutella"
    ],
    "ingredients_text": "sugar, palm oil",
    "data_quality_errors_tags": [
      "en:nutrition-data-per-serving-missing-serving-size",
      "en:nutrition-packaging-as-sold-100g-sugars-plus-starch-greater-than-carbohydrates",
      "en:nutrition-packaging-as-sold-100g-saturated-fat-greater-than-fat",
      "en:nutrition-packaging-as-sold-100g-salt-does-not-match-sodium",
      "en:nutrition-packaging-as-sold-100g-energy-value-in-kj-does-not-match-value-computed-from-other-nutrients",
      "en:nutrition-packaging-as-sold-100g-energy-value-in-kcal-does-not-match-value-computed-from-other-nutrients"
    ],
    "nutriments": {
      "energy-kcal_100g": 539,
      "energy-kj_100g": 2252,
      "proteins_100g": 6.3,
      "fat_100g": 30.9,
      "saturated-fat_100g": 10.6,
      "carbohydrates_100g": 57.5,
      "sugars_100g": 56.3,
      "added-sugars_100g": 52.13,
      "fiber_100g": 0,
      "sodium_100g": 0.0428,
      "salt_100g": 0.107,
      "sodium_unit": "g",
      "sodium_modifier": "~",
      "nova-group": 4
    }
  }
};

export const coca_cola_zero = {
  "code": "5449000131805",
  "status": 1,
  "status_verbose": "product found",
  "product": {
    "product_name": "Coca-Cola Zero Sugar",
    "product_name_es": "Coca Cola Zero",
    "product_name_en": "Coca-Cola Zero Sugar",
    "generic_name": "Boisson rafraîchissante aux extraits végétaux, avec édulcorants",
    "brands": "Coca-Cola",
    "brands_tags": [
      "Coca Cola"
    ],
    "quantity": "330 ml",
    "serving_size": "1 can (330 ml)",
    "serving_quantity": 330,
    "nutrition_data_per": "100g",
    "nova_group": 4,
    "last_modified_t": 1794469820,
    "allergens_tags": [],
    "traces_tags": [
      "en:nuts"
    ],
    "categories_tags": [
      "en:beverages-and-beverages-preparations",
      "en:beverages",
      "en:non-alcoholic-beverages",
      "en:soft-drinks",
      "en:artificially-sweetened-beverages",
      "en:carbonated-drinks",
      "en:flavoured-soft-drinks",
      "en:diet-beverages",
      "en:sodas",
      "en:colas",
      "en:diet-sodas",
      "en:diet-cola-soft-drink"
    ],
    "ingredients_text": "carbonated water, colour (e150d), acid (phosphoric acid), sweeteners (aspartame, acesulfame-k, enzymatically produced steviol glycosides), natural flavourings, caffeine flavouring, acidity regulator (sodium citrates)",
    "data_quality_errors_tags": [],
    "nutriments": {
      "energy-kcal_100g": 0,
      "energy-kj_100g": 0.9,
      "proteins_100g": 0,
      "fat_100g": 0,
      "saturated-fat_100g": 0,
      "carbohydrates_100g": 0,
      "sugars_100g": 0,
      "added-sugars_100g": 0,
      "sodium_100g": 0.01,
      "salt_100g": 0.02,
      "sodium_unit": "g",
      "nova-group": 4
    }
  }
};

/** What the API answers for a barcode it does not hold. There is no `product` key at all. */
export const not_found = {
  code: '8480000598554',
  status: 0,
  status_verbose: 'product not found',
};
