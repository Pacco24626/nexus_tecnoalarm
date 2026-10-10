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
2. **Non toccare la risorsa Lovelace.** Dalla 2.0.2 la gestisce l'integrazione: se ne
   trova già una la aggiorna all'URL della versione installata, altrimenti la crea. Gli
   aggiornamenti non richiedono più di svuotare la cache né il trucco del `?v=`.

3. **Aggiungi l'integrazione** e inserisci host, porta e token.

> [!WARNING]
> **Se dopo l'aggiornamento l'interfaccia non si carica**, l'integrazione va rimossa dal
> filesystem, perché senza interfaccia non ci arrivi da HACS: cancella la cartella
> `custom_components/nexus_tecnoalarm` con File Editor, Samba o il terminale, e riavvia.
> Il backend resta raggiungibile anche quando il frontend non parte.

**Le card già in dashboard non vanno toccate.** L'entità mantiene lo stesso `unique_id`
della versione YAML, quindi `sensor.nexus_tecnoalarm_keypad`, la sua cronologia e ogni
`type: custom:nexus-tecnoalarm-card` esistente continuano a funzionare.

## Entità

| Entità | Descrizione |
|---|---|
| `sensor.nexus_tecnoalarm_keypad` | Riga 1 del display come stato, tutto il payload negli attributi |
| `binary_sensor.<nome>_connessione_tastiera` | Stato del WebSocket verso il gateway |
| `sensor.<nome>_mappa_allarme` | Struttura dell'antifurto per la scheda allarme: programmi, zone e telecomandi in ordine di programmazione, e l'ultimo rifiuto del gateway per ciascun programma |

Il sensore del display ora diventa **non disponibile** quando il gateway non risponde,
invece di riportare la stringa `Disconnesso`. È ciò che permette a un'automazione di
distinguere "gateway giù" da "la centrale sta scrivendo qualcosa". La card lo gestisce
mostrando `TASTIERA NON CONNESSA` sull'LCD.

I suoi attributi sono esclusi dal recorder: cambiano a ogni polling e non hanno valore
storico, quindi non gonfiano più il database.

## Card della tastiera

Si aggiunge dal selettore schede, oppure a mano:

```yaml
type: custom:nexus-tecnoalarm-card
entity: sensor.nexus_tecnoalarm_keypad
```

Dalla 2.1.0 la card e' ridisegnata sulla F127EVLCD:

- **marchio originale**, con una variante schiarita per il tema scuro, dove il navy
  Tecnoalarm sarebbe illeggibile;
- **display a campo reale**, 16 caratteri per 2 righe come l'apparecchio;
- **spie con i nomi per esteso** — Rete, Guasto, Manomissione, Batteria — che
  lampeggiano quando il gateway segnala l'attributo intermittente;
- **programmi come fascia di segnalazioni**, non come tasti: non essendo associati a
  nulla, premerli non faceva niente. Il numero stesso e' la spia: neutro a riposo,
  ambra se inserito, rosso in allarme;
- **tasti a pastiglia** come sulla serigrafia, con il solo YES nel colore primario del
  tema perche' e' l'unico che chiude un'azione.

Tutto segue il tema di Home Assistant, chiaro e scuro, e le misure scalano sulla
larghezza della card: in una sezione stretta resta leggibile.

## Scheda allarme

Dalla 2.2.0 l'integrazione porta una seconda card, che mostra l'antifurto intero e
**si costruisce da sola**:

```yaml
type: custom:nexus-tecnoalarm-allarme
entity: sensor.tecnoalarm_mappa_allarme
raggruppa: piano   # piano (predefinito) | area | nessuno
```

I blocchi:

- **Programmi** — stato di ciascuno e un pulsante per riga: *Inserisci* se è
  disinserito (un tocco, senza codice), *Disinserisci* se è inserito. Sotto il nome,
  quando il gateway la pubblica, la riga delle zone aperte.
- **Zone** — con l'icona che corrisponde al `device_class` dichiarato
  dall'installatore e le segnalazioni estese della zona (esclusa, manomissione,
  guasto, batteria). **Si parte da *Da verificare***: le zone aperte, quelle che
  portano una segnalazione anche se chiuse, e quelle che non rispondono. Su una
  centrale grande l'elenco intero è una parete di tessere uguali, e prima di
  inserire serve sapere che cosa non è a posto — una zona **esclusa** è chiusa e non
  impedisce l'inserimento, ed è proprio quella che vuoi vedere. Il tasto *Tutte* le
  mostra tutte. Quando c'è una segnalazione il conteggio lo dice: *tutte chiuse · 29
  · 1 segnalata*.
