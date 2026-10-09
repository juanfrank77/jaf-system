import { data } from "react-router"

type Failure = { errorKey?: string; errorMessage?: string }

/**
 * A validation failure. A normal form post gets the plain object the page
 * renders. An offline-sync replay (a background fetch with no page) gets a 422
 * the sync can act on: it keeps the queued item as rejected instead of
 * mistaking the rendered error page for success.
 */
export function refuse<T extends Failure>(request: Request, failure: T) {
	if (request.headers.get("X-Offline-Sync") !== "true") return failure
	return data(
		failure.errorKey
			? { validationError: failure.errorKey }
			: { validationMessage: failure.errorMessage ?? "" },
		{ status: 422 },
	)
}
