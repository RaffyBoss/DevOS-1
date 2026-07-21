import React, { Suspense, lazy, useEffect, useCallback } from "react";
import useStore from "./store/useStore";
import { ThemeRoot } from "./components/layout/ThemeRoot";
import { api, verifySession, subscribeToEvents } from "./services/api";
import LoginScreen from "./components/auth/LoginScreen";
import ErrorBoundary from "./components/ErrorBoundary";

import GlobalSidebar from "./components/layout/GlobalSidebar";
import RightDock from "./components/layout/RightDock";

const AutomationHub = lazy(() => import("./components/automation/AutomationHub"));
const FileTreeWrapper = lazy(() => import("./components/automation/FileTreeWrapper"));
const ChatSidebar = lazy(() => import("./components/sidebar/ChatSidebar"));
const TerminalPanel = lazy(() => import("./components/terminal/TerminalPanel"));
const GitPanel = lazy(() => import("./components/sidebar/GitPanel"));
const WorkersPanel = lazy(() => import("./components/workers/WorkersPanel"));
const SettingsModal = lazy(() => import("./components/settings/SettingsModal"));
const CmdKModal = lazy(() => import("./components/editor/CmdKModal"));
const CommandPalette = lazy(() => import("./components/editor/CommandPalette"));

const Spin = () => (
  <div className="flex items-center justify-center h-full text-slate-400 text-xs">
    Loading...
  </div>
);

function CenterWorkspace() {
  const { activeView, setActiveView } = useStore();

  return (
    <main className="flex-1 min-w-0 flex flex-col h-full bg-obsidian-950/60 obsidian-grid relative overflow-hidden">
      <div className="h-10 flex items-center justify-between px-4 border-b border-white/[0.08] glass z-10">
        <h1 className="text-sm font-semibold tracking-wide text-slate-200">
          {activeView === "automation" && "Automation Switcher"}
          {activeView === "files" && "Explorer"}
          {activeView === "chat" && "Conversation"}
          {activeView === "terminal" && "Terminal"}
          {activeView === "git" && "Source Control"}
          {activeView === "workers" && "Agent Workers"}
        </h1>
        {activeView !== "automation" && (
          <button
            onClick={() => setActiveView("automation")}
            className="text-xs px-3 py-1.5 rounded-md bg-white/[0.06] text-slate-300 hover:bg-white/[0.10] transition"
          >
            ← Back to Flow
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <Suspense fallback={<Spin />}>
          {activeView === "automation" && <AutomationHub />}
          {activeView === "files" && <FileTreeWrapper title="Project Files" />}
          {activeView === "chat" && <ChatSidebar />}
          {activeView === "terminal" && <TerminalPanel />}
          {activeView === "git" && <GitPanel />}
          {activeView === "workers" && <WorkersPanel />}
        </Suspense>
      </div>
    </main>
  );
}

function HitlApprovalToasts() {
  const { pendingHitlRequests, removePendingHitlRequest, setStatus } = useStore();
  if (!pendingHitlRequests?.length) return null;

  const handleApprove = async (reqId) => {
    try {
      await api.approveHitl(reqId);
      setStatus("HITL approved");
      removePendingHitlRequest(reqId);
    } catch (e) {
      setStatus(`Approval failed: ${e.message}`);
    }
  };
  const handleDeny = async (reqId) => {
    try {
      await api.denyHitl(reqId);
      setStatus("HITL denied");
      removePendingHitlRequest(reqId);
    } catch (e) {
      setStatus(`Denial failed: ${e.message}`);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 max-w-sm">
      {pendingHitlRequests.map((req) => (
        <div key={req.id} className="glass-panel p-4 border-l-4 border-l-mint-400">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-100">
            <span className="text-mint-400">⚡</span> Human Approval Required
          </div>
          <div className="text-xs text-slate-300 mb-3 leading-relaxed">{req.description}</div>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => handleDeny(req.id)}
              className="px-3 py-1.5 rounded-md bg-white/[0.06] text-slate-300 text-xs hover:bg-white/[0.10]"
            >
              Deny
            </button>
            <button
              onClick={() => handleApprove(req.id)}
              className="px-3 py-1.5 rounded-md bg-mint-500 text-obsidian-900 text-xs font-semibold hover:bg-mint-400"
            >
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const {
    setFileTree, setProviders, setProvider, setWorkspaceSettings,
    setIndexStats, setGitStatus,
    setUser, setStatus,
    setChatOpen, setSettingsOpen, setTerminalOpen, setPaletteOpen,
    isAuthenticated, authChecked, theme,
  } = useStore();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    verifySession().then((user) => setUser(user));
  }, [setUser]);

  const { addPendingHitlRequest, removePendingHitlRequest } = useStore();
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribeToEvents(
      (event) => {
        if (event.type === "hitl.pending") addPendingHitlRequest(event.data);
        else if (["hitl.resolved", "hitl.deny", "hitl.approve"].includes(event.type)) {
          removePendingHitlRequest(event.data.id || event.data);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [isAuthenticated, addPendingHitlRequest, removePendingHitlRequest]);

  useEffect(() => {
    if (!isAuthenticated) return;
    api.getProviders().then((p) => {
      setProviders(p);
      if (!localStorage.getItem("devos_provider")) {
        const first = Object.entries(p).find(([, v]) => v.configured);
        if (first) setProvider(first[0]);
      }
    }).catch(() => useStore.getState().setStatus("⚠️ Backend offline — start the server"));

    api.getTree().then(({ tree }) => setFileTree(tree || [])).catch(() => {});
    api.getIndexStatus().then(setIndexStats).catch(() => {});
    api.getSettings().then((s) => setWorkspaceSettings(s)).catch(() => {});
    api.gitStatus().then(setGitStatus).catch(() => {});
  }, [isAuthenticated, setFileTree, setProviders, setProvider, setWorkspaceSettings, setIndexStats, setGitStatus]);

  useEffect(() => {
    const wsBase = process.env.REACT_APP_DEVOS_URL
      ? process.env.REACT_APP_DEVOS_URL.replace(/^http/, "ws")
      : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}?type=filewatcher`);
    ws.onmessage = () => api.getTree().then(({ tree }) => setFileTree(tree || [])).catch(() => {});
    ws.onerror = () => {};
    return () => ws.close();
  }, [setFileTree]);

  const handleKey = useCallback((e) => {
    const mod = e.ctrlKey || e.metaKey;
    const { terminalOpen, chatOpen } = useStore.getState();
    if (mod && e.key === "p" && !e.shiftKey) { e.preventDefault(); setPaletteOpen(true); }
    if (mod && e.key === "`") { e.preventDefault(); setTerminalOpen(!terminalOpen); }
    if (mod && e.shiftKey && e.key === "L") { e.preventDefault(); setChatOpen(!chatOpen); }
    if (mod && e.key === ",") { e.preventDefault(); setSettingsOpen(true); }
  }, [setChatOpen, setSettingsOpen, setTerminalOpen, setPaletteOpen]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!authChecked) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-obsidian-950 text-slate-300">
        <Spin />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {!isAuthenticated ? (
        <ThemeRoot>
          <LoginScreen />
        </ThemeRoot>
      ) : (
        <ThemeRoot>
          <div className="h-screen w-screen flex bg-obsidian-950 overflow-hidden text-slate-200">
          <GlobalSidebar />
          <CenterWorkspace />
          <RightDock />
          <HitlApprovalToasts />
          <Suspense fallback={null}>
            <SettingsModal />
            <CmdKModal />
            <CommandPalette />
          </Suspense>
          </div>
        </ThemeRoot>
      )}
    </ErrorBoundary>
  );
}
