"""Stato della connessione al gateway.

Serve a distinguere "gateway irraggiungibile" da "la centrale scrive qualcosa
sul display": col solo sensore del display le due cose erano indistinguibili
per un'automazione.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, KEY_CONNECTION
from .entity import KeypadEntity
from .gateway import KeypadGateway


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    gateway: KeypadGateway = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([KeypadConnectionSensor(gateway)])


class KeypadConnectionSensor(KeypadEntity, BinarySensorEntity):
    """Acceso quando il WebSocket verso la tastiera e' attivo."""

    _attr_name = "Connessione tastiera"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, gateway: KeypadGateway) -> None:
        super().__init__(gateway, f"{gateway.entry.entry_id}_{KEY_CONNECTION}")

    @property
    def is_on(self) -> bool:
        return self.gateway.connected

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "url": self.gateway.url,
            "on_demand": self.gateway.on_demand,
            "ping_interval": self.gateway.ping_interval,
        }
