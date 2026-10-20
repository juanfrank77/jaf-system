import { describe, expect, it } from "vitest"
import {
	buildInvoiceLines,
	buildPreCertLines,
	parseServiceLines,
	round2,
	sumLines,
} from "./service-lines"

const codeMap = {
	c1: {
		id: "c1",
		claroCode: "34006301",
		name: "TRANSFER ATTCH DE POSTESMC",
		accountCode: "610",
		unit: "EA",
		unitPrice: "42.3430",
	},
	c2: {
		id: "c2",
		claroCode: "34007030",
		name: "REMOCION DE LINEA BAJANTEMO",
		accountCode: "6102",
		unit: "EA",
		unitPrice: "13.8115",
	},
}

describe("service-lines", () => {
	it("round2 rounds half up to cents", () => {
		expect(round2(211.715)).toBe(211.72)
		expect(round2(27.623)).toBe(27.62)
	})

	it("parseServiceLines keeps only well-formed positive lines", () => {
		const raw = JSON.stringify([
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				accountCode: "610",
				name: "X",
				qty: 5,
			},
			{ serviceCodeId: "", claroCode: "", accountCode: null, name: "", qty: 1 },
			{
				serviceCodeId: "c2",
				claroCode: "34007030",
				accountCode: "6102",
				name: "Y",
				qty: 0,
			},
		])
		expect(parseServiceLines(raw)).toEqual([
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				accountCode: "610",
				name: "X",
				qty: 5,
			},
		])
		expect(parseServiceLines(null)).toEqual([])
		expect(() => parseServiceLines("{bad")).toThrow()
	})

	it("buildInvoiceLines prices from the catalog and rounds per line", () => {
		const lines = buildInvoiceLines(
			[
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					accountCode: "610",
					name: "X",
					qty: 5,
				},
				{
					serviceCodeId: "c2",
					claroCode: "34007030",
					accountCode: "6102",
					name: "Y",
					qty: 2,
				},
			],
			codeMap,
		)
		expect(lines[0]).toMatchObject({
			unit: "EA",
			unitPrice: 42.343,
			lineAmount: 211.72,
		})
		expect(lines[1]).toMatchObject({ unitPrice: 13.8115, lineAmount: 27.62 })
		expect(sumLines(lines)).toBe(239.34)
	})

	it("buildInvoiceLines drops lines whose code is not in the catalog", () => {
		expect(
			buildInvoiceLines(
				[
					{
						serviceCodeId: "zzz",
						claroCode: "0",
						accountCode: null,
						name: "?",
						qty: 1,
					},
				],
				codeMap,
			),
		).toEqual([])
	})

	it("buildPreCertLines sets certified = installed", () => {
		const lines = buildPreCertLines(
			[
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					accountCode: "610",
					name: "X",
					qty: 5,
				},
			],
			codeMap,
		)
		expect(lines).toEqual([
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				accountCode: "610",
				description: "TRANSFER ATTCH DE POSTESMC",
				installedQty: 5,
				certifiedQty: 5,
				unit: "EA",
				unitPrice: 42.343,
				lineAmount: 211.72,
			},
		])
	})
})
