// server.js
// Robust WebRTC signaling server for one broadcaster + many listeners
// - safe sends (prevents crashes when sockets are closed)
// - explicit upgrade handling for ws
// - ping/pong heartbeat to remove dead clients
// - forwards offer -> specific listener, answer -> broadcaster, ICE both directions

import http from "http";
import { WebSocketServer } from "ws";
import { randomBytes } from "crypto";

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// --- HTTP server (simple health endpoint) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC Signaling Server Running\n");
});

// --- WebSocket server attached to the HTTP server ---
const wss = new WebSocketServer({ noServer: true });

// Single broadcaster (the ws object)
let broadcaster = null;

// Many listeners: id -> { ws, createdAt }
const listeners = new Map();

// helper: generate short unique id for a listener
function genId() {
    return randomBytes(4).toString("hex");
}

// Safe send wrapper (never throws to caller)
function safeSend(ws, obj) {
    if (!ws || ws.readyState !== 1) return false;
    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch (err) {
        console.warn("safeSend failed:", err?.message || err);
        return false;
    }
}

// Heartbeat (ping/pong) — remove dead clients
function heartbeat() {
    for (const [id, info] of listeners) {
        const { ws, alive } = info;
        if (!alive) {
            console.log("Listener did not respond to ping - terminating:", id);
            try { ws.terminate(); } catch { }
            listeners.delete(id);
            continue;
        }
        // mark as not alive, then ping; listener must pong to set alive true
        info.alive = false;
        try { ws.ping(); } catch (e) { /* ignore */ }
    }

    if (broadcaster) {
        try {
            if (broadcaster.isAlive === false) {
                console.log("Broadcaster did not respond to ping - terminating");
                try { broadcaster.terminate(); } catch { }
                broadcaster = null;
            } else {
                broadcaster.isAlive = false;
                broadcaster.ping?.();
            }
        } catch (e) { /* ignore */ }
    }
}

// Periodic heartbeat interval
const PING_INTERVAL_MS = 30_000;
setInterval(heartbeat, PING_INTERVAL_MS);

// Upgrade handler — attach ws connection to wss
server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit("connection", ws, request);
    });
});

