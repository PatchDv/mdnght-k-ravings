const FLAVORS = ["Buffalo", "Soy Garlic", "Cheese", "Garlic Parmesan"];
const SAUCES = ["Buffalo", "Toyomansi", "Cheese", "Teriyaki"];

function flavorGroup({ exact = false, max = 4, included = 1, extraPrice = 10, label = "Choose your flavor" } = {}) {
  return {
    key: "flavors",
    label,
    type: "flavors",
    required: true,
    exact: Boolean(exact),
    max,
    included,
    extraPrice,
    choices: FLAVORS
  };
}

function sauceGroup() {
  return {
    key: "sauce",
    label: "Choose your sauce",
    type: "radio",
    required: true,
    choices: SAUCES
  };
}

function silogAddons() {
  return {
    key: "addons",
    label: "Make it extra",
    type: "checkbox",
    required: false,
    max: 2,
    choices: [
      { name: "Extra rice", price: 15 },
      { name: "Chili garlic", price: 15 }
    ]
  };
}

export const categoryData = [
  {
    name: "Your Korean Cravings Provider",
    slug: "korean-cravings",
    description: "Crispy wings, gooey cheese, and late-night Korean comfort — made fresh for your cravings.",
    accent: "#be2328",
    displayOrder: 1
  },
  {
    name: "TRAYS AND BILAO",
    description: "Big-batch favorites for the whole barkada, family, or midnight meeting.",
    slug: "trays-bilao",
    accent: "#fec714",
    displayOrder: 2
  },
  {
    name: "Silog Meals",
    slug: "silog-meals",
    description: "Garlic rice, a golden egg, and your choice of sauce. Filipino comfort, all day.",
    accent: "#1a213d",
    displayOrder: 3
  }
];

