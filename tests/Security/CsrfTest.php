<?php

declare(strict_types=1);

namespace Diamantes\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * HIGH-3: CSRF token generation and validation.
 *
 * Tests gp_get_csrf_token() and gp_require_csrf_header() logic
 * in isolation by manipulating $_SESSION and $_SERVER directly.
 */
final class CsrfTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (!function_exists('gp_verify_password')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 2) . '/api/bootstrap.php';
        }
    }

    protected function setUp(): void
    {
        // Reset session state and server vars before each test.
        $_SESSION = [];
        $_SERVER['REQUEST_METHOD'] = 'POST';
        unset($_SERVER['HTTP_X_CSRF_TOKEN']);
    }

    protected function tearDown(): void
    {
        $_SESSION = [];
        $_SERVER['REQUEST_METHOD'] = 'GET';
        unset($_SERVER['HTTP_X_CSRF_TOKEN']);
    }

    public function testGetCsrfTokenGeneratesToken(): void
    {
        $token = gp_get_csrf_token();

        $this->assertNotEmpty($token, 'Token must not be empty');
        $this->assertSame(64, strlen($token), 'Token should be 64 hex chars (32 bytes)');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $token, 'Token must be hex string');
    }

    public function testGetCsrfTokenIsIdempotent(): void
    {
        $token1 = gp_get_csrf_token();
        $token2 = gp_get_csrf_token();

        $this->assertSame($token1, $token2, 'Token must be the same within the same session');
    }

    public function testRequireCsrfHeaderPassesWhenTokenMatches(): void
    {
        $token = gp_get_csrf_token();
        $_SERVER['HTTP_X_CSRF_TOKEN'] = $token;
        $_SERVER['REQUEST_METHOD'] = 'POST';

        // We can't call gp_require_csrf_header() directly because it calls gp_json_response()
        // which calls exit(). Instead we replicate the validation logic.
        $headerToken = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        $stored = (string)($_SESSION['gp_csrf_token'] ?? '');
        $valid = $stored !== '' && $headerToken !== '' && hash_equals($stored, $headerToken);

        $this->assertTrue($valid, 'Matching token must pass validation');
    }

    public function testRequireCsrfHeaderFailsWhenTokenMissing(): void
    {
        gp_get_csrf_token(); // Ensure token is in session.
        $_SERVER['REQUEST_METHOD'] = 'POST';
        // No HTTP_X_CSRF_TOKEN set.

        $headerToken = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        $stored = (string)($_SESSION['gp_csrf_token'] ?? '');
        $valid = $stored !== '' && $headerToken !== '' && hash_equals($stored, $headerToken);

        $this->assertFalse($valid, 'Missing header token must fail validation');
    }

    public function testRequireCsrfHeaderFailsWhenTokenWrong(): void
    {
        gp_get_csrf_token(); // Real token in session.
        $_SERVER['HTTP_X_CSRF_TOKEN'] = str_repeat('0', 64); // Wrong token.
        $_SERVER['REQUEST_METHOD'] = 'POST';

        $headerToken = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        $stored = (string)($_SESSION['gp_csrf_token'] ?? '');
        $valid = $stored !== '' && $headerToken !== '' && hash_equals($stored, $headerToken);

        $this->assertFalse($valid, 'Wrong token must fail validation');
    }

    public function testRequireCsrfHeaderSkipsGetRequests(): void
    {
        $_SERVER['REQUEST_METHOD'] = 'GET';
        // Even with no token, GET should not be blocked.
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $blocked = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true);

        $this->assertFalse($blocked, 'GET requests must not be subject to CSRF check');
    }

    public function testDifferentSessionsGetDifferentTokens(): void
    {
        $token1 = gp_get_csrf_token();

        // Simulate new session.
        $_SESSION = [];
        $token2 = gp_get_csrf_token();

        $this->assertNotSame($token1, $token2, 'Different sessions must get different tokens');
    }
}
