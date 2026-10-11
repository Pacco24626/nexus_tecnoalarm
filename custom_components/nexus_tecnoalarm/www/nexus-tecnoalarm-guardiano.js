/**
 * Guardiano del preallarme — Nexus Tecnoalarm
 *
 * Fa comparire il tastierino di disinserimento quando qualcuno entra, sui soli
 * dispositivi abilitati e sopra qualunque pagina. Su un dispositivo non
 * abilitato non fa assolutamente nulla: esce subito, e non carica niente.
 *
 * PERCHE' E' UN FILE A SE'
 *
 * Una scheda Lovelace esiste solo mentre la sua vista e' a schermo: se il
 * tablet sta mostrando Clima, non c'e' nessuno che possa aprire niente. Serve
 * quindi codice presente su OGNI pagina, e l'unico modo e' farlo caricare da
 * Home Assistant come modulo del frontend (`add_extra_js_url`), perche' le
 * risorse Lovelace le carica il pannello Lovelace e dalla 2026.10 la pagina
 * iniziale non e' una plancia.
 *
 * Ma un modulo del frontend viene eseguito PRIMA che il frontend installi il
 * suo registro «scoped» degli elementi personalizzati, che SOSTITUISCE
 * `window.customElements`. Una card registrata li' finisce nel registro
 * nativo, e Lovelace — che interroga quello nuovo — risponde «Custom element
 * doesn't exist». E' successo davvero, il 10/10/2026, mettendo la scheda
 * intera fra i moduli del frontend.
 *
 * Da qui la divisione: **questo file non definisce nessun elemento**, quindi
 * puo' essere caricato prestissimo senza danno; la scheda la si carica a
 * richiesta, quando serve davvero, e a quel punto il frontend e' in piedi da
 * un pezzo e la registrazione finisce nel registro giusto.
 */

const CHIAVE_DISPOSITIVO = "nexus_tecnoalarm_dispositivo";
const NOME_SCHEDA = "nexus-tecnoalarm-allarme";
const FILE_GUARDIANO = "nexus-tecnoalarm-guardiano.js";
const FILE_SCHEDA = "nexus-tecnoalarm-allarme.js";
const BASE_PREDEFINITA = "/nexus_tecnoalarm_local/";
const ATTESA_FRONTEND_MS = 2000;

/** L'identita' di questo dispositivo, o null. Non lancia mai. */
function identitaDispositivo() {
  try {
    const grezzo = window.localStorage.getItem(CHIAVE_DISPOSITIVO);
    const voce = grezzo ? JSON.parse(grezzo) : null;
    return voce && typeof voce.id === "string" ? voce : null;
  } catch (errore) {
    // Finestra anonima, dati del sito bloccati: si vive senza.
    return null;
  }
}

/** Questo dispositivo e' fra quelli abilitati sulla mappa? */
function abilitatoQui(mappa) {
  const identita = identitaDispositivo();
  if (!identita) return false;
  const elenco = Array.isArray(mappa.dispositivi_preallarme) ? mappa.dispositivi_preallarme : [];
  return elenco.includes(identita.id);
}

function hassCorrente() {
  // Oggetto interno del frontend, non interfaccia pubblica: un aggiornamento
  // di Home Assistant puo' spostarlo. Se non c'e', il guardiano tace.
  const radice = document.querySelector("home-assistant");
  return (radice && radice.hass) || null;
}

function mappaDa(hass) {
  for (const id of Object.keys(hass.states)) {
    const stato = hass.states[id];
    if (stato.attributes && stato.attributes.ruolo === "mappa_allarme") return stato;
  }
  return null;
}

/**
 * L'indirizzo della scheda, con la stessa versione nell'URL che ha questo
 * file. Deve combaciare con quello della risorsa Lovelace: a parita' di URL il
 * browser esegue il modulo una volta sola, e dove la plancia l'ha gia'
 * caricato non si duplica niente.
 *
 * Si legge dal proprio tag `<script>` e non da `import.meta`, che e' sintassi
 * valida solo dentro un modulo e renderebbe il file illeggibile ai banchi.
 */
function indirizzoScheda() {
  const mio = document.querySelector(`script[src*="${FILE_GUARDIANO}"]`);
  const base = mio && mio.src ? mio.src : BASE_PREDEFINITA + FILE_GUARDIANO;
  return base.replace(FILE_GUARDIANO, FILE_SCHEDA);
}

