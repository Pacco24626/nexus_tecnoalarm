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
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, LEGACY_SENSOR_NAME, LEGACY_SENSOR_UNIQUE_ID
from .entity import KeypadEntity
from .gateway import KeypadGateway


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    gateway: KeypadGateway = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([KeypadDisplaySensor(gateway)])


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
