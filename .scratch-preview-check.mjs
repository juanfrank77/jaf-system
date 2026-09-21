import { chromium } from "playwright"
import path from "node:path"

const BASE = "http://localhost:5177"
const OUT_DIR =
	"C:/Users/user/AppData/Local/Temp/claude/e--jaf-system/3accc8fa-2334-4749-8d30-138f4ac6c44f/scratchpad/screens"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => {
	if (m.type() === "error") errors.push(m.text())
})

await page.goto(`${BASE}/login`, { waitUntil: "load" })
await page.fill("#email", "admin@jafcomm.local")
await page.fill("#password", "jaf2026!")
await Promise.all([
	page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 }),
	page.click('button[type="submit"]'),
])

await page.goto(`${BASE}/docs/new`, { waitUntil: "load" })
await page.waitForTimeout(500)

await page.fill("#jobAddressEstimated", "Calle 5, Barrio Obrero, San Juan")
await page.fill("#jobType", "Instalacion de fibra")
await page.fill("#jobDescription", "Tender fibra desde el poste hasta la casa")

await page.click("#brigadeId")
await page.waitForTimeout(300)
const firstOption = page.locator('[role="option"]').first()
await firstOption.click()
await page.waitForTimeout(400)

await page.screenshot({
	path: path.join(OUT_DIR, "preview_after.png"),
	fullPage: true,
})

console.log("console/page errors:", errors.length)
for (const e of errors) console.log(" -", e.slice(0, 200))

await browser.close()
console.log("done")
