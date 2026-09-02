"""Integrazione Nexus Tecnoalarm Keypad.

Dalla 2.0.0 la configurazione avviene solo dall'interfaccia: il blocco
`nexus_tecnoalarm:` in configuration.yaml non serve piu' e va rimosso.

L'integrazione serve e registra da sola la card Lovelace: niente risorsa da
aggiungere a mano, e l'URL porta la versione del pacchetto, cosi' a ogni
aggiornamento il browser ricarica il file invece di servire quello in cache.
"""

from __future__ import annotations

import logging
import os

import voluptuous as vol
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.loader import async_get_integration

from .const import (
    ATTR_ENTRY_ID,
    ATTR_KEY_CODE,
    CARD_FILENAME,
    CARD_URL_BASE,
    DOMAIN,
    PLATFORMS,
    SERVICE_KEYPAD_PRESENCE,
    SERVICE_SEND_KEY,
)
from .gateway import KeypadGateway

_LOGGER = logging.getLogger(__name__)

# L'integrazione non accetta configurazione YAML: dichiararlo esplicitamente
# fa emettere a Home Assistant un avviso chiaro a chi ha ancora il vecchio
# blocco in configuration.yaml, invece di un errore oscuro.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

SEND_KEY_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_KEY_CODE): vol.All(vol.Coerce(int), vol.Range(min=0, max=15)),
        vol.Optional(ATTR_ENTRY_ID): cv.string,
    }
)

PRESENCE_SCHEMA = vol.Schema({vol.Optional(ATTR_ENTRY_ID): cv.string})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Configura un gateway."""
    await _async_register_card(hass)

    gateway = KeypadGateway(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = gateway
    await gateway.async_start()

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _async_register_services(hass)

    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Scarica un gateway, rilasciando la tastiera."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        gateway: KeypadGateway = hass.data[DOMAIN].pop(entry.entry_id)
        await gateway.async_stop()

        if not _gateways(hass):
            hass.services.async_remove(DOMAIN, SERVICE_SEND_KEY)
            hass.services.async_remove(DOMAIN, SERVICE_KEYPAD_PRESENCE)
    return unload_ok


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def _gateways(hass: HomeAssistant) -> dict[str, KeypadGateway]:
    return {k: v for k, v in hass.data.get(DOMAIN, {}).items() if isinstance(v, KeypadGateway)}


# -----------------------------------------------------------------------------
# Card Lovelace
# -----------------------------------------------------------------------------
async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve la card e la registra come modulo del frontend, una volta sola."""
    dominio = hass.data.setdefault(DOMAIN, {})
    if dominio.get("card_registrata"):
        return

    www_dir = os.path.join(os.path.dirname(__file__), "www")
    if not os.path.isdir(www_dir):
        _LOGGER.warning("Cartella www assente: la card non verra' servita")
        return

    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_BASE, www_dir, False)]
    )

    integration = await async_get_integration(hass, DOMAIN)
    add_extra_js_url(hass, f"{CARD_URL_BASE}/{CARD_FILENAME}?v={integration.version}")

    dominio["card_registrata"] = True
    _LOGGER.debug("Card registrata su %s/%s", CARD_URL_BASE, CARD_FILENAME)


# -----------------------------------------------------------------------------
# Servizi
# -----------------------------------------------------------------------------
def _async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_SEND_KEY):
        return

    def _seleziona(call: ServiceCall) -> KeypadGateway:
        """Il gateway a cui parlare.

        Con un solo gateway non serve dire quale; con piu' d'uno va indicato,
        perche' mandare un tasto alla tastiera sbagliata non e' un errore
        recuperabile.
        """
        gateways = _gateways(hass)
        if not gateways:
            raise HomeAssistantError("Nessun gateway Tecnoalarm configurato")

        entry_id = call.data.get(ATTR_ENTRY_ID)
        if entry_id:
            if entry_id not in gateways:
                raise ServiceValidationError(f"Gateway {entry_id} non trovato")
            return gateways[entry_id]

        if len(gateways) > 1:
            raise ServiceValidationError(
                "Piu' gateway configurati: indica entry_id nella chiamata"
            )
        return next(iter(gateways.values()))

    async def handle_send_key(call: ServiceCall) -> None:
        gateway = _seleziona(call)
        if not await gateway.async_send_key(call.data[ATTR_KEY_CODE]):
            raise HomeAssistantError("Tastiera non connessa: tasto non inviato")

    async def handle_presence(call: ServiceCall) -> None:
        entry_id = call.data.get(ATTR_ENTRY_ID)
        for identificativo, gateway in _gateways(hass).items():
            if entry_id in (None, identificativo):
                gateway.note_presence()

    hass.services.async_register(DOMAIN, SERVICE_SEND_KEY, handle_send_key, SEND_KEY_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_KEYPAD_PRESENCE, handle_presence, PRESENCE_SCHEMA
    )
