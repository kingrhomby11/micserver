import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebRTC Signaling Server Running\n");
});

const wss = new WebSocketServer({ server });

let broadcaster = null;
let listeners = new Map(); // id → ws
let nextId = 1;

wss.on("connection", (ws) => {
    ws.id = "ws" + nextId++;
    console.log("Client connected:", ws.id);

    ws.on("message", (msg) => {
        let data;
        try { data = JSON.parse(msg); } catch { return; }

        // Broadcaster registers itself
        if (data.type === "broadcaster") {
            broadcaster = ws;
            console.log("Broadcaster ONLINE");

            // Notify existing listeners
            listeners.forEach(listener => {
                listener.send(JSON.stringify({ type: "status", broadcaster: true }));
            });
            return;
        }

        // Listener registers itself
        if (data.type === "listener") {
            listeners.set(ws.id, ws);
            console.log("Listener joined:", ws.id);

            ws.send(JSON.stringify({
                type: "status",
                broadcaster: !!broadcaster
            }));

            // Tell broadcaster a listener arrived
            if (broadcaster) {
                broadcaster.send(JSON.stringify({ type: "listener-join", id: ws.id }));
            }
            return;
        }

        // Broadcaster sends offer targeted to listener
        if (data.type === "offer" && broadcaster === ws) {
            const l = listeners.get(data.target);
            if (l) {
                l.send(JSON.stringify({
                    type: "offer",
                    sdp: data.sdp,
                    from: "broadcaster"
                }));
            }
            return;
        }

        // Listener sends answer back to broadcaster
        if (data.type === "answer") {
            if (broadcaster) {
                broadcaster.send(JSON.stringify({
                    type: "answer",
                    sdp: data.sdp,
                    from: ws.id
                }));
            }
            return;
        }

        // ICE candidate forwarding
        if (data.type === "candidate") {
            if (data.target && listeners.has(data.target)) {
                listeners.get(data.target).send(JSON.stringify({
                    type: "candidate",
                    candidate: data.candidate
                }));
            } else if (ws !== broadcaster && broadcaster) {
                broadcaster.send(JSON.stringify({
                    type: "candidate",
                    candidate: data.candidate,
                    from: ws.id
                }));
            }
        }
    });

    ws.on("close", () => {
        console.log("Disconnected:", ws.id);

        if (ws === broadcaster) {
            console.log("Broadcaster OFFLINE");
            broadcaster = null;
            listeners.forEach(l => {
                l.send(JSON.stringify({ type: "status", broadcaster: false }));
            });
        }

        if (listeners.has(ws.id)) {
            listeners.delete(ws.id);
            console.log("Listener removed", ws.id);
        }
    });
});

server.listen(PORT, () => {
    console.log("Signaling server running on port", PORT);
});