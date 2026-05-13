<?php
/**
 * api/clickup-comment.php — Posta comentário de cliente como mensagem no ClickUp.
 *
 * Fluxo:
 *   1. Valida JWT Supabase (mesmo helper de clickup.php)
 *   2. Verifica role=user (somente clientes postam)
 *   3. Busca demands.clickup_task_id pelo demand_id + client_slug
 *   4. Formata comentário: "Mensagem do cliente - {nome}\n\n{conteúdo}"
 *   5. POST /task/{taskId}/comment na API do ClickUp
 *   6. Atualiza demands.clickup_synced_at
 *
 * Body JSON esperado:
 *   { "demand_id": "<uuid>", "client_slug": "<slug>", "content": "<texto>",
 *     "attachments": [{ "name": "...", "signedUrl": "..." }] }
 *
 * Auth: Authorization: Bearer <supabase-jwt>
 */
declare(strict_types=1);

// ── Helpers ──────────────────────────────────────────────────────────────────

function gp_json(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function gp_validate_jwt(string $token): array {
    $url    = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
    $anon   = trim((string)(getenv('GP_SUPABASE_ANON_KEY') ?: ''));
    if ($url === '' || $anon === '') {
        throw new RuntimeException('Supabase não configurado no servidor.');
    }
    $ch = curl_init($url . '/auth/v1/user');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => ['apikey: ' . $anon, 'Authorization: Bearer ' . $token],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) {
        throw new RuntimeException('JWT inválido ou expirado (' . $code . ').');
    }
    $user = json_decode((string)$body, true);
    if (!is_array($user) || empty($user['id'])) {
        throw new RuntimeException('Resposta do Supabase inválida.');
    }
    return $user;
}

// Busca demand via Supabase REST (service role para ignorar RLS e validar ownership)
function gp_fetch_demand(string $demandId, string $clientSlug): array {
    $url  = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
    $srKey = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));
    $anon  = trim((string)(getenv('GP_SUPABASE_ANON_KEY') ?: ''));
    $key   = $srKey !== '' ? $srKey : $anon;
    if ($url === '' || $key === '') {
        throw new RuntimeException('Supabase não configurado.');
    }
    $filter = 'id=eq.' . urlencode($demandId) . '&client_slug=eq.' . urlencode($clientSlug)
            . '&select=id,client_slug,clickup_task_id,title';
    $ch = curl_init($url . '/rest/v1/demands?' . $filter);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
            'Accept-Profile: portal',
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    $rows = json_decode((string)$body, true);
    if (!is_array($rows) || empty($rows[0])) {
        throw new RuntimeException('Demanda não encontrada ou não pertence ao cliente.');
    }
    return $rows[0];
}

// Atualiza clickup_synced_at em portal.demands
function gp_touch_demand_sync(string $demandId): void {
    $url   = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
    $srKey = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));
    $anon  = trim((string)(getenv('GP_SUPABASE_ANON_KEY') ?: ''));
    $key   = $srKey !== '' ? $srKey : $anon;
    if ($url === '' || $key === '') return;
    $ch = curl_init($url . '/rest/v1/demands?id=eq.' . urlencode($demandId));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . $key,
            'Authorization: Bearer ' . $key,
            'Content-Type: application/json',
            'Accept-Profile: portal',
            'Content-Profile: portal',
            'Prefer: return=minimal',
        ],
        CURLOPT_POSTFIELDS     => json_encode(['clickup_synced_at' => date('c')]),
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

// POST comment em task do ClickUp
function gp_post_clickup_comment(string $taskId, string $commentText): array {
    $apiKey = trim((string)(getenv('GP_CLICKUP_API_KEY') ?: ''));
    if ($apiKey === '') {
        throw new RuntimeException('API key do ClickUp não configurada.');
    }
    $url = 'https://api.clickup.com/api/v2/task/' . rawurlencode($taskId) . '/comment';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => 'POST',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS=> CURLPROTO_HTTPS,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode(
            ['comment_text' => $commentText, 'notify_all' => true],
            JSON_UNESCAPED_UNICODE
        ),
    ]);
    $body   = curl_exec($ch);
    $code   = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);
    if ($curlErr !== '') {
        throw new RuntimeException('Falha de conexão com ClickUp: ' . $curlErr);
    }
    if ($code >= 400) {
        $decoded = json_decode((string)$body, true);
        $msg = is_array($decoded)
            ? ($decoded['err'] ?? $decoded['error'] ?? $decoded['message'] ?? 'Erro desconhecido')
            : 'Erro ' . $code;
        throw new RuntimeException('ClickUp retornou ' . $code . ': ' . $msg);
    }
    return ['status' => $code, 'body' => json_decode((string)$body, true)];
}

