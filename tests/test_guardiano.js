/**
 * Collaudo del guardiano del preallarme.
 *
 * Il banco della scheda (test_scheda_allarme.js) tiene il guardiano SPENTO,
 * perche' li' si prova la card. Qui si prova l'opposto: il pezzo che vive
 * fuori dalla scheda, gira su ogni pagina e deve far comparire il tastierino
 * quando qualcuno entra.
 *
 * Il DOM finto imita solo cio' che il guardiano usa davvero:
 * `document.querySelector("home-assistant").hass`, `createElement` di un
 * elemento registrato, `document.body.appendChild`, `remove()` e gli eventi
 * sull'elemento. Dove il browser vero fa di piu', il banco non lo imita: e'
 * un banco di logica, non di rendering.
 *
 *   node tests/test_guardiano.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------------------------------------------------------------------------
// DOM finto
// ---------------------------------------------------------------------------
class NodoFinto {
  constructor(tag = "#radice") {
    this.tagName = String(tag).toUpperCase();
    this.figli = [];
    this.attributi = {};
    this.ascoltatori = {};
    this.dataset = {};
    this._testo = "";
    this.hidden = false;
    this.disabled = false;
    this._padre = null;
    const insieme = new Set();
    // className e classList sono la stessa cosa, come nel DOM vero: senza
    // questo una classe messa alla creazione non si vedrebbe da classList.
    Object.defineProperty(this, "className", {
      get: () => Array.from(insieme).join(" "),
      set: (valore) => {
        insieme.clear();
        String(valore).split(/\s+/).filter(Boolean).forEach((nome) => insieme.add(nome));
      },
    });
    this.classList = {
      add: (...nomi) => nomi.forEach((n) => insieme.add(n)),
      remove: (...nomi) => nomi.forEach((n) => insieme.delete(n)),
      toggle(nome, forza) {
        const accesa = forza === undefined ? !insieme.has(nome) : Boolean(forza);
        if (accesa) insieme.add(nome); else insieme.delete(nome);
        return accesa;
      },
      contains: (nome) => insieme.has(nome),
    };
  }
  setAttribute(chiave, valore) {
    if (chiave === "hidden") this.hidden = true;
    this.attributi[chiave] = String(valore);
  }
  getAttribute(chiave) { return chiave in this.attributi ? this.attributi[chiave] : null; }
  removeAttribute(chiave) {
    if (chiave === "hidden") this.hidden = false;
    delete this.attributi[chiave];
  }
  toggleAttribute(chiave, forza) {
    if (forza) this.setAttribute(chiave, ""); else this.removeAttribute(chiave);
    return Boolean(forza);
  }
  hasAttribute(chiave) { return chiave in this.attributi; }
  appendChild(figlio) {
    this.figli.push(figlio);
    if (figlio && typeof figlio === "object") figlio._padre = this;
    return figlio;
  }
  removeChild(figlio) {
    this.figli = this.figli.filter((f) => f !== figlio);
    if (figlio) figlio._padre = null;
    return figlio;
  }
  remove() { if (this._padre) this._padre.removeChild(this); }
  replaceChildren(...figli) {
    this.figli = [];
    this._testo = "";
    figli.forEach((f) => this.appendChild(f));
  }
  addEventListener(tipo, funzione) { (this.ascoltatori[tipo] = this.ascoltatori[tipo] || []).push(funzione); }
  dispatchEvent(evento) {
    (this.ascoltatori[evento && evento.type] || []).forEach((f) => f(evento));
    return true;
  }
  click() { (this.ascoltatori.click || []).forEach((f) => f({})); }
  set textContent(valore) { this._testo = String(valore); this.figli = []; }
  get textContent() { return this._testo + this.figli.map((f) => f.textContent).join(""); }
  set innerHTML(_valore) { this.figli = []; this._testo = ""; }
  querySelector(selettore) { return this.querySelectorAll(selettore)[0] || null; }
  querySelectorAll(selettore) {
    const trovati = [];
    const corrisponde = (nodo) => {
      if (selettore === "button") return nodo.tagName === "BUTTON";
      if (selettore.startsWith(".")) return nodo.classList.contains(selettore.slice(1));
      return nodo.tagName === selettore.toUpperCase();
    };
    const visita = (nodo) => (nodo.figli || []).forEach((f) => {
      if (corrisponde(f)) trovati.push(f);
      visita(f);
    });
    visita(this);
    return trovati;
  }
  tutti() {
    const elenco = [];
    const visita = (nodo) => { elenco.push(nodo); (nodo.figli || []).forEach(visita); };
    visita(this);
    return elenco;
  }
}

// ---------------------------------------------------------------------------
// Orologio finto
// ---------------------------------------------------------------------------
let adesso = 0;
let prossimoId = 0;
const timer = [];
function impostaTimer(funzione, ms) {
  timer.push({ id: ++prossimoId, quando: adesso + (ms || 0), funzione });
  return prossimoId;
}
function cancellaTimer(id) {
  const i = timer.findIndex((t) => t.id === id);
  if (i >= 0) timer.splice(i, 1);
}
async function svuota() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
async function avanza(ms) {
  const fine = adesso + ms;
  for (let giri = 0; giri < 500; giri++) {
    timer.sort((a, b) => a.quando - b.quando);
    if (!timer[0] || timer[0].quando > fine) break;
    const primo = timer.shift();
    adesso = primo.quando;
    primo.funzione();
    await svuota();
  }
  adesso = fine;
  await svuota();
}

// ---------------------------------------------------------------------------
// Il frontend finto: <home-assistant> con il suo hass, e il corpo pagina
// ---------------------------------------------------------------------------
const MAPPA = "sensor.tecnoalarm_mappa_allarme";
const TOTALE = { numero: 1, entity_id: "alarm_control_panel.totale", nome: "Totale" };
const NOTTE = { numero: 2, entity_id: "alarm_control_panel.notte", nome: "Notte" };
const ID_DISPOSITIVO = "0102030405060708";

const radiceHA = { hass: null };
const corpo = new NodoFinto("body");
const registrati = {};
const magazzino = new Map();
let sottoscrizioni = [];
let fallisciSottoscrizione = false;

const contesto = {
  console: { info() {}, error: console.error, warn: console.warn, log: console.log },
  setTimeout: impostaTimer,
  clearTimeout: cancellaTimer,
  HTMLElement: class {
    constructor() { this.ascoltatori = {}; this.figli = []; this._padre = null; }
    attachShadow() { return new NodoFinto("#shadow"); }
    appendChild(figlio) { this.figli.push(figlio); return figlio; }
    removeChild(figlio) { this.figli = this.figli.filter((f) => f !== figlio); return figlio; }
    remove() { if (this._padre) this._padre.removeChild(this); }
    addEventListener(tipo, f) { (this.ascoltatori[tipo] = this.ascoltatori[tipo] || []).push(f); }
    dispatchEvent(evento) {
      (this.ascoltatori[evento && evento.type] || []).forEach((f) => f(evento));
      return true;
    }
  },
  customElements: {
    get: (nome) => registrati[nome],
    define: (nome, classe) => { registrati[nome] = classe; },
  },
  CustomEvent: class { constructor(tipo, init) { this.type = tipo; this.detail = init && init.detail; } },
  localStorage: {
    getItem: (k) => (magazzino.has(k) ? magazzino.get(k) : null),
    setItem: (k, v) => { magazzino.set(k, String(v)); },
    removeItem: (k) => { magazzino.delete(k); },
  },
  crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = i + 1; return a; } },
};
contesto.document = {
  body: corpo,
  // Il guardiano crea l'elemento per nome: qui si istanzia la classe vera,
  // come fa il browser con un elemento personalizzato gia' definito.
  createElement: (tag) => (registrati[tag] ? new registrati[tag]() : new NodoFinto(tag)),
  querySelector: (selettore) => (selettore === "home-assistant" ? radiceHA : null),
};
contesto.window = contesto;
vm.createContext(contesto);

const WWW = path.join(__dirname, "..", "custom_components", "nexus_tecnoalarm", "www");
const SORGENTE = path.join(WWW, "nexus-tecnoalarm-allarme.js");
const SORGENTE_GUARDIANO = path.join(WWW, "nexus-tecnoalarm-guardiano.js");

// ---------------------------------------------------------------------------
// Stato della casa
// ---------------------------------------------------------------------------
let orologioStati = 0;
function stato(entity_id, valore, attributi = {}) {
  return { entity_id, state: valore, attributes: attributi, last_updated: `t${++orologioStati}` };
}

function casaFinta({ totale = "armed_away", notte = "disarmed", tastierino = true,
                    dispositivi = [ID_DISPOSITIVO], ingresso = true } = {}) {
  const stati = {
    [MAPPA]: stato(MAPPA, "5", {
      ruolo: "mappa_allarme",
      dispositivo_trovato: true,
      programmi: [TOTALE, NOTTE].map((p) => ({ ...p, zone_aperte: null })),
      zone: [{ numero: 1, entity_id: "binary_sensor.porta", nome: "Porta", area: null, piano: null }],
      telecomandi: [],
      allarme_generale: "binary_sensor.allarme",
      ingresso_distinto: ingresso,
      tastierino_preallarme: tastierino,
      dispositivi_preallarme: dispositivi,
      rifiuti: {},
    }),
    [TOTALE.entity_id]: stato(TOTALE.entity_id, totale),
    [NOTTE.entity_id]: stato(NOTTE.entity_id, notte),
    "binary_sensor.porta": stato("binary_sensor.porta", "off", { device_class: "door" }),
    "binary_sensor.allarme": stato("binary_sensor.allarme", "off"),
  };
  return {
    states: stati,
    formatEntityState: (s) => s.state,
    callService: async () => undefined,
    connection: {
      subscribeEvents: async (richiamo, tipo) => {
        if (fallisciSottoscrizione) throw new Error("niente connessione");
        const voce = { richiamo, tipo, viva: true };
        sottoscrizioni.push(voce);
        return () => { voce.viva = false; };
      },
    },
  };
}

/** Come il websocket di Home Assistant: un cambio di stato e una notifica. */
async function cambia(entita, valore) {
  const vecchio = radiceHA.hass.states[entita];
  radiceHA.hass = {
    ...radiceHA.hass,
    states: { ...radiceHA.hass.states, [entita]: stato(entita, valore, vecchio.attributes) },
  };
  for (const s of sottoscrizioni) {
    if (s.viva) s.richiamo({ event_type: "state_changed", data: { entity_id: entita } });
  }
  await svuota();
}

