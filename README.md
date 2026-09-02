<img src="icons/logo.png" alt="Nexus Tecnoalarm Keypad" width="360">

# Nexus Tecnoalarm Keypad

Tastiera virtuale **Tecnoalarm** in Home Assistant, attraverso il gateway **Nexus-T**.

Mostra in tempo reale il display LCD, i LED diagnostici e lo stato degli 8 programmi, e
invia i tasti premuti al gateway locale. Il polling della tastiera resta attivo **solo
quando la card è in vista**, così la centrale non viene interrogata a vuoto.

Dalla **2.0.0** si configura interamente dall'interfaccia e la card è inclusa: niente
`configuration.yaml`, niente risorse Lovelace da registrare a mano.

## Installazione

1. HACS → menu ⋮ → **Repository personalizzate**
2. URL `https://github.com/Pacco24626/nexus_tecnoalarm`, categoria **Integration**
3. Installa, poi **riavvia Home Assistant**
4. **Impostazioni → Dispositivi e servizi → Aggiungi integrazione → Nexus Tecnoalarm Keypad**

Una sola installazione: la card viene servita e registrata dall'integrazione stessa.

Requisiti: Home Assistant 2024.12 o superiore, gateway Nexus-T V0.7.1 o superiore.

## Configurazione

| Campo | Default | Note |
|---|---|---|
| Nome | `Tecnoalarm` | nome del dispositivo |
| Host | — | IP locale o indirizzo Tailscale del gateway |
| Porta | `443` | |
| Token di sicurezza | — | campo password, dalla dashboard impostazioni del portale |
| Usa TLS (wss) | sì | tenere attivo con il proxy Caddy, **su qualunque porta** |
| Verifica il certificato | no | lasciare spento con il certificato auto-firmato interno |

**La connessione viene provata prima di salvare.** Il gateway risponde all'autenticazione
con un esito esplicito, quindi i tre casi sono distinti: host irraggiungibile, token
rifiutato, tutto a posto. Non si scopre più l'errore nel log dopo un riavvio.

Da **Configura** si regolano anche i parametri di comportamento:

| Campo | Default | Note |
|---|---|---|
| Aggancia solo con la card in vista | sì | spento, la tastiera resta sempre agganciata |
| Finestra di presenza della card | 15 s | |
| Intervallo del ping applicativo | 5 s | **massimo 10 s**, vedi sotto |
| Attesa massima fra riconnessioni | 60 s | i tentativi partono da 5 s e raddoppiano |

Il tetto di 10 secondi sul ping non è arbitrario: il gateway rilascia la tastiera se non
riceve un ping entro 15 secondi (valore cablato nel nodo *Cervello AES* del flow). Oltre i
10 il display morirebbe a intermittenza.

## Aggiornare dalla 1.x

Tre passaggi, una volta sola:

1. **Togli il blocco `nexus_tecnoalarm:` da `configuration.yaml`.** Non serve più, e
   lasciandolo Home Assistant segnala un errore di configurazione all'avvio.
2. **Rimuovi la risorsa Lovelace** `/nexus_tecnoalarm_local/nexus-tecnoalarm-card.js` da
   *Impostazioni → Plance → Risorse*. Ora la registra l'integrazione, con la versione
   attaccata all'URL: gli aggiornamenti non richiedono più di svuotare la cache né il
   trucco del `?v=`. Se la lasci, la card viene caricata due volte.
3. **Aggiungi l'integrazione** e inserisci host, porta e token.

**Le card già in dashboard non vanno toccate.** L'entità mantiene lo stesso `unique_id`
della versione YAML, quindi `sensor.nexus_tecnoalarm_keypad`, la sua cronologia e ogni
`type: custom:nexus-tecnoalarm-card` esistente continuano a funzionare.

## Entità

| Entità | Descrizione |
|---|---|
| `sensor.nexus_tecnoalarm_keypad` | Riga 1 del display come stato, tutto il payload negli attributi |
| `binary_sensor.<nome>_connessione_tastiera` | Stato del WebSocket verso il gateway |

Il sensore del display ora diventa **non disponibile** quando il gateway non risponde,
invece di riportare la stringa `Disconnesso`. È ciò che permette a un'automazione di
distinguere "gateway giù" da "la centrale sta scrivendo qualcosa". La card lo gestisce
mostrando `TASTIERA NON CONNESSA` sull'LCD.

I suoi attributi sono esclusi dal recorder: cambiano a ogni polling e non hanno valore
storico, quindi non gonfiano più il database.

## Card

Si aggiunge dal selettore schede, oppure a mano:

```yaml
type: custom:nexus-tecnoalarm-card
entity: sensor.nexus_tecnoalarm_keypad
```

## Servizi

`nexus_tecnoalarm.send_key` — invia un tasto. Campo `code`, 0-9 per le cifre e 10-15 per i
tasti funzione. Con più gateway configurati si aggiunge `entry_id`.

`nexus_tecnoalarm.keypad_presence` — battito di presenza, chiamato dalla card. Non serve
invocarlo a mano.

## Cosa cambia nella 2.0.0

- Configurazione da interfaccia, con test della connessione; YAML rimosso
- Card inclusa e registrata dall'integrazione, con cache-busting per versione
- Riconnessione con backoff esponenziale ed errore loggato una volta per episodio, non a
  ogni tentativo
- Disponibilità reale dell'entità, e nuovo binary sensor di connessione
- Attributi fuori dal recorder, stato riscritto solo quando cambia davvero
- Dispositivo in HA, con host e link al gateway
- Alla chiusura di Home Assistant la tastiera viene rilasciata subito invece di aspettare
  la scadenza della finestra di presenza
- TLS e verifica del certificato espliciti, non più dedotti dal numero di porta

Il **flow del gateway non richiede alcuna modifica**: il protocollo sul filo è invariato.
