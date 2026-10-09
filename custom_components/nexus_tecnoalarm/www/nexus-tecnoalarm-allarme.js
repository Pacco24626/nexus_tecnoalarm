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

const VERSIONE_SCHEDA = "2.5.0";

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

// Quanto si aspetta che il gateway confermi lo scavalco acceso prima di
// mandare comunque l'inserimento.
const ATTESA_SCAVALCO_MS = 3000;
const PASSO_SCAVALCO_MS = 200;

/** Il registro eventi e' un'entita' a parte del gateway (V0.8.54 e successivi).
 * Si riconosce da questo attributo: l'identificativo dipende dal nome del
 * dispositivo e l'utente puo' rinominarlo, e una card con i permessi di chi
 * guarda non vede gli unique_id. */
const RUOLO_REGISTRO = "registro_eventi";

/** Quanto si aspetta che la spia delle memorie si spenga, dopo l'azzeramento.
 * Il gateway non manda un esito: la risposta e' la spia. Passato questo tempo
 * si smette di guardare, senza dire ne' riuscito ne' fallito. */
const ATTESA_MEMORIE_MS = 15000;
const MAX_EVENTI = 50;

/** Un'icona per tipo di evento, dalla prima parola e nient'altro: la descrizione
 * la scrive la centrale, con spaziatura irregolare e nel suo vocabolario. */
const ICONE_EVENTO = [
  [/^inser/i, "mdi:shield-lock"],
  [/^disin/i, "mdi:shield-off-outline"],
  [/^allarm/i, "mdi:alarm-light"],
  [/^access/i, "mdi:account-key"],
];
const ICONA_EVENTO = "mdi:information-outline";

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
    /* Il velo della conferma si appoggia qui dentro. */
    position: relative;
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

  /* --- Registro eventi ---------------------------------------------------- */
  .registro-blocco summary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    cursor: pointer;
    list-style: none;
  }
  .registro-blocco summary::-webkit-details-marker { display: none; }
  .registro-blocco summary::after {
    content: "";
    width: 7px; height: 7px;
    border-right: 2px solid var(--secondary-text-color);
    border-bottom: 2px solid var(--secondary-text-color);
    transform: rotate(45deg) translateY(-2px);
    transition: transform .2s ease;
  }
  .registro-blocco[open] summary::after { transform: rotate(-135deg) translateY(-2px); }
  .registro { display: flex; flex-direction: column; margin-top: 10px; }
  .evento {
    display: grid;
    grid-template-columns: 22px 78px 1fr;
    align-items: center;
    gap: 10px;
    padding: 7px 2px;
    border-top: 1px solid var(--bordo-tenue);
  }
  .evento:first-child { border-top: none; }
  .icona-evento { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .quando { display: flex; flex-direction: column; line-height: 1.2; }
  .quando .data { font-size: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .quando .ora { font-size: 13px; font-variant-numeric: tabular-nums; }
  .evento .cosa { font-size: 13px; line-height: 1.35; word-break: break-word; }
  .nota-registro { font-size: 11px; color: var(--secondary-text-color); padding: 8px 2px 0; }

  /* --- Dialogo ------------------------------------------------------------- */
  .corpo-dialogo .codice { margin-bottom: 10px; }
  .corpo-dialogo .tastierino { margin-bottom: 12px; }
  .dialogo .messaggio { margin-top: 10px; }
  .dialogo p.forte { color: var(--allarme); font-weight: 600; }

  /* Sul telefono il dialogo del tastierino prende tutto lo schermo: in una
     finestrella da 340 px i tasti diventano bersagli da 50 px e si sbaglia
     cifra. Vale solo per quello: una domanda da due righe a tutto schermo
     sarebbe sproporzionata, e infatti la classe la mette solo chi ha dentro
     il tastierino. */
  @media (max-width: 560px) {
    .velo.pieno { padding: 0; }
    .dialogo.pieno {
      /* border-box: con il conteggio predefinito l'altezza 100% e' quella del
         contenuto, e i 40 px di imbottitura finiscono fuori schermo portandosi
         via «Annulla». */
      box-sizing: border-box;
      max-width: none;
      width: 100%;
      height: 100%;
      border-radius: 0;
      padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 0px));
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    /* Il tastierino al centro dell'altezza che avanza, e i tasti piu' alti:
       il pollice di chi digita al buio non ha la mira del mouse. */
    .dialogo.pieno .corpo-dialogo {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 14px;
    }
    .dialogo.pieno .codice { min-height: 60px; font-size: 28px; margin-bottom: 0; }
    .dialogo.pieno .tastierino { max-width: 420px; gap: 12px; margin-bottom: 0; }
    .dialogo.pieno .tasto { aspect-ratio: 1 / .78; font-size: 24px; }
    .dialogo.pieno .tasto.piccolo { font-size: 18px; }
    .dialogo.pieno .disinserimenti { gap: 10px; }
    .dialogo.pieno .azioni-dialogo { margin-top: auto; padding-top: 14px; }
  }

  /* --- Zone aperte per programma ------------------------------------------- */
  .zone-aperte { font-size: 12px; line-height: 1.35; }
  .zone-aperte[data-tono="aperte"] { color: var(--attenzione); font-weight: 600; }
  .zone-aperte[data-tono="ignoto"] { color: var(--secondary-text-color); font-style: italic; }

  /* --- Memorie di allarme -------------------------------------------------- */
  .azzera {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 11px 14px;
    border-radius: 10px;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-text-color);
    background: var(--tasto-fondo);
    border: 1px solid var(--tasto-bordo);
  }
  .azzera:hover { background: var(--tasto-premuto); }
  .azzera ha-icon { --mdc-icon-size: 20px; }
  .blocco[data-memorie="si"] .azzera { border-color: var(--attenzione); color: var(--attenzione); }
  .conteggio[data-tono="attenzione"] { color: var(--attenzione); font-weight: 700; }

  /* --- Conferma ------------------------------------------------------------ */
  .velo {
    /* fixed e non absolute: la scheda e' piu' alta dello schermo, e un dialogo
       centrato su di lei finirebbe fuori vista. Centrato sulla finestra si
       vede sempre, da qualunque punto si sia premuto. */
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(31, 41, 51, .4);
    z-index: 3;
  }
  .dialogo {
    /* width E max-width. Con il solo max-width il riquadro si stringe sul
       contenuto, e il tastierino dentro - che e' largo 100% del genitore -
       si risolve sul minimo: tasti da 47x28, impossibili da centrare col
       pollice. Con i paragrafi non si notava, perche' a tenerlo largo era
       il testo. */
    width: 100%;
    max-width: 340px;
    padding: 18px;
    border-radius: 14px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    box-shadow: 0 10px 30px rgba(0, 0, 0, .25);
  }
  .dialogo h5 { margin: 0 0 10px; font-size: 16px; }
  .dialogo p { margin: 0 0 10px; font-size: 13px; line-height: 1.45; color: var(--secondary-text-color); }
  .azioni-dialogo { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  .azioni-dialogo button {
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--primary-text-color);
    background: var(--tasto-fondo);
    border: 1px solid var(--tasto-bordo);
  }
  .azioni-dialogo button.pericolo { color: var(--allarme); border-color: var(--allarme); }

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
/** Spezza una riga del registro in data, ora e descrizione.
 *
 * I primi 17 caratteri sono GG/MM/AA hh:mm:ss: quelli si tagliano con
 * sicurezza. La descrizione NON si analizza — spaziatura irregolare, nomi
 * programmati sulla centrale, vocabolario che dipende dalla lingua del
 * firmware: si mostra com'e'. Se la riga non comincia con una data si mostra
 * tutta come descrizione, invece di indovinare.
 */
