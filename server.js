// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const BROADCASTER_IP = "115.129.74.51"; // only allow this IP for broadcaster

const server = http.createServer();
const wss = new WebSocketServer({ server });

let broadcaster = null;
const listeners = new Set();

function send(ws, obj) {
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

wss.on("connection", (ws, req) => {
    // Get the client IP
    let ip = req.socket.remoteAddress;
    if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", ""); // IPv4 fix

    ws.ip = ip; // store IP for reference

    console.log(`✅ Connection attempt from ${ip}`);

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // --- Role registration ---
        if (msg.type === "broadcaster") {
            if (ip !== BROADCASTER_IP) {
                console.log(`❌ Broadcaster rejected from ${ip}`);
                ws.close(1008, "Unauthorized IP");
                return;
            }

            broadcaster = ws;
            console.log("🎙 Broadcaster connected");

            // Notify all listeners
            listeners.forEach(l => send(l, { type: "status", broadcaster: true }));
            return;
        }

        if (msg.type === "listener") {
            listeners.add(ws);
            console.log(`🔊 Listener connected (${listeners.size})`);
            send(ws, { type: "status", broadcaster: !!broadcaster });
            return;
        }

        // --- Signaling ---
        if (msg.type === "offer" && ws === broadcaster) {
            // forward offer to all listeners
            listeners.forEach(l => send(l, { type: "offer", sdp: msg.sdp }));
            return;
        }

        if (msg.type === "answer" && broadcaster) {
            // forward answer from listener to broadcaster
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

    ws.on("close", () => {
        if (ws === broadcaster) {
            broadcaster = null;
            console.log("🎙 Broadcaster disconnected");
            listeners.forEach(l => send(l, { type: "status", broadcaster: false }));
        }

        if (listeners.has(ws)) {
            listeners.delete(ws);
            console.log(`🔊 Listener disconnected (${listeners.size})`);
        }
    });
});

server.listen(PORT, () => {
    console.log("🚀 Signaling server running on port", PORT);
});