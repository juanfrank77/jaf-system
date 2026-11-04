import { render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { CrewSignerSelect } from "./crew-signer-select"

const groups = [
	{
		brigadeId: "b1",
		brigadeName: "ALEXIS DIAZ",
		brigadeCode: "025",
		signers: [
			{ key: "b1:u1", name: "Alexis Diaz" },
			{ key: "b1:u2", name: "Dino Castillo" },
		],
	},
	{
		brigadeId: "b2",
		brigadeName: "CARLOS RODRIGUEZ",
		brigadeCode: "171",
		signers: [{ key: "b2:name", name: "Carlos Rodríguez" }],
	},
]

function Harness({ list = groups }: { list?: typeof groups }) {
	const [value, setValue] = useState("")
	return (
		<>
			<CrewSignerSelect groups={list} value={value} onChange={setValue} />
			<output data-testid="picked">{value}</output>
		</>
	)
}

describe("CrewSignerSelect", () => {
	it("lists every brigade's people under their brigade and picks one", async () => {
		render(<Harness />)
		await userEvent.click(screen.getByTestId("pickup-signer"))
		expect(await screen.findByText("ALEXIS DIAZ (025)")).toBeTruthy()
		expect(screen.getByText("CARLOS RODRIGUEZ (171)")).toBeTruthy()
		expect(screen.getByRole("option", { name: "Dino Castillo" })).toBeTruthy()
		await userEvent.click(
			screen.getByRole("option", { name: "Carlos Rodríguez" }),
		)
		expect(screen.getByTestId("picked").textContent).toBe("b2:name")
		expect(screen.getByTestId("pickup-signer").textContent).toContain(
			"Carlos Rodríguez",
		)
	})

	it("shows a dash, not a picker, when the job has no brigade", () => {
		render(<Harness list={[]} />)
		expect(screen.getByTestId("pickup-signer").textContent).toBe("—")
	})
})
