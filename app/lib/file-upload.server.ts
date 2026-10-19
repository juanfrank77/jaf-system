const PHOTO_MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const PDF_MAX_SIZE = 30 * 1024 * 1024 // 30 MB
const FILE_MAX_SIZE = 40 * 1024 * 1024 // 40 MB

const ALLOWED_PHOTO_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/heic",
]
const ALLOWED_PDF_TYPES = ["application/pdf"]

const BLOCKED_EXTENSIONS = [
	".zip",
	".exe",
	".js",
	".ts",
	".sh",
	".bat",
	".cmd",
	".msi",
	".dll",
	".so",
	".dylib",
]

export function validateFile(
	file: File,
	type: "photo" | "pdf" | "file",
): { valid: true } | { valid: false; error: string } {
	const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || ""

	if (BLOCKED_EXTENSIONS.some((b) => ext === b)) {
		return { valid: false, error: `File type "${ext}" is not allowed` }
	}

	if (type === "photo") {
		if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
			return { valid: false, error: "Photo must be JPEG, PNG, WebP, or HEIC" }
		}
		if (file.size > PHOTO_MAX_SIZE) {
			const mbLimit = PHOTO_MAX_SIZE / 1024 / 1024
			return { valid: false, error: `Photo exceeds ${mbLimit}MB limit` }
		}
	}

	if (type === "pdf") {
		if (!ALLOWED_PDF_TYPES.includes(file.type)) {
			return { valid: false, error: "File must be a PDF" }
		}
		if (file.size > PDF_MAX_SIZE) {
			const mbLimit = PDF_MAX_SIZE / 1024 / 1024
			return { valid: false, error: `PDF exceeds ${mbLimit}MB limit` }
		}
	}

	if (type === "file") {
		if (file.size > FILE_MAX_SIZE) {
			const mbLimit = FILE_MAX_SIZE / 1024 / 1024
			return { valid: false, error: `File exceeds ${mbLimit}MB limit` }
		}
	}

	return { valid: true }
}

/** A unique, filesystem-safe name for the `i`-th file of one upload. */
export function uploadFileName(file: File, i: number): string {
	return `${Date.now()}-${i}-${file.name.replace(/[^\w.-]+/g, "_")}`
}

/** A blueprint is a PDF or a photo (intake and the Field step accept both). */
export function validateBlueprintFile(
	file: File,
): { valid: true } | { valid: false; error: string } {
	return validateFile(file, file.type === "application/pdf" ? "pdf" : "photo")
}
