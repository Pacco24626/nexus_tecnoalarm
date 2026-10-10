"""I dispositivi abilitati al tastierino automatico in preallarme.

Nessuna dipendenza da Home Assistant, di proposito: si prova a tavolino come
mappa.py. Qui sta solo la manutenzione dell'elenco; chi lo legge e chi lo
scrive sta in __init__.py, config_flow.py e sensor.py.

Il modello e' questo: **l'identita' e' del dispositivo, l'autorizzazione e' del
server**. Ogni browser si genera un identificativo e se lo ricorda in locale;
l'elenco di chi e' abilitato vive nelle opzioni dell'integrazione. Cosi'
revocare un tablet dalle opzioni ha effetto subito, anche se quel tablet sta
dall'altra parte della casa e nessuno lo tocchera' per mesi.
"""

from __future__ import annotations

import re
from typing import Any

# Un impianto con piu' di venticinque tablet abilitati non esiste: il tetto
# serve contro un elenco che cresce per errore, non contro l'utente.
MAX_DISPOSITIVI = 25
MAX_NOME = 40

# L'identificativo lo genera il browser. Si accetta solo la forma attesa:
# finisce in un attributo di stato e in un confronto, e non c'e' motivo di
# lasciar passare altro.
_SCHEMA_ID = re.compile(r"^[a-z0-9]{8,32}$")


def pulisci_id(valore: Any) -> str | None:
    """L'identificativo se ha la forma giusta, altrimenti None."""
    if not isinstance(valore, str):
        return None
    ident = valore.strip().lower()
    return ident if _SCHEMA_ID.match(ident) else None


def pulisci_nome(valore: Any, ripiego: str = "Dispositivo") -> str:
    """Il nome da mostrare nelle opzioni, mai vuoto."""
    if not isinstance(valore, str) or not valore.strip():
        return ripiego
    return valore.strip()[:MAX_NOME]


def elenco_valido(elenco: Any) -> list[dict[str, str]]:
    """L'elenco ripulito di cio' che non e' una voce buona.

    Le opzioni di una voce di configurazione le puo' modificare anche chi
    scrive a mano in .storage: non ci si fida della forma.
    """
    if not isinstance(elenco, list):
        return []
    fuori: list[dict[str, str]] = []
    visti: set[str] = set()
    for voce in elenco:
        if not isinstance(voce, dict):
            continue
        ident = pulisci_id(voce.get("id"))
        if ident is None or ident in visti:
            continue
        visti.add(ident)
        fuori.append({"id": ident, "nome": pulisci_nome(voce.get("nome"))})
    return fuori[:MAX_DISPOSITIVI]


def con_dispositivo(elenco: Any, ident: Any, nome: Any) -> list[dict[str, str]]:
    """L'elenco NUOVO con quel dispositivo dentro, o con il nome aggiornato.

    Non si modifica sul posto: le opzioni di una voce di configurazione sono
    una mappatura che Home Assistant confronta per decidere se qualcosa e'
    cambiato, e un elenco modificato in loco non si distingue da quello di
    prima. Stesso motivo di con_rifiuto in mappa.py.

    Riaccendere l'interruttore su un dispositivo gia' presente ne aggiorna il
    nome e lo lascia dov'era: l'ordine e' quello in cui sono stati abilitati, e
    un tablet che cambia nome non deve saltare in fondo all'elenco.
    """
    pulito = pulisci_id(ident)
    if pulito is None:
        return elenco_valido(elenco)

    attuale = elenco_valido(elenco)
    nuovo = {"id": pulito, "nome": pulisci_nome(nome)}
    for posizione, voce in enumerate(attuale):
        if voce["id"] == pulito:
            return [*attuale[:posizione], nuovo, *attuale[posizione + 1 :]]

    if len(attuale) >= MAX_DISPOSITIVI:
        return attuale
    return [*attuale, nuovo]


def senza_dispositivo(elenco: Any, ident: Any) -> list[dict[str, str]]:
    """L'elenco NUOVO senza quel dispositivo."""
    pulito = pulisci_id(ident)
    attuale = elenco_valido(elenco)
    if pulito is None:
        return attuale
    return [voce for voce in attuale if voce["id"] != pulito]


def identificativi(elenco: Any) -> list[str]:
    """I soli identificativi, che e' cio' che la scheda deve confrontare.

    Alla scheda i nomi non servono: le servono per decidere se questo
    dispositivo e' fra gli abilitati. Mandarle anche i nomi vorrebbe dire
    pubblicare in un attributo di stato come il cliente ha chiamato le stanze
    di casa sua, senza che nessuno li usi.
    """
    return [voce["id"] for voce in elenco_valido(elenco)]
