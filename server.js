// server.js
import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51"; // your IP
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    // Basic health page so Railway shows a domain
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebSocket audio relay running\n");
});

const wss = new WebSocketServer({ server });

function broadcastJSON(obj) {
    const s = JSON.stringify(obj);
    for (const c of wss.clients) {
        if (c.readyState === 1) c.send(s);
    }
}

function broadcastBinary(buf, from) {
    for (const c of wss.clients) {
        if (c.readyState !== 1) continue;
        // send to everyone except the sender
        if (c !== from) c.send(buf);
    }
}

wss.on("connection", (ws, req) => {
    // Determine client IP (respect x-forwarded-for)
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const normalIP = (ip || "").replace("::ffff:", "");

    ws.isBroadcaster = normalIP === AUTHORIZED_IP;
    ws._remoteIP = normalIP;

    // Inform this client of its role
    ws.send(JSON.stringify({
        type: "role",
        role: ws.isBroadcaster ? "broadcaster" : "listener"
    }));

    // Immediately broadcast updated status
    broadcastJSON({
        type: "status",
        broadcasterConnected: Array.from(wss.clients).some(c => c.isBroadcaster),
        listenerCount: Array.from(wss.clients).filter(c => !c.isBroadcaster).length
    });

    console.log(`Client connected ${normalIP} role=${ws.isBroadcaster ? "b" : "l"}`);

    ws.on("message", (msg, isBinary) => {
        // If broadcaster sends, relay binary chunks to listeners
        if (ws.isBroadcaster) {
            // Expect binary chunks (webm blobs). Forward them as-is.
            if (isBinary) {
                broadcastBinary(msg, ws);
            } else {
                // If it's text, maybe it's control JSON — ignore or handle if needed
                // For now, ignore non-binary from broadcaster
            }
        } else {
            // Listeners shouldn't send binary audio; optionally handle control msgs
            // If listener sends JSON 'ping' etc, ignore
        }
    });

    ws.on("close", () => {
        console.log(`Client disconnected ${ws._remoteIP}`);
        broadcastJSON({
            type: "status",
            broadcasterConnected: Array.from(wss.clients).some(c => c.isBroadcaster),
            listenerCount: Array.from(wss.clients).filter(c => !c.isBroadcaster).length
        });
    });

    ws.on("error", (err) => {
        console.warn("WS error", err);
    });
});

// Periodic status update (in case something changes by external means)
setInterval(() => {
    broadcastJSON({
        type: "status",
        broadcasterConnected: Array.from(wss.clients).some(c => c.isBroadcaster),
        listenerCount: Array.from(wss.clients).filter(c => !c.isBroadcaster).length
    });
}, 1500);

// Bind to 0.0.0.0 for Railway
server.listen(PORT, "0.0.0.0", () => {
    console.log("Audio relay WebSocket running on port", PORT);
});