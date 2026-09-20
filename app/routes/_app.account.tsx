import fs from "node:fs/promises"
import path from "node:path"
import {
	Camera01Icon,
	CheckmarkCircle02Icon,
	Moon02Icon,
	Sun01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Avatar } from "~/components/ui/avatar"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardHeaderText,
	CardTitle,
} from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { useToastManager } from "~/components/ui/toast"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { requireSession } from "~/lib/permissions.server"
import { getTheme, type Theme, themeCookie } from "~/lib/theme.server"
import { cn } from "~/lib/utils"
import type { Route } from "./+types/_app.account"

export const meta: Route.MetaFunction = () => [
	{ title: "My Profile — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	const theme = await getTheme(request)
	return {
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			image: user.image,
		},
		theme,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const session = await requireSession(request)
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "updateTheme") {
		const theme: Theme = form.get("theme") === "dark" ? "dark" : "light"
		return data(
			{ theme },
			{ headers: { "Set-Cookie": await themeCookie.serialize(theme) } },
		)
	}

	if (intent === "updateProfile") {
		const name = form.get("name")
		if (typeof name !== "string" || !name.trim()) {
			return data({ errorKey: "account.errors.name_required" }, { status: 400 })
		}

		const avatar = form.get("avatar")
		let image: string | undefined

		if (avatar instanceof File && avatar.size > 0) {
			const validation = validateFile(avatar, "photo")
			if (!validation.valid) {
				return data(
					{ errorKey: "account.errors.invalid_image" },
					{ status: 400 },
				)
			}

			const ext =
				avatar.type === "image/png"
					? ".png"
					: avatar.type === "image/webp"
						? ".webp"
						: ".jpg"
			const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
			const avatarDir = path.join(uploadDir, "avatars")
			await fs.mkdir(avatarDir, { recursive: true })
			const filename = `${session.user.id}-${Date.now()}${ext}`
			await fs.writeFile(
				path.join(avatarDir, filename),
				Buffer.from(await avatar.arrayBuffer()),
			)
			image = `avatars/${filename}`

			const existing = await db.user.findUnique({
				where: { id: session.user.id },
				select: { image: true },
			})
			if (existing?.image) {
				await fs.unlink(path.join(uploadDir, existing.image)).catch(() => {})
			}
		}

		await db.user.update({
			where: { id: session.user.id },
			data: { name: name.trim(), ...(image ? { image } : {}) },
		})
		return { success: true }
	}

	return data({ errorKey: "account.errors.unknown_intent" }, { status: 400 })
}

type ThemeOptionProps = {
	value: Theme
	label: string
	icon: IconSvgElement
	checked: boolean
	onSelect: () => void
}

const PREVIEW_COLORS: Record<
	Theme,
	{ bg: string; panel: string; border: string; accent: string }
> = {
	light: {
		bg: "#f6f8f9",
		panel: "#ffffff",
		border: "#dde3e5",
		accent: "#2b7c99",
	},
	dark: {
		bg: "#14181b",
		panel: "#1c2124",
		border: "#33393c",
		accent: "#69afc9",
	},
}

function ThemePreview({ theme }: { theme: Theme }) {
	const c = PREVIEW_COLORS[theme]
	return (
		<div
			aria-hidden="true"
			className="flex h-24 w-full overflow-hidden rounded-md border"
			style={{ background: c.bg, borderColor: c.border }}
		>
			<div
				className="flex w-1/3 flex-col gap-1.5 border-r p-2"
				style={{ background: c.panel, borderColor: c.border }}
			>
				<div
					className="h-1.5 w-full rounded-full"
					style={{ background: c.accent }}
				/>
				<div
					className="h-1 w-4/5 rounded-full"
					style={{ background: c.border }}
				/>
				<div
					className="h-1 w-3/5 rounded-full"
					style={{ background: c.border }}
				/>
				<div
					className="h-1 w-4/5 rounded-full"
					style={{ background: c.border }}
				/>
			</div>
			<div className="flex flex-1 flex-col gap-1.5 p-2">
				<div
					className="h-1.5 w-1/2 rounded-full"
					style={{ background: c.border }}
				/>
				<div
					className="flex-1 rounded-sm border"
					style={{ background: c.panel, borderColor: c.border }}
				/>
			</div>
		</div>
	)
}

function ThemeOption({
	value,
	label,
	icon,
	checked,
	onSelect,
}: ThemeOptionProps) {
	return (
		<label
			className={cn(
				"flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-card p-2 text-left transition-[color,border-color,box-shadow] has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
				checked
					? "border-primary ring-2 ring-primary/25"
					: "border-border hover:border-muted-foreground/40",
			)}
		>
			<input
				type="radio"
				name="theme"
				value={value}
				checked={checked}
				onChange={onSelect}
				className="sr-only"
			/>
			<ThemePreview theme={value} />
			<span className="flex items-center gap-2 px-1 pb-0.5 text-sm font-medium text-foreground">
				<HugeiconsIcon
					icon={icon}
					strokeWidth={2}
					className="size-4 text-muted-foreground"
				/>
				{label}
				{checked && (
					<HugeiconsIcon
						icon={CheckmarkCircle02Icon}
						strokeWidth={2}
						className="ml-auto size-4 text-primary"
					/>
				)}
			</span>
		</label>
	)
}

