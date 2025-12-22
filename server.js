// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const ALLOWED_IP = "115.129.74.51"; // only allow this IP

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

    // Fix IPv4-mapped IPv6 addresses
    if (ip.startsWith("::ffff:")) {
        ip = ip.replace("::ffff:", "");
    }

    // Check IP restriction
    if (ip !== ALLOWED_IP) {
        console.log(`❌ Connection rejected from ${ip}`);
        ws.close(1008, "Unauthorized IP"); // 1008 = policy violation
        return;
    }

    console.log(`✅ Connection accepted from ${ip}`);

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