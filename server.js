// server.js
import http from "http";
import { WebSocketServer } from "ws";

// Port
const PORT = process.env.PORT || 3000;

// Secret token for broadcaster (set your own token here or via env variable)
const BROADCASTER_TOKEN = process.env.BROADCASTER_TOKEN || "MY_SECRET_TOKEN";

const server = http.createServer();
const wss = new WebSocketServer({ server });

let broadcaster = null;
const listeners = new Set();

// Helper to send JSON safely
function send(ws, obj) {
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress || "";
    console.log("New connection from:", ip);

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // Broadcaster registration with token
        if (msg.type === "broadcaster") {
            if (msg.token !== BROADCASTER_TOKEN) {
                ws.close(1008, "Unauthorized token");
                console.log("Rejected broadcaster from", ip, "Invalid token");
                return;
            }

            broadcaster = ws;
            console.log("🎙 Broadcaster connected:", ip);
            listeners.forEach(l => send(l, { type: "status", broadcaster: true }));
            return;
        }

        // Listener registration
        if (msg.type === "listener") {
            listeners.add(ws);
            console.log("🔊 Listener connected (", listeners.size, ") from IP:", ip);
            send(ws, { type: "status", broadcaster: !!broadcaster });
            return;
        }

        // Signaling messages
        if (msg.type === "offer" && ws === broadcaster) {
            listeners.forEach(l => send(l, { type: "offer", sdp: msg.sdp }));
            return;
        }

        if (msg.type === "answer" && broadcaster) {
            send(broadcaster, { type: "answer", sdp: msg.sdp });
            return;
        }

        if (msg.type === "candidate") {
            if (ws === broadcaster) {
                listeners.forEach(l => send(l, { type: "candidate", candidate: msg.candidate }));
            } else if (broadcaster) {
                send(broadcaster, { type: "candidate", candidate: msg.candidate });
            }
        }
    });

    ws.on("close", (code, reason) => {
        if (ws === broadcaster) {
            broadcaster = null;
            console.log("🎙 Broadcaster disconnected");
            listeners.forEach(l => send(l, { type: "status", broadcaster: false }));
        }
        if (listeners.has(ws)) {
            listeners.delete(ws);
            console.log("🔊 Listener disconnected (", listeners.size, ")");
        }
        console.log(`Connection from ${ip} closed. Code: ${code}, Reason: ${reason.toString()}`);
    });

    ws.on("error", (err) => {
        console.error("WebSocket error from", ip, err);
    });
});

server.listen(PORT, () => {
    console.log("🚀 Signaling server running on port", PORT);
});