function spezzaEvento(riga) {
  const testo = String(riga == null ? "" : riga);
  if (!/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/.test(testo)) {
    return { data: "", ora: "", descrizione: testo.trim() };
  }
  return { data: testo.slice(0, 8), ora: testo.slice(9, 17), descrizione: testo.slice(18).trim() };
}

/** «2 zone aperte: FINESTRA CUCINA, FIN.BAGNO P.T.»
 *
 * Si dice quante e quali, mai che verranno escluse: l'esclusione automatica
 * del gateway guarda tutto l'impianto e si ferma a venticinque, quindi i due
 * insiemi non sono lo stesso.
 */
function testoZoneAperte(quante, nomi) {
  const testa = `${quante} ${quante === 1 ? "zona aperta" : "zone aperte"}`;
  if (!nomi.length) return testa;
  const primi = nomi.slice(0, 3);
  const resto = nomi.length - primi.length;
  // «e altre 1» e' la frase che tradisce il programma: al singolare si dice
  // «e un'altra», e con tre nomi si scrivono tutti e tre invece di troncare
  // per guadagnare due parole.
  const coda = resto === 0 ? "" : resto === 1 ? " e un'altra" : ` e altre ${resto}`;
  return `${testa}: ${primi.join(", ")}${coda}`;
}

/** Perche' il gateway non ha eseguito, con i nomi quando li manda.
 *
 * Il rifiuto per zone aperte esiste solo se sul gateway e' acceso il modo
 * d'inserimento 4. Con l'esclusione automatica - l'impostazione normale - qui
 * non arriva niente, perche' l'impianto si inserisce.
 */
function testoRifiuto(rifiuto) {
  if (rifiuto.esito === "zone_aperte") {
    const nomi = Array.isArray(rifiuto.zone_aperte) ? rifiuto.zone_aperte : [];
    return nomi.length
      ? `non inserito, ${testoZoneAperte(nomi.length, nomi)}`
      : "non inserito: ci sono zone aperte";
  }
  return TESTI_ESITO[rifiuto.esito] || `comando non eseguito (${rifiuto.esito})`;
}

