"""Config flow: connessione al gateway e comportamento della tastiera."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_DISPOSITIVI_PREALLARME,
    CONF_HOST,
    CONF_MAX_BACKOFF,
    CONF_ON_DEMAND,
    CONF_PING_INTERVAL,
    CONF_PORT,
    CONF_PRESENCE_WINDOW,
    CONF_TASTIERINO_PREALLARME,
    CONF_TOKEN,
    CONF_USE_TLS,
    CONF_VERIFY_SSL,
    DEFAULT_MAX_BACKOFF,
    DEFAULT_NAME,
    DEFAULT_ON_DEMAND,
    DEFAULT_PING_INTERVAL,
    DEFAULT_PORT,
    DEFAULT_PRESENCE_WINDOW,
    DEFAULT_TASTIERINO_PREALLARME,
    DEFAULT_USE_TLS,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    GATEWAY_PRESENCE_WINDOW,
    MAX_PING_INTERVAL,
)
from .dispositivi import elenco_valido
from .gateway import CannotConnect, InvalidAuth, async_validate_connection


def _schema_gateway(defaults: dict[str, Any], con_nome: bool = True) -> vol.Schema:
    """Schema della connessione.

    Il nome compare solo alla creazione: dopo si cambia rinominando la voce
    dell'integrazione, che e' il posto dove un utente lo cerca.
    """
    campi: dict[Any, Any] = {}
    if con_nome:
        campi[vol.Required("name", default=defaults.get("name", DEFAULT_NAME))] = str

    campi.update(
        {
            vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, "")): str,
            vol.Required(CONF_PORT, default=defaults.get(CONF_PORT, DEFAULT_PORT)): (
                selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=1, max=65535, step=1, mode=selector.NumberSelectorMode.BOX
                    )
                )
            ),
            vol.Required(CONF_TOKEN, default=defaults.get(CONF_TOKEN, "")): (
                selector.TextSelector(
                    selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                )
            ),
            vol.Required(
                CONF_USE_TLS, default=defaults.get(CONF_USE_TLS, DEFAULT_USE_TLS)
            ): bool,
            vol.Required(
                CONF_VERIFY_SSL, default=defaults.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL)
            ): bool,
        }
    )
    return vol.Schema(campi)


def _schema_opzioni(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_ON_DEMAND, default=defaults.get(CONF_ON_DEMAND, DEFAULT_ON_DEMAND)
            ): bool,
            vol.Required(
                CONF_PRESENCE_WINDOW,
                default=defaults.get(CONF_PRESENCE_WINDOW, DEFAULT_PRESENCE_WINDOW),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=5, max=120, step=1, unit_of_measurement="s",
                    mode=selector.NumberSelectorMode.BOX,
                )
            ),
            # Il tetto non e' arbitrario: il gateway rilascia la tastiera se non
            # riceve un ping entro 15 s, quindi oltre i 10 il display morirebbe
            # a intermittenza.
            vol.Required(
                CONF_PING_INTERVAL,
                default=defaults.get(CONF_PING_INTERVAL, DEFAULT_PING_INTERVAL),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=1, max=MAX_PING_INTERVAL, step=1, unit_of_measurement="s",
                    mode=selector.NumberSelectorMode.BOX,
                )
            ),
            vol.Required(
                CONF_MAX_BACKOFF,
                default=defaults.get(CONF_MAX_BACKOFF, DEFAULT_MAX_BACKOFF),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=10, max=600, step=5, unit_of_measurement="s",
                    mode=selector.NumberSelectorMode.BOX,
                )
            ),
        }
    )


def _schema_tastierino(defaults: dict[str, Any]) -> vol.Schema:
    """L'interruttore dell'impianto e l'elenco dei dispositivi abilitati.

    I dispositivi non si aggiungono da qui: l'identificativo lo genera il
    browser, e un tablet lo si abilita camminandoci davanti. Da qui si vede chi
    e' abilitato e si revoca, che e' la cosa che da qui si puo' fare davvero.
    """
    campi: dict[Any, Any] = {
        vol.Required(
            CONF_TASTIERINO_PREALLARME,
            default=defaults.get(CONF_TASTIERINO_PREALLARME, DEFAULT_TASTIERINO_PREALLARME),
        ): selector.BooleanSelector(),
    }

    elenco = elenco_valido(defaults.get(CONF_DISPOSITIVI_PREALLARME))
    if elenco:
        campi[
            vol.Optional("dispositivi_attivi", default=[voce["id"] for voce in elenco])
        ] = selector.SelectSelector(
            selector.SelectSelectorConfig(
                multiple=True,
                mode=selector.SelectSelectorMode.LIST,
                options=[
                    selector.SelectOptionDict(value=voce["id"], label=voce["nome"])
                    for voce in elenco
                ],
            )
        )
    return vol.Schema(campi)


def _normalizza(user_input: dict[str, Any]) -> dict[str, Any]:
    """Porta i numeri a int: i selector li restituiscono come float."""
    dati = dict(user_input)
    if CONF_PORT in dati:
        dati[CONF_PORT] = int(dati[CONF_PORT])
    for chiave in (CONF_PRESENCE_WINDOW, CONF_PING_INTERVAL, CONF_MAX_BACKOFF):
        if chiave in dati:
            dati[chiave] = int(dati[chiave])
    return dati


async def _verifica(hass, dati: dict[str, Any]) -> dict[str, str]:
    """Prova la connessione e traduce l'esito in errori del form."""
    try:
        await async_validate_connection(hass, dati)
    except InvalidAuth:
        return {CONF_TOKEN: "invalid_auth"}
    except CannotConnect:
        return {"base": "cannot_connect"}
    return {}


