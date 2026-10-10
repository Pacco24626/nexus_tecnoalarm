/**
 * Nexus Tecnoalarm Keypad — card Lovelace
 *
 * Disegna la tastiera F127EVLCD leggendo un'unica entita': lo stato e' la
 * riga 1 del display, il resto del pannello sta nei suoi attributi.
 *
 * I codici dei tasti sono quelli del gateway e non vanno toccati:
 *   0-9 cifre, 10 MEM, 11 EXIT, 12 giu', 13 su', 14 NO, 15 YES.
 */

const VERSIONE_CARD = "2.6.2";
const BASE_RISORSE = "/nexus_tecnoalarm_local";

/* I tasti nell'ordine dell'apparecchio: cifre a sinistra, comandi nella
   quarta colonna, come sulla serigrafia. */
const TASTI = [
  { etichetta: "1", codice: 1 },
  { etichetta: "2", codice: 2 },
  { etichetta: "3", codice: 3 },
  { etichetta: "MEM", codice: 10, piccolo: true },
  { etichetta: "4", codice: 4 },
  { etichetta: "5", codice: 5 },
  { etichetta: "6", codice: 6 },
  { etichetta: "EXIT", codice: 11, piccolo: true },
  { etichetta: "7", codice: 7 },
  { etichetta: "8", codice: 8 },
  { etichetta: "9", codice: 9 },
  { etichetta: "▲", codice: 13, piccolo: true },
  { etichetta: "NO", codice: 14, piccolo: true },
  { etichetta: "0", codice: 0 },
  { etichetta: "YES", codice: 15, piccolo: true, conferma: true },
  { etichetta: "▼", codice: 12, piccolo: true },
];

const SPIE = [
  { chiave: "rete", nome: "Rete" },
  { chiave: "guasto", nome: "Guasto" },
  { chiave: "tamper", nome: "Manomissione" },
  { chiave: "batteria", nome: "Batteria" },
];

const STILE = `
  ha-card {
    --tasto-fondo: color-mix(in srgb, var(--primary-text-color) 15%, var(--card-background-color, #fff));
    --tasto-bordo: color-mix(in srgb, var(--primary-text-color) 28%, var(--card-background-color, #fff));
    --tasto-premuto: color-mix(in srgb, var(--primary-text-color) 26%, var(--card-background-color, #fff));
    --vetro: color-mix(in srgb, var(--primary-text-color) 6%, var(--card-background-color, #fff));
    --spia-spenta: color-mix(in srgb, var(--primary-text-color) 18%, var(--card-background-color, #fff));
    --ok: var(--success-color, #2f9e52);
    --attenzione: var(--warning-color, #d99012);
    --allarme: var(--error-color, #cf3b30);

    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    user-select: none;
  }

  /* Il marchio: l'immagine originale, con la variante schiarita quando il
     tema e' scuro, altrimenti il navy sparirebbe nel fondo. */
  .marchio {
    height: 21px;
    background-image: url("${BASE_RISORSE}/logo.png");
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
  }
  ha-card.scuro .marchio { background-image: url("${BASE_RISORSE}/logo-scuro.png"); }

  /* Display: campo di 16 caratteri per 2 righe, come l'apparecchio. */
  .lcd {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 16px;
    border-radius: 10px;
    background: var(--vetro);
    border: 1px solid var(--divider-color, #d3d9de);
    color: var(--primary-text-color);
    font-family: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: clamp(13px, 3.4cqw, 17px);
    font-weight: 500;
    letter-spacing: .06em;
    font-variant-numeric: tabular-nums;
    white-space: pre;
    overflow-x: auto;
  }
  .lcd span { min-height: 1.3em; }

  .spie { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .spia { display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0; }
  .spia i { width: 100%; height: 5px; border-radius: 3px; background: var(--spia-spenta); }
  .spia b {
    font-size: 10px;
    font-weight: 500;
    color: var(--secondary-text-color);
    text-align: center;
    line-height: 1.15;
  }
  .spia[data-colore] b { color: var(--primary-text-color); }
  .spia[data-colore="verde"] i { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .spia[data-colore="ambra"] i { background: var(--attenzione); box-shadow: 0 0 8px var(--attenzione); }
  .spia[data-colore="rosso"] i { background: var(--allarme); box-shadow: 0 0 8px var(--allarme); }
  .spia[data-lampeggia] i { animation: lampeggio 1s steps(1, end) infinite; }

  /* Programmi: segnalazioni, non comandi. Il numero e' la spia. */
  .fascia { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .fascia h3 {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
    flex: none;
  }
  .pastiglie { display: flex; gap: 5px; flex: 1; min-width: 0; }
  .pastiglia {
    flex: 1;
    min-width: 0;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: var(--vetro);
    border: 1px solid var(--divider-color, #d3d9de);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--secondary-text-color);
  }
  .pastiglia[data-stato="inserito"] {
    background: var(--attenzione);
    border-color: var(--attenzione);
    color: #2a1c02;
  }
  .pastiglia[data-stato="allarme"] {
    background: var(--allarme);
    border-color: var(--allarme);
    color: #fff;
  }
  .pastiglia[data-lampeggia] { animation: lampeggio 1s steps(1, end) infinite; }
  .pastiglia[data-lampeggia="lento"] { animation-duration: 2s; }

  @keyframes lampeggio { 0%, 60% { opacity: 1; } 61%, 100% { opacity: .25; } }

  .tastierino { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }

  .tasto {
    appearance: none;
    font: inherit;
    cursor: pointer;
    aspect-ratio: 1 / .74;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--tasto-fondo);
    border: 1px solid var(--tasto-bordo);
    color: var(--primary-text-color);
    font-size: clamp(13px, 3.2cqw, 17px);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    transition: background .12s ease, transform .06s ease;
  }
  .tasto:hover { background: var(--tasto-premuto); }
  .tasto:active { transform: translateY(1px) scale(.985); }
  .tasto:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .tasto.piccolo { font-size: clamp(10px, 2.4cqw, 13px); letter-spacing: .03em; }
  .tasto.conferma {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .tasto.conferma:hover { background: var(--primary-color); filter: brightness(1.12); }

  /* Gateway muto: si spegne tutto invece di far credere che risponda. */
  ha-card.assente .tastierino,
  ha-card.assente .fascia,
  ha-card.assente .spie { opacity: .4; pointer-events: none; }

  .avviso { padding: 16px; color: var(--error-color, #cf3b30); }

  @media (prefers-reduced-motion: reduce) {
    .spia[data-lampeggia] i, .pastiglia[data-lampeggia] { animation: none; }
    .tasto { transition: none; }
  }
`;

