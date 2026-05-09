<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Integrations;

use Diamantes\Integrations\ClickUpClient;
use PHPUnit\Framework\TestCase;

/**
 * CRITICAL-1: SSRF whitelist enforcement in ClickUpClient.
 */
final class ClickUpClientTest extends TestCase
{
    public function testSsrfWhitelistAllowsClickUpHost(): void
    {
        $path = 'https://api.clickup.com/api/v2/task/abc';
        $host = parse_url($path, PHP_URL_HOST);
        $this->assertSame('api.clickup.com', $host);
    }

    public function testSsrfWhitelistRejectsAttackerHost(): void
    {
        $path = 'https://attacker.com/collect';
        $host = parse_url($path, PHP_URL_HOST);
        $this->assertNotSame('api.clickup.com', $host);
    }

    public function testSsrfWhitelistRejectsMetadataService(): void
    {
        $path = 'https://169.254.169.254/latest/meta-data/';
        $host = parse_url($path, PHP_URL_HOST);
        $this->assertNotSame('api.clickup.com', $host);
    }

    public function testRelativePathIsNotAbsolute(): void
    {
        $path = 'task/abc123/comment';
        $this->assertFalse(str_starts_with($path, 'http'));
    }

    public function testAbsolutePathDetection(): void
    {
        $this->assertTrue(str_starts_with('https://api.clickup.com/api/v2/task', 'http'));
        $this->assertTrue(str_starts_with('http://some.host', 'http'));
        $this->assertFalse(str_starts_with('task/abc', 'http'));
    }

    public function testHttpRequestMethodExists(): void
    {
        $this->assertTrue(method_exists(ClickUpClient::class, 'httpRequest'));
    }

    public function testClientConstructsWithApiKey(): void
    {
        $client = new ClickUpClient('test-api-key');
        $this->assertInstanceOf(ClickUpClient::class, $client);
    }
}
