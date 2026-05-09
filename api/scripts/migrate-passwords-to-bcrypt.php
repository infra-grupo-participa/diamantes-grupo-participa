<?php
/**
 * migrate-passwords-to-bcrypt.php
 *
 * One-time, idempotent script to migrate all plaintext passwords in
 * api/storage/app-state.json to bcrypt hashes.
 *
 * Safe to run multiple times: accounts that already have a bcrypt hash
 * (starts with "$2y$") are skipped. Accounts with an empty password sentinel
 * (seed-admin before setup-admin.php is run) are also skipped.
 *
 * Usage:
 *   php api/scripts/migrate-passwords-to-bcrypt.php
 *
 * Environment: runs in CLI context — no HTTP session needed.
 */

declare(strict_types=1);

// Bootstrap with a no-op session to avoid session_start() issues in CLI.
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run this script from the command line only.\n");
    exit(1);
}

// Stub out session functions for CLI context.
if (!function_exists('session_status')) {
    function session_status(): int { return PHP_SESSION_NONE; }
}

// Prevent the real session_start() from running in bootstrap.
define('GP_CLI_NO_SESSION', true);

// Patch: bootstrap checks session_status() before starting. In CLI, PHP_SESSION_NONE = 1,
// so session_start() would be called. We wrap it safely.
$_SERVER['REQUEST_METHOD'] = 'GET';

require_once __DIR__ . '/../bootstrap.php';

$stateFile = GP_STATE_FILE;
if (!is_file($stateFile)) {
    echo "[INFO] app-state.json not found — nothing to migrate.\n";
    exit(0);
}

$raw = file_get_contents($stateFile);
if ($raw === false) {
    fwrite(STDERR, "[ERROR] Cannot read {$stateFile}\n");
    exit(1);
}

$state = json_decode($raw, true);
if (!is_array($state)) {
    fwrite(STDERR, "[ERROR] Invalid JSON in {$stateFile}\n");
    exit(1);
}

$users = $state['users'] ?? [];
$migrated = 0;
$skipped = 0;
$skippedEmpty = 0;

foreach ($users as &$user) {
    $password = (string)($user['password'] ?? '');
    $id = (string)($user['id'] ?? 'unknown');
    $email = (string)($user['email'] ?? 'unknown');

    if ($password === '') {
        echo "[SKIP] {$email} ({$id}): empty sentinel — run setup-admin.php first.\n";
        $skippedEmpty++;
        continue;
    }

    if (str_starts_with($password, '$2')) {
        echo "[SKIP] {$email} ({$id}): already bcrypt.\n";
        $skipped++;
        continue;
    }

    // Plaintext detected — hash it.
    $hashed = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    $user['password'] = $hashed;
    $user['updatedAt'] = gmdate('Y-m-d\TH:i:s\Z');
    $migrated++;
    echo "[MIGRATED] {$email} ({$id}): plaintext → bcrypt.\n";

    gp_append_audit_log('password_migrated', [
        'userId' => $id,
        'email' => $email,
        'source' => 'migrate-passwords-to-bcrypt.php',
    ]);
}
unset($user);

if ($migrated === 0) {
    echo "\n[DONE] No passwords needed migration ({$skipped} already bcrypt, {$skippedEmpty} empty sentinel).\n";
    exit(0);
}

$state['users'] = $users;
$payload = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($payload === false) {
    fwrite(STDERR, "[ERROR] Failed to serialize state.\n");
    exit(1);
}

$tempFile = $stateFile . '.tmp';
if (file_put_contents($tempFile, $payload, LOCK_EX) === false || !rename($tempFile, $stateFile)) {
    @unlink($tempFile);
    fwrite(STDERR, "[ERROR] Failed to write {$stateFile}\n");
    exit(1);
}

echo "\n[DONE] Migrated {$migrated} password(s). Skipped {$skipped} (already bcrypt), {$skippedEmpty} (empty sentinel).\n";
exit(0);
