// If someone opens index.html directly from the folder (file://), a relative
// "/api" would point at file:///api. Talk to the local kitchen server instead.
const MK_FILE_MODE = window.location.protocol === "file:";

// Live Server / file:// runs the page off port 3000, so point the API at the
// backend directly. The backend host is whichever machine served this page —
// never hardcode localhost, or phones/tablets on the LAN call themselves.
const MK_HOST = MK_FILE_MODE ? "localhost" : window.location.hostname;
const MK_FRONT_ONLY = MK_FILE_MODE || window.location.port !== "3000";

window.MK_CONFIG = {
  API_BASE: MK_FRONT_ONLY ? `http://${MK_HOST}:3000/api` : "/api",
  FILE_MODE: MK_FRONT_ONLY,
  LOCATION: {
    country: "Philippines",
    province: "Pampanga",
    city: "Mabalacat",
    area: "Madapdap"
  },
  BARANGAYS: [
    { name: "Madapdap", area: "Madapdap" },
    { name: "Dapdap (Madapdap Resettlement)", area: "Madapdap" },
    { name: "Dau", area: "" },
    { name: "Mabiga", area: "" },
    { name: "Sapang Biabas", area: "" },
    { name: "Tabun", area: "" },
    { name: "Atlu-Bola", area: "" },
    { name: "Bical", area: "" },
    { name: "Bundagul", area: "" },
    { name: "Cacutud", area: "" },
    { name: "Calumpang", area: "" },
    { name: "Camachiles", area: "" },
    { name: "Dolores", area: "" },
    { name: "Duquit", area: "" },
    { name: "Lakandula", area: "" },
    { name: "Macapagal Village", area: "" },
    { name: "Mamatitang", area: "" },
    { name: "Mangalit", area: "" },
    { name: "Marcos Village", area: "" },
    { name: "Mawaque", area: "" },
    { name: "Paralayunan", area: "" },
    { name: "Poblacion", area: "" },
    { name: "San Francisco", area: "" },
    { name: "San Joaquin", area: "" },
    { name: "Santa Ines", area: "" },
    { name: "Santa Maria", area: "" },
    { name: "Santo Rosario", area: "" },
    { name: "Sapang Balen", area: "" }
  ],
  // Delivery fee is quoted per order by the admin; there is no store-wide fee.
  DELIVERY_ETA: "30–45 min",
  STORAGE: {
    PROFILE: "mk_profile",
    CUSTOMER_TOKEN: "mk_customer_token",
    CART: "mk_cart",
    ORDERS: "mk_orders",
    ADMIN_NAME: "mk_admin_name"
  }
};
