<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Auth;

use Diamantes\Auth\SessionManager;
use PHPUnit\Framework\TestCase;

final class SessionManagerTest extends TestCase
{
    protected function setUp(): void
    {
        $_SESSION = [];
    }

    protected function tearDown(): void
    {
        $_SESSION = [];
    }

    public function testSetUserStoresIdInSession(): void
    {
        SessionManager::setUser(['id' => 'usr_abc', 'name' => 'Test']);
        $this->assertSame('usr_abc', $_SESSION['gp_user_id']);
    }

    public function testGetUserIdReturnsStoredId(): void
    {
        $_SESSION['gp_user_id'] = 'usr_xyz';
        $this->assertSame('usr_xyz', SessionManager::getUserId());
    }

    public function testGetUserIdReturnsEmptyWhenNotSet(): void
    {
        unset($_SESSION['gp_user_id']);
        $this->assertSame('', SessionManager::getUserId());
    }

    public function testClearWipesSessionArray(): void
    {
        $_SESSION['gp_user_id'] = 'usr_123';
        $_SESSION['other'] = 'value';

        // session_destroy() requires an active session — just test the $_SESSION wipe path.
        SessionManager::clear();

        $this->assertSame([], $_SESSION);
    }

    public function testStartIsIdempotentWhenAlreadyActive(): void
    {
        // In CLI, session may already be active from bootstrap; calling start() again must not throw.
        SessionManager::start();
        SessionManager::start();
        $this->assertTrue(true);
    }
}
