import { useEffect, useState } from "react";
import ThemePicker, { useTheme } from "./ThemePicker.jsx";
import { api } from "./api.js";
import RoomView from "./RoomView.jsx";

const ROOM_QUERY_KEY = "room";

function roomIdFromUrl() {
  return new URLSearchParams(window.location.search).get(ROOM_QUERY_KEY) || "";
}

function updateRoomUrl(roomId, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set(ROOM_QUERY_KEY, roomId);
  else url.searchParams.delete(ROOM_QUERY_KEY);

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Dashboard({ user, onLogout }) {
  const [theme, setTheme] = useTheme();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [openRoomId, setOpenRoomId] = useState(roomIdFromUrl);

  // Keep the selected room synchronized with browser Back and Forward actions.
  useEffect(() => {
    function handlePopState() {
      setOpenRoomId(roomIdFromUrl());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/rooms")
      .then((data) => {
        if (cancelled) return;
        const roomList = data.rooms || [];
        setRooms(roomList);

        // Remove stale room links when a room was deleted or is not owned by
        // the current user.
        if (openRoomId && !roomList.some((room) => room.id === openRoomId)) {
          setOpenRoomId("");
          updateRoomUrl("", { replace: true });
        }
      })
      .catch((err) => {
        if (err.status === 401) logout();
        else window.alert(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openRoom = rooms.find((room) => room.id === openRoomId);

  function enterRoom(roomId) {
    setOpenRoomId(roomId);
    updateRoomUrl(roomId);
  }

  function leaveRoom() {
    setOpenRoomId("");
    updateRoomUrl("");
  }

  function logout() {
    setOpenRoomId("");
    updateRoomUrl("", { replace: true });
    onLogout();
  }

  if (loading && openRoomId) {
    return (
      <div className="auth-wrap">
        <div className="boot-spinner" aria-label="Loading room" />
      </div>
    );
  }

  async function createRoom(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;

    setCreating(true);
    try {
      const data = await api("/rooms", { method: "POST", body: { name } });
      setRooms((current) => [data.room, ...current]);
      setNewName("");
    } catch (err) {
      window.alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteRoom(room) {
    if (
      !window.confirm(
        `Delete "${room.name}"? Its files, URLs and chat will be removed.`
      )
    ) {
      return;
    }

    try {
      await api(`/rooms/${room.id}`, { method: "DELETE" });
      setRooms((current) => current.filter((item) => item.id !== room.id));
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (openRoom) {
    return (
      <RoomView
        roomId={openRoom.id}
        roomName={openRoom.name}
        theme={theme}
        onThemeChange={setTheme}
        onBack={leaveRoom}
        onLogout={logout}
      />
    );
  }

  const firstName = user.name.split(" ")[0];

  return (
    <div className="dash-wrap">
      <header className="dash-header">
        <div className="brand">
          <span className="logo-mark" aria-hidden="true" />
          <h1>Reebot</h1>
        </div>
        <div className="header-actions">
          <ThemePicker theme={theme} onChange={setTheme} />
          <span className="user-chip" title={user.email}>
            {user.name}
          </span>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-heading">
          <h2>Welcome, {firstName}</h2>
          <p>Your discussion rooms. Each one keeps its own sources and chat.</p>
        </div>

        <div className="room-grid">
          <form className="new-room-card" onSubmit={createRoom}>
            <span className="plus" aria-hidden="true">+</span>
            <label className="sr-only" htmlFor="new-room-name">New room name</label>
            <input
              id="new-room-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New room name…"
              disabled={creating}
              maxLength={40}
            />
            <div className="new-room-meta">
              <span className="hint-sm">Max 40 characters</span>
              <span className={`char-count ${newName.length >= 40 ? "limit" : ""}`}>
                {newName.length}/40
              </span>
            </div>
            <button
              className="btn btn-primary btn-sm"
              disabled={creating || !newName.trim()}
            >
              Create
            </button>
          </form>

          {!loading &&
            rooms.map((room) => (
              <article key={room.id} className="dash-card">
                <button
                  type="button"
                  className="card-open"
                  onClick={() => enterRoom(room.id)}
                >
                  <h3>{room.name}</h3>
                  <p className="card-meta">
                    {room.sourceCount}{" "}
                    {room.sourceCount === 1 ? "source" : "sources"}
                    <span aria-hidden="true"> · </span>
                    {formatDate(room.createdAt)}
                  </p>
                  <span className="card-cta">Open room →</span>
                </button>
                <button
                  type="button"
                  className="icon-btn card-delete"
                  onClick={() => deleteRoom(room)}
                  aria-label={`Delete ${room.name}`}
                >
                  ×
                </button>
              </article>
            ))}
        </div>

        {!loading && rooms.length === 0 && (
          <p className="empty-note">
            No rooms yet — name one above and press Create.
          </p>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
