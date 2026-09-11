/**
 * Nexus Tecnoalarm — scheda allarme
 *
 * Si configura con una sola entita', la mappa dell'allarme che l'integrazione
 * pubblica: dentro ci sono programmi, zone e telecomandi della centrale in
 * ordine di programmazione, e l'ultimo rifiuto del gateway per ciascun
 * programma. La scheda non elenca niente a mano: una zona aggiunta in
 * programmazione compare da sola.
 *
 * Il disinserimento chiede il codice e lo passa al servizio di Home Assistant.
 * Se il gateway lo rifiuta, il rifiuto arriva nella mappa e la scheda lo dice,
 * invece di restare ad aspettare un cambio di stato che non arrivera'.
 */

const VERSIONE_SCHEDA = "2.2.1";

// Quanto aspettare l'esito di un disinserimento prima di dire che la centrale
// non risponde. Il comando passa dalla coda del gateway e dal polling della
// centrale: qualche secondo e' normale.
const ATTESA_ESITO_MS = 15000;

// Il codice digitato si cancella da solo se nessuno lo usa: su un tablet a
// muro non deve restare li' per il prossimo che passa.
const SCADENZA_CODICE_MS = 30000;

// Dopo un inserimento il pulsante resta spento finche' lo stato cambia; se non
// cambia, si riaccende comunque dopo questo tempo per poter riprovare.
const ATTESA_INSERIMENTO_MS = 6000;

const MAX_CIFRE = 12;

const TESTI_ESITO = {
  codice_errato: "Codice errato",
  comando_sconosciuto: "Comando non riconosciuto dal gateway",
  timeout: "Nessuna risposta dalla centrale",
};

const TESTI_PROGRAMMA = {
  disinserito: "Disinserito",
  inserito: "Inserito",
  transizione: "In inserimento…",
  disinserendo: "In disinserimento…",
  allarme: "In allarme",
  assente: "Non disponibile",
};

/* Le segnalazioni estese delle zone. Le chiavi cambiano con la serie della
   centrale (EV o TP) e non vogliono dire la stessa cosa: si leggono solo
   quelle presenti, senza pretendere di sapere di quale serie si tratta. */
const BANDIERINE = [
  { chiavi: ["esclusa", "isolata"], testo: "esclusa", tono: "neutro" },
  { chiavi: ["memoria_allarme", "allarme", "allarme_24h", "preallarme"], testo: "allarme", tono: "allarme" },
  { chiavi: ["memoria_manomissione", "manomissione", "allarme_manomissione"], testo: "manomissione", tono: "allarme" },
  { chiavi: ["mascheramento", "sensore_mascherato"], testo: "mascherata", tono: "attenzione" },
  { chiavi: ["guasto", "sensore_guasto", "guasto_alimentazione"], testo: "guasto", tono: "attenzione" },
  { chiavi: ["batteria_bassa"], testo: "batteria", tono: "attenzione" },
  { chiavi: ["mancanza_rete"], testo: "rete", tono: "attenzione" },
];

const TASTI = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C"];

