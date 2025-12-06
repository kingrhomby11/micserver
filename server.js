// server.js
import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51";
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling OK\n");
});

const wss = new WebSocketServer({ server });

let broadcaster = null;
const watchers = new Map();

const send = (ws, obj) => {
    if (ws && ws.readyState === 1)
        ws.send(JSON.stringify(obj));
};

function broadcastStatus() {
    const s = {
        type: "status",
        broadcasterConnected: !!broadcaster,
        listenerCount: watchers.size
    };
    for (const c of wss.clients)
        if (c.readyState === 1) send(c, s);
}

wss.on("connection", (ws, req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = (forwarded ? forwarded.split(",")[0] : req.socket.remoteAddress)
        .replace("::ffff:", "");

    ws.isBroadcaster = (ip === AUTHORIZED_IP);

    if (ws.isBroadcaster) {
        broadcaster = ws;
        send(ws, { type: "role", role: "broadcaster" });
        console.log("Broadcaster:", ip);
    } else {
        const id = Date.now() + "-" + Math.random().toString(36).slice(2);
        watchers.set(id, ws);
        ws.watcherId = id;
        send(ws, { type: "role", role: "listener", id });

        if (broadcaster)
            send(broadcaster, { type: "watcher", id });
    }

    broadcastStatus();

    ws.on("message", raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === "offer") {
            const dest = watchers.get(msg.target);
            if (dest) send(dest, { type: "offer", sdp: msg.sdp, from: msg.from });
        }

        else if (msg.type === "answer") {
            if (broadcaster)
                send(broadcaster, { type: "answer", sdp: msg.sdp, from: msg.from });
        }

        else if (msg.type === "candidate") {
            if (msg.target === "broadcaster") {
                if (broadcaster)
                    send(broadcaster, { type: "candidate", candidate: msg.candidate, from: msg.from });
            } else {
                const dest = watchers.get(msg.target);
                if (dest)
                    send(dest, { type: "candidate", candidate: msg.candidate, from: msg.from });
            }
        }
    });

    ws.on("close", () => {
        if (ws.isBroadcaster) {
            broadcaster = null;
        } else {
            watchers.delete(ws.watcherId);
            if (broadcaster)
                send(broadcaster, { type: "watcher-left", id: ws.watcherId });
        }
        broadcastStatus();
    });
});

setInterval(broadcastStatus, 1500);

server.listen(PORT, "0.0.0.0", () =>
    console.log("Signaling on", PORT)
);