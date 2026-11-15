/**
 * Gym Platform Node.js Backend Server
 * 
 * - Маршрутизация:
 *   /admin -> admin.html (панель управления клиентами и тренировками)
 *   /client/:slug -> client.html (персональный кабинет клиента)
 *   /client -> client.html
 * 
 * - Общее хранилище данных: data/store.json
 *   Содержит клиентов (clients) и очереди тренировок (workouts)
 *   Обеспечивает постоянное сохранение данных и сквозную синхронизацию.
 * 
 * - Безопасная серверная авторизация тренера (8950).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

// Убедимся, что директория data существует
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Транслитерация кириллицы в латиницу для создания красивых стабильных slug
const CYRILLIC_TO_LATIN = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

function slugify(text) {
  if (!text) return 'client';
  let s = text.toLowerCase().trim();
  s = s.split('').map(char => CYRILLIC_TO_LATIN[char] !== undefined ? CYRILLIC_TO_LATIN[char] : char).join('');
  s = s.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'client';
}

/**
 * Инициализация и чтение общего хранилища данных
 */
function readStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[Store] Ошибка чтения store.json, инициализация заново:', e);
  }

  // Дефолтные данные (Даша создана по умолчанию)
  const initialStore = {
    clients: [
      {
        id: 'client_dasha_seed',
        name: 'Даша',
        slug: 'dasha',
        createdAt: '2026-11-01T10:00:00.000Z',
        active: true
      }
    ],
    workouts: {} // clientId -> [ workouts ]
  };

  writeStore(initialStore);
  return initialStore;
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[Store] Ошибка записи в store.json:', e);
    return false;
  }
}

/**
 * Получить список всех клиентов из хранилища.
 * - Возвращает массив клиентов.
 * - Если клиентов нет или произошла ошибка чтения, возвращает пустой массив [].
 * - Не создает тестовых клиентов внутри функции.
 * - Не создает дубликаты.
 * @returns {Array<Object>}
 */
function getAllClients() {
  try {
    const store = readStore();
    if (!store || !Array.isArray(store.clients)) {
      return [];
    }
    // Возвращаем копии объектов во избежание мутаций
    return store.clients.map(c => ({ ...c }));
  } catch (err) {
    console.error('[getAllClients] Ошибка при чтении клиентов:', err);
    return [];
  }
}

/**
 * Получить клиента по уникальному ID
 * @param {string} clientId
 * @returns {Object|null}
 */
function getClientById(clientId) {
  if (!clientId || typeof clientId !== 'string') return null;
  const clients = getAllClients();
  const found = clients.find(c => c.id === clientId);
  return found || null;
}

/**
 * Гарантировать наличие клиента по умолчанию (Даша) без создания дубликатов
 * @returns {Object} объект Даши
 */
function ensureSeedClient() {
  const store = readStore();
  let dasha = store.clients.find(c => c.slug === 'dasha' || c.name === 'Даша');

  if (!dasha) {
    dasha = {
      id: 'client_dasha_seed',
      name: 'Даша',
      slug: 'dasha',
      createdAt: '2026-11-01T10:00:00.000Z',
      active: true
    };
    store.clients.push(dasha);
    writeStore(store);
  } else {
    // Гарантируем актуальную структуру полей
    let modified = false;
    if (dasha.active === undefined) {
      dasha.active = true;
      modified = true;
    }
    if (modified) writeStore(store);
  }

  return { ...dasha };
}

// Инициализируем хранилище и клиента по умолчанию при старте
readStore();
ensureSeedClient();

// Серверная конфигурация безопасности (пароль 8950)
const ADMIN_PASSWORD_SALT = 'gym_platform_salt_2026';
const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('8950' + ADMIN_PASSWORD_SALT).digest('hex');

const activeSessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyAdminPassword(inputPassword) {
  if (!inputPassword || typeof inputPassword !== 'string') return false;
  const hash = crypto.createHash('sha256').update(inputPassword + ADMIN_PASSWORD_SALT).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(ADMIN_PASSWORD_HASH));
}

function getBearerToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

