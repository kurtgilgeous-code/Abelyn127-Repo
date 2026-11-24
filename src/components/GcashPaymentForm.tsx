import { type FormEvent, useEffect, useState } from 'react'
import { ArrowRight, Download, ImageUp, Info } from 'lucide-react'
import { formatPeso } from '../utils/pricing'
import './GcashPaymentForm.css'

const QR_IMAGE = '/payment-qr.png'
const MAX_PROOF_BYTES = 5 * 1024 * 1024
const PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export type GcashProof = { reference: string; payerAccount: string; proof: File }

/** Scan or save the resort's QR, pay the exact amount, then send the screenshot for verification. */
export default function GcashPaymentForm({ amount, amountLabel, submitting, error, onSubmit }: {
  amount: number
  amountLabel: string
  submitting: boolean
  error: string
  onSubmit: (proof: GcashProof) => void
}) {
  const [qrMissing, setQrMissing] = useState(false)
  const [reference, setReference] = useState('')
  const [payerAccount, setPayerAccount] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!proof) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(proof)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [proof])

  const chooseProof = (file: File | null) => {
    if (file && !PROOF_TYPES.includes(file.type)) {
      setProof(null)
      setFormError('Upload a PNG, JPEG, or WebP screenshot.')
    } else if (file && file.size > MAX_PROOF_BYTES) {
      setProof(null)
      setFormError('The screenshot must be 5 MB or smaller.')
    } else {
      setProof(file)
      setFormError('')
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reference.trim() || !payerAccount.trim()) {
      setFormError('Enter the GCash reference number and the sender’s name or number.')
      return
    }
    if (!proof) {
      setFormError('Attach the screenshot of your GCash payment.')
      return
    }
    setFormError('')
    onSubmit({ reference: reference.trim(), payerAccount: payerAccount.trim(), proof })
  }

  const shownError = formError || error

  return (
    <form className="gcash-pay" onSubmit={submit}>
      <div className="gcash-pay-amount">
        <span>{amountLabel}</span>
        <b>{formatPeso(amount)}</b>
      </div>

      <section className="gcash-pay-qr" aria-label="Resort GCash QR code">
        {qrMissing ? (
          <p className="gcash-pay-missing" role="alert">The GCash QR code is not available right now. Please contact the resort or choose walk-in.</p>
        ) : (
          <>
            <img src={QR_IMAGE} alt="Tampisawan GCash QR code" onError={() => setQrMissing(true)} />
            <a href={QR_IMAGE} download="tampisawan-gcash-qr.png"><Download size={15} /> Save QR code</a>
          </>
        )}
      </section>

      <ol className="gcash-pay-steps">
        <li>Open GCash and scan this QR. On a phone, save it first, then upload it in GCash&apos;s QR scanner.</li>
        <li>Pay exactly <b>{formatPeso(amount)}</b>.</li>
        <li>Screenshot the receipt showing the amount and reference number, then send it below.</li>
      </ol>

      <p className="gcash-pay-priority">
        <Info size={15} aria-hidden="true" />
        <span><b>Your dates are not secured yet.</b> They stay open to everyone until the resort verifies a payment. The first verified GCash payment gets the date.</span>
      </p>

      <label htmlFor="gcash-reference">GCash reference number</label>
      <input id="gcash-reference" value={reference} maxLength={120} inputMode="numeric" autoComplete="off" onChange={(event) => setReference(event.target.value)} placeholder="From your GCash receipt" required />

      <label htmlFor="gcash-payer">Sender&apos;s GCash name or number</label>
      <input id="gcash-payer" value={payerAccount} maxLength={200} autoComplete="off" onChange={(event) => setPayerAccount(event.target.value)} placeholder="e.g. Juan D. · 0917 000 0000" required />

      <label htmlFor="gcash-proof">Payment screenshot</label>
      <label className="gcash-pay-upload" htmlFor="gcash-proof">
        {previewUrl ? <img src={previewUrl} alt="Your selected payment screenshot" /> : <ImageUp size={22} aria-hidden="true" />}
        <span>{proof ? proof.name : 'Tap to choose your screenshot'}</span>
        <small>PNG, JPEG, or WebP · up to 5 MB</small>
      </label>
      <input id="gcash-proof" className="gcash-pay-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseProof(event.target.files?.[0] ?? null)} />

      {shownError && <p className="customer-error" role="alert">{shownError}</p>}
      <button className="review-button modal-done" type="submit" disabled={submitting || qrMissing}>
        {submitting ? 'Sending your payment…' : 'Send payment for verification'} <ArrowRight size={16} />
      </button>
      <p className="form-footnote">Never share your GCash PIN, password, or OTP with anyone.</p>
    </form>
  )
}
