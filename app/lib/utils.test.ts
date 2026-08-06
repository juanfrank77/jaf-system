import { describe, expect, it } from "vitest"
import { formatMoney, toNumberPrice } from "./utils"

// Mirrors the shape of a Prisma Decimal (which exposes toNumber() and valueOf()).
class FakeDecimal {
	constructor(private readonly v: number) {}
	toNumber(): number {
		return this.v
	}
	valueOf(): number {
		return this.v
	}
	toString(): string {
		return String(this.v)
	}
}

describe("toNumberPrice", () => {
	it("passes through finite numbers", () => {
		expect(toNumberPrice(0.36)).toBe(0.36)
		expect(toNumberPrice(12.5)).toBe(12.5)
	})

	it("converts numeric strings", () => {
		expect(toNumberPrice("0.52")).toBe(0.52)
		expect(toNumberPrice("1429.75")).toBe(1429.75)
	})

	it("converts Prisma Decimal-like objects", () => {
		expect(toNumberPrice(new FakeDecimal(0.44))).toBe(0.44)
	})

	it("never returns NaN for empty / nullish input", () => {
		expect(toNumberPrice(null)).toBe(0)
		expect(toNumberPrice(undefined)).toBe(0)
		expect(toNumberPrice("")).toBe(0)
		expect(toNumberPrice(NaN)).toBe(0)
	})

	it("maps non-finite and unparseable values to 0", () => {
		expect(toNumberPrice(Infinity)).toBe(0)
		expect(toNumberPrice(-Infinity)).toBe(0)
		expect(toNumberPrice("NaN")).toBe(0)
		expect(toNumberPrice("not a price")).toBe(0)
		expect(toNumberPrice({})).toBe(0)
		expect(toNumberPrice([])).toBe(0)
	})
})

describe("formatMoney", () => {
	it("formats a finite amount with two decimals", () => {
		expect(formatMoney(12.5)).toBe("$12.50")
	})

	it("formats Prisma Decimal-like input", () => {
		expect(formatMoney(new FakeDecimal(0.36))).toBe("$0.36")
	})

	it("never emits NaN", () => {
		expect(formatMoney(NaN)).toBe("$0.00")
		expect(formatMoney(null)).toBe("$0.00")
		expect(formatMoney(undefined)).toBe("$0.00")
		expect(formatMoney("garbage")).toBe("$0.00")
	})
})
