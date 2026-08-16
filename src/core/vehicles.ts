/** Mise en forme des noms de véhicules de prestige (spawn code → nom marketing). */
const KNOWN_MODELS: Record<string, string> = {
  "1016URUS": "Lamborghini Urus 1016",
  "1500GHOUL": "RAM 1500 TRX Ghoul",
  AUTARCH: "Överflöd Autarch Hypercar",
  "09TURISHP": "Grotti Turismo HP",
  PFISTER: "Pfister Neon Concept",
  PARIAH: "Ocelot Pariah Super Sport",
  T20: "Progen T20 Hypercar",
  ENTITY2: "Överflöd Entity MT",
  ENTITYXXR: "Överflöd Entity XXR",
  TORERO2: "Pegassi Torero XO",
  CHIRON: "Bugatti Chiron Sport",
  DIVO: "Bugatti Divo Hypercar",
  NEO: "Vysser Neo Hypercar"
};

export function formatLuxuryCarName(rawName: unknown): string {
  if (!rawName) return "Véhicule D'Exception";
  const nameUpper = String(rawName).toUpperCase().trim();
  if (KNOWN_MODELS[nameUpper]) return KNOWN_MODELS[nameUpper];
  return String(rawName).charAt(0).toUpperCase() + String(rawName).slice(1);
}

const LUXURY_TO_SPAWN: Record<string, string> = {
  "ÖVERFLÖD ENTITY MT": "entity2",
  "OVERFLOD ENTITY MT": "entity2",
  "ÖVERFLÖD ENTITY XXR": "entityxxr",
  "OVERFLOD ENTITY XXR": "entityxxr",
  "ÖVERFLÖD AUTARCH HYPERCAR": "autarch",
  "OVERFLOD AUTARCH HYPERCAR": "autarch",
  "LAMBORGHINI URUS 1016": "1016urus",
  "RAM 1500 TRX GHOUL": "1500ghoul",
  "1500GHOUL": "1500ghoul",
  "1016URUS": "1016urus",
  "GROTTI TURISMO HP": "09turishp",
  "09TURISHP": "09turishp",
  "PFISTER NEON CONCEPT": "pfister",
  PFISTER: "pfister",
  "OCELOT PARIAH SUPER SPORT": "pariah",
  PARIAH: "pariah",
  "PROGEN T20 HYPERCAR": "t20",
  "PEGASSI TORERO XO": "torero2",
  TORERO2: "torero2",
  "BUGATTI CHIRON SPORT": "chiron",
  CHIRON: "chiron",
  "BUGATTI DIVO HYPERCAR": "divo",
  DIVO: "divo",
  "VYSSER NEO HYPERCAR": "neo",
  NEO: "neo",
  ENTITYXF: "entityxf",
  ENTITY3: "entity3",
  ENTITY2: "entity2",
  ENTITYXXR: "entityxxr",
  ITALIRSX: "italirsx",
  FURIA: "furia",
  KRIEGER: "krieger",
  THRAX: "thrax",
  TEMPESTA: "tempesta",
  T20: "t20",
  ADDER: "adder",
  AUTARCH: "autarch"
};

const CDN_BASE = "https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots/";

/** Résout la photo CDN d'un véhicule à partir de son nom ou spawn code. */
export function resolveVehiclePhotoUrl(carName: unknown): string {
  if (!carName) return "assets/logo.webp";
  const raw = String(carName).toUpperCase().trim();

  if (LUXURY_TO_SPAWN[raw]) {
    return `${CDN_BASE}${LUXURY_TO_SPAWN[raw]}.webp`;
  }

  for (const [key, spawn] of Object.entries(LUXURY_TO_SPAWN)) {
    if (raw.includes(key) || key.includes(raw)) {
      return `${CDN_BASE}${spawn}.webp`;
    }
  }

  // Spawn code final d'un nom composite (ex: "Lampadati 09turishp" -> "09turishp")
  const parts = raw.toLowerCase().split(/[\s_-]+/);
  const candidate = parts[parts.length - 1] || parts[0];
  const cleanCode = candidate.replace(/[^a-z0-9]/g, "");

  return `${CDN_BASE}${encodeURIComponent(cleanCode)}.webp`;
}
