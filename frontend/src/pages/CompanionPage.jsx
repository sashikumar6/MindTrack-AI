import { useNavigate } from "react-router-dom";
import { CompanionCustomizer } from "./SettingsPage.jsx";

export default function CompanionPage() {
  const navigate = useNavigate();

  return (
    <div className="buddy-page">
      <div className="page-intro buddy-intro">
        <div className="page-eyebrow">Make it feel like yours</div>
        <h1>Customize Your Buddy</h1>
        <p>Choose how your companion listens, responds, and sounds.</p>
      </div>
      <CompanionCustomizer onStartCheckin={() => navigate("/voice")} />
    </div>
  );
}
