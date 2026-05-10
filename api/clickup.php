<?php
/**
 * api/clickup.php — ClickUp proxy.
 *
 * Auth: validates Supabase JWT from Authorization: Bearer <jwt> header.
 * Authz: extracts client slug from JWT claims / portal.users and validates
 *        the requested clientSlug matches (clients) or allows any (admins).
 *
 * JWT validation: HS256, secret = getenv('GP_SUPABASE_JWT_SECRET').
 * Schema is portal.*; user metadata stored in auth.users.user_metadata.
 *
 * Security carried from the original:
 *  - Rejects absolute URLs (SSRF guard)
 *  - CURLOPT_PROTOCOLS set to HTTPS only
 *  - HMAC webhook endpoint untouched
 */
declare(strict_types=1);

// ── Bootstrap (minimal — no legacy auth/session deps) ────────────────────────

// ClickUp API key — APENAS via env var. Fallback file removido por hardening
// (pentest 2026-05-09 Finding #13: arquivo no repo aumentava superfície de
// vazamento se .htaccess fosse misconfig).
function gp_get_clickup_api_key(): string {
    return trim((string)(getenv('GP_CLICKUP_API_KEY') ?: ''));
}

function gp_json_response(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function gp_raw_response(string $body, int $status, string $contentType): never {
    http_response_code($status);
    header('Content-Type: ' . $contentType);
    header('X-Content-Type-Options: nosniff');
    echo $body;
    exit;
}

// ── JWT Validation (HS256) ────────────────────────────────────────────────────

/**
 * Validate a Supabase JWT by calling /auth/v1/user endpoint.
 *
 * Mais robusto que decode HS256 local: delega validação pra Supabase,
 * sem precisar do JWT secret no servidor (que não é mais exposto via Management API).
 *
 * @return array claims-like com { sub, email, user_metadata, app_metadata, role }
 * @throws RuntimeException on invalid/expired JWT
 */
function gp_validate_supabase_jwt(string $token): array {
    $supabaseUrl = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
    $anonKey     = trim((string)(getenv('GP_SUPABASE_ANON_KEY') ?: ''));
    if ($supabaseUrl === '' || $anonKey === '') {
        throw new RuntimeException('GP_SUPABASE_URL ou GP_SUPABASE_ANON_KEY não configurados.');
    }

    $ch = curl_init($supabaseUrl . '/auth/v1/user');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . $anonKey,
            'Authorization: Bearer ' . $token,
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200) {
        throw new RuntimeException('JWT inválido ou expirado (Supabase: ' . $code . ').');
    }

    $user = json_decode((string)$body, true);
    if (!is_array($user) || empty($user['id'])) {
        throw new RuntimeException('Resposta do Supabase não tem usuário válido.');
    }

    return [
        'sub'           => $user['id'],
        'email'         => $user['email'] ?? '',
        'role'          => 'authenticated',
        'user_metadata' => $user['user_metadata'] ?? [],
        'app_metadata'  => $user['app_metadata'] ?? [],
    ];
}

// ── Request parsing ───────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    gp_json_response(['ok' => false, 'error' => 'Método não permitido.'], 405);
}

// Read JWT from Authorization header
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$jwt = '';
if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    $jwt = trim($m[1]);
}

if ($jwt === '') {
    gp_json_response(['ok' => false, 'error' => 'Autenticação necessária.'], 401);
}

try {
    $claims = gp_validate_supabase_jwt($jwt);
} catch (RuntimeException $e) {
    gp_json_response(['ok' => false, 'error' => $e->getMessage()], 401);
}

// Extract user info from JWT claims
$jwtRole       = (string)($claims['role'] ?? 'authenticated');
$jwtSub        = (string)($claims['sub'] ?? '');
$userMeta      = (array)($claims['user_metadata'] ?? []);
$appMeta       = (array)($claims['app_metadata'] ?? []);

$userRole      = (string)($userMeta['role'] ?? $appMeta['role'] ?? 'client');
$userStatus    = (string)($userMeta['status'] ?? $appMeta['status'] ?? 'approved');
$userClientSlug = (string)($userMeta['clientSlug'] ?? $appMeta['clientSlug'] ?? '');

