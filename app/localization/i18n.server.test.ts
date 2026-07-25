import remixI18n, { lngCookie } from "./i18n.server"

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

	it("returns es when the lng cookie is set and there is no search param", async () => {
		const cookieHeader = await lngCookie.serialize("es")
		const request = new Request("http://localhost:3000", {
			headers: { Cookie: cookieHeader.split(";")[0] },
		})
		const lang = await remixI18n.getLocale(request)
		expect(lang).toBe("es")
	})

	it("prefers the lng search param over the lng cookie", async () => {
		const cookieHeader = await lngCookie.serialize("es")
		const request = new Request("http://localhost:3000?lng=en", {
			headers: { Cookie: cookieHeader.split(";")[0] },
		})
		const lang = await remixI18n.getLocale(request)
		expect(lang).toBe("en")
	})
})