export const menuData = {
  "korean-cravings": [
    {
      name: "6pcs Wings Plain",
      description: "Six crispy, golden wings with our house seasoning. Simple, savory, and seriously crispy.",
      price: 159,
      imageKey: "plain-wings",
      badge: "",
      tags: ["wings", "chicken", "plain", "crispy", "classic"],
      optionGroups: [],
      isFeatured: 1,
      displayOrder: 1
    },
    {
      name: "6pcs Wings with Flavor",
      description: "Six crispy wings tossed in your favorite Korean glaze. Add another flavor for +₱10 each.",
      price: 169,
      imageKey: "flavored-wings",
      badge: "FAN FAVORITE",
      tags: ["wings", "chicken", "flavored", "buffalo", "soy garlic", "cheese", "garlic parmesan", "spicy"],
      optionGroups: [flavorGroup({ max: 4, included: 1, extraPrice: 10, label: "Choose your flavor(s)" })],
      isFeatured: 1,
      displayOrder: 2
    },
    {
      name: "20pcs Pops",
      description: "Twenty bite-sized, extra-crispy chicken pops. One flavor included — add more for +₱10 each.",
      price: 179,
      imageKey: "pops",
      badge: "GOOD FOR SHARING",
      tags: ["pops", "chicken", "boneless", "flavored", "buffalo", "soy garlic", "cheese", "garlic parmesan"],
      optionGroups: [flavorGroup({ max: 4, included: 1, extraPrice: 10, label: "Choose your flavor(s)" })],
      isFeatured: 1,
      displayOrder: 3
    },
    {
      name: "Spicy Tteokbokki Rice Cake",
      description: "Chewy Korean rice cakes simmered in a glossy, sweet-spicy gochujang sauce.",
      price: 119,
      imageKey: "tteokbokki-rice",
      badge: "SPICY",
      tags: ["tteokbokki", "rice cake", "spicy", "korean", "gochujang"],
      optionGroups: [],
      isFeatured: 0,
      displayOrder: 4
    },
    {
      name: "Spicy Tteokbokki Fish Cake",
      description: "A hearty mix of chewy rice cakes and tender fish cakes in our signature spicy sauce.",
      price: 119,
      imageKey: "tteokbokki-fish",
      badge: "",
      tags: ["tteokbokki", "fish cake", "spicy", "korean", "seafood"],
      optionGroups: [],
      isFeatured: 0,
      displayOrder: 5
    },
    {
      name: "Cheesy Samyang with Seaweed",
      description: "Fiery Samyang noodles folded into melty cheese and finished with toasted seaweed.",
      price: 149,
      imageKey: "samyang-cheese",
      badge: "CHEESE PULL",
      tags: ["samyang", "noodles", "cheese", "seaweed", "spicy", "ramen"],
      optionGroups: [],
      isFeatured: 1,
      displayOrder: 6
    },
    {
      name: "Samyang Overload",
      description: "Samyang noodles loaded with Spam, egg, seaweed, and a generous blanket of cheese.",
      price: 179,
      imageKey: "samyang-overload",
      badge: "LOADED",
      tags: ["samyang", "noodles", "spam", "egg", "seaweed", "cheese", "overload", "spicy"],
      optionGroups: [],
      isFeatured: 1,
      displayOrder: 7
    },
    {
      name: "Cheese Kimbap 10pcs",
      description: "Ten bite-sized rolls packed with cheese, egg, carrot, and pickled radish.",
      price: 119,
      imageKey: "kimbap",
      badge: "",
      tags: ["kimbap", "gimbap", "cheese", "rice", "korean", "roll"],
      optionGroups: [],
      isFeatured: 1,
      displayOrder: 8
    },
    {
      name: "Cheesy Fries",
      description: "Golden fries drowned in a warm, creamy cheese sauce. The ultimate sidekick.",
      price: 89,
      imageKey: "cheesy-fries",
      badge: "",
      tags: ["fries", "cheese", "cheesy", "side", "snack"],
      optionGroups: [],
      isFeatured: 0,
      displayOrder: 9
    }
  ],
  "trays-bilao": [
    {
      name: "Small Tray · 16 pieces",
      description: "16 crispy chicken pieces with up to 2 flavors. Perfect for a small group.",
      price: 449,
      imageKey: "tray",
      badge: "SHARING SIZE",
      tags: ["tray", "bilao", "wings", "chicken", "16 pieces", "small", "party", "sharing"],
      optionGroups: [flavorGroup({ exact: true, max: 2, included: 2, extraPrice: 0, label: "Choose exactly 2 flavors" })],
      isFeatured: 0,
      displayOrder: 1
    },
    {
      name: "Medium Tray · 24 pieces",
      description: "24 crispy chicken pieces with up to 3 flavors. Made for the whole barkada.",
      price: 669,
      imageKey: "tray",
      badge: "BARKADA PICK",
      tags: ["tray", "bilao", "wings", "chicken", "24 pieces", "medium", "party", "sharing"],
      optionGroups: [flavorGroup({ exact: true, max: 3, included: 3, extraPrice: 0, label: "Choose exactly 3 flavors" })],
      isFeatured: 1,
      displayOrder: 2
    },
    {
      name: "Large Tray · 32 pieces",
      description: "32 crispy chicken pieces with up to 4 flavors. The centerpiece of any handaan.",
      price: 899,
      imageKey: "tray",
      badge: "BEST FOR GROUPS",
      tags: ["tray", "bilao", "wings", "chicken", "32 pieces", "large", "party", "sharing"],
      optionGroups: [flavorGroup({ exact: true, max: 4, included: 4, extraPrice: 0, label: "Choose exactly 4 flavors" })],
      isFeatured: 1,
      displayOrder: 3
    },
    {
      name: "Spicy Tteokbokki Tray",
      description: "A shareable tray of chewy rice cakes and fish cakes in our fiery gochujang sauce.",
      price: 399,
      imageKey: "tteokbokki-tray",
      badge: "SPICY",
      tags: ["tteokbokki", "tray", "spicy", "rice cake", "sharing"],
      optionGroups: [],
      isFeatured: 0,
      displayOrder: 4
    },
    {
      name: "Cheese Kimbap Small Bilao",
      description: "A beautiful bilao of our crowd-favorite cheese kimbap. Great for merienda.",
      price: 599,
      imageKey: "kimbap-bilao",
      badge: "",
      tags: ["kimbap", "cheese", "bilao", "small", "sharing", "party"],
      optionGroups: [],
      isFeatured: 0,
      displayOrder: 5
    },
    {
      name: "Cheese Kimbap Medium Bilao",
      description: "More rolls, more cheese, more happy faces. The medium bilao for bigger groups.",
      price: 899,
      imageKey: "kimbap-bilao",
      badge: "CROWD PLEASER",
      tags: ["kimbap", "cheese", "bilao", "medium", "sharing", "party"],
      optionGroups: [],
      isFeatured: 1,
      displayOrder: 6
    },
    {
      name: "Cheese Kimbap Large Bilao",
      description: "Our biggest cheese kimbap bilao — made for celebrations, reunions, and big cravings.",
      price: 1199,
      imageKey: "kimbap-bilao",
      badge: "CELEBRATION SIZE",
      tags: ["kimbap", "cheese", "bilao", "large", "sharing", "party"],
      optionGroups: [],
      isFeatured: 1,
      displayOrder: 7
    }
  ],
  "silog-meals": [
    {
      name: "Porkchop Silog",
      description: "Crispy porkchop with garlic rice, a sunny egg, and your preferred sauce.",
      price: 129,
      imageKey: "porkchop-silog",
      badge: "",
      tags: ["silog", "porkchop", "pork", "rice", "egg", "breakfast", "filipino"],
      optionGroups: [sauceGroup(), silogAddons()],
      isFeatured: 0,
      displayOrder: 1
    },
    {
      name: "Liempo Silog",
      description: "Juicy grilled liempo with garlic rice, a sunny egg, and your preferred sauce.",
      price: 139,
      imageKey: "liempo-silog",
      badge: "GRILLED",
      tags: ["silog", "liempo", "pork", "grilled", "rice", "egg", "breakfast", "filipino"],
      optionGroups: [sauceGroup(), silogAddons()],
      isFeatured: 1,
      displayOrder: 2
    },
    {
      name: "Chick Silog",
      description: "Golden fried chicken with garlic rice, a sunny egg, and your preferred sauce.",
      price: 159,
      imageKey: "chick-silog",
      badge: "HEARTY",
      tags: ["silog", "chicken", "chick", "rice", "egg", "breakfast", "filipino"],
      optionGroups: [sauceGroup(), silogAddons()],
      isFeatured: 0,
      displayOrder: 3
    }
  ]
};
