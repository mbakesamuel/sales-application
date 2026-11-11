import logoSrc from "../../assets/logo.svg";
import welcomeSrc from "../../assets/bg-img.jpg";
import "./WelcomeScreen.css";

interface WelcomeScreenProps {
  onContinue: () => void;
}

export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  return (
    <main class="auth-screen auth-screen--welcome">
      <div
        class="auth-welcome-bg"
        aria-hidden="true"
        style={{ backgroundImage: `url(${welcomeSrc})` }}
      />
      <div class="auth-welcome-wash" aria-hidden="true" />
      <div class="auth-welcome-content">
        <div class="auth-brand">
          <img class="auth-logo" src={logoSrc} alt="" />
          <p class="auth-company">Sales Management Application</p>
        </div>
        <button type="button" class="auth-link" onClick={onContinue}>
          Login
        </button>
      </div>
    </main>
  );
}
