// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

// Only allow this IP to broadcast
const BROADCASTER_IP = "115.129.74.51";

const server = http.createServer();
const wss = new WebSocketServer({ server });

let broadcaster = null;
const listeners = new Set();

// Helper to send JSON
function send(ws, obj) {
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

wss.on("connection", (ws, req) => {
    // Normalize IP to IPv4
    let ip = req.socket.remoteAddress || "";
    if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", "");
    console.log("New connection from:", ip);

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // Broadcaster registration
        if (msg.type === "broadcaster") {
            if (ip !== BROADCASTER_IP) {
                ws.close(1008, "Unauthorized IP");
                console.log("Rejected broadcaster from IP:", ip);
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