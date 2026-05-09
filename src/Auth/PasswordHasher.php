<?php

declare(strict_types=1);

namespace Diamantes\Auth;

/**
 * Password hashing and verification.
 *
 * - Hashes with bcrypt cost 12.
 * - Verifies bcrypt hashes via password_verify().
 * - Falls back to hash_equals() for legacy plaintext hashes to support
 *   transparent migration: detect by absence of the "$2" bcrypt prefix.
 * - Empty stored hash (sentinel) always returns false → admin login blocked
 *   until setup-admin.php is run.
 */
final class PasswordHasher
{
    public const BCRYPT_COST = 12;

    /**
     * Hash a plain-text password with bcrypt.
     */
    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT, ['cost' => self::BCRYPT_COST]);
    }

    /**
     * Verify a plain-text password against a stored hash.
     *
     * @param string $plain  The candidate plain-text password.
     * @param string $stored The stored hash (bcrypt) or legacy plaintext value.
     */
    public static function verify(string $plain, string $stored): bool
    {
        if ($stored === '' || $plain === '') {
            return false;
        }
        if (str_starts_with($stored, '$2')) {
            return password_verify($plain, $stored);
        }
        // Legacy plaintext comparison — only reached during transparent migration.
        return hash_equals($stored, $plain);
    }

    /**
     * Check whether a stored hash needs to be re-hashed (plaintext migration).
     */
    public static function needsRehash(string $stored): bool
    {
        return $stored !== '' && !str_starts_with($stored, '$2');
    }
}
