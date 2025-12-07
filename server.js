// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC Signaling Server Running\n");
});

const wss = new WebSocketServer({ server });

let broadcaster = null;
let listeners = new Map(); // id -> ws
let nextId = 1;

wss.on("connection", (ws) => {
    ws.id = "ws" + nextId++;
    console.log("Client connected:", ws.id);

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // broadcaster registers
        if (msg.type === "broadcaster") {
            broadcaster = ws;
            console.log("Broadcaster ONLINE");
            // notify all listeners
            listeners.forEach((l) => {
                try { l.send(JSON.stringify({ type: "status", broadcaster: true })); } catch { }
            });
            return;
        }

        // listener registers
        if (msg.type === "listener") {
            listeners.set(ws.id, ws);
            console.log("Listener joined:", ws.id);
            // tell listener whether broadcaster exists
            try { ws.send(JSON.stringify({ type: "status", broadcaster: !!broadcaster })); } catch { }
            // notify broadcaster to create a PC for this listener
            if (broadcaster && broadcaster.readyState === 1) {
                try { broadcaster.send(JSON.stringify({ type: "listener-join", id: ws.id })); } catch { }
            }
            return;
        }

        // broadcaster -> targeted offer
        if (msg.type === "offer" && ws === broadcaster) {
            const target = listeners.get(msg.target);
            if (target && target.readyState === 1) {
                try {
                    target.send(JSON.stringify({ type: "offer", sdp: msg.sdp, from: "broadcaster" }));
                } catch { }
            }
            return;
        }

        // listener -> answer back to broadcaster
        if (msg.type === "answer") {
            if (broadcaster && broadcaster.readyState === 1) {
                try {
                    broadcaster.send(JSON.stringify({ type: "answer", sdp: msg.sdp, from: ws.id }));
                } catch { }
            }
            return;
        }

        // ICE forwarding
        if (msg.type === "candidate") {
            // if target is a listener id, forward to that listener
            if (msg.target && listeners.has(msg.target)) {
                const dest = listeners.get(msg.target);
                if (dest && dest.readyState === 1) {
                    try { dest.send(JSON.stringify({ type: "candidate", candidate: msg.candidate })); } catch { }
                }
            } else {
                // otherwise (listener -> broadcaster) forward to broadcaster
                if (broadcaster && broadcaster.readyState === 1) {
                    try { broadcaster.send(JSON.stringify({ type: "candidate", candidate: msg.candidate, from: ws.id })); } catch { }
                }
            }
            return;
        }
    });

    ws.on("close", () => {
        console.log("Disconnected:", ws.id);

        if (ws === broadcaster) {
            broadcaster = null;
            console.log("Broadcaster OFFLINE");
            listeners.forEach((l) => {
                try { l.send(JSON.stringify({ type: "status", broadcaster: false })); } catch { }
            });
        }

        if (listeners.has(ws.id)) {
            listeners.delete(ws.id);
            console.log("Listener removed", ws.id);
            // optionally inform broadcaster that listener left (not required)
            if (broadcaster && broadcaster.readyState === 1) {
                try { broadcaster.send(JSON.stringify({ type: "listener-left", id: ws.id })); } catch { }
            }
        }
    });

    ws.on("error", (err) => {
        console.warn("ws error", err);
    });
});

server.listen(PORT, () => {
    console.log("Signaling server running on port", PORT);
});