"""Costanti dell'integrazione Nexus Tecnoalarm Keypad."""

from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "nexus_tecnoalarm"
MANUFACTURER = "Nexus-T"
MODEL = "Tastiera Tecnoalarm"

PLATFORMS: list[Platform] = [Platform.BINARY_SENSOR, Platform.SENSOR]

# --- Servizi ------------------------------------------------------------------
SERVICE_SEND_KEY = "send_key"
SERVICE_KEYPAD_PRESENCE = "keypad_presence"
ATTR_KEY_CODE = "code"
ATTR_ENTRY_ID = "entry_id"

# --- Configurazione -----------------------------------------------------------
CONF_HOST = "host"
CONF_PORT = "port"
CONF_TOKEN = "token"
CONF_USE_TLS = "use_tls"
CONF_VERIFY_SSL = "verify_ssl"

CONF_PRESENCE_WINDOW = "presence_window"
CONF_PING_INTERVAL = "ping_interval"
CONF_ON_DEMAND = "on_demand"
CONF_MAX_BACKOFF = "max_backoff"

DEFAULT_NAME = "Tecnoalarm"
DEFAULT_PORT = 443
DEFAULT_USE_TLS = True
# Il certificato del proxy Caddy interno e' auto-firmato: la verifica va
# lasciata spenta salvo installazioni con certificato valido.
DEFAULT_VERIFY_SSL = False

DEFAULT_PRESENCE_WINDOW = 15
DEFAULT_PING_INTERVAL = 5
DEFAULT_ON_DEMAND = True
DEFAULT_MAX_BACKOFF = 60

# Il gateway considera la tastiera attiva se ha ricevuto un ping negli ultimi
# 15 s (valore cablato nel nodo "Cervello AES" del flow Nexus-T). L'intervallo
# di ping deve restare sotto quella soglia con un margine, altrimenti la
# tastiera viene rilasciata fra un ping e l'altro.
GATEWAY_PRESENCE_WINDOW = 15
MAX_PING_INTERVAL = 10

# --- Protocollo WebSocket -----------------------------------------------------
WS_PATH = "/ws/tastiera"

TOPIC_AUTH = "tastiera_auth"
TOPIC_AUTH_STATUS = "tastiera_auth_status"
TOPIC_POLLING = "tastiera_polling"
TOPIC_PING = "tastiera_ping"
TOPIC_KEY = "tastiera_tasto"
TOPIC_UPDATE = "tastiera_update"

PAYLOAD_START = "start"
PAYLOAD_STOP = "stop"

# --- Timing -------------------------------------------------------------------
INITIAL_BACKOFF = 5
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 60.0
WS_HEARTBEAT = 20.0
# Quanto attendere l'ack di autenticazione durante il test di configurazione.
AUTH_TIMEOUT = 10.0

# --- Entita' ------------------------------------------------------------------
# NON cambiare: e' l'unique_id storico della versione YAML. Mantenerlo fa si'
# che il registro entita' riconosca la stessa entita', quindi entity_id e
# cronologia sopravvivono all'aggiornamento e le card gia' in dashboard
# continuano a funzionare.
LEGACY_SENSOR_UNIQUE_ID = "nexus_tecnoalarm_kpad_01"
LEGACY_SENSOR_NAME = "Nexus Tecnoalarm Keypad"

KEY_CONNECTION = "connection"

# --- Frontend -----------------------------------------------------------------
CARD_URL_BASE = "/nexus_tecnoalarm_local"
CARD_FILENAME = "nexus-tecnoalarm-card.js"
CARD_ALLARME_FILENAME = "nexus-tecnoalarm-allarme.js"
# Le card servite dall'integrazione, ognuna registrata come risorsa a se'.
CARD_FILES = (CARD_FILENAME, CARD_ALLARME_FILENAME)

# --- Scheda allarme -----------------------------------------------------------
# Il dispositivo su cui il gateway Nexus-T pubblica via MQTT discovery tutte le
# entita' dell'antifurto. L'identificativo e' cablato nel flow ed e' lo stesso
# su ogni gateway: vale finche' c'e' un gateway solo per Home Assistant.
IDENTIFICATIVO_CENTRALE = ("mqtt", "tecnoalarm_gateway")
NOME_DISPOSITIVO_CENTRALE = "Centrale Tecnoalarm"
TOPIC_RIFIUTO = "tecnoalarm/programma/+/rifiuto"

KEY_MAPPA = "mappa_allarme"
# Attributo con cui la scheda allarme riconosce il sensore giusto, e con cui
# la tastiera lo scarta: entrambi hanno un attributo 'programmi'.
RUOLO_MAPPA = "mappa_allarme"

STATE_DISCONNECTED = "Disconnesso"
