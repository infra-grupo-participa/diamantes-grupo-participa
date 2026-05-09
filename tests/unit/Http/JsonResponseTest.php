<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Http;

use Diamantes\Http\JsonResponse;
use PHPUnit\Framework\TestCase;

final class JsonResponseTest extends TestCase
{
    public function testNoCacheHeadersDoesNotExit(): void
    {
        // Just verifies the method exists and is callable without exit.
        // header() calls are no-ops in CLI.
        JsonResponse::noCacheHeaders();
        $this->assertTrue(true);
    }

    public function testSendMethodExists(): void
    {
        $this->assertTrue(method_exists(JsonResponse::class, 'send'));
    }

    public function testRawMethodExists(): void
    {
        $this->assertTrue(method_exists(JsonResponse::class, 'raw'));
    }
}
