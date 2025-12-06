// server.js
import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51"; // broadcaster IP (your machine)
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling server OK\n");
});

const wss = new WebSocketServer({ server });

// bookkeeping
let broadcaster = null;                // ws of broadcaster (by IP)
const watchers = new Map();            // watcherId -> ws

function sendJson(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { console.warn("sendJson fail", e); }
}

function broadcastStatus() {
    const status = {
        type: "status",
        broadcasterConnected: !!broadcaster,
        listenerCount: Array.from(wss.clients).filter(c => c !== broadcaster && c.readyState === 1).length
    };
    for (const c of wss.clients) {
        if (c.readyState === 1) sendJson(c, status);
    }
}

wss.on("connection", (ws, req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const normalIP = (ip || "").replace("::ffff:", "");

    ws.remoteIP = normalIP;
    ws.isBroadcaster = (normalIP === AUTHORIZED_IP);

    // Announce role to client; listeners get an id
    if (ws.isBroadcaster) {
        broadcaster = ws;
        sendJson(ws, { type: "role", role: "broadcaster" });
        console.log("Broadcaster connected:", normalIP);
    } else {
        const id = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        ws.watcherId = id;
        watchers.set(id, ws);
        sendJson(ws, { type: "role", role: "listener", id });
        console.log("Listener connected:", normalIP, "id:", id);

        // notify broadcaster a watcher wants to connect (so broadcaster can create a pc)
        if (broadcaster && broadcaster.readyState === 1) {
            sendJson(broadcaster, { type: "watcher", id });
        }
    }

    broadcastStatus();

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) {
            console.warn("Bad JSON from", ws.remoteIP, e);
            return;
        }

        const t = msg.type;
        if (t === "offer") {
            // broadcaster -> server -> specific listener (target)
            const target = msg.target;
            const dest = watchers.get(target);
            if (dest && dest.readyState === 1) {
                sendJson(dest, { type: "offer", sdp: msg.sdp, from: msg.from || null });
            } else {
                console.warn("Offer target not found or closed:", target);
            }
        } else if (t === "answer") {
            // listener -> server -> broadcaster (listener includes from=id)
            if (broadcaster && broadcaster.readyState === 1) {
                sendJson(broadcaster, { type: "answer", sdp: msg.sdp, from: msg.from || null });
            } else {
                console.warn("No broadcaster to forward answer to");
            }
        } else if (t === "candidate") {
            // candidate forwarding: target can be 'broadcaster' or a watcherId
            const target = msg.target;
            if (target === "broadcaster") {
                if (broadcaster && broadcaster.readyState === 1) {
                    sendJson(broadcaster, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
                }
            } else {
                const dest = watchers.get(target);
                if (dest && dest.readyState === 1) {
                    sendJson(dest, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
                }
            }
        } else if (t === "watcher") {
            // listener can request watch again (forward to broadcaster)
            if (broadcaster && broadcaster.readyState === 1) {
                sendJson(broadcaster, { type: "watcher", id: msg.id });
            } else {
                sendJson(ws, { type: "no-broadcaster" });
            }
        } else if (t === "leave") {
            const id = msg.id;
            const dest = watchers.get(id);
            if (dest) {
                try { dest.close(); } catch { }
                watchers.delete(id);
            }
            broadcastStatus();
        } else {
            // unknown message
            // console.log("Unknown message type:", t, msg);
        }
    });

    ws.on("close", () => {
        if (ws.isBroadcaster) {
            console.log("Broadcaster disconnected");
            broadcaster = null;
            // optionally inform watchers (they will try to reconnect)
        } else {
            if (ws.watcherId) {
                watchers.delete(ws.watcherId);
                if (broadcaster && broadcaster.readyState === 1) {
                    sendJson(broadcaster, { type: "watcher-left", id: ws.watcherId });
                }
            }
            console.log("Listener disconnected", ws.remoteIP);
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