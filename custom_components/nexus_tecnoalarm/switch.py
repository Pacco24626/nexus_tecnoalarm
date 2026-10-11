"""Interruttore della tastiera remota.

Con la scheda allarme che fa quasi tutto, la tastiera remota serve per la
manutenzione o per il giorno in cui la scheda non basta. Tenerla agganciata
sempre e' lavoro che nessuno guarda, ed e' anche una card in piu' su una
plancia dove non serve.

Spenta, il collegamento verso il gateway si chiude **davvero**: non e' un filtro
sopra qualcosa che continua a girare. L'entita' del display diventa non
disponibile, e un tasto inviato a quel punto viene rifiutato dicendo il motivo.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_OFF, EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN, KEY_TASTIERA
from .entity import KeypadEntity
from .gateway import KeypadGateway


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    gateway: KeypadGateway = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([TastieraRemotaSwitch(gateway)])


class TastieraRemotaSwitch(KeypadEntity, SwitchEntity, RestoreEntity):
    """Accende e spegne il collegamento alla tastiera remota."""

    _attr_name = "Tastiera remota"
    _attr_icon = "mdi:dialpad"
    # Governa un comportamento, non e' un dispositivo da accendere: con la
    # categoria «config» Home Assistant non lo espone agli assistenti vocali,
    # dove un comando generico se lo porterebbe via insieme alle lampade.
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, gateway: KeypadGateway) -> None:
        super().__init__(gateway, f"{gateway.entry.entry_id}_{KEY_TASTIERA}")

    @property
    def is_on(self) -> bool:
        return self.gateway.accesa

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # Chi aggiorna da una versione precedente non deve trovarsi la tastiera
        # spenta senza averlo chiesto: senza uno stato salvato vale acceso,
        # cioe' il comportamento di sempre.
        #
        # Il collegamento e' gia' partito con la voce di configurazione, quindi
        # qui lo si chiude. Un secondo di WebSocket all'avvio non prende la
        # tastiera alla centrale: con `on_demand` acceso il battito parte solo
        # quando una card e' in vista.
        ultimo = await self.async_get_last_state()
        if ultimo is not None and ultimo.state == STATE_OFF:
            await self._spegni()

    async def async_turn_on(self, **kwargs: Any) -> None:
        if self.gateway.accesa:
            return
        self.gateway.accesa = True
        await self.gateway.async_start()
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._spegni()

    async def _spegni(self) -> None:
        if not self.gateway.accesa:
            return
        self.gateway.accesa = False
        # `async_stop` manda prima lo stop al gateway, che toglie subito la
        # sessione dal suo registro invece di aspettare la scadenza.
        await self.gateway.async_stop()
        self.async_write_ha_state()
