<?php
/**
 * portal/index.php — Unified portal endpoint (Fase 3)
 *
 * Resolves HIGH-2: server-side auth guard replaces client-side-only protection.
 * Admin may view any slug; a client user may only view their own clientSlug.
 *
 * Security:
 *  - Slug validated with strict regex before use as array key (no path traversal).
 *  - Strings rendered into HTML with htmlspecialchars(ENT_QUOTES, UTF-8).
 *  - JS objects/arrays rendered with json_encode + JSON_HEX_* flags (XSS-safe).
 *  - Template path is a fixed constant — no user input touches the filesystem.
 */
declare(strict_types=1);

require_once __DIR__ . '/../api/bootstrap.php';

// ── 1. Auth guard ────────────────────────────────────────────────────────────

$user = gp_get_session_user();
if (!$user) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Sessão inválida. Faça login em /index.html');
}

// ── 2. Slug resolution & validation ─────────────────────────────────────────

$requestedSlug = isset($_GET['slug']) ? (string)$_GET['slug'] : '';
$userSlug      = (string)($user['clientSlug'] ?? '');

// Reject slugs that could traverse the filesystem or inject values.
if ($requestedSlug !== '' && !preg_match('/^[a-z][a-z0-9-]+$/', $requestedSlug)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Slug inválido.');
}

$isAdmin = ($user['role'] ?? '') === 'admin';

if (!$isAdmin) {
    // Non-admin: status must be 'approved' AND only their own slug.
    if (($user['status'] ?? '') !== 'approved') {
        http_response_code(403);
        header('Content-Type: text/plain; charset=UTF-8');
        exit('Acesso negado. Sua conta ainda não foi aprovada.');
    }
    if ($requestedSlug !== '' && $requestedSlug !== $userSlug) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=UTF-8');
        exit('Acesso negado. Você não tem permissão para acessar este portal.');
    }
    $effectiveSlug = $userSlug;
} else {
    // Admin: use requested slug, fall back to userSlug, then nothing.
    $effectiveSlug = $requestedSlug !== '' ? $requestedSlug : $userSlug;
}

if ($effectiveSlug === '') {
    http_response_code(400);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Slug não informado. Sua conta não está vinculada a um cliente.');
}

// ── 3. Load portal config ────────────────────────────────────────────────────
//
// GP_PORTALS_SOURCE=supabase → load from Supabase via StorageDriver
//                   json     → (default) load from api/data/portals.json
//
// Falls back to JSON if the Supabase driver is unavailable.

$portalsSource = strtolower(trim((string)(getenv('GP_PORTALS_SOURCE') ?: 'json')));

$portal = null;

if ($portalsSource === 'supabase') {
    try {
        $portal = \Diamantes\Container::getInstance()->storage()->findClientBySlug($effectiveSlug);
    } catch (\Throwable $supabaseError) {
        // Log and fall back to JSON so production stays up even if DB is unavailable.
        error_log('[portal/index.php] Supabase findClientBySlug failed, falling back to JSON: ' . $supabaseError->getMessage());
        $portalsSource = 'json';
    }
}

if ($portalsSource !== 'supabase') {
    $portalsFile = __DIR__ . '/../api/data/portals.json';
    $portalsRaw  = @file_get_contents($portalsFile);
    if ($portalsRaw === false) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=UTF-8');
        exit('Erro interno: configuração de portais não encontrada.');
    }

    $portalsConfig = json_decode($portalsRaw, true);
    if (!is_array($portalsConfig) || !is_array($portalsConfig['portals'] ?? null)) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=UTF-8');
        exit('Erro interno: formato de portais inválido.');
    }

    foreach ($portalsConfig['portals'] as $p) {
        if (is_array($p) && ($p['slug'] ?? '') === $effectiveSlug) {
            $portal = $p;
            break;
        }
    }
}

if ($portal === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Portal não encontrado: ' . htmlspecialchars($effectiveSlug, ENT_QUOTES, 'UTF-8'));
}

// ── 4. Build replacements ────────────────────────────────────────────────────

$jsonFlags = JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT;

$displayName     = htmlspecialchars((string)($portal['display_name'] ?? ''), ENT_QUOTES, 'UTF-8');
$clientNameVar   = htmlspecialchars((string)($portal['cliente_name_var'] ?? ''), ENT_QUOTES, 'UTF-8');
$clientTaskId    = htmlspecialchars((string)($portal['cliente_task_id'] ?? ''), ENT_QUOTES, 'UTF-8');

