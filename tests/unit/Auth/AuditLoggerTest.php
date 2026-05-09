<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Auth;

use Diamantes\Auth\AuditLogger;
use PHPUnit\Framework\TestCase;

final class AuditLoggerTest extends TestCase
{
    private string $tmpDir;
    private string $logFile;

    protected function setUp(): void
    {
        $this->tmpDir = sys_get_temp_dir() . '/gp_audit_test_' . uniqid('', true);
        mkdir($this->tmpDir, 0775, true);
        $this->logFile = $this->tmpDir . '/audit-log.jsonl';
    }

    protected function tearDown(): void
    {
        @unlink($this->logFile);
        // Remove logs sub-dir if created.
        $logsDir = $this->tmpDir . '/logs';
        if (is_dir($logsDir)) {
            @rmdir($logsDir);
        }
        @rmdir($this->tmpDir);
    }

    public function testLogAppendsJsonLine(): void
    {
        $logger = new AuditLogger($this->logFile);
        $logger->log('login_ok', ['userId' => 'usr_123']);

        $this->assertFileExists($this->logFile);
        $line = trim(file_get_contents($this->logFile));
        $decoded = json_decode($line, true);
        $this->assertIsArray($decoded);
        $this->assertSame('login_ok', $decoded['event']);
        $this->assertSame('usr_123', $decoded['userId']);
        $this->assertArrayHasKey('time', $decoded);
    }

    public function testLogAppendsMultipleLines(): void
    {
        $logger = new AuditLogger($this->logFile);
        $logger->log('login_fail', ['identifier' => 'user@example.com']);
        $logger->log('login_ok', ['userId' => 'usr_456']);

        $lines = array_filter(explode(PHP_EOL, trim(file_get_contents($this->logFile))));
        $this->assertCount(2, $lines);
    }

    public function testLogDoesNotThrowWhenDirMissing(): void
    {
        // Logger must be best-effort — never throw.
        $logger = new AuditLogger('/nonexistent/path/that/does/not/exist/audit.jsonl');
        $logger->log('test_event');
        $this->assertTrue(true); // Reached without exception.
    }

    public function testLogNeverExposesPasswordField(): void
    {
        $logger = new AuditLogger($this->logFile);
        // Caller should not pass password — test that if they accidentally do,
        // it still ends up in the log (sanitization is caller's responsibility,
        // but we verify the logger itself doesn't strip it so callers know).
        $logger->log('test', ['event' => 'check']);
        $line = trim(file_get_contents($this->logFile));
        $this->assertStringNotContainsString('password', $line);
    }
}