async function cambiaMappa(attributi) {
  const vecchio = radiceHA.hass.states[MAPPA];
  radiceHA.hass = {
    ...radiceHA.hass,
    states: {
      ...radiceHA.hass.states,
      [MAPPA]: stato(MAPPA, vecchio.state, { ...vecchio.attributes, ...attributi }),
    },
  };
  for (const s of sottoscrizioni) {
    if (s.viva) s.richiamo({ event_type: "state_changed", data: { entity_id: MAPPA } });
  }
  await svuota();
}

// ---------------------------------------------------------------------------
// Verifiche
// ---------------------------------------------------------------------------
let fatte = 0;
const guai = [];
function verifica(descrizione, condizione, dettaglio) {
  fatte += 1;
  if (condizione) return;
  guai.push(`${descrizione}${dettaglio ? ` -> ${dettaglio}` : ""}`);
}

/** Le schede «solo dialogo» montate in pagina dal guardiano. */
function montate() {
  return corpo.figli.filter((f) => f && f._el !== undefined);
}
function dialogoDi(carta) {
  return carta && carta._el && carta._el.dialogo;
}
function tastierinoAperto() {
  const carte = montate();
  if (carte.length !== 1) return null;
  const d = dialogoDi(carte[0]);
  return d && d.velo.hidden === false ? d : null;
}

