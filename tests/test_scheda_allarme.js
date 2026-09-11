/**
 * Collaudo a tavolino della scheda allarme.
 *
 * Carica la card vera dentro un DOM finto e un orologio finto, e ne prova la
 * parte che conta: la sequenza di disinserimento con codice, i rifiuti del
 * gateway, i tempi d'attesa. Nessuna dipendenza da installare.
 *
 *   node tests/test_scheda_allarme.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------------------------------------------------------------------------
// DOM finto: solo cio' che la card usa davvero
// ---------------------------------------------------------------------------
class NodoFinto {
  constructor(tag = "#radice") {
    this.tagName = tag.toUpperCase();
    this.figli = [];
    this.attributi = {};
    this.ascoltatori = {};
    this.dataset = {};
    this._testo = "";
    this.hidden = false;
    this.disabled = false;
    this.className = "";
    const insieme = new Set();
    this.classList = {
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
  appendChild(figlio) { this.figli.push(figlio); return figlio; }
  replaceChildren(...figli) { this.figli = []; this._testo = ""; figli.forEach((f) => this.appendChild(f)); }
  addEventListener(tipo, funzione) { (this.ascoltatori[tipo] = this.ascoltatori[tipo] || []).push(funzione); }
  click() { (this.ascoltatori.click || []).forEach((f) => f({})); }
  set textContent(valore) { this._testo = String(valore); this.figli = []; }
  get textContent() { return this._testo + this.figli.map((f) => f.textContent).join(""); }
  set innerHTML(_valore) { this.figli = []; this._testo = ""; }
  querySelectorAll(selettore) {
    const trovati = [];
    const visita = (nodo) => nodo.figli.forEach((f) => {
      if (selettore === "button" && f.tagName === "BUTTON") trovati.push(f);
      visita(f);
    });
    visita(this);
    return trovati;
  }
  tutti() {
    const elenco = [];
    const visita = (nodo) => { elenco.push(nodo); nodo.figli.forEach(visita); };
    visita(this);
    return elenco;
  }
}

// ---------------------------------------------------------------------------
// Orologio finto: i 15 secondi d'attesa passano in un istante
// ---------------------------------------------------------------------------
let adesso = 0;
let prossimoId = 0;
const timer = [];

function impostaTimer(funzione, ms) {
  const voce = { id: ++prossimoId, quando: adesso + (ms || 0), funzione };
  timer.push(voce);
  return voce.id;
}
function cancellaTimer(id) {
  const indice = timer.findIndex((t) => t.id === id);
  if (indice >= 0) timer.splice(indice, 1);
}
async function svuota() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function avanza(ms) {
  const fine = adesso + ms;
  for (let giri = 0; giri < 1000; giri++) {
    timer.sort((a, b) => a.quando - b.quando);
    const primo = timer[0];
    if (!primo || primo.quando > fine) break;
    timer.shift();
    adesso = primo.quando;
    primo.funzione();
    await svuota();
  }
  adesso = fine;
  await svuota();
}

// ---------------------------------------------------------------------------
// Caricamento della card vera
// ---------------------------------------------------------------------------
const registrati = {};
const contesto = {
  console: { info() {}, error: console.error, warn: console.warn, log: console.log },
  setTimeout: impostaTimer,
  clearTimeout: cancellaTimer,
  document: { createElement: (tag) => new NodoFinto(tag) },
  HTMLElement: class {
    attachShadow() { return new NodoFinto("#shadow"); }
    appendChild() {}
    dispatchEvent() {}
  },
  customElements: {
    get: (nome) => registrati[nome],
    define: (nome, classe) => { registrati[nome] = classe; },
  },
  CustomEvent: class { constructor(tipo, init) { this.type = tipo; this.detail = init && init.detail; } },
};
contesto.window = contesto;
vm.createContext(contesto);

const SORGENTE = path.join(
  __dirname, "..", "custom_components", "nexus_tecnoalarm", "www", "nexus-tecnoalarm-allarme.js"
);
vm.runInContext(fs.readFileSync(SORGENTE, "utf8"), contesto, { filename: SORGENTE });

const Scheda = registrati["nexus-tecnoalarm-allarme"];
if (!Scheda) {
  console.error("La card non si e' registrata");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Home Assistant finto
// ---------------------------------------------------------------------------
const MAPPA = "sensor.tecnoalarm_mappa_allarme";
const TOTALE = { numero: 1, entity_id: "alarm_control_panel.totale", nome: "Totale" };
const NOTTE = { numero: 2, entity_id: "alarm_control_panel.notte", nome: "Notte" };

let orologioStati = 0;
function stato(entity_id, valore, attributi = {}) {
  return { entity_id, state: valore, attributes: attributi, last_updated: `t${++orologioStati}` };
}

function statoMappa(rifiuti = {}) {
  return stato(MAPPA, "5", {
    ruolo: "mappa_allarme",
    dispositivo_trovato: true,
    programmi: [TOTALE, NOTTE],
    zone: [
      { numero: 1, entity_id: "binary_sensor.porta", nome: "Porta" },
      { numero: 2, entity_id: "binary_sensor.finestra", nome: "Finestra" },
    ],
    telecomandi: [{ numero: 1, entity_id: "switch.luce", nome: "Luce" }],
    allarme_generale: "binary_sensor.allarme",
    rifiuti,
  });
}

/** Una prova: una scheda nuova, uno stato iniziale, un gateway finto. */
function prepara({ totale = "armed_away", notte = "disarmed", rifiuti = {}, porta = "off", allarme = "off", gateway }) {
  timer.length = 0;
  const chiamate = [];
  const scheda = new Scheda();
  const casa = {
    stati: {
      [MAPPA]: statoMappa(rifiuti),
      [TOTALE.entity_id]: stato(TOTALE.entity_id, totale),
      [NOTTE.entity_id]: stato(NOTTE.entity_id, notte),
      "binary_sensor.porta": stato("binary_sensor.porta", porta, { device_class: "door" }),
      "binary_sensor.finestra": stato("binary_sensor.finestra", "off", { device_class: "window" }),
      "switch.luce": stato("switch.luce", "off"),
      "binary_sensor.allarme": stato("binary_sensor.allarme", allarme),
    },
  };

  const pubblica = () => {
    scheda.hass = {
      states: { ...casa.stati },
      formatEntityState: (s) => s.state,
      callService: async (dominio, servizio, dati) => {
        chiamate.push({ dominio, servizio, dati });
        if (gateway) return gateway({ dominio, servizio, dati, casa, cambia, rifiuta });
        return undefined;
      },
    };
  };
  // Il gateway risponde dopo un secondo, come farebbe la centrale.
  const cambia = (entita, valore) => impostaTimer(() => {
    casa.stati[entita] = stato(entita, valore, casa.stati[entita].attributes);
    pubblica();
  }, 1000);
  const rifiuta = (numero, esito, ts) => impostaTimer(() => {
    const vecchi = casa.stati[MAPPA].attributes.rifiuti || {};
    casa.stati[MAPPA] = statoMappa({ ...vecchi, [String(numero)]: { esito, programma: numero, ts } });
    pubblica();
  }, 1000);

  scheda.setConfig({ entity: MAPPA });
  pubblica();
  return { scheda, chiamate };
}

