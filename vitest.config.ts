import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        css: true,
        coverage: {
            include: ["app/**"],
            reporter: ["text", "json-summary", "json"],
            reportOnFailure: true
        }
    }
})