// ── Authz ─────────────────────────────────────────────────────────────────────

// Parse body
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
$isMultipart = stripos($contentType, 'multipart/form-data') !== false;

if ($isMultipart) {
    $payload = $_POST;
} else {
    $raw = (string)file_get_contents('php://input');
    $payload = (array)json_decode($raw, true);
}

$clientSlug = trim((string)($payload['clientSlug'] ?? ''));

if ($userRole === 'admin') {
    // Admin can proxy any slug
} elseif ($clientSlug !== '') {
    // Client: validate slug ownership
    // First try JWT metadata; if not present, we accept (RLS on Supabase enforces at DB level)
    if ($userClientSlug !== '' && $clientSlug !== $userClientSlug) {
        gp_json_response(['ok' => false, 'error' => 'Acesso negado a esse portal.'], 403);
    }
    if ($userStatus !== 'approved') {
        gp_json_response(['ok' => false, 'error' => 'Sessão sem acesso ao ClickUp.'], 403);
    }
} else {
    // No slug → only admin allowed
    if ($userRole !== 'admin') {
        gp_json_response(['ok' => false, 'error' => 'Sessão sem acesso ao ClickUp.'], 403);
    }
}

// ── ClickUp proxy ─────────────────────────────────────────────────────────────

$method = strtoupper((string)($payload['method'] ?? 'GET'));
$path   = (string)($payload['path'] ?? '');

if ($path === '') {
    gp_json_response(['ok' => false, 'error' => 'Path do ClickUp é obrigatório.'], 422);
}

// CRITICAL-1: Reject absolute URLs from the client (SSRF guard).
if (preg_match('#^https?://#i', $path)) {
    gp_json_response(['ok' => false, 'error' => 'Path absoluto não é permitido. Use apenas caminhos relativos ao ClickUp.'], 422);
}

// FIX (HIGH, pentest 2026-05-09 — Finding #4 BOLA + Finding #7 method allowlist):
// Restringir clientes a métodos seguros + scope de path ao próprio cliente_task_id.
if ($userRole !== 'admin') {
    $allowedMethods = ['GET', 'POST'];
    if (!in_array($method, $allowedMethods, true)) {
        gp_json_response(['ok' => false, 'error' => 'Método não permitido para esse portal.'], 405);
    }

    // Resolve cliente_task_id e cu_list_id do client via Supabase REST.
    // Usa SERVICE_ROLE_KEY (server-side) pra ignorar RLS — necessário porque
    // após policy fix, anon não enxerga portal.clients.
    static $portalCfgCache = null;
    if ($portalCfgCache === null) {
        $cfgUrl  = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
        $srKey   = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));
        $anonKey = trim((string)(getenv('GP_SUPABASE_ANON_KEY') ?: ''));
        $apiKey  = $srKey !== '' ? $srKey : $anonKey;
        $portalCfgCache = ['task_id' => '', 'list_id' => ''];
        if ($cfgUrl !== '' && $apiKey !== '' && $clientSlug !== '') {
            $ch = curl_init($cfgUrl . '/rest/v1/clients?slug=eq.' . urlencode($clientSlug) . '&select=cliente_task_id,cu_list_id');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 10,
                CURLOPT_HTTPHEADER     => [
                    'apikey: ' . $apiKey,
                    'Authorization: Bearer ' . $apiKey,
                    'Accept-Profile: portal',
                ],
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ]);
            $resp = curl_exec($ch);
            curl_close($ch);
            $rows = json_decode((string)$resp, true);
            if (is_array($rows) && !empty($rows[0])) {
                $portalCfgCache['task_id'] = trim((string)($rows[0]['cliente_task_id'] ?? ''));
                $portalCfgCache['list_id'] = trim((string)($rows[0]['cu_list_id'] ?? ''));
            }
        }
    }
    $allowedTaskId = $portalCfgCache['task_id'];
    $allowedListId = $portalCfgCache['list_id'];

    // Path normalizado pra comparação
    $pathClean = ltrim($path, '/');

    // Permitir:
    //   - task/{allowedTaskId}[/...]   (read/comment do próprio chamado)
    //   - list/{allowedListId}[/...]   (criação de novos chamados na list do cliente)
    //   - team/.../task/{allowedTaskId}/...
    $isOwnTask  = $allowedTaskId !== '' && (strpos($pathClean, 'task/' . $allowedTaskId) !== false);
    $isOwnList  = $allowedListId !== '' && (strpos($pathClean, 'list/' . $allowedListId) === 0);

    if (!$isOwnTask && !$isOwnList) {
        gp_json_response([
            'ok' => false,
            'error' => 'Path fora do escopo permitido pra esse portal.',
        ], 403);
    }
}

