const WebSocket = require('ws');
const tls = require('tls');
const extractJson = require('extract-json-string');
const fs = require('fs');

const config = {
  token: "token gir", // discord.gg/0077 guild çek bizden ol
  serverid: "çekiceğin sunucu id" // discord.gg/0077 guild çek bizden ol
};

let guilds = {}, lastSeq = null, hbInterval = null, mfaToken = null, mfaTokenLastChecked = 0, lastMfaFileTime = 0;

function safeExtract(d) {
  if (typeof d !== 'string') try { return JSON.stringify(d); } catch { return null; }
  try { return extractJson.extract(d); } catch { return null; }
}

function readMfaToken(force = false) {
  const now = Date.now();
  try {
    const stats = fs.statSync('mfa.txt'); 
    if (mfaToken && stats.mtimeMs <= lastMfaFileTime && !force) return mfaToken;
    lastMfaFileTime = stats.mtimeMs;

    const data = fs.readFileSync('mfa.txt', 'utf8'); 
    const token = data.trim(); 

    if (token) {
      if (token !== mfaToken) {
        mfaToken = token;
        console.log(`[MFA] Güncellendi: ${mfaToken}`);
      } else {
        mfaToken = token;
      }
      mfaTokenLastChecked = now;
      return mfaToken;
    }
  } catch { }
  return mfaToken;
}

async function req(method, path, body = null) {
  return new Promise(resolve => {
    const s = tls.connect({ host: 'canary.discord.com', port: 443, rejectUnauthorized: false }, () => {
      const headers = [
        `${method} ${path} HTTP/1.1`,
        'Host: canary.discord.com',
        `Authorization: ${config.token}`,
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
        'X-Super-Properties: ' +
          'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRmlyZWZveCIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJ0ci1UUiIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQ7IHJ2OjEzMy4wKSBHZWNrby8yMDEwMDEwMSBGaXJlZm94LzEzMy4wIiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTMzLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6Imh0dHBzOi8vd3d3Lmdvb2dsZS5jb20vIiwicmVmZXJyaW5nX2RvbWFpbiI6Ind3dy5nb29nbGUuY29tIiwic2VhcmNoX2VuZ2luZSI6Imdvb2dsZSIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJjYW5hcnkiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNTYxNDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGwsImhhc19jbGllbnRfbW9kcyI6ZmFsc2V9'
      ];

      if (mfaToken) headers.push(`X-Discord-MFA-Authorization: ${mfaToken}`);
      if (body) headers.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`);
      headers.push('Connection: close', '', body || '');
      s.write(headers.join('\r\n'));

      let response = '';
      s.on('data', chunk => response += chunk.toString());
      s.on('end', () => {
        const i = response.indexOf('\r\n\r\n');
        if (i === -1) return resolve('{}');
        let body = response.slice(i + 4);

        if (response.toLowerCase().includes('transfer-encoding: chunked')) {
          let res = '', o = 0;
          while (o < body.length) {
            const e = body.indexOf('\r\n', o);
            if (e === -1) break;
            const size = parseInt(body.substring(o, e), 16);
            if (size === 0) break;
            res += body.substring(e + 2, e + 2 + size);
            o = e + 2 + size + 2;
          }
          body = res || '{}';
        }

        if (!path.includes('/vanity-url')) {
          const ext = safeExtract(body);
          if (ext) return resolve(ext);
        }

        resolve(body);
      });

      s.on('error', () => resolve('{}'));
    });
    s.setTimeout(1000, () => { s.destroy(); resolve('{}'); });
  });
}

function connect() {
  req("GET", "/api/v9/gateway").then(res => {
    let url;
    try {
      url = JSON.parse(res)?.url;
    } catch {
      const ext = safeExtract(res);
      if (ext) try { url = JSON.parse(ext)?.url; } catch { }
    }

    const ws = new WebSocket(url || "wss://gateway.discord.gg/?v=9&encoding=json");

    ws.on("open", () => {
      ws.send(JSON.stringify({
        op: 2,
        d: {
          token: config.token,
          intents: 513,
          properties: { os: "Windows", browser: "0077", device: "s43h" } // discord.gg/0077
        }
      }));
    });

    ws.on("message", async d => {
      try {
        let p;
        try { p = typeof d === 'string' ? JSON.parse(d) : JSON.parse(d.toString()); }
        catch (e) {
          const j = safeExtract(d.toString());
          if (j) p = JSON.parse(j);
          else return;
        }

        if (p.s) lastSeq = p.s;
        if (p.op === 10) {
          clearInterval(hbInterval);
          hbInterval = setInterval(() => ws.send(JSON.stringify({ op: 1, d: lastSeq })), p.d.heartbeat_interval);
        }

        if (p.t === "READY") {
          p.d.guilds.filter(g => g.vanity_url_code).forEach(g => guilds[g.id] = g.vanity_url_code);
          Object.entries(guilds).forEach(([id, url]) => console.log(`${id}: ${url}`));
        }

        if (p.t === "GUILD_UPDATE") {
          const id = p.d.id || p.d.guild_id, old = guilds[id], nw = p.d.vanity_url_code;
          if (old && old !== nw) {
            readMfaToken();
            if (mfaToken) {
              const req1 = req("PATCH", `/api/v9/guilds/${config.serverid}/vanity-url`, JSON.stringify({ code: old }));
              const req2 = req("PATCH", `/api/v9/guilds/${config.serverid}/vanity-url`, JSON.stringify({ code: old }));
              const [r1, r2] = await Promise.all([req1, req2]);
              console.log("[REQ1]", r1);
              console.log("[REQ2]", r2);
            }
          }
          if (nw) guilds[id] = nw;
          else if (guilds[id]) delete guilds[id];
        }

      } catch (err) {
        console.error("[ERR]", err);
      }
    });

    ws.on("close", () => { clearInterval(hbInterval); setTimeout(connect, 5000); });
    ws.on("error", () => ws.close());
  }).catch(() => setTimeout(connect, 5000));
}

(async () => {
  readMfaToken(true);
  connect();
  setInterval(() => readMfaToken(false), 30000);
})();

process.on('uncaughtException', () => { });
// discord.gg/0077 guild çek bizden ol
