"""Prove a tavolino della mappa della centrale.

Stesso stile di test_presence.py: si importa il modulo puro direttamente, senza
Home Assistant, e si esce con codice diverso da zero al primo errore.
"""

import os
import sys

sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "custom_components", "nexus_tecnoalarm")
    ),
)

try:
    from mappa import (
        Candidato,
        Voce,
        classifica,
        con_rifiuto,
        mappa_vuota,
        numero_da_topic,
        pulisci_rifiuto,
        scegli_centrale,
    )
except ImportError as errore:
    print(f"Errore di importazione: {errore}")
    sys.exit(1)

DISPOSITIVO = ("Centrale Tecnoalarm",)

esiti = []


def verifica(nome, condizione, dettaglio=""):
    esiti.append((nome, bool(condizione), dettaglio))


# --- 1. ordine numerico ------------------------------------------------------
voci = [Voce(f"binary_sensor.z{n}", f"tec_z_{n}_v30", None, f"Zona {n}") for n in (10, 2, 1)]
mappa = classifica(voci, DISPOSITIVO)
ordine = [z["numero"] for z in mappa["zone"]]
verifica("zone in ordine numerico, non alfabetico", ordine == [1, 2, 10], ordine)

# --- 2. smistamento ----------------------------------------------------------
voci = [
    Voce("alarm_control_panel.totale", "tec_p_1_v30", None, "Totale"),
    Voce("switch.luce_esterna", "tec_t_1_v30", None, "Luce Esterna"),
    Voce("binary_sensor.porta", "tec_z_1_v30", None, "Porta Ingresso"),
    Voce("binary_sensor.allarme", "tec_gen_alarm_v30", None, "Allarme Generale Centrale"),
    Voce("sensor.nexus_tecnoalarm_keypad", "nexus_tecnoalarm_kpad_01", None, "Keypad"),
]
mappa = classifica(voci, DISPOSITIVO)
conteggi = (len(mappa["programmi"]), len(mappa["zone"]), len(mappa["telecomandi"]))
verifica("un programma, una zona, un telecomando", conteggi == (1, 1, 1), conteggi)
verifica(
    "allarme generale riconosciuto e tenuto fuori dalle zone",
    mappa["allarme_generale"] == "binary_sensor.allarme"
    and all(z["entity_id"] != "binary_sensor.allarme" for z in mappa["zone"]),
    mappa["allarme_generale"],
)
tutte = [e["entity_id"] for s in ("programmi", "zone", "telecomandi") for e in mappa[s]]
verifica("entita' con unique_id estraneo ignorate", "sensor.nexus_tecnoalarm_keypad" not in tutte, tutte)
verifica("dispositivo trovato", mappa["dispositivo_trovato"] is True)

# --- 3. disabilitate ---------------------------------------------------------
voci = [
    Voce("binary_sensor.z1", "tec_z_1_v30", None, "Zona uno"),
    Voce("binary_sensor.z2", "tec_z_2_v30", None, "Zona due", disabilitata=True),
]
mappa = classifica(voci, DISPOSITIVO)
verifica("le entita' disabilitate restano fuori", [z["numero"] for z in mappa["zone"]] == [1])

# --- 4. nomi -----------------------------------------------------------------
casi = [
    (Voce("a", "tec_z_1_v30", "Finestra Bagno Notte", "Finestra bagno"), "Finestra Bagno Notte",
     "vince il nome dato dall'utente"),
    (Voce("b", "tec_z_2_v30", None, "Centrale Tecnoalarm Porta Ingresso"), "Porta Ingresso",
     "il prefisso del dispositivo si toglie"),
    (Voce("c", "tec_t_3_v30", "centrale tecnoalarm Luce", None), "Luce",
     "il prefisso si toglie anche con maiuscole diverse"),
    (Voce("d", "tec_z_7_v30", None, None), "Zona 7",
     "senza nomi resta un nome generico con il numero"),
    (Voce("e", "tec_p_4_v30", "   ", "Test"), "Test",
     "un nome utente vuoto non conta"),
]
for voce, atteso, descrizione in casi:
    mappa = classifica([voce], DISPOSITIVO)
    elementi = mappa["zone"] + mappa["programmi"] + mappa["telecomandi"]
    ottenuto = elementi[0]["nome"] if elementi else None
    verifica(f"nome: {descrizione}", ottenuto == atteso, f"{ottenuto!r} invece di {atteso!r}")

