<?php

declare(strict_types=1);

namespace Diamantes\Http;

/**
 * HTTP response helpers.
 *
 * Each method is `never` (terminates the process via exit) exactly like the
 * original gp_json_response() / gp_raw_response() functions they replace.
 */
final class JsonResponse
{
    /**
     * Send a JSON-encoded array payload and exit.
     *
     * @param array<mixed> $payload
     */
    public static function send(array $payload, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('Pragma: no-cache');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /**
     * Send a raw string body and exit.
     */
    public static function raw(
        string $body,
        int $status = 200,
        string $contentType = 'application/json; charset=utf-8',
    ): never {
        http_response_code($status);
        header('Content-Type: ' . $contentType);
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('Pragma: no-cache');
        echo $body;
        exit;
    }

    /**
     * Emit Cache-Control / Pragma no-cache headers without terminating.
     */
    public static function noCacheHeaders(): void
    {
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('Pragma: no-cache');
    }
}