- **Telecomandi** — interruttori.
- **Memorie di allarme** — la spia della centrale e il pulsante per azzerarle.
- **Registro eventi** — gli ultimi 50 eventi della centrale, richiudibile e chiuso
  all'apertura: è un archivio che si consulta, non uno stato da tenere d'occhio.

Non si elenca niente a mano. La scheda legge le entita' che il gateway Nexus-T
pubblica sul dispositivo *Centrale Tecnoalarm*: una zona aggiunta in programmazione
compare da sola, e una tolta sparisce.

### Come sono divise le zone

Dalla 2.5.0 nella vista *Tutte* le zone sono raggruppate, e il raggruppamento lo
decidono le **aree di Home Assistant**: assegni ogni zona alla sua stanza una volta
sola, dalla tabella delle entità con la selezione multipla, e la scheda si ordina da
sé. L'integrazione risolve area e piano lato server e li mette nella mappa, perché
una card gira con i permessi di chi la guarda e sul tablet di casa il registro delle
aree non lo vedrebbe.

`raggruppa` sceglie come: **`piano`** (predefinito), **`area`**, **`nessuno`**. Il
piano è il predefinito per una ragione di conti: su un impianto da trenta zone le
aree sono una dozzina, cioè un'intestazione ogni due tessere, mentre i piani sono due
o tre. L'opzione sta anche nell'editor visuale.

L'ordine dei gruppi è quello di numerazione della centrale, non alfabetico: la
programmazione di solito segue il giro della casa, mentre in ordine alfabetico
«Interrato» finirebbe davanti a «Piano Terra». Le zone senza area vanno in fondo, in
un gruppo a parte: sugli impianti veri sono ingressi tecnici — un guasto riportato,
un'uscita — non stanze dimenticate.

**Finché nessuna zona ha un'area — cioè appena installato — non compare nessuna
intestazione**: un titolo solo sopra l'elenco intero non dividerebbe niente. I gruppi
nascono quando assegni le zone, e spariscono se le togli.

Nella vista *Da verificare* le intestazioni spariscono: lì ci sono due o tre tessere,
e un titolo sopra ciascuna è più rumore che ordine.

### Il disinserimento

Dalla 2.5.0 il tastierino non sta più fisso sotto i programmi: **si preme
*Disinserisci* sulla riga del programma e si apre una finestra** con lo schermo del
codice, i tasti e, appena digitato il codice, i pulsanti per confermare — prima
quello da cui sei entrato, poi «Disinserisci tutto» se c'è più di un programma
inserito, poi gli altri. *Annulla* chiude in qualunque momento e dimentica il
codice già digitato.

Un tastierino sempre in vista occupava mezza scheda per un'operazione che si fa due
volte al giorno, e stava lontano dalla riga del programma che si voleva spegnere.

**Sul telefono la finestra prende tutto lo schermo** e i tasti diventano bersagli da
un centimetro abbondante: in un riquadro centrato restavano sotto i 50 px e si
sbagliava cifra. Le altre due finestre — conferma dell'azzeramento e rifiuto —
restano riquadri centrati, perché una domanda da due righe a tutto schermo sarebbe
sproporzionata.

**La scheda non sa se il codice è giusto**: non esiste un comando che lo verifichi,
la risposta la dà il gateway quando esegue. Per questo i pulsanti compaiono appena
c'è un codice, e l'esito si legge dopo: riuscito, la finestra si chiude da sé e sotto
i programmi resta scritto *Disinserito*; codice sbagliato, la finestra **resta
aperta** con scritto *Codice errato*, così si ridigita senza ricominciare.

I programmi si disinseriscono uno alla volta aspettando l'esito di ciascuno: un
codice sbagliato si ferma al primo rifiuto invece di mandare quattro comandi e
raccogliere quattro errori.

### Le memorie di allarme

Dalla 2.4.0, se il gateway le pubblica, la scheda mostra la spia delle memorie e un
pulsante per azzerarle. **Serve il gateway Nexus-T V0.8.55 o successivo**; con uno
più vecchio il blocco non compare.