const STILE = `
  :host { display: block; }
  [hidden] { display: none !important; }

  ha-card {
    --fondo-tenue: color-mix(in srgb, var(--primary-text-color) 5%, var(--card-background-color, #fff));
    --bordo-tenue: color-mix(in srgb, var(--primary-text-color) 14%, var(--card-background-color, #fff));
    --tasto-fondo: color-mix(in srgb, var(--primary-text-color) 12%, var(--card-background-color, #fff));
    --tasto-bordo: color-mix(in srgb, var(--primary-text-color) 24%, var(--card-background-color, #fff));
    --tasto-premuto: color-mix(in srgb, var(--primary-text-color) 22%, var(--card-background-color, #fff));
    --ok: var(--success-color, #2f9e52);
    --attenzione: var(--warning-color, #d99012);
    --allarme: var(--error-color, #cf3b30);
    --attenzione-tenue: color-mix(in srgb, var(--attenzione) 16%, var(--card-background-color, #fff));
    --allarme-tenue: color-mix(in srgb, var(--allarme) 14%, var(--card-background-color, #fff));

    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 20px;
  }

  .blocco { display: flex; flex-direction: column; gap: 10px; }

  .intestazione { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  h3 {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
  }
  .conteggio {
    font-size: 12px;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }

  /* --- Allarme in corso --------------------------------------------------- */
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--allarme);
    color: #fff;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    animation: pulsa 1.2s ease-in-out infinite;
  }
  @keyframes pulsa { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }

  /* --- Programmi ---------------------------------------------------------- */
  .programmi { display: flex; flex-direction: column; gap: 6px; }
  .prog {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--fondo-tenue);
    border: 1px solid var(--bordo-tenue);
  }
  .prog ha-state-icon { color: var(--secondary-text-color); }
  .testi { display: flex; flex-direction: column; min-width: 0; }
  .nome {
    font-weight: 600;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stato-testo { font-size: 12px; color: var(--secondary-text-color); }
  .prog[data-stato="inserito"] { background: var(--attenzione-tenue); border-color: var(--attenzione); }
  .prog[data-stato="inserito"] ha-state-icon { color: var(--attenzione); }
  .prog[data-stato="transizione"], .prog[data-stato="disinserendo"] { border-color: var(--attenzione); }
  .prog[data-stato="transizione"] .stato-testo,
  .prog[data-stato="disinserendo"] .stato-testo {
    color: var(--attenzione);
    animation: pulsa 1.2s ease-in-out infinite;
  }
  .prog[data-stato="allarme"] { background: var(--allarme-tenue); border-color: var(--allarme); }
  .prog[data-stato="allarme"] ha-state-icon { color: var(--allarme); }
  .prog[data-stato="assente"] { opacity: .5; }

  .azione {
    appearance: none;
    font: inherit;
    cursor: pointer;
    padding: 8px 16px;
    border-radius: 999px;
    border: 1px solid var(--primary-color);
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .azione:hover { filter: brightness(1.1); }
  .azione:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .azione:disabled { opacity: .45; cursor: default; filter: none; }
  .azione.secondaria { background: transparent; color: var(--primary-color); }

  /* --- Tastierino --------------------------------------------------------- */
  .codice {
    min-height: 46px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--fondo-tenue);
    border: 1px solid var(--bordo-tenue);
    font-size: 22px;
    letter-spacing: .35em;
    color: var(--primary-text-color);
    font-variant-numeric: tabular-nums;
  }
  .codice.vuoto { font-size: 13px; letter-spacing: normal; color: var(--secondary-text-color); }

  .tastierino {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
  }
  .tasto {
    appearance: none;
    font: inherit;
    cursor: pointer;
    aspect-ratio: 1 / .6;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--tasto-fondo);
    border: 1px solid var(--tasto-bordo);
    color: var(--primary-text-color);
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    transition: background .12s ease, transform .06s ease;
  }
  .tasto:hover { background: var(--tasto-premuto); }
  .tasto:active { transform: translateY(1px) scale(.985); }
  .tasto:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .tasto.piccolo { font-size: 14px; }
  .tasto:disabled { opacity: .4; cursor: default; transform: none; }

  .disinserimenti { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .nota { font-size: 13px; color: var(--secondary-text-color); text-align: center; }
  .messaggio { min-height: 1.3em; font-size: 13px; font-weight: 600; text-align: center; }
  .messaggio[data-tono="ok"] { color: var(--ok); }
  .messaggio[data-tono="attenzione"] { color: var(--attenzione); }
  .messaggio[data-tono="allarme"] { color: var(--allarme); }
  .messaggio[data-tono="neutro"] { color: var(--secondary-text-color); }

  /* --- Zone e telecomandi ------------------------------------------------- */
  .filtro { margin-left: auto; display: flex; gap: 4px; }
  .filtro button {
    appearance: none;
    font: inherit;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--bordo-tenue);
    background: transparent;
    color: var(--secondary-text-color);
  }
  .filtro button[aria-pressed="true"] {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .filtro button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  .griglia { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }

  .tessera {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 2px 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--fondo-tenue);
    border: 1px solid var(--bordo-tenue);
    color: var(--primary-text-color);
    min-width: 0;
    text-align: left;
  }
  .tessera ha-state-icon { grid-row: span 2; color: var(--secondary-text-color); }
  .tessera .nome { font-size: 13px; font-weight: 500; }
  .tessera .riga-stato {
    font-size: 11px;
    color: var(--secondary-text-color);
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }
  .tessera[data-aperta] { background: var(--attenzione-tenue); border-color: var(--attenzione); }
  .tessera[data-aperta] ha-state-icon { color: var(--attenzione); }
  .tessera[data-allarme] { background: var(--allarme-tenue); border-color: var(--allarme); }
  .tessera[data-allarme] ha-state-icon { color: var(--allarme); }
  .tessera[data-assente] { opacity: .55; }

  button.tessera { appearance: none; font: inherit; cursor: pointer; padding: 10px 12px; border-radius: 10px; }
  button.tessera:hover { border-color: var(--tasto-bordo); }
  button.tessera:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  button.tessera[data-acceso] { border-color: var(--primary-color); }
  button.tessera[data-acceso] ha-state-icon { color: var(--primary-color); }

  .bandierina {
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bordo-tenue);
    color: var(--primary-text-color);
  }
  .bandierina[data-tono="allarme"] { background: var(--allarme); color: #fff; }
  .bandierina[data-tono="attenzione"] { background: var(--attenzione); color: #2a1c02; }

  .vuoto { font-size: 13px; color: var(--secondary-text-color); padding: 4px 2px; }
  .avviso { padding: 16px; color: var(--error-color, #cf3b30); line-height: 1.4; }

  @media (prefers-reduced-motion: reduce) {
    .banner,
    .prog[data-stato="transizione"] .stato-testo,
    .prog[data-stato="disinserendo"] .stato-testo { animation: none; }
    .tasto { transition: none; }
  }
`;

