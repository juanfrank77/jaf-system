/**
 * The brigade share of a gross, at one level (a line, a job subtotal, a
 * brigade total). Every figure is truncated to the cent straight from THAT
 * level's gross: Net = floor(g × p%), Ret = floor(g × p% × 10%),
 * Pay = floor(g × p% × 90%). Never Net − Ret, never a sum of rounded lower
 * levels, so a column of lines may not add to its total by a few cents; the
 * brigade total is what Carmen pays.
 *
 * Integer cents throughout, so there is no float to truncate the wrong way.
 */
export const BASE_SHARE_PERCENT = 65
/** Machinery / truck service lines. Printed under the brigade's D account. */
export const D_SHARE_PERCENT = 80

export function shareFigures(gross: number, percent: number) {
	const cents = Math.round(gross * 100)
	return {
		net: Math.floor((cents * percent) / 100) / 100,
		retention: Math.floor((cents * percent) / 1000) / 100,
		adjNet: Math.floor((cents * percent * 9) / 1000) / 100,
	}
}

/** A stored share fraction (0.65, 0.8) as the whole percent it stands for. */
export const percentOf = (fraction: number | null | undefined) =>
	fraction == null || !Number.isFinite(fraction)
		? BASE_SHARE_PERCENT
		: Math.round(fraction * 100)

export const isDPercent = (percent: number) => percent === D_SHARE_PERCENT
