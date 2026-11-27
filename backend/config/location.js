/** Real delivery footprint for MDNGHT K-RAVINGS. Madapdap is default. */
export const COUNTRY = "Philippines";
export const PROVINCE = "Pampanga";
export const CITY = "Mabalacat";
export const DEFAULT_BARANGAY = "Madapdap";

export const BARANGAYS = [
  "Madapdap",
  "Atlu-Bola",
  "Bical",
  "Bundagul",
  "Cacutud",
  "Calumpang",
  "Camachiles",
  "Dapdap",
  "Dau",
  "Dolores",
  "Duquit",
  "Lakandula",
  "Mabiga",
  "Macapagal Village",
  "Mamatitang",
  "Mangalit",
  "Marcos Village",
  "Mawaque",
  "Paralayunan",
  "Poblacion",
  "San Francisco",
  "San Joaquin",
  "Santa Ines",
  "Santa Maria",
  "Santo Rosario",
  "Sapang Balen",
  "Sapang Biabas",
  "Tabun"
];

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function barangayAlias(value) {
  const name = normalizeName(value);
  // "Dapdap (Madapdap Resettlement)" is the storefront label for Dapdap.
  return name === "dapdap madapdap resettlement" ? "dapdap" : name;
}

export function isValidLocation(pending) {
  const country = normalizeName(pending?.country);
  const province = normalizeName(pending?.province);
  const city = normalizeName(pending?.city).replace(/ city$/, "");
  const barangay = barangayAlias(pending?.barangay);

  if (!country || !province || !city || !barangay) return false;
  if (!BARANGAYS.some((option) => normalizeName(option) === barangay)) return false;
  return country === normalizeName(COUNTRY)
    && province === normalizeName(PROVINCE)
    && city === normalizeName(CITY);
}

export function barangayOptions() {
  return [{ name: DEFAULT_BARANGAY, area: "Madapdap" }, ...BARANGAYS.filter((item) => item !== DEFAULT_BARANGAY).map((name) => ({ name, area: "" }))];
}