// CF_TIPO_OPTIONS: {key: null} object (keys are tipo names, values always null)
// The legacy portals render this as multi-line JS object literal (4-space indent, CRLF).
// We replicate that exact format so the rendered HTML is byte-identical to legacy.
$cfTipos = [];
foreach ((array)($portal['cf_tipos'] ?? []) as $tipo) {
    $cfTipos[(string)$tipo] = null;
}

// gp_portal_object_literal() is defined in api/bootstrap.php.
$cfTiposJson  = gp_portal_object_literal($cfTipos);
$assigneeIds  = gp_portal_object_literal((array)($portal['assignee_ids'] ?? []));
$autoMap      = gp_portal_object_literal((array)($portal['auto_map'] ?? []));

// Build HTML dropdown options from the same source data (cf_tipos for tipo dropdown,
// assignee_ids for prestador dropdown), preserving insertion order.
//
// Most legacy portals have a 28-space indent on the FIRST option and 14-space on the rest.
// Two exceptions use consistent 14-space: isabela-teixeira (and alessandro-lima with 1 option).
// We replicate this exactly — controlled via portals.json dropdown_indent_quirk field.
$hasIndentQuirk = (bool)($portal['dropdown_indent_quirk'] ?? true);
$firstIndent = $hasIndentQuirk ? '                            ' : '              ';
$restIndent  = '              ';

$tipoOptionsHtml = '';
$tipoFirst = true;
foreach (array_keys($cfTipos) as $tipo) {
    $esc = htmlspecialchars($tipo, ENT_QUOTES, 'UTF-8');
    $indent = $tipoFirst ? $firstIndent : $restIndent;
    $tipoFirst = false;
    $tipoOptionsHtml .= $indent . '<div class="option" data-value="' . $esc . '">' . $esc . '</div>' . "\r\n";
}

$prestadorOptionsHtml = '';
$prestFirst = true;
foreach (array_keys((array)($portal['assignee_ids'] ?? [])) as $name) {
    $esc = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
    $indent = $prestFirst ? $firstIndent : $restIndent;
    $prestFirst = false;
    $prestadorOptionsHtml .= $indent . '<div class="option" data-value="' . $esc . '">' . $esc . '</div>' . "\r\n";
}

// Strip trailing newline from option blocks to preserve original whitespace contract.
$tipoOptionsHtml      = rtrim($tipoOptionsHtml, "\r\n");
$prestadorOptionsHtml = rtrim($prestadorOptionsHtml, "\r\n");

// ── 5. Load and render template ──────────────────────────────────────────────

$templatePath = __DIR__ . '/template.html';
$tpl = @file_get_contents($templatePath);
if ($tpl === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Erro interno: template não encontrado.');
}

// css_card_bg: controls 3 CSS rules that differ between portals (bartira-paes, fabiana-parro
// use #050505 while all others use #ffffff). Validated to only allow safe hex color values.
$cssCardBgRaw = trim((string)($portal['css_card_bg'] ?? '#ffffff'));
$cssCardBg    = preg_match('/^#[0-9a-fA-F]{3,6}$/', $cssCardBgRaw) ? $cssCardBgRaw : '#ffffff';

$replacements = [
    '{{DISPLAY_NAME}}'           => $displayName,
    '{{CLIENTE_NAME_VAR}}'       => $clientNameVar,
    '{{CLIENTE_TASK_ID}}'        => $clientTaskId,
    '{{CF_TIPOS_JSON}}'          => $cfTiposJson,
    '{{ASSIGNEE_IDS_JSON}}'      => $assigneeIds,
    '{{AUTO_MAP_JSON}}'          => $autoMap,
    '{{TIPO_OPTIONS_HTML}}'      => $tipoOptionsHtml,
    '{{PRESTADOR_OPTIONS_HTML}}' => $prestadorOptionsHtml,
    '{{CSS_CARD_BG}}'            => $cssCardBg,
];

$html = strtr($tpl, $replacements);

// ── 6. Audit log (admin viewing other client's portal flagged separately) ───

$crossView = $isAdmin && $effectiveSlug !== $userSlug && $userSlug !== '';
gp_append_audit_log($crossView ? 'portal_admin_cross_view' : 'portal_accessed', [
    'slug' => $effectiveSlug,
    'userId' => $user['id'] ?? null,
    'isAdmin' => $isAdmin,
]);

// ── 7. Send response ─────────────────────────────────────────────────────────

header('Content-Type: text/html; charset=UTF-8');
// No-cache: portal config may change; each load fetches fresh server-side data.
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

echo $html;