function isValidSession(token) {
  if (!token || !activeSessions.has(token)) return false;
  const session = activeSessions.get(token);
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!isValidSession(token)) {
    sendJson(res, 401, { success: false, message: 'Необходима авторизация администратора' });
    return false;
  }
  return true;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function serveStaticFile(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // ==========================================
  // API АВТОРИЗАЦИИ ТРЕНЕРА
  // ==========================================
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body || '{}');
        if (verifyAdminPassword(password)) {
          const token = generateSessionToken();
          const expiresAt = Date.now() + SESSION_TTL_MS;
          activeSessions.set(token, { createdAt: Date.now(), expiresAt });
          sendJson(res, 200, {
            success: true,
            token,
            expiresAt,
            message: 'Авторизация успешна'
          });
        } else {
          setTimeout(() => {
            sendJson(res, 401, {
              success: false,
              message: 'Неверный пароль администратора'
            });
          }, 350);
        }
      } catch (e) {
        sendJson(res, 400, { success: false, message: 'Некорректный запрос' });
      }
    });
    return;
  }

  if (pathname === '/api/auth/verify' && req.method === 'GET') {
    const token = getBearerToken(req);
    if (isValidSession(token)) {
      sendJson(res, 200, { authenticated: true });
    } else {
      sendJson(res, 401, { authenticated: false, message: 'Сессия недействительна или истекла' });
    }
    return;
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getBearerToken(req);
    if (token) {
      activeSessions.delete(token);
    }
    sendJson(res, 200, { success: true, message: 'Выход выполнен' });
    return;
  }

  // ==========================================
  // API УПРАВЛЕНИЯ КЛИЕНТАМИ
  // ==========================================

  // 1. Получить список всех клиентов
  if (pathname === '/api/clients' && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    const clients = getAllClients();
    sendJson(res, 200, { success: true, clients });
    return;
  }

  // 2. Публичный маршрут: получить клиента по slug (для клиентской страницы /client/:slug)
  if (pathname.startsWith('/api/client-info/') && req.method === 'GET') {
    const slug = pathname.slice('/api/client-info/'.length).trim().toLowerCase();
    const clients = getAllClients();
    const client = clients.find(c => c.slug.toLowerCase() === slug || c.id === slug);
    if (!client) {
      sendJson(res, 404, { success: false, message: 'Клиент не найден' });
      return;
    }
    sendJson(res, 200, {
      success: true,
      client: {
        id: client.id,
        name: client.name,
        slug: client.slug,
        active: client.active,
        createdAt: client.createdAt
      }
    });
    return;
  }

  // 3. Добавить нового клиента (POST /api/clients)
  if (pathname === '/api/clients' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body || '{}');
        const trimmedName = (name || '').trim();

        if (!trimmedName) {
          sendJson(res, 400, { success: false, message: 'Имя клиента обязательно для заполнения' });
          return;
        }

        const store = readStore();

        // Проверка на дубликат по имени (регистронезависимо)
        const duplicate = store.clients.find(c => c.name.toLowerCase() === trimmedName.toLowerCase());
        if (duplicate) {
          sendJson(res, 409, {
            success: false,
            message: `Клиент с именем «${trimmedName}» уже существует (ссылка: /client/${duplicate.slug})`
          });
          return;
        }

        // Генерация уникального slug и ID
        let baseSlug = slugify(trimmedName);
        let slug = baseSlug;
        let counter = 1;
        while (store.clients.some(c => c.slug === slug)) {
          counter++;
          slug = `${baseSlug}-${counter}`;
        }

        const newId = `client_${slug}_${Date.now().toString(36)}`;

        const newClient = {
          id: newId,
          name: trimmedName,
          slug: slug,
          createdAt: new Date().toISOString(),
          active: true
        };

        store.clients.push(newClient);
        store.workouts[newId] = []; // пустая очередь тренировок для нового клиента

        writeStore(store);

        sendJson(res, 201, {
          success: true,
          client: { ...newClient },
          message: `Клиент ${trimmedName} успешно создан`
        });
      } catch (err) {
        sendJson(res, 400, { success: false, message: 'Некорректный формат данных' });
      }
    });
    return;
  }

  // ==========================================
  // МАРШРУТИЗАЦИЯ СТРАНИЦ
  // ==========================================

  // 1. Маршрут административной панели: /admin
  if (pathname === '/admin' || pathname === '/admin/') {
    serveStaticFile(res, path.join(ROOT_DIR, 'admin.html'));
    return;
  }

  // 2. Персональный клиентский маршрут: /client/:slug (например, /client/dasha)
  if (pathname.startsWith('/client/') || pathname === '/client') {
    serveStaticFile(res, path.join(ROOT_DIR, 'client.html'));
    return;
  }

  // 3. Главная страница / -> client.html
  if (pathname === '/' || pathname === '/index.html') {
    serveStaticFile(res, path.join(ROOT_DIR, 'client.html'));
    return;
  }

  // 4. Статические файлы (js, css, html, assets)
  const safePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (safePath.startsWith(ROOT_DIR)) {
    serveStaticFile(res, safePath);
  } else {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
  }
});

server.listen(PORT, () => {
  console.log(`[GymPlatform Server] Running on http://localhost:${PORT}`);
  console.log(`  -> Admin panel:   http://localhost:${PORT}/admin`);
  console.log(`  -> Client route:  http://localhost:${PORT}/client/dasha`);
});
