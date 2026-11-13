import { useState } from "react";
import { changePassword } from "../lib/api.js";

const MIN_PASSWORD = 12;

/** Change the signed-in user's password. Other sessions are revoked by the server. */
export default function AccountPanel() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const field = (name) => ({
    value: form[name],
    onChange: (event) => setForm((prev) => ({ ...prev, [name]: event.target.value })),
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (form.newPassword.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for the new password.`);
      return;
    }
    if (form.newPassword !== form.confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setNotice("Password changed. Other sessions were signed out.");
    } catch (err) {
      if (err.status === 401) setError("The current password is incorrect.");
      else if (err.status === 429) {
        const minutes = err.retryAfter ? Math.ceil(err.retryAfter / 60) : null;
        setError(minutes ? `Too many attempts. Try again in ${minutes} min.` : "Too many attempts. Try again later.");
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid max-w-md gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-1.5">
        <span className="field-label">Current password</span>
        <input className="input w-full" type="password" autoComplete="current-password" required {...field("currentPassword")} />
      </label>
      <label className="grid gap-1.5">
        <span className="field-label">New password</span>
        <input className="input w-full" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required {...field("newPassword")} />
      </label>
      <label className="grid gap-1.5">
        <span className="field-label">Confirm new password</span>
        <input className="input w-full" type="password" autoComplete="new-password" required {...field("confirm")} />
      </label>
      {error && <div role="alert" className="alert alert-error"><span>{error}</span></div>}
      {notice && <div role="status" className="alert alert-success"><span>{notice}</span></div>}
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : null}
          Change password
        </button>
      </div>
    </form>
  );
}
