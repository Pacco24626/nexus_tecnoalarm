/**
 * Una fotografia della scheda allarme, da tests/anteprima_scheda.html.
 *
 *     node tests/foto_scheda.js
 *
 * Serve a guardare l'aspetto prima di pubblicare; il collaudo vero e'
 * tests/test_scheda_allarme.js, che non ha bisogno di un browser.
 */
const path = require("path");
const puppeteer = require(path.join(process.env.APPDATA, "npm", "node_modules", "md-to-pdf", "node_modules", "puppeteer"));

const PAGINA = "file:///" + path.join(__dirname, "anteprima_scheda.html").replace(/\\/g, "/");
const FUORI = path.join(__dirname, "anteprima-scheda.png");

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const errori = [];
  page.on("pageerror", (e) => errori.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errori.push(m.text().slice(0, 160)); });

  await page.setViewport({ width: 460, height: 1400, deviceScaleFactor: 2 });
  await page.goto(PAGINA, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 600));

  const misure = await page.evaluate(() => {
    const card = document.querySelector("nexus-tecnoalarm-allarme");
    const righe = card.shadowRoot.querySelectorAll(".evento").length;
    const conteggio = card.shadowRoot.querySelector(".registro-blocco .conteggio");
    return { righe, conteggio: conteggio ? conteggio.textContent : "(manca)" };
  });

  const colonna = await page.$(".colonna");
  await colonna.screenshot({ path: FUORI });
  await browser.close();

  console.log(`righe di registro disegnate: ${misure.righe} | conteggio: ${misure.conteggio}`);
  if (errori.length) console.log("errori nella pagina:\n  " + errori.join("\n  "));
  console.log("fotografia: " + FUORI);
  process.exit(errori.length || misure.righe === 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