class NexusTecnoalarmConfigFlow(ConfigFlow, domain=DOMAIN):
    """Configurazione di un gateway."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            dati = _normalizza(user_input)
            # Un gateway per host: evita due entry che si contendono la stessa
            # tastiera mandandosi ping a vicenda.
            await self.async_set_unique_id(dati[CONF_HOST])
            self._abort_if_unique_id_configured()

            errors = await _verifica(self.hass, dati)
            if not errors:
                return self.async_create_entry(title=dati.pop("name"), data=dati)

        return self.async_show_form(
            step_id="user",
            data_schema=_schema_gateway(user_input or {}),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return NexusTecnoalarmOptionsFlow()


class NexusTecnoalarmOptionsFlow(OptionsFlow):
    """Connessione e comportamento, modificabili senza reinstallare."""

    @property
    def _current(self) -> dict[str, Any]:
        return {**self.config_entry.data, **self.config_entry.options}

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_show_menu(
            step_id="init", menu_options=["gateway", "comportamento", "tastierino"]
        )

    async def async_step_gateway(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            dati = _normalizza(user_input)
            dati.pop("name", None)
            errors = await _verifica(self.hass, {**self._current, **dati})
            if not errors:
                return self._salva(dati)

        return self.async_show_form(
            step_id="gateway",
            data_schema=_schema_gateway(self._current, con_nome=False),
            errors=errors,
        )

    async def async_step_comportamento(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self._salva(_normalizza(user_input))

        return self.async_show_form(
            step_id="comportamento",
            data_schema=_schema_opzioni(self._current),
            description_placeholders={"finestra_gateway": str(GATEWAY_PRESENCE_WINDOW)},
        )

    async def async_step_tastierino(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            dati = dict(user_input)
            # Chi resta spuntato resta abilitato: togliendo la spunta si revoca.
            # L'elenco si puo' solo accorciare da qui, mai allungare.
            rimasti = dati.pop("dispositivi_attivi", None)
            if rimasti is not None:
                attuali = elenco_valido(self._current.get(CONF_DISPOSITIVI_PREALLARME))
                dati[CONF_DISPOSITIVI_PREALLARME] = [
                    voce for voce in attuali if voce["id"] in rimasti
                ]
            return self._salva(dati)

        return self.async_show_form(
            step_id="tastierino",
            data_schema=_schema_tastierino(self._current),
        )

    def _salva(self, changes: dict[str, Any]) -> ConfigFlowResult:
        """Le opzioni contengono sempre la configurazione completa."""
        merged = {**self._current, **changes}
        merged.pop("name", None)
        return self.async_create_entry(title="", data=merged)
