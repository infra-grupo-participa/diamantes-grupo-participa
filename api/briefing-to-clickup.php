<?php
/**
 * api/briefing-to-clickup.php
 *
 * Recebe o PDF do briefing e cria/atualiza uma task no ClickUp.
 *
 * Modo projeto  — POST: project_id + pdf + briefing_summary
 *   Sempre cria nova task na lista do cliente (clients.cu_list_id).
 *
 * Modo demanda  — POST: demand_id  + pdf + briefing_summary
 *   Se demands.clickup_task_id já existe → anexa à task existente.
 *   Caso contrário → cria nova task na lista, salva o ID de volta.
 *
 * Resposta JSON: { ok: true, clickup_url: "..." } | { ok: false, error: "..." }
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function json_out(array $d, int $s = 200): never {
    http_response_code($s);
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

function sb_get(string $url, string $key): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $key,
            'apikey: '             . $key,
            'Accept-Profile: portal',
        ],
        CURLOPT_TIMEOUT => 8,
    ]);
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, json_decode((string)$body, true) ?? []];
}

function sb_patch(string $url, string $key, array $payload): void {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER  => true,
        CURLOPT_CUSTOMREQUEST   => 'PATCH',
        CURLOPT_POSTFIELDS      => json_encode($payload),
        CURLOPT_HTTPHEADER      => [
            'Authorization: Bearer ' . $key,
            'apikey: '             . $key,
            'Content-Type: application/json',
            'Content-Profile: portal',
        ],
        CURLOPT_TIMEOUT => 8,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

function cu_create_task(string $listId, string $name, string $description, string $apiKey): string {
    $ch = curl_init('https://api.clickup.com/api/v2/list/' . urlencode($listId) . '/task');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'name'        => $name,
            'description' => $description,
            'notify_all'  => true,
        ]),
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($status !== 200) {
        $detail = $err ?: ((string)$resp ?: 'sem detalhe');
        json_out(['ok' => false, 'error' => 'Erro ao criar task no ClickUp: ' . $detail], 502);
    }
    $taskId = json_decode((string)$resp, true)['id'] ?? '';
    if ($taskId === '') {
        json_out(['ok' => false, 'error' => 'ClickUp não retornou ID da task criada.'], 502);
    }
    return $taskId;
}

// ── Env ──────────────────────────────────────────────────────────────────────
$supabaseUrl = trim((string)(getenv('GP_SUPABASE_URL')                ?: ''));
$anonKey     = trim((string)(getenv('GP_SUPABASE_ANON_KEY')           ?: ''));
$srKey       = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY')   ?: ''));
$clickupKey  = trim((string)(getenv('GP_CLICKUP_API_KEY')             ?: ''));

if ($supabaseUrl === '' || $srKey === '') {
    json_out(['ok' => false, 'error' => 'Configuração do servidor incompleta.'], 500);
}
if ($clickupKey === '') {
    json_out(['ok' => false, 'error' => 'Chave da API do ClickUp não configurada.'], 500);
}

// ── Auth JWT ─────────────────────────────────────────────────────────────────
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(\S+)$/i', $authHeader, $m)) {
    json_out(['ok' => false, 'error' => 'JWT ausente.'], 401);
}
$jwt = $m[1];

$ch = curl_init($supabaseUrl . '/auth/v1/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $jwt, 'apikey: ' . $anonKey],
    CURLOPT_TIMEOUT        => 8,
]);
$userJson   = curl_exec($ch);
$userStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($userStatus !== 200) {
    json_out(['ok' => false, 'error' => 'JWT inválido ou expirado.'], 401);
}
$authUid = json_decode((string)$userJson, true)['id'] ?? '';
if ($authUid === '') {
    json_out(['ok' => false, 'error' => 'Usuário não identificado.'], 401);
}

// ── Identifica modo ───────────────────────────────────────────────────────────
$projectId = trim($_POST['project_id'] ?? '');
$demandId  = trim($_POST['demand_id']  ?? '');
$isProject = $projectId !== '' && (bool)preg_match('/^[0-9a-f-]{36}$/i', $projectId);
$isDemand  = $demandId  !== '' && (bool)preg_match('/^[0-9a-f-]{36}$/i', $demandId);

if (!$isProject && !$isDemand) {
    json_out(['ok' => false, 'error' => 'project_id ou demand_id inválido.'], 400);
}

// ── PDF ───────────────────────────────────────────────────────────────────────
if (empty($_FILES['pdf']) || $_FILES['pdf']['error'] !== UPLOAD_ERR_OK) {
    json_out(['ok' => false, 'error' => 'Arquivo PDF ausente ou com erro.'], 400);
}
$pdfFile = $_FILES['pdf'];
if ($pdfFile['size'] > 20 * 1024 * 1024) {
    json_out(['ok' => false, 'error' => 'PDF muito grande (máx 20 MB).'], 400);
}

// ── Caller ────────────────────────────────────────────────────────────────────
[, $uRows] = sb_get(
    $supabaseUrl . '/rest/v1/users?auth_user_id=eq.' . urlencode($authUid) . '&select=id,role,client_slug&limit=1',
    $srKey
);
$caller = $uRows[0] ?? null;
if (!$caller) {
    json_out(['ok' => false, 'error' => 'Usuário do portal não encontrado.'], 403);
}
$isAdmin = ($caller['role'] === 'admin');

// ── Resolve entidade ──────────────────────────────────────────────────────────
$entityTitle     = '';
$clientSlug      = '';
$existingTaskId  = '';
$entityTable     = '';
$entityId        = '';

if ($isProject) {
    [, $rows] = sb_get(
        $supabaseUrl . '/rest/v1/projects?id=eq.' . urlencode($projectId)
        . '&select=id,title,client_slug&limit=1',
        $srKey
    );
    $entity = $rows[0] ?? null;
    if (!$entity) { json_out(['ok' => false, 'error' => 'Projeto não encontrado.'], 404); }
    if (!$isAdmin && $caller['client_slug'] !== $entity['client_slug']) {
        json_out(['ok' => false, 'error' => 'Permissão negada.'], 403);
    }
    $entityTitle    = $entity['title'];
    $clientSlug     = $entity['client_slug'];
    $entityTable    = 'projects';
    $entityId       = $projectId;
    $existingTaskId = '';   // projetos sempre criam task nova
} else {
    [, $rows] = sb_get(
        $supabaseUrl . '/rest/v1/demands?id=eq.' . urlencode($demandId)
        . '&select=id,title,client_slug,clickup_task_id&limit=1',
        $srKey
    );
    $entity = $rows[0] ?? null;
    if (!$entity) { json_out(['ok' => false, 'error' => 'Demanda não encontrada.'], 404); }
    if (!$isAdmin && $caller['client_slug'] !== $entity['client_slug']) {
        json_out(['ok' => false, 'error' => 'Permissão negada.'], 403);
    }
    $entityTitle    = $entity['title'];
    $clientSlug     = $entity['client_slug'];
    $entityTable    = 'demands';
    $entityId       = $demandId;
    $existingTaskId = trim((string)($entity['clickup_task_id'] ?? ''));
}

// ── Resolve lista do cliente ──────────────────────────────────────────────────
[, $cRows] = sb_get(
    $supabaseUrl . '/rest/v1/clients?slug=eq.' . urlencode($clientSlug) . '&select=cu_list_id&limit=1',
    $srKey
);
$listId = trim((string)($cRows[0]['cu_list_id'] ?? ''));
if ($listId === '') {
    json_out(['ok' => false, 'error' => 'Cliente não possui lista do ClickUp configurada (cu_list_id).'], 422);
}

// ── Resolve task ID (cria se necessário) ──────────────────────────────────────
$briefingSummary = trim($_POST['briefing_summary'] ?? '');
$taskCreated     = false;

if ($existingTaskId !== '') {
    $taskId = $existingTaskId;
} else {
    $taskName = 'Briefing — ' . $entityTitle;
    $taskId   = cu_create_task($listId, $taskName, $briefingSummary, $clickupKey);
    $taskCreated = true;

    // Salva task ID na entidade para reutilização futura
    sb_patch(
        $supabaseUrl . '/rest/v1/' . $entityTable . '?id=eq.' . urlencode($entityId),
        $srKey,
        ['clickup_task_id' => $taskId]
    );
}

// ── Anexa PDF à task ──────────────────────────────────────────────────────────
$fileName = 'Briefing_' . preg_replace('/[^a-zA-Z0-9_-]/', '_', $entityTitle) . '.pdf';

$ch = curl_init('https://api.clickup.com/api/v2/task/' . urlencode($taskId) . '/attachment');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => ['attachment' => new CURLFile($pdfFile['tmp_name'], 'application/pdf', $fileName)],
    CURLOPT_HTTPHEADER     => ['Authorization: ' . $clickupKey],
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$cuResp   = curl_exec($ch);
$cuStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$cuErr    = curl_error($ch);
curl_close($ch);

if ($cuStatus !== 200) {
    $detail = $cuErr ?: ((string)$cuResp ?: 'sem detalhe');
    json_out(['ok' => false, 'error' => 'Erro ao anexar PDF na task: ' . $detail], 502);
}

// ── Comentário de resumo (quando a task já existia — task nova já recebeu descrição) ──
if (!$taskCreated && $briefingSummary !== '') {
    $ch2 = curl_init('https://api.clickup.com/api/v2/task/' . urlencode($taskId) . '/comment');
    curl_setopt_array($ch2, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'comment_text' => "📋 *Briefing de Abertura — " . $entityTitle . "*\n\n" . $briefingSummary,
            'notify_all'   => true,
        ]),
        CURLOPT_HTTPHEADER     => ['Authorization: ' . $clickupKey, 'Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
    ]);
    curl_exec($ch2);
    curl_close($ch2);
}

json_out([
    'ok'          => true,
    'task_created'=> $taskCreated,
    'clickup_url' => 'https://app.clickup.com/t/' . $taskId,
]);
