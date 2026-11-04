import { redirect } from "react-router"

/**
 * Crew accounts no longer sign in: the supervisor enters the brigade's field
 * work. The CREW role and its users stay (they are the brigade lead / payee
 * identities), but a CREW session is sent to a static notice instead of any
 * app screen.
 */
export function refuseCrew(role: string): void {
	if (role === "CREW") throw redirect("/crew-notice")
}
