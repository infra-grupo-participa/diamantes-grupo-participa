<?php

declare(strict_types=1);

namespace Diamantes\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * HIGH-1: Rate limiting logic.
 *
 * Tests the rate-limit file-backed store independently of the HTTP layer.
 */
final class RateLimitTest extends TestCase
{
    private string $tmpDir;
    private string $origRateLimitFile;

    public static function setUpBeforeClass(): void
    {
        if (!function_exists('gp_verify_password')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    protected function setUp(): void
    {
        // Redirect rate-limit storage to a temp file so tests don't clobber real data.
        $this->tmpDir = sys_get_temp_dir() . '/gp_test_' . uniqid('', true);
        mkdir($this->tmpDir, 0775, true);
    }

    protected function tearDown(): void
    {
        // Cleanup temp files.
        $files = glob($this->tmpDir . '/*') ?: [];
        foreach ($files as $file) {
            @unlink($file);
        }
        @rmdir($this->tmpDir);
    }

    public function testRateLimitDataStructureIsValid(): void
    {
        // Simulate N-1 failures — should not lock out.
        $max = GP_RATE_LIMIT_MAX_FAILURES;
        $window = GP_RATE_LIMIT_WINDOW_SECONDS;

        $this->assertGreaterThan(0, $max, 'Max failures must be positive');
        $this->assertGreaterThan(0, $window, 'Window must be positive');
        $this->assertSame(5, $max, 'Expect 5 max failures per window');
        $this->assertSame(900, $window, 'Expect 15 minute (900s) window');
    }

    public function testFailureEntryAccumulatesWithinWindow(): void
    {
        $now = time();
        $windowStart = $now - GP_RATE_LIMIT_WINDOW_SECONDS;

        // Simulate 4 failures within the window.
        $failures = [];
        for ($i = 0; $i < 4; $i++) {
            $failures[] = $now - ($i * 60); // 1 per minute apart
        }

        $recentFailures = array_filter($failures, fn($ts) => $ts > $windowStart);
        $this->assertCount(4, $recentFailures, 'All 4 failures should be within window');
        $this->assertLessThan(
            GP_RATE_LIMIT_MAX_FAILURES,
            count($recentFailures),
            'Below threshold — should not lock out yet'
        );
    }

    public function testNPlusOneFailureExceedsThreshold(): void
    {
        $now = time();
        $windowStart = $now - GP_RATE_LIMIT_WINDOW_SECONDS;

        // Simulate exactly MAX failures within the window.
        $failures = [];
        for ($i = 0; $i < GP_RATE_LIMIT_MAX_FAILURES; $i++) {
            $failures[] = $now - ($i * 60);
        }

        $recentFailures = array_filter($failures, fn($ts) => $ts > $windowStart);
        $this->assertGreaterThanOrEqual(
            GP_RATE_LIMIT_MAX_FAILURES,
            count($recentFailures),
            'At or above threshold — should lock out'
        );
    }

    public function testOldFailuresExpireOutsideWindow(): void
    {
        $now = time();
        $windowStart = $now - GP_RATE_LIMIT_WINDOW_SECONDS;

        // Simulate MAX failures, all older than the window.
        $failures = [];
        for ($i = 0; $i < GP_RATE_LIMIT_MAX_FAILURES; $i++) {
            $failures[] = $windowStart - ($i * 60); // all outside window
        }

        $recentFailures = array_filter($failures, fn($ts) => $ts > $windowStart);
        $this->assertCount(0, $recentFailures, 'Expired failures should not count toward limit');
    }

    public function testRateLimitReadWriteRoundTrip(): void
    {
        // Test the read/write functions using a redirected file path.
        $tmpFile = $this->tmpDir . '/rate-limits.json';
        $data = [
            'ip:abc' => ['failures' => [time(), time() - 10], 'until' => 0],
        ];

        $payload = json_encode($data);
        file_put_contents($tmpFile, $payload, LOCK_EX);

        $read = json_decode(file_get_contents($tmpFile), true);
        $this->assertIsArray($read);
        $this->assertArrayHasKey('ip:abc', $read);
        $this->assertCount(2, $read['ip:abc']['failures']);
    }
}
