<?php

/**
 * migrate-users-to-supabase.php
 *
 * Reads api/storage/app-state.json and copies all users to public.users
 * on Supabase (PostgREST).
 *
 * Idempotent: uses UPSERT with on_conflict=id. Safe to re-run.
 * bcrypt hashes are preserved as-is in password_hash column.
 *
 * Usage:
 *   php api/scripts/migrate-users-to-supabase.php
 *   php api/scripts/migrate-users-to-supabase.php --dry-run
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

// ── Load app-state.json ───────────────────────────────────────────────────────

$stateFile = __DIR__ . '/../storage/app-state.json';
if (!is_file($stateFile)) {
    fwrite(STDERR, "ERROR: {$stateFile} not found. Run the app at least once to generate it.\n");
    exit(1);
}

$raw = file_get_contents($stateFile);
if ($raw === false) {
    fwrite(STDERR, "ERROR: Cannot read {$stateFile}.\n");
    exit(1);
}

$state = json_decode($raw, true);
if (!is_array($state) || !is_array($state['users'] ?? null)) {
    fwrite(STDERR, "ERROR: Invalid app-state.json format.\n");
    exit(1);
}

$users = $state['users'];
echo sprintf("Found %d users in app-state.json\n", count($users));

if ($isDryRun) {
    echo "[DRY RUN] Would UPSERT " . count($users) . " users into Supabase.\n";
    foreach ($users as $u) {
        $email = (string)($u['email'] ?? '?');
        $role  = (string)($u['role'] ?? '?');
        echo "  - {$email} ({$role})\n";
    }
    echo "[DRY RUN] No changes made.\n";
    exit(0);
}

// ── Build rows ────────────────────────────────────────────────────────────────

$rows = [];
foreach ($users as $user) {
    if (!is_array($user)) {
        continue;
    }
    $id = trim((string)($user['id'] ?? ''));
    if ($id === '') {
        echo "WARNING: skipping user with empty id (email=" . ($user['email'] ?? '?') . ")\n";
        continue;
    }

    $rows[] = [
        'id'            => $id,
        'name'          => (string)($user['name'] ?? ''),
        'email'         => mb_strtolower(trim((string)($user['email'] ?? '')), 'UTF-8'),
        'password_hash' => (string)($user['password'] ?? ''),
        'role'          => (string)($user['role'] ?? 'client'),
        'status'        => (string)($user['status'] ?? 'pending'),
        'client_slug'   => (string)($user['clientSlug'] ?? ''),
        'meta'          => [
            'documentType'  => (string)($user['documentType'] ?? 'cpf'),
            'documentValue' => (string)($user['documentValue'] ?? ''),
            'cpf'           => (string)($user['cpf'] ?? ''),
        ],
        'created_at'    => (string)($user['createdAt'] ?? ''),
        'updated_at'    => (string)($user['updatedAt'] ?? ''),
    ];
}

// ── UPSERT via PostgREST ──────────────────────────────────────────────────────

if (empty($rows)) {
    echo "No users to migrate.\n";
    exit(0);
}

$jsonPayload = json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($jsonPayload === false) {
    fwrite(STDERR, "ERROR: Failed to encode payload.\n");
    exit(1);
}

$ch = curl_init($supabaseUrl . '/rest/v1/users?on_conflict=id');
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

echo sprintf("OK: Upserted %d users (HTTP %d).\n", count($rows), $status);
