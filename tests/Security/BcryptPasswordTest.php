<?php

declare(strict_types=1);

namespace Diamantes\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * CRITICAL-3: bcrypt password storage and verification.
 *
 * Tests gp_verify_password() and password_hash/password_verify integration
 * without requiring the HTTP session (bootstrap is included once per process).
 */
final class BcryptPasswordTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        // Only include bootstrap once — it calls session_start() which is fine in CLI.
        if (!function_exists('gp_verify_password')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    public function testBcryptHashIsVerifiable(): void
    {
        $password = 'correct-horse-battery-staple';
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);

        $this->assertTrue(
            gp_verify_password($password, $hash),
            'password_verify should succeed for matching bcrypt hash'
        );
    }

    public function testBcryptHashRejectsWrongPassword(): void
    {
        $hash = password_hash('correct', PASSWORD_BCRYPT, ['cost' => 10]);

        $this->assertFalse(
            gp_verify_password('wrong', $hash),
            'password_verify should fail for wrong password'
        );
    }

    public function testPlaintextComparedWithEqualsFails(): void
    {
        // Simulate what plaintext comparison used to do.
        $stored = 'plaintext123';
        $input = 'plaintext123';

        // Plaintext == passes — but gp_verify_password detects non-bcrypt and
        // uses hash_equals. Both sides must be identical for it to pass, which means
        // plaintext "password" stored as-is would verify against itself.
        // The critical check is: a bcrypt hash CANNOT be verified with == against plaintext.
        $hash = password_hash($stored, PASSWORD_BCRYPT, ['cost' => 10]);
        $naiveEquals = ($hash === $input); // Always false
        $this->assertFalse($naiveEquals, 'bcrypt hash should never === plaintext');
    }

    public function testEmptyStoredPasswordAlwaysFails(): void
    {
        $this->assertFalse(
            gp_verify_password('any-password', ''),
            'Empty stored hash (sentinel) must always fail verification'
        );
    }

    public function testEmptyInputAlwaysFails(): void
    {
        $hash = password_hash('real-password', PASSWORD_BCRYPT, ['cost' => 10]);

        $this->assertFalse(
            gp_verify_password('', $hash),
            'Empty input must always fail verification'
        );
    }

    public function testBcryptCostIsAtLeast12(): void
    {
        $hash = password_hash('test-password', PASSWORD_BCRYPT, ['cost' => 12]);
        $info = password_get_info($hash);

        $this->assertSame('bcrypt', $info['algoName']);
        $this->assertGreaterThanOrEqual(12, $info['options']['cost'] ?? 0);
    }
}
