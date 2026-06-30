import { Outlet, redirect, Link, Form } from 'react-router'
import { requireSession } from '~/lib/permissions.server'
import { db } from '~/lib/db.server'
import type { Route } from './+types/_app'

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request)
  const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id } })
  return { user: { name: user.name, role: user.role } }
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="font-bold text-lg">JAF Ops</Link>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{user.name}</span>
          <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">{user.role}</span>
          <Form method="post" action="/api/auth/sign-out">
            <button type="submit" className="text-slate-500 hover:text-slate-800">Sign out</button>
          </Form>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

