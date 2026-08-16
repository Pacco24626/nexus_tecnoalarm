"""Logica pura di presenza tastiera (nessuna dipendenza da Home Assistant)."""

PRESENCE_WINDOW_S = 15.0   # finestra: se non arriva un battito di presenza entro
                           # questo tempo, la card è considerata "non in vista"

def should_ping(now, last_presence, window=PRESENCE_WINDOW_S):
    """True se una card è stata vista di recente => va tenuto vivo il polling."""
    if last_presence is None:
        return False
    return (now - last_presence) < window
