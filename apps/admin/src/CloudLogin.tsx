import { useEffect, useState, type FormEvent } from "react";
import * as cloud from "./studio/cloud";

function safeReturnPath() {
  const value = new URLSearchParams(window.location.search).get("return") || "";
  return value.startsWith("/3Dprojects") && !value.startsWith("//")
    ? value
    : "/3Dprojects/studio";
}

export default function CloudLogin() {
  const [status, setStatus] = useState<cloud.CloudSession>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void cloud
      .session()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        if (next.authenticated) window.location.replace(safeReturnPath());
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Engine Admin status could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await cloud.login(email, password);
      window.location.replace(safeReturnPath());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cloud-login-shell">
      <section className="cloud-login-card">
        <a className="cloud-login-brand" href="/3Dprojects">
          <span>R</span>
          <div>
            <b>REKIXO</b>
            <small>3D ENGINE ADMIN</small>
          </div>
        </a>
        <p className="eyebrow">PRIVATE CLOUD WORKSPACE</p>
        <h1>Sign in to Engine Studio</h1>
        <p>
          Cloud project creation, draft sync and project assets use a dedicated
          Engine Admin session. Local browser drafts remain separate.
        </p>

        {status && !status.configured ? (
          <div className="alert">
            <strong>Engine Admin is locked</strong>
            <span>
              Dedicated Engine Admin credentials have not been provisioned.
              No default password is enabled.
            </span>
          </div>
        ) : status && !status.databaseReady ? (
          <div className="alert">
            <strong>Cloud schema is not ready</strong>
            <span>
              Apply the Engine Studio cloud migration before enabling sign-in.
            </span>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Admin email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy || !status}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {error && <div className="studio-feedback error" role="alert">{error}</div>}
        <a className="cloud-login-back" href="/3Dprojects/studio">
          Continue with local/offline Studio
        </a>
      </section>
    </main>
  );
}