# --- 5. senza allarme generale -----------------------------------------------
mappa = classifica([Voce("binary_sensor.z1", "tec_z_1_v30", None, "Z")], DISPOSITIVO)
verifica("senza allarme generale la chiave vale None", mappa["allarme_generale"] is None)
verifica("mappa vuota: dispositivo non trovato", mappa_vuota()["dispositivo_trovato"] is False)

# --- 5-bis. azzeramento delle memorie (gateway V0.8.55) ----------------------
# Le due entita' stanno sul dispositivo della centrale ma non seguono lo schema
# numerato: senza un ramo loro il filtro le scarterebbe in silenzio, e la card
# non avrebbe modo di trovarle.
voci = [
    Voce("binary_sensor.z1", "tec_z_1_v30", None, "Zona 1"),
    Voce("button.azzera", "tec_azzera_memorie", None, "Azzera memorie di allarme"),
    Voce("binary_sensor.memorie", "tec_memorie", None, "Memorie di allarme"),
]
mappa = classifica(voci, DISPOSITIVO)
verifica(
    "pulsante e spia delle memorie riconosciuti",
    mappa["azzera_memorie"] == "button.azzera" and mappa["memorie"] == "binary_sensor.memorie",
    (mappa["azzera_memorie"], mappa["memorie"]),
)
verifica(
    "la spia delle memorie non finisce fra le zone",
    [z["entity_id"] for z in mappa["zone"]] == ["binary_sensor.z1"],
    mappa["zone"],
)
mappa = classifica([Voce("binary_sensor.z1", "tec_z_1_v30", None, "Z")], DISPOSITIVO)
verifica(
    "gateway senza azzeramento: le due chiavi ci sono e valgono None",
    mappa["azzera_memorie"] is None and mappa["memorie"] is None,
)
vuota = mappa_vuota()
verifica(
    "mappa vuota: le due chiavi ci sono lo stesso",
    "azzera_memorie" in vuota and "memorie" in vuota
    and vuota["azzera_memorie"] is None and vuota["memorie"] is None,
    sorted(vuota),
)
mappa = classifica(
    [Voce("button.azzera", "tec_azzera_memorie", None, "Azzera", disabilitata=True)], DISPOSITIVO
)
verifica("pulsante disabilitato: resta fuori dalla mappa", mappa["azzera_memorie"] is None)

# --- 5-quater. interruttore di scavalco (gateway V0.8.55) --------------------
# Serve a non restare chiusi fuori quando una zona si guasta aperta. Come le
# altre entita' singole non segue lo schema numerato: senza un ramo suo la
# scheda non avrebbe modo di trovarlo.
mappa = classifica(
    [
        Voce("binary_sensor.z1", "tec_z_1_v30", None, "Zona 1"),
        Voce("switch.consenti", "tec_consenti_zone_aperte", None,
             "Consenti inserimento con zone aperte"),
    ],
    DISPOSITIVO,
)
verifica(
    "interruttore di scavalco riconosciuto",
    mappa["consenti_zone_aperte"] == "switch.consenti",
    mappa.get("consenti_zone_aperte"),
)
verifica(
    "lo scavalco non finisce fra i telecomandi",
    mappa["telecomandi"] == [],
    mappa["telecomandi"],
)
mappa = classifica([Voce("binary_sensor.z1", "tec_z_1_v30", None, "Z")], DISPOSITIVO)
verifica(
    "gateway senza scavalco: la chiave c'e' e vale None",
    "consenti_zone_aperte" in mappa and mappa["consenti_zone_aperte"] is None,
)
verifica(
    "mappa vuota: la chiave dello scavalco c'e' lo stesso",
    mappa_vuota()["consenti_zone_aperte"] is None,
)
mappa = classifica(
    [Voce("switch.consenti", "tec_consenti_zone_aperte", None, "Consenti", disabilitata=True)],
    DISPOSITIVO,
)
verifica("scavalco disabilitato: resta fuori", mappa["consenti_zone_aperte"] is None)

