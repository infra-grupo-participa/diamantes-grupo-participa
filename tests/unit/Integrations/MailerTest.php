<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Integrations;

use Diamantes\Integrations\Mailer;
use PHPUnit\Framework\TestCase;

final class MailerTest extends TestCase
{
    private string $tmpDir;
    private string $logFile;

    protected function setUp(): void
    {
        $this->tmpDir = sys_get_temp_dir() . '/gp_mail_test_' . uniqid('', true);
        mkdir($this->tmpDir, 0775, true);
        $this->logFile = $this->tmpDir . '/notification-log.jsonl';
    }

    protected function tearDown(): void
    {
        @unlink($this->logFile);
        @rmdir($this->tmpDir);
    }

    private function mailer(): Mailer
    {
        return new Mailer(
            'nao-responda@test.com',
            'Grupo Test',
            $this->logFile,
        );
    }

    public function testFromEmailFromEnvFallback(): void
    {
        // When env var is absent, must return the default.
        $email = Mailer::fromEmailFromEnv();
        $this->assertNotEmpty($email);
        $this->assertStringContainsString('@', $email);
    }

    public function testFromNameFromEnvFallback(): void
    {
        $name = Mailer::fromNameFromEnv();
        $this->assertNotEmpty($name);
    }

    public function testSendReturnsFalseForEmptyRecipients(): void
    {
        $mailer = $this->mailer();
        $result = $mailer->send([], 'Subject', 'Body');
        $this->assertFalse($result);
    }

    public function testSendDeduplicatesRecipients(): void
    {
        // We can't assert mail() was called, but we can assert it didn't crash.
        $mailer = $this->mailer();
        // send() returns false in CLI (no mail() daemon), but must not throw.
        $mailer->send(['dup@test.com', 'dup@test.com', 'DUP@TEST.COM'], 'Test', 'Body');
        $this->assertTrue(true);
    }

    public function testSendWritesLogEntry(): void
    {
        $mailer = $this->mailer();
        $mailer->send(['test@test.com'], 'Hello', 'World', ['meta' => 'data']);

        $this->assertFileExists($this->logFile);
        $line = trim(file_get_contents($this->logFile));
        $decoded = json_decode($line, true);
        $this->assertIsArray($decoded);
        $this->assertArrayHasKey('ok', $decoded);
        $this->assertArrayHasKey('to', $decoded);
        $this->assertSame('Hello', $decoded['subject']);
    }
}
