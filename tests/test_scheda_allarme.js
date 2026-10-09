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

// Il gateway pubblica l'azzeramento memorie dalla V0.8.55: con i gateway
// vecchi le due chiavi non ci sono proprio.
let memorieNellaMappa = false;

// Le spie «zone aperte» arrivano dalla V0.8.55: {numero: {stato, zone, totale}}.
let spieNellaMappa = {};

// L'interruttore di scavalco, anche lui dalla V0.8.55.
let scavalcoNellaMappa = false;

function statoMappa(rifiuti = {}) {
  return stato(MAPPA, "5", {
    ruolo: "mappa_allarme",
    ...(memorieNellaMappa
      ? { azzera_memorie: "button.azzera_memorie", memorie: "binary_sensor.memorie" }
      : {}),
    dispositivo_trovato: true,
    programmi: [TOTALE, NOTTE].map((p) => ({
      ...p,
      zone_aperte: spieNellaMappa[p.numero] ? `binary_sensor.zoneap_${p.numero}` : null,
    })),
    zone: [
      // La 1 ha casa, la 2 no: cosi' si prova anche il gruppo di coda.
      { numero: 1, entity_id: "binary_sensor.porta", nome: "Porta",
        area: "Salotto", piano: "Piano Terra" },
      { numero: 2, entity_id: "binary_sensor.finestra", nome: "Finestra",
        area: null, piano: null },
    ],
    telecomandi: [{ numero: 1, entity_id: "switch.luce", nome: "Luce" }],
    allarme_generale: "binary_sensor.allarme",
    ...(scavalcoNellaMappa ? { consenti_zone_aperte: "switch.consenti" } : {}),
    rifiuti,
  });
}

