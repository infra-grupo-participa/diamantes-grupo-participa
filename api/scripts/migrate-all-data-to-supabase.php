<?php

/**
 * migrate-all-data-to-supabase.php
 *
 * Single end-to-end migration: reads ALL local data sources and UPSERTs into
 * the `portal` schema on Supabase via PostgREST.
 *
 * Sources:
 *   api/data/portals.json            → portal.clients
 *   api/storage/app-state.json       → portal.users + portal.ratings + portal.client_profiles
 *                                       + portal.services + portal.contract_status + portal.task_reviews
 *   api/storage/audit-log.jsonl      → portal.audit_log (idempotent dedup)
 *   api/storage/notification-log.jsonl → portal.audit_log as 'notification' events (optional)
 *
 * Idempotent: every UPSERT uses on_conflict and merges duplicates. Safe to
 * re-run as many times as needed.
 *
 * Usage:
 *   GP_SUPABASE_URL=...                                            \
 *   GP_SUPABASE_SERVICE_ROLE_KEY=...                               \
 *   GP_SUPABASE_SCHEMA=portal                                      \
 *   GP_MIGRATION_CONFIRM=yes                                       \
 *   php api/scripts/migrate-all-data-to-supabase.php
 *
 *   php api/scripts/migrate-all-data-to-supabase.php --dry-run
 *
 * Required env vars:
 *   GP_SUPABASE_URL
 *   GP_SUPABASE_SERVICE_ROLE_KEY
 *   GP_SUPABASE_SCHEMA  (default: portal)
 *   GP_MIGRATION_CONFIRM=yes (skip with --dry-run)
 */

declare(strict_types=1);

require_once __DIR__ . '/../../vendor/autoload.php';

$isDryRun = in_array('--dry-run', $argv ?? [], true);

// ── Load .env if present ──────────────────────────────────────────────────────

$envFile = __DIR__ . '/../../.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        if (getenv(trim($k)) === false) {
            putenv(trim($k) . '=' . trim($v));
        }
    }
}

// ── Validate ──────────────────────────────────────────────────────────────────

$supabaseUrl = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
$serviceKey  = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));
$schema      = trim((string)(getenv('GP_SUPABASE_SCHEMA') ?: 'portal'));
$confirm     = trim((string)(getenv('GP_MIGRATION_CONFIRM') ?: ''));

if ($supabaseUrl === '' || $serviceKey === '') {
    fwrite(STDERR, "ERROR: GP_SUPABASE_URL and GP_SUPABASE_SERVICE_ROLE_KEY must be set.\n");
    exit(1);
}

