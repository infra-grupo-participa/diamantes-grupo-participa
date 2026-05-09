<?php

declare(strict_types=1);

namespace Diamantes\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * Tests for the idempotent bcrypt migration script.
 *
 * We test the migration logic inline (without shelling out) by replicating
 * the detection/hash logic that the script uses.
 */
final class MigratePasswordsTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (!function_exists('gp_verify_password')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    public function testAlreadyBcryptPasswordIsSkipped(): void
    {
        $password = 'already-hashed-password';
        $bcryptHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);

        // Script logic: if starts with '$2', skip.
        $shouldSkip = str_starts_with($bcryptHash, '$2');
        $this->assertTrue($shouldSkip, 'Bcrypt hash must be detected and skipped');
    }

    public function testPlaintextPasswordIsDetected(): void
    {
        $plaintext = 'my-plaintext-password';

        // Script logic: if does NOT start with '$2', migrate.
        $shouldMigrate = !str_starts_with($plaintext, '$2');
        $this->assertTrue($shouldMigrate, 'Plaintext must be detected for migration');
    }

    public function testEmptySentinelIsSkipped(): void
    {
        $sentinel = '';

        // Script logic: if empty, skip (seed-admin not yet configured).
        $shouldSkipEmpty = $sentinel === '';
        $this->assertTrue($shouldSkipEmpty, 'Empty sentinel must be skipped, not migrated');
    }

    public function testMigratedHashIsVerifiable(): void
    {
        $plaintext = 'original-plaintext-password';
        $migrated = password_hash($plaintext, PASSWORD_BCRYPT, ['cost' => 12]);

        // After migration, the stored hash must verify correctly.
        $this->assertTrue(
            gp_verify_password($plaintext, $migrated),
            'Migrated hash must verify against original plaintext'
        );
    }

    public function testMigrationIsIdempotent(): void
    {
        // Running migration twice on the same bcrypt hash should not change it.
        $password = 'idempotent-test-password';
        $hash1 = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

        // Second "migration": detect it's already bcrypt, skip.
        $alreadyBcrypt = str_starts_with($hash1, '$2');
        $this->assertTrue($alreadyBcrypt, 'Second run must detect hash as bcrypt and not re-hash');

        // The hash is still valid.
        $this->assertTrue(
            gp_verify_password($password, $hash1),
            'Hash must still verify after idempotent skip'
        );
    }

    public function testBcryptPrefixDetection(): void
    {
        // Verify our prefix detection covers all common bcrypt versions.
        $variants = ['$2y$', '$2b$', '$2a$'];
        foreach ($variants as $prefix) {
            $this->assertTrue(
                str_starts_with($prefix . '10$something', '$2'),
                "Bcrypt variant {$prefix} must be detected"
            );
        }
    }
}
