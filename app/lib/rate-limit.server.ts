type RateLimitEntry = {
	count: number
	resetAt: number
}

const attempts = new Map<string, RateLimitEntry>()

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 5

export function checkRateLimit(identifier: string) {
	const now = Date.now()
	const entry = attempts.get(identifier)

	if (!entry || now > entry.resetAt) {
		attempts.set(identifier, { count: 1, resetAt: now + WINDOW_MS })
		return { allowed: true, remaining: MAX_ATTEMPTS - 1, resetIn: WINDOW_MS }
	}

	if (entry.count >= MAX_ATTEMPTS) {
		return { allowed: false, remaining: 0, resetIn: entry.resetAt - now }
	}

	entry.count++
	return {
		allowed: true,
		remaining: MAX_ATTEMPTS - entry.count,
		resetIn: entry.resetAt - now,
	}
}

export function clearRateLimit(identifier: string) {
	attempts.delete(identifier)
}
