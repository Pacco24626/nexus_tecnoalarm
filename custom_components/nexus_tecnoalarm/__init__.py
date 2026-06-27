import logging
import os
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType
from .const import DOMAIN, SERVICE_SEND_KEY, ATTR_KEY_CODE

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Configurazione del componente."""
    hass.data.setdefault(DOMAIN, {})
    
    conf = config.get(DOMAIN)
    if conf is None:
        return True

    host = conf.get("host")
    port = conf.get("port", 80)

    hass.data[DOMAIN] = {
        "host": host,
        "port": port,
        "ws_client": None
    }

    # === Registra la cartella www interna per servire la card Lovelace ===
    www_dir = hass.config.path("custom_components/nexus_tecnoalarm/www")
    if os.path.isdir(www_dir):
        hass.http.register_static_path(
            "/nexus_tecnoalarm_local",
            www_dir,
            cache_headers=False
        )
        _LOGGER.info("Percorso web della tastiera registrato su /nexus_tecnoalarm_local")

    # Registrazione servizio tasti
    async def handle_send_key(call):
        key_code = call.data.get(ATTR_KEY_CODE)
        ws_client = hass.data[DOMAIN].get("ws_client")
        if ws_client and not ws_client.closed:
            payload = {"topic": "tastiera_tasto", "payload": int(key_code)}
            await ws_client.send_json(payload)
        else:
            _LOGGER.warning("WebSocket non connesso")

    hass.services.async_register(DOMAIN, SERVICE_SEND_KEY, handle_send_key)

    hass.async_create_task(
        hass.helpers.discovery.async_load_platform("sensor", DOMAIN, {}, config)
    )

    return True
