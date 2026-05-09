<?php

declare(strict_types=1);

namespace Diamantes\Auth;

/**
 * PHP session lifecycle management.
 *
 * Preserves all security flags from bootstrap.php:
 * - Cookie: Secure (env-controlled), HttpOnly, SameSite=Lax, path=/
 * - Logout destroys server-side session AND expires cookie immediately.
 */
final class SessionManager
{
    /**
     * Start the session with hardened cookie params.
     *
     * No-op if the session is already active.
     */
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        session_name('gp_portal_session');
        $secure = filter_var(getenv('GP_COOKIE_SECURE') ?: 'true', FILTER_VALIDATE_BOOLEAN);
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }

    /**
     * Store the authenticated user ID in the session.
     *
     * @param array<string, mixed> $user
     */
    public static function setUser(array $user): void
    {
        $_SESSION['gp_user_id'] = (string)$user['id'];
    }

    /**
     * Return the session user ID, or empty string if not set.
     */
    public static function getUserId(): string
    {
        return (string)($_SESSION['gp_user_id'] ?? '');
    }

    /**
     * Destroy the session: clears superglobal, expires cookie, calls session_destroy().
     */
    public static function clear(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            $secure = filter_var(getenv('GP_COOKIE_SECURE') ?: 'true', FILTER_VALIDATE_BOOLEAN);
            setcookie(
                session_name(),
                '',
                [
                    'expires' => time() - 3600,
                    'path' => '/',
                    'secure' => $secure,
                    'httponly' => true,
                    'samesite' => 'Lax',
                ]
            );
            session_destroy();
        }
    }
}