function iconaEvento(descrizione) {
  for (const [parola, icona] of ICONE_EVENTO) if (parola.test(descrizione)) return icona;
  return ICONA_EVENTO;
}

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
    // Si parte da cio' che non e' a posto: su una centrale da trenta zone
    // l'elenco intero e' una parete di tessere uguali, e prima di inserire
    // serve sapere che cosa non e' chiuso o porta una segnalazione.
    // «Tutte» resta a un tocco.
    this._filtroZone = "verificare";
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

    // Il registro eventi arriva dal gateway V0.8.54: prima non esiste, e la
    // scheda deve funzionare lo stesso. Si cerca a ogni giro perche' puo'
    // comparire dopo un aggiornamento del gateway, senza ricaricare la pagina.
    this._idRegistro = this._trovaRegistro();

    // La struttura cambia raramente (una zona aggiunta, un nome modificato):
    // solo allora si ricostruisce, altrimenti si aggiorna sul posto.
    const struttura = JSON.stringify([
      mappa.programmi,
      mappa.zone,
      mappa.telecomandi,
      mappa.allarme_generale,
      mappa.azzera_memorie,
      Boolean(this._idRegistro),
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
    this._disegnaMessaggio();
    this._disegnaDialogo();
    this._disegnaZone(mappa);
    this._disegnaTelecomandi(mappa);
    this._disegnaMemorie(mappa);
    this._disegnaRegistro();
  }

  /** L'entita' del registro, cercata per attributo e non per identificativo. */
  _trovaRegistro() {
    const stati = this._hass.states;
    const precedente = this._idRegistro && stati[this._idRegistro];
    if (precedente && precedente.attributes && precedente.attributes.ruolo === RUOLO_REGISTRO) {
      return this._idRegistro;
    }
    for (const id of Object.keys(stati)) {
      if (!id.startsWith("sensor.")) continue;
      const attributi = stati[id].attributes;
      if (attributi && attributi.ruolo === RUOLO_REGISTRO) return id;
    }
    return null;
  }

  _firmaStatiCorrente(mappa) {
    const id = [
      this._config.entity,
      mappa.allarme_generale,
      mappa.memorie,
      this._idRegistro,
      ...(mappa.programmi || []).map((p) => p.entity_id),
      ...(mappa.programmi || []).map((p) => p.zone_aperte),
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
    card.appendChild(this._costruisciZone(mappa));
    card.appendChild(this._costruisciTelecomandi(mappa));
    card.appendChild(this._costruisciMemorie(mappa));
    card.appendChild(this._costruisciRegistro());
    card.appendChild(this._costruisciDialogo());

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
      // Un pulsante solo per riga: inserisce se il programma e' disinserito,
      // apre il dialogo del codice se e' inserito. Due pulsanti affiancati su
      // una riga stretta si premono l'uno per l'altro.
      const bottone = el("button", {
        classe: "azione",
        type: "button",
        testo: "Inserisci",
        onclick: () => this._azioneProgramma(programma),
      });
      const zoneAperte = el("span", { classe: "zone-aperte", hidden: true });
      const riga = el("div", { classe: "prog" }, [
        icona,
        el("div", { classe: "testi" }, [
          el("span", { classe: "nome", testo: programma.nome }),
          stato,
          zoneAperte,
        ]),
        bottone,
      ]);
      contenitore.appendChild(riga);
      this._el.programmi.set(programma.entity_id, { riga, icona, stato, bottone, zoneAperte });
    }

    // I messaggi stanno qui, sotto i programmi: e' di loro che parlano quasi
    // sempre. Quelli del disinserimento li mostra il dialogo, che nel frattempo
    // copre la scheda.
    this._el.messaggio = el("div", { classe: "messaggio", "aria-live": "assertive" });

    const blocco = el("section", { classe: "blocco", hidden: programmi.length === 0 }, [
      el("div", { classe: "intestazione" }, [el("h3", { testo: "Programmi" })]),
      contenitore,
      this._el.messaggio,
    ]);
    return blocco;
  }

  /** Il pulsante della riga: cosa fa dipende da com'e' il programma adesso. */
  _azioneProgramma(programma) {
    const stato = this._hass.states[programma.entity_id];
    if (disinseribile(stato)) return this._chiediDisinserimento(programma);
    if (categoriaProgramma(stato) === "disinserito") return this._inserisci(programma);
    return undefined;
  }

  /**
   * Il corpo del dialogo di disinserimento: schermo del codice, tastierino e
   * i pulsanti dei programmi da disinserire.
   *
   * Non sta piu' fisso sotto i programmi: un tastierino sempre in vista occupa
   * mezza scheda per un'operazione che si fa due volte al giorno, e invita a
   * digitare il codice anche quando non serve.
   */
  _costruisciCorpoDisinserimento() {
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

    return [this._el.codice, tastierino, this._el.disinserimenti];
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
    this._el.vuotoZone = el("div", {
      classe: "vuoto", testo: "Nessuna zona da verificare.", hidden: true,
    });

    // Su una centrale grande le zone sono centinaia: poter guardare solo
    // quelle che non sono a posto e' cio' che serve prima di inserire.
    const filtro = el("div", { classe: "filtro", role: "group", "aria-label": "Zone da mostrare" });
    this._el.filtri = ["tutte", "verificare"].map((valore) => {
      const bottone = el("button", {
        type: "button",
        testo: valore === "tutte" ? "Tutte" : "Da verificare",
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

  _costruisciMemorie(mappa) {
    // Il pulsante resta premibile anche a spia spenta: la spia non copre tutte
    // le memorie (restano fuori codice o chiave falsa e i collegamenti LAN e
    // GSM), quindi spegnerlo impedirebbe un azzeramento legittimo.
    const stato = el("span", { classe: "conteggio" });
    const bottone = el(
      "button",
      { classe: "azzera", type: "button", onclick: () => this._chiediAzzeraMemorie() },
      [el("ha-icon", { icon: "mdi:bell-off-outline" }), el("span", { testo: "Azzera memorie" })]
    );
    const sezione = el("section", { classe: "blocco", hidden: !mappa.azzera_memorie }, [
      el("div", { classe: "intestazione" }, [el("h3", { testo: "Memorie di allarme" }), stato]),
      bottone,
    ]);
    this._el.memorie = { sezione, stato, bottone };
    return sezione;
  }

  /** Il velo della conferma: creato una volta e nascosto, non si aggiunge e
   * toglie dal documento a ogni pressione. */
  /**
   * Il velo modale, vuoto: lo riempiono i tre che lo usano.
   *
   * Uno solo per tutti - azzeramento memorie, rifiuto dell'inserimento,
   * disinserimento - perche' due dialoghi aperti insieme non devono poter
   * esistere, e con un velo solo e' impossibile per costruzione.
   */
  _costruisciDialogo() {
    const titolo = el("h5");
    const corpo = el("div", { classe: "corpo-dialogo" });
    const messaggio = el("div", { classe: "messaggio", "aria-live": "assertive" });
    const azioni = el("div", { classe: "azioni-dialogo" });
    const riquadro = el("div", { classe: "dialogo", role: "dialog", "aria-modal": "true" },
      [titolo, corpo, messaggio, azioni]);
    const velo = el("div", { classe: "velo", hidden: true, onclick: (evento) => {
      // Solo il velo, non il riquadro: un tocco dentro il dialogo non lo chiude.
      if (evento && evento.target === velo) this._chiudiDialogo();
    } }, [riquadro]);
    this._el.dialogo = { velo, riquadro, titolo, corpo, messaggio, azioni };
    this._el.velo = velo;
    return velo;
  }

  _apriDialogo({ titolo, corpo = [], azioni = [], suChiusura = null, pieno = false }) {
    const d = this._el && this._el.dialogo;
    if (!d) return;
    d.riquadro.classList.toggle("pieno", pieno);
    d.velo.classList.toggle("pieno", pieno);
    d.titolo.textContent = titolo;
    d.corpo.replaceChildren(...corpo);
    d.azioni.replaceChildren(
      ...azioni.map((a) => el("button", {
        classe: a.classe || "annulla", type: "button", testo: a.etichetta, onclick: a.onclick,
      }))
    );
    d.messaggio.textContent = "";
    delete d.messaggio.dataset.tono;
    this._suChiusura = suChiusura;
    d.velo.hidden = false;
  }

  _chiudiDialogo() {
    const d = this._el && this._el.dialogo;
    if (!d || d.velo.hidden) return;
    d.velo.hidden = true;
    d.titolo.textContent = "";
    d.corpo.replaceChildren();
    d.azioni.replaceChildren();
    // I pezzi del tastierino sono appena stati staccati: tenerne il riferimento
    // vorrebbe dire disegnare su nodi che non sono piu' in pagina.
    this._el.codice = null;
    this._el.tasti = null;
    this._el.disinserimenti = null;
    this._firmaDisinseribili = null;
    const finita = this._suChiusura;
    this._suChiusura = null;
    if (finita) finita();
  }

  _costruisciRegistro() {
    // Richiudibile e chiuso: e' un archivio che si consulta, non uno stato da
    // tenere d'occhio. Gli stati dell'impianto sono gia' nei blocchi sopra.
    const conteggio = el("span", { classe: "conteggio" });
    const lista = el("div", { classe: "registro" });
    const nota = el("div", { classe: "nota-registro" });
    const sezione = el("section", { classe: "blocco", hidden: true }, [
      el("details", { classe: "registro-blocco" }, [
        el("summary", {}, [el("h3", { testo: "Registro eventi" }), conteggio]),
        lista,
        nota,
      ]),
    ]);
    this._el.registro = { sezione, conteggio, lista, nota };
    return sezione;
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

      const puoDisinserire = disinseribile(stato);
      voce.bottone.hidden = !(categoria === "disinserito" || puoDisinserire);
      voce.bottone.textContent = puoDisinserire ? "Disinserisci" : "Inserisci";
      voce.bottone.setAttribute("aria-label", `${voce.bottone.textContent} ${programma.nome}`);
      voce.bottone.classList.toggle("secondaria", puoDisinserire);
      voce.bottone.disabled = this._occupato || this._inInserimento.has(programma.entity_id);

      this._disegnaZoneAperte(voce, programma);
    }

    this._verificaInserimenti();
  }

  /** La spia «zone aperte» del programma (gateway V0.8.55).
   *
   * Conta solo le zone istantanee: le ritardate, le interne e quelle isolate
   * non l'accendono, quindi non si scrive mai «tutto chiuso» — sarebbe smentito
   * dall'utente con la porta aperta in mano. Spenta: niente, e la riga resta
   * pulita. Non disponibile: lo si dice. La spia scade dopo un minuto di
   * silenzio del gateway, e quel silenzio non deve leggersi come «si puo'
   * inserire»; vale anche nei primi secondi dopo un riavvio di Home Assistant.
   */
  _disegnaZoneAperte(voce, programma) {
    const riquadro = voce.zoneAperte;
    if (!riquadro) return;
    if (!programma.zone_aperte) {
      riquadro.hidden = true;
      return;
    }

    const spia = this._hass.states[programma.zone_aperte];
    if (!spia || assente(spia)) {
      riquadro.hidden = false;
      riquadro.dataset.tono = "ignoto";
      riquadro.textContent = "zone aperte: non noto";
      return;
    }
    if (spia.state !== "on") {
      riquadro.hidden = true;
      return;
    }

    const nomi = Array.isArray(spia.attributes.zone_aperte) ? spia.attributes.zone_aperte : [];
    const quante = Number(spia.attributes.totale) || nomi.length;
    riquadro.hidden = false;
    riquadro.dataset.tono = "aperte";
    riquadro.textContent = testoZoneAperte(quante, nomi);
  }

  _disegnaMessaggio() {
    if (!this._el || !this._el.messaggio) return;
    const messaggio = this._messaggio;
    for (const nodo of [this._el.messaggio, this._el.dialogo && this._el.dialogo.messaggio]) {
      if (!nodo) continue;
      nodo.textContent = messaggio ? messaggio.testo : "";
      if (messaggio) nodo.dataset.tono = messaggio.tono;
      else delete nodo.dataset.tono;
    }
    // Vuoto, sotto i programmi, lascerebbe un buco: nel dialogo invece lo
    // spazio si tiene, o la finestra sobbalza quando compare il messaggio.
    this._el.messaggio.hidden = !messaggio;
  }

  /** Il dialogo di disinserimento, quando e' aperto. */
  _disegnaDialogo() {
    if (!this._el || !this._el.dialogo || this._el.dialogo.velo.hidden) return;
    this._disegnaMessaggio();
    if (!this._el.codice) return;

    const cifre = this._codice.length;

    this._el.codice.classList.toggle("vuoto", cifre === 0);
    // Mai le cifre: su un tablet a muro il codice lo vede chi e' dietro.
    this._el.codice.textContent = cifre ? "●".repeat(cifre) : "Digita il codice";
    this._el.codice.setAttribute(
      "aria-label",
      cifre ? `${cifre} cifre inserite` : "Nessuna cifra inserita"
    );
    this._el.tasti.forEach((tasto) => { tasto.disabled = this._occupato; });

    const disinseribili = this._disinseribiliOra();
    const scelto = this._sceltoDisinserimento;
    const firma = [scelto && scelto.entity_id, ...disinseribili.map((p) => p.entity_id)].join(",");

    if (firma !== this._firmaDisinseribili) {
      this._firmaDisinseribili = firma;
      this._el.disinserimenti.replaceChildren();

      // Per primo quello da cui sei entrato: e' quello che volevi, ed e' sotto
      // il dito. «Tutto» subito dopo, sempre nello stesso posto.
      const ancoraInserito = scelto && disinseribili.some((p) => p.entity_id === scelto.entity_id);
      if (ancoraInserito) {
        this._el.disinserimenti.appendChild(el("button", {
          classe: "azione", type: "button", testo: `Disinserisci ${scelto.nome}`,
          onclick: () => this._disinserisci([scelto]),
        }));
      }
      if (disinseribili.length > 1) {
        this._el.disinserimenti.appendChild(el("button", {
          classe: "azione secondaria", type: "button", testo: "Disinserisci tutto",
          onclick: () => this._disinserisci(this._disinseribiliOra()),
        }));
      }
      for (const programma of disinseribili) {
        if (ancoraInserito && programma.entity_id === scelto.entity_id) continue;
        this._el.disinserimenti.appendChild(el("button", {
          classe: "azione secondaria", type: "button", testo: `Disinserisci ${programma.nome}`,
          onclick: () => this._disinserisci([programma]),
        }));
      }
      if (disinseribili.length === 0) {
        this._el.disinserimenti.appendChild(
          el("div", { classe: "nota", testo: "Nessun programma inserito." })
        );
      }
    }

    this._el.disinserimenti.querySelectorAll("button").forEach((bottone) => {
      bottone.disabled = this._occupato || cifre === 0;
    });
  }

  /**
   * Apre il dialogo del codice, partendo dal programma su cui hai premuto.
   *
   * Il codice non si porta dietro da un'apertura all'altra: resta nel dialogo
   * e muore con lui.
   */
  _chiediDisinserimento(scelto) {
    if (this._occupato) return;
    this._codice = "";
    clearTimeout(this._timerCodice);
    this._messaggio = null;
    this._sceltoDisinserimento = scelto;
    this._firmaDisinseribili = null;
    this._apriDialogo({
      titolo: "Disinserimento",
      pieno: true,
      corpo: this._costruisciCorpoDisinserimento(),
      azioni: [{ etichetta: "Annulla", classe: "annulla", onclick: () => this._chiudiDialogo() }],
      suChiusura: () => {
        this._codice = "";
        clearTimeout(this._timerCodice);
        this._sceltoDisinserimento = null;
      },
    });
    this._disegnaDialogo();
  }

  _disinseribiliOra() {
    return (this._mappa().programmi || []).filter((p) => disinseribile(this._hass.states[p.entity_id]));
  }

  _disegnaZone(mappa) {
    const zone = mappa.zone || [];
    let aperte = 0;
    let segnalate = 0;
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

      // «Da verificare» non vuol dire solo aperta. Una zona esclusa non
      // impedisce l'inserimento ed e' chiusa: senza questo sparirebbe dalla
      // vista di apertura, ed e' proprio quella che vuoi vedere prima di
      // inserire. Stesso discorso per manomissione, guasto e batteria. Una
      // zona che non risponde ci sta per il motivo opposto: non sappiamo
      // com'e', e non saperlo e' gia' una ragione per guardarla.
      const daVerificare = aperta || mancante || bandierine.length > 0;
      if (daVerificare && !aperta) segnalate += 1;

      const mostrata = this._filtroZone === "tutte" || daVerificare;
      voce.tessera.hidden = !mostrata;
      if (mostrata) visibili += 1;
    }

    const conto = aperte
      ? `${aperte} aperte su ${zone.length}`
      : `tutte chiuse · ${zone.length}`;
    // La riga del conteggio non deve smentire le tessere: con tutto chiuso e
    // una zona esclusa a schermo, il solo «tutte chiuse» farebbe chiedere
    // perche' quella tessera sta li'.
    this._el.conteggioZone.textContent = segnalate
      ? `${conto} · ${segnalate} ${segnalate === 1 ? "segnalata" : "segnalate"}`
      : conto;
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

  _disegnaMemorie(mappa) {
    const voce = this._el.memorie;
    if (!voce) return;
    voce.sezione.hidden = !mappa.azzera_memorie;
    if (!mappa.azzera_memorie) return;

    const spia = mappa.memorie && this._hass.states[mappa.memorie];
    const accesa = Boolean(spia) && spia.state === "on";
    voce.stato.textContent = !spia
      ? ""
      : assente(spia)
        ? "spia non disponibile"
        : accesa
          ? "presenti"
          : "nessuna";
    voce.stato.dataset.tono = accesa ? "attenzione" : "";
    voce.sezione.dataset.memorie = accesa ? "si" : "no";

    // Non c'e' un esito: la risposta e' la spia che si spegne. Se era gia'
    // spenta non si annuncia niente, perche' non c'e' niente da vedere.
    if (this._attesaMemorie) {
      if (!accesa) {
        this._attesaMemorie = null;
        this._mostra("Memorie azzerate", "ok");
      } else if (Date.now() - this._attesaMemorie > ATTESA_MEMORIE_MS) {
        this._attesaMemorie = null;
      }
    }
  }

  _chiediAzzeraMemorie() {
    this._apriDialogo({
      titolo: "Azzerare le memorie di allarme?",
      corpo: [
        el("p", { testo: "Si azzerano allarme di zona e di programma, batteria, rete elettrica, codice o chiave falsa, collegamenti LAN e GSM." }),
        el("p", { testo: "Non si azzerano manomissione, errore e guasto: quelle chiedono il codice installatore e si cancellano dalla tastiera della centrale." }),
        el("p", { testo: "Gli eventi restano nel registro; le memorie a schermo e sulla tastiera no." }),
      ],
      azioni: [
        { etichetta: "Annulla", classe: "annulla", onclick: () => this._chiudiDialogo() },
        { etichetta: "Azzera", classe: "pericolo", onclick: () => { this._chiudiDialogo(); this._azzeraMemorie(); } },
      ],
    });
  }

  _azzeraMemorie() {
    const mappa = this._mappa();
    const id = mappa.azzera_memorie;
    if (!id) return;
    const spia = mappa.memorie && this._hass.states[mappa.memorie];
    // Si guarda la spia solo se era accesa: altrimenti non c'e' nessuna
    // transizione da aspettare e dire «azzerate» sarebbe inventarselo.
    this._attesaMemorie = spia && spia.state === "on" ? Date.now() : null;
    this._mostra("Comando inviato", "neutro");
    Promise.resolve(this._hass.callService("button", "press", {}, { entity_id: id })).catch(
      (errore) => this._mostra(testoErrore(errore), "allarme")
    );
  }

  _disegnaRegistro() {
    const voce = this._el.registro;
    if (!voce) return;
    const stato = this._idRegistro && this._hass.states[this._idRegistro];
    voce.sezione.hidden = !stato;
    if (!stato) return;

    const attributi = stato.attributes || {};
    const eventi = Array.isArray(attributi.eventi) ? attributi.eventi : [];
    const mostrati = Math.min(eventi.length, MAX_EVENTI);
    const totale = Number(attributi.totale);

    // «ultimi 50 di 312» solo quando il gateway ne ha davvero di piu': il suo
    // archivio arriva a 500, l'attributo si ferma a 50.
    voce.conteggio.textContent = !mostrati
      ? (assente(stato) ? "non disponibile" : "nessun evento")
      : Number.isFinite(totale) && totale > mostrati
        ? `ultimi ${mostrati} di ${totale}`
        : `${mostrati} ${mostrati === 1 ? "evento" : "eventi"}`;

    voce.lista.innerHTML = "";
    if (!mostrati) {
      voce.lista.appendChild(
        el("div", {
          classe: "vuoto",
          testo: assente(stato)
            ? "Il gateway non sta pubblicando il registro."
            : "Nessun evento. Dopo un riavvio del gateway l'elenco si ripopola entro un minuto.",
        })
      );
    }
    // L'ordine e' gia' quello giusto, dal piu' recente: non si riordina per data
    // ricavata dalla stringa, che ha l'anno a due cifre e nessun secolo.
    for (const riga of eventi.slice(0, MAX_EVENTI)) {
      const { data, ora, descrizione } = spezzaEvento(riga);
      voce.lista.appendChild(
        el("div", { classe: "evento" }, [
          el("ha-icon", { classe: "icona-evento", icon: iconaEvento(descrizione) }),
          el("div", { classe: "quando" }, [
            el("span", { classe: "data", testo: data }),
            el("span", { classe: "ora", testo: ora }),
          ]),
          el("span", { classe: "cosa", testo: descrizione }),
        ])
      );
    }

    // Data e ora brevi: la riga sta su una riga sola anche in una colonna stretta.
    const quando = attributi.aggiornato ? new Date(attributi.aggiornato) : null;
    const breve = quando && !Number.isNaN(quando.getTime())
      ? quando.toLocaleString(undefined, {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })
      : "";
    voce.nota.textContent = breve
      ? `aggiornato ${breve} \u00b7 archivio completo nella Dashboard del gateway`
      : "";
  }

  // ---------------------------------------------------------------------
  // Azioni
  // ---------------------------------------------------------------------
  async _inserisci(programma) {
    if (this._inInserimento.has(programma.entity_id)) return;
    this._inInserimento.add(programma.entity_id);
    this._disegnaProgrammi(this._mappa());

    // Il ts del rifiuto PRIMA di mandare il comando: serve a distinguere la
    // risposta a questo tentativo da un rifiuto vecchio rimasto nella mappa.
    const tsPrima = this._tsRifiuto(programma.numero);

    try {
      await this._hass.callService("alarm_control_panel", "alarm_arm_away", {
        entity_id: programma.entity_id,
      });
    } catch (errore) {
      this._mostra(`${programma.nome}: ${testoErrore(errore)}`, "allarme");
      this._inInserimento.delete(programma.entity_id);
      this._disegnaProgrammi(this._mappa());
      return;
    }

    this._osservaInserimento(programma, tsPrima);

    setTimeout(() => {
      this._inInserimento.delete(programma.entity_id);
      this._firmaStati = null;
      this._aggiorna();
    }, ATTESA_INSERIMENTO_MS);
  }

  /**
   * Tiene d'occhio un inserimento appena mandato, per dirlo se viene rifiutato.
   *
   * L'inserimento non ha un esito come il disinserimento: la risposta normale
   * e' il programma che passa a inserito. Ma con il modo 4 del gateway -
   * «rifiuta se ci sono zone aperte» - puo' tornare un rifiuto, e senza questo
   * il pulsante tornerebbe al suo posto senza che nulla spieghi perche'
   * l'impianto e' rimasto disinserito.
   *
   * Uno per programma, cosi' due inserimenti ravvicinati non si rubano
   * l'attesa a vicenda come farebbe uno slot solo.
   */
  _osservaInserimento(programma, tsPrima) {
    if (!this._attesiInserimento) this._attesiInserimento = new Map();
    this._chiudiInserimento(programma.entity_id);
    this._attesiInserimento.set(programma.entity_id, {
      programma,
      numero: programma.numero,
      nome: programma.nome,
      tsPrima,
      scadenza: setTimeout(() => this._chiudiInserimento(programma.entity_id), ATTESA_ESITO_MS),
    });
    this._verificaInserimenti();
  }

  _chiudiInserimento(entityId) {
    const attesa = this._attesiInserimento && this._attesiInserimento.get(entityId);
    if (!attesa) return;
    clearTimeout(attesa.scadenza);
    this._attesiInserimento.delete(entityId);
  }

  _verificaInserimenti() {
    if (!this._attesiInserimento || this._attesiInserimento.size === 0 || !this._hass) return;
    for (const [entityId, attesa] of [...this._attesiInserimento]) {
      const stato = this._hass.states[entityId];
      // Inserito, o in tempo d'uscita: ha funzionato, non c'e' niente da dire.
      if (stato && !assente(stato) && stato.state !== "disarmed") {
        this._chiudiInserimento(entityId);
        continue;
      }
      const rifiuto = (this._mappa().rifiuti || {})[String(attesa.numero)];
      if (rifiuto && rifiuto.ts !== attesa.tsPrima) {
        this._chiudiInserimento(entityId);
        this._offriRifiuto(attesa, rifiuto);
      }
    }
  }

  /**
   * Il rifiuto, e - solo per le zone aperte - il modo di passare oltre.
   *
   * Lo scavalco non e' una riga fissa della scheda di proposito: compare qui,
   * dentro il messaggio che dice quale finestra e' aperta, e se ne va con lui.
   * Premerlo arma la casa con una zona esclusa, e un pulsante sempre a portata
   * di dito si finisce per premerlo senza leggere.
   */
  _offriRifiuto(attesa, rifiuto) {
    const interruttore = this._mappa().consenti_zone_aperte;
    if (rifiuto.esito !== "zone_aperte" || !interruttore) {
      this._mostra(`${attesa.nome}: ${testoRifiuto(rifiuto)}`, "allarme");
      return;
    }
    const nomi = Array.isArray(rifiuto.zone_aperte) ? rifiuto.zone_aperte : [];
    this._apriDialogo({
      titolo: `${attesa.nome} non inserito`,
      corpo: [
        el("p", { classe: "forte",
          testo: nomi.length ? testoZoneAperte(nomi.length, nomi) : "Ci sono zone aperte." }),
        el("p", { testo: "Inserendo comunque la centrale le esclude: restano fuori sorveglianza fino al prossimo disinserimento." }),
      ],
      azioni: [
        { etichetta: "Annulla", classe: "annulla", onclick: () => this._chiudiDialogo() },
        { etichetta: "Inserisci comunque", classe: "pericolo", onclick: () => {
          this._chiudiDialogo();
          this._inserisciComunque(attesa.programma, interruttore);
        } },
      ],
    });
  }

  /**
   * Accende lo scavalco e rimanda l'inserimento.
   *
   * Prima l'interruttore, poi il comando, e in mezzo si aspetta che il gateway
   * confermi: mandati insieme, l'inserimento puo' arrivare per primo e farsi
   * rifiutare un'altra volta. Se la conferma non arriva si manda lo stesso -
   * un rifiuto in piu' lo si vede, un pulsante che non fa niente no.
   *
   * Lo scavalco lo spegne il gateway da se', dopo cinque minuti o dopo un
   * inserimento: non si spegne di qui, o due schede aperte se lo toglierebbero
   * di mano a vicenda.
   */
  async _inserisciComunque(programma, interruttore) {
    if (!programma) return;
    this._mostra("Scavalco in corso…", "neutro", 0);

    try {
      await this._hass.callService("switch", "turn_on", { entity_id: interruttore });
    } catch (errore) {
      this._mostra(`${programma.nome}: ${testoErrore(errore)}`, "allarme");
      return;
    }

    await this._attendiInterruttore(interruttore);
    this._messaggio = null;
    // L'attesa di sei secondi del tentativo di prima e' ancora in piedi: senza
    // toglierla di mezzo il comando nuovo verrebbe scartato come doppione.
    this._inInserimento.delete(programma.entity_id);
    await this._inserisci(programma);
  }

  _attendiInterruttore(interruttore) {
    // Si contano i giri invece di guardare l'orologio: il tempo di attesa
    // dipende cosi' solo dai timer, che e' l'unica cosa che una prova a
    // tavolino puo' far scorrere.
    return new Promise((risolvi) => {
      let restanti = Math.ceil(ATTESA_SCAVALCO_MS / PASSO_SCAVALCO_MS);
      const guarda = () => {
        const stato = this._hass && this._hass.states[interruttore];
        if (stato && stato.state === "on") return risolvi(true);
        if (restanti-- <= 0) return risolvi(false);
        setTimeout(guarda, PASSO_SCAVALCO_MS);
      };
      guarda();
    });
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
        this._disegnaDialogo();
      }, SCADENZA_CODICE_MS);
    }
    this._disegnaDialogo();
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
    let riuscito = false;

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
      riuscito = true;
    } finally {
      this._codice = "";
      clearTimeout(this._timerCodice);
      this._occupato = false;
      // Andata bene: il dialogo si toglie di mezzo e il messaggio resta sotto
      // i programmi. Andata male: resta aperto, cosi' si ridigita senza
      // ricominciare dalla riga.
      if (riuscito) this._chiudiDialogo();
      else this._disegnaDialogo();
      this._disegnaMessaggio();
      this._disegnaProgrammi(this._mappa());
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
        this._disegnaMessaggio();
      }, durata);
    }
    this._disegnaMessaggio();
    this._disegnaDialogo();
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
