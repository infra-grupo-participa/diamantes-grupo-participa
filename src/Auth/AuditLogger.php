<?php

declare(strict_types=1);

namespace Diamantes\Auth;

use Diamantes\Http\Request;

/**
 * Append-only structured audit log (JSONL).
 *
 * Never throws — audit failures must not abort requests.
 * Never logs passwords or secret tokens.
 */
final class AuditLogger
{
    private string $logFile;
    private string $storageDir;

    public function __construct(string $logFile)
    {
        $this->logFile = $logFile;
        $this->storageDir = dirname($logFile);
    }

    /**
     * Append an audit event.
     *
     * @param array<string, mixed> $context
     */
    public function log(string $event, array $context = []): void
    {
        if (!is_dir($this->storageDir)) {
            @mkdir($this->storageDir, 0775, true);
        }
        // Best-effort — never fail the request because of audit log.
        $entry = array_merge(
            ['time' => Request::nowIso(), 'event' => $event],
            $context
        );
        $payload = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            return;
        }
        @file_put_contents($this->logFile, $payload . PHP_EOL, FILE_APPEND | LOCK_EX);
    }
}
