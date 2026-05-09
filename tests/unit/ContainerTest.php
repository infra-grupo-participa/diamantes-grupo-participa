<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit;

use Diamantes\Auth\AuditLogger;
use Diamantes\Auth\RateLimiter;
use Diamantes\Container;
use Diamantes\Integrations\ClickUpClient;
use Diamantes\Integrations\Mailer;
use Diamantes\Integrations\SheetsSync;
use Diamantes\Storage\StateRepository;
use PHPUnit\Framework\TestCase;

final class ContainerTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        // Container needs GP_* constants — bootstrap.php defines them.
        if (!defined('GP_STORAGE_DIR')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    protected function setUp(): void
    {
        Container::reset();
    }

    protected function tearDown(): void
    {
        Container::reset();
    }

    public function testGetInstanceReturnsSingleton(): void
    {
        $c1 = Container::getInstance();
        $c2 = Container::getInstance();
        $this->assertSame($c1, $c2);
    }

    public function testResetClearsSingleton(): void
    {
        $c1 = Container::getInstance();
        Container::reset();
        $c2 = Container::getInstance();
        $this->assertNotSame($c1, $c2);
    }

    public function testStateRepositoryIsStateRepository(): void
    {
        $this->assertInstanceOf(
            StateRepository::class,
            Container::getInstance()->stateRepository()
        );
    }

    public function testAuditLoggerIsAuditLogger(): void
    {
        $this->assertInstanceOf(
            AuditLogger::class,
            Container::getInstance()->auditLogger()
        );
    }

    public function testRateLimiterIsRateLimiter(): void
    {
        $this->assertInstanceOf(
            RateLimiter::class,
            Container::getInstance()->rateLimiter()
        );
    }

    public function testClickUpClientIsClickUpClient(): void
    {
        $this->assertInstanceOf(
            ClickUpClient::class,
            Container::getInstance()->clickUpClient()
        );
    }

    public function testSheetsSyncIsSheetsSync(): void
    {
        $this->assertInstanceOf(
            SheetsSync::class,
            Container::getInstance()->sheetsSync()
        );
    }

    public function testMailerIsMailer(): void
    {
        $this->assertInstanceOf(
            Mailer::class,
            Container::getInstance()->mailer()
        );
    }

    public function testServicesAreLazySingletons(): void
    {
        $c = Container::getInstance();
        $this->assertSame($c->stateRepository(), $c->stateRepository());
        $this->assertSame($c->rateLimiter(), $c->rateLimiter());
    }
}