**Il pulsante resta premibile anche a spia spenta.** Non è una svista: la spia della
centrale copre rete, batteria, memorie di zona e manomissioni, ma non copre codice o
chiave falsa né i collegamenti LAN e GSM, che pure vengono azzerati. A spia spenta
una memoria può esserci lo stesso, e bloccare il pulsante impedirebbe un azzeramento
legittimo. La spia informa, non comanda.

**Che cosa viene azzerato**, ed è scritto anche nella finestra di conferma: allarme di
zona e di programma, batteria, rete elettrica, codice o chiave falsa, collegamenti LAN
e GSM. **Non** manomissione, errore e guasto: quelle richiedono il codice installatore
e si cancellano dalla tastiera della centrale. Gli eventi restano nel registro; le
memorie a schermo e sulla tastiera no. L'azione non si annulla, per questo c'è la
conferma.

**L'esito non arriva dal gateway**, e la scheda non lo inventa: alla pressione dice
«comando inviato» e solo se la spia era accesa e si spegne entro una quindicina di
secondi aggiunge «memorie azzerate». Se la centrale è irraggiungibile il comando resta
in coda sul gateway e parte quando la connessione torna: dalla scheda non si distingue,
e per questo non viene annunciato nessun successo.

Premere più volte non fa danni: le pressioni ravvicinate le assorbe il gateway.

### Le zone aperte, programma per programma

Dalla 2.5.0, se il gateway le pubblica, sotto il nome di ogni programma
compare in arancione quante zone sono aperte e quali: *2 zone aperte: FINESTRA
CUCINA, FIN.BAGNO P.T.* — oltre i primi tre nomi si scrive «e un'altra» o «e
altre N», per non allungare la riga. **Serve il gateway Nexus-T V0.8.55 o successivo**; con uno più
vecchio la riga non compare e non cambia nulla.

**Quando non c'è scritto niente, non vuol dire «tutto chiuso».** La spia conta solo
le zone istantanee del programma: una ritardata aperta, una interna o una già isolata
la lasciano spenta. È per questo che la riga sparisce invece di dire «tutto a
posto»: una rassicurazione del genere la smentirebbe la prima finestra lasciata
accostata.

**Se la spia non risponde si legge «zone aperte: non noto»**, in grigio. Il gateway
la ripubblica di continuo e la fa scadere dopo un minuto di silenzio: capita durante
un riavvio o quando la centrale è irraggiungibile. Il silenzio non viene mai
presentato come via libera.

Si legge *non noto* anche quando la spia è accesa ma l'elenco è ancora vuoto: stato
e attributi sono due messaggi distinti, e in una transizione rapida il primo può
arrivare senza il secondo. *0 zone aperte* contraddirebbe se stessa, e una riga
pulita direbbe «tutto chiuso» mentre la spia dice il contrario.

**Il pulsante «Inserisci» resta premibile in tutti e tre i casi.** Le zone aperte le
esclude la centrale da sé al momento dell'inserimento, e l'elenco che si legge qui
non è quello delle escluse: l'esclusione automatica guarda l'impianto intero e si
ferma a venticinque. La riga serve a decidere, non a impedire.

### Se il gateway rifiuta l'inserimento

Sul gateway si puo' scegliere il **modo d'inserimento 4, «rifiuta se ci sono zone
aperte»**. Con l'impostazione normale l'impianto si inserisce escludendo da sé le
zone aperte e qui non arriva niente; con il modo 4 il gateway rifiuta, e **il rifiuto
vale per i comandi che arrivano da Home Assistant**, l'unico canale che ha modo di
spiegare perché. Da Vimar e da KNX decide un'impostazione a parte sulla Dashboard
del gateway.

Dalla 2.5.0 la scheda lo dice: *«Totale: non inserito, 2 zone aperte: FINESTRA
CUCINA, PORTAFINESTRA SALOTTO»*. Prima il pulsante tornava al suo posto e
l'impianto restava disinserito senza che nulla spiegasse il perché.

**Se la zona non si può chiudere** c'è l'interruttore *Consenti inserimento con zone
aperte*: acceso, il prossimo inserimento passa escludendo le aperte, e poi si spegne
da sé — vale cinque minuti o un inserimento, quello che viene prima. Lo spegne il
gateway, non l'integrazione: due schede aperte se lo toglierebbero di mano a vicenda.
Serve a non restare chiusi fuori quando un contatto si guasta aperto.

