import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { reactRouterDevTools } from "react-router-devtools"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
	plugins: [
		tailwindcss(),
		reactRouterDevTools(),
		reactRouter(),
		VitePWA({
			registerType: "autoUpdate",
			strategies: "injectManifest",
			srcDir: "app",
			filename: "sw.ts",
			injectManifest: {
				globDirectory: "build/client",
				globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
			},
			manifest: {
				name: "JAF Operations",
				short_name: "JAF",
				theme_color: "#2b7c99",
				background_color: "#ffffff",
				display: "standalone",
				icons: [
					{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
				],
			},
		}),
	],
	resolve: {
		tsconfigPaths: true,
	},
})