// Main WS connection handler
wss.on("connection", (ws, req) => {
    // mark alive flags for ping/pong
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    // We'll attach metadata to ws as needed
    ws._role = null;   // "broadcaster" | "listener"
    ws._listenerId = null;

    console.log("New WebSocket connection");

    ws.on("message", (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (e) {
            console.warn("Received invalid JSON from client, ignoring");
            return;
        }

        // message format: { type: 'broadcaster' | 'listener' | 'offer' | 'answer' | 'candidate' | 'listener_ready', ... }
        const type = msg.type;

        switch (type) {
            case "broadcaster": {
                // register broadcaster
                broadcaster = ws;
                ws._role = "broadcaster";
                console.log("Registered broadcaster");
                // notify existing listeners that broadcaster is online
                for (const [, info] of listeners) {
                    safeSend(info.ws, { type: "status", broadcaster: true });
                }
                break;
            }

            case "listener": {
                // register listener with generated id
                const id = genId();
                ws._role = "listener";
                ws._listenerId = id;
                listeners.set(id, { ws, createdAt: Date.now(), alive: true });
                console.log("Listener registered:", id);

                // tell this listener whether a broadcaster exists
                safeSend(ws, { type: "status", broadcaster: !!broadcaster });

                // inform broadcaster (if present) that a listener joined (so broadcaster can create offer)
                if (broadcaster && broadcaster.readyState === 1) {
                    safeSend(broadcaster, { type: "listener-join", id });
                }
                break;
            }

            case "offer": {
                // broadcaster -> server -> targeted listener
                const target = msg.target;
                if (!target) {
                    console.warn("Offer received without target id, ignoring");
                    break;
                }
                const info = listeners.get(target);
                if (info && info.ws && info.ws.readyState === 1) {
                    safeSend(info.ws, { type: "offer", sdp: msg.sdp, from: "broadcaster" });
                    console.log("Forwarded offer -> listener", target);
                } else {
                    console.warn("Target listener not found or not ready:", target);
                }
                break;
            }

            case "answer": {
                // listener -> server -> broadcaster
                if (!broadcaster || broadcaster.readyState !== 1) {
                    console.warn("Answer received but no broadcaster connected");
                    break;
                }
                safeSend(broadcaster, { type: "answer", sdp: msg.sdp, from: msg.from || null, target: msg.target || null });
                console.log("Forwarded answer -> broadcaster, from listener", msg.from || "(unknown)");
                break;
            }

            case "candidate": {
                // ICE candidate forwarding
                // If message has 'target' and that target exists -> send there
                if (msg.target) {
                    const dest = listeners.get(msg.target);
                    if (dest && dest.ws && dest.ws.readyState === 1) {
                        safeSend(dest.ws, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
                        // console.log("Forwarded candidate -> listener", msg.target);
                    } else {
                        // fallback: maybe target is "broadcaster"
                        if (msg.target === "broadcaster" && broadcaster && broadcaster.readyState === 1) {
                            safeSend(broadcaster, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
                        } else {
                            console.warn("Candidate target not found:", msg.target);
                        }
                    }
                } else {
                    // No explicit target: assume from listener -> broadcaster or broadcaster -> all listeners
                    if (ws._role === "listener") {
                        if (broadcaster && broadcaster.readyState === 1) {
                            safeSend(broadcaster, { type: "candidate", candidate: msg.candidate, from: ws._listenerId });
                        }
                    } else if (ws._role === "broadcaster") {
                        // forward to specific listener if msg.to is provided, else broadcast to all listeners
                        if (msg.to) {
                            const dest = listeners.get(msg.to);
                            if (dest && dest.ws && dest.ws.readyState === 1) {
                                safeSend(dest.ws, { type: "candidate", candidate: msg.candidate });
                            }
                        } else {
                            // broadcast candidate to all listeners
                            for (const [id, info] of listeners) {
                                safeSend(info.ws, { type: "candidate", candidate: msg.candidate, from: id });
                            }
                        }
                    }
                }
                break;
            }

            case "listener_ready": {
                // optional: listener tells server it's ready (UI initiated)
                // forward to broadcaster to trigger an offer to that listener
                const id = ws._listenerId;
                if (broadcaster && broadcaster.readyState === 1 && id) {
                    safeSend(broadcaster, { type: "listener-ready", id });
                    console.log("listener_ready forwarded to broadcaster for listener", id);
                }
                break;
            }

            default:
                console.log("Unknown message type:", type);
        }
    });

    // mark alive on pong
    ws.on("pong", () => {
        if (ws._role === "broadcaster") ws.isAlive = true;
        if (ws._role === "listener" && ws._listenerId) {
            const info = listeners.get(ws._listenerId);
            if (info) info.alive = true;
        }
    });

    ws.on("close", () => {
        // clean up broadcaster or listener reference on close
        if (ws === broadcaster) {
            console.log("Broadcaster disconnected");
            broadcaster = null;
            // inform listeners
            for (const [, info] of listeners) {
                safeSend(info.ws, { type: "status", broadcaster: false });
            }
        }

        if (ws._role === "listener" && ws._listenerId) {
            console.log("Listener disconnected:", ws._listenerId);
            listeners.delete(ws._listenerId);

            // inform broadcaster that a listener left
            if (broadcaster && broadcaster.readyState === 1) {
                safeSend(broadcaster, { type: "listener-left", id: ws._listenerId });
            }
        }
    });

    ws.on("error", (err) => {
        console.warn("ws error:", err?.message || err);
    });
});

// Start listening
server.listen(PORT, HOST, () => {
    console.log(`Signaling server running on ${HOST}:${PORT}`);
});