# --- 5-ter. spia «zone aperte» per programma (gateway V0.8.55) ---------------
# Anche questo identificativo sta fuori dallo schema numerato, e la spia va
# agganciata al programma giusto: appesa a quello sbagliato direbbe all'utente
# che e' aperta una zona che non lo e'.
voci = [
    # Volutamente in disordine, con la spia del 2 prima del programma 2:
    # l'aggancio non deve dipendere dall'ordine del registro.
    Voce("binary_sensor.zoneap2", "tec_p_2_zoneap", None, "Notte zone aperte"),
    Voce("alarm_control_panel.notte", "tec_p_2_v30", None, "Notte"),
    Voce("alarm_control_panel.totale", "tec_p_1_v30", None, "Totale"),
    Voce("binary_sensor.zoneap1", "tec_p_1_zoneap", None, "Totale zone aperte"),
    Voce("binary_sensor.z1", "tec_z_1_v30", None, "Zona 1"),
]
mappa = classifica(voci, DISPOSITIVO)
programmi = mappa["programmi"]
verifica("la spia non diventa un programma in piu'", len(programmi) == 2, len(programmi))
verifica(
    "programma 1: la sua spia, non quella del 2",
    programmi[0]["zone_aperte"] == "binary_sensor.zoneap1",
    programmi[0].get("zone_aperte"),
)
verifica(
    "programma 2: agganciata anche se arrivata prima",
    programmi[1]["zone_aperte"] == "binary_sensor.zoneap2",
    programmi[1].get("zone_aperte"),
)
verifica(
    "la spia non finisce fra le zone",
    [z["entity_id"] for z in mappa["zone"]] == ["binary_sensor.z1"],
    mappa["zone"],
)

# Gateway precedente alla V0.8.55: la chiave c'e' comunque, a None. La scheda
# distingue «nessuna spia» da «spia che non risponde», e senza la chiave
# leggerebbe lo stesso valore nei due casi.
mappa = classifica([Voce("alarm_control_panel.totale", "tec_p_1_v30", None, "Totale")], DISPOSITIVO)
verifica(
    "gateway senza la spia: la chiave c'e' e vale None",
    "zone_aperte" in mappa["programmi"][0] and mappa["programmi"][0]["zone_aperte"] is None,
    mappa["programmi"][0],
)

# Una spia orfana: il numero non corrisponde a nessun programma pubblicato.
mappa = classifica(
    [
        Voce("alarm_control_panel.totale", "tec_p_1_v30", None, "Totale"),
        Voce("binary_sensor.zoneap7", "tec_p_7_zoneap", None, "Spia 7"),
    ],
    DISPOSITIVO,
)
verifica(
    "spia senza il suo programma: ignorata",
    len(mappa["programmi"]) == 1 and mappa["programmi"][0]["zone_aperte"] is None,
    mappa["programmi"],
)

# Disabilitata dall'utente: niente spia, come per ogni altra entita'.
mappa = classifica(
    [
        Voce("alarm_control_panel.totale", "tec_p_1_v30", None, "Totale"),
        Voce("binary_sensor.zoneap1", "tec_p_1_zoneap", None, "Spia", disabilitata=True),
    ],
    DISPOSITIVO,
)
verifica("spia disabilitata: resta fuori dalla mappa", mappa["programmi"][0]["zone_aperte"] is None)

