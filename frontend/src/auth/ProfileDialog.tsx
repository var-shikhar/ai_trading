import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, type ApiKeyInfo, type UserInfo } from '../api/client'
import { useToasts } from '../state/ui'
import { Button, ErrorText, Field, Input, Modal, Skeleton } from '../ui/kit'
import { API_KEYS_KEY, SESSION_KEY, sessionQuery, useApiKeys, useOptimisticList } from './queries'
import { ConfirmDialog, CopyField, ListCard, SectionTitle } from './shared'
import { errorMessage, formatWhen } from './util'

/** Your notification settings and API keys (for scripts and agents). */
export function ProfileDialog({ me, onClose }: { me: UserInfo; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToasts((s) => s.push)
  // The cached session is fresher than the prop after a save (reopening the
  // dialog used to show the old values).
  const current = useQuery(sessionQuery).data ?? me
  const [email, setEmail] = useState(current.email ?? '')
  const [chat, setChat] = useState(current.telegram_chat_id ?? '')
  const keys = useApiKeys()
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyName, setKeyName] = useState('')
  const [revoking, setRevoking] = useState<ApiKeyInfo | null>(null)

  const dirty = email.trim() !== (current.email ?? '') || chat.trim() !== (current.telegram_chat_id ?? '')
  const save = useMutation({
    mutationFn: () =>
      api.updateMe({ email: email.trim() || null, set_email: true, telegram_chat_id: chat.trim() || null, set_telegram: true }),
    onSuccess: (u) => {
      qc.setQueryData(SESSION_KEY, u)
      setEmail(u.email ?? '')
      setChat(u.telegram_chat_id ?? '')
      toast('Profile saved')
    },
  })
  const createKey = useMutation({
    mutationFn: () => api.createApiKey(keyName.trim() || 'API key'),
    onSuccess: (k) => {
      setNewKey(k.key)
      setKeyName('')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: API_KEYS_KEY }),
  })
  const revoke = useOptimisticList<ApiKeyInfo, string>(
    API_KEYS_KEY,
    (id) => api.revokeApiKey(id),
    (list, id) => list.filter((k) => k.id !== id),
    () => toast('API key revoked'),
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!save.isPending) save.mutate()
  }

  return (
    <Modal title="Profile & notifications" onClose={onClose} width={560}>
      <SectionTitle>Notifications</SectionTitle>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field label="Email (alerts)">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field
          label="Telegram chat id"
          hint={
            <>
              Open the app's bot in Telegram (ask the admin for its name) and send it any message, then open{' '}
              <code className="font-mono">@userinfobot</code> to see your chat id and paste it here.
            </>
          }
        >
          <Input inputMode="numeric" value={chat} onChange={(e) => setChat(e.target.value)} placeholder="e.g. 123456789" />
        </Field>
        <ErrorText>{save.error && errorMessage(save.error)}</ErrorText>
        <div className="flex justify-end">
          <Button variant="primary" type="submit" loading={save.isPending} disabled={!dirty} className="max-sm:w-full">
            Save
          </Button>
        </div>
      </form>

      <SectionTitle>API keys</SectionTitle>
      <p className="mb-3 text-[13px] leading-relaxed text-muted">
        For your own scripts or AI agents: send <code className="font-mono text-fg">Authorization: Bearer &lt;key&gt;</code>. A
        key acts as you (your watchlists, alerts, strategies, signals), so keep it secret.
      </p>
      {newKey && (
        <div className="mb-3 animate-pop">
          <CopyField value={newKey} hint="Copy it now. It won't be shown again." />
        </div>
      )}
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!createKey.isPending) createKey.mutate()
        }}
      >
        <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name, e.g. my agent" maxLength={80} />
        <Button type="submit" loading={createKey.isPending}>
          Create key
        </Button>
      </form>
      <ErrorText className="mb-3">{createKey.error && errorMessage(createKey.error)}</ErrorText>

      {keys.isPending ? (
        <ListCard>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-40" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </ListCard>
      ) : keys.isError ? (
        <div className="flex flex-col items-start gap-2">
          <ErrorText>{errorMessage(keys.error)}</ErrorText>
          <Button size="sm" onClick={() => keys.refetch()} loading={keys.isFetching}>
            Try again
          </Button>
        </div>
      ) : keys.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">No API keys yet.</p>
      ) : (
        <ListCard>
          {keys.data.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-semibold">{k.name}</span>
                  <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-[11px] text-muted">{k.prefix}…</code>
                </div>
                <span className="truncate text-[12px] text-muted">
                  {k.last_used ? `Last used ${formatWhen(k.last_used)}` : 'Never used'} · created {formatWhen(k.created, false)}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="text-down hover:text-down" onClick={() => setRevoking(k)}>
                Revoke
              </Button>
            </div>
          ))}
        </ListCard>
      )}

      {revoking && (
        <ConfirmDialog
          title={`Revoke "${revoking.name}"?`}
          confirmLabel="Revoke key"
          onConfirm={() => revoke.mutateAsync(revoking.id)}
          onClose={() => setRevoking(null)}
        >
          Scripts or agents using this key stop working at once.
        </ConfirmDialog>
      )}
    </Modal>
  )
}