/** Una prova: una scheda nuova, uno stato iniziale, un gateway finto. */
function prepara({ totale = "armed_away", notte = "disarmed", rifiuti = {}, porta = "off", allarme = "off", gateway, registro, memorie, spie, scavalco, esclusaPorta = false, config }) {
  timer.length = 0;
  memorieNellaMappa = memorie !== undefined;
  spieNellaMappa = spie || {};
  scavalcoNellaMappa = Boolean(scavalco);
  const chiamate = [];
  const scheda = new Scheda();
  const casa = {
    stati: {
      [MAPPA]: statoMappa(rifiuti),
      [TOTALE.entity_id]: stato(TOTALE.entity_id, totale),
      [NOTTE.entity_id]: stato(NOTTE.entity_id, notte),
      "binary_sensor.porta": stato("binary_sensor.porta", porta, {
        device_class: "door", ...(esclusaPorta ? { esclusa: true } : {}),
      }),
      "binary_sensor.finestra": stato("binary_sensor.finestra", "off", { device_class: "window" }),
      "switch.luce": stato("switch.luce", "off"),
      "binary_sensor.allarme": stato("binary_sensor.allarme", allarme),
    },
  };

  if (memorie !== undefined) {
    casa.stati["binary_sensor.memorie"] = stato("binary_sensor.memorie", memorie, { device_class: "problem" });
    casa.stati["button.azzera_memorie"] = stato("button.azzera_memorie", "unknown");
  }

  if (scavalcoNellaMappa) casa.stati["switch.consenti"] = stato("switch.consenti", "off");

  for (const [numero, spia] of Object.entries(spieNellaMappa)) {
    const id = `binary_sensor.zoneap_${numero}`;
    const nomi = spia.zone || [];
    casa.stati[id] = stato(id, spia.stato, {
      ruolo: "zone_aperte_programma",
      programma: Number(numero),
      device_class: "problem",
      zone_aperte: nomi,
      totale: spia.totale === undefined ? nomi.length : spia.totale,
    });
  }

  // Il registro eventi: entita' con un identificativo qualunque, perche' la
  // scheda deve trovarla dall'attributo 'ruolo' e non dal nome. Accanto, due
  // esche: un'altra entita' con un attributo 'eventi' (come il cancello Nice,
  // che su un impianto vero c'e' davvero) e la mappa stessa.
  if (registro) {
    casa.stati["sensor.un_nome_qualunque"] = stato(
      "sensor.un_nome_qualunque",
      registro.stato === undefined ? (registro.eventi || [])[0] || "" : registro.stato,
      {
        ruolo: "registro_eventi",
        eventi: registro.eventi || [],
        totale: registro.totale,
        aggiornato: registro.aggiornato,
      }
    );
    casa.stati["sensor.cancello_registro"] = stato("sensor.cancello_registro", "x", {
      ruolo: "mappa_cancello",
      eventi: ["non sono io"],
    });
  }

  const pubblica = () => {
    scheda.hass = {
      states: { ...casa.stati },
      formatEntityState: (s) => s.state,
      callService: async (dominio, servizio, dati, bersaglio) => {
        // Il bersaglio conta: i pulsanti ricevono l'entita' li', non nei dati.
        chiamate.push({ dominio, servizio, dati, bersaglio });
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
  const rifiuta = (numero, esito, ts, extra = {}) => impostaTimer(() => {
    const vecchi = casa.stati[MAPPA].attributes.rifiuti || {};
    casa.stati[MAPPA] = statoMappa({
      ...vecchi,
      [String(numero)]: { esito, programma: numero, ts, ...extra },
    });
    pubblica();
  }, 1000);

  scheda.setConfig({ entity: MAPPA, ...(config || {}) });
  pubblica();
  return { scheda, chiamate, casa, pubblica };
}

/** Digita il codice come l'utente: se il dialogo non c'e', lo apre dalla riga. */
function digita(scheda, codice, programma = TOTALE) {
  if (scheda._el.dialogo.velo.hidden) apriDisinserimento(scheda, programma);
  for (const cifra of codice) scheda._premi(cifra);
}
/** Il pulsante della riga: con il programma inserito apre il dialogo del codice. */
function apriDisinserimento(scheda, programma = TOTALE) {
  scheda._el.programmi.get(programma.entity_id).bottone.click();
}
function azioneDialogo(scheda, etichetta) {
  return scheda._el.dialogo.azioni.figli.find((b) => b.textContent === etichetta);
}
function tastiDisinserimento(scheda) {
  return scheda._el.disinserimenti ? scheda._el.disinserimenti.figli.map((b) => b.textContent) : [];
}
/** La riga del programma: elemento della spia, testo, tono, bottone. */
function rigaProgramma(scheda, programma) {
  const voce = scheda._el.programmi.get(programma.entity_id);
  return {
    spia: voce.zoneAperte,
    testo: voce.zoneAperte.hidden ? "" : voce.zoneAperte.textContent,
    tono: voce.zoneAperte.dataset.tono,
    bottone: voce.bottone,
  };
}
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

  // 11. il dialogo del disinserimento
  {
    // Un programma solo inserito: niente «tutto», sarebbe lo stesso pulsante
    // scritto due volte.
    const { scheda } = prepara({ totale: "armed_away", notte: "disarmed" });
    verifica("a riposo il dialogo e' chiuso", scheda._el.dialogo.velo.hidden === true);
    apriDisinserimento(scheda);
    verifica("il pulsante della riga apre il dialogo",
      scheda._el.dialogo.velo.hidden === false && Boolean(scheda._el.codice));
    verifica("un solo programma inserito: nessun «tutto»",
      tastiDisinserimento(scheda).join("|") === "Disinserisci Totale",
      tastiDisinserimento(scheda).join("|"));
    verifica("pulsanti spenti finche' manca il codice",
      scheda._el.disinserimenti.figli.every((b) => b.disabled === true));
  }
  {
    // Due inseriti: prima quello da cui sei entrato, poi «tutto», poi l'altro.
    const { scheda } = prepara({ totale: "armed_away", notte: "armed_away" });
    apriDisinserimento(scheda, NOTTE);
    verifica("si entra da Notte: Notte per primo, poi tutto, poi Totale",
      tastiDisinserimento(scheda).join("|")
        === "Disinserisci Notte|Disinserisci tutto|Disinserisci Totale",
      tastiDisinserimento(scheda).join("|"));
  }
  {
    // Annulla: via il dialogo e via il codice gia' digitato.
    const { scheda, chiamate } = prepara({ totale: "armed_away" });
    digita(scheda, "1234");
    azioneDialogo(scheda, "Annulla").click();
    verifica("Annulla: dialogo chiuso, codice dimenticato, nessun comando",
      scheda._el.dialogo.velo.hidden === true && scheda._codice === "" && chiamate.length === 0,
      `${scheda._codice}/${chiamate.length}`);
  }
  {
    // A tutto schermo solo il dialogo con il tastierino: una domanda da due
    // righe presa a tutta pagina sarebbe sproporzionata.
    const { scheda } = prepara({ totale: "armed_away", memorie: "on" });
    apriDisinserimento(scheda);
    verifica("il dialogo del codice chiede lo schermo intero",
      scheda._el.dialogo.riquadro.classList.contains("pieno"));
    azioneDialogo(scheda, "Annulla").click();
    scheda._el.memorie.bottone.click();
    verifica("la conferma delle memorie resta una finestrella",
      scheda._el.dialogo.riquadro.classList.contains("pieno") === false);
  }
  {
    // Il tastierino non sta piu' nel corpo della scheda.
    const { scheda } = prepara({ totale: "armed_away" });
    verifica("niente tastierino fisso sotto i programmi",
      scheda._radice.tutti().filter((n) => n.className === "tasto").length === 0);
  }
  {
    // Riuscito: il dialogo si toglie di mezzo da solo.
    const { scheda } = prepara({
      totale: "armed_away",
      gateway: ({ cambia }) => cambia(TOTALE.entity_id, "disarmed"),
    });
    digita(scheda, "1234");
    scheda._el.disinserimenti.figli[0].click();
    await svuota();
    await avanza(1500);
    verifica("disinserito: il dialogo si chiude e il messaggio resta sotto",
      scheda._el.dialogo.velo.hidden === true && messaggio(scheda) === "Disinserito",
      messaggio(scheda));
  }
  {
    // Codice errato: il dialogo resta aperto, cosi' si ridigita senza
    // ricominciare dalla riga del programma.
    const { scheda } = prepara({
      totale: "armed_away",
      gateway: ({ rifiuta }) => rifiuta(1, "codice_errato", 950),
    });
    digita(scheda, "9999");
    scheda._el.disinserimenti.figli[0].click();
    await svuota();
    await avanza(1500);
    verifica("codice errato: dialogo aperto e codice azzerato",
      scheda._el.dialogo.velo.hidden === false && scheda._codice === ""
      && messaggio(scheda) === "Codice errato", messaggio(scheda));
  }

  // 12. filtro delle zone: si parte da quelle da verificare
  {
    const { scheda } = prepara({ porta: "on" });
    const porta = scheda._el.zone.get("binary_sensor.porta").tessera;
    const finestra = scheda._el.zone.get("binary_sensor.finestra").tessera;
    verifica("all'apertura si vedono solo le zone da verificare",
      scheda._filtroZone === "verificare" && porta.hidden === false && finestra.hidden === true,
      scheda._filtroZone);
    verifica("il tasto «Da verificare» risulta quello premuto",
      bottoni(scheda).find((b) => b.textContent === "Da verificare")
        .getAttribute("aria-pressed") === "true");
    bottoni(scheda).find((b) => b.textContent === "Tutte").click();
    verifica("premuto «Tutte» tornano tutte",
      scheda._filtroZone === "tutte" && porta.hidden === false && finestra.hidden === false);
  }
  {
    // Niente da verificare: l'elenco e' vuoto e lo dice, invece di un buco.
    const { scheda } = prepara({ porta: "off" });
    verifica("niente da verificare: lo si scrive",
      scheda._el.vuotoZone.hidden === false
      && scheda._el.vuotoZone.textContent === "Nessuna zona da verificare.",
      scheda._el.vuotoZone.textContent);
    verifica("niente da verificare: il conteggio non parla di segnalazioni",
      scheda._el.conteggioZone.textContent === "tutte chiuse · 2",
      scheda._el.conteggioZone.textContent);
  }
  {
    // Una zona ESCLUSA e chiusa: non impedisce l'inserimento, ma e' proprio
    // quella che vuoi vedere prima di inserire. Prima spariva.
    const { scheda } = prepara({ porta: "off", esclusaPorta: true });
    const porta = scheda._el.zone.get("binary_sensor.porta").tessera;
    verifica("zona esclusa e chiusa: resta in vista", porta.hidden === false);
    verifica("il conteggio dice che c'e' una segnalazione",
      scheda._el.conteggioZone.textContent === "tutte chiuse · 2 · 1 segnalata",
      scheda._el.conteggioZone.textContent);
  }
  {
    // Una zona che non risponde: non sappiamo com'e', e non saperlo e' gia'
    // un motivo per guardarla.
    const { scheda } = prepara({ porta: "unavailable" });
    verifica("zona che non risponde: resta in vista",
      scheda._el.zone.get("binary_sensor.porta").tessera.hidden === false);
  }

  // 12-bis. raggruppamento delle zone
  const titoliGruppi = (scheda) => scheda._el.gruppiZone
    .filter((g) => !g.blocco.hidden)
    .map((g) => (g.titolo && !g.titolo.hidden ? g.titolo.textContent : "(senza titolo)"));
  {
    // Predefinito: per piano, e chi non ce l'ha va in fondo.
    const { scheda } = prepara({ porta: "on" });
    bottoni(scheda).find((b) => b.textContent === "Tutte").click();
    verifica("predefinito: si raggruppa per piano",
      scheda._raggruppa === "piano"
      && titoliGruppi(scheda).join("|") === "Piano Terra|Senza piano",
      titoliGruppi(scheda).join("|"));
  }
  {
    const { scheda } = prepara({ porta: "on", config: { raggruppa: "area" } });
    bottoni(scheda).find((b) => b.textContent === "Tutte").click();
    verifica("per area: i titoli sono le stanze",
      titoliGruppi(scheda).join("|") === "Salotto|Senza area",
      titoliGruppi(scheda).join("|"));
  }
  {
    const { scheda } = prepara({ porta: "on", config: { raggruppa: "nessuno" } });
    bottoni(scheda).find((b) => b.textContent === "Tutte").click();
    verifica("nessun raggruppamento: un gruppo solo e senza titolo",
      titoliGruppi(scheda).join("|") === "(senza titolo)",
      titoliGruppi(scheda).join("|"));
  }
  {
    // Un valore scritto a mano che non esiste non deve rompere la scheda.
    const { scheda } = prepara({ porta: "on", config: { raggruppa: "per stanza" } });
    verifica("valore sconosciuto: si ripiega sul predefinito",
      scheda._raggruppa === "piano", scheda._raggruppa);
  }
  {
    // In «Da verificare» i titoli spariscono e i gruppi vuoti con loro:
    // un'intestazione sopra una tessera sola e' rumore.
    const { scheda } = prepara({ porta: "on" });
    verifica("da verificare: nessun titolo e solo il gruppo che ha qualcosa",
      titoliGruppi(scheda).join("|") === "(senza titolo)",
      titoliGruppi(scheda).join("|"));
    verifica("da verificare: il gruppo senza tessere visibili sparisce",
      scheda._el.gruppiZone.filter((g) => !g.blocco.hidden).length === 1,
      String(scheda._el.gruppiZone.filter((g) => !g.blocco.hidden).length));
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

  // 14. registro eventi
  {
    // Gateway piu' vecchio della V0.8.54: l'entita' non esiste e il blocco non
    // si vede, ma la scheda funziona come prima.
    const { scheda } = prepara({});
    verifica("registro assente: blocco nascosto e scheda viva",
      scheda._idRegistro === null && scheda._el.registro.sezione.hidden === true
      && scheda._el.programmi.size === 2,
      `id=${scheda._idRegistro}`);
  }
  {
    const EVENTI = [
      "07/10/26 07:09:13 Disin.  Utente 1 [GIOVANNI] Program. 2 [NOTTE] Monitor",
      "06/10/26 22:38:38 Accesso Disp. TCPIP",
      "06/10/26 20:41:45 Inser.  Utente 1 [GIOVANNI] Program. 2 [NOTTE] Tastiera 1",
      "riga senza data, come non dovrebbe mai arrivare",
    ];
    const { scheda } = prepara({
      registro: { eventi: EVENTI, totale: 312, aggiornato: "2026-10-07T19:43:35.342Z" },
    });
    const voce = scheda._el.registro;
    verifica("registro trovato dall'attributo, non dal nome dell'entita'",
      scheda._idRegistro === "sensor.un_nome_qualunque", String(scheda._idRegistro));
    verifica("registro: blocco visibile", voce.sezione.hidden === false);

    const righe = voce.lista.figli.filter((n) => n.className === "evento");
    verifica("registro: una riga per evento, nell'ordine ricevuto", righe.length === 4, String(righe.length));

    const pezzi = (riga) => riga.tutti().filter((n) => ["data", "ora", "cosa"].includes(n.className))
      .map((n) => n.textContent);
    verifica("registro: data e ora separate dalla descrizione, che resta com'e'",
      JSON.stringify(pezzi(righe[0])) === JSON.stringify([
        "07/10/26", "07:09:13", "Disin.  Utente 1 [GIOVANNI] Program. 2 [NOTTE] Monitor",
      ]), JSON.stringify(pezzi(righe[0])));
    verifica("registro: riga senza data mostrata tutta come descrizione",
      JSON.stringify(pezzi(righe[3])) === JSON.stringify([
        "", "", "riga senza data, come non dovrebbe mai arrivare",
      ]), JSON.stringify(pezzi(righe[3])));

    const icone = righe.map((r) => r.tutti().find((n) => n.className === "icona-evento").attributi.icon);
    verifica("registro: icona dalla prima parola, generica per il resto",
      JSON.stringify(icone) === JSON.stringify([
        "mdi:shield-off-outline", "mdi:account-key", "mdi:shield-lock", "mdi:information-outline",
      ]), JSON.stringify(icone));

    verifica("registro: «ultimi 4 di 312» quando il gateway ne ha di piu'",
      voce.conteggio.textContent === "ultimi 4 di 312", voce.conteggio.textContent);
    verifica("registro: la nota rimanda alla Dashboard del gateway",
      voce.nota.textContent.includes("Dashboard del gateway"), voce.nota.textContent);
  }
  {
    const { scheda } = prepara({ registro: { eventi: ["07/10/26 07:09:13 Disin.  Utente 1"], totale: 1 } });
    verifica("registro: con un evento solo si dice «1 evento»",
      scheda._el.registro.conteggio.textContent === "1 evento",
      scheda._el.registro.conteggio.textContent);
  }
  {
    const { scheda } = prepara({ registro: { eventi: [], totale: 0 } });
    const voce = scheda._el.registro;
    verifica("registro vuoto: lo dice e spiega perche' puo' esserlo",
      voce.conteggio.textContent === "nessun evento"
      && voce.lista.textContent.includes("entro un minuto"),
      `${voce.conteggio.textContent} | ${voce.lista.textContent}`);
  }
  {
    const { scheda } = prepara({ registro: { eventi: [], stato: "unavailable" } });
    verifica("registro non disponibile: non si finge che sia vuoto",
      scheda._el.registro.conteggio.textContent === "non disponibile",
      scheda._el.registro.conteggio.textContent);
  }

  // 15. memorie di allarme
  {
    const { scheda } = prepara({});
    verifica("gateway senza azzeramento: blocco memorie nascosto",
      scheda._el.memorie.sezione.hidden === true);
  }
  {
    const { scheda } = prepara({ memorie: "off" });
    const m = scheda._el.memorie;
    verifica("spia spenta: blocco visibile e scritta «nessuna»",
      m.sezione.hidden === false && m.stato.textContent === "nessuna", m.stato.textContent);
    verifica("spia spenta: il pulsante resta premibile",
      m.bottone.disabled === false);
  }
  {
    const { scheda } = prepara({ memorie: "on" });
    const m = scheda._el.memorie;
    verifica("spia accesa: «presenti», in tono di attenzione",
      m.stato.textContent === "presenti" && m.stato.dataset.tono === "attenzione"
      && m.sezione.dataset.memorie === "si",
      `${m.stato.textContent} ${m.stato.dataset.tono} ${m.sezione.dataset.memorie}`);
  }
  {
    const { scheda } = prepara({ memorie: "unavailable" });
    verifica("spia non disponibile: lo dice e lascia premere",
      scheda._el.memorie.stato.textContent === "spia non disponibile"
      && scheda._el.memorie.bottone.disabled === false,
      scheda._el.memorie.stato.textContent);
  }
  {
    // Si preme: prima la conferma, nessun comando.
    const { scheda, chiamate } = prepara({ memorie: "on" });
    scheda._el.memorie.bottone.click();
    verifica("azzeramento: prima la domanda, nessun comando",
      scheda._el.velo.hidden === false && chiamate.length === 0, String(chiamate.length));
    const testo = scheda._el.velo.textContent;
    verifica("la domanda dice quali memorie NON cadono",
      /manomissione, errore e guasto/.test(testo) && /codice installatore/.test(testo),
      testo.slice(0, 80));
    bottoni(scheda).find((b) => b.textContent === "Annulla").click();
    verifica("annullato: velo chiuso e nessun comando",
      scheda._el.velo.hidden === true && chiamate.length === 0);
  }
  {
    const { scheda, chiamate } = prepara({ memorie: "on" });
    scheda._el.memorie.bottone.click();
    bottoni(scheda).find((b) => b.textContent === "Azzera").click();
    await svuota();
    verifica("confermato: button.press sul pulsante del gateway",
      chiamate.length === 1 && chiamate[0].dominio === "button"
      && chiamate[0].servizio === "press"
      && chiamate[0].bersaglio.entity_id === "button.azzera_memorie",
      JSON.stringify(chiamate));
    verifica("confermato: si dice solo «comando inviato»",
      messaggio(scheda) === "Comando inviato", messaggio(scheda));

    // La spia si spegne: solo adesso si puo' dire che sono state azzerate.
    scheda.hass = {
      ...scheda._hass,
      states: { ...scheda._hass.states, "binary_sensor.memorie": stato("binary_sensor.memorie", "off") },
    };
    verifica("spia che si spegne: «memorie azzerate»",
      messaggio(scheda) === "Memorie azzerate", messaggio(scheda));
  }
  {
    // Spia gia' spenta: non si annuncia un successo che non si puo' vedere.
    const { scheda, chiamate } = prepara({ memorie: "off" });
    scheda._el.memorie.bottone.click();
    bottoni(scheda).find((b) => b.textContent === "Azzera").click();
    await svuota();
    verifica("spia gia' spenta: comando mandato ma nessun annuncio di successo",
      chiamate.length === 1 && messaggio(scheda) === "Comando inviato", messaggio(scheda));
  }

  // 16. spia «zone aperte» per programma
  {
    // Programma disinserito con due zone istantanee aperte: si dice quante e
    // quali, e il pulsante resta premibile — la centrale le esclude da se'.
    const { scheda } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: ["FINESTRA CUCINA", "FIN.BAGNO P.T."] }, 2: { stato: "off" } },
    });
    const riga = rigaProgramma(scheda, TOTALE);
    verifica("zone aperte: quante e quali, in evidenza",
      riga.testo === "2 zone aperte: FINESTRA CUCINA, FIN.BAGNO P.T." && riga.tono === "aperte",
      riga.testo);
    verifica("zone aperte: l'inserimento resta possibile",
      riga.bottone.hidden === false && riga.bottone.disabled === false);
    // Sulle righe dei programmi, non in tutta la radice: il foglio di stile
    // nomina l'esclusione in un commento, e li' e' una spiegazione per chi
    // legge il codice, non una promessa all'utente.
    verifica("zone aperte: non si promette l'esclusione",
      !/esclus/i.test(scheda._el.programmi.get(TOTALE.entity_id).riga.textContent));
  }
  {
    // Spenta: la riga resta pulita. Mai scrivere «tutto chiuso»: la spia conta
    // solo le istantanee, e una ritardata aperta la lascia spenta.
    const { scheda } = prepara({ totale: "disarmed", spie: { 1: { stato: "off" } } });
    const riga = rigaProgramma(scheda, TOTALE);
    verifica("spia spenta: niente sulla riga", riga.spia.hidden === true, riga.spia.textContent);
    // Sulla riga, non in tutta la scheda: il blocco delle zone ha una sua
    // scritta «Nessuna zona aperta», che li' e' giusta.
    verifica("spia spenta: nessun «tutto chiuso» sulla riga",
      !/chius|a posto|nessuna zona/i.test(
        scheda._el.programmi.get(TOTALE.entity_id).riga.textContent));
  }
  {
    // Scaduta per silenzio del gateway: lo si dice. Il silenzio non vale come
    // «si puo' inserire».
    const { scheda } = prepara({ totale: "disarmed", spie: { 1: { stato: "unavailable" } } });
    const riga = rigaProgramma(scheda, TOTALE);
    verifica("spia non disponibile: lo dice invece di tacere",
      riga.testo === "zone aperte: non noto" && riga.tono === "ignoto", riga.testo);
    verifica("spia non disponibile: l'inserimento resta possibile",
      riga.bottone.hidden === false && riga.bottone.disabled === false);
  }
  {
    // Gateway precedente alla V0.8.55: la spia non c'e' e non si vede nulla.
    const { scheda } = prepara({ totale: "disarmed" });
    const riga = rigaProgramma(scheda, TOTALE);
    verifica("gateway vecchio: nessuna riga della spia", riga.spia.hidden === true);
    verifica("gateway vecchio: niente 'undefined' nella scheda",
      !/undefined|non noto/i.test(scheda._radice.textContent));
  }
  {
    // Tante zone: non si allunga la riga all'infinito.
    const { scheda } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: ["UNO", "DUE", "TRE", "QUATTRO", "CINQUE"] } },
    });
    verifica("molte zone: elenco troncato con il conto del resto",
      rigaProgramma(scheda, TOTALE).testo === "5 zone aperte: UNO, DUE, TRE e altre 2",
      rigaProgramma(scheda, TOTALE).testo);
  }
  {
    // Tre nomi: si scrivono tutti, invece di troncarne uno per due parole.
    const { scheda } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: ["UNO", "DUE", "TRE"] } },
    });
    verifica("tre zone: nessun troncamento",
      rigaProgramma(scheda, TOTALE).testo === "3 zone aperte: UNO, DUE, TRE",
      rigaProgramma(scheda, TOTALE).testo);
  }
  {
    // Quattro: una sola avanza, e «e altre 1» non si legge in italiano.
    const { scheda } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: ["UNO", "DUE", "TRE", "QUATTRO"] } },
    });
    verifica("ne avanza una: «e un'altra», mai «e altre 1»",
      rigaProgramma(scheda, TOTALE).testo === "4 zone aperte: UNO, DUE, TRE e un'altra",
      rigaProgramma(scheda, TOTALE).testo);
  }
  {
    // La spia che si spegne deve far ridisegnare la riga: se finisse fuori
    // dalla firma degli stati, resterebbe scritto «2 zone aperte» con tutto
    // chiuso.
    const { scheda, casa, pubblica } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: ["UNO", "DUE"] } },
    });
    verifica("prima: la riga c'e'", rigaProgramma(scheda, TOTALE).testo.startsWith("2 zone"));
    casa.stati["binary_sensor.zoneap_1"] = stato("binary_sensor.zoneap_1", "off", {
      ...casa.stati["binary_sensor.zoneap_1"].attributes, zone_aperte: [], totale: 0,
    });
    pubblica();
    verifica("zone chiuse: la riga sparisce subito",
      rigaProgramma(scheda, TOTALE).spia.hidden === true,
      rigaProgramma(scheda, TOTALE).spia.textContent);
  }
  {
    // Una zona sola: in italiano, al singolare.
    const { scheda } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: ["PORTA INGRESSO"] } },
    });
    verifica("una sola: «1 zona aperta»",
      rigaProgramma(scheda, TOTALE).testo === "1 zona aperta: PORTA INGRESSO",
      rigaProgramma(scheda, TOTALE).testo);
  }
  {
    // Spia accesa ma senza l'elenco dei nomi (gateway parlante a meta'):
    // si dice il numero e basta, senza inventare nomi.
    const { scheda } = prepara({
      totale: "disarmed",
      spie: { 1: { stato: "on", zone: [], totale: 3 } },
    });
    verifica("accesa senza nomi: solo il conto",
      rigaProgramma(scheda, TOTALE).testo === "3 zone aperte",
      rigaProgramma(scheda, TOTALE).testo);
  }

  // 17. inserimento rifiutato dal gateway (modo 4 «rifiuta se ci sono zone aperte»)
  {
    // Il pulsante torna al suo posto e l'impianto resta disinserito: senza un
    // messaggio l'utente non ha modo di sapere perche'.
    const { scheda } = prepara({
      totale: "disarmed",
      notte: "armed_away",
      spie: { 1: { stato: "on", zone: ["FINESTRA CUCINA", "PORTAFINESTRA SALOTTO"] } },
      gateway: ({ servizio, rifiuta }) => {
        if (servizio === "alarm_arm_away") {
          rifiuta(1, "zone_aperte", 777, { zone_aperte: ["FINESTRA CUCINA", "PORTAFINESTRA SALOTTO"] });
        }
      },
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("inserimento rifiutato: si dice quali zone",
      messaggio(scheda) === "Totale: non inserito, 2 zone aperte: FINESTRA CUCINA, PORTAFINESTRA SALOTTO",
      messaggio(scheda));
  }
  {
    // Rifiuto senza l'elenco dei nomi: si dice comunque che non e' inserito.
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away",
      gateway: ({ servizio, rifiuta }) => {
        if (servizio === "alarm_arm_away") rifiuta(1, "zone_aperte", 778);
      },
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("rifiuto senza nomi: niente elenco inventato",
      messaggio(scheda) === "Totale: non inserito: ci sono zone aperte", messaggio(scheda));
  }
  {
    // Inserimento riuscito: nessun messaggio. Il silenzio e' la risposta giusta
    // quando la riga del programma dice gia' «Inserito».
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away",
      gateway: ({ servizio, cambia }) => {
        if (servizio === "alarm_arm_away") cambia(TOTALE.entity_id, "armed_away");
      },
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("inserimento riuscito: nessun messaggio", messaggio(scheda) === "", messaggio(scheda));
  }
  {
    // Un rifiuto VECCHIO, gia' nella mappa prima del comando, non va scambiato
    // per la risposta a questo tentativo: stesso ts, stessa storia di prima.
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away",
      rifiuti: { 1: { esito: "zone_aperte", programma: 1, ts: 500, zone_aperte: ["VECCHIA"] } },
      gateway: () => {},
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("rifiuto vecchio: non si annuncia", messaggio(scheda) === "", messaggio(scheda));
  }

  // 17-bis. esiti della V0.8.56 sull'argomento dei rifiuti
  {
    // Il gateway conferma di aver preso il comando mentre la centrale si
    // disinserisce. Prima della 0.8.56 su quell'argomento passavano solo i
    // fallimenti: letto alla vecchia maniera, un successo diventava
    // «il gateway non ha eseguito il comando (accettato)».
    const { scheda } = prepara({
      gateway: ({ servizio, rifiuta, cambia }) => {
        if (servizio !== "alarm_disarm") return;
        rifiuta(1, "accettato", 1200, { ok: true, messaggio: "Totale: comando accettato" });
        cambia(TOTALE.entity_id, "disarmed");
      },
    });
    digita(scheda, "1234");
    await disinserisci(scheda, [TOTALE], 2500);
    verifica("esito con ok: il disinserimento riesce lo stesso",
      messaggio(scheda) === "Disinserito", messaggio(scheda));
  }
  {
    // Un esito nuovo che la scheda non conosce: si mostra la frase del gateway
    // invece del testo generico con il nome in codice.
    const { scheda } = prepara({
      gateway: ({ rifiuta }) => rifiuta(1, "centrale_occupata", 1300,
        { ok: false, messaggio: "La centrale e' occupata, riprova fra poco" }),
    });
    digita(scheda, "1234");
    await disinserisci(scheda, [TOTALE]);
    verifica("esito sconosciuto con messaggio: parla il gateway",
      messaggio(scheda) === "La centrale e' occupata, riprova fra poco", messaggio(scheda));
  }
  {
    // Le nostre frasi restano quelle tarate: il messaggio del gateway non
    // scavalca un testo che conosciamo.
    const { scheda } = prepara({
      gateway: ({ rifiuta }) => rifiuta(1, "codice_errato", 1400,
        { ok: false, messaggio: "Codice non valido (gateway)" }),
    });
    digita(scheda, "9999");
    await disinserisci(scheda, [TOTALE]);
    verifica("esito conosciuto: vince la frase della scheda",
      messaggio(scheda) === "Codice errato", messaggio(scheda));
  }
  {
    // Inserimento: la conferma del gateway non deve aprire il dialogo.
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away", scavalco: true,
      gateway: ({ servizio, rifiuta }) => {
        if (servizio === "alarm_arm_away") {
          rifiuta(1, "accettato", 1500, { ok: true, messaggio: "Totale inserito" });
        }
      },
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("inserimento accettato: nessun dialogo e nessun allarme",
      scheda._el.velo.hidden === true && messaggio(scheda) === "", messaggio(scheda));
  }

  // 18. lo scavalco, dentro il rifiuto e solo li'
  const rifiutaZone = (ts) => ({ servizio, rifiuta, cambia }) => {
    if (servizio === "alarm_arm_away") rifiuta(1, "zone_aperte", ts, { zone_aperte: ["FIN.BAGNO P.T."] });
    if (servizio === "turn_on") cambia("switch.consenti", "on");
  };
  {
    // Rifiutato: si apre il dialogo con il motivo e le due scelte.
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away", scavalco: true, gateway: rifiutaZone(900),
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    const testo = scheda._el.velo.textContent;
    verifica("rifiuto: si apre il dialogo con i nomi delle zone",
      scheda._el.velo.hidden === false && testo.includes("Totale non inserito")
      && testo.includes("FIN.BAGNO P.T."), testo.slice(0, 90));
    verifica("rifiuto: le due scelte, Annulla e Inserisci comunque",
      scheda._el.dialogo.azioni.figli.map((b) => b.textContent).join("|")
        === "Annulla|Inserisci comunque",
      scheda._el.dialogo.azioni.figli.map((b) => b.textContent).join("|"));
    verifica("rifiuto: il dialogo avverte che le zone restano escluse",
      /fuori sorveglianza/i.test(testo));
  }
  {
    // Annulla: niente comandi, e l'impianto resta disinserito.
    const { scheda, chiamate } = prepara({
      totale: "disarmed", notte: "armed_away", scavalco: true, gateway: rifiutaZone(904),
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    chiamate.length = 0;
    azioneDialogo(scheda, "Annulla").click();
    await svuota();
    await avanza(1000);
    verifica("rifiuto annullato: dialogo chiuso e nessun comando",
      scheda._el.velo.hidden === true && chiamate.length === 0, String(chiamate.length));
  }
  {
    // Prima l'interruttore, poi il comando: all'incontrario l'inserimento
    // arriverebbe al gateway mentre lo scavalco e' ancora spento.
    const { scheda, chiamate } = prepara({
      totale: "disarmed", notte: "armed_away", scavalco: true, gateway: rifiutaZone(901),
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    chiamate.length = 0;
    azioneDialogo(scheda, "Inserisci comunque").click();
    await svuota();
    await avanza(4000);
    const ordine = chiamate.map((c) => `${c.dominio}.${c.servizio}`);
    verifica("scavalco: prima turn_on, poi l'inserimento",
      ordine[0] === "switch.turn_on" && ordine[1] === "alarm_control_panel.alarm_arm_away"
      && ordine.length === 2, ordine.join(" -> "));
  }
  {
    // Lo scavalco non si vede quando il rifiuto e' di un altro tipo: il codice
    // errato non si aggira accendendo un interruttore.
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away", scavalco: true,
      gateway: ({ servizio, rifiuta }) => {
        if (servizio === "alarm_arm_away") rifiuta(1, "codice_errato", 902);
      },
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("rifiuto di altro tipo: nessun dialogo, solo il messaggio",
      scheda._el.velo.hidden === true && messaggio(scheda) === "Totale: Codice errato",
      messaggio(scheda));
  }
  {
    // Gateway senza l'interruttore: si dice il rifiuto e basta, senza offrire
    // una via d'uscita che non esiste.
    const { scheda } = prepara({
      totale: "disarmed", notte: "armed_away", gateway: rifiutaZone(903),
    });
    scheda._el.programmi.get(TOTALE.entity_id).bottone.click();
    await svuota();
    await avanza(1500);
    verifica("gateway senza scavalco: solo il messaggio",
      scheda._el.velo.hidden === true
      && messaggio(scheda) === "Totale: non inserito, 1 zona aperta: FIN.BAGNO P.T.",
      messaggio(scheda));
  }
  {
    // A riposo non c'e': non deve essere un pulsante che si preme per
    // abitudine, e fuori da un rifiuto non ha senso.
    const { scheda } = prepara({ totale: "disarmed", notte: "armed_away", scavalco: true });
    verifica("senza rifiuto: nessun dialogo aperto", scheda._el.velo.hidden === true);
  }

  // 19. mappa senza centrale
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
