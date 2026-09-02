"""Client WebSocket verso la tastiera del gateway Nexus-T.

Il protocollo sul filo e' identico a quello della versione YAML: cambia solo
come il client si comporta quando le cose vanno storte.

Topic in uscita: tastiera_auth, tastiera_polling, tastiera_ping, tastiera_tasto
Topic in entrata: tastiera_update, tastiera_auth_status
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    AUTH_TIMEOUT,
    CONF_HOST,
    CONF_MAX_BACKOFF,
    CONF_ON_DEMAND,
    CONF_PING_INTERVAL,
    CONF_PORT,
    CONF_PRESENCE_WINDOW,
    CONF_TOKEN,
    CONF_USE_TLS,
    CONF_VERIFY_SSL,
    CONNECT_TIMEOUT,
    DEFAULT_MAX_BACKOFF,
    DEFAULT_ON_DEMAND,
    DEFAULT_PING_INTERVAL,
    DEFAULT_PRESENCE_WINDOW,
    DEFAULT_USE_TLS,
    DEFAULT_VERIFY_SSL,
    INITIAL_BACKOFF,
    PAYLOAD_START,
    PAYLOAD_STOP,
    READ_TIMEOUT,
    TOPIC_AUTH,
    TOPIC_AUTH_STATUS,
    TOPIC_KEY,
    TOPIC_PING,
    TOPIC_POLLING,
    TOPIC_UPDATE,
    WS_HEARTBEAT,
    WS_PATH,
)
from .presence import should_ping

_LOGGER = logging.getLogger(__name__)


class CannotConnect(Exception):
    """Il gateway non risponde."""


class InvalidAuth(Exception):
    """Il gateway ha rifiutato il token."""


def build_url(host: str, port: int, use_tls: bool) -> str:
    """URL del WebSocket della tastiera.

    Il protocollo e' esplicito e non dedotto dalla porta: con il proxy su una
    porta diversa dalla 443, dedurlo porterebbe a parlare in chiaro senza che
    nessuno se ne accorga.
    """
    schema = "wss" if use_tls else "ws"
    return f"{schema}://{host}:{port}{WS_PATH}"


async def async_validate_connection(hass: HomeAssistant, data: dict[str, Any]) -> None:
    """Verifica host, porta e token prima di salvare la configurazione.

    Il gateway risponde a `tastiera_auth` con `tastiera_auth_status`, sia in
    caso di successo sia di errore: i tre esiti (irraggiungibile, token
    rifiutato, tutto a posto) sono quindi distinguibili.
    """
    url = build_url(data[CONF_HOST], int(data[CONF_PORT]), data.get(CONF_USE_TLS, DEFAULT_USE_TLS))
    session = async_get_clientsession(
        hass, verify_ssl=data.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL)
    )
    timeout = aiohttp.ClientTimeout(connect=CONNECT_TIMEOUT, sock_read=AUTH_TIMEOUT)

    try:
        async with session.ws_connect(url, timeout=timeout) as ws:
            await ws.send_json({"topic": TOPIC_AUTH, "payload": data.get(CONF_TOKEN, "")})

            async with asyncio.timeout(AUTH_TIMEOUT):
                async for msg in ws:
                    if msg.type is not aiohttp.WSMsgType.TEXT:
                        continue
                    try:
                        risposta = json.loads(msg.data)
                    except ValueError:
                        continue
                    if risposta.get("topic") != TOPIC_AUTH_STATUS:
                        continue

                    payload = risposta.get("payload") or {}
                    if payload.get("status") == "success":
                        return
                    raise InvalidAuth(payload.get("message", "token rifiutato"))
    except InvalidAuth:
        raise
    except (TimeoutError, asyncio.TimeoutError) as err:
        # Connessione aperta ma nessun ack: gateway raggiungibile e muto, o
        # versione del flow priva della risposta di autenticazione.
        raise CannotConnect("nessuna risposta all'autenticazione") from err
    except (aiohttp.ClientError, OSError) as err:
        raise CannotConnect(str(err)) from err

    raise CannotConnect("connessione chiusa senza risposta")


class KeypadGateway:
    """Mantiene la connessione alla tastiera e ne pubblica lo stato."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry

        cfg = {**entry.data, **entry.options}
        self.host: str = cfg[CONF_HOST]
        self.port: int = int(cfg[CONF_PORT])
        self.token: str = cfg.get(CONF_TOKEN, "")
        self.use_tls: bool = cfg.get(CONF_USE_TLS, DEFAULT_USE_TLS)
        self.verify_ssl: bool = cfg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL)

        self.presence_window: int = int(cfg.get(CONF_PRESENCE_WINDOW, DEFAULT_PRESENCE_WINDOW))
        self.ping_interval: int = int(cfg.get(CONF_PING_INTERVAL, DEFAULT_PING_INTERVAL))
        self.on_demand: bool = cfg.get(CONF_ON_DEMAND, DEFAULT_ON_DEMAND)
        self.max_backoff: int = int(cfg.get(CONF_MAX_BACKOFF, DEFAULT_MAX_BACKOFF))

        self.connected: bool = False
        self.display: str | None = None
        self.attributes: dict[str, Any] = {}

        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._task: asyncio.Task | None = None
        self._last_presence: float = 0.0
        self._listeners: list[CALLBACK_TYPE] = []
        # Serve a loggare l'errore di connessione una volta sola per episodio
        # invece che a ogni tentativo: un gateway spento per una notte
        # riempirebbe il log di centinaia di righe identiche.
        self._streak: int = 0

    @property
    def url(self) -> str:
        return build_url(self.host, self.port, self.use_tls)

    # -------------------------------------------------------------------------
    # Ciclo di vita
    # -------------------------------------------------------------------------
    async def async_start(self) -> None:
        self._task = self.entry.async_create_background_task(
            self.hass, self._async_run(), f"{self.entry.entry_id}_ws"
        )

    async def async_stop(self) -> None:
        """Rilascia la tastiera e chiude.

        Il gateway gestisce `stop` rimuovendo subito la sessione dal registro:
        senza, aspetterebbe la scadenza della finestra di presenza.
        """
        if self._ws is not None and not self._ws.closed:
            try:
                await self._ws.send_json({"topic": TOPIC_POLLING, "payload": PAYLOAD_STOP})
            except (aiohttp.ClientError, ConnectionResetError, RuntimeError):
                pass

        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None
        self._set_disconnected()

    @callback
    def async_add_listener(self, update: CALLBACK_TYPE) -> CALLBACK_TYPE:
        self._listeners.append(update)

        @callback
        def _remove() -> None:
            self._listeners.remove(update)

        return _remove

    @callback
    def notify(self) -> None:
        for update in list(self._listeners):
            update()

    # -------------------------------------------------------------------------
    # Presenza e comandi
    # -------------------------------------------------------------------------
    @callback
    def note_presence(self) -> None:
        """Battito della card: dice che qualcuno sta guardando la tastiera."""
        self._last_presence = self.hass.loop.time()

    def _should_ping(self) -> bool:
        if not self.on_demand:
            return True
        if not self._last_presence:
            return False
        return should_ping(self.hass.loop.time(), self._last_presence, self.presence_window)

    async def async_send_key(self, code: int) -> bool:
        if self._ws is None or self._ws.closed:
            _LOGGER.warning("%s: tasto %s non inviato, WebSocket non connesso", self.host, code)
            return False
        await self._ws.send_json({"topic": TOPIC_KEY, "payload": int(code)})
        return True

    # -------------------------------------------------------------------------
    # Loop di connessione
    # -------------------------------------------------------------------------
    async def _async_run(self) -> None:
        backoff = INITIAL_BACKOFF
        while True:
            try:
                await self._async_session()
                backoff = INITIAL_BACKOFF
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001
                self._streak += 1
                if self._streak == 1:
                    _LOGGER.error("%s: connessione fallita: %s", self.url, err)
                else:
                    _LOGGER.debug(
                        "%s: tentativo %s fallito: %s", self.url, self._streak, err
                    )
            finally:
                self._set_disconnected()

            # Backoff esponenziale con tetto: un gateway spento a lungo non
            # deve essere martellato ogni cinque secondi per ore.
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, self.max_backoff)

    async def _async_session(self) -> None:
        session = async_get_clientsession(self.hass, verify_ssl=self.verify_ssl)
        timeout = aiohttp.ClientTimeout(connect=CONNECT_TIMEOUT, sock_read=READ_TIMEOUT)

        async with session.ws_connect(
            self.url, timeout=timeout, heartbeat=WS_HEARTBEAT
        ) as ws:
            self._ws = ws
            if self._streak:
                _LOGGER.info("%s: connessione ristabilita", self.url)
            self._streak = 0

            if self.token:
                await ws.send_json({"topic": TOPIC_AUTH, "payload": self.token})
            await ws.send_json({"topic": TOPIC_POLLING, "payload": PAYLOAD_START})

            self.connected = True
            self.note_presence()
            self.notify()

            ping_task = self.hass.async_create_task(self._async_keepalive(ws))
            try:
                await self._async_listen(ws)
            finally:
                ping_task.cancel()

    async def _async_keepalive(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        """Ping applicativo, inviato solo mentre una card e' in vista.

        E' distinto dall'heartbeat di protocollo del WebSocket: questo dice al
        gateway di tenere agganciata la tastiera, e non mandarlo e' il modo
        previsto per lasciarla libera.
        """
        try:
            while True:
                await asyncio.sleep(self.ping_interval)
                if self._should_ping():
                    await ws.send_json({"topic": TOPIC_PING, "payload": 1})
        except (
            asyncio.CancelledError,
            ConnectionResetError,
            RuntimeError,
            aiohttp.ClientError,
        ):
            return

    async def _async_listen(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for msg in ws:
            if msg.type is aiohttp.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    _LOGGER.debug("%s: messaggio non JSON ignorato", self.host)
                    continue

                topic = data.get("topic")
                if topic == TOPIC_UPDATE:
                    self._apply_update(data.get("payload") or {})
                elif topic == TOPIC_AUTH_STATUS:
                    payload = data.get("payload") or {}
                    if payload.get("status") == "error":
                        _LOGGER.error(
                            "%s: autenticazione rifiutata: %s",
                            self.host,
                            payload.get("message"),
                        )
                        await ws.close()
                        return

            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                _LOGGER.debug("%s: WebSocket chiuso dal server (%s)", self.host, msg.type)
                return

    @callback
    def _apply_update(self, payload: dict[str, Any]) -> None:
        display = str(payload.get("riga1", "")).strip()
        # Si notifica solo a stato realmente cambiato: con il polling attivo
        # gli aggiornamenti arrivano in continuazione e riscrivere ogni volta
        # significa svegliare il frontend per nulla.
        if display == self.display and payload == self.attributes:
            return
        self.display = display
        self.attributes = payload
        self.notify()

    @callback
    def _set_disconnected(self) -> None:
        self._ws = None
        if not self.connected and self.display is None:
            return
        self.connected = False
        self.display = None
        self.attributes = {}
        self.notify()
