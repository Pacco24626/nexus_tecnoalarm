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

class NexusKeypadSensor(SensorEntity):
    """Rappresentazione del display e stato della tastiera."""

    def __init__(self, hass, host, port):
        self.hass = hass
        self._host = host
        self._port = port
        self._token = hass.data[DOMAIN].get("token", "")
        self._state = "Disconnesso"
        self._attrs = {}
        self._attr_name = "Nexus Tecnoalarm Keypad"
        self._attr_unique_id = "nexus_tecnoalarm_kpad_01"
        self._ws_task = None

    @property
    def state(self):
        return self._state

    @property
    def extra_state_attributes(self):
        return self._attrs

    async def async_added_to_hass(self):
        """Avvia la connessione quando l'entità viene aggiunta a Home Assistant."""
        _LOGGER.info("Entità aggiunta a HA. Avvio task di ascolto WebSocket.")
        # Utilizziamo il tracker dei task in background nativo di HA per una gestione pulita del ciclo di vita
        self._ws_task = self.hass.async_create_background_task(
            self.ws_loop(), "nexus_tecnoalarm_ws_loop"
        )

    async def async_will_remove_from_hass(self):
        """Pulisce le risorse quando l'entità viene rimossa da Home Assistant."""
        if self._ws_task:
            _LOGGER.info("Rimozione entità. Cancellazione task WebSocket.")
            self._ws_task.cancel()
            self._ws_task = None
        
        # Pulisce il client websocket globale
        if self.hass.data[DOMAIN].get("ws_client"):
            self.hass.data[DOMAIN]["ws_client"] = None

    async def ws_loop(self):
        """Loop di connessione e ascolto WebSocket con riconnessione robusta."""
        session = async_get_clientsession(self.hass)
        
        # Rileva automaticamente se usare ws o wss (porta 443 o porta HTTPS di default)
        protocol = "wss" if int(self._port) == 443 else "ws"
        url = f"{protocol}://{self._host}:{self._port}/ws/tastiera"

        while True:
            _LOGGER.info("Tentativo di connessione al gateway: %s", url)
            try:
                # Impostiamo un timeout di connessione per evitare che la chiamata rimanga bloccata all'infinito
                # se il server Node-RED è offline o si sta riavviando.
                timeout = aiohttp.ClientTimeout(connect=10.0, sock_read=60.0)
                async with session.ws_connect(url, timeout=timeout, heartbeat=20.0) as ws:
                    # Salviamo il riferimento per permettere al servizio di inviare i tasti
                    self.hass.data[DOMAIN]["ws_client"] = ws
                    
                    # Handshake iniziale e autenticazione
                    if self._token:
                        await ws.send_json({"topic": "tastiera_auth", "payload": self._token})
                    await ws.send_json({"topic": "tastiera_polling", "payload": "start"})
                    _LOGGER.info("Connessione stabilita con successo. Handshake di autenticazione inviato.")

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
                            _LOGGER.warning("WebSocket disconnesso dal server: %s", msg.type)
                            break
            except asyncio.CancelledError:
                # Il task è stato cancellato dall'esterno (es. unload della piattaforma), usciamo
                _LOGGER.info("Il loop di ascolto WebSocket è stato cancellato.")
                break
            except Exception as e:
                _LOGGER.error("Errore di connessione WebSocket: %s", e)
            
            # Gestione stato disconnesso ed eliminazione vecchi dati congelati
            self._state = "Disconnesso"
            self._attrs = {}
            self.async_write_ha_state()
            self.hass.data[DOMAIN]["ws_client"] = None
            
            # Attendi 5 secondi prima di tentare il ripristino
            _LOGGER.info("Tentativo di riconnessione tra 5 secondi...")
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                break

