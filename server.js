// server.js -- WebRTC signaling server (simple relay)
// Usage: deploy to Railway or any Node host. Uses process.env.PORT.

import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51"; // only this IP may broadcast
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling server\n");
});

const wss = new WebSocketServer({ server });

// Track sockets
let broadcaster = null; // ws that is broadcaster
const watchers = new Map(); // id -> ws

function send(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(obj));
}

function broadcastStatus() {
    const status = {
        type: "status",
        broadcasterConnected: !!broadcaster,
        listenerCount: Array.from(wss.clients).filter(c => c !== broadcaster).length
    };
    for (const c of wss.clients) {
        if (c.readyState === 1) c.send(JSON.stringify(status));
    }
}

wss.on("connection", (ws, req) => {
    // get client ip (respect x-forwarded-for)
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const normalIP = (ip || "").replace("::ffff:", "");

    console.log("Connection from", normalIP);

    // assign role: broadcaster if IP matches and no broadcaster already
    ws.isBroadcaster = (normalIP === AUTHORIZED_IP);

    if (ws.isBroadcaster) {
        broadcaster = ws;
        console.log("Broadcaster connected:", normalIP);
        send(ws, { type: "role", role: "broadcaster" });
    } else {
        // create an id for watcher
        const id = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
        ws._watcherId = id;
        watchers.set(id, ws);
        send(ws, { type: "role", role: "listener", id });
        console.log("Listener connected:", normalIP, "id=", id);
    }

    // Immediately announce status
    broadcastStatus();

    ws.on("message", (raw) => {
        // message may be text JSON
        // For binary (not used here) we could adapt, but we expect JSON signaling
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { console.warn("Bad JSON", e); return; }

        // route messages
        // expected messages:
        // { type: "watcher", id: "<watcherId>" }   // (sent by listener?) -> often server->broadcaster triggers
        // { type: "offer", target: "<id>", sdp: ... }  // sent by broadcaster -> forwarded to the listener id
        // { type: "answer", target: "<id>", sdp: ... } // sent by listener -> forwarded to broadcaster
        // { type: "candidate", target: "<id>", candidate: ... }  // either side -> forward
        // We'll treat 'watcher' as listener requesting to watch; server forwards to broadcaster.

        const t = msg.type;
        if (t === "watcher") {
            // A listener asks to watch: forward to broadcaster with listener id
            if (broadcaster && broadcaster.readyState === 1) {
                send(broadcaster, { type: "watcher", id: msg.id });
            } else {
                // No broadcaster online; optional: notify listener
                send(ws, { type: "no-broadcaster" });
            }
        } else if (t === "offer") {
            // Broadcaster -> server -> listener
            const target = msg.target;
            const dest = watchers.get(target);
            if (dest && dest.readyState === 1) {
                send(dest, { type: "offer", sdp: msg.sdp, from: msg.from || null });
            }
        } else if (t === "answer") {
            // Listener -> server -> broadcaster
            if (broadcaster && broadcaster.readyState === 1) {
                send(broadcaster, { type: "answer", sdp: msg.sdp, from: msg.from || null, target: msg.target || null });
            }
        } else if (t === "candidate") {
            // candidate: forward to target
            const target = msg.target;
            // target can be broadcaster or a watcher id
            if (target === "broadcaster") {
                if (broadcaster && broadcaster.readyState === 1) send(broadcaster, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
            } else {
                const dest = watchers.get(target);
                if (dest && dest.readyState === 1) send(dest, { type: "candidate", candidate: msg.candidate, from: msg.from || null });
            }
        } else if (t === "leave") {
            // listener leaves
            const id = msg.id;
            const dest = watchers.get(id);
            if (dest) {
                try { dest.close(); } catch { }
                watchers.delete(id);
            }
            broadcastStatus();
        } else {
            // unknown message
            // console.log("Unknown message", msg);
        }
    });

    ws.on("close", () => {
        if (ws.isBroadcaster) {
            console.log("Broadcaster disconnected");
            broadcaster = null;
            // optionally close all watchers? No — keep watchers, they'll receive no offers.
        } else {
            // remove watcher
            const id = ws._watcherId;
            if (id) {
                watchers.delete(id);
                // notify broadcaster so it can cleanup pc if needed
                if (broadcaster && broadcaster.readyState === 1) {
                    send(broadcaster, { type: "watcher-left", id });
                }
            }
            console.log("Listener disconnected", ws._remoteIP || ws._watcherId);
        }
        broadcastStatus();
    });

    ws.on("error", (err) => {
        console.warn("WS error", err);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("Signaling server listening on port", PORT);
});