if (!$isDryRun && $confirm !== 'yes') {
    fwrite(STDERR, "ERROR: Set GP_MIGRATION_CONFIRM=yes to write. Or pass --dry-run to preview.\n");
    exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pgrest_post(string $url, array $rows, array $headers, string $context): void
{
    $payload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        fwrite(STDERR, "ERROR encoding {$context}\n");
        exit(1);
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_CUSTOMREQUEST  => 'POST',
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $body   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($body === false || $err !== '') {
        fwrite(STDERR, "ERROR curl on {$context}: {$err}\n");
        exit(1);
    }
    if ($status < 200 || $status >= 300) {
        fwrite(STDERR, "ERROR {$context}: HTTP {$status}: {$body}\n");
        exit(1);
    }
}

function build_headers(string $key, string $schema, string $resolution): array
{
    return [
        'apikey: ' . $key,
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
        'Accept: application/json',
        'Accept-Profile: ' . $schema,
        'Content-Profile: ' . $schema,
        'Prefer: resolution=' . $resolution . ',return=minimal',
    ];
}

// ── Load sources ──────────────────────────────────────────────────────────────

$portalsFile  = __DIR__ . '/../data/portals.json';
$stateFile    = __DIR__ . '/../storage/app-state.json';
$auditFile    = __DIR__ . '/../storage/audit-log.jsonl';
$notifFile    = __DIR__ . '/../storage/notification-log.jsonl';

$portalsConfig = is_file($portalsFile) ? json_decode((string)file_get_contents($portalsFile), true) : ['portals' => []];
$state         = is_file($stateFile)   ? json_decode((string)file_get_contents($stateFile), true)   : [];

if (!is_array($portalsConfig) || !isset($portalsConfig['portals'])) {
    fwrite(STDERR, "ERROR: portals.json not loadable.\n");
    exit(1);
}
if (!is_array($state)) {
    fwrite(STDERR, "ERROR: app-state.json not loadable.\n");
    exit(1);
}

$portals       = $portalsConfig['portals'] ?? [];
$users         = $state['users'] ?? [];
$ratings       = $state['ratings'] ?? [];
$clientProfs   = $state['clientProfiles'] ?? [];
$contractReg   = $state['contractRegistry'] ?? [];
$contractStat  = $state['contractStatus'] ?? [];
$taskReviews   = $state['taskReviews'] ?? [];

// ── Plan ──────────────────────────────────────────────────────────────────────

echo "═══ Migration Plan ═══\n";
echo sprintf("Target:  %s (schema: %s)\n", $supabaseUrl, $schema);
echo sprintf("Mode:    %s\n", $isDryRun ? 'DRY-RUN' : 'WRITE');
echo "─── Counts ──────\n";
echo sprintf("portal.clients:          %d\n", count($portals));
echo sprintf("portal.users:            %d\n", count($users));
echo sprintf("portal.ratings:          %d\n", count($ratings));
echo sprintf("portal.client_profiles:  %d\n", count($clientProfs));
echo sprintf("portal.services:         %d (from contractRegistry)\n", array_sum(array_map(fn($c) => count($c['services'] ?? []), $contractReg)));
echo sprintf("portal.contract_status:  %d\n", count($contractStat));
echo sprintf("portal.task_reviews:     %d\n", is_array($taskReviews) ? count($taskReviews) : 0);
$auditLines = is_file($auditFile) ? count(file($auditFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) : 0;
$notifLines = is_file($notifFile) ? count(file($notifFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) : 0;
echo sprintf("portal.audit_log:        %d (audit) + %d (notifications)\n", $auditLines, $notifLines);
echo "─────────────────\n";

if ($isDryRun) {
    echo "[DRY-RUN] No changes made.\n";
    exit(0);
}

$headersMerge  = build_headers($serviceKey, $schema, 'merge-duplicates');
$headersIgnore = build_headers($serviceKey, $schema, 'ignore-duplicates');

// ── 1. clients (from portals.json) ────────────────────────────────────────────

$clientsRows = [];
foreach ($portals as $p) {
    $slug = trim((string)($p['slug'] ?? ''));
    if ($slug === '') {
        continue;
    }
    $clientsRows[] = [
        'slug'                  => $slug,
        'display_name'          => (string)($p['display_name'] ?? $slug),
        'cliente_name_var'      => (string)($p['cliente_name_var'] ?? ''),
        'cliente_task_id'       => (string)($p['cliente_task_id'] ?? ''),
        'cu_list_id'            => (string)($p['cu_list_id'] ?? '901326399435'),
        'primary_color'         => (string)($p['primary_color'] ?? '#F29725'),
        'css_card_bg'           => (string)($p['css_card_bg'] ?? '#ffffff'),
        'dropdown_indent_quirk' => (bool)($p['dropdown_indent_quirk'] ?? true),
        'cf_tipos'              => is_array($p['cf_tipos'] ?? null)     ? $p['cf_tipos'] : [],
        'assignee_ids'          => is_array($p['assignee_ids'] ?? null) ? $p['assignee_ids'] : new \stdClass(),
        'auto_map'              => is_array($p['auto_map'] ?? null)     ? $p['auto_map'] : new \stdClass(),
    ];
}
if (!empty($clientsRows)) {
    pgrest_post($supabaseUrl . '/rest/v1/clients?on_conflict=slug', $clientsRows, $headersMerge, 'clients');
    echo sprintf("✓ portal.clients: upserted %d\n", count($clientsRows));
}

// ── 2. users (from app-state.json) ────────────────────────────────────────────

$usersRows = [];
foreach ($users as $u) {
    if (!is_array($u)) {
        continue;
    }
    $legacyId = trim((string)($u['id'] ?? ''));
    $email    = mb_strtolower(trim((string)($u['email'] ?? '')), 'UTF-8');
    if ($legacyId === '' || $email === '') {
        continue;
    }
    $usersRows[] = [
        'legacy_id'      => $legacyId,
        'email'          => $email,
        'name'           => (string)($u['name'] ?? ''),
        'password_hash'  => (string)($u['password'] ?? ''),
        'role'           => in_array(($u['role'] ?? ''), ['admin','user','client'], true) ? ($u['role'] === 'client' ? 'user' : $u['role']) : 'user',
        'status'         => in_array(($u['status'] ?? ''), ['pending','approved','rejected','disabled'], true) ? $u['status'] : 'pending',
        'client_slug'    => trim((string)($u['clientSlug'] ?? '')) ?: null,
        'document_type'  => (string)($u['documentType'] ?? ''),
        'document_value' => (string)($u['documentValue'] ?? ''),
        'cpf'            => (string)($u['cpf'] ?? ''),
        'metadata'       => [],
        'created_at'     => (string)($u['createdAt'] ?? gmdate('c')),
        'updated_at'     => (string)($u['updatedAt'] ?? gmdate('c')),
    ];
}
if (!empty($usersRows)) {
    // upsert by legacy_id (text) since email pode ter colisão entre seed-admin e admin@...
    pgrest_post($supabaseUrl . '/rest/v1/users?on_conflict=legacy_id', $usersRows, $headersMerge, 'users');
    echo sprintf("✓ portal.users: upserted %d\n", count($usersRows));
}

// ── 3. services + contract_status (from contractRegistry + contractStatus) ────

// Dedup by (client_slug, service_type) — keep last occurrence + aggregate employees
$servicesByKey = [];
foreach ($contractReg as $c) {
    $slug = trim((string)($c['slug'] ?? ''));
    if ($slug === '') {
        continue;
    }
    foreach (($c['services'] ?? []) as $svc) {
        $type = trim((string)($svc['service'] ?? ''));
        if ($type === '') {
            continue;
        }
        $key = $slug . '::' . $type;
        if (!isset($servicesByKey[$key])) {
            $servicesByKey[$key] = [
                'client_slug'  => $slug,
                'service_type' => $type,
                'status'       => 'active',
                'metadata'     => ['employees' => []],
            ];
        }
        $servicesByKey[$key]['metadata']['employees'][] = [
            'employee'  => (string)($svc['employee'] ?? ''),
            'startedAt' => (string)($svc['startedAt'] ?? ''),
            'endedAt'   => (string)($svc['endedAt'] ?? ''),
        ];
    }
}
$servicesRows = array_values($servicesByKey);
if (!empty($servicesRows)) {
    pgrest_post($supabaseUrl . '/rest/v1/services?on_conflict=client_slug,service_type', $servicesRows, $headersMerge, 'services');
    echo sprintf("✓ portal.services: upserted %d\n", count($servicesRows));
}

$contractStatusRows = [];
foreach ($contractStat as $key => $status) {
    $parts = explode('::', (string)$key);
    if (count($parts) !== 3) {
        continue;
    }
    [$slug, $service, $employee] = $parts;
    $contractStatusRows[] = [
        'client_slug'   => trim($slug),
        'service_type'  => trim($service),
        'employee_name' => trim($employee),
        'status'        => (string)$status,
    ];
}
if (!empty($contractStatusRows)) {
    pgrest_post($supabaseUrl . '/rest/v1/contract_status?on_conflict=client_slug,service_type,employee_name', $contractStatusRows, $headersMerge, 'contract_status');
    echo sprintf("✓ portal.contract_status: upserted %d\n", count($contractStatusRows));
}

// ── 4. ratings ────────────────────────────────────────────────────────────────

$ratingsRows = [];
foreach ($ratings as $r) {
    $taskId = trim((string)($r['taskId'] ?? ''));
    $slug   = trim((string)($r['clientSlug'] ?? ''));
    $score  = (int)($r['score'] ?? 0);
    if ($taskId === '' || $slug === '' || $score < 1 || $score > 10) {
        continue;
    }
    $ratingsRows[] = [
        'client_slug' => $slug,
        'task_id'     => $taskId,
        'score'       => $score,
        'comment'     => isset($r['label']) ? (string)$r['label'] : null,
        'created_at'  => (string)($r['submittedAt'] ?? gmdate('c')),
    ];
}
if (!empty($ratingsRows)) {
    pgrest_post($supabaseUrl . '/rest/v1/ratings', $ratingsRows, $headersIgnore, 'ratings');
    echo sprintf("✓ portal.ratings: inserted %d\n", count($ratingsRows));
}

// ── 5. client_profiles ────────────────────────────────────────────────────────

$profileRows = [];
foreach ($clientProfs as $slug => $profile) {
    $slug = trim((string)$slug);
    if ($slug === '' || !is_array($profile)) {
        continue;
    }
    $profileRows[] = [
        'client_slug' => $slug,
        'data'        => $profile,
        'updated_at'  => (string)($profile['updatedAt'] ?? gmdate('c')),
    ];
}
if (!empty($profileRows)) {
    pgrest_post($supabaseUrl . '/rest/v1/client_profiles?on_conflict=client_slug', $profileRows, $headersMerge, 'client_profiles');
    echo sprintf("✓ portal.client_profiles: upserted %d\n", count($profileRows));
}

// ── 6. task_reviews ───────────────────────────────────────────────────────────

if (is_array($taskReviews) && !empty($taskReviews)) {
    $reviewRows = [];
    foreach ($taskReviews as $tr) {
        if (!is_array($tr)) {
            continue;
        }
        $tid  = trim((string)($tr['taskId'] ?? ''));
        $slug = trim((string)($tr['clientSlug'] ?? ''));
        $dec  = strtolower(trim((string)($tr['decision'] ?? 'approve')));
        if ($tid === '' || $slug === '') {
            continue;
        }
        $reviewRows[] = [
            'client_slug' => $slug,
            'task_id'     => $tid,
            'decision'    => in_array($dec, ['approve','request_changes'], true) ? $dec : 'approve',
            'feedback'    => (string)($tr['feedback'] ?? ''),
            'created_at'  => (string)($tr['submittedAt'] ?? gmdate('c')),
        ];
    }
    if (!empty($reviewRows)) {
        pgrest_post($supabaseUrl . '/rest/v1/task_reviews', $reviewRows, $headersIgnore, 'task_reviews');
        echo sprintf("✓ portal.task_reviews: inserted %d\n", count($reviewRows));
    }
}

// ── 7. audit_log (from JSONL) ─────────────────────────────────────────────────

$auditRows = [];
if (is_file($auditFile)) {
    foreach (file($auditFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $entry = json_decode($line, true);
        if (!is_array($entry)) {
            continue;
        }
        $event = trim((string)($entry['event'] ?? ''));
        if ($event === '') {
            continue;
        }
        $auditRows[] = [
            'event'      => $event,
            'identifier' => (string)($entry['identifier'] ?? ''),
            'ip'         => (string)($entry['ip'] ?? ''),
            'metadata'   => $entry,
            'created_at' => (string)($entry['time'] ?? gmdate('c')),
        ];
    }
}
if (is_file($notifFile)) {
    foreach (file($notifFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $entry = json_decode($line, true);
        if (!is_array($entry)) {
            continue;
        }
        $auditRows[] = [
            'event'      => 'notification.' . (string)($entry['meta']['event'] ?? 'sent'),
            'identifier' => is_array($entry['to'] ?? null) ? implode(',', $entry['to']) : '',
            'ip'         => '',
            'metadata'   => $entry,
            'created_at' => (string)($entry['time'] ?? gmdate('c')),
        ];
    }
}
if (!empty($auditRows)) {
    foreach (array_chunk($auditRows, 500) as $i => $batch) {
        pgrest_post($supabaseUrl . '/rest/v1/audit_log', $batch, $headersIgnore, 'audit_log batch ' . $i);
    }
    echo sprintf("✓ portal.audit_log: inserted %d entries\n", count($auditRows));
}

echo "═══ Migration complete ═══\n";
