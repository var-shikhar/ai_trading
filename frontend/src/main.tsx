import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './tailwind.css'
import App from './App.tsx'
import { AuthGate } from './auth/AuthGate.tsx'
import { SignupPage } from './auth/SignupPage.tsx'
import { registerPwa } from './pwa'

registerPwa()

// Server data (watchlists, quotes, scans...) is cached and shared between
// screens; mutations update it optimistically and roll back on error.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {window.location.pathname === '/signup' ? (
        <SignupPage />
      ) : (
        <AuthGate>{(user, signOut) => <App user={user} onSignOut={signOut} />}</AuthGate>
      )}
    </QueryClientProvider>
  </StrictMode>,
)