Nella scheda **non è una riga fissa**: il rifiuto apre una finestra che dice quali
zone sono aperte, avverte che inserendo comunque restano fuori sorveglianza, e
chiede — *Annulla* o *Inserisci comunque*. Premerlo arma la casa con una zona
esclusa, e un pulsante sempre a portata di dito si finisce per premerlo senza
leggere. Chi lo vuole sempre in vista può metterlo in plancia da sé: l'entità è un
normale `switch` del dispositivo della centrale.

**Per le automazioni** l'integrazione lancia l'evento `nexus_tecnoalarm_comando_rifiutato`
ogni volta che il gateway non esegue un comando — zone aperte, codice errato,
qualunque motivo. Serve a non dover ascoltare gli argomenti MQTT del gateway:

```yaml
triggers:
  - trigger: event
    event_type: nexus_tecnoalarm_comando_rifiutato
    event_data:
      esito: zone_aperte
actions:
  - action: tts.speak
    target:
      entity_id: tts.home_assistant_cloud
    data:
      media_player_entity_id: media_player.piano_terra
      message: >-
        {{ trigger.event.data.nome }} non inserito:
        {{ trigger.event.data.zone_aperte | join(', ') }} {{ 'aperta' if trigger.event.data.zone_aperte | count == 1 else 'aperte' }}
```

I campi dell'evento: `programma` (numero), `nome`, `azione` (`ARM` o `DISARM`),
`esito`, `ok`, `messaggio`, `zone_aperte` (i nomi, al massimo 25), `numeri`,
`entity_id` del pannello e `ts` del gateway.

**Dal gateway V0.8.56 quell'argomento porta anche i comandi riusciti**, con `ok` a
`true` e un `messaggio` già composto in italiano. L'evento continua a scattare **solo
sui fallimenti**: si chiama «rifiutato» e chi lo ascolta si aspetta un guaio, quindi
lanciarlo anche sui successi farebbe annunciare «non inserito» a inserimento
avvenuto. I successi restano nella mappa, dove li legge la scheda.

Nella scheda le frasi restano le nostre per gli esiti che conosce — *Codice errato*,
*non inserito, 2 zone aperte: …* — e si usa il `messaggio` del gateway per quelli
nati dopo questa versione della card, al posto del testo generico. Un esito con
`ok: true` **non chiude l'attesa**: `accettato` è l'ACK della centrale sulla trama,
non la prova che l'impianto sia inserito. Quella è e resta lo stato del programma.

**Quando non arriva nessun esito la scheda dice «nessuna conferma dalla centrale», mai
«non inserito».** Non è una sfumatura: ci sono tre modi in cui il comando non viene
eseguito e nessuno lo dice — la centrale accetta la trama e l'inserimento non si
completa; la coda del gateway supera le duecento voci e scarta le più vecchie, cosa
che capita proprio quando la centrale non risponde; Node-RED riparte e la coda, che
sta in memoria, se ne va. In nessuno dei tre sappiamo com'è andata, e per chi legge
«non ho conferma» e «non è inserito» sono due cose diverse.

Dal gateway V0.8.55 l'ultimo esito sta anche **negli attributi del pannello** del
programma (`esito`, `ts`, e dalla V0.8.56 `ok` e `messaggio`), leggibili con
`state_attr` senza passare né da questa integrazione né da MQTT. Serve a chi
inserisce da un'automazione: la chiamata al servizio riesce comunque, e senza
guardare l'esito un «inserisci alle 23» risulterebbe eseguito con la casa rimasta
disinserita.

**Non cercate lì l'elenco delle zone aperte.** Gli attributi del pannello sono
*l'ultimo messaggio arrivato*: dalla V0.8.56 su quell'argomento passano anche i
comandi riusciti, e un successo sovrascrive il rifiuto precedente con un esito che la
chiave `zone_aperte` non ce l'ha. L'elenco si legge dal **sensore «zone aperte» del
programma**, che è la sua sede.

### Gli stati del programma

| stato | che cosa vuol dire |
|---|---|
| `disarmed` | disinserito |
| `arming` | tempo d'uscita, o fase di inserimento |
| `armed_away` | inserito |
| `armed_home` | **parzializzato** — inserito a metà |
| `pending` | **ingresso in corso**: qualcuno è entrato e il programma conta alla rovescia |
| `triggered` | è questo programma ad aver fatto scattare l'allarme |

`pending` e `triggered` arrivano **dalla V0.8.59**; prima `pending` era il tempo
d'uscita e l'allarme si vedeva solo dal sensore generale della centrale.

