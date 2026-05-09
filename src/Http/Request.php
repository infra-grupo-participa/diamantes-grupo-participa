<?php

declare(strict_types=1);

namespace Diamantes\Http;

/**
 * Thin wrapper around PHP superglobals for reading request data.
 */
final class Request
{
    /**
     * Parse the incoming request body.
     *
     * If Content-Type is application/json, decodes the raw body.
     * Otherwise returns $_POST.
     *
     * @return array<string, mixed>
     */
    public static function payload(): array
    {
        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        if (stripos($contentType, 'application/json') !== false) {
            $raw = file_get_contents('php://input');
            $decoded = json_decode($raw ?: '[]', true);
            return is_array($decoded) ? $decoded : [];
        }

        return $_POST;
    }

    /**
     * Enforce a specific HTTP method; sends 405 and exits if mismatched.
     */
    public static function requireMethod(string $expected): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if ($method !== strtoupper($expected)) {
            JsonResponse::send(['ok' => false, 'error' => 'Método não permitido.'], 405);
        }
    }

    /**
     * Return the best-effort client IP address.
     *
     * Checks X-Forwarded-For, X-Real-IP, then REMOTE_ADDR. Takes the first
     * entry from comma-separated lists and validates it.
     */
    public static function clientIp(): string
    {
        foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $key) {
            $raw = (string)($_SERVER[$key] ?? '');
            if ($raw !== '') {
                // Take the first IP in a comma-separated list (X-Forwarded-For).
                $ip = trim(explode(',', $raw)[0]);
                if (filter_var($ip, FILTER_VALIDATE_IP) !== false) {
                    return $ip;
                }
            }
        }
        return 'unknown';
    }

    /**
     * Return the current UTC time in ISO-8601 format.
     */
    public static function nowIso(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z');
    }
}
