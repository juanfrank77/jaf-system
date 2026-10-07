// The installer department's own work loop, in the order an installer
// travels through it on a phone (mockup v3, §2.0): start at Home, open
// a new completion, do a warranty swap, audit the van, or request a
// restock. Every installer screen renders an `InstallerLoopRail`
// naming its step. The new-completion flow has its own 4-step rail
// (ORDER → SCAN → MATERIALS → SIGN) rendered inside completion.new.
export type InstallerLoopStep = "HOME" | "NEW" | "SWAP" | "VAN" | "RESTOCK"

export const INSTALLER_LOOP_STEPS: InstallerLoopStep[] = [
	"HOME",
	"NEW",
	"SWAP",
	"VAN",
	"RESTOCK",
]

export const INSTALLER_LOOP_HREF: Record<InstallerLoopStep, string> = {
	HOME: "/installer",
	NEW: "/installer/completion/new",
	SWAP: "/installer/swap",
	VAN: "/installer/van",
	RESTOCK: "/installer/restock",
}

export const INSTALLER_LOOP_LABEL_KEY = {
	HOME: "installer.installer_flow.loop.home",
	NEW: "installer.installer_flow.loop.new",
	SWAP: "installer.installer_flow.loop.swap",
	VAN: "installer.installer_flow.loop.van",
	RESTOCK: "installer.installer_flow.loop.restock",
} as const

// The four screens of a new completion (mockup §2.1–2.4). The rail is
// client-side: the current step is whichever one the installer has
// not yet filled in.
export type CompletionStep = "ORDER" | "SCAN" | "MATERIALS" | "SIGN"

export const COMPLETION_STEPS: CompletionStep[] = [
	"ORDER",
	"SCAN",
	"MATERIALS",
	"SIGN",
]

export const COMPLETION_LABEL_KEY = {
	ORDER: "installer.installer_flow.completion.order",
	SCAN: "installer.installer_flow.completion.scan",
	MATERIALS: "installer.installer_flow.completion.materials",
	SIGN: "installer.installer_flow.completion.sign",
} as const