export default function AccountSettings({ loaderData }: Route.ComponentProps) {
	const { user, theme } = loaderData
	const { t } = useTranslation()
	const toastManager = useToastManager()

	const profileFetcher = useFetcher<{
		errorKey?: string
		success?: boolean
	}>()
	const wasSaving = useRef(false)
	const saving = profileFetcher.state !== "idle"
	const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

	useEffect(() => {
		if (wasSaving.current && !saving && profileFetcher.data) {
			if (profileFetcher.data.success) {
				setAvatarPreview(null)
				toastManager.add({ title: t("account.saved") })
			} else if (profileFetcher.data.errorKey) {
				toastManager.add({
					title: t(profileFetcher.data.errorKey as ParseKeys),
				})
			}
		}
		wasSaving.current = saving
	}, [saving, profileFetcher.data, t, toastManager])

	const themeFetcher = useFetcher<{ theme?: Theme }>()
	const currentTheme = themeFetcher.formData
		? (themeFetcher.formData.get("theme") as Theme)
		: theme
	const selectTheme = (next: Theme) =>
		themeFetcher.submit(
			{ intent: "updateTheme", theme: next },
			{ method: "post" },
		)

	return (
		<div className="max-w-3xl">
			<PageHeader title={t("account.title")} subtitle={t("account.subtitle")} />

			<div className="flex flex-col gap-5">
				<Card>
					<profileFetcher.Form method="post" encType="multipart/form-data">
						<input type="hidden" name="intent" value="updateProfile" />
						<CardHeader divider>
							<CardHeaderText>
								<CardTitle>{t("account.profile_heading")}</CardTitle>
								<CardDescription>
									{t("account.profile_subtitle")}
								</CardDescription>
							</CardHeaderText>
						</CardHeader>
						<CardContent className="space-y-6 py-6">
							<div className="flex items-center gap-5">
								<Avatar
									name={user.name}
									src={
										avatarPreview ?? (user.image ? `/avatars/${user.id}` : null)
									}
									className="size-20 text-xl ring-1 ring-border ring-offset-2 ring-offset-card"
								/>
								<div className="min-w-0 space-y-1.5">
									<label
										className={cn(
											buttonVariants({ variant: "outline", size: "sm" }),
											"cursor-pointer has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
										)}
									>
										<input
											id="avatar"
											name="avatar"
											type="file"
											accept="image/png,image/jpeg,image/webp"
											className="sr-only"
											onChange={(event) => {
												const file = event.target.files?.[0]
												if (file) setAvatarPreview(URL.createObjectURL(file))
											}}
										/>
										<HugeiconsIcon
											icon={Camera01Icon}
											strokeWidth={2}
											className="size-4"
											data-icon="inline-start"
										/>
										{t("account.change_photo")}
									</label>
									<p
										className={cn(
											"text-xs",
											avatarPreview
												? "font-medium text-primary"
												: "text-muted-foreground",
										)}
									>
										{avatarPreview
											? t("account.photo_selected")
											: t("account.photo_hint")}
									</p>
								</div>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="name">{t("account.name_label")}</Label>
								<Input
									id="name"
									name="name"
									defaultValue={user.name}
									autoComplete="name"
									required
								/>
							</div>

							<div className="grid gap-6 sm:grid-cols-2">
								<div className="space-y-1.5">
									<Label htmlFor="email">{t("account.email_label")}</Label>
									<Input
										id="email"
										value={user.email}
										disabled
										readOnly
										aria-describedby="email-hint"
									/>
									<p id="email-hint" className="text-xs text-muted-foreground">
										{t("account.email_hint")}
									</p>
								</div>
								<div className="space-y-1.5">
									<p className="text-sm leading-none font-medium">
										{t("account.role_label")}
									</p>
									<div className="flex h-9 items-center">
										<Badge variant="info">
											{t(
												`admin_users.role.${user.role.toLowerCase()}` as ParseKeys,
											)}
										</Badge>
									</div>
									<p className="text-xs text-muted-foreground">
										{t("account.role_hint")}
									</p>
								</div>
							</div>

							{profileFetcher.data?.errorKey && (
								<p
									role="alert"
									className="rounded-md border border-status-danger/20 bg-status-danger-soft px-3 py-2 text-sm text-status-danger"
								>
									{t(profileFetcher.data.errorKey as ParseKeys)}
								</p>
							)}
						</CardContent>
						<CardFooter className="justify-end bg-muted/40">
							<Button type="submit" loading={saving}>
								{t("account.save")}
							</Button>
						</CardFooter>
					</profileFetcher.Form>
				</Card>

				<Card>
					<CardHeader divider>
						<CardHeaderText>
							<CardTitle>{t("account.appearance_heading")}</CardTitle>
							<CardDescription>
								{t("account.appearance_subtitle")}
							</CardDescription>
						</CardHeaderText>
					</CardHeader>
					<CardContent className="py-6">
						<div
							role="radiogroup"
							aria-label={t("account.appearance_heading")}
							className="grid max-w-md grid-cols-2 gap-4"
						>
							<ThemeOption
								value="light"
								label={t("account.theme_light")}
								icon={Sun01Icon}
								checked={currentTheme === "light"}
								onSelect={() => selectTheme("light")}
							/>
							<ThemeOption
								value="dark"
								label={t("account.theme_dark")}
								icon={Moon02Icon}
								checked={currentTheme === "dark"}
								onSelect={() => selectTheme("dark")}
							/>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