// -----------------------------------------------------------------------------
// Utilita'
// -----------------------------------------------------------------------------

/** Crea un elemento. `testo` va in textContent: nessun HTML da stringhe. */
function el(tag, attributi = {}, figli = []) {
  const nodo = document.createElement(tag);
  for (const [chiave, valore] of Object.entries(attributi)) {
    if (valore === null || valore === undefined || valore === false) continue;
    if (chiave === "testo") nodo.textContent = valore;
    else if (chiave === "classe") nodo.className = valore;
    else if (chiave.startsWith("on") && typeof valore === "function") {
      nodo.addEventListener(chiave.slice(2), valore);
    } else nodo.setAttribute(chiave, valore === true ? "" : valore);
  }
  for (const figlio of figli) if (figlio) nodo.appendChild(figlio);
  return nodo;
}

function assente(stato) {
  return !stato || stato.state === "unavailable" || stato.state === "unknown";
}

/** Lo stato di un programma, ridotto a cio' che la scheda deve distinguere. */
function categoriaProgramma(stato) {
  if (assente(stato)) return "assente";
  const valore = stato.state;
  if (valore === "disarmed") return "disinserito";
  // Il gateway pubblica 'pending' durante il tempo d'uscita; Home Assistant
  // chiamerebbe quella fase 'arming'. Si accettano entrambi.
  if (valore === "pending" || valore === "arming") return "transizione";
  if (valore === "disarming") return "disinserendo";
  if (valore === "triggered") return "allarme";
  if (valore.startsWith("armed")) return "inserito";
  return "assente";
}

function disinseribile(stato) {
  const categoria = categoriaProgramma(stato);
  return categoria === "inserito" || categoria === "transizione" || categoria === "allarme";
}

/** Il testo dello stato come lo scriverebbe Home Assistant, nella sua lingua. */
function formatta(hass, stato) {
  if (assente(stato)) return "Non disponibile";
  return typeof hass.formatEntityState === "function" ? hass.formatEntityState(stato) : stato.state;
}

function bandierineDi(attributi) {
  const presenti = [];
  for (const bandierina of BANDIERINE) {
    if (bandierina.chiavi.some((chiave) => attributi && attributi[chiave] === true)) {
      presenti.push(bandierina);
    }
  }
  return presenti;
}

/** Messaggio leggibile da un errore di callService. */
function testoErrore(errore) {
  const testo = (errore && (errore.message || errore.error || errore.code)) || String(errore);
  // Con il gateway precedente alla V0.8.31 e' ancora Home Assistant a
  // confrontare il codice, e un codice sbagliato arriva come errore del
  // servizio invece che come rifiuto del gateway.
  if (/code|codice/i.test(testo)) return TESTI_ESITO.codice_errato;
  return testo;
}

// -----------------------------------------------------------------------------
// Scheda
// -----------------------------------------------------------------------------
class NexusTecnoalarmAllarme extends HTMLElement {
  constructor() {
    super();
    // Shadow root: gli stili restano qui dentro e non toccano le altre card
    // della stessa sezione.
    this._radice = this.attachShadow({ mode: "open" });
    this._codice = "";
    this._occupato = false;
    this._filtroZone = "tutte";
    this._inInserimento = new Set();
    this._attesa = null;
    this._messaggio = null;
    this._el = null;
  }

  // ---------------------------------------------------------------------
  // Configurazione
  // ---------------------------------------------------------------------
  static getConfigElement() {
    return document.createElement("nexus-tecnoalarm-allarme-editor");
  }

