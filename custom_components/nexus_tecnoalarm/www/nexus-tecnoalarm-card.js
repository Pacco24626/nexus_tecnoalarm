class NexusTecnoalarmCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    const entityId = this.config.entity || 'sensor.nexus_tecnoalarm_keypad';
    const stateObj = hass.states[entityId];

    if (!stateObj) {
      this.innerHTML = `<ha-card style="padding:16px; color:red;">Entità ${entityId} non trovata.</ha-card>`;
      this.content = false;
      return;
    }

    // Costruisci il template se non è ancora stato fatto
    if (!this.content) {
      this.buildCard();
    }

    const payload = stateObj.attributes;
    const riga1 = stateObj.state || "";
    const riga2 = payload.riga2 || "";

    // Aggiorna Display LCD
    if (this.querySelector('#lcd-row1')) {
      this.querySelector('#lcd-row1').textContent = riga1.padEnd(16, ' ');
    }
    if (this.querySelector('#lcd-row2')) {
      this.querySelector('#lcd-row2').textContent = riga2.padEnd(16, ' ');
    }

    // Aggiorna LED Diagnostici (Stato e Classi Lampeggio)
    // RETE: verde se attiva, rosso lampeggiante se assente
    if (payload.rete) {
      this._updateLed('led-rete', true, (payload.attr_rete || payload.rete_attr), 'green-on');
    } else {
      this._updateLed('led-rete', true, true, 'red-on', 'blink');
    }
    
    // GUASTO: giallo se presente
    this._updateLed('led-guasto', !!payload.guasto, !!(payload.attr_guasto || payload.guasto_attr), 'yellow-on');

    // TAMPER: rosso se presente
    this._updateLed('led-tamper', !!payload.tamper, !!(payload.attr_tamper || payload.tamper_attr), 'red-on');

    // BATTERIA: arancione se presente
    this._updateLed('led-batt', !!payload.batteria, !!(payload.attr_batt || payload.batteria_attr), 'orange-on');

    // Aggiorna LED Programmi (P1 a P8)
    const progs = payload.programmi || [];
    for (let i = 0; i < 8; i++) {
      const p = progs[i] || {};
      const statusLedId = `prog-s${i+1}`;
      const alarmLedId = `prog-a${i+1}`;
      
      const armed = !!p.stato;
      const alarm = !!p.allarme;
      const armedBlink = !!(p.attr_stato || p.stato_attr);
      const alarmBlink = !!(p.attr_allarme || p.allarme_attr);
      
      // LED Stato Programma: giallo se inserito
      this._updateLed(statusLedId, armed, armedBlink, 'yellow-on');
      
      // LED Allarme Programma: rosso se allarme
      this._updateLed(alarmLedId, alarm, alarmBlink, 'red-on');
    }
  }

  _updateLed(id, active, blink, colorClass, blinkClass = 'blink') {
    const el = this.querySelector(`#${id}`);
    if (!el) return;
    el.className = 'dot'; // Reset
    if (active) {
      el.classList.add(colorClass);
      if (blink) el.classList.add(blinkClass);
    }
  }

  buildCard() {
    let progGridHtml = '';
    for (let i = 1; i <= 8; i++) {
      progGridHtml += `
        <div class="prog-cell">
          <span class="p-label">P${i}</span>
          <div class="prog-leds">
            <div class="dot" id="prog-s${i}" title="Stato"></div>
            <div class="dot" id="prog-a${i}" title="Allarme"></div>
          </div>
        </div>
      `;
    }

    this.innerHTML = `
      <ha-card>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&family=Inter:wght@400;600;700&display=swap');
          
          .keypad-container {
            background: #0d0d0d;
            font-family: 'Inter', 'Segoe UI', sans-serif;
            color: #fff;
            padding: 16px;
            border-radius: 12px;
            max-width: 400px;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            border: 1px solid #1a1a1a;
            box-sizing: border-box;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
          }

          /* --- Header --- */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 8px;
            border-bottom: 1px solid #222;
          }
          .header .brand {
            width: 100%;
            text-align: center;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 2px;
            color: #00e0ff;
            text-transform: uppercase;
          }

          /* --- Pannello Display --- */
          .display-panel {
            background: #080808;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid #1a1a1a;
            display: flex;
            gap: 12px;
            align-items: center;
          }

          /* LED Diagnostica */
          .diag-leds {
            display: flex;
            flex-direction: column;
            gap: 5px;
            background: #0a0a0a;
            padding: 6px;
            border-radius: 6px;
            border: 1px solid #1a1a1a;
          }
          .diag-led-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .diag-led-row .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #2a2a2a;
            transition: all 0.15s;
            flex-shrink: 0;
          }
          .diag-led-row .lbl {
            font-size: 8px;
            font-weight: 700;
            color: #555;
            letter-spacing: 0.5px;
            white-space: nowrap;
          }

          /* LED States */
          .dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #1a1a1a;
            transition: all 0.15s;
          }
          .dot.green-on  { background: #00e676 !important; box-shadow: 0 0 6px #00e676, inset 0 0 2px #fff; }
          .dot.cyan-on   { background: #00e0ff !important; box-shadow: 0 0 6px #00e0ff, inset 0 0 2px #fff; }
          .dot.red-on    { background: #ff3333 !important; box-shadow: 0 0 6px #ff3333, inset 0 0 2px #fff; }
          .dot.yellow-on { background: #ffcc00 !important; box-shadow: 0 0 6px #ffcc00, inset 0 0 2px #fff; }
          .dot.orange-on { background: #ff9800 !important; box-shadow: 0 0 6px #ff9800, inset 0 0 2px #fff; }

          /* Blink animation */
          @keyframes blink-led { 0%,49% { opacity: 1; } 50%,100% { opacity: 0.1; } }
          .dot.blink { animation: blink-led 1s step-end infinite; }
          @keyframes blink-led-slow { 0%,69% { opacity: 1; } 70%,100% { opacity: 0.15; } }
          .dot.blink-slow { animation: blink-led-slow 2s step-end infinite; }

          /* LCD Screen */
          .lcd {
            flex: 1;
            font-family: 'Roboto Mono', 'Courier New', monospace;
            background: #051622;
            color: #00e0ff;
            text-shadow: 0 0 5px rgba(0,224,255,0.7);
            padding: 10px 12px;
            border-radius: 6px;
            border: 2px solid #0a2030;
            box-shadow: inset 0 0 10px rgba(0,0,0,0.9);
            font-weight: 700;
            font-size: 15px;
            letter-spacing: 1px;
            text-transform: uppercase;
            line-height: 1.4;
            min-height: 48px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .lcd .row { white-space: pre; height: 20px; overflow: hidden; }

          /* --- Stato Programmi --- */
          .programs-panel {
            background: #0a0a0a;
            padding: 8px;
            border-radius: 8px;
            border: 1px solid #1a1a1a;
          }
          .programs-panel .title {
            text-align: center;
            font-size: 8px;
            font-weight: 700;
            color: #444;
            margin-bottom: 6px;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
          .programs-grid {
            display: grid;
            grid-template-columns: repeat(8, 1fr);
            gap: 4px;
          }
          .prog-cell {
            text-align: center;
            background: #111;
            padding: 4px 2px;
            border-radius: 4px;
            border: 1px solid #1a1a1a;
          }
          .prog-cell .p-label {
            font-size: 9px;
            font-weight: 700;
            color: #888;
            display: block;
            margin-bottom: 3px;
          }
          .prog-leds {
            display: flex;
            justify-content: center;
            gap: 4px;
          }
          .prog-leds .dot {
            width: 6px;
            height: 6px;
          }

          /* --- Pulsantiera 4x4 --- */
          .keypad-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
          }
          .key-btn {
            background: #1e1e1e;
            color: #e0e0e0;
            border: 1px solid #333;
            border-radius: 10px;
            padding: 14px 0;
            font-size: 20px;
            font-weight: 700;
            font-family: 'Inter', sans-serif;
            cursor: pointer;
            box-shadow: 0 4px 0 #111, 0 4px 8px rgba(0,0,0,0.5);
            transition: all 0.06s ease;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
            box-sizing: border-box;
          }
          .key-btn:active {
            transform: translateY(3px);
            box-shadow: 0 1px 0 #111, 0 1px 2px rgba(0,0,0,0.4);
            background: #2a2a2a;
          }
          .key-btn.fn {
            background: #151a1e;
            border-color: #222;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 4px 0 #0a0d10, 0 4px 8px rgba(0,0,0,0.5);
          }
          .key-btn.fn:active {
            transform: translateY(3px);
            box-shadow: 0 1px 0 #0a0d10, 0 1px 2px rgba(0,0,0,0.4);
            background: #1a2028;
          }
          .c-cyan   { color: #00e0ff; }
          .c-yellow { color: #ffc107; }
          .c-orange { color: #fd7e14; }
          .c-green  { color: #28a745; }
          .c-red    { color: #dc3545; }
        </style>
        
        <div class="keypad-container">
          <!-- Header -->
          <div class="header">
            <span class="brand">TECNOALARM</span>
          </div>

          <!-- Display + LED Diagnostica -->
          <div class="display-panel">
            <div class="diag-leds">
              <div class="diag-led-row"><div class="dot" id="led-rete"></div><span class="lbl">RET</span></div>
              <div class="diag-led-row"><div class="dot" id="led-guasto"></div><span class="lbl">GUA</span></div>
              <div class="diag-led-row"><div class="dot" id="led-tamper"></div><span class="lbl">MAN</span></div>
              <div class="diag-led-row"><div class="dot" id="led-batt"></div><span class="lbl">BAT</span></div>
            </div>
            <div class="lcd">
              <div class="row" id="lcd-row1">CONNESSIONE...</div>
              <div class="row" id="lcd-row2">ATTENDERE</div>
            </div>
          </div>

          <!-- Stato Programmi -->
          <div class="programs-panel">
            <div class="title">Stato Programmi</div>
            <div class="programs-grid">
              ${progGridHtml}
            </div>
          </div>

          <!-- Pulsantiera 4x4 -->
          <div class="keypad-grid">
            <button class="key-btn" data-key="1">1</button>
            <button class="key-btn" data-key="2">2</button>
            <button class="key-btn" data-key="3">3</button>
            <button class="key-btn fn c-cyan" data-key="10">MEM</button>

            <button class="key-btn" data-key="4">4</button>
            <button class="key-btn" data-key="5">5</button>
            <button class="key-btn" data-key="6">6</button>
            <button class="key-btn fn c-yellow" data-key="13">▲</button>

            <button class="key-btn" data-key="7">7</button>
            <button class="key-btn" data-key="8">8</button>
            <button class="key-btn" data-key="9">9</button>
            <button class="key-btn fn c-yellow" data-key="12">▼</button>

            <button class="key-btn fn c-orange" data-key="14">* NO</button>
            <button class="key-btn" data-key="0">0</button>
            <button class="key-btn fn c-green" data-key="15"># YES</button>
            <button class="key-btn fn c-red" data-key="11">EXIT</button>
          </div>
        </div>
      </ha-card>
    `;

    // Attach click events
    this.querySelectorAll('.key-btn').forEach(button => {
      button.addEventListener('click', () => {
        this._sendKey(button.dataset.key);
      });
    });

    this.content = true;
  }

  setConfig(config) {
    this.config = config;
    this.content = false; // Forza il build al primo render/cambio configurazione
  }

  _sendKey(keyCode) {
    this._hass.callService('nexus_tecnoalarm', 'send_key', {
      code: parseInt(keyCode)
    });
  }

  getCardSize() {
    return 6;
  }
}

customElements.define('nexus-tecnoalarm-card', NexusTecnoalarmCard);
