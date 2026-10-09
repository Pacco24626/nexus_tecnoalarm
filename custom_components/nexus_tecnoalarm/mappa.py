"""Mappa della centrale Tecnoalarm: da un elenco di voci del registro, la
struttura che la scheda allarme disegna.

Nessuna dipendenza da Home Assistant, di proposito: si prova a tavolino come
presence.py. La parte che parla con il registro e con MQTT sta in allarme.py.

Il gateway Nexus-T pubblica tutte le entita' dell'antifurto su un unico
dispositivo e le distingue per prefisso dell'unique_id:

    tec_z_<n>_v30        zona          binary_sensor
    tec_p_<n>_v30        programma     alarm_control_panel
    tec_t_<n>_v30        telecomando   switch
    tec_gen_alarm_v30    allarme generale della centrale
    tec_p_<n>_zoneap     zone aperte del programma <n>   binary_sensor

Il numero dopo il prefisso e' quello della programmazione della centrale, ed e'
l'ordine in cui la scheda li mostra. Va confrontato come numero: in ordine
alfabetico la zona 10 finirebbe prima della 2.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

ID_ALLARME_GENERALE = "tec_gen_alarm_v30"
ID_AZZERA_MEMORIE = "tec_azzera_memorie"
ID_MEMORIE = "tec_memorie"
ID_CONSENTI_ZONE_APERTE = "tec_consenti_zone_aperte"

# Le entita' singole della centrale: un unique_id fisso ciascuna, nessun numero.
# Vanno nella mappa perche' la card non puo' cercarle da sola — il registro
# entita' non lo vede chi non e' amministratore, e sul dispositivo della
# centrale il sensore delle memorie e' uno di trenta sensori binari.
_ID_SINGOLE = {
    ID_ALLARME_GENERALE: "allarme_generale",
    ID_AZZERA_MEMORIE: "azzera_memorie",
    ID_MEMORIE: "memorie",
    ID_CONSENTI_ZONE_APERTE: "consenti_zone_aperte",
}

_SCHEMA = re.compile(r"^tec_([zpt])_(\d+)_v\d+$")

# La spia «zone aperte» di un programma (gateway V0.8.55). L'unique_id non segue
# lo schema numerato con la versione, quindi senza una regola sua finirebbe
# scartata in silenzio come qualunque entita' estranea.
_SCHEMA_ZONE_APERTE = re.compile(r"^tec_p_(\d+)_zoneap$")
_SEZIONI = {"z": "zone", "p": "programmi", "t": "telecomandi"}
_NOMI_PREDEFINITI = {"z": "Zona", "p": "Programma", "t": "Telecomando"}

_SCHEMA_TOPIC_RIFIUTO = re.compile(r"^tecnoalarm/programma/(\d+)/rifiuto$")

# Quante zone, e quanto lunghi i nomi, si tengono di un rifiuto.
MAX_ZONE_RIFIUTO = 25
MAX_NOME_ZONA = 48


@dataclass(frozen=True)
class Candidato:
    """Un dispositivo che ha l'identificativo della centrale."""

    id: str
    domini: frozenset[str]


def scegli_centrale(candidati: Iterable[Candidato]) -> str | None:
    """L'id del dispositivo della centrale fra quelli con lo stesso identificativo.

    Da Home Assistant 2026.9 lo stesso identificativo puo' appartenere a piu'
    integrazioni, e la vecchia ricerca che ne restituiva uno solo e' deprecata.
    La centrale la crea MQTT: si preferisce quel dispositivo, e a parita' si
    prende il primo in ordine di id, per non cambiare scelta a ogni riavvio.
    """
    tutti = list(candidati)
    if not tutti:
        return None
    da_mqtt = [c for c in tutti if "mqtt" in c.domini]
    return sorted(da_mqtt or tutti, key=lambda c: c.id)[0].id


@dataclass(frozen=True)
class Voce:
    """Una voce del registro entita', ridotta a cio' che serve qui.

    Area e piano arrivano gia' risolti in nomi: il registro delle aree lo legge
    chi sta dal lato server, perche' una card gira con i permessi di chi la
    guarda e sul tablet di casa non vedrebbe nulla.
    """

    entity_id: str
    unique_id: str | None
    nome: str | None = None
    nome_originale: str | None = None
    disabilitata: bool = False
    area: str | None = None
    piano: str | None = None


