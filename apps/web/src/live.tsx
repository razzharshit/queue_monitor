import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "./auth.js";
import { webEnvironment } from "./env.js";
import type { EventType } from "./types.js";

interface AcceptedBatch {
  environmentId: string;
  events: Array<{ eventId: string; traceId: string | null; type: EventType }>;
  acceptedAt: string;
}

interface LiveContextValue {
  connected: boolean;
  version: number;
  lastBatch: AcceptedBatch | null;
}

const LiveContext = createContext<LiveContextValue>({ connected: false, version: 0, lastBatch: null });

export function LiveProvider({ children }: { children: ReactNode }) {
  const { auth, environment } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const [lastBatch, setLastBatch] = useState<AcceptedBatch | null>(null);

  useEffect(() => {
    if (!auth) return;
    const next = io(webEnvironment.apiUrl || undefined, { path: "/socket.io", withCredentials: true });
    setSocket(next);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onAccepted = (batch: AcceptedBatch) => {
      setLastBatch(batch);
      setVersion((value) => value + 1);
    };
    next.on("connect", onConnect);
    next.on("disconnect", onDisconnect);
    next.on("events:accepted", onAccepted);
    return () => {
      next.off("connect", onConnect);
      next.off("disconnect", onDisconnect);
      next.off("events:accepted", onAccepted);
      next.close();
      setSocket(null);
      setConnected(false);
    };
  }, [auth]);

  useEffect(() => {
    if (socket?.connected && environment) socket.emit("environment:subscribe", environment.id);
  }, [environment, socket, connected]);

  const value = useMemo(() => ({ connected, version, lastBatch }), [connected, version, lastBatch]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}
