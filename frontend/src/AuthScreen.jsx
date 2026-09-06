import { useState } from "react";
import ThemePicker, { useTheme } from "./ThemePicker.jsx";
import { api } from "./api.js";

const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /[0-9]/.test(p) },
  {
    label: "A special character (!@#$…)",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

function AuthScreen({ onAuthed }) {
  const [theme, setTheme] = useTheme();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const pwChecks = PASSWORD_RULES.map((rule) => ({
    ...rule,
    ok: rule.test(password),
  }));
  const pwValid = pwChecks.every((check) => check.ok);

  function switchMode(next) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirm("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    if (mode === "signup" || mode === "forgot") {
      if (!pwValid) {
        setError("Please satisfy all password requirements below.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "forgot") {
        await api("/auth/reset-password", {
          method: "POST",
          body: { email, password },
        });
        switchMode("login");
        setNotice("Password updated. Log in with your new password.");
        return;
      }

      const body =
        mode === "signup" ? { name, email, password } : { email, password };
      const data = await api(`/auth/${mode}`, {
        method: "POST",
        body,
      });
      onAuthed(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-theme">
        <ThemePicker theme={theme} onChange={setTheme} />
      </div>

      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="logo-mark" aria-hidden="true" />
          <h1>Reebot</h1>
        </div>
        <p className="auth-tagline">
          {mode === "login"
            ? "Welcome. Your rooms are waiting."
            : mode === "signup"
              ? "Create an account and build your first room."
              : "Enter your email and choose a new password."}
        </p>

        {mode !== "forgot" && (
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "active" : ""}
              onClick={() => switchMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              Sign up
            </button>
          </div>
        )}

        {mode === "signup" && (
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
              required
            />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        <label className="field">
          <span>{mode === "forgot" ? "New password" : "Password"}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              mode === "login" ? "Your password" : "Create a strong password"
            }
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </label>

        {(mode === "signup" || mode === "forgot") && (
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
              required
            />
          </label>
        )}

        {(mode === "signup" || mode === "forgot") && password.length > 0 && (
          <ul className="pw-rules">
            {pwChecks.map((check) => (
              <li key={check.label} className={check.ok ? "ok" : ""}>
                {check.ok ? "✓" : "○"} {check.label}
              </li>
            ))}
          </ul>
        )}

        {notice && <p className="form-notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Log in"
              : mode === "signup"
                ? "Create account"
                : "Update password"}
        </button>

        {mode === "login" && (
          <button
            type="button"
            className="auth-forgot"
            onClick={() => switchMode("forgot")}
          >
            Forgot password?
          </button>
        )}

        {mode === "forgot" && (
          <button
            type="button"
            className="auth-forgot"
            onClick={() => switchMode("login")}
          >
            Back to log in
          </button>
        )}
      </form>
    </div>
  );
}

export default AuthScreen;
