import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Card, CardContent, CardHeader } from "./card"

describe("Card", () => {
	it("renders header and content", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<Card>
							<CardHeader>Title</CardHeader>
							<CardContent>Body</CardContent>
						</Card>
					),
				},
			],
		})
		expect(screen.getByText("Title")).toBeInTheDocument()
		expect(screen.getByText("Body")).toBeInTheDocument()
	})
})
