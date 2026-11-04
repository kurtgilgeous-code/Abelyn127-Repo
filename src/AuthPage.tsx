import { type FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, ShieldCheck, Waves } from 'lucide-react'
import { useAuth } from './auth/useAuth'
import './LoginPage.css'

function AuthPage() {
  const { user, loading, error: sessionError, login, register, logout } = useAuth()
  const [isRegistering, setIsRegistering] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const continueToRolePage = (role: 'ADMIN' | 'CUSTOMER') => {
    window.location.replace(role === 'ADMIN' ? '/admin/dashboard' : '/customer/booking')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    if (isRegistering && password !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const authenticatedUser = isRegistering
        ? await register({ fullName, email, username, password })
        : await login(username, password)
      continueToRolePage(authenticatedUser.role)
    } catch (cause: unknown) {
      setFormError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!loading && user) continueToRolePage(user.role)
  }, [loading, user])

  return (
    <main className="login-page">
      <a className="login-back" href="/"><ArrowLeft size={15} /> Back to Tampisawan</a>
      <section className="login-card">
        <a className="login-brand" href="/" aria-label="Tampisawan home">
          <span><Waves size={22} /></span>
          <b>TAMPISAWAN</b>
          <small>927 Abelyn&apos;s Private Pool</small>
        </a>
        <div className="login-divider" />
        <span className="login-eyebrow"><span /> {isRegistering ? 'CREATE YOUR CUSTOMER ACCOUNT' : 'SIGN IN TO TAMPISAWAN'}</span>
        <h1>{isRegistering ? <>Create your<br /><em>customer account.</em></> : <>Welcome to your<br /><em>little getaway.</em></>}</h1>
        <p className="login-intro">
          {isRegistering
            ? 'Create an account to send booking inquiries and keep track of your request.'
            : 'Sign in to continue to the booking portal or your admin dashboard.'}
        </p>
        {loading ? (
          <p className="login-status">Checking your sign-in…</p>
        ) : user ? (
          <div className="signed-in-card">
            <span className="signed-in-check"><Check size={18} /></span>
            <span><b>Signed in as {user.username || user.email}</b><small>{user.role === 'ADMIN' ? 'Administrator' : 'Customer account'}</small></span>
            <a href={user.role === 'ADMIN' ? '/admin/dashboard' : '/customer/booking'}>Continue <ArrowUpRight size={14} /></a>
            <button type="button" onClick={() => logout().catch((cause: unknown) => setLogoutError(cause instanceof Error ? cause.message : 'Could not sign out.'))}>Sign out</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {isRegistering && (
              <>
                <label htmlFor="auth-full-name">Full name</label>
                <input id="auth-full-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={100} required />
                <label htmlFor="auth-email">Email</label>
                <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
              </>
            )}
            <label htmlFor="auth-username">{isRegistering ? 'Username' : 'Username or email'}</label>
            <input
              id="auth-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              maxLength={72}
              required
            />
            {isRegistering && (
              <>
                <label htmlFor="auth-confirm-password">Confirm password</label>
                <input id="auth-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} maxLength={72} required />
                <p className="auth-password-hint">Use at least 12 characters. Self-created accounts have customer access only.</p>
              </>
            )}
            {(formError || sessionError) && <p className="login-error" role="alert">{formError || sessionError}</p>}
            <button type="submit" className="auth-submit-button" disabled={submitting}>
              {submitting ? 'Please wait…' : isRegistering ? 'Create customer account' : 'Sign in'}
              {!submitting && <ArrowUpRight size={15} />}
            </button>
            <button type="button" className="account-mode-toggle" onClick={() => { setIsRegistering((current) => !current); setFormError('') }}>
              {isRegistering ? 'Already have an account? Sign in' : 'New to Tampisawan? Create your account'}
            </button>
          </form>
        )}
        {logoutError && <p className="login-error" role="alert">{logoutError}</p>}
        <div className="login-assurance">
          <ShieldCheck size={15} />
          <span>Passwords are securely hashed on the server. New accounts are always customers; only provisioned accounts can be admins.</span>
        </div>
      </section>
      <a className="login-help" href="/#my-inquiry">Already sent an inquiry? <span>Check your request <ArrowUpRight size={13} /></span></a>
    </main>
  )
}

export default AuthPage
