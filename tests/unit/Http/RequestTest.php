<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Http;

use Diamantes\Http\Request;
use PHPUnit\Framework\TestCase;

final class RequestTest extends TestCase
{
    public function testNowIsoReturnsUtcIso8601(): void
    {
        $iso = Request::nowIso();
        $this->assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/',
            $iso,
            'nowIso() must return UTC ISO-8601 format'
        );
    }

    public function testClientIpReturnsUnknownWhenNoServerVars(): void
    {
        $backup = [];
        foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $key) {
            $backup[$key] = $_SERVER[$key] ?? null;
            unset($_SERVER[$key]);
        }

        $ip = Request::clientIp();
        $this->assertSame('unknown', $ip);

        foreach ($backup as $key => $value) {
            if ($value !== null) {
                $_SERVER[$key] = $value;
            }
        }
    }

    public function testClientIpExtractsFirstFromForwardedFor(): void
    {
        $backup = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null;
        $_SERVER['HTTP_X_FORWARDED_FOR'] = '192.168.1.1, 10.0.0.1, 172.16.0.1';

        $ip = Request::clientIp();
        $this->assertSame('192.168.1.1', $ip);

        if ($backup !== null) {
            $_SERVER['HTTP_X_FORWARDED_FOR'] = $backup;
        } else {
            unset($_SERVER['HTTP_X_FORWARDED_FOR']);
        }
    }

    public function testClientIpRejectsInvalidIp(): void
    {
        $backup = [
            'HTTP_X_FORWARDED_FOR' => $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null,
            'HTTP_X_REAL_IP' => $_SERVER['HTTP_X_REAL_IP'] ?? null,
            'REMOTE_ADDR' => $_SERVER['REMOTE_ADDR'] ?? null,
        ];

        $_SERVER['HTTP_X_FORWARDED_FOR'] = 'not-an-ip';
        unset($_SERVER['HTTP_X_REAL_IP'], $_SERVER['REMOTE_ADDR']);

        $ip = Request::clientIp();
        $this->assertSame('unknown', $ip);

        foreach ($backup as $key => $value) {
            if ($value !== null) {
                $_SERVER[$key] = $value;
            } else {
                unset($_SERVER[$key]);
            }
        }
    }

    public function testPayloadReturnsPostForFormContentType(): void
    {
        $backup = $_SERVER['CONTENT_TYPE'] ?? null;
        $_SERVER['CONTENT_TYPE'] = 'application/x-www-form-urlencoded';
        $_POST = ['foo' => 'bar'];

        $payload = Request::payload();
        $this->assertSame(['foo' => 'bar'], $payload);

        $_POST = [];
        if ($backup !== null) {
            $_SERVER['CONTENT_TYPE'] = $backup;
        } else {
            unset($_SERVER['CONTENT_TYPE']);
        }
    }
}
