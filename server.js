// server.js
// Robust WebRTC signaling server for 1 broadcaster + many listeners
// - safe sends (prevents crashes when sockets are closed)
// - explicit upgrade handling
// - ping/pong heartbeat to remove dead clients
// - forwards offer -> specific listener, answer -> broadcaster, ICE both directions

const http = require("http");
const { WebSocketServer } = require("ws");
const { randomBytes } = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC Signaling Server Running\n");
});

const wss = new WebSocketServer({ noServer: true });

// single broadcaster (ws)
// many listeners: id -> { ws, createdAt, alive }
let broadcaster = null;
const listeners = new Map();

function genId() {
    return randomBytes(4).toString("hex");
}

function safeSend(ws, obj) {
    if (!ws || ws.readyState !== 1) return false;
    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch (err) {
        console.warn("safeSend failed:", err && err.message);
        return false;
    }
}

// heartbeat: ping/pong to detect dead clients
function heartbeat() {
    for (const [id, info] of listeners) {
        if (!info.alive) {
            console.log("Listener did not respond - removing:", id);
            try { info.ws.terminate(); } catch { }
            listeners.delete(id);
            continue;
        }
        info.alive = false;
        try { info.ws.ping(); } catch (e) { }
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
        } catch (e) { }
    }
}

setInterval(heartbeat, 30000);

// Upgrade handler to attach ws to wss
server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
    });
});

wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws._role = null;         // "broadcaster" | "listener"
    ws._listenerId = null;

    console.log("New WS connection");

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) {
            return;
        }

        const type = msg.type;

        switch (type) {
            case "broadcaster": {
                broadcaster = ws;
                ws._role = "broadcaster";
                console.log("Registered broadcaster");
                // notify listeners
                for (const [, info] of listeners) safeSend(info.ws, { type: "status", broadcaster: true });
                break;
            }

            case "listener": {
                const id = genId();
                ws._role = "listener";
                ws._listenerId = id;
                listeners.set(id, { ws, createdAt: Date.now(), alive: true });
                console.log("Listener registered:", id);

                // inform this listener about broadcaster presence
                safeSend(ws, { type: "status", broadcaster: !!broadcaster });

                // notify broadcaster (so broadcaster can offer)
                if (broadcaster && broadcaster.readyState === 1) {
                    safeSend(broadcaster, { type: "listener-join", id });
                }
                break;
            }

            case "offer": {
                // broadcaster -> targeted listener
                const target = msg.target;
                if (!target) break;
                const info = listeners.get(target);
                if (info && info.ws && info.ws.readyState === 1) {
                    safeSend(info.ws, { type: "offer", sdp: msg.sdp, from: "broadcaster" });
                    console.log("Forwarded offer ->", target);
                } else {
                    console.warn("Offer target not found/ready:", target);
                }
                break;
            }

            case "answer": {
                // listener -> broadcaster
                if (!broadcaster || broadcaster.readyState !== 1) {
                    console.warn("Answer received but no broadcaster");
                    break;
                }
                safeSend(broadcaster, { type: "answer", sdp: msg.sdp, from: msg.from || null, target: msg.target || null });
                console.log("Forwarded answer -> broadcaster from", msg.from || "(unknown)");
                break;
            }

            case "candidate": {
                // candidate forwarding with optional 'target' field
                if (msg.target) {
                    // broadcaster -> specific listener
                    const dest = listeners.get(msg.target);
                    if (dest && dest.ws && dest.ws.readyState === 1) {
                        safeSend(dest.ws, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
                    } else {
                        console.warn("Candidate target not found:", msg.target);
                    }
                } else {
                    // no explicit target: use role heuristics
                    if (ws._role === "listener") {
                        if (broadcaster && broadcaster.readyState === 1) {
                            safeSend(broadcaster, { type: "candidate", candidate: msg.candidate, from: ws._listenerId });
                        }
                    } else if (ws._role === "broadcaster") {
                        // broadcaster broadcast candidate to all listeners (unlikely) or rely on explicit target
                        for (const [id, info] of listeners) {
                            safeSend(info.ws, { type: "candidate", candidate: msg.candidate, from: id });
                        }
                    }
                }
                break;
            }

            case "listener_ready": {
                // listener signals UI-ready — forward to broadcaster to trigger an offer if needed
                const id = ws._listenerId;
                if (broadcaster && broadcaster.readyState === 1 && id) {
                    safeSend(broadcaster, { type: "listener-ready", id });
                    console.log("listener_ready forwarded to broadcaster:", id);
                }
                break;
            }

            default:
                // ignore unknown types
                break;
        }
    });

    ws.on("close", () => {
        if (ws === broadcaster) {
            console.log("Broadcaster disconnected");
            broadcaster = null;
            // notify listeners
            for (const [, info] of listeners) safeSend(info.ws, { type: "status", broadcaster: false });
        }

        if (ws._role === "listener" && ws._listenerId) {
            console.log("Listener disconnected:", ws._listenerId);
            listeners.delete(ws._listenerId);
            if (broadcaster && broadcaster.readyState === 1) {
                safeSend(broadcaster, { type: "listener-left", id: ws._listenerId });
            }
        }
    });

    ws.on("error", (err) => {
        console.warn("ws error:", err && err.message);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Signaling server running on ${HOST}:${PORT}`);
});