<?php

/**
 * migrate-all-to-supabase.php — Master migration orchestrator
 *
 * Runs the three migration scripts in sequence:
 *   1. migrate-clients-to-supabase.php
 *   2. migrate-users-to-supabase.php
 *   3. migrate-audit-log-to-supabase.php
 *
 * Requires GP_MIGRATION_CONFIRM=yes to run without --dry-run to prevent
 * accidental execution.
 *
 * Usage:
 *   GP_MIGRATION_CONFIRM=yes php api/scripts/migrate-all-to-supabase.php
 *   php api/scripts/migrate-all-to-supabase.php --dry-run
 *
 * Required env vars:
 *   GP_SUPABASE_URL
 *   GP_SUPABASE_SERVICE_ROLE_KEY
 *   GP_MIGRATION_CONFIRM=yes  (required for live run)
 */

declare(strict_types=1);

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

// ── Safety check ──────────────────────────────────────────────────────────────

$confirm = strtolower(trim((string)(getenv('GP_MIGRATION_CONFIRM') ?: '')));

if (!$isDryRun && $confirm !== 'yes') {
    fwrite(STDERR, "ERROR: Set GP_MIGRATION_CONFIRM=yes to run the live migration.\n");
    fwrite(STDERR, "       Use --dry-run to preview without making changes.\n");
    exit(1);
}

// ── Execute scripts in sequence ───────────────────────────────────────────────

$scripts = [
    'migrate-clients-to-supabase.php',
    'migrate-users-to-supabase.php',
    'migrate-audit-log-to-supabase.php',
];

$scriptDir = __DIR__;
$mode      = $isDryRun ? '[DRY RUN] ' : '';

echo "=============================================================\n";
echo "{$mode}Diamantes → Supabase Migration\n";
echo "=============================================================\n\n";

foreach ($scripts as $script) {
    $scriptPath = $scriptDir . '/' . $script;
    if (!is_file($scriptPath)) {
        fwrite(STDERR, "ERROR: Script not found: {$scriptPath}\n");
        exit(1);
    }

    echo "--- {$mode}Running: {$script} ---\n";

    $cmd  = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg($scriptPath);
    if ($isDryRun) {
        $cmd .= ' --dry-run';
    }

    // Forward GP_* env vars to sub-process.
    $envVars = '';
    foreach (['GP_SUPABASE_URL', 'GP_SUPABASE_SERVICE_ROLE_KEY'] as $envKey) {
        $val = getenv($envKey);
        if ($val !== false && $val !== '') {
            $envVars .= escapeshellarg("{$envKey}={$val}") . ' ';
        }
    }

    passthru($cmd, $exitCode);

    if ($exitCode !== 0) {
        fwrite(STDERR, "\nERROR: {$script} failed with exit code {$exitCode}. Aborting.\n");
        exit($exitCode);
    }

    echo "\n";
}

echo "=============================================================\n";
echo "{$mode}Migration complete.\n";
echo "=============================================================\n";