**Attenzione a chi scrive automazioni**: la domanda «è inserito?» **non** si risponde
confrontando con il solo `armed_away`. Durante l'ingresso lo stato è `pending` e
durante un allarme è `triggered`: un controllo fatto male risponde «no, è
disinserito» proprio mentre qualcuno sta entrando in casa con l'impianto acceso. Vale
`armed_away`, `armed_home`, `pending` o `triggered`.

Nella scheda l'ingresso in corso prende i colori dell'allarme e pulsa — hai una
ventina di secondi, e una riga discreta non si guarda — ma la fascia rossa in cima
**non** si accende: quella nasce dal sensore generale della centrale, che in
preallarme resta spento. Riga rossa senza fascia significa «stai entrando»; riga
rossa con fascia significa «la sirena sta suonando».

### Il tastierino che si apre da solo

Entri dalla porta ritardata con l'impianto inserito, il programma va in preallarme e
hai una ventina di secondi. Con questa funzione, **sul tablet dell'ingresso il
tastierino per disinserire compare da solo**, sopra qualunque pagina fosse rimasta,
appena lo schermo torna vivo. Sugli altri dispositivi non cambia niente.

Si accende in due posti, ed è voluto.

**Nelle opzioni dell'integrazione** c'è l'interruttore dell'impianto, spento di
fabbrica: finché è spento la funzione non esiste e nella scheda non compare nemmeno
la riga per abilitare un dispositivo. Lì si vede anche **l'elenco dei dispositivi
abilitati** e si revocano, togliendo la spunta.

**Nella scheda**, su ogni dispositivo, compare allora una riga *Tastierino
automatico* con un pulsante *Attiva qui*. Lo accendi **camminando fino a quel
tablet**, e gli dai un nome che ritroverai nelle opzioni. Vale solo per quel
dispositivo: il telefono in tasca e il tablet della zona notte restano come sono.

La configurazione di una plancia è condivisa fra tutti i dispositivi che la aprono,
quindi la scelta non può stare lì: **l'identità è del dispositivo, l'autorizzazione
è del server**. Ogni browser si genera un identificativo e se lo ricorda in locale,
mentre l'elenco di chi è abilitato vive nelle opzioni. È per questo che **revocare un
tablet dalle opzioni ha effetto subito**, anche se quel tablet nessuno lo tocca per
mesi; e dalle opzioni si può solo revocare, perché abilitare richiede di essere lì.

**Perché funziona da qualunque pagina.** Una scheda Lovelace esiste solo mentre la
sua vista è a schermo: se il tablet sta mostrando un'altra plancia, non c'è nessuno
che possa aprire niente. Le risorse Lovelace però vengono caricate su **ogni** pagina
— è così che i tipi di card si registrano — quindi il pezzo che sorveglia il
preallarme gira sempre, anche dove la scheda non c'è. Su un dispositivo non abilitato
non fa assolutamente nulla.

Due limiti da conoscere:

- **a schermo spento la pagina è congelata** e nessuno può anticipare il risveglio.
  Il tastierino compare appena tocchi, senza dover prima navigare da nessuna parte,
  che è il meglio ottenibile;
- **un tastierino che si presenta da solo lo vede anche chi è entrato senza averne
  diritto.** Non gli regala il codice, quindi il rischio è modesto, ma è comodità
  pagata in sicurezza e va detto a chi la installa.

La finestra si chiude da sé quando il programma torna a riposo, e non si ripresenta
se l'hai chiusa tu: torna al prossimo ingresso. Con l'allarme già scattato resta
aperta, perché il codice serve ancora.

### Il registro eventi

Dalla 2.3.0, se il gateway lo pubblica, la scheda mostra un quinto blocco con gli
ultimi eventi letti dalla centrale: data e ora in una colonna, la descrizione
com'è arrivata nell'altra, un'icona ricavata dalla prima parola (inserimento,
disinserimento, accesso, allarme) e un ripiego generico per tutto il resto.

**Serve il gateway Nexus-T V0.8.54 o successivo.** Con un gateway più vecchio
l'entità non esiste, il blocco non compare e il resto della scheda funziona come
prima: non c'è niente da configurare né da togliere.

La scheda trova l'entità da sola, cercando l'attributo `ruolo: registro_eventi`.
Non va indicata nella configurazione, e continua a funzionare anche se la si
rinomina: l'identificativo dipende dal nome del dispositivo e non si può
indovinare.

