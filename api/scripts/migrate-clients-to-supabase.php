<?php

/**
 * migrate-clients-to-supabase.php
 *
 * Reads api/data/portals.json and UPSERTs each portal into public.clients
 * on Supabase (PostgREST).
 *
 * Idempotent: uses UPSERT with on_conflict=slug. Safe to re-run.
 *
 * Usage:
 *   php api/scripts/migrate-clients-to-supabase.php
 *   php api/scripts/migrate-clients-to-supabase.php --dry-run
 *
 * Required env vars:
 *   GP_SUPABASE_URL
 *   GP_SUPABASE_SERVICE_ROLE_KEY
 */

declare(strict_types=1);

require_once __DIR__ . '/../../vendor/autoload.php';

$isDryRun = in_array('--dry-run', $argv ?? [], true);

// ── Load env if .env present ──────────────────────────────────────────────────

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

// ── Validate configuration ────────────────────────────────────────────────────

$supabaseUrl = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
$serviceKey  = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));
$schema      = trim((string)(getenv('GP_SUPABASE_SCHEMA') ?: 'portal'));

if ($supabaseUrl === '' || $serviceKey === '') {
    fwrite(STDERR, "ERROR: GP_SUPABASE_URL and GP_SUPABASE_SERVICE_ROLE_KEY must be set.\n");
    exit(1);
}

// ── Load portals.json ─────────────────────────────────────────────────────────

$portalsFile = __DIR__ . '/../data/portals.json';
if (!is_file($portalsFile)) {
    fwrite(STDERR, "ERROR: {$portalsFile} not found.\n");
    exit(1);
}

$raw = file_get_contents($portalsFile);
if ($raw === false) {
    fwrite(STDERR, "ERROR: Cannot read {$portalsFile}.\n");
    exit(1);
}

$config = json_decode($raw, true);
if (!is_array($config) || !is_array($config['portals'] ?? null)) {
    fwrite(STDERR, "ERROR: Invalid portals.json format.\n");
    exit(1);
}

$portals = $config['portals'];
echo sprintf("Found %d portals in portals.json\n", count($portals));

if ($isDryRun) {
    echo "[DRY RUN] Would UPSERT " . count($portals) . " clients into Supabase.\n";
    foreach ($portals as $p) {
        echo "  - " . ($p['slug'] ?? '?') . " (" . ($p['display_name'] ?? '') . ")\n";
    }
    echo "[DRY RUN] No changes made.\n";
    exit(0);
}

// ── Build rows for Supabase ───────────────────────────────────────────────────

$rows = [];
foreach ($portals as $portal) {
    $slug = trim((string)($portal['slug'] ?? ''));
    if ($slug === '') {
        continue;
    }
    $rows[] = [
        'slug'         => $slug,
        'display_name' => (string)($portal['display_name'] ?? $slug),
        'config'       => [
            'cliente_name_var'     => (string)($portal['cliente_name_var'] ?? ''),
            'cliente_task_id'      => (string)($portal['cliente_task_id'] ?? ''),
            'cf_tipos'             => is_array($portal['cf_tipos'] ?? null) ? $portal['cf_tipos'] : [],
            'assignee_ids'         => is_array($portal['assignee_ids'] ?? null) ? $portal['assignee_ids'] : [],
            'auto_map'             => is_array($portal['auto_map'] ?? null) ? $portal['auto_map'] : [],
            'css_card_bg'          => (string)($portal['css_card_bg'] ?? '#ffffff'),
            'dropdown_indent_quirk' => (bool)($portal['dropdown_indent_quirk'] ?? true),
        ],
        'active'       => true,
    ];
}

// ── UPSERT via PostgREST ──────────────────────────────────────────────────────

$jsonPayload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($jsonPayload === false) {
    fwrite(STDERR, "ERROR: Failed to encode payload.\n");
    exit(1);
}

$ch = curl_init($supabaseUrl . '/rest/v1/clients?on_conflict=slug');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_CUSTOMREQUEST  => 'POST',
    CURLOPT_POSTFIELDS     => $jsonPayload,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_HTTPHEADER     => [
        'apikey: '         . $serviceKey,
        'Authorization: Bearer ' . $serviceKey,
        'Content-Type: application/json',
        'Accept-Profile: ' . $schema,
        'Content-Profile: ' . $schema,
        'Accept: application/json',
        'Prefer: resolution=merge-duplicates,return=minimal',
    ],
]);

$body   = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err    = curl_error($ch);
curl_close($ch);

if ($body === false || $err !== '') {
    fwrite(STDERR, "ERROR: curl failed: {$err}\n");
    exit(1);
}

if ($status < 200 || $status >= 300) {
    fwrite(STDERR, "ERROR: Supabase returned HTTP {$status}: {$body}\n");
    exit(1);
}

echo sprintf("OK: Upserted %d clients (HTTP %d).\n", count($rows), $status);
