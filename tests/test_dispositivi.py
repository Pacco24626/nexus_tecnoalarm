# -*- coding: utf-8 -*-
"""Collaudo a tavolino dell'elenco dei dispositivi abilitati al tastierino.

    python tests/test_dispositivi.py

Nessuna dipendenza da Home Assistant: dispositivi.py e' puro di proposito.
"""

from __future__ import annotations

import os
import sys

# Il modulo si importa diretto, senza passare dal pacchetto: __init__.py tira
# dentro Home Assistant, e dispositivi.py e' puro proprio per non averne bisogno.
sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "custom_components", "nexus_tecnoalarm")
    ),
)

from dispositivi import (  # noqa: E402
    MAX_DISPOSITIVI,
    con_dispositivo,
    elenco_valido,
    identificativi,
    pulisci_id,
    pulisci_nome,
    senza_dispositivo,
)

esiti: list[tuple[str, bool, object]] = []


def verifica(nome, condizione, dettaglio=""):
    esiti.append((nome, bool(condizione), dettaglio))


# --- 1. l'identificativo ------------------------------------------------------
verifica("identificativo buono", pulisci_id("a1b2c3d4e5") == "a1b2c3d4e5")
verifica("maiuscole e spazi si normalizzano", pulisci_id("  A1B2C3D4  ") == "a1b2c3d4")
verifica("troppo corto: scartato", pulisci_id("a1b2") is None)
verifica("caratteri strani: scartati", pulisci_id("a1b2-c3d4") is None)
verifica("non e' una stringa: scartato", pulisci_id(12345678) is None)
verifica("vuoto: scartato", pulisci_id("") is None)

# --- 2. il nome ---------------------------------------------------------------
verifica("nome ripulito", pulisci_nome("  Tablet ingresso  ") == "Tablet ingresso")
verifica("nome vuoto: ripiego", pulisci_nome("   ") == "Dispositivo")
verifica("nome lungo tagliato a 40", len(pulisci_nome("T" * 100)) == 40)

# --- 3. aggiunta --------------------------------------------------------------
elenco = con_dispositivo([], "a1b2c3d4", "Tablet ingresso")
verifica("primo dispositivo aggiunto",
         elenco == [{"id": "a1b2c3d4", "nome": "Tablet ingresso"}], elenco)

elenco = con_dispositivo(elenco, "e5f6a7b8", "Tablet notte")
verifica("secondo in coda", [v["id"] for v in elenco] == ["a1b2c3d4", "e5f6a7b8"], elenco)

# Riaccendere l'interruttore su un dispositivo gia' presente aggiorna il nome e
# non lo sposta: l'ordine e' quello in cui sono stati abilitati.
elenco = con_dispositivo(elenco, "a1b2c3d4", "Tablet ingresso (muro)")
verifica("stesso dispositivo: nome aggiornato, posizione invariata",
         [v["id"] for v in elenco] == ["a1b2c3d4", "e5f6a7b8"]
         and elenco[0]["nome"] == "Tablet ingresso (muro)", elenco)
verifica("nessun doppione", len(elenco) == 2, len(elenco))

# Non si modifica sul posto: Home Assistant confronta le opzioni per decidere
# se sono cambiate, e un elenco mutato in loco non si distingue da prima.
prima = con_dispositivo([], "a1b2c3d4", "Uno")
dopo = con_dispositivo(prima, "e5f6a7b8", "Due")
verifica("l'elenco di partenza non viene toccato", len(prima) == 1 and len(dopo) == 2,
         (len(prima), len(dopo)))

# --- 4. rimozione -------------------------------------------------------------
elenco = con_dispositivo(con_dispositivo([], "a1b2c3d4", "Uno"), "e5f6a7b8", "Due")
verifica("rimosso quello giusto",
         [v["id"] for v in senza_dispositivo(elenco, "a1b2c3d4")] == ["e5f6a7b8"])
verifica("rimuovere uno che non c'e' non cambia niente",
         senza_dispositivo(elenco, "ffffffff") == elenco)
verifica("identificativo sbagliato: elenco intatto", senza_dispositivo(elenco, "xx") == elenco)

# --- 5. elenco che arriva da .storage ----------------------------------------
# Le opzioni le puo' modificare anche chi scrive a mano nel file: non ci si fida.
sporco = [
    {"id": "a1b2c3d4", "nome": "Buono"},
    {"id": "A1B2C3D4", "nome": "Doppione con altre maiuscole"},
    {"id": "no", "nome": "Identificativo corto"},
    {"nome": "Senza identificativo"},
    "nemmeno un dizionario",
    {"id": "e5f6a7b8"},
]
pulito = elenco_valido(sporco)
verifica("solo le voci buone, senza doppioni",
         [v["id"] for v in pulito] == ["a1b2c3d4", "e5f6a7b8"], pulito)
verifica("voce senza nome: ripiego", pulito[1]["nome"] == "Dispositivo", pulito[1])
verifica("non e' una lista: elenco vuoto", elenco_valido("a1b2c3d4") == [])

# --- 6. il tetto --------------------------------------------------------------
molti: list = []
for n in range(MAX_DISPOSITIVI + 5):
    molti = con_dispositivo(molti, "%08d" % n, "Tablet %d" % n)
verifica("non si superano i %d dispositivi" % MAX_DISPOSITIVI,
         len(molti) == MAX_DISPOSITIVI, len(molti))
# Pieno, ma un rinomina di uno gia' dentro deve passare lo stesso.
molti = con_dispositivo(molti, "00000000", "Rinominato")
verifica("elenco pieno: si puo' ancora rinominare",
         molti[0]["nome"] == "Rinominato" and len(molti) == MAX_DISPOSITIVI, molti[0])

# --- 7. cosa vede la scheda ---------------------------------------------------
# Alla card servono gli identificativi, non i nomi: pubblicare in un attributo
# di stato come il cliente ha chiamato le stanze di casa sua non serve a niente.
elenco = con_dispositivo(con_dispositivo([], "a1b2c3d4", "Ingresso"), "e5f6a7b8", "Notte")
verifica("solo gli identificativi", identificativi(elenco) == ["a1b2c3d4", "e5f6a7b8"],
         identificativi(elenco))
verifica("nessun nome fra quelli pubblicati",
         all(not isinstance(v, dict) for v in identificativi(elenco)))

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
    print(f"DISPOSITIVI: {len(falliti)} controlli falliti su {len(esiti)}")
    sys.exit(1)
print(f"DISPOSITIVI: TUTTI I CONTROLLI SUPERATI ({len(esiti)})")
sys.exit(0)
