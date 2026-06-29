import { PassThrough } from "node:stream"
import { createReadableStreamFromReadable } from "@react-router/node"
import { createInstance } from "i18next"
import { isbot } from "isbot"
import { renderToPipeableStream } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { EntryContext } from "react-router"
import { ServerRouter } from "react-router"
import i18n from "./localization/i18n"
import i18nextServer from "./localization/i18n.server"
import { resources } from "./localization/resource"

export const streamTimeout = 10000

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	context: EntryContext,
) {
	const callbackName = isbot(request.headers.get("user-agent"))
		? "onAllReady"
		: "onShellReady"
	const instance = createInstance()
	const lng = await i18nextServer.getLocale(request)
	const ns = i18nextServer.getRouteNamespaces(context)

	await instance.use(initReactI18next).init({
		...i18n,
		lng,
		ns,
		resources,
	})

	return new Promise<Response>((resolve, reject) => {
		let didError = false

		const { pipe, abort } = renderToPipeableStream(
			<I18nextProvider i18n={instance}>
				<ServerRouter context={context} url={request.url} />
			</I18nextProvider>,
			{
				[callbackName]: () => {
					const body = new PassThrough()
					const stream = createReadableStreamFromReadable(body)
					responseHeaders.set("Content-Type", "text/html")

					resolve(
						new Response(stream, {
							headers: responseHeaders,
							status: didError ? 500 : responseStatusCode,
						}),
					)

					pipe(body)
				},
				onShellError(error: unknown) {
					reject(error)
				},
				onError(error: unknown) {
					didError = true
					// biome-ignore lint/suspicious/noConsole: log server render errors
					console.error(error)
				},
			},
		)

		setTimeout(abort, streamTimeout + 1000)
	})
}
