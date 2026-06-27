class NexusTecnoalarmCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    const entityId = this.config.entity || 'sensor.nexus_tecnoalarm_keypad';
    const stateObj = hass.states[entityId];

    if (!stateObj) {
      this.innerHTML = `<ha-card style="padding:16px; color:red;">Entità ${entityId} non trovata.</ha-card>`;
      return;
    }

    const payload = stateObj.attributes;
    const riga1 = stateObj.state;
    const riga2 = payload.riga2 || "";

    // Aggiorna Display LCD
    if (this.querySelector('#lcd_riga1')) {
      this.querySelector('#lcd_riga1').textContent = riga1.padEnd(16, ' ');
      this.querySelector('#lcd_riga2').textContent = riga2.padEnd(16, ' ');
    }

    // Aggiorna LED Diagnostici (Stato e Classi Lampeggio)
    this._updateLed('led_rete', payload.rete, payload.attr_rete, 'verde');
    this._updateLed('led_guasto', payload.guasto, payload.attr_guasto, 'giallo');
    this._updateLed('led_tamper', payload.tamper, payload.attr_tamper, 'rosso');
    this._updateLed('led_batt', payload.batteria, payload.attr_batt, 'arancione');
  }

  _updateLed(id, active, blink, colorClass) {
    const el = this.querySelector(`#${id}`);
    if (!el) return;
    el.className = 'led'; // Reset
    if (active) el.classList.add(colorClass);
    if (blink) el.classList.add('blink');
  }

  setConfig(config) {
    this.config = config;
    if (!this.content) {
      this.innerHTML = `
        <ha-card>
          <style>
            .tastiera-container { padding: 16px; background: #2c2c2c; border-radius: 12px; max-width: 350px; margin: auto; }
            .screen { background: #7fa67f; color: #000; font-family: 'Courier New', monospace; font-weight: bold; padding: 10px; border-radius: 4px; box-shadow: inset 0 0 5px #000; font-size: 18px; letter-spacing: 1px; margin-bottom: 12px; text-shadow: 1px 1px 0px #9acc9a; }
            .led-bar { display: flex; justify-content: space-around; margin-bottom: 16px; background: #1a1a1a; padding: 6px; border-radius: 6px; }
            .led-container { text-align: center; font-size: 10px; color: #aaa; }
            .led { width: 14px; height: 14px; background-color: #444; border-radius: 50%; margin: 2px auto; box-shadow: 0 0 2px #000; }
            
            /* Colori LED attivi */
            .led.verde { background-color: #00ff00; box-shadow: 0 0 8px #00ff00; }
            .led.giallo { background-color: #ffff00; box-shadow: 0 0 8px #ffff00; }
            .led.rosso { background-color: #ff0000; box-shadow: 0 0 8px #ff0000; }
            .led.arancione { background-color: #ffaa00; box-shadow: 0 0 8px #ffaa00; }
            
            /* Animazione Lampeggio */
            .blink { animation: lmp 0.5s infinite alternate; }
            @keyframes lmp { from { opacity: 1; } to { opacity: 0.2; } }

            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            button.btn { background: #444; color: #fff; border: none; padding: 14px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer; box-shadow: 0 4px #222; }
            button.btn:active { box-shadow: 0 1px #222; transform: translateY(3px); }
            button.funz { background: #555; font-size: 12px; }
          </style>
          
          <div class="tastiera-container">
            <div class="screen">
              <div id="lcd_riga1"></div>
              <div id="lcd_riga2"></div>
            </div>
            
            <div class="led-bar">
              <div class="led-container"><div id="led_rete" class="led"></div>RETE</div>
              <div class="led-container"><div id="led_guasto" class="led"></div>GUASTO</div>
              <div class="led-container"><div id="led_tamper" class="led"></div>TAMPER</div>
              <div class="led-container"><div id="led_batt" class="led"></div>BATT</div>
            </div>

            <div class="grid">
              <button class="btn" data-key="1">1</button>
              <button class="btn" data-key="2">2</button>
              <button class="btn" data-key="3">3</button>
              <button class="btn" data-key="4">4</button>
              <button class="btn" data-key="5">5</button>
              <button class="btn" data-key="6">6</button>
              <button class="btn" data-key="7">7</button>
              <button class="btn" data-key="8">8</button>
              <button class="btn" data-key="9">9</button>
              <button class="btn funz" data-key="10">MEM</button>
              <button class="btn" data-key="0">0</button>
              <button class="btn funz" data-key="11">EXIT</button>
              <button class="btn funz" data-key="14">* NO</button>
              <button class="btn funz" data-key="12">▼</button>
              <button class="btn funz" data-key="15"># YES</button>
              <div></div><button class="btn funz" data-key="13">▲</button><div></div>
            </div>
          </div>
        </ha-card>
      `;

      // Aggancia l'evento click a tutti i pulsanti
      this.querySelectorAll('.btn').forEach(button => {
        button.addEventListener('click', () => {
          this._sendKey(button.dataset.key);
        });
      });
    }
  }

  _sendKey(keyCode) {
    // Chiama il servizio esposto dal backend Python
    this._hass.callService('nexus_tecnoalarm', 'send_key', {
      code: parseInt(keyCode)
    });
  }

  getCardSize() { return 4; }
}
customElements.define('nexus-tecnoalarm-card', NexusTecnoalarmCard);
