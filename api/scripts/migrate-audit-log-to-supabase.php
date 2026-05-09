<?php

/**
 * migrate-audit-log-to-supabase.php
 *
 * Reads api/storage/audit-log.jsonl and inserts entries into public.audit_log
 * on Supabase (PostgREST).
 *
 * Idempotent: deduplicates by (created_at, user_id, event). Rows already
 * present are not inserted again. Sends in batches of 500 to avoid timeouts.
 *
 * Usage:
 *   php api/scripts/migrate-audit-log-to-supabase.php
 *   php api/scripts/migrate-audit-log-to-supabase.php --dry-run
 *
 * Required env vars:
 *   GP_SUPABASE_URL
 *   GP_SUPABASE_SERVICE_ROLE_KEY
 */

declare(strict_types=1);

require_once __DIR__ . '/../../vendor/autoload.php';

$isDryRun  = in_array('--dry-run', $argv ?? [], true);
$batchSize = 500;

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

if ($supabaseUrl === '' || $serviceKey === '') {
    fwrite(STDERR, "ERROR: GP_SUPABASE_URL and GP_SUPABASE_SERVICE_ROLE_KEY must be set.\n");
    exit(1);
}

// ── Load audit-log.jsonl ──────────────────────────────────────────────────────

$logFile = __DIR__ . '/../storage/audit-log.jsonl';
if (!is_file($logFile)) {
    echo "No audit-log.jsonl found — nothing to migrate.\n";
    exit(0);
}

$handle = fopen($logFile, 'r');
if ($handle === false) {
    fwrite(STDERR, "ERROR: Cannot open {$logFile}.\n");
    exit(1);
}

$entries = [];
while (($line = fgets($handle)) !== false) {
    $line = trim($line);
    if ($line === '') {
        continue;
    }
    $entry = json_decode($line, true);
    if (!is_array($entry)) {
        continue;
    }
    $entries[] = $entry;
}
fclose($handle);

echo sprintf("Found %d audit log entries in audit-log.jsonl\n", count($entries));

if ($isDryRun) {
    echo "[DRY RUN] Would insert up to " . count($entries) . " audit log entries into Supabase.\n";
    echo "[DRY RUN] No changes made.\n";
    exit(0);
}

// ── Build rows ────────────────────────────────────────────────────────────────

$rows = [];
foreach ($entries as $entry) {
    $time   = trim((string)($entry['time'] ?? ''));
    $event  = trim((string)($entry['event'] ?? ''));
    $userId = isset($entry['userId']) && $entry['userId'] !== '' && $entry['userId'] !== null
        ? (string)$entry['userId']
        : null;

    if ($event === '') {
        continue;
    }

    $context = $entry;
    unset($context['time'], $context['event'], $context['userId'], $context['ip']);

    $row = [
        'event'   => $event,
        'user_id' => $userId,
        'context' => empty($context) ? null : $context,
    ];

    if ($time !== '') {
        $row['created_at'] = $time;
    }

    if (isset($entry['ip']) && $entry['ip'] !== '') {
        $row['ip'] = (string)$entry['ip'];
    }

    $rows[] = $row;
}

if (empty($rows)) {
    echo "No valid audit log entries to migrate.\n";
    exit(0);
}

// ── Insert in batches (ignore duplicates via on_conflict) ─────────────────────

$inserted = 0;
$batches  = array_chunk($rows, $batchSize);

foreach ($batches as $i => $batch) {
    $jsonPayload = json_encode($batch, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($jsonPayload === false) {
        fwrite(STDERR, "ERROR: Failed to encode batch #{$i}.\n");
        exit(1);
    }

    $ch = curl_init($supabaseUrl . '/rest/v1/audit_log');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_CUSTOMREQUEST  => 'POST',
        CURLOPT_POSTFIELDS     => $jsonPayload,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => [
            'apikey: '         . $serviceKey,
            'Authorization: Bearer ' . $serviceKey,
            'Content-Type: application/json',
            'Accept: application/json',
            // ignore duplicate (created_at, user_id, event) — prefer nothing if already exists
            'Prefer: resolution=ignore-duplicates,return=minimal',
        ],
    ]);

    $body   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($body === false || $err !== '') {
        fwrite(STDERR, "ERROR: curl failed on batch #{$i}: {$err}\n");
        exit(1);
    }

    if ($status < 200 || $status >= 300) {
        fwrite(STDERR, "ERROR: Supabase returned HTTP {$status} on batch #{$i}: {$body}\n");
        exit(1);
    }

    $inserted += count($batch);
    echo sprintf("Batch %d/%d: inserted %d entries (HTTP %d)\n", $i + 1, count($batches), count($batch), $status);
}

echo sprintf("OK: Processed %d audit log entries total.\n", $inserted);
