// server.js (patched)
import http from "http";
import { WebSocketServer } from "ws";

const AUTHORIZED_IP = "115.129.74.51"; // your IP
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebSocket audio relay running\n");
});

const wss = new WebSocketServer({ server });

// Keep a small rolling list of initial chunks (init header + a few frames).
// We'll replay these for any newly-connected listener so they can decode.
const INIT_CHUNKS_MAX = 6;
const initChunks = []; // Array<Buffer>

// Per-listener outgoing queues and state
const listenerQueues = new Map(); // Map<WebSocket, Array<Buffer>>
const listenerProcessing = new Map(); // Map<WebSocket, boolean>

function broadcastJSON(obj) {
    const s = JSON.stringify(obj);
    for (const c of wss.clients) {
        if (c.readyState === 1) c.send(s);
    }
}

// Helper: safely start processing a listener's queue
function processListenerQueue(client) {
    if (!client || client.readyState !== 1) {
        listenerProcessing.set(client, false);
        return;
    }
    if (listenerProcessing.get(client)) return; // already processing
    const q = listenerQueues.get(client);
    if (!q || q.length === 0) {
        listenerProcessing.set(client, false);
        return;
    }

    listenerProcessing.set(client, true);

    const chunk = q.shift();
    // Use ws.send callback so we don't push too fast.
    client.send(chunk, { binary: true }, (err) => {
        if (err) {
            console.warn("Failed to send audio chunk to client:", err);
            // If send fails, we stop processing this client. Client will reconnect or be cleaned up.
            listenerProcessing.set(client, false);
            return;
        }
        // Slight pause to let TCP flush (helps avoid bursts). Tune if needed.
        // Use setImmediate so we don't block event loop.
        setImmediate(() => processListenerQueue(client));
    });
}

// When new listener connects, seed its queue with initChunks then start processing
function enqueueInitChunksFor(client) {
    if (!initChunks.length) return;
    const q = listenerQueues.get(client);
    if (!q) return;
    // push copies (Buffer)
    for (const c of initChunks) {
        q.push(Buffer.from(c));
    }
    processListenerQueue(client);
}

wss.on("connection", (ws, req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const normalIP = (ip || "").replace("::ffff:", "");

    ws.isBroadcaster = normalIP === AUTHORIZED_IP;
    ws._remoteIP = normalIP;

    // Inform this client of its role
    try {
        ws.send(JSON.stringify({
            type: "role",
            role: ws.isBroadcaster ? "broadcaster" : "listener"
        }));
    } catch (e) {
        // ignore
    }

    // Initialize per-listener queue for non-broadcasters
    if (!ws.isBroadcaster) {
        listenerQueues.set(ws, []);
        listenerProcessing.set(ws, false);
        // Send init chunks immediately so late-joiners can decode
        enqueueInitChunksFor(ws);
    }

    // Broadcast status
    broadcastJSON({
        type: "status",
        broadcasterConnected: Array.from(wss.clients).some(c => c.isBroadcaster),
        listenerCount: Array.from(wss.clients).filter(c => !c.isBroadcaster).length
    });

    console.log(`Client connected ${normalIP} role=${ws.isBroadcaster ? "b" : "l"}`);

    ws.on("message", (msg, isBinary) => {
        // Broadcaster sending audio blobs
        if (ws.isBroadcaster) {
            if (isBinary) {
                // Store first few chunks as initChunks if we haven't yet filled
                try {
                    const buf = Buffer.from(msg);
                    if (initChunks.length < INIT_CHUNKS_MAX) {
                        initChunks.push(Buffer.from(buf));
                        console.log("Saved init chunk, size:", buf.length, "totalInitChunks:", initChunks.length);
                    } else {
                        // rotate: keep last INIT_CHUNKS_MAX chunks
                        initChunks.shift();
                        initChunks.push(Buffer.from(buf));
                    }
                } catch (e) {
                    console.warn("Error buffering init chunk:", e);
                }

                // Relay to listeners by enqueuing into their queues
                for (const client of wss.clients) {
                    if (client === ws) continue; // don't send back to broadcaster
                    if (client.readyState !== 1) continue;
                    // Only listeners have queues (we created above)
                    const q = listenerQueues.get(client);
                    if (!q) continue;
                    // Safety: limit queue length to avoid memory blowups (drop old frames if full)
                    const MAX_Q = 100; // ~100 chunks max; tune as needed
                    if (q.length > MAX_Q) {
                        q.splice(0, q.length - MAX_Q);
                    }
                    q.push(Buffer.from(msg));
                    // Kick off processing if not already
                    processListenerQueue(client);
                }
            } else {
                // Non-binary from broadcaster (control / JSON) — ignore or handle if you add commands
            }
            return;
        }

        // Non-broadcaster sending — ignore or handle control messages
        // You could accept control messages (pings) here if needed.
    });

    ws.on("close", () => {
        console.log(`Client disconnected ${ws._remoteIP}`);
        // Clean up listener maps
        listenerQueues.delete(ws);
        listenerProcessing.delete(ws);

        broadcastJSON({
            type: "status",
            broadcasterConnected: Array.from(wss.clients).some(c => c.isBroadcaster),
            listenerCount: Array.from(wss.clients).filter(c => !c.isBroadcaster).length
        });
    });

    ws.on("error", (err) => {
        console.warn("WS error", err);
        // On error, clean up
        listenerQueues.delete(ws);
        listenerProcessing.delete(ws);
    });
});

// Periodic status update
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