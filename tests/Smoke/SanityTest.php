<?php

declare(strict_types=1);

namespace Diamantes\Tests\Smoke;

use Diamantes\Placeholder;
use PHPUnit\Framework\TestCase;

/**
 * Smoke test — apenas garante que a suite PHPUnit está funcional.
 *
 * Este arquivo vai crescer na Fase 2, quando as classes PSR-4 em src/
 * forem extraídas de api/bootstrap.php e puderem ser testadas unitariamente.
 */
final class SanityTest extends TestCase
{
    public function testSuiteIsRunning(): void
    {
        $this->assertTrue(true, 'PHPUnit está funcionando.');
    }

    public function testPlaceholderIsAutoloaded(): void
    {
        $this->assertSame('0.0.0-phase-0', Placeholder::version());
    }
}
