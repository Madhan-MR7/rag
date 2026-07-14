import { useState } from "react";
import "./styles/Login.css";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";

import { auth } from "./firebase/config";
import { useNavigate } from "react-router-dom";

// Simple inline SVG icons — no icon library dependency needed.
// "Eye" = password is currently hidden, click to reveal.
// "EyeOff" = password is currently visible, click to hide.
function EyeIcon(props) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(props) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 8 11 8a17.5 17.5 0 0 1-2.16 3.19m-3.13 2.4A10.45 10.45 0 0 1 12 19c-7 0-11-8-11-8a17.5 17.5 0 0 1 4.22-5.94" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function Login() {
  const navigate = useNavigate();

  const [isLogin, setIsLogin] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      navigate("/chat");
    } catch (error) {
      alert(error.message);
    }
  };

  const handleSignup = async () => {
    try {
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      alert("Account Created Successfully");

      navigate("/chat");

    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="login-page">

      <div className="login-card">

        <h1 className="auth-title">
          FitGPT
        </h1>

        <p className="auth-subtitle">
          {isLogin
            ? "Welcome back to your AI Fitness Assistant"
            : "Create your FitGPT account"}
        </p>

        <input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
        />

        <div className="password-field">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {isLogin ? (
          <>
            <button
              className="primary-btn"
              onClick={handleLogin}
            >
              Login
            </button>

            <p className="switch-text">
              Don't have an account?{" "}
              <span
                onClick={() =>
                  setIsLogin(false)
                }
              >
                Sign Up
              </span>
            </p>
          </>
        ) : (
          <>
            <button
              className="primary-btn"
              onClick={handleSignup}
            >
              Create Account
            </button>

            <p className="switch-text">
              Already have an account?{" "}
              <span
                onClick={() =>
                  setIsLogin(true)
                }
              >
                Login
              </span>
            </p>
          </>
        )}

      </div>

    </div>
  );
}

export default Login;
