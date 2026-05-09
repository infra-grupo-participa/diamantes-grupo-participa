<?php

declare(strict_types=1);

namespace Diamantes\Tests\Smoke;

use Diamantes\Container;
use Diamantes\Http\JsonResponse;
use Diamantes\Http\Request;
use PHPUnit\Framework\TestCase;

/**
 * Smoke test — verifies the PSR-4 autoloader resolves Diamantes\ classes.
 *
 * Updated in Fase 2: Placeholder.php removed; checks real extracted classes.
 */
final class SanityTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (!defined('GP_STORAGE_DIR')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    public function testSuiteIsRunning(): void
    {
        $this->assertTrue(true, 'PHPUnit está funcionando.');
    }

    public function testHttpClassesAreAutoloaded(): void
    {
        $this->assertTrue(class_exists(JsonResponse::class));
        $this->assertTrue(class_exists(Request::class));
    }

    public function testContainerIsAutoloaded(): void
    {
        $this->assertTrue(class_exists(Container::class));
    }

    public function testContainerProvidesServices(): void
    {
        $c = Container::getInstance();
        $this->assertNotNull($c->stateRepository());
        $this->assertNotNull($c->rateLimiter());
        $this->assertNotNull($c->auditLogger());
    }
}