La descrizione non viene interpretata. La scrive la centrale, con la sua
spaziatura, i nomi programmati dall'installatore fra parentesi quadre e il
vocabolario della lingua del firmware: cercare di estrarne «chi» e «cosa»
funzionerebbe su un impianto e si romperebbe sul successivo. Per lo stesso motivo
l'ordine è quello ricevuto dal gateway, dal più recente: l'anno è a due cifre e
riordinare per data ricavata dalla stringa sarebbe un azzardo.

Il gateway conserva fino a 500 eventi ma ne pubblica 50: quando sono di più la
scheda scrive «ultimi 50 di N» e rimanda alla Dashboard del gateway, dove c'è
l'archivio intero. L'aggiornamento avviene entro un minuto dall'evento.

> [!TIP]
> L'elenco viaggia in un attributo di qualche kilobyte, e Home Assistant archivia
> gli attributi a ogni cambiamento. Su un impianto movimentato conviene escluderlo
> dal registratore:
>
> ```yaml
> recorder:
>   exclude:
>     entity_globs:
>       - sensor.*ultimo_evento_centrale
> ```
>
> Si perde lo storico nativo di quell'entità, non gli eventi: quelli stanno sulla
> centrale e nella Dashboard del gateway.

### Perche' serve un sensore e non basta la card

Una card gira nel browser con i permessi di chi e' collegato. Sul tablet a muro, con
un utente di casa, **non vede gli unique_id** delle entita' — il registro completo e'
riservato agli amministratori — e **non puo' sottoscrivere un argomento MQTT**. Sono
esattamente le due cose che servono: gli unique_id per sapere cos'e' ogni entita' e in
che ordine va, e i rifiuti del gateway per dire «codice errato».

L'integrazione le fa lato server e ne pubblica il risultato nel sensore
`mappa_allarme`, che qualunque utente puo' leggere.

### Il codice

Non viene mai mostrato — sul display ci sono pallini — e si cancella da solo dopo
trenta secondi. Si passa al servizio `alarm_control_panel.alarm_disarm`:

- con il gateway **dalla V0.8.31** lo verifica il gateway, e un rifiuto arriva
  sull'argomento `tecnoalarm/programma/<n>/rifiuto`, che l'integrazione inoltra alla
  scheda;
- con i gateway **precedenti** lo verifica ancora Home Assistant, e la scheda mostra
  lo stesso «Codice errato».

L'allarme in corso non si legge dai programmi, che non pubblicano mai `triggered`: la
fascia rossa in cima segue il sensore *Allarme Generale Centrale*.

### Requisiti e limiti

- Il gateway deve avere attiva la pubblicazione verso Home Assistant.
- L'integrazione **MQTT** serve solo per i rifiuti. Senza, inserimento, zone e
  telecomandi funzionano, ma con un gateway V0.8.31 un codice sbagliato non produce
  nessun messaggio.
- **Un gateway per Home Assistant.** Il gateway pubblica le entita' con un
  identificativo fisso: due gateway sullo stesso Home Assistant si sovrapporrebbero.

## Servizi

`nexus_tecnoalarm.send_key` — invia un tasto. Campo `code`, 0-9 per le cifre e 10-15 per i
tasti funzione. Con più gateway configurati si aggiunge `entry_id`.

`nexus_tecnoalarm.keypad_presence` — battito di presenza, chiamato dalla card. Non serve
invocarlo a mano.

## Cosa cambia nella 2.0.0

- Configurazione da interfaccia, con test della connessione; YAML rimosso
- Card inclusa e registrata dall'integrazione come risorsa Lovelace, con cache-busting
  per versione
- Riconnessione con backoff esponenziale ed errore loggato una volta per episodio, non a
  ogni tentativo
- Disponibilità reale dell'entità, e nuovo binary sensor di connessione
- Attributi fuori dal recorder, stato riscritto solo quando cambia davvero
- Dispositivo in HA, con host e link al gateway
- Alla chiusura di Home Assistant la tastiera viene rilasciata subito invece di aspettare
  la scadenza della finestra di presenza
- TLS e verifica del certificato espliciti, non più dedotti dal numero di porta

Il **flow del gateway non richiede alcuna modifica**: il protocollo sul filo è invariato.

## Licenza

Apache 2.0 — Copyright 2026 Automatic Systems. Vedi [LICENSE](LICENSE).
