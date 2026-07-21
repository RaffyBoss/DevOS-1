import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Loader, AlertCircle, ArrowRight, Shield } from "lucide-react";
import useStore from "../../store/useStore";
import { login, syncSupabaseSession } from "../../services/api";
import { supabase } from "../../services/supabase";
import "./LoginScreen.css";

/* ── Animated particle canvas ─────────────────────────────── */
function ParticleField() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.8 + 0.4,
      a: Math.random() * 0.5 + 0.2,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 179, 237, ${p.a})`;
        ctx.fill();
        // draw connections
        for (const q of particles) {
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(99, 179, 237, ${0.08 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const cleanup = init();
    return () => cleanup?.();
  }, [init]);

  return <canvas ref={canvasRef} className="login-particle-canvas" aria-hidden="true" />;
}

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef(null);
  const setUser = useStore((s) => s.setUser);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  // security-audit P2c: Supabase-primary with local fallback, per the
  // architecture decision made for this task. "username" doubles as an
  // email address when Supabase is configured, since Supabase's password
  // grant authenticates by email — the field/label stays "Username" so the
  // local-auth path (which really does use a username) still reads
  // correctly, and a local username that happens to look like an email
  // works fine either way.
  //
  // Order of attempts:
  //   1. If a Supabase client is configured (REACT_APP_SUPABASE_URL/
  //      REACT_APP_SUPABASE_ANON_KEY set at build time), try
  //      supabase.auth.signInWithPassword() first. On success, tell the
  //      backend about this identity via POST /api/auth/supabase/sync so a
  //      local User row exists before any other endpoint is called, then
  //      populate the store from that response.
  //   2. If Supabase isn't configured, or the Supabase sign-in fails (e.g.
  //      this is actually a local-only account, or wrong credentials),
  //      fall back to the local username/password login() — this preserves
  //      the original all-local behavior for installs that never set up
  //      Supabase, and for local admin accounts on installs that did.
  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter both a username and password.");
      return;
    }
    setSubmitting(true);
    setError(null);

    if (supabase) {
      try {
        const { data, error: supaErr } = await supabase.auth.signInWithPassword({
          email: username.trim(),
          password,
        });
        if (supaErr) throw supaErr;
        if (data?.session) {
          const user = await syncSupabaseSession();
          setUser(user);
          return;
        }
      } catch (err) {
        // Fall through to local auth below — a Supabase failure (wrong
        // password, account doesn't exist in Supabase, Supabase outage)
        // shouldn't block a valid local account from signing in.
      }
    }

    try {
      const user = await login(username.trim(), password);
      setUser(user);
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <ParticleField />
      {/* Subtle ambient background */}
      <div className="login-ambient">
        <div className="login-ambient-orb" />
        <div className="login-ambient-orb secondary" />
        <div className="login-ambient-orb tertiary" />
      </div>

      <form className="login-card" onSubmit={handleSubmit} aria-label="Sign in to DevOS">
        <div className="login-brand">
          <div className="login-mark">
            <Sparkles size={22} />
          </div>
          <div className="login-wordmark">
            <span className="login-wordmark-name">DevOS</span>
            <span className="login-wordmark-version">v4</span>
          </div>
        </div>

        <p className="login-subtitle">
          Your autonomous engineering team,<br />powered by 230+ specialized AI agents
        </p>

        <div className="login-fields">
          <label className="login-field">
            <span className="login-field-label">Username</span>
            <input
              ref={usernameRef}
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              placeholder="admin"
              required
            />
          </label>

          <label className="login-field">
            <span className="login-field-label">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              placeholder="••••••••"
              required
            />
          </label>
        </div>

        {error && (
          <div className="login-error" role="alert" aria-live="polite">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="login-submit" disabled={submitting}>
          {submitting ? (
            <><Loader size={15} className="spin-slow" /> Authenticating&hellip;</>
          ) : (
            <>Sign in <ArrowRight size={15} /></>
          )}
        </button>

        <div className="login-footer">
          <Shield size={11} />
          <span>End-to-end encrypted &middot; UCIP-governed &middot; Sandboxed execution</span>
        </div>
      </form>
    </div>
  );
}
