// server.js
import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51"; // replace with your broadcaster IP if different
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling server OK\n");
});

const wss = new WebSocketServer({ server });

// bookkeeping
let broadcaster = null;            // ws for broadcaster
const listeners = new Map();       // listenerId -> ws

function sendJson(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

function broadcastStatus() {
    const status = {
        type: "status",
        broadcasterConnected: !!broadcaster,
        listenerCount: listeners.size
    };
    for (const c of wss.clients) if (c.readyState === 1) sendJson(c, status);
}

wss.on("connection", (ws, req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const normalIP = (ip || "").replace("::ffff:", "");

    ws.remoteIP = normalIP;
    ws.isBroadcaster = (normalIP === AUTHORIZED_IP);

    if (ws.isBroadcaster) {
        broadcaster = ws;
        sendJson(ws, { type: "role", role: "broadcaster" });
        console.log("Broadcaster connected:", normalIP);

        // notify existing listeners there's a broadcaster
        for (const [, l] of listeners) sendJson(l, { type: "status", broadcasterConnected: true });
    } else {
        // create listener id
        const id = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        ws.listenerId = id;
        listeners.set(id, ws);
        sendJson(ws, { type: "role", role: "listener", id });
        console.log("Listener connected:", normalIP, "id=", id);

        // notify broadcaster to create a pc for this listener
        if (broadcaster && broadcaster.readyState === 1) {
            sendJson(broadcaster, { type: "watcher", id });
        } else {
            // notify listener that no broadcaster present
            sendJson(ws, { type: "status", broadcasterConnected: false });
        }
    }

    // broadcast status to all
    broadcastStatus();

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

        // from broadcaster: offer targeted to a listener id
        if (msg.type === "offer") {
            const target = msg.target;
            const dest = listeners.get(target);
            if (dest && dest.readyState === 1) {
                sendJson(dest, { type: "offer", offer: msg.offer, from: msg.from || "broadcaster" });
            } else {
                console.warn("Offer target not found:", target);
            }
            return;
        }

        // from listener: answer back to broadcaster (include from=listenerId)
        if (msg.type === "answer") {
            if (broadcaster && broadcaster.readyState === 1) {
                sendJson(broadcaster, { type: "answer", answer: msg.answer, from: msg.from });
            }
            return;
        }

        // candidate forwarding
        if (msg.type === "candidate") {
            // msg.target can be 'broadcaster' or a listenerId
            if (msg.target === "broadcaster") {
                if (broadcaster && broadcaster.readyState === 1) {
                    sendJson(broadcaster, { type: "candidate", candidate: msg.candidate, from: msg.from });
                }
            } else {
                const dest = listeners.get(msg.target);
                if (dest && dest.readyState === 1) {
                    sendJson(dest, { type: "candidate", candidate: msg.candidate, from: msg.from });
                }
            }
            return;
        }

        // optional control types
        if (msg.type === "leave") {
            // listener leaving: close and remove
            const id = msg.id;
            const l = listeners.get(id);
            if (l) {
                try { l.close(); } catch { }
                listeners.delete(id);
            }
            broadcastStatus();
            return;
        }
    });

    ws.on("close", () => {
        if (ws.isBroadcaster) {
            broadcaster = null;
            console.log("Broadcaster disconnected");
            // notify listeners
            for (const [, l] of listeners) sendJson(l, { type: "status", broadcasterConnected: false });
        } else {
            if (ws.listenerId) {
                listeners.delete(ws.listenerId);
                console.log("Listener disconnected:", ws.listenerId);
                if (broadcaster && broadcaster.readyState === 1) {
                    sendJson(broadcaster, { type: "watcher-left", id: ws.listenerId });
                }
            }
        }
        broadcastStatus();
    });

    ws.on("error", (err) => console.warn("WS error", err));
});

setInterval(broadcastStatus, 1500);

server.listen(PORT, "0.0.0.0", () => {
    console.log("Signaling server listening on port", PORT);
});