/**
 * Collaudo della configurazione con cui nasce la card della tastiera.
 *
 * Quando si aggiunge la card dal catalogo, Home Assistant le chiede la
 * configurazione di partenza (`getStubConfig`). Dalla 2.9.0 quella
 * configurazione porta gia' dentro la condizione di visibilita': spenta la
 * tastiera remota, la card non si mostra invece di restare li' a dire
 * TASTIERA NON CONNESSA.
 *
 * `getStubConfig` e' statica e tocca solo `hass.states`: qui si carica il file
 * vero con l'impalcatura minima che gli serve per essere letto, e si guarda
 * cosa risponde nei tre casi che contano.
 *
 *   node tests/test_stub_card.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------------------------------------------------------------------------
// L'impalcatura: il minimo perche' il file si lasci leggere
// ---------------------------------------------------------------------------
const registrati = {};
const contesto = {
  HTMLElement: class {},
  customElements: {
    get: (nome) => registrati[nome],
    define: (nome, classe) => { registrati[nome] = classe; },
  },
  document: { createElement: () => ({ addEventListener() {}, appendChild() {} }) },
  console: { info() {}, warn() {}, error() {} },
  CustomEvent: class {},
};
contesto.window = contesto;
vm.createContext(contesto);

const SORGENTE = path.join(
  __dirname, "..", "custom_components", "nexus_tecnoalarm", "www", "nexus-tecnoalarm-card.js"
);
vm.runInContext(fs.readFileSync(SORGENTE, "utf-8"), contesto, { filename: SORGENTE });

const Card = registrati["nexus-tecnoalarm-card"];

// ---------------------------------------------------------------------------
// Gli stati finti
// ---------------------------------------------------------------------------
const TASTIERA = "sensor.nexus_tecnoalarm_keypad";
const MAPPA = "sensor.tecnoalarm_mappa_allarme";
const INTERRUTTORE = "switch.salotto_tecnoalarm_tastiera_remota";

/** Il sensore della tastiera: la card lo riconosce dall'attributo 'programmi'. */
const sensoreTastiera = {
  entity_id: TASTIERA,
  state: "PRONTO",
  attributes: { programmi: [1, 2, 3] },
};

function mappa(extra = {}) {
  return {
    entity_id: MAPPA,
    state: "5",
    // La mappa ha anche lei 'programmi': la card deve scartarla guardando il ruolo.
    attributes: { ruolo: "mappa_allarme", programmi: [], zone: [], ...extra },
  };
}

const esiti = [];
function verifica(nome, condizione, dettaglio = "") {
  esiti.push({ nome, ok: Boolean(condizione), dettaglio });
}

// ---------------------------------------------------------------------------
// Le prove
// ---------------------------------------------------------------------------
{
  // Integrazione 2.9.0: la mappa dice qual e' l'interruttore.
  const config = Card.getStubConfig({
    states: {
      [TASTIERA]: sensoreTastiera,
      [MAPPA]: mappa({ interruttore_tastiera: INTERRUTTORE }),
    },
  });
  verifica("la card nasce sull'entita' della tastiera, non sulla mappa",
    config.entity === TASTIERA, config.entity);
  verifica("e nasce con la condizione sull'interruttore vero",
    Array.isArray(config.visibility)
    && config.visibility.length === 1
    && config.visibility[0].condition === "state"
    && config.visibility[0].entity_id === INTERRUTTORE
    && config.visibility[0].state === "on",
    JSON.stringify(config.visibility));
}
{
  // Integrazione precedente: la mappa c'e' ma non dice niente dell'interruttore.
  // Meglio nessuna condizione che una condizione su un'entita' indovinata.
  const config = Card.getStubConfig({
    states: { [TASTIERA]: sensoreTastiera, [MAPPA]: mappa() },
  });
  verifica("mappa senza interruttore: nessuna condizione",
    config.visibility === undefined && config.entity === TASTIERA,
    JSON.stringify(config));
}
{
  // Nessuna mappa (card aggiunta prima che l'integrazione pubblichi tutto):
  // si riparte dal nome di fabbrica, senza condizioni.
  const config = Card.getStubConfig({ states: {} });
  verifica("senza mappa: nome di fabbrica e nessuna condizione",
    config.entity === "sensor.nexus_tecnoalarm_keypad" && config.visibility === undefined,
    JSON.stringify(config));
}
{
  // Controllo di sanita': l'impalcatura non sta misurando se stessa.
  verifica("la card registrata e' quella vera",
    typeof Card === "function" && typeof Card.getStubConfig === "function"
    && typeof registrati["nexus-tecnoalarm-card-editor"] === "function");
}

// ---------------------------------------------------------------------------
const falliti = esiti.filter((e) => !e.ok);
for (const e of esiti) {
  console.log(`${e.ok ? "ok  " : "NO  "} ${e.nome}${e.ok || !e.dettaglio ? "" : `  -> ${e.dettaglio}`}`);
}
console.log("");
if (falliti.length) {
  console.log(`CONFIGURAZIONE DI PARTENZA: ${falliti.length} CONTROLLI FALLITI su ${esiti.length}`);
  process.exit(1);
}
console.log(`CONFIGURAZIONE DI PARTENZA: TUTTI I CONTROLLI SUPERATI (${esiti.length})`);
