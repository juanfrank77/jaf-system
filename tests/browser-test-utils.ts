import { screen, waitFor } from "@testing-library/react"
import { userEvent } from "vitest/browser"

const navigatorOnLine = Object.getOwnPropertyDescriptor(
	Navigator.prototype,
	"onLine",
)

/** Wait until the react-router stub has finished its initial render. */
export async function waitForStubReady() {
	await waitFor(() => {
		expect(screen.queryByText("hydrating")).not.toBeInTheDocument()
	})
}

/** Click only after the element is present and enabled (avoids CDP races). */
export async function clickWhenReady(getElement: () => HTMLElement) {
	await waitFor(() => {
		const element = getElement()
		expect(element).toBeEnabled()
	})
	await userEvent.click(getElement())
}

/** Fill only after the control is present and editable. */
export async function fillWhenReady(
	getElement: () => HTMLElement,
	value: string,
) {
	await waitFor(() => {
		const element = getElement()
		expect(element).not.toBeDisabled()
	})
	await userEvent.fill(getElement(), value)
}

/** Reset browser globals that individual tests may mutate. */
export function resetBrowserTestState() {
	if (navigatorOnLine) {
		Object.defineProperty(navigator, "onLine", navigatorOnLine)
	}
	document.body.style.removeProperty("overflow")
	for (const dialog of document.querySelectorAll("dialog[open]")) {
		if (dialog instanceof HTMLDialogElement) {
			dialog.close()
		}
	}
}
