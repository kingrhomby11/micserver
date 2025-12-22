// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

let broadcaster = null;
const listeners = new Set();

function send(ws, obj) {
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

wss.on("connection", (ws) => {

    ws.on("message", (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        // role registration
        if (msg.type === "broadcaster") {
            broadcaster = ws;
            console.log("🎙 Broadcaster connected");
            listeners.forEach(l =>
                send(l, { type: "status", broadcaster: true })
            );
            return;
        }

        if (msg.type === "listener") {
            listeners.add(ws);
            console.log("🔊 Listener connected (", listeners.size, ")");
            send(ws, { type: "status", broadcaster: !!broadcaster });
            return;
        }

        // signaling
        if (msg.type === "offer" && ws === broadcaster) {
            listeners.forEach(l =>
                send(l, { type: "offer", sdp: msg.sdp })
            );
            return;
        }

        if (msg.type === "answer" && broadcaster) {
            send(broadcaster, { type: "answer", sdp: msg.sdp });
            return;
        }

        if (msg.type === "candidate") {
            if (ws === broadcaster) {
                listeners.forEach(l =>
                    send(l, { type: "candidate", candidate: msg.candidate })
                );
            } else if (broadcaster) {
                send(broadcaster, { type: "candidate", candidate: msg.candidate });
            }
        }
    });

    ws.on("close", () => {
        if (ws === broadcaster) {
            broadcaster = null;
            console.log("🎙 Broadcaster disconnected");
            listeners.forEach(l =>
                send(l, { type: "status", broadcaster: false })
            );
        }

        if (listeners.has(ws)) {
            listeners.delete(ws);
            console.log("🔊 Listener disconnected (", listeners.size, ")");
        }
    });
});

server.listen(PORT, () => {
    console.log("🚀 Signaling server running on port", PORT);
});