/** Riempie a 16 caratteri, come il display dell'apparecchio. */
function a16(testo) {
  return String(testo == null ? "" : testo).padEnd(16, " ").slice(0, 16);
}

/** Vero se una delle due grafie dell'attributo lampeggiante e' attiva. */
function lampeggia(oggetto, chiave) {
  return Boolean(oggetto[`attr_${chiave}`] || oggetto[`${chiave}_attr`]);
}

class NexusTecnoalarmCard extends HTMLElement {
  // ---------------------------------------------------------------------
  // Presenza: il gateway tiene agganciata la tastiera solo mentre riceve il
  // battito. Invariato rispetto alla 1.x, e' cio' che il flow si aspetta.
  // ---------------------------------------------------------------------
  connectedCallback() {
    this._visibilita = () => {
      if (document.visibilityState === "visible") this._presenza();
    };
    document.addEventListener("visibilitychange", this._visibilita);
    this._presenza();
    this._timer = setInterval(() => {
      if (document.visibilityState === "visible") this._presenza();
    }, 5000);
  }

  disconnectedCallback() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._visibilita) {
      document.removeEventListener("visibilitychange", this._visibilita);
      this._visibilita = null;
    }
  }

  _presenza() {
    if (this._hass && document.visibilityState === "visible") {
      this._hass.callService("nexus_tecnoalarm", "keypad_presence", {});
    }
  }

  _inviaTasto(codice) {
    this._hass.callService("nexus_tecnoalarm", "send_key", { code: codice });
  }

  // ---------------------------------------------------------------------
  // Configurazione
  // ---------------------------------------------------------------------
  static getConfigElement() {
    return document.createElement("nexus-tecnoalarm-card-editor");
  }

  static getStubConfig(hass) {
    const trovata = Object.keys(hass.states).find(
      // Anche la mappa dell'allarme ha un attributo 'programmi': va scartata,
      // altrimenti il selettore potrebbe proporre lei al posto della tastiera.
      (id) => id.startsWith("sensor.") &&
        hass.states[id].attributes.programmi !== undefined &&
        hass.states[id].attributes.ruolo !== "mappa_allarme"
    );
    return { entity: trovata || "sensor.nexus_tecnoalarm_keypad" };
  }

  setConfig(config) {
    this.config = config;
    this._costruita = false;
    this.innerHTML = "";
  }

  getCardSize() { return 8; }

  set hass(hass) {
    this._hass = hass;
    this._aggiorna();
  }

  // ---------------------------------------------------------------------
  // Costruzione
  // ---------------------------------------------------------------------
  _costruisci() {
    const card = document.createElement("ha-card");
    // Le misure dei tasti e del display scalano sulla larghezza della card,
    // non su quella della finestra: in una sezione stretta resta leggibile.
    card.style.containerType = "inline-size";

    const stile = document.createElement("style");
    stile.textContent = STILE;
    card.appendChild(stile);

    this._el = { card };

    this._el.marchio = document.createElement("div");
    this._el.marchio.className = "marchio";
    this._el.marchio.setAttribute("role", "img");
    this._el.marchio.setAttribute("aria-label", "Tecnoalarm");
    card.appendChild(this._el.marchio);

    const lcd = document.createElement("div");
    lcd.className = "lcd";
    this._el.riga1 = document.createElement("span");
    this._el.riga2 = document.createElement("span");
    lcd.appendChild(this._el.riga1);
    lcd.appendChild(this._el.riga2);
    card.appendChild(lcd);

    const spie = document.createElement("div");
    spie.className = "spie";
    this._el.spie = SPIE.map(({ nome }) => {
      const spia = document.createElement("div");
      spia.className = "spia";
      const luce = document.createElement("i");
      const testo = document.createElement("b");
      testo.textContent = nome;
      spia.appendChild(luce);
      spia.appendChild(testo);
      spie.appendChild(spia);
      return spia;
    });
    card.appendChild(spie);

    const fascia = document.createElement("div");
    fascia.className = "fascia";
    const titolo = document.createElement("h3");
    titolo.textContent = "Programmi";
    const pastiglie = document.createElement("div");
    pastiglie.className = "pastiglie";
    this._el.programmi = Array.from({ length: 8 }, (_, i) => {
      const pastiglia = document.createElement("span");
      pastiglia.className = "pastiglia";
      pastiglia.textContent = String(i + 1);
      pastiglie.appendChild(pastiglia);
      return pastiglia;
    });
    fascia.appendChild(titolo);
    fascia.appendChild(pastiglie);
    card.appendChild(fascia);

    const tastierino = document.createElement("div");
    tastierino.className = "tastierino";
    TASTI.forEach(({ etichetta, codice, piccolo, conferma }) => {
      const tasto = document.createElement("button");
      tasto.className = `tasto${piccolo ? " piccolo" : ""}${conferma ? " conferma" : ""}`;
      tasto.textContent = etichetta;
      tasto.setAttribute("aria-label", `Tasto ${etichetta}`);
      tasto.addEventListener("click", () => this._inviaTasto(codice));
      tastierino.appendChild(tasto);
    });
    card.appendChild(tastierino);

    this.appendChild(card);
    this._costruita = true;
  }

  // ---------------------------------------------------------------------
  // Aggiornamento
  // ---------------------------------------------------------------------
  _aggiorna() {
    if (!this.config || !this._hass) return;

    const entita = this.config.entity || "sensor.nexus_tecnoalarm_keypad";
    const stato = this._hass.states[entita];

    if (!stato) {
      this.innerHTML = `<ha-card><div class="avviso">Entità ${entita} non trovata.</div></ha-card>`;
      this._costruita = false;
      return;
    }

    if (!this._costruita) this._costruisci();
    this._temaScuro();

    const assente = stato.state === "unavailable" || stato.state === "unknown";
    this._el.card.classList.toggle("assente", assente);

    if (assente) {
      this._el.riga1.textContent = a16("TASTIERA");
      this._el.riga2.textContent = a16("NON CONNESSA");
      return;
    }

    const payload = stato.attributes || {};
    this._el.riga1.textContent = a16(stato.state);
    this._el.riga2.textContent = a16(payload.riga2);

    // Rete: verde quando c'e', rossa lampeggiante quando manca. Le altre tre
    // sono spente a riposo e si accendono sull'anomalia.
    SPIE.forEach(({ chiave }, i) => {
      const spia = this._el.spie[i];
      let colore = null;
      let intermittente = false;

      if (chiave === "rete") {
        if (payload.rete) {
          colore = "verde";
          intermittente = lampeggia(payload, "rete");
        } else {
          colore = "rosso";
          intermittente = true;
        }
      } else {
        const attiva = Boolean(payload[chiave]) || lampeggia(payload, chiave);
        if (attiva) {
          colore = chiave === "tamper" ? "rosso" : "ambra";
          intermittente = lampeggia(payload, chiave);
        }
      }

      if (colore) spia.setAttribute("data-colore", colore);
      else spia.removeAttribute("data-colore");

      if (intermittente) spia.setAttribute("data-lampeggia", "");
      else spia.removeAttribute("data-lampeggia");
    });

    // Programmi. L'allarme prevale sull'inserimento: se un programma suona,
    // che sia anche inserito e' un dettaglio secondario.
    const programmi = payload.programmi || [];
    this._el.programmi.forEach((pastiglia, i) => {
      const p = programmi[i] || {};
      const inAllarme = Boolean(p.allarme) || lampeggia(p, "allarme");
      const inserito = Boolean(p.stato) || lampeggia(p, "stato");

      if (inAllarme) {
        pastiglia.setAttribute("data-stato", "allarme");
        this._intermittenza(pastiglia, lampeggia(p, "allarme"), Boolean(p.allarme));
      } else if (inserito) {
        pastiglia.setAttribute("data-stato", "inserito");
        this._intermittenza(pastiglia, lampeggia(p, "stato"), Boolean(p.stato));
      } else {
        pastiglia.removeAttribute("data-stato");
        pastiglia.removeAttribute("data-lampeggia");
      }
    });
  }

  /** Lampeggio lento quando lo stato di base e' comunque attivo. */
  _intermittenza(elemento, intermittente, lento) {
    if (!intermittente) {
      elemento.removeAttribute("data-lampeggia");
      return;
    }
    elemento.setAttribute("data-lampeggia", lento ? "lento" : "");
  }

  /**
   * Sceglie la versione del marchio dal tema in uso.
   *
   * Home Assistant non espone "sono in tema scuro": si ricava dal colore del
   * testo, che in tema scuro e' chiaro.
   */
  _temaScuro() {
    const colore = getComputedStyle(this._el.card).color;
    const canali = colore.match(/\d+/g);
    if (!canali) return;
    const [r, g, b] = canali.map(Number);
    const luminanza = 0.299 * r + 0.587 * g + 0.114 * b;
    this._el.card.classList.toggle("scuro", luminanza > 140);
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

class NexusTecnoalarmCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._aggiorna(); }
  set hass(hass) { this._hass = hass; this._aggiorna(); }

  _aggiorna() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = SCHEMA_EDITOR;
      this._form.computeLabel = () => "Entità della tastiera";
      this._form.addEventListener("value-changed", (ev) => {
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: ev.detail.value },
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

// Registrazione idempotente e non fatale.
//
// Questo file viene caricato dal frontend anche fuori dalla plancia: un
// doppio caricamento non deve lanciare, e un'eccezione qui dentro non deve
// poter impedire il boot dell'interfaccia.
try {
  if (!customElements.get("nexus-tecnoalarm-card")) {
    customElements.define("nexus-tecnoalarm-card", NexusTecnoalarmCard);
    customElements.define("nexus-tecnoalarm-card-editor", NexusTecnoalarmCardEditor);

    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "nexus-tecnoalarm-card",
      name: "Nexus Tecnoalarm Keypad",
      description: "Tastiera virtuale Tecnoalarm: display, spie e programmi.",
      preview: true,
      documentationURL: "https://github.com/Pacco24626/nexus_tecnoalarm",
    });

    console.info(
      `%c NEXUS-TECNOALARM-CARD %c ${VERSIONE_CARD} `,
      "color: #fff; background: #003b7a; font-weight: 700;",
      "color: #003b7a; background: #d6e6f5; font-weight: 700;"
    );
  }
} catch (err) {
  console.error("nexus-tecnoalarm-card: registrazione fallita", err);
}
