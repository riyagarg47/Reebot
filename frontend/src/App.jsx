import { useEffect, useState } from "react";
import { api, setToken, getToken } from "./api.js";
import AuthScreen from "./AuthScreen.jsx";
import Dashboard from "./Dashboard.jsx";

function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(() => Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setToken(""))
      .finally(() => setBooting(false));
  }, []);

  function handleAuthed(data) {
    setToken(data.token);
    setUser(data.user);
  }

  function handleLogout() {
    setToken("");
    setUser(null);
  }

  if (booting) {
    return (
      <div className="auth-wrap">
        <div className="boot-spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  return <Dashboard user={user} onLogout={handleLogout} />;
}

export default App;
