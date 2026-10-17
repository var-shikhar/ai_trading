import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, type InviteInfo } from '../api/client'
import { useToasts } from '../state/ui'
import { Badge, Button, ErrorText, Field, Input, Select, Skeleton, cx } from '../ui/kit'
import { INVITES_KEY, useInvites, useOptimisticList } from './queries'
import { ConfirmDialog, CopyField, ListCard, SectionTitle } from './shared'
import { errorMessage, formatWhen } from './util'

const EMPTY_FORM = { email: '', role: 'user' as 'user' | 'admin', days: 7, note: '' }
const STATUS_TONE = { open: 'up', used: 'accent', expired: 'neutral', revoked: 'down' } as const

/** Admin: create one-time invite links and see who used them. */
export function InvitesSection() {
  const qc = useQueryClient()
  const toast = useToasts((s) => s.push)
  const invites = useInvites()
  const [form, setForm] = useState(EMPTY_FORM)
  const [link, setLink] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<InviteInfo | null>(null)

  const create = useMutation({
    mutationFn: () => api.createInvite({ ...form, email: form.email.trim() || null, note: form.note.trim() || null }),
    onSuccess: (inv) => {
      setLink(`${window.location.origin}/signup?code=${encodeURIComponent(inv.code)}`)
      setForm(EMPTY_FORM)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  })
  const revoke = useOptimisticList<InviteInfo, string>(
    INVITES_KEY,
    (id) => api.revokeInvite(id),
    (list, id) => list.map((i) => (i.id === id ? { ...i, status: 'revoked' } : i)),
    () => toast('Invite revoked'),
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!create.isPending) create.mutate()
  }

  // Open invites first, then the newest.
  const list = [...(invites.data ?? [])].sort(
    (a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.created.localeCompare(a.created),
  )

  return (
    <section>
      <SectionTitle>Invite a friend</SectionTitle>
      <p className="mb-3 text-[13px] leading-relaxed text-muted">
        Only people with an invite link can sign up. Each link works once and expires. Lock it to an email to make sure only
        that person can use it.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr]">
          <Field label="Email (optional)">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Anyone with the link" />
          </Field>
          <Field label="Note">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Rahul" />
          </Field>
          <Field label="Valid for">
            <Select value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} day{d > 1 ? 's' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'user' | 'admin' })}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
        <ErrorText>{create.error && errorMessage(create.error)}</ErrorText>
        <div className="flex justify-end">
          <Button variant="primary" type="submit" loading={create.isPending} className="max-sm:w-full">
            Create invite link
          </Button>
        </div>
      </form>

      {link && (
        <div className="mt-3 animate-pop">
          <CopyField value={link} hint="Send this link to your friend. It's shown only once." />
        </div>
      )}

      {invites.isPending ? (
        <ListCard className="mt-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-52" />
              </div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </ListCard>
      ) : invites.isError ? (
        <div className="mt-4 flex flex-col items-start gap-2">
          <ErrorText>{errorMessage(invites.error)}</ErrorText>
          <Button size="sm" onClick={() => invites.refetch()} loading={invites.isFetching}>
            Try again
          </Button>
        </div>
      ) : (
        list.length > 0 && (
          <ListCard className="mt-4">
            {list.map((i) => (
              <div key={i.id} className={cx('flex items-center gap-3 px-4 py-3', i.status !== 'open' && 'opacity-60')}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-[12px]">{i.prefix}…</code>
                    {i.note && <span className="truncate text-[13px] font-medium">{i.note}</span>}
                    {i.role === 'admin' && <Badge tone="accent">admin</Badge>}
                  </div>
                  <span className="truncate text-[12px] text-muted">
                    {i.email ?? 'Anyone with the link'} ·{' '}
                    {i.status === 'used'
                      ? `used by ${i.used_by ?? 'someone'}${i.used_at ? ` ${formatWhen(i.used_at, false)}` : ''}`
                      : `expires ${formatWhen(i.expires, false)}`}
                  </span>
                </div>
                <Badge tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                {i.status === 'open' && (
                  <Button size="sm" variant="ghost" className="text-down hover:text-down" onClick={() => setRevoking(i)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </ListCard>
        )
      )}

      {revoking && (
        <ConfirmDialog
          title="Revoke this invite?"
          confirmLabel="Revoke"
          onConfirm={() => revoke.mutateAsync(revoking.id)}
          onClose={() => setRevoking(null)}
        >
          The link {revoking.note ? `for ${revoking.note} ` : ''}stops working at once. You can create a new one any time.
        </ConfirmDialog>
      )}
    </section>
  )
}
