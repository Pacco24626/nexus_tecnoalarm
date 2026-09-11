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
        Voce,
        classifica,
        con_rifiuto,
        mappa_vuota,
        numero_da_topic,
        pulisci_rifiuto,
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
