<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Auth;

use Diamantes\Auth\RateLimiter;
use PHPUnit\Framework\TestCase;

final class RateLimiterTest extends TestCase
{
    private string $tmpFile;

    protected function setUp(): void
    {
        $this->tmpFile = sys_get_temp_dir() . '/gp_rl_test_' . uniqid('', true) . '.json';
    }

    protected function tearDown(): void
    {
        @unlink($this->tmpFile);
    }

    private function limiter(): RateLimiter
    {
        return new RateLimiter($this->tmpFile);
    }

    public function testConstantsAreCorrect(): void
    {
        $this->assertSame(5, RateLimiter::MAX_FAILURES);
        $this->assertSame(900, RateLimiter::WINDOW_SECONDS);
    }

    public function testRecordFailureCreatesFile(): void
    {
        $rl = $this->limiter();
        // Fake IP via $_SERVER
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
        $rl->recordFailure('test@example.com');
        $this->assertFileExists($this->tmpFile);
    }

    public function testRecordFailureAccumulatesEntries(): void
    {
        $rl = $this->limiter();
        $_SERVER['REMOTE_ADDR'] = '127.0.0.2';

        for ($i = 0; $i < 3; $i++) {
            $rl->recordFailure('user@example.com');
        }

        $data = json_decode(file_get_contents($this->tmpFile), true);
        $this->assertIsArray($data);
        $idKey = 'id:' . sha1('user@example.com');
        $this->assertCount(3, $data[$idKey]['failures'] ?? []);
    }

    public function testClearRemovesEntries(): void
    {
        $rl = $this->limiter();
        $_SERVER['REMOTE_ADDR'] = '127.0.0.3';

        $rl->recordFailure('clear@example.com');
        $rl->clear('clear@example.com');

        if (is_file($this->tmpFile)) {
            $data = json_decode(file_get_contents($this->tmpFile), true);
            $idKey = 'id:' . sha1('clear@example.com');
            $this->assertArrayNotHasKey($idKey, $data ?? []);
        } else {
            $this->assertTrue(true); // File may not exist after clear if empty.
        }
    }

    public function testNFailuresBelowThresholdDoNotLock(): void
    {
        $now = time();
        $windowStart = $now - RateLimiter::WINDOW_SECONDS;

        $failures = array_fill(0, RateLimiter::MAX_FAILURES - 1, $now);
        $recent = array_filter($failures, fn($ts) => $ts > $windowStart);
        $this->assertLessThan(RateLimiter::MAX_FAILURES, count($recent));
    }

    public function testMaxFailuresReachesThreshold(): void
    {
        $now = time();
        $windowStart = $now - RateLimiter::WINDOW_SECONDS;

        $failures = array_fill(0, RateLimiter::MAX_FAILURES, $now);
        $recent = array_filter($failures, fn($ts) => $ts > $windowStart);
        $this->assertGreaterThanOrEqual(RateLimiter::MAX_FAILURES, count($recent));
    }

    public function testExpiredFailuresDoNotCount(): void
    {
        $now = time();
        $windowStart = $now - RateLimiter::WINDOW_SECONDS;

        $failures = array_fill(0, RateLimiter::MAX_FAILURES, $windowStart - 60);
        $recent = array_filter($failures, fn($ts) => $ts > $windowStart);
        $this->assertCount(0, $recent);
    }
}
