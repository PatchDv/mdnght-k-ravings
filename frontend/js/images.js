/**
 * IMAGE CONTROL PANEL
 * -------------------
 * Change a food photo here without touching the app logic.
 * Drop a new file into frontend/assets/images, then point the key to it.
 *
 * You can also paste a full https:// image URL as an item's image key
 * from the admin Menu Studio.
 */
window.MK_IMAGES = {
  logo: "assets/images/logokrave.jpg",
  hero: "assets/images/wings.jpg",

  "plain-wings": "assets/images/wings-juicy.jpg",
  "flavored-wings": "assets/images/KravingsImages/ChickenWingsWithFlavor.jpg",
  "pops": "assets/images/KravingsImages/20pcsChickenPops.jpg",
  "tteokbokki-rice": "assets/images/KravingsImages/SpicyTeokbokki.jpg",
  "tteokbokki-fish": "assets/images/tteokbokki.jpg",
  "samyang-cheese": "assets/images/KravingsImages/CheesySamyang.jpg",
  "samyang-overload": "assets/images/KravingsImages/SamyangOverload.jpg",
  "kimbap": "assets/images/KravingsImages/CheeseKimbap.jpg",
  "cheesy-fries": "assets/images/KravingsImages/CheesyFries.jpg",
  "tray": "assets/images/wings-banban.jpg",
  "tray-small": "assets/images/KravingsImages/SmallTrayWings.jpg",
  "tray-medium": "assets/images/KravingsImages/MediumTrayWings.jpg",
  "tray-large": "assets/images/wings-cheese.jpg",
  "tteokbokki-tray": "assets/images/KravingsImages/SpicyTeokbokkiTray.jpg",
  "kimbap-bilao": "assets/images/bilao.jpg",
  "bilao-small": "assets/images/KravingsImages/SmallBilaoKimbap.jpg",
  "bilao-medium": "assets/images/kimbap-2.jpg",
  "bilao-large": "assets/images/KravingsImages/LargeBilaoKimbap.jpg",
  "porkchop-silog": "assets/images/KravingsImages/PorkchopSilog.jpg",
  "liempo-silog": "assets/images/KravingsImages/LiempoSilog.jpg",
  "chick-silog": "assets/images/KravingsImages/ChickSilog.jpg",
  "samyang": "assets/images/samyang.jpg"
};

// Serve from the site root so the admin board (hosted at /<secret>/board)
// resolves the same files; file:// mirrors keep their relative paths.
{
  const prefix = window.MK_CONFIG?.FILE_MODE ? "" : "/";
  for (const [key, value] of Object.entries(window.MK_IMAGES)) {
    if (!/^(https?:|data:|\/)/.test(value)) window.MK_IMAGES[key] = prefix + value;
  }
}

window.MK_IMAGE_LIBRARY = [
  { key: "plain-wings", label: "Crispy fried chicken", src: window.MK_IMAGES["plain-wings"] },
  { key: "flavored-wings", label: "Glazed Korean wings", src: window.MK_IMAGES["flavored-wings"] },
  { key: "pops", label: "Chicken pops", src: window.MK_IMAGES["pops"] },
  { key: "tteokbokki-rice", label: "Tteokbokki rice cake", src: window.MK_IMAGES["tteokbokki-rice"] },
  { key: "tteokbokki-fish", label: "Tteokbokki tray", src: window.MK_IMAGES["tteokbokki-fish"] },
  { key: "samyang-cheese", label: "Cheesy Samyang", src: window.MK_IMAGES["samyang-cheese"] },
  { key: "samyang-overload", label: "Samyang overload", src: window.MK_IMAGES["samyang-overload"] },
  { key: "kimbap", label: "Cheese kimbap", src: window.MK_IMAGES["kimbap"] },
  { key: "cheesy-fries", label: "Cheesy fries", src: window.MK_IMAGES["cheesy-fries"] },
  { key: "tray", label: "Sharing tray", src: window.MK_IMAGES["tray"] },
  { key: "tteokbokki-tray", label: "Tteokbokki tray", src: window.MK_IMAGES["tteokbokki-tray"] },
  { key: "kimbap-bilao", label: "Kimbap bilao", src: window.MK_IMAGES["kimbap-bilao"] },
  { key: "porkchop-silog", label: "Porkchop silog", src: window.MK_IMAGES["porkchop-silog"] },
  { key: "liempo-silog", label: "Liempo silog", src: window.MK_IMAGES["liempo-silog"] },
  { key: "chick-silog", label: "Chick silog", src: window.MK_IMAGES["chick-silog"] },
  { key: "samyang", label: "Samyang noodles", src: window.MK_IMAGES["samyang"] }
];

