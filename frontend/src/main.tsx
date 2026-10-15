import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './auth/AuthGate.tsx'
import { SignupPage } from './auth/SignupPage.tsx'
import { registerPwa } from './pwa'

registerPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/signup' ? (
      <SignupPage />
    ) : (
      <AuthGate>{(user, signOut) => <App user={user} onSignOut={signOut} />}</AuthGate>
    )}
  </StrictMode>,
)