// ── Roteamento ────────────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    gp_json(['ok' => false, 'error' => 'Método não permitido.'], 405);
}

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
$jwt = '';
if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    $jwt = trim($m[1]);
}
if ($jwt === '') {
    gp_json(['ok' => false, 'error' => 'Autenticação necessária.'], 401);
}

try {
    $jwtUser = gp_validate_jwt($jwt);
} catch (RuntimeException $e) {
    gp_json(['ok' => false, 'error' => $e->getMessage()], 401);
}

$meta     = (array)($jwtUser['user_metadata'] ?? []);
$userRole = (string)($meta['role'] ?? 'user');

// Somente clientes postam comentários via este endpoint
if ($userRole !== 'user') {
    gp_json(['ok' => false, 'error' => 'Endpoint exclusivo para clientes.'], 403);
}

$raw     = (string)file_get_contents('php://input');
$payload = (array)json_decode($raw, true);

$demandId   = trim((string)($payload['demand_id']   ?? ''));
$clientSlug = trim((string)($payload['client_slug'] ?? ''));
$content    = trim((string)($payload['content']     ?? ''));
$attachments = is_array($payload['attachments'] ?? null) ? $payload['attachments'] : [];

if ($demandId === '' || $clientSlug === '') {
    gp_json(['ok' => false, 'error' => 'demand_id e client_slug são obrigatórios.'], 422);
}

// Valida posse do slug (JWT metadata vs. slug enviado)
$jwtSlug = (string)($meta['clientSlug'] ?? '');
if ($jwtSlug !== '' && $jwtSlug !== $clientSlug) {
    gp_json(['ok' => false, 'error' => 'Acesso negado a esse portal.'], 403);
}

if ($content === '' && count($attachments) === 0) {
    gp_json(['ok' => false, 'error' => 'Mensagem vazia.'], 422);
}

try {
    $demand = gp_fetch_demand($demandId, $clientSlug);
} catch (RuntimeException $e) {
    gp_json(['ok' => false, 'error' => $e->getMessage()], 404);
}

$clickupTaskId = trim((string)($demand['clickup_task_id'] ?? ''));

if ($clickupTaskId === '') {
    // Sem task vinculada: aceita silenciosamente (sem erro — mensagem já foi gravada no DB pelo front)
    gp_json(['ok' => true, 'synced' => false, 'reason' => 'demand_sem_clickup_task']);
}

// Busca nome do cliente via users (melhor esforço)
$clientName = $jwtUser['email'] ?? 'Cliente';
if (!empty($jwtUser['user_metadata']['name'])) {
    $clientName = $jwtUser['user_metadata']['name'];
}

// Formata comentário
$commentText = 'Mensagem do cliente - ' . $clientName . "\n\n" . $content;

// Anexos: lista de nomes + URLs assinadas como rodapé
if (!empty($attachments)) {
    $commentText .= "\n\n*Anexos:*";
    foreach ($attachments as $att) {
        $name = is_array($att) ? ($att['name'] ?? 'arquivo') : (string)$att;
        $url  = is_array($att) ? ($att['signedUrl'] ?? '') : '';
        $commentText .= "\n- " . $name . ($url !== '' ? ' → ' . $url : '');
    }
}

try {
    $result = gp_post_clickup_comment($clickupTaskId, $commentText);
} catch (RuntimeException $e) {
    // Falha no ClickUp não deve bloquear o cliente — mensagem já está no DB
    gp_json(['ok' => true, 'synced' => false, 'reason' => $e->getMessage()]);
}

gp_touch_demand_sync($demandId);

gp_json(['ok' => true, 'synced' => true, 'clickup_comment_id' => $result['body']['id'] ?? null]);