# Identificativi somiglianti che non sono la spia di un programma.
mappa = classifica(
    [
        Voce("alarm_control_panel.totale", "tec_p_1_v30", None, "Totale"),
        Voce("binary_sensor.a", "tec_z_1_zoneap", None, "Zona con coda strana"),
        Voce("binary_sensor.b", "tec_p_1_zoneaperte", None, "Coda diversa"),
    ],
    DISPOSITIVO,
)
verifica(
    "identificativi somiglianti: scartati",
    mappa["programmi"][0]["zone_aperte"] is None,
    mappa["programmi"][0],
)

# --- 5-quinquies. area e piano delle zone ------------------------------------
# Li risolve il lato server e li mette nella mappa: una card gira con i permessi
# di chi la guarda, e sul tablet di casa il registro delle aree non lo vede.
mappa = classifica(
    [
        Voce("binary_sensor.z1", "tec_z_1_v30", None, "Finestra cucina",
             area="Cucina", piano="Piano Terra"),
        Voce("binary_sensor.z2", "tec_z_2_v30", None, "Guasto PdC"),
        Voce("alarm_control_panel.p1", "tec_p_1_v30", None, "Totale",
             area="Salotto", piano="Piano Terra"),
        Voce("switch.t1", "tec_t_1_v30", None, "Luce", area="Salotto"),
    ],
    DISPOSITIVO,
)
verifica(
    "la zona porta area e piano",
    mappa["zone"][0]["area"] == "Cucina" and mappa["zone"][0]["piano"] == "Piano Terra",
    mappa["zone"][0],
)
verifica(
    "zona senza area: le chiavi ci sono e valgono None",
    mappa["zone"][1]["area"] is None and mappa["zone"][1]["piano"] is None,
    mappa["zone"][1],
)
# Programmi e telecomandi non si raggruppano: portarsi dietro area e piano
# vorrebbe dire gonfiare un attributo di stato con un dato che nessuno legge.
verifica(
    "i programmi non portano l'area",
    "area" not in mappa["programmi"][0] and "piano" not in mappa["programmi"][0],
    sorted(mappa["programmi"][0]),
)
verifica(
    "i telecomandi non portano l'area",
    "area" not in mappa["telecomandi"][0],
    sorted(mappa["telecomandi"][0]),
)

# --- 6. la centrale piu' grande ----------------------------------------------
# Una TP20-440 arriva a 440 zone. Le voci arrivano nell'ordine del registro,
# che non e' quello di programmazione.
voci = [Voce(f"binary_sensor.z{n}", f"tec_z_{n}_v30", None, None) for n in range(440, 0, -1)]
mappa = classifica(voci, DISPOSITIVO)
numeri = [z["numero"] for z in mappa["zone"]]
verifica("440 zone, tutte e in ordine", numeri == list(range(1, 441)), f"{len(numeri)} zone")

# --- 7. topic del rifiuto ----------------------------------------------------
verifica("numero dal topic", numero_da_topic("tecnoalarm/programma/2/rifiuto") == 2)
verifica("topic estraneo -> None", numero_da_topic("tecnoalarm/programma/2/set") is None)
verifica("topic assente -> None", numero_da_topic(None) is None)

# --- 8. pulizia del rifiuto --------------------------------------------------
grezzo = {
    "esito": "codice_errato",
    "programma": 2,
    "nome": "Notte",
    "azione": "DISARM",
    "ts": 1789074226818,
    "iniettato": "<script>",
}
pulito = pulisci_rifiuto(grezzo)
verifica("i campi estranei si scartano", pulito is not None and "iniettato" not in pulito, pulito)
verifica("ts resta intero", pulito is not None and pulito.get("ts") == 1789074226818, pulito)
verifica("senza esito il rifiuto si scarta", pulisci_rifiuto({"programma": 1, "ts": 5}) is None)
verifica("esito vuoto si scarta", pulisci_rifiuto({"esito": "  "}) is None)
verifica("un booleano non vale come numero",
         "programma" not in (pulisci_rifiuto({"esito": "x", "programma": True}) or {}))