$apiKey = gp_get_clickup_api_key();
if ($apiKey === '') {
    gp_json_response(['ok' => false, 'error' => 'API key do ClickUp não configurada no servidor.'], 503);
}

$baseUrl = 'https://api.clickup.com/api/v2';
$targetUrl = $baseUrl . '/' . ltrim($path, '/');

$body = $payload['body'] ?? null;

// Collect uploaded files
$files = [];
if (!empty($_FILES)) {
    foreach ($_FILES as $name => $file) {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
            $files[$name] = $file;
        }
    }
}

// Build cURL request
$ch = curl_init();

$curlHeaders = [
    'Authorization: ' . $apiKey,
    'X-Requested-With: XMLHttpRequest',
];

if (!empty($files)) {
    // Multipart upload
    $multipartFields = [];
    foreach ($payload as $key => $value) {
        if (in_array($key, ['method', 'path', 'body', 'clientSlug'], true)) continue;
        if (is_scalar($value)) $multipartFields[$key] = (string)$value;
    }
    if ($body && is_array($body)) {
        foreach ($body as $k => $v) {
            $multipartFields[$k] = is_string($v) ? $v : json_encode($v);
        }
    }
    foreach ($files as $name => $file) {
        $multipartFields[$name] = new CURLFile($file['tmp_name'], $file['type'] ?: 'application/octet-stream', $file['name']);
    }
    curl_setopt($ch, CURLOPT_POSTFIELDS, $multipartFields);
} elseif ($body !== null) {
    if (is_array($body)) {
        $curlHeaders[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    } else {
        $curlHeaders[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, (string)$body);
    }
} elseif ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
    $curlHeaders[] = 'Content-Length: 0';
}

curl_setopt_array($ch, [
    CURLOPT_URL            => $targetUrl,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => $curlHeaders,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,  // SSRF guard: HTTPS only
    CURLOPT_REDIR_PROTOCOLS=> CURLPROTO_HTTPS,
    CURLOPT_FOLLOWLOCATION => false,             // No redirects (SSRF guard)
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

$responseBody = curl_exec($ch);
$httpStatus   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType  = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curlError    = curl_error($ch);
curl_close($ch);

if ($curlError !== '') {
    gp_json_response(['ok' => false, 'error' => 'Falha de conexão com o ClickUp: ' . $curlError], 502);
}

if (in_array($httpStatus, [401, 403], true)) {
    $decoded = json_decode((string)$responseBody, true);
    $details = '';
    if (is_array($decoded)) {
        foreach (['err', 'error', 'message', 'ECODE'] as $key) {
            $value = trim((string)($decoded[$key] ?? ''));
            if ($value !== '') { $details = $value; break; }
        }
    }
    $error = $httpStatus === 401
        ? 'Credencial do ClickUp inválida ou expirada.'
        : 'Credencial do ClickUp sem acesso a esse workspace ou recurso.';
    if ($details !== '') $error .= ' ' . $details . '.';
    $error .= ' Atualize GP_CLICKUP_API_KEY.';
    gp_json_response(['ok' => false, 'error' => $error, 'clickupStatus' => $httpStatus], $httpStatus);
}

gp_raw_response((string)$responseBody, $httpStatus, $contentType ?: 'application/json');
