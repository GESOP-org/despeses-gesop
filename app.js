/* ===========================================================================
   Despeses de camp · GESOP
   Web estàtica + Supabase (mateix projecte que el registre d'hores).
   L'import a pagar i els avisos els calcula la base de dades; aquí es mostren
   en directe perquè l'enquestador/a vegi què cobrarà abans de desar.
   =========================================================================== */
(() => {
  "use strict";

  const C = window.HORES_CONFIG || {};
  const app = document.getElementById("app");

  // ------------------------------------------------------------------ connexió
  function netejaUrl(u) {
    u = String(u || "").trim().replace(/\s+/g, "");
    const panell = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
    if (panell) return `https://${panell[1]}.supabase.co`;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u.replace(/\/+(rest|auth|storage)\/v1.*$/i, "").replace(/\/+$/, "");
  }
  if (!window.supabase || !C.SUPABASE_URL || C.SUPABASE_URL.includes("XXXXXXXX")) {
    app.innerHTML = `<div class="login-fons"><div class="login"><h1>Falta configurar</h1>
      <p>Omple <code>SUPABASE_URL</code> i <code>SUPABASE_ANON_KEY</code> al fitxer <code>config.js</code>.</p></div></div>`;
    return;
  }
  C.SUPABASE_URL = netejaUrl(C.SUPABASE_URL);
  C.SUPABASE_ANON_KEY = String(C.SUPABASE_ANON_KEY || "").trim();
  // Tablets compartides: la sessió es guarda només a la pestanya (sessionStorage)
  let memoria = {};
  const magatzem = (() => {
    try { sessionStorage.setItem("_t", "1"); sessionStorage.removeItem("_t"); return sessionStorage; }
    catch (e) { return { getItem: (k) => memoria[k] ?? null, setItem: (k, v) => { memoria[k] = v; }, removeItem: (k) => { delete memoria[k]; } }; }
  })();
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: magatzem, storageKey: "despeses-gesop-auth" }
  });
  const BUCKET = "tiquets";

  const S = {
    user: null, perfil: null, pestanya: "meves",
    projectes: [], tarifes: [], criteri: [], fulls: [], editant: null,
    fotosNoves: [], fotosEsborrar: [], rev: null, nom: null, est: null, usuaris: []
  };

  // ------------------------------------------------------------------ utilitats
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, "0");
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const avui = () => isoLocal(new Date());
  const fmtData = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
  const eur = (n) => (Number(n) || 0).toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const normalitza = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const LOGO = C.LOGO_URL || "https://gesop.net/wp-content/uploads/2025/12/LogoGesop_White.png";
  const logoHtml = (cls) => `<img class="${cls}" src="${esc(LOGO)}" alt="GESOP" onerror="this.outerHTML='<span class=&quot;${cls} logo-text&quot;>GESOP</span>'">`;
  const emailDe = (usuari) => { const u = usuari.trim().toLowerCase(); return u.includes("@") ? u : `${u}@${C.DOMINI}`; };
  const MESOS = ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"];
  const nomMes = (ym) => ym ? `${MESOS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : "";

  // "8,50", "8.50", "8" -> 8.5 ; buit -> null ; text -> NaN
  function parseImport(x) {
    let s = String(x ?? "").trim().replace(/\s|€/g, "");
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");   // 1.234,56
    s = s.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100) / 100;
  }
  function parseKm(x) {
    const s = String(x ?? "").trim().replace(/\s|km/gi, "").replace(",", ".");
    if (!s) return null;
    if (!/^\d+(\.\d)?$/.test(s)) return NaN;
    return parseFloat(s);
  }
  const fmtInput = (n) => (n == null ? "" : String(n).replace(".", ","));

  function missatgeError(e) {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (m.includes("TANCAT")) return "Aquest full ja està revisat i no es pot modificar.";
    if (m.includes("row-level security")) return "No tens permís per fer això.";
    if (m.includes("Invalid login credentials")) return "Usuari o contrasenya incorrectes.";
    if (m.includes("already registered") || m.includes("already been registered")) return "Aquest usuari ja existeix.";
    if (m.includes("email rate limit")) return "Supabase intenta enviar correus: desactiva 'Confirm email' (Authentication > Sign In / Providers > Email).";
    if (m.includes("rate limit") || m.includes("For security purposes")) return "Massa peticions seguides: espera un parell de minuts i torna-ho a provar.";
    if (m.includes("Payload too large") || m.includes("exceeded the maximum")) return "La foto és massa gran.";
    if (m.includes("Failed to fetch")) return "No hi ha connexió. Torna-ho a provar quan tinguis cobertura.";
    return m;
  }
  function toast(msg, tipus = "") {
    const t = document.createElement("div");
    t.className = `toast ${tipus}`; t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), tipus === "error" ? 7000 : 3500);
  }
  let modalId = 0;   // si des d'un botó s'obre una altra finestra, no s'ha de tancar la nova
  function modal(titol, cosHtml, botons = [{ text: "Tanca" }], ample = false) {
    const meu = ++modalId;
    $("#modal-titol").textContent = titol;
    $("#modal-cos").innerHTML = cosHtml;
    $(".modal-caixa").classList.toggle("ample", ample);
    const cont = $("#modal-botons"); cont.innerHTML = "";
    botons.forEach((b) => {
      const el = document.createElement("button");
      el.textContent = b.text; if (b.cls) el.className = b.cls;
      el.onclick = async () => { if (b.onClick) { const r = await b.onClick(); if (r === false) return; } if (meu === modalId) tancaModal(); };
      cont.appendChild(el);
    });
    $("#modal").classList.remove("ocult");
  }
  const tancaModal = () => $("#modal").classList.add("ocult");
  const confirma = (titol, html, boto = "D'acord", cls = "primari", cancel = "Cancel·la") =>
    new Promise((res) => modal(titol, `<p>${html}</p>`, [
      { text: cancel, onClick: () => res(false) }, { text: boto, cls, onClick: () => res(true) }]));
  async function fetchAll(builder) {
    const mida = 1000; let desde = 0; const out = [];
    for (;;) {
      const { data, error } = await builder().range(desde, desde + mida - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < mida) break;
      desde += mida;
    }
    return out;
  }
  const marcaTemps = () => { const d = new Date(); return `${isoLocal(d).replace(/-/g, "")}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
  function generaPwd(n = 10) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    return Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join("");
  }
  function descarregaFitxer(nom, contingut, tipus) {
    const blob = new Blob([contingut], { type: tipus });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ regles (mirall de la base de dades)
  const CONCEPTES = [
    ["esmorzar", "Esmorzar", "dieta"], ["dinar", "Dinar", "dieta"], ["sopar", "Sopar", "dieta"],
    ["transport", "Transport (bitllets)", "desp"], ["km", "Quilometratge", "desp"], ["aparcament", "Aparcament", "desp"],
    ["autopistes", "Autopistes", "desp"], ["hotel", "Hotel", "hotel"], ["impost_turistic", "Impost turístic", "hotel"],
    ["altres", "Altres despeses", "altres"]
  ];
  const AVISOS = {
    sense_tiquet: "Falta la foto del tiquet", sense_foto_km: "Falta la foto del comptaquilòmetres",
    sense_factura_hotel: "Falta la factura de l'hotel", supera_maxim: "Supera l'import màxim (es paga el màxim)",
    import_estrany: "Import molt alt: revisa si falta la coma", dieta_no_correspon: "Dieta que no correspon segons el criteri",
    desplacament_amb: "Desplaçament dins l'AMB (no es paga)", data_futura: "Data futura", data_antiga: "Data de fa més de 60 dies",
    altres_sense_concepte: "\"Altres\" sense concepte", mateix_dia: "Hi ha un altre full el mateix dia"
  };
  const AVISOS_GREUS = ["import_estrany", "sense_tiquet", "sense_foto_km", "sense_factura_hotel", "data_futura", "dieta_no_correspon", "desplacament_amb"];
  function tarifaDe(dataIso) {
    const any = +String(dataIso || avui()).slice(0, 4);
    const ord = S.tarifes.slice().sort((a, b) => b.exercici - a.exercici);
    return ord.find((t) => t.exercici <= any) || ord[ord.length - 1] || { esmorzar: 0, dinar: 0, sopar: 0, hotel: 0, km: 0 };
  }
  const criteriDe = (m) => S.criteri.find((c) => normalitza(c.municipi) === normalitza(m)) || null;
  function calcula(f) {
    const t = tarifaDe(f.data), c = criteriDe(f.municipi);
    const despOk = !(c && c.sense_desplacament);
    const dietaOk = c && c.sense_dieta ? !!(c.nota && f.fora_nucli) : !!f.jornada_completa;
    const v = (k) => Number(f[k]) || 0;
    const pag = {
      esmorzar: dietaOk ? Math.min(v("esmorzar"), +t.esmorzar) : 0,
      dinar: dietaOk ? Math.min(v("dinar"), +t.dinar) : 0,
      sopar: dietaOk ? Math.min(v("sopar"), +t.sopar) : 0,
      hotel: Math.min(v("hotel"), +t.hotel * (Number(f.hotel_nits) || 1)),
      transport: despOk ? v("transport") : 0,
      km: despOk ? Math.round(v("km") * +t.km * 100) / 100 : 0,
      aparcament: despOk ? v("aparcament") : 0,
      autopistes: despOk ? v("autopistes") : 0,
      impost_turistic: v("impost_turistic"), altres: v("altres")
    };
    const tiquet = { ...Object.fromEntries(CONCEPTES.map(([k]) => [k, v(k)])), km: Math.round(v("km") * +t.km * 100) / 100 };
    const total = Object.values(pag).reduce((a, b) => a + b, 0);
    const totalTiquets = Object.values(tiquet).reduce((a, b) => a + b, 0);
    return { t, c, despOk, dietaOk, pag, tiquet, total: Math.round(total * 100) / 100, totalTiquets: Math.round(totalTiquets * 100) / 100 };
  }

  // ------------------------------------------------------------------ fotos
  async function comprimeix(file) {
    if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 1600, esc_ = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * esc_); cv.height = Math.round(img.height * esc_);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.72));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; } finally { URL.revokeObjectURL(url); }
  }
  async function urlFoto(path) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // ------------------------------------------------------------------ cercador (projectes i municipis)
  function initCombo(input, llista, opcions, enTriar, buit = "Cap coincidència") {
    let actiu = -1, vistes = [];
    const obre = (o) => llista.classList.toggle("ocult", !o);
    const pinta = () => {
      const q = normalitza(input.value).split(/\s+/).filter(Boolean);
      const totes = opcions();
      vistes = (!q.length || totes.includes(input.value)) ? totes.slice(0, 300)
        : totes.filter((o) => { const n = normalitza(o); return q.every((p) => n.includes(p)); });
      // primer els que comencen pel text
      if (q.length) vistes.sort((a, b) => (normalitza(b).startsWith(q[0]) - normalitza(a).startsWith(q[0])));
      actiu = vistes.length ? 0 : -1;
      llista.innerHTML = !vistes.length ? `<li class="combo-buit">${buit}</li>`
        : vistes.slice(0, 60).map((o, i) => `<li data-i="${i}" class="${i === actiu ? "actiu" : ""}">${esc(o)}</li>`).join("") +
          (vistes.length > 60 ? `<li class="combo-buit">… escriu més per afinar</li>` : "");
      obre(true);
    };
    const marca = () => $$("li[data-i]", llista).forEach((li) => {
      li.classList.toggle("actiu", +li.dataset.i === actiu); if (+li.dataset.i === actiu) li.scrollIntoView({ block: "nearest" });
    });
    const tria = (i) => { if (i < 0 || i >= vistes.length) return; input.value = vistes[i]; obre(false); input.dispatchEvent(new Event("change")); enTriar && enTriar(vistes[i]); };
    input.addEventListener("input", pinta);
    input.addEventListener("focus", () => { input.select(); pinta(); });
    input.addEventListener("keydown", (e) => {
      const n = Math.min(vistes.length, 60);
      if (e.key === "ArrowDown") { if (llista.classList.contains("ocult")) pinta(); else { actiu = Math.min(n - 1, actiu + 1); marca(); } e.preventDefault(); }
      else if (e.key === "ArrowUp") { actiu = Math.max(0, actiu - 1); marca(); e.preventDefault(); }
      else if (e.key === "Enter") { if (!llista.classList.contains("ocult") && actiu >= 0) { tria(actiu); e.preventDefault(); } }
      else if (e.key === "Escape") obre(false);
    });
    llista.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (!li) return; e.preventDefault(); tria(+li.dataset.i); });
    input.addEventListener("blur", () => setTimeout(() => {
      obre(false);
      if (input.value && !opcions().includes(input.value)) {
        const ok = opcions().filter((o) => normalitza(o) === normalitza(input.value.trim()));
        if (ok.length === 1) { input.value = ok[0]; input.dispatchEvent(new Event("change")); }
      }
    }, 150));
  }
  const MUNICIPIS = () => (window.MUNICIPIS_CAT || []).concat(window.MUNICIPIS_RESTA || []);

  // ------------------------------------------------------------------ sessió i inactivitat
  // Inactivitat: a més del temporitzador, es guarda l'hora de l'última activitat i es comprova
  // cada cop que la pestanya torna a ser visible (les tablets "adormen" els temporitzadors)
  let temporitzador = null;
  const MAX_INACTIU = (C.INACTIVITAT_MIN || 15) * 60000;
  const CLAU_ACT = "despeses-ultima-activitat";
  const llegeixAct = () => { try { return +magatzem.getItem(CLAU_ACT) || 0; } catch (e) { return 0; } };
  const marcaAct = () => { try { magatzem.setItem(CLAU_ACT, String(Date.now())); } catch (e) { /* res */ } };
  async function tancaPerInactivitat() {
    clearTimeout(temporitzador);
    await sb.auth.signOut(); S.perfil = null; tancaModal();
    renderLogin("S'ha tancat la sessió per inactivitat.");
  }
  function reiniciaInactivitat() {
    clearTimeout(temporitzador);
    if (!S.perfil) return;
    marcaAct();
    temporitzador = setTimeout(tancaPerInactivitat, MAX_INACTIU);
  }
  function comprovaInactivitat() {
    if (S.perfil && llegeixAct() && Date.now() - llegeixAct() > MAX_INACTIU) { tancaPerInactivitat(); return true; }
    return false;
  }
  let darreraMarca = 0;
  ["click", "keydown", "touchstart", "input"].forEach((ev) => document.addEventListener(ev, () => {
    if (comprovaInactivitat()) return;
    if (Date.now() - darreraMarca > 5000) { darreraMarca = Date.now(); reiniciaInactivitat(); }
  }, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") comprovaInactivitat(); });
  window.addEventListener("pageshow", comprovaInactivitat);
  window.addEventListener("focus", comprovaInactivitat);

  async function inici() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return renderLogin();
    // pestanya restaurada o reoberta després de massa estona: es tanca la sessió
    if (llegeixAct() && Date.now() - llegeixAct() > MAX_INACTIU) {
      await sb.auth.signOut(); return renderLogin("S'ha tancat la sessió per inactivitat.");
    }
    await despresLogin(data.session.user);
  }
  async function carregaBase() {
    const [pj, tf, cr] = await Promise.all([
      fetchAll(() => sb.from("llistes").select("valor").eq("tipus", "projecte").eq("actiu", true).order("id")),
      sb.from("tarifes").select("*").order("exercici"),
      sb.from("municipis_criteri").select("*").order("municipi")
    ]);
    if (tf.error) throw tf.error; if (cr.error) throw cr.error;
    const p = pj.map((r) => r.valor);
    S.projectes = p.filter((x) => x === "ESTRUCTURA").concat(p.filter((x) => x !== "ESTRUCTURA").sort((a, b) => b.localeCompare(a, "ca")));
    S.tarifes = tf.data; S.criteri = cr.data;
  }
  async function despresLogin(user) {
    S.user = user;
    const { data: perfil, error } = await sb.from("perfils").select("*").eq("id", user.id).maybeSingle();
    if (error || !perfil) { await sb.auth.signOut(); return renderLogin("No s'ha trobat el teu perfil. Parla amb l'administració."); }
    if (!perfil.actiu) {
      await sb.auth.signOut();
      return renderLogin(perfil.alta_feta === false
        ? "L'alta no està completa: torna a «Donar-me d'alta» amb el codi d'alta correcte i la mateixa contrasenya."
        : "El teu usuari està desactivat. Parla amb l'oficina.");
    }
    S.perfil = perfil; darreraMarca = 0; reiniciaInactivitat();
    S.pestanya = perfil.admin ? "revisio" : "meves"; S.rev = null; S.nom = null; S.est = null;   // tablet compartida: no arrossegar res de l'anterior
    if (perfil.canviar_pwd) return renderCanviPwd(true);
    try { await carregaBase(); } catch (e) { toast(missatgeError(e), "error"); }
    renderApp();
  }
  function renderLogin(msg = "") {
    app.innerHTML = `<div class="login-fons">${logoHtml("logo-login")}
      <form class="login" id="f-login">
        <h1>Despeses de camp</h1>
        <label for="l-user">Usuari</label><input type="text" id="l-user" autocomplete="username" autocapitalize="none" required>
        <label for="l-pwd">Contrasenya</label><input type="password" id="l-pwd" autocomplete="current-password" required>
        ${msg ? `<div class="error">${esc(msg)}</div>` : ""}
        <div class="fila-botons"><button class="primari gran" type="submit" style="width:100%">Entra</button></div>
        <p class="pista" style="text-align:center">Tablet compartida: recorda prémer <b>Surt</b> en acabar.</p>
        <div class="separador-o"><span>És el primer cop?</span></div>
        <div class="fila-botons" style="margin-top:10px"><button type="button" id="b-alta" style="width:100%">Donar-me d'alta</button></div>
      </form></div>`;
    $("#b-alta").onclick = () => renderAlta();
    $("#l-user").focus();
    $("#f-login").onsubmit = async (ev) => {
      ev.preventDefault(); const btn = $("#f-login button"); btn.disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email: emailDe($("#l-user").value), password: $("#l-pwd").value });
      if (error) { btn.disabled = false; return renderLogin(missatgeError(error)); }
      await despresLogin(data.user);
    };
  }
  // Alta autònoma: l'enquestador/a es crea el compte amb el codi d'alta que li dona l'oficina
  function renderAlta(valors = {}, msg = "") {
    app.innerHTML = `<div class="login-fons">${logoHtml("logo-login")}
      <form class="login" id="f-alta" autocomplete="off">
        <h1>Donar-me d'alta</h1>
        <p class="pista">Només el primer cop. Després entraràs amb el teu codi i la contrasenya que triïs ara.</p>
        <label for="a-nom">Nom i cognoms</label><input type="text" id="a-nom" value="${esc(valors.nom || "")}" autocomplete="name">
        <label for="a-codi">Codi d'entrevistador/a <span class="pista">(serà el teu usuari)</span></label>
        <input type="text" id="a-codi" value="${esc(valors.codi || "")}" inputmode="numeric" autocapitalize="none" placeholder="p. ex. 1104">
        <label for="a-pwd">Tria una contrasenya (mínim 8 caràcters)</label><input type="password" id="a-pwd" autocomplete="new-password">
        <label for="a-pwd2">Repeteix-la</label><input type="password" id="a-pwd2" autocomplete="new-password">
        <label for="a-alta">Codi d'alta <span class="pista">(te'l dona l'oficina)</span></label>
        <input type="text" id="a-alta" value="${esc(valors.alta || "")}" autocapitalize="characters">
        <div id="a-err" class="error">${esc(msg)}</div>
        <div class="fila-botons"><button type="button" id="a-tornar">Tornar</button><button class="primari" type="submit" style="flex:1">Donar-me d'alta</button></div>
      </form></div>`;
    $("#a-tornar").onclick = () => renderLogin();
    (valors.nom ? $("#a-pwd") : $("#a-nom")).focus();
    $("#f-alta").onsubmit = async (ev) => {
      ev.preventDefault();
      const v = { nom: $("#a-nom").value.trim(), codi: $("#a-codi").value.trim().toLowerCase(), alta: $("#a-alta").value.trim() };
      const pwd = $("#a-pwd").value, err = (t) => { $("#a-err").textContent = t; };
      if (v.nom.length < 3) return err("Escriu el teu nom i cognoms.");
      if (!/^[a-z0-9._-]{2,30}$/.test(v.codi)) return err("El codi només pot tenir números i lletres sense accents.");
      if (pwd.length < 8) return err("La contrasenya ha de tenir com a mínim 8 caràcters.");
      if (pwd !== $("#a-pwd2").value) return err("Les dues contrasenyes no coincideixen.");
      if (!v.alta) return err("Falta el codi d'alta.");
      const btn = $("#f-alta button[type=submit]"); btn.disabled = true; btn.textContent = "Un moment…";
      const email = emailDe(v.codi);
      let { data, error } = await sb.auth.signUp({ email, password: pwd });
      if (error && /already (been )?registered|already exists/i.test(error.message || "")) {
        // ja s'havia començat l'alta (p. ex. codi d'alta incorrecte): s'hi entra amb la mateixa contrasenya
        ({ data, error } = await sb.auth.signInWithPassword({ email, password: pwd }));
        if (error) return renderAlta(v, "Ja existeix un usuari amb aquest codi. Si és teu i no recordes la contrasenya, parla amb l'oficina.");
      } else if (error) return renderAlta(v, missatgeError(error));
      if (!data.session) return renderAlta(v, "Cal desactivar 'Confirm email' a Supabase. Avisa l'oficina.");
      const { data: res, error: e2 } = await sb.rpc("alta_enquestador", { p_codi_alta: v.alta, p_nom: v.nom, p_codi: v.codi });
      if (e2) { await sb.auth.signOut(); return renderAlta(v, missatgeError(e2)); }
      if (res === "ok" || res === "ja_feta") { toast("Benvingut/da! Ja pots enviar les teves despeses.", "ok"); return despresLogin(data.user); }
      await sb.auth.signOut();
      if (res === "codi") return renderAlta({ ...v, alta: "" }, "El codi d'alta no és correcte. Torna-ho a provar (amb la mateixa contrasenya).");
      if (res === "bloquejat") return renderAlta(v, "Massa intents amb un codi incorrecte. Parla amb l'oficina.");
      return renderAlta(v, "No s'ha pogut completar l'alta. Torna-ho a provar.");
    };
  }

  function renderCanviPwd(forcat) {
    app.innerHTML = `<div class="login-fons">${logoHtml("logo-login")}
      <form class="login" id="f-pwd">
        <h1>${forcat ? "Tria una contrasenya nova" : "Canviar contrasenya"}</h1>
        ${forcat ? `<p class="pista">És el primer cop que entres o te l'han restablerta.</p>`
                 : `<label for="p-act">Contrasenya actual</label><input type="password" id="p-act">`}
        <label for="p-nova">Contrasenya nova (mínim 8 caràcters)</label><input type="password" id="p-nova" autocomplete="new-password">
        <label for="p-nova2">Repeteix-la</label><input type="password" id="p-nova2" autocomplete="new-password">
        <div id="p-err" class="error"></div>
        <div class="fila-botons">${forcat ? "" : `<button type="button" id="p-cancel">Cancel·la</button>`}<button class="primari" type="submit">Desa</button></div>
      </form></div>`;
    if (!forcat) $("#p-cancel").onclick = () => renderApp();
    $("#f-pwd").onsubmit = async (ev) => {
      ev.preventDefault(); const err = (t) => { $("#p-err").textContent = t; };
      const nova = $("#p-nova").value;
      if (nova.length < 8) return err("Ha de tenir com a mínim 8 caràcters.");
      if (nova !== $("#p-nova2").value) return err("Les dues contrasenyes no coincideixen.");
      if (!forcat) { const { error } = await sb.auth.signInWithPassword({ email: S.user.email, password: $("#p-act").value }); if (error) return err("La contrasenya actual no és correcta."); }
      const { error } = await sb.auth.updateUser({ password: nova });
      if (error) return err(missatgeError(error));
      await sb.rpc("marca_pwd_canviada"); S.perfil.canviar_pwd = false;
      toast("Contrasenya desada.", "ok");
      if (forcat) { try { await carregaBase(); } catch (e) { /* res */ } }
      renderApp();
    };
  }

  // ------------------------------------------------------------------ estructura
  const PEST_ADMIN = [["revisio", "Revisió"], ["nomina", "Nòmina"], ["estudis", "Per estudi"], ["usuaris", "Usuaris"], ["config", "Configuració"]];
  function renderApp() {
    const adm = !!S.perfil.admin;
    const pest = [["meves", "Les meves despeses"]].concat(adm ? PEST_ADMIN : []);
    if (!pest.some(([k]) => k === S.pestanya)) S.pestanya = adm ? "revisio" : "meves";
    app.innerHTML = `
      <header class="capcalera">
        <div class="marca">${logoHtml("logo-cap")}<span class="titol-app">Despeses de camp</span></div>
        <div class="usuari-info">
          <span class="nom-usuari">${esc(S.perfil.empleat || S.perfil.usuari)}${S.perfil.codi ? ` · ${esc(S.perfil.codi)}` : ""}</span>
          <button class="petit" id="b-pwd">Contrasenya</button>
          <button class="petit perill" id="b-surt">Surt</button>
        </div>
      </header>
      ${pest.length > 1 ? `<nav class="pestanyes">${pest.map(([k, t]) => `<button data-p="${k}" class="${k === S.pestanya ? "activa" : ""}">${t}</button>`).join("")}</nav>` : ""}
      <main id="contingut"></main>`;
    $("#b-pwd").onclick = () => renderCanviPwd(false);
    $("#b-surt").onclick = async () => { await sb.auth.signOut(); S.perfil = null; clearTimeout(temporitzador); renderLogin(); };
    $$(".pestanyes button").forEach((b) => b.onclick = () => { S.pestanya = b.dataset.p; renderApp(); });
    ({ meves: vistaMeves, revisio: vistaRevisio, nomina: vistaNomina, estudis: vistaEstudis, usuaris: vistaUsuaris, config: vistaConfig }[S.pestanya])();
  }
  const etiquetaEstat = (e) => ({
    pendent: `<span class="etiqueta groga">Pendent de revisar</span>`, aprovat: `<span class="etiqueta blava">Aprovat</span>`,
    rebutjat: `<span class="etiqueta vermella">Rebutjat</span>`, liquidat: `<span class="etiqueta verda">Pagat a nòmina</span>`
  }[e] || esc(e));

  // ------------------------------------------------------------------ LES MEVES DESPESES
  async function vistaMeves() {
    $("#contingut").innerHTML = `<div class="buit">Carregant…</div>`;
    try {
      S.fulls = await fetchAll(() => sb.from("fulls_despeses").select("*").eq("user_id", S.user.id)
        .order("data", { ascending: false }).order("id", { ascending: false }));
    } catch (e) { return toast(missatgeError(e), "error"); }
    const suma = (est) => S.fulls.filter((f) => est.includes(f.estat)).reduce((a, f) => a + Number(f.total_a_pagar || 0), 0);
    const mes = avui().slice(0, 7);
    const pagatMes = S.fulls.filter((f) => f.estat === "liquidat" && f.liquidacio === mes).reduce((a, f) => a + Number(f.total_a_pagar || 0), 0);
    $("#contingut").innerHTML = `
      <div class="comptadors">
        <div class="comptador"><div class="c-titol">Pendent de revisar</div><div class="c-valor">${eur(suma(["pendent"]))}</div><div class="c-sub">${S.fulls.filter((f) => f.estat === "pendent").length} fulls</div></div>
        <div class="comptador"><div class="c-titol">Aprovat · propera nòmina</div><div class="c-valor">${eur(suma(["aprovat"]))}</div><div class="c-sub">${S.fulls.filter((f) => f.estat === "aprovat").length} fulls</div></div>
        <div class="comptador"><div class="c-titol">Pagat a la nòmina de ${MESOS[+mes.slice(5) - 1]}</div><div class="c-valor">${eur(pagatMes)}</div><div class="c-sub">&nbsp;</div></div>
      </div>
      <div class="fila-botons" style="margin:0 0 16px"><button class="primari gran" id="b-nou">＋ Nou full de despeses</button></div>
      <section class="targeta">
        <h2>Els meus fulls</h2>
        ${!S.fulls.length ? `<div class="buit">Encara no has enviat cap full de despeses.</div>` : `<div class="llista-fulls">${S.fulls.map((f, i) => `
          <div class="full-item ${f.estat}" data-i="${i}">
            <div class="fi-cap"><b>${fmtData(f.data)}</b> · ${esc(f.projecte)}</div>
            <div class="fi-sub">${esc(f.municipi)}</div>
            <div class="fi-peu"><span>${etiquetaEstat(f.estat)}${f.estat === "liquidat" && f.liquidacio ? ` <span class="pista">${nomMes(f.liquidacio)}</span>` : ""}</span>
              <span class="fi-import">${eur(f.total_a_pagar)}</span></div>
            ${f.estat === "rebutjat" && f.motiu_rebuig ? `<div class="error">Motiu: ${esc(f.motiu_rebuig)} — toca per corregir-lo</div>` : ""}
          </div>`).join("")}</div>`}
      </section>`;
    $("#b-nou").onclick = () => vistaFormulari(null);
    $$(".full-item").forEach((el) => el.onclick = () => {
      const f = S.fulls[+el.dataset.i];
      if (["pendent", "rebutjat"].includes(f.estat)) vistaFormulari(f); else veureFull(f, false);
    });
  }

  function campImport(k, etiqueta, maxTxt = "") {
    return `<div class="camp-import"><label for="c-${k}">${etiqueta}${maxTxt ? ` <span class="pista">${maxTxt}</span>` : ""}</label>
      <div class="input-eur"><input type="text" id="c-${k}" inputmode="decimal" autocomplete="off" placeholder="0,00"><span>€</span></div>
      <div class="a-pagar" id="p-${k}"></div></div>`;
  }

  function vistaFormulari(f) {
    S.editant = f; S.fotosNoves = []; S.fotosEsborrar = [];
    const fotos = f ? (f.fotos || []).slice() : [];
    S._fotosActuals = fotos;
    const t = tarifaDe(f ? f.data : avui());
    $("#contingut").innerHTML = `
      <section class="targeta formulari-despeses">
        <div class="barra-filtres" style="justify-content:space-between;margin-bottom:4px">
          <h2 style="margin:0;border:0">${f ? "Corregir full de despeses" : "Nou full de despeses"}</h2>
          <button id="f-tornar">← Tornar</button>
        </div>
        ${f && f.estat === "rebutjat" ? `<div class="avis-limit passat">Rebutjat: ${esc(f.motiu_rebuig || "")}. Corregeix-lo i torna'l a enviar.</div>` : ""}
        <div class="graella-form">
          <div><label for="f-data">Data de les despeses</label><input type="date" id="f-data" max="${avui()}"></div>
          <div><label for="f-proj">Estudi</label><div class="combo"><input type="text" id="f-proj" autocomplete="off" placeholder="Escriu el nom o el codi…"><ul id="f-proj-ll" class="combo-llista ocult"></ul></div></div>
          <div><label for="f-muni">Municipi</label><div class="combo"><input type="text" id="f-muni" autocomplete="off" placeholder="Escriu el municipi…"><ul id="f-muni-ll" class="combo-llista ocult"></ul></div></div>
        </div>
        <div id="f-criteri"></div>

        <h3 class="seccio">🍽 Dietes</h3>
        <div class="graella-imports">${campImport("esmorzar", "Esmorzar", "màx.")}${campImport("dinar", "Dinar", "màx.")}${campImport("sopar", "Sopar", "màx.")}</div>

        <h3 class="seccio">🚆 Desplaçament</h3>
        <div class="graella-imports">
          ${campImport("transport", "Transport (bitllets)")}
          <div class="camp-import"><label for="c-km">Quilòmetres <span class="pista" id="km-tarifa"></span></label>
            <div class="input-eur"><input type="text" id="c-km" inputmode="decimal" autocomplete="off" placeholder="0"><span>km</span></div>
            <div class="a-pagar" id="p-km"></div></div>
          ${campImport("aparcament", "Aparcament")}${campImport("autopistes", "Autopistes")}
        </div>

        <h3 class="seccio">🏨 Hotel</h3>
        <div class="graella-imports">
          ${campImport("hotel", "Hotel (total)", "màx.")}
          <div class="camp-import"><label for="c-nits">Nits</label><div class="input-eur"><input type="number" id="c-nits" min="1" max="60" step="1" inputmode="numeric" placeholder="1"><span>nits</span></div></div>
          ${campImport("impost_turistic", "Impost turístic")}
        </div>
        <div class="pista">La factura de l'hotel ha d'anar a nom de: ${esc(C.DADES_FACTURA || "")}</div>

        <h3 class="seccio">📎 Altres</h3>
        <div class="graella-imports">${campImport("altres", "Altres despeses")}
          <div class="camp-import" style="grid-column: span 2"><label for="c-altres-concepte">Concepte</label><input type="text" id="c-altres-concepte" maxlength="200" placeholder="p. ex. impressió de cartes"></div></div>

        <h3 class="seccio">📷 Fotos</h3>
        <div class="zones-fotos">
          <div class="zona-foto" data-tipus="tiquet"><div class="zf-titol">Tiquets</div>
            <label class="boto-foto">📷 Fer foto / afegir<input type="file" accept="image/*,application/pdf" capture="environment" multiple hidden></label><div class="miniatures"></div></div>
          <div class="zona-foto" data-tipus="km"><div class="zf-titol">Comptaquilòmetres</div>
            <label class="boto-foto">📷 Fer foto<input type="file" accept="image/*" capture="environment" multiple hidden></label><div class="miniatures"></div></div>
          <div class="zona-foto" data-tipus="hotel"><div class="zf-titol">Factura de l'hotel</div>
            <label class="boto-foto">📷 Fer foto / PDF<input type="file" accept="image/*,application/pdf" capture="environment" multiple hidden></label><div class="miniatures"></div></div>
        </div>

        <label for="f-obs">Observacions</label>
        <textarea id="f-obs" maxlength="1000" style="min-height:70px;font-family:inherit"></textarea>

        <div class="resum-full" id="f-resum"></div>
        <div class="fila-botons">
          <button class="primari gran" id="f-envia">${f ? "Desa i torna a enviar" : "Envia el full"}</button>
          ${f ? `<button class="perill" id="f-esborra">Esborra</button>` : ""}
        </div>
      </section>`;

    // valors inicials
    $("#f-data").value = f ? f.data : avui();
    $("#f-proj").value = f ? f.projecte : "";
    $("#f-muni").value = f ? f.municipi : "";
    CONCEPTES.forEach(([k]) => { if (f && f[k] != null) $(`#c-${k}`).value = fmtInput(f[k]); });
    $("#c-nits").value = f && f.hotel_nits ? f.hotel_nits : "";
    $("#c-altres-concepte").value = f ? (f.altres_concepte || "") : "";
    $("#f-obs").value = f ? (f.observacions || "") : "";
    S._jornada = f ? f.jornada_completa : false; S._foraNucli = f ? f.fora_nucli : false;

    initCombo($("#f-proj"), $("#f-proj-ll"), () => S.projectes, () => $("#f-muni").focus(), "Cap estudi coincideix");
    initCombo($("#f-muni"), $("#f-muni-ll"), MUNICIPIS, () => { actualitza(); }, "Cap municipi coincideix");
    $("#f-tornar").onclick = () => vistaMeves();
    $$("input, textarea", $(".formulari-despeses")).forEach((el) => el.addEventListener("input", actualitza));
    $("#f-data").addEventListener("change", actualitza);
    $("#f-muni").addEventListener("change", actualitza);
    $$(".zona-foto input[type=file]").forEach((inp) => inp.addEventListener("change", async (e) => {
      const tipus = e.target.closest(".zona-foto").dataset.tipus;
      for (const file of Array.from(e.target.files || [])) {
        const c = await comprimeix(file);
        S.fotosNoves.push({ file: c, tipus, nom: file.name, preview: c.type.startsWith("image/") ? URL.createObjectURL(c) : null });
      }
      e.target.value = ""; pintaFotos(); actualitza();
    }));
    $("#f-envia").onclick = enviaFull;
    if (f) $("#f-esborra").onclick = async () => {
      if (!await confirma("Esborrar full", `Segur que vols esborrar el full del ${fmtData(f.data)}?`, "Esborra", "perill")) return;
      const { error } = await sb.from("fulls_despeses").delete().eq("id", f.id);
      if (error) return toast(missatgeError(error), "error");
      const paths = (f.fotos || []).map((x) => x.path);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      toast("Full esborrat.", "ok"); vistaMeves();
    };
    pintaFotos(); actualitza();
    window.scrollTo({ top: 0 });
  }

  function llegeixFormulari() {
    const f = {
      data: $("#f-data").value, projecte: $("#f-proj").value.trim(), municipi: $("#f-muni").value.trim(),
      jornada_completa: !!S._jornada, fora_nucli: !!S._foraNucli,
      hotel_nits: $("#c-nits").value ? parseInt($("#c-nits").value, 10) : null,
      altres_concepte: $("#c-altres-concepte").value.trim() || null, observacions: $("#f-obs").value.trim() || null
    };
    const errors = [];
    CONCEPTES.forEach(([k, nom]) => {
      const v = k === "km" ? parseKm($(`#c-${k}`).value) : parseImport($(`#c-${k}`).value);
      if (Number.isNaN(v)) errors.push(`${nom}: import no vàlid`); else f[k] = v;
    });
    return { f, errors };
  }

  function actualitza() {
    const { f } = llegeixFormulari();
    const r = calcula(f);
    // criteri del municipi
    let html = "";
    if (f.municipi) {
      if (r.c && r.c.sense_desplacament) html += `<div class="avis-criteri">🚫 Municipi de l'AMB: <b>no es paga desplaçament</b>.</div>`;
      if (r.c && r.c.sense_dieta) {
        html += `<div class="avis-criteri">🚫 Hi arriba el metro: <b>no es paga dieta</b>.</div>`;
        if (r.c.nota) html += `<label class="check gran"><input type="checkbox" id="f-fora" ${S._foraNucli ? "checked" : ""}> He treballat fora del nucli urbà <span class="pista">(${esc(r.c.nota)})</span></label>`;
      } else {
        html += `<label class="check gran"><input type="checkbox" id="f-jornada" ${S._jornada ? "checked" : ""}> He fet jornada de <b>matí i tarda</b> <span class="pista">(necessari per cobrar dietes)</span></label>`;
      }
    }
    const cont = $("#f-criteri");
    if (cont.dataset.html !== html) {
      cont.innerHTML = html; cont.dataset.html = html;
      const j = $("#f-jornada"); if (j) j.onchange = () => { S._jornada = j.checked; actualitza(); };
      const fo = $("#f-fora"); if (fo) fo.onchange = () => { S._foraNucli = fo.checked; actualitza(); };
    }
    // màxims i "a pagar" per concepte
    const t = r.t;
    const maxims = { esmorzar: t.esmorzar, dinar: t.dinar, sopar: t.sopar };
    Object.entries(maxims).forEach(([k, m]) => { const lab = $(`label[for=c-${k}] .pista`); if (lab) lab.textContent = `màx. ${eur(m)}`; });
    const labH = $("label[for=c-hotel] .pista"); if (labH) labH.textContent = `màx. ${eur(t.hotel)}/nit`; else $("label[for=c-hotel]").insertAdjacentHTML("beforeend", ` <span class="pista">màx. ${eur(t.hotel)}/nit</span>`);
    $("#km-tarifa").textContent = `${String(t.km).replace(".", ",")} €/km`;
    CONCEPTES.forEach(([k]) => {
      const el = $(`#p-${k}`); if (!el) return;
      const tiquet = r.tiquet[k], pag = r.pag[k];
      el.className = "a-pagar";
      if (!tiquet) { el.textContent = ""; return; }
      if (k === "km") { el.innerHTML = pag ? `= ${eur(pag)}` : `<span class="no">No es paga</span>`; if (!pag) el.classList.add("zero"); return; }
      if (pag === tiquet) el.textContent = `Cobraràs ${eur(pag)}`;
      else if (pag === 0) { el.innerHTML = `<span class="no">No es paga</span>`; el.classList.add("zero"); }
      else { el.innerHTML = `Cobraràs ${eur(pag)} <span class="pista">(màxim)</span>`; el.classList.add("parcial"); }
    });
    // zones de fotos visibles segons el que s'ha omplert
    $(".zona-foto[data-tipus=km]").classList.toggle("ocult", !(Number(f.km) > 0) && !teFotos("km"));
    $(".zona-foto[data-tipus=hotel]").classList.toggle("ocult", !(Number(f.hotel) > 0) && !teFotos("hotel"));
    // resum
    const avisos = avisosClient(f, r);
    $("#f-resum").innerHTML = `
      <div class="rf-totals"><div>Total tiquets <b>${eur(r.totalTiquets)}</b></div><div class="rf-pagar">A cobrar <b>${eur(r.total)}</b></div></div>
      ${avisos.length ? `<ul class="rf-avisos">${avisos.map((a) => `<li>⚠ ${esc(a)}</li>`).join("")}</ul>` : ""}`;
  }
  const teFotos = (tipus) => S._fotosActuals.some((x) => x.tipus === tipus) || S.fotosNoves.some((x) => x.tipus === tipus);
  function avisosClient(f, r) {
    const a = [], v = (k) => Number(f[k]) || 0;
    if ((v("esmorzar") + v("dinar") + v("sopar") + v("transport") + v("aparcament") + v("autopistes") + v("altres")) > 0 && !teFotos("tiquet")) a.push("Afegeix la foto dels tiquets");
    if (v("km") > 0 && !teFotos("km")) a.push("Afegeix la foto del comptaquilòmetres");
    if (v("hotel") > 0 && !teFotos("hotel")) a.push("Afegeix la factura de l'hotel");
    if (v("altres") > 0 && !f.altres_concepte) a.push("Indica el concepte d'\"Altres despeses\"");
    if (f.municipi && !MUNICIPIS().includes(f.municipi)) a.push("Tria el municipi de la llista");
    if (!r.dietaOk && (v("esmorzar") + v("dinar") + v("sopar")) > 0 && !(r.c && r.c.sense_dieta)) a.push("Sense jornada de matí i tarda no es paga dieta");
    return a;
  }
  function pintaFotos() {
    $$(".zona-foto").forEach((z) => {
      const tipus = z.dataset.tipus;
      const act = S._fotosActuals.map((x, i) => ({ ...x, i })).filter((x) => x.tipus === tipus);
      const nov = S.fotosNoves.map((x, i) => ({ ...x, i })).filter((x) => x.tipus === tipus);
      $(".miniatures", z).innerHTML =
        act.map((x) => `<div class="mini" data-act="${x.i}"><span class="mini-doc">${/\.pdf$/i.test(x.path) ? "PDF" : "📷"}</span><button type="button" class="mini-x" title="Treu">×</button></div>`).join("") +
        nov.map((x) => `<div class="mini" data-nov="${x.i}">${x.preview ? `<img src="${x.preview}" alt="">` : `<span class="mini-doc">PDF</span>`}<button type="button" class="mini-x" title="Treu">×</button></div>`).join("");
      // previsualització de les fotos ja pujades
      act.forEach(async (x) => { if (/\.pdf$/i.test(x.path)) return; try { const u = await urlFoto(x.path); const el = $(`.mini[data-act="${x.i}"]`, z); if (el) el.insertAdjacentHTML("afterbegin", `<img src="${u}" alt="">`); const d = el && $(".mini-doc", el); if (d) d.remove(); } catch (e) { /* res */ } });
    });
    $$(".mini-x").forEach((b) => b.onclick = (e) => {
      e.preventDefault(); const m = b.closest(".mini");
      if (m.dataset.nov != null) S.fotosNoves.splice(+m.dataset.nov, 1);
      else { const [x] = S._fotosActuals.splice(+m.dataset.act, 1); S.fotosEsborrar.push(x.path); }
      pintaFotos(); actualitza();
    });
  }

  async function enviaFull() {
    const { f, errors } = llegeixFormulari();
    if (!f.data) errors.push("Falta la data");
    if (f.data > avui()) errors.push("La data no pot ser futura");
    if (!f.projecte) errors.push("Falta l'estudi"); else if (!S.projectes.includes(f.projecte)) errors.push("Tria l'estudi de la llista");
    if (!f.municipi) errors.push("Falta el municipi");
    const r = calcula(f);
    if (!errors.length && r.totalTiquets <= 0) errors.push("No has posat cap import");
    if (errors.length) return toast(errors.join(" · "), "error");
    // imports sospitosos (p. ex. 850 en lloc de 8,50)
    const t = r.t, raros = [];
    [["esmorzar", t.esmorzar], ["dinar", t.dinar], ["sopar", t.sopar]].forEach(([k, m]) => { if ((Number(f[k]) || 0) > m * 4) raros.push(`${k} ${eur(f[k])}`); });
    if ((Number(f.km) || 0) > 600) raros.push(`${f.km} km`);
    if (raros.length && !await confirma("Revisa els imports", `Has posat <b>${esc(raros.join(", "))}</b>. És correcte? Si volies posar cèntims, recorda la coma (p. ex. 8,50).`, "Sí, és correcte", "primari", "Corregir")) return;
    const falten = avisosClient(f, r).filter((a) => a.startsWith("Afegeix"));
    if (falten.length && !await confirma("Falten fotos", `${esc(falten.join(". "))}. Sense foto el full pot quedar retingut a revisió. Vols enviar-lo igualment?`, "Envia igualment", "primari", "Afegir fotos")) return;

    const btn = $("#f-envia"); btn.disabled = true; btn.textContent = "Enviant…";
    try {
      // 1) puja les fotos noves
      const pujades = [];
      for (const [n, x] of S.fotosNoves.entries()) {
        btn.textContent = `Pujant fotos ${n + 1}/${S.fotosNoves.length}…`;
        const ext = (x.file.type === "application/pdf") ? "pdf" : (x.file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const path = `${S.user.id}/${f.data}_${Date.now()}_${n}.${ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, x.file, { contentType: x.file.type, upsert: false });
        if (error) throw error;
        pujades.push({ path, tipus: x.tipus, nom: x.nom });
      }
      f.fotos = S._fotosActuals.map(({ path, tipus, nom }) => ({ path, tipus, nom })).concat(pujades);
      // 2) desa el full
      const q = S.editant ? sb.from("fulls_despeses").update(f).eq("id", S.editant.id).select()
                          : sb.from("fulls_despeses").insert(f).select();
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) throw new Error("No s'ha pogut desar (potser ja està revisat).");
      // 3) esborra les fotos tretes
      if (S.fotosEsborrar.length) await sb.storage.from(BUCKET).remove(S.fotosEsborrar);
      const d = data[0];
      toast(`Full enviat. A cobrar: ${eur(d.total_a_pagar)}`, "ok");
      vistaMeves();
    } catch (e) {
      btn.disabled = false; btn.textContent = S.editant ? "Desa i torna a enviar" : "Envia el full";
      toast(missatgeError(e), "error");
    }
  }

  // Vista d'un full (lectura) — per a l'enquestador/a i per a la revisió
  function taulaConceptes(f) {
    const files = CONCEPTES.filter(([k]) => Number(f[k]) > 0).map(([k, nom]) => {
      const tiquet = k === "km" ? `${String(f.km).replace(".", ",")} km` : eur(f[k]);
      return `<tr><td>${nom}${k === "hotel" && f.hotel_nits ? ` (${f.hotel_nits} nits)` : ""}${k === "altres" && f.altres_concepte ? `<div class="pista">${esc(f.altres_concepte)}</div>` : ""}</td>
        <td class="num">${tiquet}</td><td class="num"><b>${eur(f["pag_" + k])}</b></td></tr>`;
    }).join("");
    return `<table class="taula-conceptes"><thead><tr><th>Concepte</th><th class="num">Tiquet</th><th class="num">A pagar</th></tr></thead><tbody>${files}
      ${Number(f.ajust) ? `<tr><td>Ajust${f.ajust_motiu ? `<div class="pista">${esc(f.ajust_motiu)}</div>` : ""}</td><td></td><td class="num"><b>${eur(f.ajust)}</b></td></tr>` : ""}
      </tbody><tfoot><tr><td><b>Total</b></td><td class="num">${eur(f.total_tiquets)}</td><td class="num"><b>${eur(f.total_a_pagar)}</b></td></tr></tfoot></table>`;
  }
  async function galeria(f) {
    const fotos = f.fotos || [];
    if (!fotos.length) return `<div class="pista">Sense fotos.</div>`;
    const items = await Promise.all(fotos.map(async (x) => {
      try { const u = await urlFoto(x.path); return { ...x, u }; } catch (e) { return { ...x, u: null }; }
    }));
    const nomT = { tiquet: "Tiquet", km: "Comptaquilòmetres", hotel: "Factura hotel" };
    return `<div class="galeria">${items.map((x) => `<a class="gal-item" ${x.u ? `href="${x.u}" target="_blank" rel="noopener"` : ""}>
      ${x.u && !/\.pdf$/i.test(x.path) ? `<img src="${x.u}" alt="">` : `<span class="mini-doc">${/\.pdf$/i.test(x.path) ? "PDF" : "?"}</span>`}
      <span class="gal-peu">${nomT[x.tipus] || x.tipus}</span></a>`).join("")}</div>`;
  }
  async function veureFull(f) {
    modal(`Full del ${fmtData(f.data)}`, `<div class="buit">Carregant…</div>`, [{ text: "Tanca" }], true);
    $("#modal-cos").innerHTML = `<p>${esc(f.projecte)} · ${esc(f.municipi)} · ${etiquetaEstat(f.estat)}${f.liquidacio ? ` · nòmina de ${nomMes(f.liquidacio)}` : ""}</p>
      ${taulaConceptes(f)}${f.observacions ? `<p><b>Observacions:</b> ${esc(f.observacions)}</p>` : ""}${await galeria(f)}`;
  }

  // ------------------------------------------------------------------ ADMIN · comú
  async function carregaUsuaris() {
    const { data, error } = await sb.from("perfils").select("*").order("empleat");
    if (error) throw error; S.usuaris = data; return data;
  }
  const nomP = (p) => p ? (p.empleat || p.usuari) : "";
  const primerMes = () => avui().slice(0, 8) + "01";
  function filtreDates(prefix, d) {
    return `<div><label for="${prefix}-desde">Des de</label><input type="date" id="${prefix}-desde" value="${d.desde}"></div>
      <div><label for="${prefix}-fins">Fins a</label><input type="date" id="${prefix}-fins" value="${d.fins}"></div>`;
  }
  const chipsAvisos = (av) => (av || []).map((a) => `<span class="chip ${AVISOS_GREUS.includes(a) ? "greu" : ""}" title="${esc(AVISOS[a] || a)}">${esc(AVISOS[a] || a)}</span>`).join(" ");

  // Esborra un full i les seves fotos (admin)
  async function esborraFull(f) {
    const pagat = f.estat === "liquidat";
    const ok = await confirma("Esborrar full",
      `Segur que vols esborrar el full de <b>${esc(nomP(f.perfils))}</b> del ${fmtData(f.data)} (${esc(f.projecte)}, ${eur(f.total_a_pagar)})?` +
      (pagat ? `<br><br><b>Atenció:</b> aquest full ja consta com a pagat a la nòmina de ${nomMes(f.liquidacio)}.` : "") +
      `<br><br>S'esborraran també les seves fotos. No es pot desfer.`, "Esborra", "perill");
    if (!ok) return false;
    const { data, error } = await sb.from("fulls_despeses").delete().eq("id", f.id).select("id");
    if (error) { toast(missatgeError(error), "error"); return false; }
    if (!data || !data.length) { toast("No s'ha pogut esborrar.", "error"); return false; }
    const paths = (f.fotos || []).map((x) => x.path);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    toast("Full esborrat.", "ok");
    return true;
  }

  // ------------------------------------------------------------------ ADMIN · revisió
  async function vistaRevisio() {
    S.rev = S.rev || { estat: "pendent", desde: "2020-01-01", fins: avui(), persona: "", projecte: "", nomesAvisos: false, sel: new Set() };
    try { await carregaUsuaris(); } catch (e) { return toast(missatgeError(e), "error"); }
    const R = S.rev;
    $("#contingut").innerHTML = `
      <section class="targeta">
        <div class="barra-filtres">
          <div><label for="r-estat">Estat</label><select id="r-estat">${[["pendent", "Pendents de revisar"], ["aprovat", "Aprovats (no pagats)"], ["rebutjat", "Rebutjats"], ["liquidat", "Pagats a nòmina"], ["", "Tots"]].map(([k, t]) => `<option value="${k}" ${R.estat === k ? "selected" : ""}>${t}</option>`).join("")}</select></div>
          ${filtreDates("r", R)}
          <div style="min-width:220px"><label for="r-persona">Persona</label><select id="r-persona"><option value="">Totes</option>${S.usuaris.map((u) => `<option value="${u.id}" ${R.persona === u.id ? "selected" : ""}>${esc(nomP(u))}${u.codi ? ` (${esc(u.codi)})` : ""}</option>`).join("")}</select></div>
          <div style="min-width:240px"><label for="r-proj">Estudi</label><select id="r-proj"><option value="">Tots</option>${S.projectes.map((p) => `<option ${R.projecte === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
          <label class="check"><input type="checkbox" id="r-avisos" ${R.nomesAvisos ? "checked" : ""}> Només amb avisos</label>
        </div>
        <div id="r-resum" class="resum"></div>
        <div class="fila-botons" style="margin:0 0 10px"><button class="verd" id="r-aprova-sel" disabled>✓ Aprova els seleccionats</button>
          <button id="r-sel-net">Selecciona els que no tenen avisos greus</button></div>
        <div class="taula-cont" id="r-taula"><div class="buit">Carregant…</div></div>
      </section>`;
    const refresca = async () => {
      R.estat = $("#r-estat").value; R.desde = $("#r-desde").value; R.fins = $("#r-fins").value;
      R.persona = $("#r-persona").value; R.projecte = $("#r-proj").value; R.nomesAvisos = $("#r-avisos").checked;
      try {
        R.fulls = await fetchAll(() => {
          let q = sb.from("fulls_despeses").select("*, perfils(usuari, empleat, codi)").gte("data", R.desde).lte("data", R.fins);
          if (R.estat) q = q.eq("estat", R.estat);
          if (R.persona) q = q.eq("user_id", R.persona);
          if (R.projecte) q = q.eq("projecte", R.projecte);
          return q.order("data").order("id");
        });
      } catch (e) { return toast(missatgeError(e), "error"); }
      let d = R.fulls; if (R.nomesAvisos) d = d.filter((f) => (f.avisos || []).length);
      R.vistos = d; R.sel = new Set([...R.sel].filter((id) => d.some((f) => f.id === id)));
      const tot = d.reduce((a, f) => a + Number(f.total_a_pagar || 0), 0);
      $("#r-resum").innerHTML = `<b>${d.length}</b> fulls · a pagar <b>${eur(tot)}</b> · ${d.filter((f) => (f.avisos || []).some((a) => AVISOS_GREUS.includes(a))).length} amb avisos a revisar`;
      $("#r-taula").innerHTML = !d.length ? `<div class="buit">No hi ha fulls amb aquests filtres.</div>` : `
        <table><thead><tr><th><input type="checkbox" id="r-tots"></th><th>Data</th><th>Persona</th><th>Estudi</th><th>Municipi</th>
          <th class="num">Tiquets</th><th class="num">A pagar</th><th>Avisos</th><th>Estat</th><th></th></tr></thead><tbody>
        ${d.map((f) => `<tr>
          <td>${f.estat === "pendent" ? `<input type="checkbox" class="r-sel" value="${f.id}" ${R.sel.has(f.id) ? "checked" : ""}>` : ""}</td>
          <td>${fmtData(f.data)}</td><td>${esc(nomP(f.perfils))}${f.perfils && f.perfils.codi ? `<div class="pista">${esc(f.perfils.codi)}</div>` : ""}</td>
          <td>${esc(f.projecte)}</td><td>${esc(f.municipi)}</td>
          <td class="num">${eur(f.total_tiquets)}</td><td class="num"><b>${eur(f.total_a_pagar)}</b></td>
          <td class="avisos-cel">${chipsAvisos(f.avisos)}</td><td>${etiquetaEstat(f.estat)}</td>
          <td class="accions"><button class="petit primari" data-id="${f.id}">Obre</button>
            <button class="petit perill" data-esborra="${f.id}" title="Esborra">🗑</button></td></tr>`).join("")}
        </tbody></table>`;
      const actBoto = () => { $("#r-aprova-sel").disabled = !R.sel.size; $("#r-aprova-sel").textContent = `✓ Aprova els seleccionats${R.sel.size ? ` (${R.sel.size})` : ""}`; };
      $$(".r-sel").forEach((c) => c.onchange = () => { c.checked ? R.sel.add(+c.value) : R.sel.delete(+c.value); actBoto(); });
      const tots = $("#r-tots"); if (tots) tots.onchange = () => { $$(".r-sel").forEach((c) => { c.checked = tots.checked; c.checked ? R.sel.add(+c.value) : R.sel.delete(+c.value); }); actBoto(); };
      $$("#r-taula button[data-id]").forEach((b) => b.onclick = () => obreRevisio(R.vistos.find((f) => f.id === +b.dataset.id), refresca));
      $$("#r-taula button[data-esborra]").forEach((b) => b.onclick = async () => {
        const f = R.vistos.find((x) => x.id === +b.dataset.esborra);
        if (await esborraFull(f)) { R.sel.delete(f.id); refresca(); }
      });
      actBoto();
    };
    $$("#r-estat, #r-desde, #r-fins, #r-persona, #r-proj, #r-avisos").forEach((el) => el.onchange = refresca);
    $("#r-sel-net").onclick = () => {
      (R.vistos || []).filter((f) => f.estat === "pendent" && !(f.avisos || []).some((a) => AVISOS_GREUS.includes(a))).forEach((f) => R.sel.add(f.id));
      $$(".r-sel").forEach((c) => { c.checked = R.sel.has(+c.value); });
      $("#r-aprova-sel").disabled = !R.sel.size; $("#r-aprova-sel").textContent = `✓ Aprova els seleccionats (${R.sel.size})`;
    };
    $("#r-aprova-sel").onclick = async () => {
      const ids = [...R.sel];
      if (!await confirma("Aprovar", `S'aprovaran <b>${ids.length}</b> fulls.`, "Aprova", "verd")) return;
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from("fulls_despeses").update({ estat: "aprovat", revisat: new Date().toISOString(), motiu_rebuig: null }).in("id", ids.slice(i, i + 200));
        if (error) return toast(missatgeError(error), "error");
      }
      R.sel.clear(); toast(`${ids.length} fulls aprovats.`, "ok"); refresca();
    };
    refresca();
  }

  async function obreRevisio(f, despres) {
    modal(`${nomP(f.perfils)} · ${fmtData(f.data)}`, `<div class="buit">Carregant…</div>`, [{ text: "Tanca" }], true);
    const gal = await galeria(f);
    $("#modal-cos").innerHTML = `
      <p><b>${esc(f.projecte)}</b> · ${esc(f.municipi)} · ${etiquetaEstat(f.estat)}
        <br><span class="pista">${f.jornada_completa ? "Jornada de matí i tarda" : "Sense jornada de matí i tarda"}${f.fora_nucli ? " · Fora del nucli urbà" : ""} · Enviat ${fmtData(String(f.creat).slice(0, 10))}</span></p>
      ${(f.avisos || []).length ? `<ul class="rf-avisos">${f.avisos.map((a) => `<li>⚠ ${esc(AVISOS[a] || a)}</li>`).join("")}</ul>` : ""}
      ${taulaConceptes(f)}
      ${f.observacions ? `<p><b>Observacions:</b> ${esc(f.observacions)}</p>` : ""}
      ${gal}
      ${f.estat !== "liquidat" ? `<div class="dues" style="margin-top:12px">
        <div><label for="m-ajust">Ajust manual (€, + o −)</label><input type="text" id="m-ajust" inputmode="decimal" value="${Number(f.ajust) ? fmtInput(f.ajust) : ""}" placeholder="0,00"></div>
        <div><label for="m-ajust-motiu">Motiu de l'ajust</label><input type="text" id="m-ajust-motiu" value="${esc(f.ajust_motiu || "")}"></div></div>
        <label for="m-motiu">Motiu del rebuig (si el rebutges)</label><input type="text" id="m-motiu" value="${esc(f.motiu_rebuig || "")}">` : ""}`;
    const llegeixAjust = () => {
      const raw = String($("#m-ajust").value || "").trim(); const neg = raw.startsWith("-");
      const v = parseImport(raw.replace(/^[-+]/, "")); return v == null ? 0 : (Number.isNaN(v) ? NaN : (neg ? -v : v));
    };
    const desa = async (canvis) => {
      const { error } = await sb.from("fulls_despeses").update(canvis).eq("id", f.id);
      if (error) { toast(missatgeError(error), "error"); return false; }
      despres && despres();
    };
    const botons = [{ text: "Tanca" }, { text: "🗑 Esborra", cls: "perill", onClick: async () => {
      if (await esborraFull(f)) { despres && despres(); return true; }
      return false;
    } }];
    if (f.estat !== "liquidat") {
      botons.push({ text: "Rebutja", cls: "perill", onClick: async () => {
        const motiu = $("#m-motiu").value.trim();
        if (!motiu) { toast("Escriu el motiu del rebuig: l'enquestador/a el veurà.", "error"); $("#m-motiu").focus(); return false; }
        return desa({ estat: "rebutjat", motiu_rebuig: motiu, revisat: new Date().toISOString() });
      } });
      if (f.estat !== "pendent") botons.push({ text: "Torna a pendent", onClick: () => desa({ estat: "pendent", revisat: null }) });
      botons.push({ text: f.estat === "aprovat" ? "Desa l'ajust" : "✓ Aprova", cls: "verd", onClick: async () => {
        const aj = llegeixAjust(); if (Number.isNaN(aj)) { toast("Ajust no vàlid.", "error"); return false; }
        if (aj && !$("#m-ajust-motiu").value.trim()) { toast("Indica el motiu de l'ajust.", "error"); return false; }
        return desa({ estat: "aprovat", ajust: aj, ajust_motiu: $("#m-ajust-motiu").value.trim() || null, motiu_rebuig: null, revisat: new Date().toISOString() });
      } });
    }
    const cont = $("#modal-botons"); cont.innerHTML = "";
    botons.forEach((b) => { const el = document.createElement("button"); el.textContent = b.text; if (b.cls) el.className = b.cls;
      const meu = modalId; el.onclick = async () => { if (b.onClick) { const r = await b.onClick(); if (r === false) return; } if (meu === modalId) tancaModal(); }; cont.appendChild(el); });
  }

  // ------------------------------------------------------------------ ADMIN · nòmina
  async function vistaNomina() {
    S.nom = S.nom || { fins: avui(), mes: avui().slice(0, 7) };
    const N = S.nom;
    $("#contingut").innerHTML = `
      <div class="graella">
        <section class="targeta">
          <h2>Preparar la nòmina</h2>
          <p class="pista">Inclou tots els fulls <b>aprovats</b> que encara no s'han pagat.</p>
          <label for="n-fins">Despeses fins a</label><input type="date" id="n-fins" value="${N.fins}">
          <label for="n-mes">Nòmina del mes</label><input type="month" id="n-mes" value="${N.mes}">
          <div class="fila-botons"><button class="verd" id="n-excel">⬇ Descarrega l'Excel per a nòmina</button></div>
          <div class="fila-botons"><button class="primari" id="n-liquida">Marca com a pagats en aquesta nòmina</button></div>
          <p class="pista">Primer descarrega l'Excel i, quan la nòmina estigui feta, marca'ls com a pagats: deixaran de sortir aquí i l'enquestador/a ho veurà com a "Pagat a nòmina".</p>
          <hr>
          <label for="n-hist">Consultar una nòmina ja feta</label>
          <div class="dues"><input type="month" id="n-hist" value="${N.mes}"><button id="n-hist-b">Descarrega</button></div>
        </section>
        <section class="targeta"><div id="n-resum" class="resum"></div><div class="taula-cont" id="n-taula"><div class="buit">Carregant…</div></div></section>
      </div>`;
    const carrega = async () => {
      N.fins = $("#n-fins").value; N.mes = $("#n-mes").value;
      try { N.fulls = await fetchAll(() => sb.from("fulls_despeses").select("*, perfils(usuari, empleat, codi)").eq("estat", "aprovat").lte("data", N.fins).order("data")); }
      catch (e) { return toast(missatgeError(e), "error"); }
      const per = agrupaPersones(N.fulls);
      const tot = per.reduce((a, p) => a + p.total, 0);
      $("#n-resum").innerHTML = `<b>${per.length}</b> persones · <b>${N.fulls.length}</b> fulls · total <b>${eur(tot)}</b>`;
      $("#n-taula").innerHTML = !per.length ? `<div class="buit">No hi ha fulls aprovats pendents de pagar.</div>` : `
        <table><thead><tr><th>Entrevistador/a</th><th>Codi</th><th>Estudis</th><th class="num">Fulls</th><th class="num">Import</th></tr></thead><tbody>
        ${per.map((p) => `<tr><td>${esc(p.nom)}</td><td>${esc(p.codi)}</td><td>${p.estudis.map((e) => `${esc(e.projecte)}: <b>${eur(e.total)}</b>`).join("<br>")}</td>
          <td class="num">${p.n}</td><td class="num"><b>${eur(p.total)}</b></td></tr>`).join("")}
        </tbody><tfoot><tr><td colspan="4"><b>Total</b></td><td class="num"><b>${eur(tot)}</b></td></tr></tfoot></table>`;
    };
    $$("#n-fins, #n-mes").forEach((el) => el.onchange = carrega);
    $("#n-excel").onclick = () => { if (!N.fulls || !N.fulls.length) return toast("No hi ha res per pagar.", "error"); excelNomina(N.fulls, N.mes); };
    $("#n-liquida").onclick = async () => {
      if (!N.fulls || !N.fulls.length) return toast("No hi ha res per pagar.", "error");
      const tot = N.fulls.reduce((a, f) => a + Number(f.total_a_pagar || 0), 0);
      if (!await confirma("Marcar com a pagats", `Es marcaran <b>${N.fulls.length}</b> fulls (${eur(tot)}) com a pagats a la nòmina de <b>${nomMes(N.mes)}</b>.`, "Marca com a pagats", "primari")) return;
      const ids = N.fulls.map((f) => f.id), ara = new Date().toISOString();
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from("fulls_despeses").update({ estat: "liquidat", liquidacio: N.mes, liquidat: ara }).in("id", ids.slice(i, i + 200));
        if (error) return toast(missatgeError(error), "error");
      }
      toast(`${ids.length} fulls marcats com a pagats (${nomMes(N.mes)}).`, "ok"); carrega();
    };
    $("#n-hist-b").onclick = async () => {
      const mes = $("#n-hist").value; let fulls;
      try { fulls = await fetchAll(() => sb.from("fulls_despeses").select("*, perfils(usuari, empleat, codi)").eq("estat", "liquidat").eq("liquidacio", mes).order("data")); }
      catch (e) { return toast(missatgeError(e), "error"); }
      if (!fulls.length) return toast(`No hi ha cap full pagat a la nòmina de ${nomMes(mes)}.`, "error");
      excelNomina(fulls, mes);
    };
    carrega();
  }
  function agrupaPersones(fulls) {
    const m = new Map();
    fulls.forEach((f) => {
      const k = f.user_id;
      if (!m.has(k)) m.set(k, { nom: nomP(f.perfils), codi: (f.perfils && f.perfils.codi) || "", total: 0, n: 0, est: new Map() });
      const p = m.get(k); p.total += Number(f.total_a_pagar || 0); p.n++;
      p.est.set(f.projecte, (p.est.get(f.projecte) || 0) + Number(f.total_a_pagar || 0));
    });
    return [...m.values()].map((p) => ({ ...p, total: Math.round(p.total * 100) / 100,
      estudis: [...p.est.entries()].map(([projecte, total]) => ({ projecte, total: Math.round(total * 100) / 100 })) }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "ca"));
  }
  function fullEuros(ws, cols, desde = 1) {
    const rang = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = desde; r <= rang.e.r; r++) cols.forEach((c) => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && typeof cell.v === "number") cell.z = "#,##0.00 €"; });
  }
  function excelNomina(fulls, mes) {
    const per = agrupaPersones(fulls);
    const wb = XLSX.utils.book_new();
    const resum = [["Entrevistador/a", "Codi", "Import"]].concat(per.map((p) => [p.nom, p.codi, p.total]));
    resum.push(["TOTAL", "", Math.round(per.reduce((a, p) => a + p.total, 0) * 100) / 100]);
    const ws1 = XLSX.utils.aoa_to_sheet(resum); fullEuros(ws1, [2]); ws1["!cols"] = [{ wch: 34 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Resum nòmina");
    // mateix format que el quadre del correu: Entrevistador / Import / Concepte / Data
    const dataEnv = fmtData(avui());
    const correu = [["Entrevistador", "Import", "Concepte", "Data"]];
    per.forEach((p) => p.estudis.forEach((e) => correu.push([p.nom, e.total, `Dietes i transport - ${e.projecte}`, dataEnv])));
    const ws2 = XLSX.utils.aoa_to_sheet(correu); fullEuros(ws2, [1]); ws2["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 60 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Per persona i estudi");
    const cap = ["Data", "Entrevistador/a", "Codi", "Estudi", "Municipi"].concat(CONCEPTES.map(([, n]) => n)).concat(["Ajust", "Motiu ajust", "Total tiquets", "A pagar", "Estat", "Nòmina"]);
    const det = [cap].concat(fulls.map((f) => [fmtData(f.data), nomP(f.perfils), (f.perfils && f.perfils.codi) || "", f.projecte, f.municipi]
      .concat(CONCEPTES.map(([k]) => Number(f["pag_" + k]) || null)).concat([Number(f.ajust) || null, f.ajust_motiu || "", Number(f.total_tiquets), Number(f.total_a_pagar), f.estat, f.liquidacio || mes])));
    const ws3 = XLSX.utils.aoa_to_sheet(det); fullEuros(ws3, [...Array(CONCEPTES.length + 4).keys()].map((i) => i + 5));
    XLSX.utils.book_append_sheet(wb, ws3, "Detall");
    XLSX.writeFile(wb, `Nomina_despeses_${mes}_${marcaTemps()}.xlsx`);
  }

  // ------------------------------------------------------------------ ADMIN · per estudi
  async function vistaEstudis() {
    S.est = S.est || { desde: avui().slice(0, 4) + "-01-01", fins: avui(), inclouPendents: false };
    const E = S.est;
    $("#contingut").innerHTML = `
      <section class="targeta">
        <div class="barra-filtres">${filtreDates("e", E)}
          <label class="check"><input type="checkbox" id="e-pend" ${E.inclouPendents ? "checked" : ""}> Inclou també els pendents de revisar</label>
          <button class="verd" id="e-excel">⬇ Excel</button></div>
        <div id="e-resum" class="resum"></div><div class="taula-cont" id="e-taula"><div class="buit">Carregant…</div></div>
      </section>`;
    const carrega = async () => {
      E.desde = $("#e-desde").value; E.fins = $("#e-fins").value; E.inclouPendents = $("#e-pend").checked;
      const estats = E.inclouPendents ? ["pendent", "aprovat", "liquidat"] : ["aprovat", "liquidat"];
      try { E.fulls = await fetchAll(() => sb.from("fulls_despeses").select("*").in("estat", estats).gte("data", E.desde).lte("data", E.fins).order("projecte")); }
      catch (e) { return toast(missatgeError(e), "error"); }
      const m = new Map();
      E.fulls.forEach((f) => {
        if (!m.has(f.projecte)) m.set(f.projecte, { projecte: f.projecte, n: 0, persones: new Set(), total: 0, ...Object.fromEntries(CONCEPTES.map(([k]) => [k, 0])) });
        const r = m.get(f.projecte); r.n++; r.persones.add(f.user_id); r.total += Number(f.total_a_pagar || 0);
        CONCEPTES.forEach(([k]) => { r[k] += Number(f["pag_" + k] || 0); });
      });
      E.files = [...m.values()].sort((a, b) => b.total - a.total);
      const tot = E.files.reduce((a, r) => a + r.total, 0);
      $("#e-resum").innerHTML = `<b>${E.files.length}</b> estudis · total <b>${eur(tot)}</b>`;
      const grups = [["Dietes", ["esmorzar", "dinar", "sopar"]], ["Desplaçament", ["transport", "km", "aparcament", "autopistes"]], ["Hotel", ["hotel", "impost_turistic"]], ["Altres", ["altres"]]];
      $("#e-taula").innerHTML = !E.files.length ? `<div class="buit">No hi ha despeses en aquest període.</div>` : `
        <table><thead><tr><th>Estudi</th><th class="num">Fulls</th><th class="num">Persones</th>${grups.map(([g]) => `<th class="num">${g}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
        ${E.files.map((r) => `<tr><td>${esc(r.projecte)}</td><td class="num">${r.n}</td><td class="num">${r.persones.size}</td>
          ${grups.map(([, ks]) => `<td class="num">${eur(ks.reduce((a, k) => a + r[k], 0))}</td>`).join("")}<td class="num"><b>${eur(r.total)}</b></td></tr>`).join("")}
        </tbody></table>`;
    };
    $$("#e-desde, #e-fins, #e-pend").forEach((el) => el.onchange = carrega);
    $("#e-excel").onclick = () => {
      if (!E.files || !E.files.length) return;
      const aoa = [["Estudi", "Fulls", "Persones"].concat(CONCEPTES.map(([, n]) => n)).concat(["Total"])]
        .concat(E.files.map((r) => [r.projecte, r.n, r.persones.size].concat(CONCEPTES.map(([k]) => Math.round(r[k] * 100) / 100)).concat([Math.round(r.total * 100) / 100])));
      const ws = XLSX.utils.aoa_to_sheet(aoa); fullEuros(ws, [...Array(CONCEPTES.length + 1).keys()].map((i) => i + 3));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Per estudi");
      XLSX.writeFile(wb, `Despeses_per_estudi_${E.desde}_${E.fins}.xlsx`);
    };
    carrega();
  }

  // ------------------------------------------------------------------ ADMIN · usuaris
  async function creaUsuari(usuari, nom, codi) {
    usuari = (usuari || "").trim().toLowerCase(); nom = (nom || "").trim(); codi = (codi || "").trim();
    if (!/^[a-z0-9._-]{2,30}$/.test(usuari)) throw new Error(`Usuari no vàlid: "${usuari}"`);
    const pwd = generaPwd();
    const tmp = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `desp-tmp-${Date.now()}-${Math.random()}` } });
    let data, error;
    for (let intent = 0; intent < 4; intent++) {
      ({ data, error } = await tmp.auth.signUp({ email: emailDe(usuari), password: pwd }));
      const m = (error && error.message) || "", espera = m.match(/after (\d+) seconds/);
      if (error && (espera || /rate limit/i.test(m)) && !/email rate limit/i.test(m)) { await new Promise((r) => setTimeout(r, (espera ? +espera[1] + 1 : 15 * (intent + 1)) * 1000)); continue; }
      break;
    }
    if (error) throw error;
    if (!data.user) throw new Error("Supabase no ha retornat l'usuari");
    if (!data.session) throw new Error("Cal desactivar 'Confirm email' a Supabase");
    const { error: e2 } = await sb.from("perfils").update({ empleat: nom, codi: codi || null, tipus: "camp", actiu: true, canviar_pwd: true, alta_feta: true }).eq("id", data.user.id);
    if (e2) throw e2;
    return { usuari, nom, codi, pwd };
  }
  function mostraContrasenyes(llista) {
    const csv = "﻿usuari;nom;codi;contrasenya_temporal\r\n" + llista.map((r) => `${r.usuari};${r.nom};${r.codi || ""};${r.pwd}`).join("\r\n");
    modal("Contrasenyes temporals", `<p>Copia-les ara: no es tornaran a mostrar.</p>
      <table><thead><tr><th>Usuari</th><th>Nom</th><th>Codi</th><th>Contrasenya</th></tr></thead><tbody>
      ${llista.map((r) => `<tr><td>${esc(r.usuari)}</td><td>${esc(r.nom)}</td><td>${esc(r.codi || "")}</td><td><code class="pwd">${esc(r.pwd)}</code></td></tr>`).join("")}</tbody></table>`,
      [{ text: "Descarrega CSV", onClick: () => { descarregaFitxer(`contrasenyes_camp_${marcaTemps()}.csv`, csv, "text/csv;charset=utf-8"); return false; } }, { text: "Fet", cls: "primari" }]);
  }
  async function vistaUsuaris() {
    try { await carregaUsuaris(); } catch (e) { return toast(missatgeError(e), "error"); }
    const acc = new Map();
    try { const { data } = await sb.rpc("admin_ultims_accessos"); (data || []).forEach((r) => acc.set(r.id, r)); } catch (e) { /* res */ }
    const darrer = (u) => (acc.get(u.id) || {}).ultim_acces || null;
    const camp = S.usuaris.filter((u) => u.tipus === "camp" || (!u.admin && u.alta_feta === false))
      .sort((a, b) => (b.actiu - a.actiu) || String(a.empleat || a.usuari).localeCompare(String(b.empleat || b.usuari), "ca"));
    S._darrer = darrer;
    $("#contingut").innerHTML = `
      <div class="graella">
        <section class="targeta">
          <h2>Nou enquestador/a</h2>
          <label for="u-usuari">Usuari (per entrar)</label><input type="text" id="u-usuari" autocapitalize="none" placeholder="p. ex. 1104 o mgarcia">
          <label for="u-nom">Nom i cognoms</label><input type="text" id="u-nom">
          <label for="u-codi">Codi d'entrevistador/a</label><input type="text" id="u-codi" inputmode="numeric">
          <div class="fila-botons"><button class="primari" id="u-crea">Crea</button></div>
          <hr><h2>Crear diversos de cop</h2>
          <label for="u-bloc">Una línia per persona: <code>usuari;Nom i cognoms;codi</code></label>
          <textarea id="u-bloc" placeholder="1104;Maria Garcia;1104&#10;1183;Joan Puig;1183"></textarea>
          <div class="fila-botons"><button class="primari" id="u-bloc-crea">Crea tots</button></div>
        </section>
        <section class="targeta">
          <h2>Enquestadors/es (${camp.filter((u) => u.actiu).length} actius de ${camp.length})</h2>
          <div class="barra-filtres" style="margin-bottom:8px">
            <div style="min-width:0"><label for="u-mesos">Desactivar els que no han entrat en</label>
              <select id="u-mesos"><option value="2">2 mesos</option><option value="3" selected>3 mesos</option><option value="6">6 mesos</option><option value="12">12 mesos</option></select></div>
            <button class="perill" id="u-desactiva-vells">Desactiva'ls</button>
          </div>
          <div class="taula-cont"><table><thead><tr><th>Usuari</th><th>Nom</th><th>Codi</th><th>Últim accés</th><th>Estat</th><th></th></tr></thead><tbody>
          ${camp.map((u) => `<tr><td>${esc(u.usuari)}</td><td>${esc(u.empleat)}</td><td>${esc(u.codi || "")}</td>
            <td>${darrer(u) ? fmtData(String(darrer(u)).slice(0, 10)) : `<span class="pista">mai</span>`}</td>
            <td>${u.alta_feta === false ? `<span class="etiqueta groga">Alta incompleta</span>` : (u.actiu ? `<span class="etiqueta verda">Actiu</span>` : `<span class="etiqueta">Desactivat</span>`)}${u.canviar_pwd && u.actiu ? ` <span class="etiqueta groga">Pendent de canviar contrasenya</span>` : ""}</td>
            <td class="accions"><button class="petit" data-a="edita" data-id="${u.id}">Edita</button>
              <button class="petit" data-a="pwd" data-id="${u.id}">Contrasenya</button>
              <button class="petit ${u.actiu ? "perill" : ""}" data-a="actiu" data-id="${u.id}">${u.actiu ? "Desactiva" : "Activa"}</button></td></tr>`).join("") || `<tr><td colspan="6" class="buit">Encara no hi ha cap enquestador/a.</td></tr>`}
          </tbody></table></div>
          <p class="pista">Els enquestadors es poden donar d'alta sols amb el <b>codi d'alta</b> (pestanya Configuració). Un usuari desactivat no pot entrar ni reactivar-se sol, però els seus fulls es conserven.</p>
        </section>
      </div>`;
    $("#u-desactiva-vells").onclick = async () => {
      const mesos = +$("#u-mesos").value, limit = new Date(); limit.setMonth(limit.getMonth() - mesos);
      const vells = camp.filter((u) => u.actiu && !u.admin && new Date(darrer(u) || (acc.get(u.id) || {}).creat || 0) < limit);
      if (!vells.length) return toast(`Tothom ha entrat en els últims ${mesos} mesos.`);
      if (!await confirma("Desactivar usuaris", `Es desactivaran <b>${vells.length}</b> usuaris que no han entrat en ${mesos} mesos:<br>${vells.map((u) => esc(u.empleat || u.usuari)).join(", ")}.<br><br>Els seus fulls es conserven i els pots tornar a activar quan vulguis.`, "Desactiva", "perill")) return;
      const { error } = await sb.from("perfils").update({ actiu: false }).in("id", vells.map((u) => u.id));
      if (error) return toast(missatgeError(error), "error");
      toast(`${vells.length} usuaris desactivats.`, "ok"); vistaUsuaris();
    };
    $("#u-crea").onclick = async (ev) => {
      ev.target.disabled = true;
      try { if (!$("#u-nom").value.trim()) throw new Error("Falta el nom."); const r = await creaUsuari($("#u-usuari").value, $("#u-nom").value, $("#u-codi").value); await vistaUsuaris(); mostraContrasenyes([r]); }
      catch (e) { toast(missatgeError(e), "error"); ev.target.disabled = false; }
    };
    $("#u-bloc-crea").onclick = async (ev) => {
      const linies = $("#u-bloc").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!linies.length) return toast("No hi ha cap línia.", "error");
      ev.target.disabled = true; const ok = [], errors = [];
      for (const [n, l] of linies.entries()) {
        ev.target.textContent = `Creant ${n + 1} de ${linies.length}…`;
        const [usuari, nom, codi] = l.split(";");
        try { ok.push(await creaUsuari(usuari, nom, codi)); } catch (e) { errors.push(`${usuari}: ${missatgeError(e)}`); if (/email rate limit/i.test(e.message || "")) break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
      await vistaUsuaris(); if (ok.length) mostraContrasenyes(ok);
      if (errors.length) toast(`No s'han pogut crear: ${errors.join(" · ")}`, "error");
    };
    $$("#contingut td.accions button").forEach((b) => b.onclick = async () => {
      const u = S.usuaris.find((x) => x.id === b.dataset.id);
      if (b.dataset.a === "edita") {
        modal(`Editar ${u.usuari}`, `<label for="m-nom">Nom i cognoms</label><input type="text" id="m-nom" value="${esc(u.empleat)}">
          <label for="m-codi">Codi</label><input type="text" id="m-codi" value="${esc(u.codi || "")}">`, [{ text: "Cancel·la" },
          { text: "Desa", cls: "primari", onClick: async () => {
            const { error } = await sb.from("perfils").update({ empleat: $("#m-nom").value.trim(), codi: $("#m-codi").value.trim() || null }).eq("id", u.id);
            if (error) { toast(missatgeError(error), "error"); return false; } vistaUsuaris(); } }]);
      } else if (b.dataset.a === "pwd") {
        if (!await confirma("Restablir contrasenya", `Es generarà una contrasenya temporal nova per a <b>${esc(u.usuari)}</b>.`, "Restableix")) return;
        const pwd = generaPwd(); const { error } = await sb.rpc("admin_set_password", { uid: u.id, pwd });
        if (error) return toast(missatgeError(error), "error");
        await vistaUsuaris(); mostraContrasenyes([{ usuari: u.usuari, nom: u.empleat, codi: u.codi, pwd }]);
      } else if (b.dataset.a === "actiu") {
        const canvis = { actiu: !u.actiu }; if (!u.actiu) { canvis.alta_feta = true; canvis.tipus = "camp"; }
        const { error } = await sb.from("perfils").update(canvis).eq("id", u.id);
        if (error) return toast(missatgeError(error), "error"); vistaUsuaris();
      }
    });
  }

  // ------------------------------------------------------------------ ADMIN · configuració
  async function vistaConfig() {
    try { await carregaBase(); } catch (e) { return toast(missatgeError(e), "error"); }
    const tf = S.tarifes.slice().sort((a, b) => b.exercici - a.exercici);
    $("#contingut").innerHTML = `
      <div class="graella" style="grid-template-columns: 1fr 1fr">
        <section class="targeta">
          <h2>Imports màxims per any</h2>
          <div class="taula-cont"><table><thead><tr><th>Any</th><th>Esmorzar</th><th>Dinar</th><th>Sopar</th><th>Hotel/nit</th><th>€/km</th><th></th></tr></thead><tbody>
          ${tf.map((t) => `<tr data-any="${t.exercici}"><td><b>${t.exercici}</b></td>${["esmorzar", "dinar", "sopar", "hotel", "km"].map((k) => `<td><input type="text" class="t-in" data-k="${k}" value="${fmtInput(t[k])}" inputmode="decimal" style="width:70px"></td>`).join("")}
            <td><button class="petit primari t-desa">Desa</button></td></tr>`).join("")}
          </tbody></table></div>
          <div class="fila-botons"><button id="t-nou">＋ Afegeix l'any ${tf.length ? tf[0].exercici + 1 : new Date().getFullYear()}</button></div>
          <p class="pista">Cada full es calcula amb els imports de l'any de la seva data.</p>
        </section>
        <section class="targeta">
          <h2>Criteri per municipi</h2>
          <div class="dues"><div class="combo"><input type="text" id="c-muni" placeholder="Afegeix un municipi…" autocomplete="off"><ul id="c-muni-ll" class="combo-llista ocult"></ul></div>
            <div><label class="check"><input type="checkbox" id="c-desp"> Sense desplaçament (AMB)</label><label class="check"><input type="checkbox" id="c-dieta"> Sense dieta (metro)</label></div></div>
          <div class="fila-botons" style="margin-top:4px"><button class="primari" id="c-afegeix">Afegeix / actualitza</button></div>
          <div class="taula-cont" style="max-height:420px;margin-top:10px"><table><thead><tr><th>Municipi</th><th>Sense desplaçament</th><th>Sense dieta</th><th></th></tr></thead><tbody>
          ${S.criteri.map((c) => `<tr><td>${esc(c.municipi)}${c.nota ? `<div class="pista">${esc(c.nota)}</div>` : ""}</td><td>${c.sense_desplacament ? "✔" : ""}</td><td>${c.sense_dieta ? "✔" : ""}</td>
            <td><button class="petit perill c-treu" data-m="${esc(c.municipi)}">Treu</button></td></tr>`).join("")}
          </tbody></table></div>
        </section>
      </div>
      <section class="targeta" style="margin-top:20px">
        <h2>Codi d'alta per als enquestadors</h2>
        <p class="pista">Amb aquest codi els enquestadors es poden donar d'alta sols des de la pantalla d'entrada («Donar-me d'alta»). Canvia'l quan vulguis: els que ja tenen compte no es veuen afectats.</p>
        <div class="barra-filtres"><div style="min-width:220px"><label for="k-alta">Codi d'alta actual</label><input type="text" id="k-alta" autocapitalize="characters"></div>
          <button class="primari" id="k-desa">Desa el codi</button></div>
      </section>
      <section class="targeta" style="margin-top:20px">
        <h2>Estudis</h2>
        <div class="barra-filtres">
          <div style="min-width:320px;flex:1"><label for="e-nou">Afegir estudi</label><input type="text" id="e-nou" placeholder="p. ex. G1950 - EnqMunTerrassa2026"></div>
          <button class="primari" id="e-afegeix">Afegeix</button>
          <label class="check"><input type="checkbox" id="e-inactius" ${S._estInactius ? "checked" : ""}> Mostra els desactivats</label>
        </div>
        <p class="pista">Fes servir el mateix nom que a l'Odoo (codi G#### davant): és el que surt al concepte de la nòmina.</p>
        <div class="taula-cont" style="max-height:380px"><table><thead><tr><th>Estudi</th><th>Estat</th><th></th></tr></thead><tbody id="e-llista"><tr><td colspan="3" class="buit">Carregant…</td></tr></tbody></table></div>
      </section>`;
    // codi d'alta
    sb.from("config").select("valor").eq("clau", "codi_alta").maybeSingle().then(({ data }) => { if (data) $("#k-alta").value = data.valor; });
    $("#k-desa").onclick = async () => {
      const v = $("#k-alta").value.trim();
      if (v.length < 4) return toast("El codi ha de tenir com a mínim 4 caràcters.", "error");
      const { error } = await sb.from("config").upsert({ clau: "codi_alta", valor: v }, { onConflict: "clau" });
      if (error) return toast(missatgeError(error), "error"); toast(`Codi d'alta desat: ${v}`, "ok");
    };
    // estudis (llista pròpia d'aquest projecte)
    const pintaEstudis = async () => {
      let ll;
      try { ll = await fetchAll(() => { let q = sb.from("llistes").select("*").eq("tipus", "projecte"); if (!S._estInactius) q = q.eq("actiu", true); return q.order("id"); }); }
      catch (e) { return toast(missatgeError(e), "error"); }
      ll.sort((a, b) => (a.valor === "ESTRUCTURA" ? -1 : b.valor === "ESTRUCTURA" ? 1 : b.valor.localeCompare(a.valor, "ca")));
      $("#e-llista").innerHTML = ll.map((r) => `<tr><td>${esc(r.valor)}</td><td>${r.actiu ? `<span class="etiqueta verda">Actiu</span>` : `<span class="etiqueta">Desactivat</span>`}</td>
        <td><button class="petit" data-id="${r.id}" data-actiu="${r.actiu}">${r.actiu ? "Desactiva" : "Activa"}</button></td></tr>`).join("");
      $$("#e-llista button").forEach((b) => b.onclick = async () => {
        const { error } = await sb.from("llistes").update({ actiu: b.dataset.actiu !== "true" }).eq("id", b.dataset.id);
        if (error) return toast(missatgeError(error), "error"); await carregaBase(); pintaEstudis();
      });
    };
    const afegeixEstudi = async () => {
      const v = $("#e-nou").value.trim(); if (!v) return;
      const { error } = await sb.from("llistes").upsert({ tipus: "projecte", valor: v, actiu: true }, { onConflict: "tipus,valor" });
      if (error) return toast(missatgeError(error), "error");
      $("#e-nou").value = ""; toast(`Afegit: ${v}`, "ok"); await carregaBase(); pintaEstudis();
    };
    $("#e-afegeix").onclick = afegeixEstudi;
    $("#e-nou").addEventListener("keydown", (e) => { if (e.key === "Enter") afegeixEstudi(); });
    $("#e-inactius").onchange = (e) => { S._estInactius = e.target.checked; pintaEstudis(); };
    pintaEstudis();
    $$(".t-desa").forEach((b) => b.onclick = async () => {
      const tr = b.closest("tr"), fila = { exercici: +tr.dataset.any };
      for (const inp of $$(".t-in", tr)) { const v = parseImport(inp.value); if (v == null || Number.isNaN(v)) return toast("Valor no vàlid.", "error"); fila[inp.dataset.k] = v; }
      const { error } = await sb.from("tarifes").upsert(fila, { onConflict: "exercici" });
      if (error) return toast(missatgeError(error), "error"); toast(`Imports de ${fila.exercici} desats.`, "ok");
    });
    $("#t-nou").onclick = async () => {
      const base = tf[0] || { exercici: new Date().getFullYear() - 1, esmorzar: 5, dinar: 16, sopar: 10, hotel: 41, km: 0.25 };
      const { error } = await sb.from("tarifes").insert({ ...base, exercici: base.exercici + 1 });
      if (error) return toast(missatgeError(error), "error"); vistaConfig();
    };
    initCombo($("#c-muni"), $("#c-muni-ll"), () => window.MUNICIPIS_CAT || [], (m) => {
      const c = criteriDe(m); $("#c-desp").checked = !!(c && c.sense_desplacament); $("#c-dieta").checked = !!(c && c.sense_dieta);
    });
    $("#c-afegeix").onclick = async () => {
      const m = $("#c-muni").value.trim(); if (!m) return;
      const { error } = await sb.from("municipis_criteri").upsert({ municipi: m, sense_desplacament: $("#c-desp").checked, sense_dieta: $("#c-dieta").checked }, { onConflict: "municipi" });
      if (error) return toast(missatgeError(error), "error"); toast(`Desat: ${m}`, "ok"); vistaConfig();
    };
    $$(".c-treu").forEach((b) => b.onclick = async () => {
      if (!await confirma("Treure municipi", `Treure <b>${esc(b.dataset.m)}</b> del criteri? Passarà a tenir desplaçament i dieta.`, "Treu", "perill")) return;
      const { error } = await sb.from("municipis_criteri").delete().eq("municipi", b.dataset.m);
      if (error) return toast(missatgeError(error), "error"); vistaConfig();
    });
  }

  // ------------------------------------------------------------------ engega
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") tancaModal(); });
  inici().catch((e) => { app.innerHTML = `<div class="login-fons"><div class="login"><h1>Error</h1><p>${esc(missatgeError(e))}</p></div></div>`; });
})();