const FALLBACK_IMAGE = window.MK_IMAGES["flavored-wings"];

function isImageSource(value) {
  return /^(https?:\/\/|\/|assets\/|data:image\/)/i.test(String(value || ""));
}

window.resolveMenuImage = function resolveMenuImage(key) {
  if (!key) return FALLBACK_IMAGE;
  if (isImageSource(key)) return key;
  return window.MK_IMAGES[key] || FALLBACK_IMAGE;
};

/**
 * Pick the most relevant local photo for an item.
 * The admin can still override everything with a custom image key or URL.
 * Name keywords are used so trays, bilao sizes and silog meals do not all
 * look exactly the same.
 */
window.resolveItemImage = function resolveItemImage(item) {
  if (!item) return FALLBACK_IMAGE;
  if (typeof item === "string") return window.resolveMenuImage(item);

  const key = String(item.imageKey || "");
  const name = String(item.name || "").toLowerCase();

  // A custom URL or an explicit local path always wins.
  if (isImageSource(key)) return key;

  if (/kimbap|gimbap/.test(name) && /bilao/.test(name)) {
    if (/large/.test(name)) return window.MK_IMAGES["bilao-large"];
    if (/medium/.test(name)) return window.MK_IMAGES["bilao-medium"];
    return window.MK_IMAGES["bilao-small"];
  }
  if (/kimbap|gimbap/.test(name)) return window.MK_IMAGES["kimbap"];
  if (/fries/.test(name)) return window.MK_IMAGES["cheesy-fries"];
  if (/samyang/.test(name)) {
    return /overload/.test(name) ? window.MK_IMAGES["samyang-overload"] : window.MK_IMAGES["samyang-cheese"];
  }
  if (/tteokbokki/.test(name)) {
    // Fish-cake variant keeps its own photo — no KravingsImages match for it.
    if (/fish/.test(name)) return window.MK_IMAGES["tteokbokki-fish"];
    return /tray|bilao/.test(name) ? window.MK_IMAGES["tteokbokki-tray"] : window.MK_IMAGES["tteokbokki-rice"];
  }
  if (/silog/.test(name)) {
    // Liempo keeps its own photo; the generic branch would hand it porkchop's.
    if (/liempo/.test(name)) return window.MK_IMAGES["liempo-silog"];
    return /chick|chicken/.test(name) ? window.MK_IMAGES["chick-silog"] : window.MK_IMAGES["porkchop-silog"];
  }
  if (/pops/.test(name)) return window.MK_IMAGES["pops"];
  if (/plain/.test(name) && /wing/.test(name)) return window.MK_IMAGES["plain-wings"];
  if (/wing/.test(name)) return window.MK_IMAGES["flavored-wings"];
  if (/tray/.test(name)) {
    if (/large|32/.test(name)) return window.MK_IMAGES["tray-large"];
    if (/medium|24/.test(name)) return window.MK_IMAGES["tray-medium"];
    return window.MK_IMAGES["tray-small"];
  }

  return window.resolveMenuImage(key);
};

window.MK_FALLBACK_IMAGE = FALLBACK_IMAGE;
