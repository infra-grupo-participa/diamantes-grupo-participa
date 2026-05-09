<?php

declare(strict_types=1);

namespace Diamantes\Auth;

use Diamantes\Http\JsonResponse;

/**
 * CSRF token generation and header enforcement.
 *
 * Token: 64-char hex string (random_bytes(32)).
 * Comparison: hash_equals() — constant-time, no timing oracle.
 * Enforcement: state-changing methods only (POST, PUT, PATCH, DELETE).
 */
final class CsrfTokenManager
{
    private const SESSION_KEY = 'gp_csrf_token';

    /**
     * Return the CSRF token for the current session, generating it if absent.
     *
     * Returns '' if no active session.
     */
    public static function getToken(): string
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return '';
        }
        if (empty($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = bin2hex(random_bytes(32));
        }
        return (string)$_SESSION[self::SESSION_KEY];
    }

    /**
     * Enforce the X-CSRF-Token header on state-changing requests.
     *
     * Sends HTTP 403 and exits on failure.
     */
    public static function requireHeader(): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return;
        }
        $token = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        $stored = (string)($_SESSION[self::SESSION_KEY] ?? '');
        if ($stored === '' || $token === '' || !hash_equals($stored, $token)) {
            JsonResponse::send(['ok' => false, 'error' => 'Token CSRF inválido ou ausente.'], 403);
        }
    }
}
