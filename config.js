// ---------------------------------------------------------------------------
// CONFIGURACIÓ — valors del projecte de Supabase de DESPESES (Project Settings > API)
//   SUPABASE_URL      -> "Project URL"   (p. ex. https://abcdefgh.supabase.co, sense res al final)
//   SUPABASE_ANON_KEY -> clau "anon public"
// ---------------------------------------------------------------------------
window.HORES_CONFIG = {
  SUPABASE_URL: "https://nzlganmgyblryngrspbb.supabase.co",
  SUPABASE_ANON_KEY: "sb_secret_-nsHRDw6R36dY9q54Gh3OA_GT1NrlkA",

  // Els enquestadors entren amb un nom curt (p. ex. "1104"); internament es converteix
  // en 1104@<DOMINI>. No s'hi envia cap correu. No ho canviïs un cop creats els usuaris.
  DOMINI: "camp.gesop.net",

  TITOL: "Despeses de camp · GESOP",

  // Tablets compartides: es tanca la sessió després d'aquests minuts sense fer res
  INACTIVITAT_MIN: 15,

  // Dades de facturació que han de constar a les factures d'hotel
  DADES_FACTURA: "GESOP, Gabinet d'Estudis Socials i Opinió Pública · Carrer Provença 385, entresol A · 08025 Barcelona · CIF: B63647994",

  LOGO_URL: "https://gesop.net/wp-content/uploads/2025/12/LogoGesop_White.png"
};
