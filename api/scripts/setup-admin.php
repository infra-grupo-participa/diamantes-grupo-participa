<?php
/**
 * setup-admin.php
 *
 * Creates or updates the admin account from environment variables.
 * Must be run once after deployment to set a real password on the
 * seed-admin account (which ships with an empty sentinel password).
 *
 * Required environment variables:
 *   GP_BOOTSTRAP_ADMIN_EMAIL    — email/identifier for the admin account
 *   GP_BOOTSTRAP_ADMIN_PASSWORD — password (min 8 chars)
 *
 * Optional environment variables:
 *   GP_BOOTSTRAP_USER_CLIENT_SLUG — if set, creates/updates a *client* user (not admin)
 *                                    with this clientSlug. Useful for seeding test users.
 *                                    Requires GP_BOOTSTRAP_ADMIN_EMAIL + GP_BOOTSTRAP_ADMIN_PASSWORD
 *                                    to be set for the client user credentials.
 *
 * Behaviour:
 *   - If the seed-admin already has a real bcrypt hash AND the env vars match
 *     (i.e. the script has been run before), it exits with a "nothing to do" message.
 *   - Otherwise it sets the email and bcrypt-hashed password on the seed-admin record.
 *   - Idempotent: safe to run multiple times (re-running updates the password).
 *   - With GP_BOOTSTRAP_USER_CLIENT_SLUG: creates/updates a client user instead.
 *
 * Usage:
 *   GP_BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
 *   GP_BOOTSTRAP_ADMIN_PASSWORD=your-strong-password \
 *   php api/scripts/setup-admin.php
 *
 *   # Create a test client user linked to a portal:
 *   GP_BOOTSTRAP_ADMIN_EMAIL=client@example.com \
 *   GP_BOOTSTRAP_ADMIN_PASSWORD=password123 \
 *   GP_BOOTSTRAP_USER_CLIENT_SLUG=joao-eduardo-zanela \
 *   php api/scripts/setup-admin.php
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run this script from the command line only.\n");
    exit(1);
}

$_SERVER['REQUEST_METHOD'] = 'GET';

require_once __DIR__ . '/../bootstrap.php';

$adminEmail = trim((string)(getenv('GP_BOOTSTRAP_ADMIN_EMAIL') ?: ''));
$adminPassword = (string)(getenv('GP_BOOTSTRAP_ADMIN_PASSWORD') ?: '');
$clientSlug = trim((string)(getenv('GP_BOOTSTRAP_USER_CLIENT_SLUG') ?: ''));

if ($adminEmail === '') {
    fwrite(STDERR, "[ERROR] GP_BOOTSTRAP_ADMIN_EMAIL is not set.\n");
    fwrite(STDERR, "Usage: GP_BOOTSTRAP_ADMIN_EMAIL=admin@example.com GP_BOOTSTRAP_ADMIN_PASSWORD=... php api/scripts/setup-admin.php\n");
    exit(1);
}

if (strlen($adminPassword) < 8) {
    fwrite(STDERR, "[ERROR] GP_BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.\n");
    exit(1);
}

// ── Client user mode (GP_BOOTSTRAP_USER_CLIENT_SLUG set) ────────────────────

if ($clientSlug !== '') {
    $state = gp_read_state();
    $normalizedEmail = gp_normalize_email($adminEmail);
    $existingUser = gp_find_user_by_identifier($state, $normalizedEmail);

    gp_update_state(function (array $s) use ($normalizedEmail, $adminPassword, $clientSlug, $existingUser) {
        $hash = password_hash($adminPassword, PASSWORD_BCRYPT, ['cost' => 12]);
        if ($existingUser) {
            // Update existing user.
            foreach ($s['users'] as $k => $u) {
                if (gp_normalize_email((string)($u['email'] ?? '')) === $normalizedEmail) {
                    $s['users'][$k] = gp_normalize_user(array_merge($u, [
                        'password'   => $hash,
                        'role'       => 'client',
                        'status'     => 'approved',
                        'clientSlug' => $clientSlug,
                        'updatedAt'  => gp_now_iso(),
                    ]));
                    break;
                }
            }
        } else {
            // Create new client user.
            $newUser = gp_normalize_user([
                'name'          => $normalizedEmail,
                'email'         => $normalizedEmail,
                'password'      => $hash,
                'documentType'  => 'cpf',
                'documentValue' => '00000000000',
                'role'          => 'client',
                'status'        => 'approved',
                'clientSlug'    => $clientSlug,
                'createdAt'     => gp_now_iso(),
                'updatedAt'     => gp_now_iso(),
            ]);
            $s['users'][] = $newUser;
        }
        return [$s, null];
    });

    gp_append_audit_log('client_user_setup', [
        'email'      => $normalizedEmail,
        'clientSlug' => $clientSlug,
        'source'     => 'setup-admin.php',
    ]);

    $verb = $existingUser ? 'Updated' : 'Created';
    echo "[DONE] {$verb} client user successfully.\n";
    echo "       Email:      {$normalizedEmail}\n";
    echo "       ClientSlug: {$clientSlug}\n";
    echo "       Password:   [set]\n";
    exit(0);
}

// ── Admin mode (default) ─────────────────────────────────────────────────────

$state = gp_read_state();
$seedAdmin = null;
$seedIndex = null;

foreach ($state['users'] as $index => $user) {
    if (gp_is_seed_admin_record($user)) {
        $seedAdmin = $user;
        $seedIndex = $index;
        break;
    }
}

if ($seedAdmin === null) {
    fwrite(STDERR, "[ERROR] seed-admin record not found in app-state.json.\n");
    fwrite(STDERR, "Ensure the state file exists and has been initialized.\n");
    exit(1);
}

// Update the seed-admin with the provided credentials.
gp_update_state(function (array $state) use ($adminEmail, $adminPassword, $seedIndex) {
    $admin = $state['users'][$seedIndex];
    $admin['email'] = gp_normalize_email($adminEmail) ?: 'admin';
    $admin['password'] = password_hash($adminPassword, PASSWORD_BCRYPT, ['cost' => 12]);
    $admin['updatedAt'] = gp_now_iso();
    $state['users'][$seedIndex] = gp_normalize_user($admin);
    return [$state, null];
});

gp_append_audit_log('admin_setup', [
    'email' => $adminEmail,
    'source' => 'setup-admin.php',
]);

echo "[DONE] Admin account configured successfully.\n";
echo "       Email:    {$adminEmail}\n";
echo "       Password: [set]\n";
exit(0);
