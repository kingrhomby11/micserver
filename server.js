// ES Module imports (not require)
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

// Railway uses dynamic port
const PORT = process.env.PORT || 3000;

// Create HTTP server (needed for ws upgrade)
const server = http.createServer();

// WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

let broadcaster = null;
let listener = null;

wss.on("connection", (ws) => {

    ws.on("message", (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (err) {
            console.log("Bad JSON:", raw.toString());
            return;
        }

        if (msg.type === "broadcaster") {
            broadcaster = ws;
            console.log("Broadcaster connected");
            if (listener) listener.send(JSON.stringify({ type: "status", broadcaster: true }));
        }

        if (msg.type === "listener") {
            listener = ws;
            console.log("Listener connected");
            if (broadcaster) listener.send(JSON.stringify({ type: "status", broadcaster: true }));
        }

        if (msg.type === "offer" && listener) {
            console.log("Forwarding offer to listener");
            listener.send(JSON.stringify({ type: "offer", sdp: msg.sdp }));
        }

        if (msg.type === "answer" && broadcaster) {
            console.log("Forwarding answer to broadcaster");
            broadcaster.send(JSON.stringify({ type: "answer", sdp: msg.sdp }));
        }

        if (msg.type === "candidate") {
            console.log("Forwarding ICE candidate");

            if (ws === broadcaster && listener)
                listener.send(JSON.stringify({ type: "candidate", candidate: msg.candidate }));

            if (ws === listener && broadcaster)
                broadcaster.send(JSON.stringify({ type: "candidate", candidate: msg.candidate }));
        }
    });

    ws.on("close", () => {
        if (ws === broadcaster) {
            broadcaster = null;
            console.log("Broadcaster disconnected");
            if (listener) listener.send(JSON.stringify({ type: "status", broadcaster: false }));
        }
        if (ws === listener) {
            listener = null;
            console.log("Listener disconnected");
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});