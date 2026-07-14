import { useEffect, useState, useRef } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase/config";
import Sidebar from "./Sidebar";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import WorkoutPlannerPage from "./WorkoutPlannerPage";
import "./styles/Chat.css";

// Firebase is kept ONLY for authentication (signOut / onAuthStateChanged).
// All chat/message/image data now lives in MongoDB via the FastAPI backend.
const BACKEND = "http://localhost:8000";

function Chat() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  // Land on the Workout Planner by default — that's the primary reason
  // someone opens the app. "Chat" is for follow-up exercise questions,
  // one click away via the topbar tab.
  const [activeView, setActiveView] = useState("planner"); // "chat" | "planner"

  // Track whether the current chat is brand-new so we can rename it
  // after the first message even when React state hasn't updated yet.
  const isNewChatRef = useRef(false);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) loadChats(user.uid);
    });
    return () => unsub();
  }, []);

  // ── LOAD CHATS ──────────────────────────────────────────────────────────
  const loadChats = async (uid) => {
    const res = await fetch(`${BACKEND}/chats/${uid}`);
    const data = await res.json();
    setChats(data);
    // Just preload the most recent chat's messages in the background —
    // don't switch views. The user should land on the Workout Planner
    // (activeView's default) after login, not get bounced into Chat.
    if (data.length > 0) openChat(data[0].id, false);
  };

  // ── CREATE CHAT ──────────────────────────────────────────────────────────
  const createChat = async () => {
    const uid = auth.currentUser.uid;
    const res = await fetch(`${BACKEND}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: uid, title: "New Chat" }),
    });
    const newChat = await res.json();

    setChats((prev) => [newChat, ...prev]);
    openChat(newChat.id);
    setActiveView("chat");
  };

  // ── OPEN CHAT ────────────────────────────────────────────────────────────
  // `switchView` defaults to true for real user actions (clicking a chat in
  // the sidebar, creating a new chat). Pass false for the silent preload
  // that happens right after login so it doesn't hijack the current view.
  const openChat = async (chatId, switchView = true) => {
    if (!chatId) return;

    setCurrentChatId(chatId);
    setMessages([]);
    isNewChatRef.current = false;
    if (switchView) setActiveView("chat");

    const res = await fetch(`${BACKEND}/messages/${chatId}`);
    const data = await res.json();

    // Messages are persisted with only the raw `exercise` object — the
    // `images` array (absolute /image/{id} URLs) is built here on read,
    // same way it's built right after a live /chat response.
    const hydrated = data.map((m) => {
      if (m.exercise && Array.isArray(m.exercise.image_urls)) {
        return {
          ...m,
          images: m.exercise.image_urls.map((u) => `${BACKEND}${u}`),
        };
      }
      return m;
    });

    setMessages(hydrated);
  };

  // ── RENAME CHAT ──────────────────────────────────────────────────────────
  const updateChatTitle = async (chatId, text) => {
    const shortTitle = text.length > 25 ? text.substring(0, 25) + "..." : text;

    await fetch(`${BACKEND}/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: shortTitle }),
    });

    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title: shortTitle } : c))
    );
  };

  // ── DELETE CHAT ──────────────────────────────────────────────────────────
  const deleteChat = async (chatId) => {
    await fetch(`${BACKEND}/chats/${chatId}`, { method: "DELETE" });

    const updated = chats.filter((c) => c.id !== chatId);
    setChats(updated);

    if (currentChatId === chatId) {
      setMessages([]);
      setCurrentChatId(null);
      if (updated.length > 0) openChat(updated[0].id, false);
    }
  };

  // ── SEND MESSAGE ─────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const uid = auth.currentUser.uid;

    if (!message.trim()) return;

    let chatId = currentChatId;

    // Create a chat if none is active
    if (!chatId) {
      const res = await fetch(`${BACKEND}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, title: "New Chat" }),
      });
      const newChat = await res.json();

      chatId = newChat.id;
      isNewChatRef.current = true;

      setCurrentChatId(chatId);
      setChats((prev) => [newChat, ...prev]);
    }

    // ── Save user text message ────────────────────────────────────────────
    const currentText = message.trim();

    const userMsg = { role: "user", text: currentText };
    setMessages((prev) => [...prev, userMsg]);
    // Note: /chat below also persists the user's query message server-side,
    // so we don't double-save it here — this just updates the UI instantly.

    setMessage("");

    if (isNewChatRef.current) {
      isNewChatRef.current = false;
      updateChatTitle(chatId, currentText);
    }

    // ── Call backend ────────────────────────────────────────────────────
    try {
      const response = await fetch(`${BACKEND}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: currentText, userId: uid, chatId }),
      });

      const data = await response.json();

      // --- Multi-exercise response (list / multi-muscle queries) ---
      if (data.exercises && Array.isArray(data.exercises) && data.exercises.length > 0) {
        const msgs = data.exercises.map((ex, i) => ({
          role: "assistant",
          exercise: ex,
          exerciseIndex: i,
          images: (ex.image_urls || []).map((u) => `${BACKEND}${u}`),
        }));
        setMessages((prev) => [...prev, ...msgs]);

        // --- Single exercise response ---
      } else if (data.exercise && data.exercise.exercise_name) {
        const botMsg = {
          role: "assistant",
          exercise: data.exercise,
          images: (data.exercise.image_urls || []).map((u) => `${BACKEND}${u}`),
        };
        setMessages((prev) => [...prev, botMsg]);

        // --- Plain text answer (errors, "no exercise found", etc.) ---
      } else {
        const botMsg = {
          role: "assistant",
          text: data.answer || "No exercise found for your query.",
        };
        setMessages((prev) => [...prev, botMsg]);
      }
      // Note: /chat already persisted the assistant message(s) to MongoDB,
      // so no extra save call is needed here — just updating local UI state.

    } catch (error) {
      console.error("Backend error:", error);

      const errorMsg = {
        role: "assistant",
        text: "⚠️ Backend error. Make sure the FastAPI server is running on port 8000.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  // ── HANDLERS ─────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/";
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  // Topbar now lives OUTSIDE .chat-container, as a full-width bar above
  // everything else. This is the key fix: previously it lived inside
  // .chat-main, so its available width — and therefore the "center" of
  // the tab pill — shrank whenever the 280px sidebar was mounted. Now the
  // topbar always spans the entire viewport width, so the tabs are always
  // centered on the real page, whether the sidebar is open, closed, or
  // not rendered at all (planner view).
  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-side">
          {activeView === "chat" && (
            <button
              className="sidebar-toggle"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              ☰
            </button>
          )}
        </div>

        <div className="topbar-center">
          <div className="view-tabs">
            <button
              className={`view-tab ${activeView === "planner" ? "view-tab-active" : ""}`}
              onClick={() => setActiveView("planner")}
            >
              Workout Planner
            </button>
            <button
              className={`view-tab ${activeView === "chat" ? "view-tab-active" : ""}`}
              onClick={() => setActiveView("chat")}
            >
              Chat
            </button>
          </div>
        </div>

        <div className="topbar-side topbar-side-right">
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>

      <div className="chat-container">
        {activeView === "chat" && (
          <Sidebar
            chats={chats}
            createChat={createChat}
            openChat={openChat}
            deleteChat={deleteChat}
            activeChatId={currentChatId}
            showSidebar={showSidebar}
          />
        )}

        <div className="chat-main">
          {activeView === "chat" ? (
            <>
              <div className="messages">
                {messages.length === 0 && (
                  <div className="empty">Ask about any exercise — form, sets, muscles worked...</div>
                )}
                {messages.map((m, i) => (
                  <MessageBubble
                    key={i}
                    role={m.role}
                    text={m.text}
                    exercise={m.exercise}
                    exerciseIndex={m.exerciseIndex}
                    fileUrl={m.fileUrl}
                    fileName={m.fileName}
                    isFile={m.isFile}
                    images={m.images || []}
                  />
                ))}
              </div>

              <ChatInput
                message={message}
                setMessage={setMessage}
                sendMessage={sendMessage}
              />
            </>
          ) : (
            <WorkoutPlannerPage userId={auth.currentUser.uid} backendUrl={BACKEND} />
          )}
        </div>
      </div>
    </div>
  );
}

export default Chat;
