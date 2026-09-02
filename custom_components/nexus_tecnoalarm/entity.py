"""Classe base delle entita' della tastiera."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, MANUFACTURER, MODEL
from .gateway import KeypadGateway


class KeypadEntity(Entity):
    """Entita' agganciata al gateway di una config entry."""

    _attr_should_poll = False

    def __init__(self, gateway: KeypadGateway, unique_id: str) -> None:
        self.gateway = gateway
        self._attr_unique_id = unique_id
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, gateway.entry.entry_id)},
            name=gateway.entry.title,
            manufacturer=MANUFACTURER,
            model=MODEL,
            configuration_url=f"https://{gateway.host}",
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.gateway.async_add_listener(self.async_write_ha_state))
