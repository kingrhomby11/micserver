// server-webrtc.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling server running\n");
});

const wss = new WebSocketServer({ server });

let broadcaster = null;    // 1 broadcaster
let listeners = new Set(); // Many listeners

wss.on("connection", (ws) => {

    ws.on("message", (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === "broadcaster") {
            broadcaster = ws;
            console.log("Broadcaster connected");

            // Tell all listeners a broadcaster is ready
            listeners.forEach(l => {
                l.send(JSON.stringify({ type: "status", broadcasterConnected: true }));
            });
        }

        else if (msg.type === "listener") {
            listeners.add(ws);
            console.log("Listener connected");

            ws.send(JSON.stringify({
                type: "status",
                broadcasterConnected: !!broadcaster
            }));
        }

        // Forward offer → listener(s)
        else if (msg.type === "offer" && broadcaster === ws) {
            listeners.forEach(l => {
                l.send(JSON.stringify({ type: "offer", sdp: msg.sdp }));
            });
        }

        // Forward answer → broadcaster
        else if (msg.type === "answer") {
            if (broadcaster && broadcaster.readyState === 1) {
                broadcaster.send(JSON.stringify({ type: "answer", sdp: msg.sdp }));
            }
        }

        // Forward ICE candidates in both directions
        else if (msg.type === "candidate") {
            if (msg.target === "listener") {
                listeners.forEach(l => {
                    l.send(JSON.stringify({ type: "candidate", candidate: msg.candidate }));
                });
            }
            else if (msg.target === "broadcaster" && broadcaster) {
                broadcaster.send(JSON.stringify({ type: "candidate", candidate: msg.candidate }));
            }
        }
    });

    ws.on("close", () => {
        if (ws === broadcaster) {
            broadcaster = null;
            console.log("Broadcaster disconnected");

            listeners.forEach(l => {
                l.send(JSON.stringify({ type: "status", broadcasterConnected: false }));
            });
        }

        if (listeners.has(ws)) {
            listeners.delete(ws);
            console.log("Listener disconnected");
        }
    });
});

server.listen(PORT, () =>
    console.log("WebRTC signaling server running on port", PORT)
);