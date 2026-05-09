<?php
/**
 * Portal authorization unit tests (Fase 3).
 *
 * Tests the access-control rules that portal/index.php implements:
 *  - Slug validation regex
 *  - Admin can access any slug
 *  - Client can only access their own slug
 *  - Unlinked client (no clientSlug) blocked
 *
 * We test the logic directly rather than including portal/index.php
 * (which uses exit()) to keep unit tests isolated and fast.
 */
declare(strict_types=1);

namespace Diamantes\Tests\Unit\Portal;

use PHPUnit\Framework\TestCase;

final class AuthorizationTest extends TestCase
{
    // ── Setup ─────────────────────────────────────────────────────────────────

    public static function setUpBeforeClass(): void
    {
        if (!defined('GP_ROOT')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 3) . '/api/bootstrap.php';
        }
    }

    // ── Slug validation ────────────────────────────────────────────────────────

    /**
     * @dataProvider validSlugProvider
     */
    public function testValidSlugsPassRegex(string $slug): void
    {
        $this->assertMatchesRegularExpression('/^[a-z][a-z0-9-]+$/', $slug);
    }

    /**
     * @return array<string, array<string>>
     */
    public static function validSlugProvider(): array
    {
        return [
            'simple'               => ['joao-eduardo-zanela'],
            'numbers'              => ['usuario123'],
            'with-hyphens'        => ['antonio-carlos-da-silva'],
            'single-segment'      => ['bernadete'],
        ];
    }

    /**
     * @dataProvider invalidSlugProvider
     */
    public function testInvalidSlugsFailRegex(string $slug): void
    {
        $this->assertDoesNotMatchRegularExpression('/^[a-z][a-z0-9-]+$/', $slug);
    }

    /**
     * @return array<string, array<string>>
     */
    public static function invalidSlugProvider(): array
    {
        return [
            'path-traversal'     => ['../etc/passwd'],
            'xss'                => ['<script>alert(1)</script>'],
            'uppercase'          => ['Joao-Eduardo'],
            'starts-with-number' => ['1joao'],
            'spaces'             => ['joao eduardo'],
            'empty'              => [''],
            'single-char'        => ['j'],
            'sql-injection'      => ["' OR 1=1 --"],
        ];
    }

    // ── Authorization logic ────────────────────────────────────────────────────

    /**
     * Mirrors the authorization logic in portal/index.php.
     *
     * Returns: null (allowed, effective slug) or string error code.
     *
     * @param array<string, mixed> $user
     */
    private function authorize(array $user, string $requestedSlug): string
    {
        // Validate slug format first.
        if ($requestedSlug !== '' && !preg_match('/^[a-z][a-z0-9-]+$/', $requestedSlug)) {
            return 'INVALID_SLUG';
        }

        $isAdmin  = ($user['role'] ?? '') === 'admin';
        $userSlug = (string)($user['clientSlug'] ?? '');

        if (!$isAdmin) {
            if (($user['status'] ?? '') !== 'approved') {
                return 'NOT_APPROVED';
            }
            if ($requestedSlug !== '' && $requestedSlug !== $userSlug) {
                return 'FORBIDDEN';
            }
            $effectiveSlug = $userSlug;
        } else {
            $effectiveSlug = $requestedSlug !== '' ? $requestedSlug : $userSlug;
        }

        if ($effectiveSlug === '') {
            return 'NO_SLUG';
        }

        return 'OK:' . $effectiveSlug;
    }

    public function testAdminCanAccessAnySlug(): void
    {
        $admin = ['role' => 'admin', 'clientSlug' => ''];
        $this->assertSame('OK:joao-eduardo-zanela', $this->authorize($admin, 'joao-eduardo-zanela'));
        $this->assertSame('OK:alessandro-lima', $this->authorize($admin, 'alessandro-lima'));
    }

    public function testClientCanAccessOwnSlug(): void
    {
        $client = ['role' => 'client', 'clientSlug' => 'test-client', 'status' => 'approved'];
        $this->assertSame('OK:test-client', $this->authorize($client, 'test-client'));
    }

    public function testClientCannotAccessDifferentSlug(): void
    {
        $client = ['role' => 'client', 'clientSlug' => 'test-client', 'status' => 'approved'];
        $this->assertSame('FORBIDDEN', $this->authorize($client, 'other-client'));
    }

    public function testClientWithNoSlugBlocked(): void
    {
        $client = ['role' => 'client', 'clientSlug' => '', 'status' => 'approved'];
        $this->assertSame('NO_SLUG', $this->authorize($client, ''));
    }

    public function testPathTraversalSlugRejected(): void
    {
        $admin = ['role' => 'admin', 'clientSlug' => ''];
        $this->assertSame('INVALID_SLUG', $this->authorize($admin, '../etc/passwd'));
    }

    public function testXssSlugRejected(): void
    {
        $admin = ['role' => 'admin', 'clientSlug' => ''];
        $this->assertSame('INVALID_SLUG', $this->authorize($admin, '<script>alert(1)</script>'));
    }

    public function testAdminWithNoRequestedSlugAndNoClientSlugBlocked(): void
    {
        $admin = ['role' => 'admin', 'clientSlug' => ''];
        $this->assertSame('NO_SLUG', $this->authorize($admin, ''));
    }

    public function testPendingClientBlocked(): void
    {
        $client = ['role' => 'client', 'clientSlug' => 'test-client', 'status' => 'pending'];
        $this->assertSame('NOT_APPROVED', $this->authorize($client, 'test-client'));
    }

    public function testRejectedClientBlocked(): void
    {
        $client = ['role' => 'client', 'clientSlug' => 'test-client', 'status' => 'rejected'];
        $this->assertSame('NOT_APPROVED', $this->authorize($client, 'test-client'));
    }

    public function testDisabledClientBlocked(): void
    {
        $client = ['role' => 'client', 'clientSlug' => 'test-client', 'status' => 'disabled'];
        $this->assertSame('NOT_APPROVED', $this->authorize($client, 'test-client'));
    }

    public function testAdminFallsBackToClientSlugWhenNoRequest(): void
    {
        // Admin who is also linked to a client for convenience.
        $admin = ['role' => 'admin', 'clientSlug' => 'joao-eduardo-zanela'];
        $this->assertSame('OK:joao-eduardo-zanela', $this->authorize($admin, ''));
    }

    // ── portals.json structure ─────────────────────────────────────────────────

    public function testPortalsJsonHas27Entries(): void
    {
        $path = GP_ROOT . '/api/data/portals.json';
        $this->assertFileExists($path);

        $data = json_decode((string)file_get_contents($path), true);
        $this->assertIsArray($data, 'portals.json must decode to array');
        $this->assertArrayHasKey('portals', $data);
        $this->assertCount(27, $data['portals'], 'portals.json must contain exactly 27 portals');
    }

    public function testEachPortalHasRequiredFields(): void
    {
        $path = GP_ROOT . '/api/data/portals.json';
        $data = json_decode((string)file_get_contents($path), true);

        foreach ($data['portals'] as $portal) {
            $slug = $portal['slug'] ?? '(missing)';
            $this->assertArrayHasKey('slug', $portal, "Portal {$slug} missing slug");
            $this->assertArrayHasKey('display_name', $portal, "Portal {$slug} missing display_name");
            $this->assertArrayHasKey('cliente_name_var', $portal, "Portal {$slug} missing cliente_name_var");
            $this->assertArrayHasKey('cliente_task_id', $portal, "Portal {$slug} missing cliente_task_id");
            $this->assertArrayHasKey('cf_tipos', $portal, "Portal {$slug} missing cf_tipos");
            $this->assertArrayHasKey('assignee_ids', $portal, "Portal {$slug} missing assignee_ids");
            $this->assertArrayHasKey('auto_map', $portal, "Portal {$slug} missing auto_map");

            // Slug must pass the regex used in portal/index.php.
            $this->assertMatchesRegularExpression(
                '/^[a-z][a-z0-9-]+$/',
                (string)$portal['slug'],
                "Portal slug '{$portal['slug']}' is invalid"
            );

            // cf_tipos must be a non-empty array.
            $this->assertIsArray($portal['cf_tipos'], "Portal {$slug} cf_tipos must be array");
            $this->assertNotEmpty($portal['cf_tipos'], "Portal {$slug} cf_tipos must not be empty");

            // auto_map keys must be subset of cf_tipos.
            foreach (array_keys($portal['auto_map']) as $tipo) {
                $this->assertContains(
                    $tipo,
                    $portal['cf_tipos'],
                    "Portal {$slug}: auto_map key '{$tipo}' not in cf_tipos"
                );
            }
        }
    }

    public function testAllAutoMapValuesExistInAssigneeIds(): void
    {
        $path = GP_ROOT . '/api/data/portals.json';
        $data = json_decode((string)file_get_contents($path), true);

        foreach ($data['portals'] as $portal) {
            $slug = $portal['slug'] ?? '(missing)';
            foreach ($portal['auto_map'] as $tipo => $prestador) {
                $this->assertArrayHasKey(
                    $prestador,
                    $portal['assignee_ids'],
                    "Portal {$slug}: auto_map value '{$prestador}' not in assignee_ids"
                );
            }
        }
    }

    // ── Template file ──────────────────────────────────────────────────────────

    public function testTemplateContainsAllRequiredPlaceholders(): void
    {
        $path = GP_ROOT . '/portal/template.html';
        $this->assertFileExists($path);

        $tpl = (string)file_get_contents($path);

        $requiredPlaceholders = [
            '{{DISPLAY_NAME}}',
            '{{CLIENTE_NAME_VAR}}',
            '{{CLIENTE_TASK_ID}}',
            '{{CF_TIPOS_JSON}}',
            '{{ASSIGNEE_IDS_JSON}}',
            '{{AUTO_MAP_JSON}}',
            '{{TIPO_OPTIONS_HTML}}',
            '{{PRESTADOR_OPTIONS_HTML}}',
            '{{CSS_CARD_BG}}',
        ];

        foreach ($requiredPlaceholders as $placeholder) {
            $this->assertStringContainsString($placeholder, $tpl, "Template missing placeholder: {$placeholder}");
        }
    }

    public function testTemplateHasNoOldCanonicalValues(): void
    {
        $path = GP_ROOT . '/portal/template.html';
        $tpl = (string)file_get_contents($path);

        // These are canonical-portal-specific values that should have been replaced.
        $this->assertStringNotContainsString('JOAO EDUARDO ZANELA', $tpl);
        $this->assertStringNotContainsString('86agchp26', $tpl);
    }

    public function testTemplateRenderProducesValidHtmlForAllessandroLima(): void
    {
        // This slug has 1 cf_tipo, which tests minimal-options rendering.
        $tplPath = GP_ROOT . '/portal/template.html';
        $dataPath = GP_ROOT . '/api/data/portals.json';

        $tpl  = (string)file_get_contents($tplPath);
        $data = json_decode((string)file_get_contents($dataPath), true);

        $portal = null;
        foreach ($data['portals'] as $p) {
            if (($p['slug'] ?? '') === 'alessandro-lima') {
                $portal = $p;
                break;
            }
        }
        $this->assertNotNull($portal, 'alessandro-lima not found in portals.json');

        $jsonFlags = JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT;

        $cfTipos = [];
        foreach ($portal['cf_tipos'] as $tipo) {
            $cfTipos[$tipo] = null;
        }

        $tipoOptionsHtml = '';
        foreach (array_keys($cfTipos) as $tipo) {
            $esc = htmlspecialchars($tipo, ENT_QUOTES, 'UTF-8');
            $tipoOptionsHtml .= '              <div class="option" data-value="' . $esc . '">' . $esc . '</div>' . "\r\n";
        }
        $tipoOptionsHtml = rtrim($tipoOptionsHtml, "\r\n");

        $prestadorOptionsHtml = '';
        foreach (array_keys($portal['assignee_ids']) as $name) {
            $esc = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
            $prestadorOptionsHtml .= '              <div class="option" data-value="' . $esc . '">' . $esc . '</div>' . "\r\n";
        }
        $prestadorOptionsHtml = rtrim($prestadorOptionsHtml, "\r\n");

        $replacements = [
            '{{DISPLAY_NAME}}'           => htmlspecialchars($portal['display_name'], ENT_QUOTES, 'UTF-8'),
            '{{CLIENTE_NAME_VAR}}'       => htmlspecialchars($portal['cliente_name_var'], ENT_QUOTES, 'UTF-8'),
            '{{CLIENTE_TASK_ID}}'        => htmlspecialchars($portal['cliente_task_id'], ENT_QUOTES, 'UTF-8'),
            // Use the same legacy multi-line format as portal/index.php builds.
            '{{CF_TIPOS_JSON}}'          => gp_portal_object_literal($cfTipos),
            '{{ASSIGNEE_IDS_JSON}}'      => gp_portal_object_literal($portal['assignee_ids']),
            '{{AUTO_MAP_JSON}}'          => gp_portal_object_literal($portal['auto_map']),
            '{{TIPO_OPTIONS_HTML}}'      => $tipoOptionsHtml,
            '{{PRESTADOR_OPTIONS_HTML}}' => $prestadorOptionsHtml,
            '{{CSS_CARD_BG}}'            => (string)($portal['css_card_bg'] ?? '#ffffff'),
        ];

        $rendered = strtr($tpl, $replacements);

        // Title should contain the correct name, not the buggy Luís Rocha.
        $this->assertStringContainsString('Alessandro Lima', $rendered);
        $this->assertStringNotContainsString('Luís Rocha', $rendered);
        $this->assertStringNotContainsString('{{', $rendered, 'No unreplaced placeholders');

        // Should contain the single auto_map entry.
        $this->assertStringContainsString('MARCOS PAULO', $rendered);
        $this->assertStringContainsString('AUTOMAÇÃO', $rendered);
    }
}
