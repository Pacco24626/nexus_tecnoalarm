"""Sensore del display della tastiera.

Lo stato e' la riga 1 del display; il resto del payload del gateway finisce
negli attributi, che sono cio' che la card legge per disegnare LED e programmi.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import MATCH_ALL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .allarme import MappaAllarme
from .const import (
    CONF_DISPOSITIVI_PREALLARME,
    CONF_TASTIERINO_PREALLARME,
    DEFAULT_TASTIERINO_PREALLARME,
    DOMAIN,
    KEY_MAPPA,
    LEGACY_SENSOR_NAME,
    LEGACY_SENSOR_UNIQUE_ID,
    MANUFACTURER,
    MODEL,
    RUOLO_MAPPA,
)
from .dispositivi import identificativi
from .entity import KeypadEntity
from .gateway import KeypadGateway


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    gateway: KeypadGateway = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([KeypadDisplaySensor(gateway), MappaAllarmeSensor(gateway)])


class KeypadDisplaySensor(KeypadEntity, SensorEntity):
    """Display LCD e diagnostica della tastiera."""

    # Il payload cambia a ogni polling e non ha alcun valore storico: senza
    # questo, con la tastiera in vista si scriverebbe nel database in
    # continuazione. Lo stato resta registrato, gli attributi no.
    _unrecorded_attributes = frozenset({MATCH_ALL})

    _attr_icon = "mdi:security"
    # Nome e unique_id sono quelli della versione YAML: cosi' il registro
    # riconosce la stessa entita' e sia entity_id sia cronologia sopravvivono
    # all'aggiornamento, lasciando intatte le card gia' in dashboard.
    _attr_name = LEGACY_SENSOR_NAME
    _attr_has_entity_name = False

    def __init__(self, gateway: KeypadGateway) -> None:
        super().__init__(gateway, LEGACY_SENSOR_UNIQUE_ID)

    @property
    def available(self) -> bool:
        return self.gateway.connected

    @property
    def native_value(self) -> str | None:
        return self.gateway.display

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self.gateway.attributes


class MappaAllarmeSensor(SensorEntity):
    """La struttura dell'antifurto, per la scheda allarme che la disegna da sola.

    Lo stato e' il numero di elementi mappati; negli attributi ci sono
    programmi, zone e telecomandi in ordine di programmazione, e l'ultimo
    rifiuto del gateway per ciascun programma. Perche' serva un sensore invece
    di lasciar fare tutto alla card, lo spiega allarme.py.
    """

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_name = "Mappa allarme"
    _attr_icon = "mdi:shield-home-outline"
    # Struttura e rifiuti non hanno valore storico.
    _unrecorded_attributes = frozenset({MATCH_ALL})

    def __init__(self, gateway: KeypadGateway) -> None:
        self._mappa: MappaAllarme | None = None
        # La voce di configurazione serve per le opzioni del tastierino
        # automatico: cambiarle ricarica l'integrazione, quindi il sensore
        # rinasce e le rilegge da se'.
        self._entry = gateway.entry
        self._attr_unique_id = f"{gateway.entry.entry_id}_{KEY_MAPPA}"
        # Stesso dispositivo delle entita' della tastiera. Non si eredita da
        # KeypadEntity perche' quella si ridisegna a ogni polling della
        # tastiera, che con la mappa non c'entra.
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, gateway.entry.entry_id)},
            name=gateway.entry.title,
            manufacturer=MANUFACTURER,
            model=MODEL,
            configuration_url=f"https://{gateway.host}",
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._mappa = MappaAllarme(self.hass)
        self.async_on_remove(self._mappa.async_add_listener(self.async_write_ha_state))
        self._mappa.async_start()
        self.async_on_remove(self._mappa.async_stop)

    @property
    def native_value(self) -> int | None:
        if self._mappa is None:
            return None
        mappa = self._mappa.mappa
        return len(mappa["programmi"]) + len(mappa["zone"]) + len(mappa["telecomandi"])

    @property
    def _tastierino(self) -> dict[str, Any]:
        """Le due chiavi del tastierino automatico, per il guardiano della card.

        Gli identificativi e non i nomi: alla scheda servono per sapere se
        questo dispositivo e' fra gli abilitati, e pubblicare in un attributo
        di stato come il cliente ha chiamato le stanze di casa sua non serve a
        nessuno.
        """
        opzioni = {**self._entry.data, **self._entry.options}
        return {
            CONF_TASTIERINO_PREALLARME: bool(
                opzioni.get(CONF_TASTIERINO_PREALLARME, DEFAULT_TASTIERINO_PREALLARME)
            ),
            CONF_DISPOSITIVI_PREALLARME: identificativi(
                opzioni.get(CONF_DISPOSITIVI_PREALLARME)
            ),
        }

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        if self._mappa is None:
            return {"ruolo": RUOLO_MAPPA, **self._tastierino}
        return {
            "ruolo": RUOLO_MAPPA,
            **self._mappa.mappa,
            "rifiuti": self._mappa.rifiuti,
            **self._tastierino,
        }