def mappa_vuota() -> dict[str, Any]:
    """La mappa quando la centrale non e' pubblicata su questo Home Assistant."""
    return {
        "dispositivo_trovato": False,
        "programmi": [],
        "zone": [],
        "telecomandi": [],
        "allarme_generale": None,
        "azzera_memorie": None,
        "memorie": None,
        "consenti_zone_aperte": None,
    }


def nome_breve(
    voce: Voce, tipo: str, numero: int, nomi_dispositivo: Iterable[str] = ()
) -> str:
    """Il nome da mostrare, senza il nome del dispositivo davanti.

    Per le entita' raggruppate in un dispositivo Home Assistant mostra
    «Centrale Tecnoalarm Porta Ingresso». Dentro una scheda che e' gia' tutta
    della centrale quel prefisso e' rumore, e si toglie. Vince il nome dato
    dall'utente, poi quello pubblicato dal gateway; se mancano entrambi, un
    nome generico con il numero, cosi' la voce resta riconoscibile.
    """
    prefissi = [p for p in nomi_dispositivo if p]
    for candidato in (voce.nome, voce.nome_originale):
        if not candidato or not candidato.strip():
            continue
        testo = candidato.strip()
        for prefisso in prefissi:
            if testo.lower().startswith(prefisso.lower() + " "):
                testo = testo[len(prefisso) + 1 :].strip()
                break
        if testo:
            return testo
    return f"{_NOMI_PREDEFINITI[tipo]} {numero}"


def classifica(voci: Iterable[Voce], nomi_dispositivo: Iterable[str] = ()) -> dict[str, Any]:
    """Smista le voci del dispositivo in programmi, zone e telecomandi.

    Le entita' disabilitate restano fuori: chi le ha disabilitate non le vuole
    vedere. Quelle con un unique_id che non segue lo schema del gateway —
    per esempio il sensore della tastiera, se finisse sullo stesso
    dispositivo — si ignorano invece di finire in una sezione a caso.
    """
    nomi = tuple(nomi_dispositivo)
    # Le spie «zone aperte» si raccolgono a parte: nel registro possono
    # comparire prima del programma a cui appartengono, e si agganciano alla
    # fine, quando i programmi ci sono tutti.
    spie: dict[int, str] = {}
    risultato: dict[str, Any] = {
        "dispositivo_trovato": True,
        "programmi": [],
        "zone": [],
        "telecomandi": [],
        "allarme_generale": None,
        "azzera_memorie": None,
        "memorie": None,
        "consenti_zone_aperte": None,
    }

    for voce in voci:
        if voce.disabilitata:
            continue
        chiave = _ID_SINGOLE.get(voce.unique_id or "")
        if chiave is not None:
            risultato[chiave] = voce.entity_id
            continue

        spia = _SCHEMA_ZONE_APERTE.match(voce.unique_id or "")
        if spia is not None:
            spie[int(spia.group(1))] = voce.entity_id
            continue

        corrispondenza = _SCHEMA.match(voce.unique_id or "")
        if corrispondenza is None:
            continue

        tipo = corrispondenza.group(1)
        numero = int(corrispondenza.group(2))
        elemento: dict[str, Any] = {
            "numero": numero,
            "entity_id": voce.entity_id,
            "nome": nome_breve(voce, tipo, numero, nomi),
        }
        # Solo le zone: sono le uniche che la scheda raggruppa, e un dato che
        # nessuno legge pesa comunque su ogni aggiornamento dello stato.
        if tipo == "z":
            elemento["area"] = voce.area
            elemento["piano"] = voce.piano
        risultato[_SEZIONI[tipo]].append(elemento)

    for sezione in _SEZIONI.values():
        risultato[sezione].sort(key=lambda elemento: elemento["numero"])

    # La spia sta dentro la voce del programma, accanto a numero, entity_id e
    # nome: cosi' la scheda disegna la riga senza doverle riappaiare per numero.
    # La chiave c'e' sempre, a None con i gateway che non la pubblicano.
    for programma in risultato["programmi"]:
        programma["zone_aperte"] = spie.get(programma["numero"])

    return risultato