verifica("un payload che non e' un dizionario si scarta", pulisci_rifiuto(["esito"]) is None)

# --- 8-bis. i nomi delle zone nel rifiuto (modo 4 del gateway) ---------------
# Senza i nomi il messaggio direbbe solo «ci sono zone aperte», che e' la parte
# che l'utente ha gia' capito: quello che gli serve e' QUALE finestra chiudere.
pulito = pulisci_rifiuto({
    "esito": "zone_aperte", "programma": 1, "nome": "Totale", "azione": "ARM",
    "zone_aperte": ["FINESTRA CUCINA", "  FIN.BAGNO P.T.  ", "", 7, None],
    "numeri": [3, 5, "x", True],
    "ts": 1700000000000,
})
verifica(
    "i nomi delle zone passano, ripuliti",
    pulito["zone_aperte"] == ["FINESTRA CUCINA", "FIN.BAGNO P.T."],
    pulito.get("zone_aperte"),
)

# Il campo si chiamava 'zone' fino all'08/10/2026. Un gateway non aggiornato
# manda ancora quello, e i nomi devono arrivare lo stesso: il contrario
# vorrebbe dire aggiornare i due pezzi nello stesso minuto su ogni impianto.
vecchio = pulisci_rifiuto({"esito": "zone_aperte", "zone": ["FIN.STUDIO"]})
verifica(
    "gateway vecchio: 'zone' legge ancora, sotto il nome nuovo",
    vecchio["zone_aperte"] == ["FIN.STUDIO"] and "zone" not in vecchio,
    sorted(vecchio),
)
# Se arrivano tutti e due vince il nome nuovo: e' quello che il gateway
# aggiornato riempie, e il vecchio potrebbe essere un residuo.
doppio = pulisci_rifiuto({
    "esito": "zone_aperte", "zone_aperte": ["NUOVO"], "zone": ["VECCHIO"],
})
verifica("con tutti e due vince 'zone_aperte'", doppio["zone_aperte"] == ["NUOVO"],
         doppio.get("zone_aperte"))
verifica(
    "i numeri delle zone passano, solo quelli veri",
    pulito["numeri"] == [3, 5],
    pulito.get("numeri"),
)
verifica("l'esito resta quello del gateway", pulito["esito"] == "zone_aperte")

# Un rifiuto senza zone - per esempio un codice errato - non si porta dietro
# chiavi vuote: la scheda distingue «non le manda» da «non ce ne sono».
pulito = pulisci_rifiuto({"esito": "codice_errato", "programma": 2, "ts": 1})
verifica(
    "rifiuto senza zone: nessuna chiave inventata",
    "zone_aperte" not in pulito and "numeri" not in pulito,
    sorted(pulito),
)

# Una centrale grande, o un payload malevolo, non devono gonfiare un attributo
# di stato che Home Assistant riscrive a ogni aggiornamento.
pulito = pulisci_rifiuto({
    "esito": "zone_aperte",
    "zone_aperte": ["Z" * 200] + ["ZONA %d" % n for n in range(100)],
    "numeri": list(range(100)),
})
verifica("elenco dei nomi tagliato a 25", len(pulito["zone_aperte"]) == 25,
         len(pulito["zone_aperte"]))
verifica("nome lungo tagliato a 48", len(pulito["zone_aperte"][0]) == 48,
         len(pulito["zone_aperte"][0]))
verifica("elenco dei numeri tagliato a 25", len(pulito["numeri"]) == 25, len(pulito["numeri"]))

