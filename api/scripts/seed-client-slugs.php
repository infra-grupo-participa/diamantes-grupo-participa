<?php
/**
 * seed-client-slugs.php — Idempotent migration: assign clientSlug to existing users.
 *
 * Reads all users in app-state.json. For each user without a clientSlug:
 *   1. Attempts to match by email against display_name or cliente_name_var in portals.json.
 *   2. On match: sets clientSlug.
 *   3. On no match: logs a warning and leaves clientSlug empty.
 *
 * Also supports seeding a specific user via env var (useful in test setup):
 *   GP_SEED_USER_EMAIL=foo@example.com GP_SEED_USER_SLUG=some-slug php seed-client-slugs.php
 *
 * Usage:
 *   php api/scripts/seed-client-slugs.php
 *   php api/scripts/seed-client-slugs.php --dry-run
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run this script from the command line only.\n");
    exit(1);
}

$_SERVER['REQUEST_METHOD'] = 'GET';
require_once __DIR__ . '/../bootstrap.php';

$dryRun = in_array('--dry-run', $argv ?? [], true);
if ($dryRun) {
    echo "[INFO] Dry-run mode: no changes will be written.\n";
}

// ── Load portals config ──────────────────────────────────────────────────────

$portalsFile = GP_DATA_DIR . '/portals.json';
if (!is_file($portalsFile)) {
    fwrite(STDERR, "[ERROR] portals.json not found at {$portalsFile}\n");
    exit(1);
}

$portalsData = json_decode((string)file_get_contents($portalsFile), true);
if (!is_array($portalsData) || !is_array($portalsData['portals'] ?? null)) {
    fwrite(STDERR, "[ERROR] portals.json has unexpected format.\n");
    exit(1);
}

/** @var array<string, string> $slugByNormalizedName  normalizedName => slug */
$slugByNormalizedName = [];
foreach ($portalsData['portals'] as $portal) {
    $slug        = strtolower(trim((string)($portal['slug'] ?? '')));
    $displayName = strtolower(trim((string)($portal['display_name'] ?? '')));
    $clienteName = strtolower(trim((string)($portal['cliente_name_var'] ?? '')));

    if ($slug === '') continue;
    if ($displayName !== '') $slugByNormalizedName[$displayName] = $slug;
    if ($clienteName !== '') $slugByNormalizedName[$clienteName] = $slug;
}

// ── Single-user override from env ────────────────────────────────────────────

$envUserEmail = trim((string)(getenv('GP_SEED_USER_EMAIL') ?: ''));
$envUserSlug  = trim((string)(getenv('GP_SEED_USER_SLUG') ?: ''));

// ── Helper: guess slug from user record ──────────────────────────────────────

function guessSlug(array $user, array $slugByNormalizedName): ?string
{
    // Try matching the local part of the email (before @) against portal names.
    $email = strtolower(trim((string)($user['email'] ?? '')));
    $name  = strtolower(trim((string)($user['name'] ?? '')));

    // Direct name match
    if ($name !== '' && isset($slugByNormalizedName[$name])) {
        return $slugByNormalizedName[$name];
    }

    // Email local part match (e.g. "joao.carlos@..." -> try "joao carlos lima" variants)
    $localPart = strtok($email, '@');
    if ($localPart) {
        $localNorm = str_replace(['.', '_', '-'], ' ', $localPart);
        if (isset($slugByNormalizedName[$localNorm])) {
            return $slugByNormalizedName[$localNorm];
        }
    }

    return null;
}

// ── Process users ─────────────────────────────────────────────────────────────

$state   = gp_read_state();
$users   = $state['users'] ?? [];
$updated = 0;
$skipped = 0;
$noMatch = 0;

foreach ($users as $idx => $user) {
    $userId = (string)($user['id'] ?? '');
    $email  = (string)($user['email'] ?? '');
    $role   = (string)($user['role'] ?? '');

    // Skip admin accounts — they have no client slug.
    if ($role === 'admin' || gp_is_seed_admin_record($user)) {
        echo "[SKIP]    {$email} (admin)\n";
        $skipped++;
        continue;
    }

    // Already has a slug — idempotent.
    if (!empty($user['clientSlug'])) {
        echo "[SKIP]    {$email} (already has slug: {$user['clientSlug']})\n";
        $skipped++;
        continue;
    }

    // Env override for specific user.
    $targetSlug = null;
    if ($envUserEmail !== '' && gp_normalize_email($email) === gp_normalize_email($envUserEmail)) {
        $targetSlug = $envUserSlug !== '' ? $envUserSlug : null;
    }

    // Auto-match.
    if ($targetSlug === null) {
        $targetSlug = guessSlug($user, $slugByNormalizedName);
    }

    if ($targetSlug === null) {
        fwrite(STDERR, "[WARN]    {$email} — no slug match found. Set clientSlug manually.\n");
        $noMatch++;
        continue;
    }

    echo "[SET]     {$email} -> {$targetSlug}\n";
    $updated++;

    if (!$dryRun) {
        gp_update_state(function (array $s) use ($userId, $targetSlug) {
            foreach ($s['users'] as $k => $u) {
                if (($u['id'] ?? '') === $userId) {
                    $s['users'][$k] = gp_normalize_user(array_merge($u, ['clientSlug' => $targetSlug]));
                    break;
                }
            }
            return [$s, null];
        });
    }
}

echo "\n[DONE] Updated: {$updated}, Skipped: {$skipped}, No match: {$noMatch}\n";
if ($noMatch > 0) {
    echo "       Users with no match need manual clientSlug assignment via the admin panel.\n";
}
exit(0);