def numero_da_topic(topic: str | None) -> int | None:
    """Il numero di programma da 'tecnoalarm/programma/<n>/rifiuto'."""
    corrispondenza = _SCHEMA_TOPIC_RIFIUTO.match(topic or "")
    return int(corrispondenza.group(1)) if corrispondenza else None


def con_rifiuto(
    rifiuti: dict[str, dict[str, Any]], numero: int | str, rifiuto: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Un dizionario dei rifiuti NUOVO, con quello del programma sostituito.

    Mai modificarlo sul posto. Home Assistant decide se riscrivere uno stato
    confrontando gli attributi nuovi con quelli dello stato precedente, e di
    quelli tiene solo una copia superficiale: il dizionario annidato dei
    rifiuti e' lo stesso oggetto. Modificato sul posto, cambiava anche nel
    vecchio stato, il confronto usciva uguale e il sensore non veniva
    riscritto. La scheda non vedeva mai il rifiuto e restava ferma su
    «Disinserimento in corso…» (2.2.0, trovato sul campo l'11/09/2026).
    """
    return {**rifiuti, str(numero): dict(rifiuto)}


def pulisci_rifiuto(dati: Any) -> dict[str, Any] | None:
    """Solo i campi attesi del rifiuto, con i tipi attesi.

    Il payload arriva da un broker: non si ripubblica alla cieca quello che
    contiene. Senza un esito leggibile il messaggio non dice niente alla scheda
    e si scarta.

    ts resta intero perche' la scheda lo usa per riconoscere un rifiuto nuovo
    da uno gia' visto: due tentativi sbagliati di fila hanno ts diversi.
    """
    if not isinstance(dati, dict):
        return None

    esito = dati.get("esito")
    if not isinstance(esito, str) or not esito.strip():
        return None

    pulito: dict[str, Any] = {"esito": esito.strip()}

    for chiave in ("nome", "azione"):
        valore = dati.get(chiave)
        if isinstance(valore, str):
            pulito[chiave] = valore

    for chiave in ("programma", "ts"):
        valore = dati.get(chiave)
        # bool e' una sottoclasse di int in Python: True non e' un numero di
        # programma.
        if isinstance(valore, bool):
            continue
        if isinstance(valore, (int, float)):
            pulito[chiave] = int(valore)

    # I nomi delle zone che hanno fatto rifiutare l'inserimento: servono a dire
    # QUALE finestra chiudere, che e' l'unica cosa utile del messaggio. Si
    # tagliano in lunghezza e in numero perche' arrivano da un broker e
    # finiscono in un attributo di stato: una centrale grande ne avrebbe
    # centinaia, e un payload gonfiato peserebbe su ogni aggiornamento.
    #
    # Il campo si chiamava 'zone' fino all'08/10/2026, poi il gateway lo ha
    # rinominato 'zone_aperte' per dare un nome solo allo stesso insieme, che
    # la spia per programma pubblicava gia' cosi'. Si leggono tutti e due: un
    # gateway non aggiornato manda ancora il vecchio nome, e non e' una ragione
    # per lasciare l'utente senza sapere quale finestra ha davanti.
    grezzo = dati.get("zone_aperte")
    if not isinstance(grezzo, list):
        grezzo = dati.get("zone")
    nomi = [
        voce.strip()[:MAX_NOME_ZONA]
        for voce in grezzo
        if isinstance(voce, str) and voce.strip()
    ] if isinstance(grezzo, list) else []
    if nomi:
        pulito["zone_aperte"] = nomi[:MAX_ZONE_RIFIUTO]

    numeri = [
        int(voce)
        for voce in dati.get("numeri", [])
        if isinstance(voce, (int, float)) and not isinstance(voce, bool)
    ] if isinstance(dati.get("numeri"), list) else []
    if numeri:
        pulito["numeri"] = numeri[:MAX_ZONE_RIFIUTO]

    return pulito
