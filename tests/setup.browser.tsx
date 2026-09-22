import "../app/app.css"
import "vitest-browser-react"
import { renderHook as renderReactHook } from "@testing-library/react"
import { createInstance } from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import {
	createRoutesStub,
	Outlet,
	type RoutesTestStubProps,
} from "react-router"
import { cleanup, render } from "vitest-browser-react"
import i18n from "~/localization/i18n"
import {
	type Language,
	type Namespace,
	resources,
} from "~/localization/resource"
import { resetBrowserTestState, waitForStubReady } from "./browser-test-utils"

export type StubRouteEntry = Parameters<typeof createRoutesStub>[0][0]

const renderStub = async (args?: {
	props?: RoutesTestStubProps
	entries?: StubRouteEntry[]
	i18n?: {
		lng?: Language
		ns?: Namespace | Namespace[]
	}
}) => {
	const instance = createInstance()
	await instance.use(initReactI18next).init({
		...i18n,
		lng: args?.i18n?.lng ?? "en",
		ns: args?.i18n?.ns ?? "common",
		resources,
	})

	const entries: StubRouteEntry[] = [
		{
			id: "root",
			path: "/",
			children: args?.entries ?? [],
			HydrateFallback: () => <p>hydrating</p>,
			Component: () => (
				<div data-testid="root">
					<I18nextProvider i18n={instance}>
						<Outlet />
					</I18nextProvider>
				</div>
			),
		},
	]
	const props: RoutesTestStubProps = {
		...args?.props,
		initialEntries: args?.props?.initialEntries ?? ["/"],
	}
	const Stub = createRoutesStub(entries)
	const renderedScreen = await render(<Stub {...props} />)
	await waitForStubReady()

	return renderedScreen
}

const renderHook = renderReactHook

declare module "vitest" {
	export interface TestContext {
		renderStub: typeof renderStub
		renderHook: typeof renderHook
	}
}

beforeEach((ctx) => {
	ctx.renderStub = renderStub
	ctx.renderHook = renderHook
})

afterEach(async () => {
	await cleanup()
	resetBrowserTestState()
	vi.clearAllMocks()
})
