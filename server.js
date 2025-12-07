< !doctype html >
    <html>
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width,initial-scale=1" />
            <title>Listener — WebRTC One-Way</title>
            <style>
                body{font - family:Arial;background:#111;color:#eee;padding:20px;text-align:center}
                button{padding:10px 14px;margin:8px;border-radius:6px;border:none;cursor:pointer}
                audio{width:100%;margin-top:12px}
            </style>
        </head>
        <body>
            <h2>Listener</h2>
            <div><strong>Status:</strong> <span id="status">Connecting...</span></div>
            <div style="margin:12px 0;">
                <button id="playBtn">Play</button>
                <button id="muteBtn" disabled>Mute</button>
            </div>
            <audio id="player" controls autoplay playsinline></audio>

            <script>
(() => {
  const SIGNALING_WS = "wss://micserver-production.up.railway.app"; // set your signaling server
                const ICE_CONFIG = {iceServers: [{urls: "stun:stun.l.google.com:19302" }] };

                const statusEl = document.getElementById("status");
                const player = document.getElementById("player");
                const playBtn = document.getElementById("playBtn");
                const muteBtn = document.getElementById("muteBtn");

                let ws = new WebSocket(SIGNALING_WS);
                let pc = null;
                let listenerId = null;

  ws.onopen = () => {
                    console.log("WS open");
                ws.send(JSON.stringify({type: "listener" })); // ask server to register us
                statusEl.textContent = "Connected to signaling (waiting for offer)";
  };

  ws.onmessage = async (ev) => {
                    let msg;
                try {msg = JSON.parse(ev.data); } catch (e) { return; }
                console.log("WS msg", msg);

                if (msg.type === "role" && msg.role === "listener" && msg.id) {
                    listenerId = msg.id;
                console.log("Assigned listener id:", listenerId);
    }

                if (msg.type === "status") {
                    statusEl.textContent = msg.broadcasterConnected ? "Broadcaster online (waiting offer)" : "No broadcaster";
                return;
    }

                if (msg.type === "offer" && msg.offer) {
                    // create PC and answer
                    pc = new RTCPeerConnection(ICE_CONFIG);

      pc.ontrack = (e) => {
                    player.srcObject = e.streams[0];
                muteBtn.disabled = false;
                try {player.play().catch(() => { }); } catch (e) { }
                statusEl.textContent = "Playing";
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
                    ws.send(JSON.stringify({
                        type: "candidate",
                        candidate: ev.candidate,
                        target: "broadcaster",
                        from: listenerId
                    }));
        }
      };

                try {
                    await pc.setRemoteDescription(msg.offer);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                // send answer back (include from=listenerId so server routes it)
                ws.send(JSON.stringify({type: "answer", answer: pc.localDescription, from: listenerId }));
      } catch (e) {
                    console.error("Handle offer failed", e);
      }
    }

                if (msg.type === "candidate" && msg.candidate) {
      if (pc) pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(e => console.warn(e));
    }
  };

  ws.onclose = () => {
                    statusEl.textContent = "Signaling disconnected";
  };

  playBtn.onclick = () => player.play().catch(e => console.warn("Play blocked", e));
  muteBtn.onclick = () => {
                    player.muted = !player.muted;
                muteBtn.textContent = player.muted ? "Unmute" : "Mute";
  };
})();
            </script>
        </body>
    </html>