function digita(scheda, codice) { for (const cifra of codice) scheda._premi(cifra); }
function messaggio(scheda) { return scheda._messaggio ? scheda._messaggio.testo : ""; }
function bottoni(scheda) {
  return scheda._radice.tutti().filter((n) => n.tagName === "BUTTON");
}
function bottone(scheda, testo) { return bottoni(scheda).find((b) => b.textContent === testo); }

async function disinserisci(scheda, programmi, attesa = 1500) {
  const promessa = scheda._disinserisci(programmi);
  await svuota();
  await avanza(attesa);
  await promessa;
}

// ---------------------------------------------------------------------------
// Prove
// ---------------------------------------------------------------------------
const esiti = [];
function verifica(nome, condizione, dettaglio = "") { esiti.push({ nome, ok: Boolean(condizione), dettaglio }); }

async function prove() {
  // 1. il gateway accetta
  {
    const { scheda, chiamate } = prepara({
      gateway: ({ dati, cambia }) => { cambia(dati.entity_id, "disarmed"); },
    });
    digita(scheda, "1234");
    await disinserisci(scheda, [TOTALE]);
    verifica("disinserimento accettato: un comando con il codice",
      chiamate.length === 1 && chiamate[0].servizio === "alarm_disarm" && chiamate[0].dati.code === "1234",
      JSON.stringify(chiamate));
    verifica("disinserimento accettato: messaggio di conferma", messaggio(scheda) === "Disinserito", messaggio(scheda));
    verifica("dopo il tentativo il codice e' cancellato", scheda._codice === "", scheda._codice);
    verifica("dopo il tentativo la scheda non e' piu' occupata", scheda._occupato === false);
  }

  // 2. codice sbagliato, rifiutato dal gateway
  {
    const { scheda } = prepara({
      gateway: ({ rifiuta }) => { rifiuta(1, "codice_errato", 500); },
    });
    digita(scheda, "9999");
    await disinserisci(scheda, [TOTALE]);
    verifica("rifiuto del gateway: «Codice errato»", messaggio(scheda) === "Codice errato", messaggio(scheda));
  }

  // 3. un rifiuto VECCHIO non va scambiato per l'esito di questo tentativo
  {
    const { scheda } = prepara({
      rifiuti: { 1: { esito: "codice_errato", programma: 1, ts: 100 } },
      gateway: () => {},  // il gateway non risponde affatto
    });
    digita(scheda, "1234");
    await disinserisci(scheda, [TOTALE], 16000);
    verifica("rifiuto vecchio ignorato: si arriva al tempo scaduto",
      messaggio(scheda) === "Nessuna risposta dalla centrale", messaggio(scheda));
  }

  // 4. «Tutto»: il primo passa, il secondo viene rifiutato
  {
    const { scheda, chiamate } = prepara({
      notte: "armed_away",
      gateway: ({ dati, cambia, rifiuta }) => {
        if (dati.entity_id === TOTALE.entity_id) cambia(TOTALE.entity_id, "disarmed");
        else rifiuta(2, "codice_errato", 900);
      },
    });
    digita(scheda, "1234");
    const promessa = scheda._disinserisci(scheda._disinseribiliOra());
    await svuota();
    await avanza(1500);
    await avanza(1500);
    await promessa;
    verifica("tutto: due comandi, nell'ordine della centrale",
      chiamate.map((c) => c.dati.entity_id).join(",") === `${TOTALE.entity_id},${NOTTE.entity_id}`,
      chiamate.map((c) => c.dati.entity_id).join(","));
    verifica("tutto: il messaggio dice quanti sono passati",
      messaggio(scheda) === "Disinseriti 1 su 2, poi: Codice errato", messaggio(scheda));
  }

  // 5. «Tutto» si ferma al primo rifiuto
  {
    const { scheda, chiamate } = prepara({
      notte: "armed_away",
      gateway: ({ rifiuta }) => { rifiuta(1, "codice_errato", 700); },
    });
    digita(scheda, "0000");
    await disinserisci(scheda, scheda._disinseribiliOra());
    verifica("tutto: dopo un codice errato non si prova il programma successivo",
      chiamate.length === 1, `${chiamate.length} comandi`);
  }

  // 6. gateway precedente alla V0.8.31: il codice lo verifica ancora Home Assistant
  {
    const { scheda, chiamate } = prepara({
      gateway: () => { throw { message: "Invalid alarm code provided" }; },
    });
    digita(scheda, "1111");
    await disinserisci(scheda, [TOTALE]);
    verifica("errore di Home Assistant sul codice: «Codice errato»",
      messaggio(scheda) === "Codice errato" && chiamate.length === 1, messaggio(scheda));
  }

  // 7. un esito sconosciuto non deve mai dire «codice errato»
  {
    const { scheda } = prepara({
      gateway: ({ rifiuta }) => { rifiuta(1, "centrale_non_risponde", 800); },
    });
    digita(scheda, "1234");
    await disinserisci(scheda, [TOTALE]);
    verifica("esito sconosciuto: messaggio generico, non «codice errato»",
      messaggio(scheda) === "Il gateway non ha eseguito il comando (centrale_non_risponde)",
      messaggio(scheda));
  }

  // 8. il codice non si vede mai
  {
    const { scheda } = prepara({});
    digita(scheda, "1234");
    const mostrato = scheda._el.codice.textContent;
    verifica("il codice appare come pallini, mai come cifre",
      mostrato === "●●●●" && !/\d/.test(mostrato), mostrato);
  }

  // 9. il codice dimenticato si cancella da solo
  {
    const { scheda } = prepara({});
    digita(scheda, "12");
    await avanza(31000);
    verifica("codice cancellato dopo 30 secondi", scheda._codice === "", scheda._codice);
  }

  // 10. inserimento a un tocco, senza codice
  {
    const { scheda, chiamate } = prepara({ totale: "disarmed" });
    const inserisci = bottoni(scheda).find((b) => b.getAttribute("aria-label") === "Inserisci Totale");
    inserisci.click();
    await svuota();
    verifica("inserimento: arm_away senza codice",
      chiamate.length === 1 && chiamate[0].servizio === "alarm_arm_away" && !("code" in chiamate[0].dati),
      JSON.stringify(chiamate));
  }

  // 11. pulsanti di disinserimento solo per i programmi inseriti
  {
    const { scheda } = prepara({ totale: "armed_away", notte: "disarmed" });
    const testi = scheda._el.disinserimenti.figli.map((b) => b.textContent);
    verifica("disinserimento: «tutto» e il solo programma inserito",
      testi.join("|") === "Disinserisci tutto|Disinserisci Totale", testi.join("|"));
    verifica("disinserimento: pulsanti spenti finche' manca il codice",
      scheda._el.disinserimenti.figli.every((b) => b.disabled === true));
  }

  // 12. filtro delle zone aperte
  {
    const { scheda } = prepara({ porta: "on" });
    scheda._filtroZone = "aperte";
    scheda._firmaStati = null;
    scheda._aggiorna();
    const porta = scheda._el.zone.get("binary_sensor.porta").tessera;
    const finestra = scheda._el.zone.get("binary_sensor.finestra").tessera;
    verifica("filtro «aperte»: la porta aperta resta, la finestra chiusa sparisce",
      porta.hidden === false && finestra.hidden === true);
  }

  // 13. allarme in corso
  {
    const { scheda } = prepara({ allarme: "on" });
    verifica("allarme generale acceso: fascia rossa visibile", scheda._el.banner.hidden === false);
  }
  {
    const { scheda } = prepara({ allarme: "off" });
    verifica("allarme generale spento: fascia nascosta", scheda._el.banner.hidden === true);
  }

  // 14. mappa senza centrale
  {
    timer.length = 0;
    const scheda = new Scheda();
    scheda.setConfig({ entity: MAPPA });
    scheda.hass = {
      states: { [MAPPA]: stato(MAPPA, "0", { ruolo: "mappa_allarme", dispositivo_trovato: false }) },
      formatEntityState: (s) => s.state,
      callService: async () => {},
    };
    const testo = scheda._radice.textContent;
    verifica("centrale non pubblicata: avviso che spiega cosa controllare",
      testo.includes("Nessuna centrale Tecnoalarm"), testo.slice(0, 80));
  }
}

prove()
  .then(() => {
    const falliti = esiti.filter((e) => !e.ok);
    const larghezza = Math.max(...esiti.map((e) => e.nome.length));
    for (const e of esiti) {
      console.log(`${e.ok ? "ok  " : "FALLITO"} ${e.nome.padEnd(larghezza)}${e.ok ? "" : `   ${e.dettaglio}`}`);
    }
    console.log("");
    if (falliti.length) {
      console.log(`SCHEDA: ${falliti.length} controlli falliti su ${esiti.length}`);
      process.exit(1);
    }
    console.log(`SCHEDA: TUTTI I CONTROLLI SUPERATI (${esiti.length})`);
  })
  .catch((errore) => {
    console.error("Errore durante le prove:", errore);
    process.exit(1);
  });
