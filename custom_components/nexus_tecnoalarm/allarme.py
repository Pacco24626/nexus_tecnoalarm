"""Scheda allarme: la mappa della centrale e i rifiuti del gateway.

Una card Lovelace gira nel browser con i permessi di chi e' collegato. Sul
tablet a muro, con un utente di casa, non vede gli unique_id delle entita' — il
registro completo e' riservato agli amministratori — e non puo' sottoscrivere
un argomento MQTT, perche' anche quello e' un comando da amministratore.
Proprio le due cose di cui ha bisogno: gli unique_id per sapere cos'e' ogni
entita' e in che ordine va, e il topic dei rifiuti per dire «codice errato».

Qui, lato server, si fanno entrambe e se ne pubblica il risultato in un
sensore che qualunque utente puo' leggere.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr

from .const import (
    EVENTO_RIFIUTO,
    IDENTIFICATIVO_CENTRALE,
    NOME_DISPOSITIVO_CENTRALE,
    TOPIC_RIFIUTO,
)
from .mappa import (
    Candidato,
    Voce,
    classifica,
    con_rifiuto,
    mappa_vuota,
    numero_da_topic,
    pulisci_rifiuto,
    scegli_centrale,
)

_LOGGER = logging.getLogger(__name__)


class MappaAllarme:
    """Tiene aggiornata la mappa della centrale e l'ultimo rifiuto per programma."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.mappa: dict[str, Any] = mappa_vuota()
        # Chiave: numero del programma come stringa, come arriva alla card.
        self.rifiuti: dict[str, dict[str, Any]] = {}

        self._listeners: list[CALLBACK_TYPE] = []
        self._unsub: list[CALLBACK_TYPE] = []
        self._task: asyncio.Task | None = None
        self._fermata = False

    # -------------------------------------------------------------------------
    # Ciclo di vita
    # -------------------------------------------------------------------------
    @callback
    def async_start(self) -> None:
        self._fermata = False
        self._ricostruisci()

        # Le entita' della centrale nascono e cambiano via MQTT discovery, anche
        # dopo l'avvio: una zona aggiunta in programmazione deve comparire da
        # sola nella scheda.
        self._unsub.append(
            self.hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, self._su_registro)
        )
        self._unsub.append(
            self.hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, self._su_registro)
        )
        # Anche le aree: spostare una zona di stanza cambia l'entita' e passa
        # di sopra, ma rinominare l'area o cambiarle piano no, e la scheda
        # resterebbe con l'intestazione vecchia fino al riavvio.
        self._unsub.append(
            self.hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, self._su_registro)
        )
        self._unsub.append(
            self.hass.bus.async_listen(fr.EVENT_FLOOR_REGISTRY_UPDATED, self._su_registro)
        )

        # MQTT puo' non essere ancora pronto: l'attesa va in un task di fondo.
        # Un task normale verrebbe atteso da async_block_till_done, e un broker
        # lento tratterrebbe l'avvio di Home Assistant — lo stesso errore che
        # nella 2.0.0 bloccava il boot con il keep-alive della tastiera.
        self._task = self.hass.async_create_background_task(
            self._async_sottoscrivi_rifiuti(), "nexus_tecnoalarm_rifiuti"
        )

    @callback
    def async_stop(self) -> None:
        self._fermata = True
        for annulla in self._unsub:
            annulla()
        self._unsub.clear()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None

    @callback
    def async_add_listener(self, update: CALLBACK_TYPE) -> CALLBACK_TYPE:
        self._listeners.append(update)

        @callback
        def _rimuovi() -> None:
            if update in self._listeners:
                self._listeners.remove(update)

        return _rimuovi

    @callback
    def notify(self) -> None:
        for update in list(self._listeners):
            update()

    # -------------------------------------------------------------------------
    # Mappa
    # -------------------------------------------------------------------------
    @callback
    def _su_registro(self, _event: Event) -> None:
        # L'evento arriva per qualunque entita' di Home Assistant: si ricostruisce
        # (costa poco, e' un dispositivo solo) ma si notifica solo se la mappa e'
        # cambiata davvero, altrimenti il sensore si riscriverebbe di continuo.
        if self._ricostruisci():
            self.notify()

    def _dispositivo_centrale(self):
        """Il dispositivo della centrale, cercato senza API deprecate.

        La centrale e' un dispositivo di MQTT, non nostro: `async_get_device_by_identifier`
        vuole la voce di configurazione che lo possiede e non fa al caso nostro.
        `async_get_devices` restituisce tutte le corrispondenze, e la scelta la fa
        `scegli_centrale`. Su Home Assistant precedenti al 2026.9 quella funzione non
        esiste e si ricade sulla vecchia ricerca.
        """
        registro = dr.async_get(self.hass)
        cerca = getattr(registro, "async_get_devices", None)
        if cerca is None:
            return registro.async_get_device(identifiers={IDENTIFICATIVO_CENTRALE})

        trovati = cerca(identifiers={IDENTIFICATIVO_CENTRALE})
        candidati = [
            Candidato(
                id=dispositivo.id,
                domini=frozenset(
                    voce.domain
                    for voce_id in dispositivo.config_entries
                    if (voce := self.hass.config_entries.async_get_entry(voce_id)) is not None
                ),
            )
            for dispositivo in trovati
        ]
        scelto = scegli_centrale(candidati)
        return next((d for d in trovati if d.id == scelto), None)

    def _ricostruisci(self) -> bool:
        """Rilegge il dispositivo della centrale. True se la mappa e' cambiata."""
        dispositivo = self._dispositivo_centrale()

        if dispositivo is None:
            nuova = mappa_vuota()
        else:
            registro = er.async_get(self.hass)
            aree = ar.async_get(self.hass)
            piani = fr.async_get(self.hass)

            def dove(voce: er.RegistryEntry) -> tuple[str | None, str | None]:
                """Area e piano di un'entita', in nomi gia' pronti da mostrare.

                L'entita' puo' avere un'area sua; se non ce l'ha vale quella del
                dispositivo, che e' la regola di Home Assistant. Sulla centrale
                il dispositivo di solito non ne ha, quindi chi non assegna le
                zone resta senza area e la scheda le raccoglie in fondo.
                """
                id_area = voce.area_id or dispositivo.area_id
                if id_area is None:
                    return None, None
                area = aree.async_get_area(id_area)
                if area is None:
                    return None, None
                piano = piani.async_get_floor(area.floor_id) if area.floor_id else None
                return area.name, (piano.name if piano else None)

            voci = []
            for voce in er.async_entries_for_device(
                registro, dispositivo.id, include_disabled_entities=True
            ):
                area, piano = dove(voce)
                voci.append(
                    Voce(
                        entity_id=voce.entity_id,
                        unique_id=voce.unique_id,
                        nome=voce.name,
                        nome_originale=voce.original_name,
                        disabilitata=voce.disabled_by is not None,
                        area=area,
                        piano=piano,
                    )
                )
            nomi_dispositivo = [
                nome
                for nome in (dispositivo.name_by_user, dispositivo.name, NOME_DISPOSITIVO_CENTRALE)
                if nome
            ]
            nuova = classifica(voci, nomi_dispositivo)

        cambiata = nuova != self.mappa
        self.mappa = nuova
        return cambiata

    # -------------------------------------------------------------------------
    # Rifiuti
    # -------------------------------------------------------------------------
    async def _async_sottoscrivi_rifiuti(self) -> None:
        """Sottoscrive il topic dei rifiuti, se MQTT c'e'.

        Senza MQTT la scheda funziona lo stesso per inserire e guardare le
        zone: le manca solo la voce «codice errato», e lo si dice nel log una
        volta invece di fallire.
        """
        from homeassistant.components import mqtt  # noqa: PLC0415

        try:
            if not await mqtt.async_wait_for_mqtt_client(self.hass):
                _LOGGER.info(
                    "MQTT non disponibile: la scheda allarme non potra' segnalare "
                    "i comandi rifiutati dal gateway"
                )
                return
            annulla = await mqtt.async_subscribe(self.hass, TOPIC_RIFIUTO, self._su_rifiuto)
        except asyncio.CancelledError:
            raise
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Rifiuti del gateway non sottoscritti (%s): la scheda allarme non "
                "potra' segnalare un codice errato",
                err,
            )
            return

        if self._fermata:
            # Fermata mentre si aspettava il broker: la sottoscrizione appena
            # fatta non ha piu' un proprietario e va tolta subito.
            annulla()
            return
        self._unsub.append(annulla)
        _LOGGER.debug("Rifiuti del gateway sottoscritti su %s", TOPIC_RIFIUTO)

    @callback
    def _su_rifiuto(self, messaggio: Any) -> None:
        try:
            dati = json.loads(messaggio.payload)
        except (TypeError, ValueError):
            _LOGGER.debug("Rifiuto non leggibile su %s: %r", messaggio.topic, messaggio.payload)
            return

        pulito = pulisci_rifiuto(dati)
        if pulito is None:
            return

        # Il numero nel topic e' quello su cui la card e' in ascolto: vale lui,
        # anche se il payload dicesse altro.
        numero = numero_da_topic(messaggio.topic)
        if numero is None:
            numero = pulito.get("programma")
        if numero is None:
            return

        # Sostituito, non modificato: vedi con_rifiuto.
        self.rifiuti = con_rifiuto(self.rifiuti, numero, pulito)
        self.notify()
        self._annuncia_rifiuto(numero, pulito)

    def _annuncia_rifiuto(self, numero: int, pulito: dict[str, Any]) -> None:
        """Racconta il rifiuto a Home Assistant, per chi ci vuole appendere qualcosa.

        La scheda il rifiuto lo legge dalla mappa; un'automazione no, e mettersi
        in ascolto dell'argomento MQTT vorrebbe dire conoscere i topic del
        gateway. L'evento porta anche l'entita' del programma, cosi' chi
        annuncia sa di quale pannello sta parlando senza riappaiarlo per numero.

        Un evento in piu' non costa niente a chi non lo ascolta, e un rifiuto
        capita quanto un comando sbagliato: non e' un flusso continuo.
        """
        # Dalla V0.8.56 sull'argomento passano anche i comandi riusciti. L'evento
        # si chiama «rifiutato» e chi lo ascolta si aspetta un guaio: lanciarlo
        # anche sui successi farebbe annunciare «non inserito» a inserimento
        # avvenuto. I successi restano nella mappa, dove la scheda li legge.
        if pulito.get("ok") is True:
            return

        entita = None
        for programma in self.mappa.get("programmi", []):
            if programma.get("numero") == numero:
                entita = programma.get("entity_id")
                break

        self.hass.bus.async_fire(
            EVENTO_RIFIUTO,
            {
                "programma": numero,
                "nome": pulito.get("nome"),
                "azione": pulito.get("azione"),
                "esito": pulito["esito"],
                "ok": pulito.get("ok"),
                "messaggio": pulito.get("messaggio"),
                "zone_aperte": pulito.get("zone_aperte", []),
                "numeri": pulito.get("numeri", []),
                "entity_id": entita,
                "ts": pulito.get("ts"),
            },
        )
