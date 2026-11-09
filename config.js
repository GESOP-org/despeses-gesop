// ---------------------------------------------------------------------------
// CONFIGURACIÓ — valors del projecte de Supabase de DESPESES (Project Settings > API)
//   SUPABASE_URL      -> "Project URL"   (p. ex. https://abcdefgh.supabase.co, sense res al final)
//   SUPABASE_ANON_KEY -> clau "anon public"
// ---------------------------------------------------------------------------
window.HORES_CONFIG = {
  SUPABASE_URL: "https://nzlganmgyblryngrspbb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56bGdhbm1neWJscnluZ3JzcGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5NTMxMTEsImV4cCI6MjEwOTUyOTExMX0.6q1-hdiM4pPKNQ4Tb90ZnRJ4HlkqaHcivPBW9aH0oiM",

  // Els enquestadors entren amb un nom curt (p. ex. "1104"); internament es converteix
  // en 1104@<DOMINI>. No s'hi envia cap correu. No ho canviïs un cop creats els usuaris.
  DOMINI: "camp.gesop.net",

  TITOL: "Despeses de camp · GESOP",

  // Llargada mínima de la contrasenya (6 permet les d'Integra: 3 lletres + 3 números)
  MIN_CONTRASENYA: 6,

  // Tablets compartides: es tanca la sessió després d'aquests minuts sense fer res
  INACTIVITAT_MIN: 60,

  // Dades de facturació que han de constar a les factures d'hotel
  DADES_FACTURA: "GESOP, Gabinet d'Estudis Socials i Opinió Pública · Carrer Provença 385, entresol A · 08025 Barcelona · CIF: B63647994",

  LOGO_URL: "https://gesop.net/wp-content/uploads/2025/12/LogoGesop_White.png"
};
