// server.js
import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51"; // broadcaster IP (change if needed)
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling server OK\n");
});

const wss = new WebSocketServer({ server });

// bookkeeping
let broadcaster = null;            // WebSocket of broadcaster
const listeners = new Map();       // listenerId -> ws

function safeSend(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

function broadcastStatus() {
    const status = {
        type: "status",
        broadcasterConnected: !!broadcaster,
        listenerCount: listeners.size
    };
    for (const c of wss.clients) if (c.readyState === 1) safeSend(c, status);
}

wss.on("connection", (ws, req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const normalIP = (ip || "").replace("::ffff:", "");
    ws.remoteIP = normalIP;
    ws.isBroadcaster = (normalIP === AUTHORIZED_IP);

    // announce role to the client if possible
    if (ws.isBroadcaster) {
        broadcaster = ws;
        safeSend(ws, { type: "role", role: "broadcaster" });
        console.log("Broadcaster connected:", normalIP);
        // notify any listeners
        for (const [, l] of listeners) safeSend(l, { type: "status", broadcasterConnected: true });
    } else {
        // create listener id and register
        const id = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        ws.listenerId = id;
        listeners.set(id, ws);
        safeSend(ws, { type: "role", role: "listener", id });
        console.log("Listener connected:", normalIP, "id=", id);

        // notify broadcaster to create a dedicated pc for this listener
        if (broadcaster && broadcaster.readyState === 1) {
            safeSend(broadcaster, { type: "watcher", id });
        } else {
            // tell listener no broadcaster currently
            safeSend(ws, { type: "status", broadcasterConnected: false });
        }
    }

    broadcastStatus();

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

        // Allow explicit role claim (client can call this on open)
        if (msg.type === "broadcaster") {
            broadcaster = ws;
            ws.isBroadcaster = true;
            safeSend(ws, { type: "role", role: "broadcaster" });
            console.log("Broadcaster declared by client:", ws.remoteIP);
            // notify watchers
            for (const [, l] of listeners) safeSend(l, { type: "status", broadcasterConnected: true });
            broadcastStatus();
            return;
        }

        if (msg.type === "listener") {
            // client asking to be listener (server already created id when connected)
            safeSend(ws, { type: "role", role: "listener", id: ws.listenerId });
            return;
        }

        // Broadcaster sends an *offer* targeted to a specific listener
        if (msg.type === "offer" && msg.target) {
            const target = msg.target;
            const dest = listeners.get(target);
            if (dest && dest.readyState === 1) {
                safeSend(dest, { type: "offer", offer: msg.offer, from: "broadcaster" });
            } else {
                console.warn("Offer target not found:", target);
            }
            return;
        }

        // Listener sends an *answer* back (msg.from should be listenerId)
        if (msg.type === "answer" && msg.from) {
            if (broadcaster && broadcaster.readyState === 1) {
                safeSend(broadcaster, { type: "answer", answer: msg.answer, from: msg.from });
            }
            return;
        }

        // ICE candidate forwarding. msg.target either 'broadcaster' or a listenerId
        if (msg.type === "candidate") {
            const tgt = msg.target;
            if (tgt === "broadcaster") {
                if (broadcaster && broadcaster.readyState === 1) {
                    safeSend(broadcaster, { type: "candidate", candidate: msg.candidate, from: msg.from });
                }
            } else {
                const dest = listeners.get(tgt);
                if (dest && dest.readyState === 1) {
                    safeSend(dest, { type: "candidate", candidate: msg.candidate, from: msg.from });
                }
            }
            return;
        }

        // listener leaving voluntarily
        if (msg.type === "leave" && msg.id) {
            const l = listeners.get(msg.id);
            if (l) {
                try { l.close(); } catch { }
                listeners.delete(msg.id);
            }
            broadcastStatus();
            return;
        }

        // ignore unknown messages
    });

    ws.on("close", () => {
        if (ws.isBroadcaster) {
            broadcaster = null;
            console.log("Broadcaster disconnected");
            // notify listeners
            for (const [, l] of listeners) safeSend(l, { type: "status", broadcasterConnected: false });
        } else {
            if (ws.listenerId) {
                listeners.delete(ws.listenerId);
                console.log("Listener disconnected:", ws.listenerId);
                if (broadcaster && broadcaster.readyState === 1) {
                    safeSend(broadcaster, { type: "watcher-left", id: ws.listenerId });
                }
            }
        }
        broadcastStatus();
    });

    ws.on("error", (err) => {
        console.warn("WS error", err);
    });
});

setInterval(broadcastStatus, 1500);

server.listen(PORT, "0.0.0.0", () => {
    console.log("Signaling server listening on port", PORT);
});