function reset({ totale = "armed_away", tastierino = true, dispositivi = [ID_DISPOSITIVO],
                identita = true, ingresso = true } = {}) {
  timer.length = 0;
  sottoscrizioni = [];
  corpo.figli = [];
  magazzino.clear();
  if (identita) {
    magazzino.set("nexus_tecnoalarm_dispositivo",
      JSON.stringify({ id: ID_DISPOSITIVO, nome: "Tablet ingresso" }));
  }
  radiceHA.hass = casaFinta({ totale, tastierino, dispositivi, ingresso });
  // Il guardiano si avvia una volta per pagina: fra una prova e l'altra si
  // riparte da zero, come un ricarico. La bandiera va azzerata DENTRO il
  // contesto: da fuori il proxy della vm non la cancella.
  vm.runInContext("window.__nexusTecnoalarmGuardiano = false;", contesto);
}

/** Un ricarico di pagina: guardiano azzerato e riavviato. */
function riavvia() {
  vm.runInContext("window.__nexusTecnoalarmGuardiano = false; window.__avviaGuardiano();", contesto);
}

// ---------------------------------------------------------------------------
// Avvio: il modulo si carica una volta sola, come la risorsa Lovelace
// ---------------------------------------------------------------------------
/**
 * Carica un file nel contesto come farebbe il browser.
 *
 * Nel browser i due file sono moduli, e ognuno ha il suo scope: possono
 * dichiarare le stesse costanti senza accorgersene. Nella vm sarebbero due
 * script nello stesso globale, e `CHIAVE_DISPOSITIVO` dichiarata due volte e'
 * un errore di sintassi. Avvolgerli restituisce la separazione vera.
 */
