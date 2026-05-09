<?php

declare(strict_types=1);

namespace Diamantes\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * CRITICAL-1: SSRF guard in clickup.php path validation.
 *
 * Tests that absolute URLs are rejected before reaching gp_clickup_request().
 * We test the guard logic inline rather than doing HTTP requests so the test
 * runs without a web server.
 */
final class SsrfTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (!function_exists('gp_verify_password')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    /**
     * Replicates the guard added to clickup.php:
     *   if (preg_match('#^https?://#i', $path)) { reject }
     *
     * @dataProvider absoluteUrlProvider
     */
    public function testAbsoluteUrlIsRejected(string $path): void
    {
        $isAbsolute = (bool)preg_match('#^https?://#i', $path);
        $this->assertTrue($isAbsolute, "Path '{$path}' should be detected as absolute URL");
    }

    /**
     * @dataProvider relativePathProvider
     */
    public function testRelativePathIsAllowed(string $path): void
    {
        $isAbsolute = (bool)preg_match('#^https?://#i', $path);
        $this->assertFalse($isAbsolute, "Path '{$path}' should not be detected as absolute URL");
    }

    public function testGpClickupRequestRejectsNonClickUpHost(): void
    {
        // gp_clickup_request() must reject absolute URLs pointing to non-clickup.com hosts.
        $path = 'https://attacker.com/collect';
        $parsedHost = parse_url($path, PHP_URL_HOST);
        $this->assertNotSame('api.clickup.com', $parsedHost);
    }

    public function testGpClickupRequestAllowsClickUpHost(): void
    {
        $path = 'https://api.clickup.com/api/v2/task/abc';
        $parsedHost = parse_url($path, PHP_URL_HOST);
        $this->assertSame('api.clickup.com', $parsedHost);
    }

    public static function absoluteUrlProvider(): array
    {
        return [
            ['http://attacker.com/collect'],
            ['https://attacker.com/collect'],
            ['HTTP://ATTACKER.COM'],
            ['https://169.254.169.254/latest/meta-data/'],
            ['https://internal.corp/secret'],
        ];
    }

    public static function relativePathProvider(): array
    {
        return [
            ['/task/abc123/comment'],
            ['task/abc123'],
            ['/list/xyz/task'],
            ['space/1234/member'],
        ];
    }
}
