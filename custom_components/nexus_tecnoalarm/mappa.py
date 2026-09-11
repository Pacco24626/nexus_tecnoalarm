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

_SCHEMA = re.compile(r"^tec_([zpt])_(\d+)_v\d+$")
_SEZIONI = {"z": "zone", "p": "programmi", "t": "telecomandi"}
_NOMI_PREDEFINITI = {"z": "Zona", "p": "Programma", "t": "Telecomando"}

_SCHEMA_TOPIC_RIFIUTO = re.compile(r"^tecnoalarm/programma/(\d+)/rifiuto$")


@dataclass(frozen=True)
class Voce:
    """Una voce del registro entita', ridotta a cio' che serve qui."""

    entity_id: str
    unique_id: str | None
    nome: str | None = None
    nome_originale: str | None = None
    disabilitata: bool = False


def mappa_vuota() -> dict[str, Any]:
    """La mappa quando la centrale non e' pubblicata su questo Home Assistant."""
    return {
        "dispositivo_trovato": False,
        "programmi": [],
        "zone": [],
        "telecomandi": [],
        "allarme_generale": None,
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
    risultato: dict[str, Any] = {
        "dispositivo_trovato": True,
        "programmi": [],
        "zone": [],
        "telecomandi": [],
        "allarme_generale": None,
    }

    for voce in voci:
        if voce.disabilitata:
            continue
        if voce.unique_id == ID_ALLARME_GENERALE:
            risultato["allarme_generale"] = voce.entity_id
            continue

        corrispondenza = _SCHEMA.match(voce.unique_id or "")
        if corrispondenza is None:
            continue

        tipo = corrispondenza.group(1)
        numero = int(corrispondenza.group(2))
        risultato[_SEZIONI[tipo]].append(
            {
                "numero": numero,
                "entity_id": voce.entity_id,
                "nome": nome_breve(voce, tipo, numero, nomi),
            }
        )

    for sezione in _SEZIONI.values():
        risultato[sezione].sort(key=lambda elemento: elemento["numero"])

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

    return pulito
