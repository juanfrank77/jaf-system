import { createCookie } from "react-router"

export type Theme = "light" | "dark"

export const themeCookie = createCookie("theme", {
	path: "/",
	sameSite: "lax",
	maxAge: 34_560_000,
	secure: process.env.NODE_ENV === "production",
})

export async function getTheme(request: Request): Promise<Theme> {
	const value = await themeCookie.parse(request.headers.get("Cookie"))
	return value === "dark" ? "dark" : "light"
}