function caricaFile(percorso, esponi) {
  const sorgente = fs.readFileSync(percorso, "utf8");
  vm.runInContext("(function(){\n" + sorgente + "\n" + (esponi || "") + "\n})();",
    contesto, { filename: percorso });
}

reset();
// Prima la scheda, con la bandiera alzata: cosi' non prova a tirarsi dietro il
// guardiano con un import dinamico, che dentro la vm non esiste.
vm.runInContext("window.__nexusTecnoalarmGuardiano = true;", contesto);
caricaFile(SORGENTE);
const Scheda = registrati["nexus-tecnoalarm-allarme"];

// Poi il guardiano, che e' quello che si prova qui. Si avvia da solo in fondo
// al file, come fa nel browser. Trovando la scheda gia' registrata non prova
// nemmeno a caricarla: e' la stessa strada di una pagina con una plancia.
vm.runInContext("window.__nexusTecnoalarmGuardiano = false;", contesto);
caricaFile(SORGENTE_GUARDIANO,
  "window.__avviaGuardiano = avviaGuardiano; window.__indirizzoScheda = indirizzoScheda;");

async function prove() {
  // --- il modulo si registra e avvia il guardiano --------------------------
  verifica("la scheda si registra", Boolean(Scheda));
  await svuota();
  verifica("il guardiano si segna come avviato",
    contesto.__nexusTecnoalarmGuardiano === true);
  verifica("il guardiano si iscrive a state_changed",
    sottoscrizioni.length === 1 && sottoscrizioni[0].tipo === "state_changed",
    JSON.stringify(sottoscrizioni.map((s) => s.tipo)));
  verifica("a impianto inserito non monta niente", montate().length === 0);

  // --- il caso che conta: preallarme su un dispositivo abilitato -----------
  await cambia(TOTALE.entity_id, "pending");
  const d = tastierinoAperto();
  verifica("in preallarme compare il tastierino", Boolean(d),
    `montate=${montate().length}`);
  if (d) {
    verifica("il titolo e' quello del disinserimento",
      d.titolo.textContent === "Disinserimento", d.titolo.textContent);
    verifica("il dialogo e' a schermo pieno", d.velo.classList.contains("pieno"));
    // Sopra una pagina qualunque il velo deve passare davanti alla barra
    // laterale e all'intestazione di Home Assistant, che vincono su z-index 3.
    verifica("il velo sta sopra l'interfaccia", d.velo.classList.contains("sopra"),
      d.velo.className);
    const carta = montate()[0];
    verifica("i tasti ci sono", Boolean(carta._el.tasti && carta._el.tasti.length >= 10),
      String(carta._el.tasti && carta._el.tasti.length));
    verifica("c'e' il disinserimento del programma da cui si entra",
      carta._el.disinserimenti.textContent.includes("Disinserisci Totale"),
      carta._el.disinserimenti.textContent);
  }

  // --- si digita e si disinserisce da li' ---------------------------------
  if (d) {
    const carta = montate()[0];
    const chiamate = [];
    radiceHA.hass.callService = async (dominio, servizio, dati) => { chiamate.push({ dominio, servizio, dati }); };
    carta.hass = radiceHA.hass;
    "1234".split("").forEach((c) => carta._premi(c));
    verifica("il codice si accumula", carta._codice === "1234", carta._codice);
    const bottone = carta._el.disinserimenti.querySelectorAll("button")[0];
    verifica("il pulsante e' attivo col codice digitato", bottone && bottone.disabled === false);
    if (bottone) bottone.click();
    await svuota();
    verifica("parte il disinserimento",
      chiamate.some((c) => c.servizio === "alarm_disarm" || c.servizio === "send_key" || c.dominio === "nexus_tecnoalarm"),
      JSON.stringify(chiamate));
  }

  // --- fine dell'ingresso: il tastierino se ne va -------------------------
  await cambia(TOTALE.entity_id, "disarmed");
  verifica("a programma disinserito la scheda viene smontata", montate().length === 0,
    `montate=${montate().length}`);

  // --- chiuso a mano: non si ripresenta addosso nello stesso episodio -----
  reset();
  riavvia();
  await svuota();
  await cambia(TOTALE.entity_id, "pending");
  verifica("riapre al nuovo ingresso", Boolean(tastierinoAperto()));
  const cartaChiusa = montate()[0];
  if (cartaChiusa) cartaChiusa._chiudiDialogo();
  verifica("chiudendo a mano la scheda si smonta", montate().length === 0);
  await cambia("binary_sensor.porta", "on");
  verifica("non si ripresenta nello stesso ingresso", montate().length === 0);
  await cambia(TOTALE.entity_id, "disarmed");
  await cambia(TOTALE.entity_id, "pending");
  verifica("al prossimo ingresso torna", Boolean(tastierinoAperto()));

  // --- allarme scattato: resta aperto -------------------------------------
  reset();
  riavvia();
  await svuota();
  await cambia(TOTALE.entity_id, "pending");
  await cambia(TOTALE.entity_id, "triggered");
  verifica("con l'allarme scattato il tastierino resta", Boolean(tastierinoAperto()));

  // --- un programma diverso da quello inserito ----------------------------
  reset({ totale: "disarmed" });
  riavvia();
  await svuota();
  await cambia(NOTTE.entity_id, "pending");
  verifica("vale per qualunque programma", Boolean(tastierinoAperto()));

  // --- l'indirizzo della scheda si ricava da quello del guardiano ---------
  {
    // Deve portarsi dietro la stessa versione: a parita' di URL con la risorsa
    // Lovelace il browser esegue il modulo una volta sola. Con una versione
    // diversa lo eseguirebbe due volte, e la seconda registrazione cadrebbe.
    const prima = contesto.document.querySelector;
    contesto.document.querySelector = (sel) =>
      String(sel).includes("nexus-tecnoalarm-guardiano.js")
        ? { src: "https://casa/nexus_tecnoalarm_local/nexus-tecnoalarm-guardiano.js?v=9.9.9" }
        : prima(sel);
    const conTag = contesto.__indirizzoScheda();
    contesto.document.querySelector = prima;
    verifica("l'indirizzo della scheda porta la stessa versione del guardiano",
      conTag === "https://casa/nexus_tecnoalarm_local/nexus-tecnoalarm-allarme.js?v=9.9.9",
      conTag);
    verifica("senza tag di script ripiega sul percorso servito dall'integrazione",
      contesto.__indirizzoScheda() === "/nexus_tecnoalarm_local/nexus-tecnoalarm-allarme.js",
      contesto.__indirizzoScheda());
  }

  // --- dentro la scheda normale il velo resta dov'e' ----------------------
  {
    const dentro = new Scheda();
    dentro.setConfig({ entity: MAPPA });
    dentro.hass = radiceHA.hass;
    verifica("CONTROPROVA nella scheda normale il velo non si alza",
      dentro._el.dialogo.velo.classList.contains("sopra") === false,
      dentro._el.dialogo.velo.className);
  }

  // --- controprove: i tre cancelli ----------------------------------------
  reset({ tastierino: false });
  riavvia();
  await svuota();
  await cambia(TOTALE.entity_id, "pending");
  verifica("CONTROPROVA impianto con la funzione spenta: niente", montate().length === 0);

  reset({ dispositivi: [] });
  riavvia();
  await svuota();
  await cambia(TOTALE.entity_id, "pending");
  verifica("CONTROPROVA dispositivo non abilitato: niente", montate().length === 0);

  reset({ identita: false });
  riavvia();
  await svuota();
  await cambia(TOTALE.entity_id, "pending");
  verifica("CONTROPROVA dispositivo senza identita': niente", montate().length === 0);

  // Su un gateway precedente alla V0.8.59 'pending' e' il tempo d'USCITA: il
  // tastierino si aprirebbe a ogni inserimento, in faccia a chi sta uscendo.
  reset({ ingresso: false });
  riavvia();
  await svuota();
  await cambia(TOTALE.entity_id, "pending");
  verifica("CONTROPROVA gateway che non distingue l'ingresso: niente",
    montate().length === 0, `montate=${montate().length}`);

  // --- revoca dalle opzioni mentre la pagina e' aperta --------------------
  reset();
  riavvia();
  await svuota();
  await cambiaMappa({ dispositivi_preallarme: [] });
  await cambia(TOTALE.entity_id, "pending");
  verifica("revocato dalle opzioni: niente, senza ricaricare", montate().length === 0);

  // --- ingresso gia' in corso quando la pagina si sveglia -----------------
  reset({ totale: "pending" });
  riavvia();
  await svuota();
  verifica("ingresso gia' in corso all'avvio: compare subito", Boolean(tastierinoAperto()),
    `montate=${montate().length}`);

  // --- frontend non ancora pronto -----------------------------------------
  reset();
  const salvato = radiceHA.hass;
  radiceHA.hass = null;
  riavvia();
  await svuota();
  verifica("senza hass non lancia e riprova", sottoscrizioni.length === 0);
  radiceHA.hass = salvato;
  await avanza(2100);
  verifica("appena il frontend c'e', si aggancia", sottoscrizioni.length === 1,
    `sottoscrizioni=${sottoscrizioni.length}`);
  await cambia(TOTALE.entity_id, "pending");
  verifica("e poi funziona", Boolean(tastierinoAperto()));

  // --- la sottoscrizione fallisce -----------------------------------------
  reset();
  fallisciSottoscrizione = true;
  riavvia();
  await svuota();
  fallisciSottoscrizione = false;
  await avanza(2100);
  verifica("sottoscrizione fallita: riprova e riesce", sottoscrizioni.length === 1,
    `sottoscrizioni=${sottoscrizioni.length}`);
}

prove().then(() => {
  console.log(`\n${fatte} verifiche`);
  if (guai.length === 0) {
    console.log("tutto a posto");
    return;
  }
  console.log(`\n${guai.length} FALLITE:`);
  guai.forEach((g) => console.log("  - " + g));
  process.exitCode = 1;
}).catch((errore) => {
  console.error("\nIl banco e' morto con un'eccezione:");
  console.error(errore);
  process.exitCode = 1;
});
