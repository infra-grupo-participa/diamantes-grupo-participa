<?php

declare(strict_types=1);

namespace Diamantes\Integrations;

use Diamantes\Http\Request;
use Diamantes\Users\UserService;

/**
 * mail() wrapper with MIME header encoding and send logging.
 */
final class Mailer
{
    private string $fromEmail;
    private string $fromName;

    /** Path to the notification log file (JSONL). */
    private string $notificationLogFile;

    public function __construct(
        string $fromEmail,
        string $fromName,
        string $notificationLogFile,
    ) {
        $this->fromEmail = $fromEmail;
        $this->fromName = $fromName;
        $this->notificationLogFile = $notificationLogFile;
    }

    /**
     * Send a plain-text email to one or more recipients.
     *
     * Deduplicates and normalizes addresses. Logs the outcome.
     *
     * @param string[]             $recipients
     * @param array<string, mixed> $meta
     */
    public function send(array $recipients, string $subject, string $body, array $meta = []): bool
    {
        $uniqueRecipients = array_values(array_unique(array_filter(array_map(
            static fn(string $email): string => UserService::normalizeEmail($email),
            $recipients
        ))));

        if (!$uniqueRecipients) {
            return false;
        }

        $encodedSubject = $this->encodeSubject($subject);
        $headers = [
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'From: ' . ($this->fromName !== ''
                ? sprintf('%s <%s>', $this->fromName, $this->fromEmail)
                : $this->fromEmail),
        ];

        $sent = function_exists('mail')
            ? @mail(implode(', ', $uniqueRecipients), $encodedSubject, $body, implode("\r\n", $headers))
            : false;

        $this->appendLog([
            'time' => Request::nowIso(),
            'ok' => $sent,
            'to' => $uniqueRecipients,
            'subject' => $subject,
            'meta' => $meta,
        ]);

        return $sent;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private function encodeSubject(string $subject): string
    {
        if (function_exists('mb_encode_mimeheader')) {
            return mb_encode_mimeheader($subject, 'UTF-8');
        }
        return $subject;
    }

    /**
     * @param array<mixed> $entry
     */
    private function appendLog(array $entry): void
    {
        $payload = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            return;
        }
        @file_put_contents($this->notificationLogFile, $payload . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    // ─── Factory helpers ──────────────────────────────────────────────────────

    public static function fromEmailFromEnv(): string
    {
        return trim((string)(
            getenv('GP_MAIL_FROM_EMAIL')
            ?: getenv('MAIL_FROM')
            ?: 'nao-responda@diamantes.grupoparticipa.app.br'
        ));
    }

    public static function fromNameFromEnv(): string
    {
        return trim((string)(getenv('GP_MAIL_FROM_NAME') ?: 'Grupo Participa'));
    }
}