  static getStubConfig(hass) {
    const trovata = Object.keys(hass.states).find(
      (id) => hass.states[id].attributes.ruolo === "mappa_allarme"
    );
    return { entity: trovata || "" };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Indica l'entità della mappa dell'allarme");
    }
    this._config = config;
    this._firmaStruttura = null;
    this._firmaStati = null;
    this._el = null;
    this._radice.innerHTML = "";
    if (this._hass) this._aggiorna();
  }

  set hass(hass) {
    this._hass = hass;
    this._aggiorna();
  }

  getCardSize() {
    const mappa = this._mappa();
    return (
      3 +
      (mappa.programmi || []).length +
      Math.ceil((mappa.zone || []).length / 3) +
      Math.ceil((mappa.telecomandi || []).length / 3)
    );
  }

  disconnectedCallback() {
    clearTimeout(this._timerCodice);
    clearTimeout(this._timerMessaggio);
  }

  _mappa() {
    const stato = this._hass && this._config && this._hass.states[this._config.entity];
    return (stato && stato.attributes) || {};
  }

  // ---------------------------------------------------------------------
  // Aggiornamento
  // ---------------------------------------------------------------------
  _aggiorna() {
    if (!this._config || !this._hass) return;

    const stato = this._hass.states[this._config.entity];
    if (!stato) {
      this._avviso(`Entità ${this._config.entity} non trovata.`);
      return;
    }

    const mappa = stato.attributes || {};
    if (mappa.dispositivo_trovato === false) {
      this._avviso(
        "Nessuna centrale Tecnoalarm pubblicata via MQTT su questo Home Assistant. " +
          "Controlla che nel gateway Nexus-T la pubblicazione verso Home Assistant sia attiva."
      );
      return;
    }

    // La struttura cambia raramente (una zona aggiunta, un nome modificato):
    // solo allora si ricostruisce, altrimenti si aggiorna sul posto.
    const struttura = JSON.stringify([
      mappa.programmi,
      mappa.zone,
      mappa.telecomandi,
      mappa.allarme_generale,
    ]);
    if (struttura !== this._firmaStruttura || !this._el) {
      this._costruisci(mappa);
      this._firmaStruttura = struttura;
      this._firmaStati = null;
    }

    // L'esito di un disinserimento in corso si controlla a ogni aggiornamento,
    // prima di decidere se ridisegnare.
    this._verificaAttesa();

    // Home Assistant chiama questo metodo per qualunque cambio di stato della
    // casa: si ridisegna solo se e' cambiato qualcosa che la scheda mostra.
    const firma = this._firmaStatiCorrente(mappa);
    if (firma === this._firmaStati) return;
    this._firmaStati = firma;

    this._disegnaAllarme(mappa);
    this._disegnaProgrammi(mappa);
    this._disegnaTastierino(mappa);
    this._disegnaZone(mappa);
    this._disegnaTelecomandi(mappa);
  }

  _firmaStatiCorrente(mappa) {
    const id = [
      this._config.entity,
      mappa.allarme_generale,
      ...(mappa.programmi || []).map((p) => p.entity_id),
      ...(mappa.zone || []).map((z) => z.entity_id),
      ...(mappa.telecomandi || []).map((t) => t.entity_id),
    ];
    return id
      .map((entita) => {
        const stato = entita && this._hass.states[entita];
        return stato ? stato.last_updated : "-";
      })
      .join("|");
  }

  _avviso(testo) {
    this._radice.innerHTML = "";
    const stile = el("style");
    stile.textContent = STILE;
    this._radice.appendChild(stile);
    this._radice.appendChild(el("ha-card", {}, [el("div", { classe: "avviso", testo })]));
    this._el = null;
    this._firmaStruttura = null;
  }

  // ---------------------------------------------------------------------
  // Costruzione
  // ---------------------------------------------------------------------
  _costruisci(mappa) {
    this._radice.innerHTML = "";
    const stile = el("style");
    stile.textContent = STILE;
    this._radice.appendChild(stile);

    const card = el("ha-card");
    this._el = { card };

    // Allarme in corso: una fascia rossa che non si puo' non vedere.
    this._el.banner = el("div", { classe: "banner", role: "alert", hidden: true }, [
      el("ha-icon", { icon: "mdi:alarm-light" }),
      el("span", { testo: "Allarme in corso" }),
    ]);
    card.appendChild(this._el.banner);

    card.appendChild(this._costruisciProgrammi(mappa));
    card.appendChild(this._costruisciTastierino(mappa));
    card.appendChild(this._costruisciZone(mappa));
    card.appendChild(this._costruisciTelecomandi(mappa));

    this._radice.appendChild(card);
    this._firmaDisinseribili = null;
  }

  _costruisciProgrammi(mappa) {
    const programmi = mappa.programmi || [];
    const contenitore = el("div", { classe: "programmi" });
    this._el.programmi = new Map();

    for (const programma of programmi) {
      const icona = el("ha-state-icon");
      const stato = el("span", { classe: "stato-testo" });
      const bottone = el("button", {
        classe: "azione",
        type: "button",
        testo: "Inserisci",
        "aria-label": `Inserisci ${programma.nome}`,
        onclick: () => this._inserisci(programma),
      });
      const riga = el("div", { classe: "prog" }, [
        icona,
        el("div", { classe: "testi" }, [el("span", { classe: "nome", testo: programma.nome }), stato]),
        bottone,
      ]);
      contenitore.appendChild(riga);
      this._el.programmi.set(programma.entity_id, { riga, icona, stato, bottone });
    }

    const blocco = el("section", { classe: "blocco", hidden: programmi.length === 0 }, [
      el("div", { classe: "intestazione" }, [el("h3", { testo: "Programmi" })]),
      contenitore,
    ]);
    return blocco;
  }

  _costruisciTastierino(mappa) {
    const programmi = mappa.programmi || [];

    this._el.codice = el("div", { classe: "codice vuoto", "aria-live": "polite" });

    const tastierino = el("div", { classe: "tastierino" });
    this._el.tasti = TASTI.map((tasto) => {
      const etichette = { "⌫": "Cancella l'ultima cifra", C: "Cancella il codice" };
      const bottone = el("button", {
        classe: `tasto${tasto === "⌫" || tasto === "C" ? " piccolo" : ""}`,
        type: "button",
        testo: tasto,
        "aria-label": etichette[tasto] || `Cifra ${tasto}`,
        onclick: () => this._premi(tasto),
      });
      tastierino.appendChild(bottone);
      return bottone;
    });

    this._el.disinserimenti = el("div", { classe: "disinserimenti" });
    this._el.messaggio = el("div", { classe: "messaggio", "aria-live": "assertive" });

    return el("section", { classe: "blocco", hidden: programmi.length === 0 }, [
      el("div", { classe: "intestazione" }, [el("h3", { testo: "Disinserimento" })]),
      this._el.codice,
      tastierino,
      this._el.disinserimenti,
      this._el.messaggio,
    ]);
  }

  _costruisciZone(mappa) {
    const zone = mappa.zone || [];
    const griglia = el("div", { classe: "griglia" });
    this._el.zone = new Map();

    for (const zona of zone) {
      const icona = el("ha-state-icon");
      const stato = el("span", { classe: "riga-stato" });
      const tessera = el("div", { classe: "tessera" }, [
        icona,
        el("span", { classe: "nome", testo: zona.nome }),
        stato,
      ]);
      griglia.appendChild(tessera);
      this._el.zone.set(zona.entity_id, { tessera, icona, stato });
    }

    this._el.conteggioZone = el("span", { classe: "conteggio" });
    this._el.vuotoZone = el("div", { classe: "vuoto", testo: "Nessuna zona aperta.", hidden: true });

    // Su una centrale grande le zone sono centinaia: poter guardare solo
    // quelle aperte e' cio' che serve prima di inserire.
    const filtro = el("div", { classe: "filtro", role: "group", "aria-label": "Zone da mostrare" });
    this._el.filtri = ["tutte", "aperte"].map((valore) => {
      const bottone = el("button", {
        type: "button",
        testo: valore === "tutte" ? "Tutte" : "Aperte",
        onclick: () => {
          this._filtroZone = valore;
          this._firmaStati = null;
          this._aggiorna();
        },
      });
      filtro.appendChild(bottone);
      return { valore, bottone };
    });

    return el("section", { classe: "blocco", hidden: zone.length === 0 }, [
      el("div", { classe: "intestazione" }, [
        el("h3", { testo: "Zone" }),
        this._el.conteggioZone,
        filtro,
      ]),
      griglia,
      this._el.vuotoZone,
    ]);
  }

  _costruisciTelecomandi(mappa) {
    const telecomandi = mappa.telecomandi || [];
    const griglia = el("div", { classe: "griglia" });
    this._el.telecomandi = new Map();

    for (const telecomando of telecomandi) {
      const icona = el("ha-state-icon");
      const stato = el("span", { classe: "riga-stato" });
      const tessera = el(
        "button",
        {
          classe: "tessera",
          type: "button",
          "aria-label": `Commuta ${telecomando.nome}`,
          onclick: () => this._commuta(telecomando),
        },
        [icona, el("span", { classe: "nome", testo: telecomando.nome }), stato]
      );
      griglia.appendChild(tessera);
      this._el.telecomandi.set(telecomando.entity_id, { tessera, icona, stato });
    }

    return el("section", { classe: "blocco", hidden: telecomandi.length === 0 }, [
      el("div", { classe: "intestazione" }, [el("h3", { testo: "Telecomandi" })]),
      griglia,
    ]);
  }

  // ---------------------------------------------------------------------
  // Disegno
  // ---------------------------------------------------------------------
  _disegnaAllarme(mappa) {
    const stato = mappa.allarme_generale && this._hass.states[mappa.allarme_generale];
    // L'allarme in corso non si legge dai programmi, che non pubblicano mai
    // 'triggered': si legge dal sensore di allarme generale della centrale.
    this._el.banner.hidden = !(stato && stato.state === "on");
  }

  _disegnaProgrammi(mappa) {
    for (const programma of mappa.programmi || []) {
      const voce = this._el.programmi.get(programma.entity_id);
      if (!voce) continue;
      const stato = this._hass.states[programma.entity_id];
      const categoria = categoriaProgramma(stato);

      voce.icona.hass = this._hass;
      voce.icona.stateObj = stato;
      voce.riga.dataset.stato = categoria;
      voce.stato.textContent = TESTI_PROGRAMMA[categoria];

      // Il pulsante c'e' solo a programma disinserito: da inserito si
      // disinserisce dal tastierino, con il codice.
      if (categoria !== "disinserito") this._inInserimento.delete(programma.entity_id);
      voce.bottone.hidden = categoria !== "disinserito";
      voce.bottone.disabled = this._inInserimento.has(programma.entity_id);
    }
  }

  _disegnaTastierino(mappa) {
    if (!this._el) return;
    const cifre = this._codice.length;

    this._el.codice.classList.toggle("vuoto", cifre === 0);
    // Mai le cifre: su un tablet a muro il codice lo vede chi e' dietro.
    this._el.codice.textContent = cifre ? "●".repeat(cifre) : "Digita il codice";
    this._el.codice.setAttribute(
      "aria-label",
      cifre ? `${cifre} cifre inserite` : "Nessuna cifra inserita"
    );
    this._el.tasti.forEach((tasto) => { tasto.disabled = this._occupato; });

    const disinseribili = (mappa.programmi || []).filter((p) => disinseribile(this._hass.states[p.entity_id]));
    const firma = disinseribili.map((p) => p.entity_id).join(",");

    if (firma !== this._firmaDisinseribili) {
      this._firmaDisinseribili = firma;
      this._el.disinserimenti.replaceChildren();

      if (disinseribili.length === 0) {
        this._el.disinserimenti.appendChild(el("div", { classe: "nota", testo: "Nessun programma inserito." }));
      } else {
        // «Tutto» sempre per primo e sempre nello stesso posto, anche con un
        // solo programma inserito: in un'interfaccia d'allarme la posizione
        // prevedibile conta piu' dell'eleganza.
        this._el.disinserimenti.appendChild(
          el("button", {
            classe: "azione",
            type: "button",
            testo: "Disinserisci tutto",
            onclick: () => this._disinserisci(this._disinseribiliOra()),
          })
        );
        for (const programma of disinseribili) {
          this._el.disinserimenti.appendChild(
            el("button", {
              classe: "azione secondaria",
              type: "button",
              testo: `Disinserisci ${programma.nome}`,
              onclick: () => this._disinserisci([programma]),
            })
          );
        }
      }
    }

    this._el.disinserimenti.querySelectorAll("button").forEach((bottone) => {
      bottone.disabled = this._occupato || cifre === 0;
    });

    const messaggio = this._messaggio;
    this._el.messaggio.textContent = messaggio ? messaggio.testo : "";
    if (messaggio) this._el.messaggio.dataset.tono = messaggio.tono;
    else delete this._el.messaggio.dataset.tono;
  }

  _disinseribiliOra() {
    return (this._mappa().programmi || []).filter((p) => disinseribile(this._hass.states[p.entity_id]));
  }

  _disegnaZone(mappa) {
    const zone = mappa.zone || [];
    let aperte = 0;
    let visibili = 0;

    for (const zona of zone) {
      const voce = this._el.zone.get(zona.entity_id);
      if (!voce) continue;
      const stato = this._hass.states[zona.entity_id];

      voce.icona.hass = this._hass;
      voce.icona.stateObj = stato;

      const mancante = assente(stato);
      const aperta = !mancante && stato.state === "on";
      const bandierine = mancante ? [] : bandierineDi(stato.attributes);
      const inAllarme = bandierine.some((b) => b.tono === "allarme");
      if (aperta) aperte += 1;

      voce.tessera.toggleAttribute("data-aperta", aperta && !inAllarme);
      voce.tessera.toggleAttribute("data-allarme", inAllarme);
      voce.tessera.toggleAttribute("data-assente", mancante);

      voce.stato.replaceChildren(
        el("span", { testo: formatta(this._hass, stato) }),
        ...bandierine.map((b) => el("span", { classe: "bandierina", "data-tono": b.tono, testo: b.testo }))
      );

      const mostrata = this._filtroZone === "tutte" || aperta || inAllarme;
      voce.tessera.hidden = !mostrata;
      if (mostrata) visibili += 1;
    }

    this._el.conteggioZone.textContent = aperte
      ? `${aperte} aperte su ${zone.length}`
      : `tutte chiuse · ${zone.length}`;
    this._el.vuotoZone.hidden = visibili > 0;
    this._el.filtri.forEach(({ valore, bottone }) => {
      bottone.setAttribute("aria-pressed", String(valore === this._filtroZone));
    });
  }

  _disegnaTelecomandi(mappa) {
    for (const telecomando of mappa.telecomandi || []) {
      const voce = this._el.telecomandi.get(telecomando.entity_id);
      if (!voce) continue;
      const stato = this._hass.states[telecomando.entity_id];

      voce.icona.hass = this._hass;
      voce.icona.stateObj = stato;
      voce.stato.textContent = formatta(this._hass, stato);
      voce.tessera.toggleAttribute("data-acceso", !assente(stato) && stato.state === "on");
      voce.tessera.toggleAttribute("data-assente", assente(stato));
      voce.tessera.disabled = assente(stato);
    }
  }

  // ---------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------
  async _inserisci(programma) {
    if (this._inInserimento.has(programma.entity_id)) return;
    this._inInserimento.add(programma.entity_id);
    this._disegnaProgrammi(this._mappa());

    try {
      await this._hass.callService("alarm_control_panel", "alarm_arm_away", {
        entity_id: programma.entity_id,
      });
    } catch (errore) {
      this._mostra(`${programma.nome}: ${testoErrore(errore)}`, "allarme");
    }

    setTimeout(() => {
      this._inInserimento.delete(programma.entity_id);
      this._firmaStati = null;
      this._aggiorna();
    }, ATTESA_INSERIMENTO_MS);
  }

  async _commuta(telecomando) {
    try {
      await this._hass.callService("switch", "toggle", { entity_id: telecomando.entity_id });
    } catch (errore) {
      this._mostra(`${telecomando.nome}: ${testoErrore(errore)}`, "allarme");
    }
  }

  _premi(tasto) {
    if (this._occupato) return;
    if (tasto === "⌫") this._codice = this._codice.slice(0, -1);
    else if (tasto === "C") this._codice = "";
    else if (this._codice.length < MAX_CIFRE) this._codice += tasto;

    clearTimeout(this._timerCodice);
    if (this._codice) {
      this._timerCodice = setTimeout(() => {
        this._codice = "";
        this._disegnaTastierino(this._mappa());
      }, SCADENZA_CODICE_MS);
    }
    this._disegnaTastierino(this._mappa());
  }

  /**
   * Disinserisce i programmi uno alla volta, aspettando l'esito di ciascuno.
   *
   * Un codice sbagliato produce cosi' un rifiuto solo e si ferma li', invece
   * di mandare quattro comandi e raccogliere quattro errori.
   */
  async _disinserisci(programmi) {
    if (this._occupato || !this._codice || programmi.length === 0) return;

    const codice = this._codice;
    this._occupato = true;
    this._mostra("Disinserimento in corso…", "neutro", 0);
    let riusciti = 0;

    try {
      for (const programma of programmi) {
        const tsPrima = this._tsRifiuto(programma.numero);
        try {
          await this._hass.callService("alarm_control_panel", "alarm_disarm", {
            entity_id: programma.entity_id,
            code: codice,
          });
        } catch (errore) {
          this._mostra(this._conProgressi(testoErrore(errore), riusciti, programmi.length), "allarme");
          return;
        }

        const esito = await this._attendiEsito(programma, tsPrima);
        if (esito.esito === "ok") {
          riusciti += 1;
          continue;
        }

        const testo = TESTI_ESITO[esito.esito] || `Il gateway non ha eseguito il comando (${esito.esito})`;
        this._mostra(
          this._conProgressi(testo, riusciti, programmi.length),
          esito.esito === "timeout" ? "attenzione" : "allarme"
        );
        return;
      }

      this._mostra(riusciti > 1 ? `${riusciti} programmi disinseriti` : "Disinserito", "ok");
    } finally {
      this._codice = "";
      clearTimeout(this._timerCodice);
      this._occupato = false;
      this._disegnaTastierino(this._mappa());
    }
  }

  _conProgressi(testo, riusciti, totale) {
    return riusciti > 0 ? `Disinseriti ${riusciti} su ${totale}, poi: ${testo}` : testo;
  }

  _tsRifiuto(numero) {
    const rifiuto = (this._mappa().rifiuti || {})[String(numero)];
    return rifiuto ? rifiuto.ts : null;
  }

  /**
   * Aspetta che il programma risulti disinserito, o che arrivi un rifiuto
   * nuovo per lui.
   *
   * «Nuovo» vuol dire con un ts diverso da quello visto prima di mandare il
   * comando. Non si confronta il ts con l'orologio del tablet: il ts e' del
   * gateway, e i due orologi non sono tenuti a coincidere.
   */
  _attendiEsito(programma, tsPrima) {
    return new Promise((risolvi) => {
      const scadenza = setTimeout(() => {
        this._attesa = null;
        risolvi({ esito: "timeout" });
      }, ATTESA_ESITO_MS);

      this._attesa = {
        programma,
        tsPrima,
        risolvi: (esito) => {
          clearTimeout(scadenza);
          this._attesa = null;
          risolvi(esito);
        },
      };
      this._verificaAttesa();
    });
  }

  _verificaAttesa() {
    const attesa = this._attesa;
    if (!attesa || !this._hass) return;

    const stato = this._hass.states[attesa.programma.entity_id];
    if (stato && stato.state === "disarmed") {
      attesa.risolvi({ esito: "ok" });
      return;
    }

    const rifiuto = (this._mappa().rifiuti || {})[String(attesa.programma.numero)];
    if (rifiuto && rifiuto.ts !== attesa.tsPrima) {
      attesa.risolvi({ esito: rifiuto.esito || "sconosciuto", rifiuto });
    }
  }

  _mostra(testo, tono, durata = 8000) {
    this._messaggio = { testo, tono };
    clearTimeout(this._timerMessaggio);
    if (durata > 0) {
      this._timerMessaggio = setTimeout(() => {
        this._messaggio = null;
        this._disegnaTastierino(this._mappa());
      }, durata);
    }
    this._disegnaTastierino(this._mappa());
  }
}

