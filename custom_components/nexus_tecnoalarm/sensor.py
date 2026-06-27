import asyncio
import json
import logging
import aiohttp
from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_platform(hass, config, async_add_entities, discovery_info=None):
    """Inizializza il sensore della tastiera."""
    host = hass.data[DOMAIN]["host"]
    port = hass.data[DOMAIN]["port"]
    
    sensor = NexusKeypadSensor(hass, host, port)
    async_add_entities([sensor])
    
    # Avviamo il loop del WebSocket in background
    hass.loop.create_task(sensor.ws_loop())

class NexusKeypadSensor(SensorEntity):
    """Rappresentazione del display e stato della tastiera."""

    def __init__(self, hass, host, port):
        self.hass = hass
        self._host = host
        self._port = port
        self._state = "Disconnesso"
        self._attrs = {}
        self._attr_name = "Nexus Tecnoalarm Keypad"
        self._attr_unique_id = "nexus_tecnoalarm_kpad_01"

    @property
    def state(self):
        return self._state

    @property
    def extra_state_attributes(self):
        return self._attrs

    async def ws_loop(self):
        """Loop di connessione e ascolto WebSocket."""
        session = async_get_clientsession(self.hass)
        # Sostituire con wss:// se usi HTTPS sul gateway locale
        url = f"ws://{self._host}:{self._port}/ws/tastiera"

        while True:
            _LOGGER.info("Tentativo di connessione al gateway: %s", url)
            try:
                async with session.ws_connect(url) as ws:
                    # Salviamo il riferimento per permettere al servizio di inviare i tasti
                    self.hass.data[DOMAIN]["ws_client"] = ws
                    
                    # Handshake iniziale
                    await ws.send_json({"topic": "tastiera_polling", "payload": "start"})
                    _LOGGER.info("Connessione stabilita. Handshake inviato.")

                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if data.get("topic") == "tastiera_update":
                                payload = data.get("payload", {})
                                
                                # Aggiorna lo stato principale (Riga 1) e gli attributi
                                self._state = payload.get("riga1", "").strip()
                                self._attrs = payload
                                self.async_write_ha_state()
                                
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
            except Exception as e:
                _LOGGER.error("Errore di connessione WebSocket: %s", e)
            
            # Gestione disconnessione
            self._state = "Disconnesso"
            self._attrs = {}
            self.async_write_ha_state()
            self.hass.data[DOMAIN]["ws_client"] = None
            
            # Attendi 5 secondi prima di tentare il ripristino
            await asyncio.sleep(5)
