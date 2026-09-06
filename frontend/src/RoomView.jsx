import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import ThemePicker from "./ThemePicker.jsx";
import { api, authedFetch } from "./api.js";

function FilePlusIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function RoomView({
  roomId,
  roomName,
  theme,
  onThemeChange,
  onBack,
  onLogout,
}) {
  const fileInputRef = useRef(null);
  const transcriptRef = useRef(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState([]);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);

  useLayoutEffect(() => {
    const panel = transcriptRef.current;
    if (!panel) return;
    panel.scrollTop = panel.scrollHeight;
  }, [messages, busy]);

  function guardAuth(error) {
    if (error.status === 401) onLogout();
    else window.alert(error.message);
  }

  useEffect(() => {
    let cancelled = false;
    api(`/rooms/${roomId}`)
      .then((data) => {
        if (cancelled) return;
        const roomSources = (data.sources || []).map((source) => ({
          id: source.id,
          type: source.type,
          name: source.name,
        }));
        setSources(roomSources);
        setMessages(
          (data.messages || []).map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
          }))
        );
      })
      .catch(guardAuth);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  function notifyDuplicates(duplicates) {
    if (!duplicates?.length) return;
    const list = duplicates.join(", ");
    window.alert(
      duplicates.length === 1
        ? `Skipped "${list}" — it's already in this room.`
        : `Skipped duplicates: ${list}`
    );
  }

  async function addPdfs(fileList) {
    const files = Array.from(fileList || []).filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length === 0 || ingestBusy) return;

    const form = new FormData();
    form.append("roomId", roomId);
    files.forEach((file) => form.append("pdfs", file));

    setIngestBusy(true);
    try {
      const data = await api("/ingest", { method: "POST", form });
      if (data.saved.length > 0) {
        const savedSources = data.saved.map((item) => ({
          id: item.sourceId,
          type: item.type,
          name: item.name,
        }));
        setSources((current) => [
          ...current,
          ...savedSources,
        ]);
      }
      notifyDuplicates(data.duplicates);
    } catch (error) {
      guardAuth(error);
    } finally {
      setIngestBusy(false);
    }
  }

  async function addUrl(event) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || ingestBusy) return;

    const form = new FormData();
    form.append("roomId", roomId);
    form.append("url", trimmed);

    setIngestBusy(true);
    try {
      const data = await api("/ingest", { method: "POST", form });
      if (data.saved.length > 0) {
        const savedSource = {
          id: data.saved[0].sourceId,
          type: "url",
          name: trimmed,
        };
        setSources((current) => [
          ...current,
          savedSource,
        ]);
        setUrl("");
        setUrlOpen(false);
      }
      notifyDuplicates(data.duplicates);
    } catch (error) {
      guardAuth(error);
    } finally {
      setIngestBusy(false);
    }
  }

  async function removeSource(source) {
    try {
      await api("/ingest", {
        method: "DELETE",
        body: { sourceId: source.id, roomId },
      });
      setSources((current) => current.filter((item) => item.id !== source.id));
    } catch (error) {
      guardAuth(error);
    }
  }

  async function sendChat(event) {
    event.preventDefault();
    const text = query.trim();
    if (!text || busy || sources.length === 0) return;

    const botId = crypto.randomUUID();

    setQuery("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text },
      { id: botId, role: "assistant", text: "" },
    ]);

    try {
      const res = await authedFetch("/chat", {
        method: "POST",
        body: { query: text, roomId },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          onLogout();
          return;
        }
        throw new Error(data.error || "Could not get an answer.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const piece = decoder.decode(value, { stream: true });
        if (!piece) continue;
        setMessages((current) =>
          current.map((item) =>
            item.id === botId ? { ...item, text: item.text + piece } : item
          )
        );
      }
    } catch (error) {
      setMessages((current) =>
        current.map((item) =>
          item.id === botId ? { ...item, text: error.message } : item
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="room-wrap">
      <header className="dash-header">
        <div className="header-left">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Rooms
          </button>
          <h1 className="room-title" title={roomName}>
            {roomName}
          </h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={`icon-btn-top ${ingestBusy ? "spin" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={ingestBusy}
            title="Upload PDFs"
            aria-label="Upload PDFs"
          >
            <FilePlusIcon />
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => {
              addPdfs(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`icon-btn-top ${urlOpen ? "active" : ""}`}
            onClick={() => setUrlOpen((open) => !open)}
            disabled={ingestBusy}
            title="Add a website link"
            aria-label="Add a website link"
            aria-expanded={urlOpen}
          >
            <LinkIcon />
          </button>
          <ThemePicker theme={theme} onChange={onThemeChange} />
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      {urlOpen && (
        <form className="url-pop" onSubmit={addUrl}>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a website URL — https://example.com/article"
            disabled={ingestBusy}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={ingestBusy}>
            Add
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setUrlOpen(false);
              setUrl("");
            }}
          >
            Cancel
          </button>
        </form>
      )}

      <div className="workspace">
        <aside className="sources-panel">
          <div className="panel-head">
            <h2>Sources</h2>
            <span className="count">{sources.length}</span>
          </div>

          <ul className="source-list">
            {sources.length === 0 ? (
              <li className="empty-source">
                No sources yet.
                <br />
                Use the icons in the top bar to add PDFs or a website — this
                room answers only from what you add here.
              </li>
            ) : (
              sources.map((source) => (
                <li key={source.id} className="source-card">
                  <span className={`badge ${source.type}`}>
                    {source.type === "pdf" ? "PDF" : "WEB"}
                  </span>
                  <span className="source-name" title={source.name}>
                    {source.name}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeSource(source)}
                    aria-label={`Remove ${source.name}`}
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className="chat-panel">
          <div className="transcript" ref={transcriptRef}>
            {messages.length === 0 ? (
              <div className="empty-chat">
                <p className="neon-title">Ask your notebook</p>
                <p>
                  Reebot answers only from this room's sources. Add some from
                  the top bar, then ask anything about them.
                </p>
              </div>
            ) : (
              <>
                <div className="transcript-spacer" aria-hidden="true" />
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`bubble ${message.role}`}
                  >
                    <span className="who">
                      {message.role === "user" ? "You" : "Reebot"}
                    </span>
                    {message.role === "assistant" ? (
                      <div className="markdown">
                        <Markdown>{message.text}</Markdown>
                      </div>
                    ) : (
                      <p className="user-text">{message.text}</p>
                    )}
                  </article>
                ))}
                {busy ? <p className="typing">Reebot is thinking…</p> : null}
              </>
            )}
          </div>

          <form className="composer" onSubmit={sendChat}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about this room's sources"
              disabled={busy}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !query.trim() || sources.length === 0}
            >
              Send
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default RoomView;
