// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC signaling server running\n");
});

const wss = new WebSocketServer({ server });

let broadcaster = null;
let listeners = new Set();

wss.on("connection", (ws) => {
    ws.role = "listener";

    ws.send(JSON.stringify({ type: "hello" }));

    ws.on("message", (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch (e) {
            return;
        }

        // Broadcaster declares itself
        if (data.type === "become-broadcaster") {
            broadcaster = ws;
            ws.role = "broadcaster";
            console.log("Broadcaster connected");
            return;
        }

        // Listener asks to connect
        if (data.type === "listen") {
            listeners.add(ws);
            if (broadcaster) {
                // tell broadcaster "a listener needs an offer"
                broadcaster.send(JSON.stringify({ type: "need-offer" }));
            }
            return;
        }

        // Broadcaster sends offer → forward to listener
        if (data.type === "offer" && ws.role === "broadcaster") {
            [...listeners].forEach((l) => {
                l.send(JSON.stringify({ type: "offer", sdp: data.sdp }));
            });
            return;
        }

        // Listener sends answer → forward to broadcaster
        if (data.type === "answer" && ws.role === "listener") {
            if (broadcaster) {
                broadcaster.send(JSON.stringify({ type: "answer", sdp: data.sdp }));
            }
            return;
        }

        // Candidates
        if (data.type === "candidate") {
            if (ws.role === "broadcaster") {
                [...listeners].forEach((l) =>
                    l.send(JSON.stringify({ type: "candidate", candidate: data.candidate }))
                );
            } else {
                if (broadcaster) {
                    broadcaster.send(JSON.stringify({ type: "candidate", candidate: data.candidate }));
                }
            }
        }
    });

    ws.on("close", () => {
        if (ws.role === "broadcaster") {
            broadcaster = null;
            console.log("Broadcaster disconnected");
        }
        listeners.delete(ws);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("WebRTC signaling server running on", PORT);
});