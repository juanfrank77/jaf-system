import { Form, redirect, useActionData } from 'react-router'
import { auth } from '~/lib/auth.server'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import type { Route } from './+types/_auth.login'

export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (session) throw redirect('/dashboard')
  return null
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const email = form.get('email') as string
  const password = form.get('password') as string

  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
    })
    const headers = new Headers()
    if (result.headers) {
      result.headers.forEach((v, k) => headers.append(k, v))
    }
    throw redirect('/dashboard', { headers })
  } catch (e: any) {
    if (e instanceof Response) throw e
    return { error: 'Invalid email or password' }
  }
}

export default function LoginPage() {
  const data = useActionData<typeof action>()
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">JAF Operations</h1>
        <Form method="post" className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {data?.error && <p className="text-sm text-red-600">{data.error}</p>}
          <Button type="submit" className="w-full">Sign In</Button>
        </Form>
      </div>
    </div>
  )
}