/** Carica la scheda se non c'e' gia'. Vero se alla fine l'elemento esiste. */
async function caricaScheda() {
  if (window.customElements.get(NOME_SCHEDA)) return true;
  try {
    await import(indirizzoScheda());
    await window.customElements.whenDefined(NOME_SCHEDA);
  } catch (errore) {
    console.error("nexus-tecnoalarm: scheda non caricata", errore);
    return false;
  }
  return Boolean(window.customElements.get(NOME_SCHEDA));
}

function avviaGuardiano() {
  if (window.__nexusTecnoalarmGuardiano) return;
  window.__nexusTecnoalarmGuardiano = true;

  let montata = null;      // la scheda «solo dialogo», mentre e' in pagina
  let episodio = null;     // l'entita' del programma per cui si e' gia' aperto
  let inCarico = false;    // caricamento in corso: non partirne un secondo
  let disiscrivi = null;

  const smonta = () => {
    if (!montata) return;
    const vecchia = montata;
    montata = null;
    vecchia.remove();
  };

  const monta = async (programma, mappa) => {
    if (!(await caricaScheda())) return;
    const hass = hassCorrente();
    if (!hass) return;
    // L'ingresso puo' essere finito mentre la scheda si caricava: aprire adesso
    // vorrebbe dire presentare un tastierino per un allarme che non c'e' piu'.
    const stato = hass.states[programma.entity_id];
    if (!stato || (stato.state !== "pending" && stato.state !== "triggered")) return;
    if (montata) return;

    const carta = document.createElement(NOME_SCHEDA);
    carta.setConfig({ entity: mappa.entity_id, solo_dialogo: true });
    document.body.appendChild(carta);
    carta.hass = hass;
    carta.addEventListener("nexus-dialogo-chiuso", smonta);
    montata = carta;
    carta._chiediDisinserimento(programma);
  };

  const guarda = () => {
    const hass = hassCorrente();
    if (!hass) return;
    const mappa = mappaDa(hass);
    if (!mappa) return;

    const programmi = mappa.attributes.programmi || [];
    const inCorso = programmi.find((p) => {
      const stato = hass.states[p.entity_id];
      // 'triggered' non chiude l'episodio: la sirena suona e il codice serve
      // ancora. Si chiude quando il programma torna a riposo.
      return stato && (stato.state === "pending" || stato.state === "triggered");
    });

    if (!inCorso) {
      // Fine dell'ingresso: via il tastierino, e si torna disponibili per la
      // prossima volta.
      episodio = null;
      smonta();
      return;
    }

    if (montata) {
      montata.hass = hass;
      return;
    }
    if (inCarico) return;
    // Chiuso a mano durante questo episodio: non si ripresenta addosso.
    if (episodio === inCorso.entity_id) return;
    if (!mappa.attributes.tastierino_preallarme) return;
    // Su un gateway precedente alla V0.8.59 'pending' e' il tempo d'USCITA: il
    // tastierino si aprirebbe a ogni inserimento, davanti a chi sta uscendo.
    if (!mappa.attributes.ingresso_distinto) return;
    if (!abilitatoQui(mappa.attributes)) return;

    episodio = inCorso.entity_id;
    inCarico = true;
    monta(inCorso, mappa)
      .catch((errore) => console.error("nexus-tecnoalarm: tastierino non aperto", errore))
      .then(() => { inCarico = false; });
  };

  const aggancia = () => {
    const hass = hassCorrente();
    if (!hass || !hass.connection) {
      window.setTimeout(aggancia, ATTESA_FRONTEND_MS);
      return;
    }
    if (disiscrivi) return;
    hass.connection
      .subscribeEvents(guarda, "state_changed")
      .then((stop) => { disiscrivi = stop; })
      .catch(() => { window.setTimeout(aggancia, ATTESA_FRONTEND_MS); });
    // Un ingresso puo' essere gia' in corso mentre la pagina si sveglia.
    guarda();
  };

  aggancia();
}

// Non fatale: un'eccezione qui non deve poter impedire il boot dell'interfaccia.
try {
  avviaGuardiano();
} catch (errore) {
  console.error("nexus-tecnoalarm: guardiano non avviato", errore);
}
