# Nexus Tecnoalarm Keypad 🛡️
Integrazione personalizzata per Home Assistant che interfaccia una tastiera virtuale **Tecnoalarm** tramite il gateway **Nexus-T** (V0.7.1+).

Questa integrazione consente di visualizzare lo stato in tempo reale (display LCD, LED diagnostici, stato degli 8 programmi) ed inviare i tasti premuti direttamente al gateway locale.

---

## ⚙️ Configurazione del Backend (Home Assistant)

### 1. Installazione

#### Opzione A: Installazione rapida tramite HACS (Consigliata)
1. Apri **HACS** in Home Assistant.
2. Vai su **Integrazioni** (Integrations).
3. Clicca sui **tre puntini in alto a destra** e seleziona **Repository personalizzati** (Custom repositories).
4. Nel campo **Repository**, inserisci:
   `https://github.com/Pacco24626/nexus_tecnoalarm`
5. Nel menu a tendina **Categoria**, seleziona **Integrazione** (Integration) e clicca su **Aggiungi**.
6. Clicca sulla scheda **Nexus Tecnoalarm Keypad** appena apparsa e seleziona **Scarica** (Download).
7. Riavvia Home Assistant per caricare il componente.

#### Opzione B: Installazione Manuale
1. Scarica e copia la cartella `custom_components/nexus_tecnoalarm` all'interno della cartella `/config/custom_components/` del tuo Home Assistant.
2. Riavvia Home Assistant.

---

### 2. Configurazione in `configuration.yaml`
Aggiungi le seguenti righe al tuo file `configuration.yaml` per definire i parametri di connessione al tuo gateway Nexus-T:

```yaml
nexus_tecnoalarm:
  host: "100.64.120.126"  # Sostituisci con l'IP locale o Tailscale del gateway
  port: 1880              # La porta utilizzata dal gateway Node-RED
```

Salva il file e **riavvia nuovamente Home Assistant**. Verrà creata l'entità sensore:
* `sensor.nexus_tecnoalarm_keypad`

---

## 🎨 Configurazione del Frontend (Lovelace Card)

L'integrazione è configurata per servire automaticamente il file JavaScript della card Lovelace. Non è necessario copiare manualmente alcun file nella cartella `www`.

### 1. Aggiungere la risorsa Lovelace
1. Su Home Assistant, vai in **Impostazioni** -> **Plance** (Dashboards).
2. In alto a destra, clicca sui **tre puntini** e seleziona **Risorse** (Resources).
3. Clicca su **Aggiungi Risorsa** in basso a destra.
4. Compila i campi nel seguente modo:
   * **URL:** `/nexus_tecnoalarm_local/nexus-tecnoalarm-card.js`
   * **Tipo di risorsa:** `Modulo JavaScript`
5. Clicca su **Crea**.

> [!NOTE]  
> In caso di successivi aggiornamenti grafici del file JS, puoi forzare la pulizia della cache del browser modificando l'URL della risorsa in: `/nexus_tecnoalarm_local/nexus-tecnoalarm-card.js?v=1.0.1`

### 2. Aggiungere la Card alla Plancia
1. Vai sulla tua Plancia principale, clicca sui tre puntini in alto a destra e seleziona **Modifica Plancia**.
2. Clicca su **Aggiungi scheda**, seleziona **Manuale** (in fondo all'elenco).
3. Incolla il seguente codice di configurazione YAML:

```yaml
type: custom:nexus-tecnoalarm-card
entity: sensor.nexus_tecnoalarm_keypad
```
4. Clicca su **Salva**.

---

## 🎛️ Mappatura Tasti e Servizi

L'integrazione registra un servizio chiamato `nexus_tecnoalarm.send_key` per inviare la pressione dei tasti. I codici numerici dei tasti sono:

| Tasto | Codice | Categoria |
| :--- | :---: | :---: |
| **0 - 9** | `0 - 9` | Tasti Numerici |
| **MEM** | `10` | Funzione (Azzurro) |
| **EXIT** | `11` | Funzione (Rosso) |
| **▼** | `12` | Freccia Giù (Giallo) |
| **▲** | `13` | Freccia Su (Giallo) |
| *** NO** | `14` | Cancella (Arancione) |
| **# YES** | `15` | Conferma (Verde) |

Puoi richiamare il servizio manualmente dagli **Strumenti per sviluppatori** -> **Servizi** selezionando `nexus_tecnoalarm.send_key` e passando il codice desiderato.
