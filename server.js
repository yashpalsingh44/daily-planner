const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const JWT_SECRET = 'chronosplan_jwt_secret_2026';

// Ensure data dir & db file
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let dbData = { users: [], tasks: [] };

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {
        dbData = { users: [], tasks: [] };
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
    } catch (e) {}
}

loadDB();

// Helper JWT
function generateJWT(userId, username) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + (24 * 3600);
    const payload = Buffer.from(JSON.stringify({ sub: userId, name: username, exp })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}

function parseJWT(tokenStr) {
    if (!tokenStr || !tokenStr.startsWith('Bearer ')) return null;
    const token = tokenStr.substring(7);
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    if (expectedSig !== parts[2]) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function hashPassword(pass) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(pass, salt, 1000, 32, 'sha256').toString('hex');
    return `${salt}$${hash}`;
}

function verifyPassword(pass, storedHash) {
    if (!storedHash || !storedHash.includes('$')) return false;
    const [salt, originalHash] = storedHash.split('$');
    const hash = crypto.pbkdf2Sync(pass, salt, 1000, 32, 'sha256').toString('hex');
    return hash === originalHash;
}

// SSE Clients
const sseClients = new Set();

function broadcastSSE(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(res => {
        try { res.write(msg); } catch (e) {}
    });
}

// Mappings for MIME
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        let jsonPayload = {};
        try { if (body) jsonPayload = JSON.parse(body); } catch (e) {}

        const authUser = parseJWT(req.headers['authorization']);
        const currentUserId = authUser ? authUser.sub : 'default_user';

        // REST API
        if (pathname === '/api/auth/register' && req.method === 'POST') {
            const { username, email, password } = jsonPayload;
            if (!username || !email || !password || password.length < 4) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                return res.end('Username, email, and password (min 4 chars) required.');
            }
            const existing = dbData.users.find(u => u.email.toLowerCase() === email.toLowerCase() || u.username === username);
            if (existing) {
                res.writeHead(409, { 'Content-Type': 'text/plain' });
                return res.end('User with this email or username already exists.');
            }
            const user = {
                id: 'user_' + Date.now(),
                username,
                email: email.toLowerCase(),
                passwordHash: hashPassword(password),
                createdAt: new Date().toISOString()
            };
            dbData.users.push(user);
            saveDB();
            const token = generateJWT(user.id, user.username);
            const { passwordHash, ...safeUser } = user;
            res.writeHead(201, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ token, user: safeUser }));
        }

        if (pathname === '/api/auth/login' && req.method === 'POST') {
            const { email, password } = jsonPayload;
            const identifier = (email || '').toLowerCase().trim();
            const user = dbData.users.find(u => u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier);
            if (!user || !verifyPassword(password, user.passwordHash)) {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                return res.end('Invalid email/username or password credentials.');
            }
            const token = generateJWT(user.id, user.username);
            const { passwordHash, ...safeUser } = user;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ token, user: safeUser }));
        }

        if (pathname === '/api/auth/me' && req.method === 'GET') {
            if (!authUser) {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                return res.end('Unauthorized');
            }
            const user = dbData.users.find(u => u.id === currentUserId);
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('User not found');
            }
            const { passwordHash, ...safeUser } = user;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(safeUser));
        }

        if (pathname === '/api/tasks' && req.method === 'GET') {
            const dateParam = url.searchParams.get('date');
            let result = dbData.tasks.filter(t => t.userId === currentUserId || t.userId === 'default_user');
            if (dateParam) {
                result = result.filter(t => t.date === dateParam || t.recurrence === 'daily');
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result));
        }

        if (pathname === '/api/tasks' && req.method === 'POST') {
            const task = {
                id: jsonPayload.id || ('task_' + Date.now()),
                userId: currentUserId,
                title: jsonPayload.title || 'Untitled',
                desc: jsonPayload.desc || '',
                date: jsonPayload.date || new Date().toISOString().substring(0, 10),
                start: jsonPayload.start || '09:00',
                end: jsonPayload.end || '10:00',
                status: jsonPayload.status || 'todo',
                reminder: !!jsonPayload.reminder,
                recurrence: jsonPayload.recurrence || 'none'
            };
            dbData.tasks.push(task);
            saveDB();
            res.writeHead(201, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(task));
        }

        if (pathname.startsWith('/api/tasks/') && req.method === 'PUT') {
            const taskId = pathname.substring(11);
            const index = dbData.tasks.findIndex(t => t.id === taskId);
            if (index === -1) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('Task not found');
            }
            dbData.tasks[index] = { ...dbData.tasks[index], ...jsonPayload, id: taskId, userId: currentUserId };
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(dbData.tasks[index]));
        }

        if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
            const taskId = pathname.substring(11);
            dbData.tasks = dbData.tasks.filter(t => t.id !== taskId);
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ message: 'Deleted', id: taskId }));
        }

        if (pathname === '/api/events' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write(`event: init\ndata: ${JSON.stringify({ message: 'Connected to ChronosPlan Event Stream' })}\n\n`);
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }

        if (pathname === '/api/tasks/test-reminder' && req.method === 'POST') {
            const sampleTask = {
                id: 'task_test_' + Date.now(),
                userId: currentUserId,
                title: '⚡ Test Live Reminder Alert',
                desc: 'Generated from ChronosPlan Node.js Backend Server.',
                start: new Date().toTimeString().substring(0, 5),
                end: '18:00',
                status: 'todo',
                reminder: true
            };
            broadcastSSE('reminder', { type: 'reminder', message: 'Test alert', task: sampleTask });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'success', task: sampleTask }));
        }

        // Static File Serving
        let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath);
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(200, { 'Content-Type': mimeType });
                res.end(content);
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 ChronosPlan Node.js Full-Stack Server running at http://localhost:${PORT}`);
    console.log(`📁 Serving static assets from ./public`);
    console.log(`🔐 Supporting POST/PUT/DELETE Auth & Task API endpoints`);
    console.log(`💾 Persisting data to ./data/db.json\n`);
});
