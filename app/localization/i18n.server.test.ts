import remixI18n from "./i18n.server"

describe("Remix I18n", () => {
	it("returns the default language for a request with no locale header", async () => {
		const request = new Request("http://localhost:3000")
		const lang = await remixI18n.getLocale(request)
		expect(lang).toBe("en")
	})

	it("returns the fallback language when the lng param is unsupported", async () => {
		const request = new Request("http://localhost:3000?lng=invalid")
		const lang = await remixI18n.getLocale(request)
		expect(lang).toBe("en")
	})

	it("returns es when lng=es is in the search params", async () => {
		const request = new Request("http://localhost:3000?lng=es")
		const lang = await remixI18n.getLocale(request)
		expect(lang).toBe("es")
	})
})