# 'zone' che non e' una lista si scarta, come ogni altro campo di forma sbagliata.
pulito = pulisci_rifiuto({
    "esito": "zone_aperte", "zone_aperte": "FINESTRA CUCINA", "numeri": 3,
})
verifica(
    "zone e numeri di forma sbagliata: scartati",
    "zone_aperte" not in pulito and "numeri" not in pulito,
    sorted(pulito),
)

# --- 9. il rifiuto deve riscrivere lo stato ----------------------------------
# Home Assistant riscrive uno stato solo se gli attributi nuovi sono diversi da
# quelli del vecchio stato, di cui tiene una copia SUPERFICIALE (ReadOnlyDict).
# Qui si rifa' lo stesso confronto.
def attributi(rifiuti):
    return {"ruolo": "mappa_allarme", "rifiuti": rifiuti}


rifiuto_1 = {"esito": "codice_errato", "programma": 1, "ts": 1000}
rifiuto_2 = {"esito": "codice_errato", "programma": 1, "ts": 2000}

# Controllo: la modifica sul posto della 2.2.0 rende il confronto uguale.
# Se questa riga fallisse, la prova sotto non dimostrerebbe niente.
rifiuti = {}
vecchio_stato = dict(attributi(rifiuti))
rifiuti["1"] = rifiuto_1
verifica("controllo: modificato sul posto, HA non vede differenze",
         vecchio_stato == attributi(rifiuti))

rifiuti = {}
vecchio_stato = dict(attributi(rifiuti))
rifiuti = con_rifiuto(rifiuti, 1, rifiuto_1)
verifica("primo rifiuto: HA vede lo stato cambiato", vecchio_stato != attributi(rifiuti))

vecchio_stato = dict(attributi(rifiuti))
rifiuti = con_rifiuto(rifiuti, 1, rifiuto_2)
verifica("secondo rifiuto di fila: HA vede ancora il cambio", vecchio_stato != attributi(rifiuti))
verifica("il vecchio stato conserva il ts di prima",
         vecchio_stato["rifiuti"]["1"]["ts"] == 1000, vecchio_stato)

rifiuti = con_rifiuto(rifiuti, 3, rifiuto_1)
verifica("un altro programma non cancella il primo", set(rifiuti) == {"1", "3"}, rifiuti)

# --- 10. quale dispositivo e' la centrale (HA 2026.9) -------------------------
# Dal 2026.9 lo stesso identificativo puo' appartenere a piu' integrazioni.
mqtt = Candidato(id="dev_mqtt", domini=frozenset({"mqtt"}))
altro = Candidato(id="dev_altro", domini=frozenset({"nexus_tecnoalarm"}))
terzo = Candidato(id="aaa_terzo", domini=frozenset({"template"}))

verifica("nessun candidato: nessuna centrale", scegli_centrale([]) is None)
verifica("un solo candidato", scegli_centrale([altro]) == "dev_altro")
verifica("si preferisce il dispositivo di MQTT", scegli_centrale([terzo, altro, mqtt]) == "dev_mqtt")
verifica("senza MQTT, il primo in ordine di id",
         scegli_centrale([altro, terzo]) == "aaa_terzo")
verifica("due di MQTT: scelta stabile, non a caso",
         scegli_centrale([Candidato("b", frozenset({"mqtt"})), Candidato("a", frozenset({"mqtt"}))]) == "a")

# --- esito -------------------------------------------------------------------
falliti = [e for e in esiti if not e[1]]
larghezza = max(len(n) for n, _, _ in esiti)
for nome, ok, dettaglio in esiti:
    riga = f"{'ok  ' if ok else 'FALLITO'} {nome.ljust(larghezza)}"
    if not ok:
        riga += f"   {dettaglio}"
    print(riga)
print()
if falliti:
    print(f"MAPPA: {len(falliti)} controlli falliti su {len(esiti)}")
    sys.exit(1)
print(f"MAPPA: TUTTI I CONTROLLI SUPERATI ({len(esiti)})")
sys.exit(0)
