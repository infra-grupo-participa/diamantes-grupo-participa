<?php

declare(strict_types=1);

namespace Diamantes\Auth;

use Diamantes\Http\Request;

/**
 * Sliding-window, file-backed rate limiter.
 *
 * Tracks failures by IP and by identifier independently.
 * After GP_RATE_LIMIT_MAX_FAILURES (5) within GP_RATE_LIMIT_WINDOW_SECONDS (900 s),
 * the key is locked out until the window expires.
 */
final class RateLimiter
{
    public const MAX_FAILURES = 5;
    public const WINDOW_SECONDS = 900; // 15 minutes

    private string $filePath;

    public function __construct(string $filePath)
    {
        $this->filePath = $filePath;
    }

    /**
     * Check if the identifier (or the current IP) is currently locked out.
     *
     * Sends HTTP 429 with Retry-After and exits on lockout.
     */
    public function check(string $identifier): void
    {
        $now = time();
        $data = $this->read();

        $ipKey = 'ip:' . sha1(Request::clientIp());
        $idKey = 'id:' . sha1($identifier);

        foreach ([$ipKey, $idKey] as $key) {
            $entry = $data[$key] ?? ['failures' => [], 'until' => 0];
            if ($now < (int)($entry['until'] ?? 0)) {
                $retryAfter = (int)$entry['until'] - $now;
                http_response_code(429);
                header('Retry-After: ' . $retryAfter);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['ok' => false, 'error' => 'Muitas tentativas. Tente novamente mais tarde.']);
                exit;
            }
        }
    }

    /**
     * Record a failed attempt for the identifier and current IP.
     */
    public function recordFailure(string $identifier): void
    {
        $now = time();
        $data = $this->read();
        $windowStart = $now - self::WINDOW_SECONDS;

        $ipKey = 'ip:' . sha1(Request::clientIp());
        $idKey = 'id:' . sha1($identifier);

        foreach ([$ipKey, $idKey] as $key) {
            $entry = $data[$key] ?? ['failures' => [], 'until' => 0];
            $failures = array_filter((array)$entry['failures'], fn($ts) => $ts > $windowStart);
            $failures[] = $now;
            $failures = array_values($failures);
            $entry['failures'] = $failures;
            if (count($failures) >= self::MAX_FAILURES) {
                $entry['until'] = $now + self::WINDOW_SECONDS;
            }
            $data[$key] = $entry;
        }

        $this->write($data);
    }

    /**
     * Clear rate-limit entries for the identifier and current IP (call on success).
     */
    public function clear(string $identifier): void
    {
        $data = $this->read();
        $ipKey = 'ip:' . sha1(Request::clientIp());
        $idKey = 'id:' . sha1($identifier);
        unset($data[$ipKey], $data[$idKey]);
        $this->write($data);
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    /**
     * @return array<string, mixed>
     */
    private function read(): array
    {
        if (!is_file($this->filePath)) {
            return [];
        }
        $data = @file_get_contents($this->filePath);
        if ($data === false || $data === '') {
            return [];
        }
        $decoded = json_decode($data, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<string, mixed> $data
     */
    private function write(array $data): void
    {
        $dir = dirname($this->filePath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            return;
        }
        @file_put_contents($this->filePath, $payload, LOCK_EX);
    }
}