// -----------------------------------------------------------------------------
// Editor visuale
// -----------------------------------------------------------------------------
const SCHEMA_EDITOR = [
  {
    name: "entity",
    required: true,
    selector: { entity: { integration: "nexus_tecnoalarm", domain: "sensor" } },
  },
];

class NexusTecnoalarmAllarmeEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._aggiorna(); }
  set hass(hass) { this._hass = hass; this._aggiorna(); }

  _aggiorna() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = SCHEMA_EDITOR;
      this._form.computeLabel = () => "Mappa dell'allarme";
      this._form.addEventListener("value-changed", (evento) => {
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: evento.detail.value },
          bubbles: true,
          composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
  }
}

// Registrazione idempotente e non fatale, come per la tastiera: un doppio
// caricamento non deve lanciare, e un'eccezione qui non deve poter impedire
// il boot dell'interfaccia.
try {
  if (!customElements.get("nexus-tecnoalarm-allarme")) {
    customElements.define("nexus-tecnoalarm-allarme", NexusTecnoalarmAllarme);
    customElements.define("nexus-tecnoalarm-allarme-editor", NexusTecnoalarmAllarmeEditor);

    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "nexus-tecnoalarm-allarme",
      name: "Nexus Tecnoalarm Allarme",
      description: "Programmi, disinserimento con codice, zone e telecomandi della centrale, senza elencarli a mano.",
      preview: false,
      documentationURL: "https://github.com/Pacco24626/nexus_tecnoalarm",
    });

    console.info(
      `%c NEXUS-TECNOALARM-ALLARME %c ${VERSIONE_SCHEDA} `,
      "color: #fff; background: #003b7a; font-weight: 700;",
      "color: #003b7a; background: #d6e6f5; font-weight: 700;"
    );
  }
} catch (errore) {
  console.error("nexus-tecnoalarm-allarme: registrazione fallita", errore);
}
