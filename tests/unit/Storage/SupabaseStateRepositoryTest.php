<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Storage;

use Diamantes\Storage\StorageException;
use Diamantes\Storage\SupabaseStateRepository;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for SupabaseStateRepository.
 *
 * Uses anonymous-class stubs to override the protected curlRequest() seam,
 * so no live Supabase connection is required.
 *
 * The protected visibility on curlRequest() is the test seam — changing it
 * to public in tests is intentional (anonymous class can widen visibility).
 */
final class SupabaseStateRepositoryTest extends TestCase
{
    // ─── fromEnv ─────────────────────────────────────────────────────────────

    public function testFromEnvReturnsNullWhenVarsAbsent(): void
    {
        $origUrl = getenv('GP_SUPABASE_URL');
        $origKey = getenv('GP_SUPABASE_SERVICE_ROLE_KEY');

        putenv('GP_SUPABASE_URL=');
        putenv('GP_SUPABASE_SERVICE_ROLE_KEY=');

        $result = SupabaseStateRepository::fromEnv();
        $this->assertNull($result);

        putenv('GP_SUPABASE_URL=' . ($origUrl !== false ? $origUrl : ''));
        putenv('GP_SUPABASE_SERVICE_ROLE_KEY=' . ($origKey !== false ? $origKey : ''));
    }

    public function testFromEnvReturnsInstanceWhenVarsPresent(): void
    {
        $origUrl = getenv('GP_SUPABASE_URL');
        $origKey = getenv('GP_SUPABASE_SERVICE_ROLE_KEY');

        putenv('GP_SUPABASE_URL=https://example.supabase.co');
        putenv('GP_SUPABASE_SERVICE_ROLE_KEY=test-key');

        $result = SupabaseStateRepository::fromEnv();
        $this->assertInstanceOf(SupabaseStateRepository::class, $result);

        putenv('GP_SUPABASE_URL=' . ($origUrl !== false ? $origUrl : ''));
        putenv('GP_SUPABASE_SERVICE_ROLE_KEY=' . ($origKey !== false ? $origKey : ''));
    }

    // ─── readUsers ────────────────────────────────────────────────────────────

    public function testReadUsersReturnsMappedUsers(): void
    {
        $rawRows = [
            [
                'id'            => 'user-1',
                'name'          => 'João',
                'email'         => 'joao@example.com',
                'password_hash' => '$2y$10$abc',
                'role'          => 'admin',
                'status'        => 'approved',
                'client_slug'   => '',
                'meta'          => ['documentType' => 'cpf', 'documentValue' => '12345678900', 'cpf' => '12345678900'],
                'created_at'    => '2026-01-01T00:00:00.000Z',
                'updated_at'    => '2026-01-01T00:00:00.000Z',
            ],
        ];

        $stub  = $this->stubWithBody(json_encode($rawRows), 200);
        $users = $stub->readUsers();

        $this->assertCount(1, $users);
        $this->assertSame('user-1', $users[0]['id']);
        $this->assertSame('joao@example.com', $users[0]['email']);
        $this->assertSame('$2y$10$abc', $users[0]['password']);
        $this->assertSame('admin', $users[0]['role']);
        $this->assertSame('cpf', $users[0]['documentType']);
        $this->assertSame('12345678900', $users[0]['documentValue']);
    }

    public function testReadUsersReturnsEmptyArrayWhenNoRows(): void
    {
        $stub  = $this->stubWithBody('[]', 200);
        $users = $stub->readUsers();
        $this->assertSame([], $users);
    }

    public function testReadUsersThrowsOnHttpError(): void
    {
        $stub = $this->stubWithBody('{"message":"Internal Server Error"}', 500);
        $this->expectException(StorageException::class);
        $stub->readUsers();
    }

    // ─── findUserById ─────────────────────────────────────────────────────────

    public function testFindUserByIdReturnsUser(): void
    {
        $rawRow = $this->sampleRawUser('abc-123', 'joao-lima');
        $stub   = $this->stubWithBody(json_encode([$rawRow]), 200);
        $user   = $stub->findUserById('abc-123');

        $this->assertNotNull($user);
        $this->assertSame('abc-123', $user['id']);
        $this->assertSame('joao-lima', $user['clientSlug']);
    }

    public function testFindUserByIdReturnsNullWhenNotFound(): void
    {
        $stub = $this->stubWithBody('[]', 200);
        $user = $stub->findUserById('nonexistent');
        $this->assertNull($user);
    }

    // ─── findUserByEmail ──────────────────────────────────────────────────────

    public function testFindUserByEmailNormalizesCase(): void
    {
        $rawRow = $this->sampleRawUser('u1', '', 'alice@example.com');
        $stub   = $this->stubWithBody(json_encode([$rawRow]), 200);

        $user = $stub->findUserByEmail('ALICE@EXAMPLE.COM');
        $this->assertNotNull($user);
        $this->assertSame('alice@example.com', $user['email']);
    }

    public function testFindUserByEmailReturnsNullWhenNotFound(): void
    {
        $stub = $this->stubWithBody('[]', 200);
        $user = $stub->findUserByEmail('nobody@example.com');
        $this->assertNull($user);
    }

    // ─── upsertUser ───────────────────────────────────────────────────────────

    public function testUpsertUserBuildsCorrectRow(): void
    {
        $captured = null;
        $stub = $this->stubCapture(function (string $method, string $path, mixed $payload) use (&$captured): array {
            $captured = $payload;
            return [201, '[]'];
        });

        $stub->upsertUser([
            'id'            => 'u-new',
            'name'          => 'New User',
            'email'         => 'NEW@EXAMPLE.COM',
            'password'      => '$2y$10$hash',
            'role'          => 'client',
            'status'        => 'pending',
            'clientSlug'    => 'some-slug',
            'documentType'  => 'cpf',
            'documentValue' => '11111111111',
            'cpf'           => '11111111111',
        ]);

        $this->assertIsArray($captured);
        $row = $captured[0];
        $this->assertSame('u-new', $row['id']);
        // email must be lower-cased
        $this->assertSame('new@example.com', $row['email']);
        $this->assertSame('$2y$10$hash', $row['password_hash']);
        $this->assertSame('some-slug', $row['client_slug']);
        $this->assertSame('cpf', $row['meta']['documentType']);
        $this->assertSame('11111111111', $row['meta']['documentValue']);
    }

    public function testUpsertUserOmitsIdWhenEmpty(): void
    {
        $captured = null;
        $stub = $this->stubCapture(function (string $method, string $path, mixed $payload) use (&$captured): array {
            $captured = $payload;
            return [201, '[]'];
        });

        $stub->upsertUser([
            'id'    => '',
            'name'  => 'NoId',
            'email' => 'noid@example.com',
        ]);

        $this->assertIsArray($captured);
        $this->assertArrayNotHasKey('id', $captured[0]);
    }

    // ─── deleteUser ───────────────────────────────────────────────────────────

    public function testDeleteUserSendsDeleteRequest(): void
    {
        $capturedMethod = null;
        $capturedPath   = null;
        $stub = $this->stubCapture(function (string $method, string $path, mixed $payload) use (&$capturedMethod, &$capturedPath): array {
            $capturedMethod = $method;
            $capturedPath   = $path;
            return [204, ''];
        });

        $stub->deleteUser('u-del');

        $this->assertSame('DELETE', $capturedMethod);
        $this->assertStringContainsString('u-del', $capturedPath);
    }

    // ─── appendAuditLog ───────────────────────────────────────────────────────

    public function testAppendAuditLogMapsFields(): void
    {
        $captured = null;
        $stub = $this->stubCapture(function (string $method, string $path, mixed $payload) use (&$captured): array {
            $captured = $payload;
            return [201, '{}'];
        });

        $stub->appendAuditLog([
            'event'  => 'portal_accessed',
            'userId' => 'u-1',
            'ip'     => '10.0.0.1',
            'time'   => '2026-01-01T00:00:00.000Z',
        ]);

        $this->assertIsArray($captured);
        $this->assertSame('portal_accessed', $captured['event']);
        $this->assertSame('u-1', $captured['user_id']);
        $this->assertSame('10.0.0.1', $captured['ip']);
        $this->assertSame('2026-01-01T00:00:00.000Z', $captured['created_at']);
    }

    public function testAppendAuditLogHandlesNullUserId(): void
    {
        $captured = null;
        $stub = $this->stubCapture(function (string $method, string $path, mixed $payload) use (&$captured): array {
            $captured = $payload;
            return [201, '{}'];
        });

        $stub->appendAuditLog(['event' => 'test_event']);

        $this->assertNull($captured['user_id'] ?? null);
    }

    // ─── readClients ──────────────────────────────────────────────────────────

    public function testReadClientsReturnsMappedClients(): void
    {
        $rawRow = [
            'slug'         => 'joao-lima',
            'display_name' => 'João Lima',
            'config'       => [
                'cliente_name_var'      => 'JOÃO LIMA',
                'cliente_task_id'       => 'abc123',
                'cf_tipos'              => ['SOCIAL MEDIA'],
                'assignee_ids'          => ['GABRIEL' => 84782862],
                'auto_map'              => ['SOCIAL MEDIA' => 'GABRIEL'],
                'css_card_bg'           => '#ffffff',
                'dropdown_indent_quirk' => true,
            ],
        ];

        $stub    = $this->stubWithBody(json_encode([$rawRow]), 200);
        $clients = $stub->readClients();

        $this->assertCount(1, $clients);
        $this->assertSame('joao-lima', $clients[0]['slug']);
        $this->assertSame('JOÃO LIMA', $clients[0]['cliente_name_var']);
        $this->assertSame('abc123', $clients[0]['cliente_task_id']);
        $this->assertSame(['SOCIAL MEDIA'], $clients[0]['cf_tipos']);
        $this->assertSame(['GABRIEL' => 84782862], $clients[0]['assignee_ids']);
    }

    public function testFindClientBySlugReturnsNullWhenNotFound(): void
    {
        $stub   = $this->stubWithBody('[]', 200);
        $client = $stub->findClientBySlug('nonexistent');
        $this->assertNull($client);
    }

    public function testFindClientBySlugReturnsClient(): void
    {
        $rawRow = [
            'slug'         => 'target-slug',
            'display_name' => 'Target',
            'config'       => [],
        ];
        $stub   = $this->stubWithBody(json_encode([$rawRow]), 200);
        $client = $stub->findClientBySlug('target-slug');

        $this->assertNotNull($client);
        $this->assertSame('target-slug', $client['slug']);
    }

    // ─── Stub factory helpers ─────────────────────────────────────────────────

    /**
     * Build a stub that always returns a fixed HTTP status + body.
     */
    private function stubWithBody(string $body, int $status): SupabaseStateRepository
    {
        $stub = new class ('https://test.supabase.co', 'test-key') extends SupabaseStateRepository {
            public string $stubBody   = '[]';
            public int    $stubStatus = 200;

            protected function curlRequest(string $method, string $path, mixed $payload, array $extraHeaders): array
            {
                return [$this->stubStatus, $this->stubBody];
            }
        };
        $stub->stubBody   = $body;
        $stub->stubStatus = $status;
        return $stub;
    }

    /**
     * Build a stub that delegates curlRequest to a user-provided callable.
     * Callable signature: (string $method, string $path, mixed $payload): array{int, string}
     *
     * @param callable(string, string, mixed): array{int, string} $handler
     */
    private function stubCapture(callable $handler): SupabaseStateRepository
    {
        $stub = new class ('https://test.supabase.co', 'test-key') extends SupabaseStateRepository {
            /** @var callable */
            public $handler;

            protected function curlRequest(string $method, string $path, mixed $payload, array $extraHeaders): array
            {
                return ($this->handler)($method, $path, $payload);
            }
        };
        $stub->handler = $handler;
        return $stub;
    }

    /**
     * Sample raw Supabase row for user fixtures.
     *
     * @return array<string, mixed>
     */
    private function sampleRawUser(string $id, string $clientSlug = '', string $email = 'test@example.com'): array
    {
        return [
            'id'            => $id,
            'name'          => 'Test User',
            'email'         => $email,
            'password_hash' => '$2y$10$xyz',
            'role'          => 'client',
            'status'        => 'approved',
            'client_slug'   => $clientSlug,
            'meta'          => ['documentType' => 'cpf', 'documentValue' => '', 'cpf' => ''],
            'created_at'    => '2026-01-01T00:00:00.000Z',
            'updated_at'    => '2026-01-01T00:00:00.000Z',
        ];
    }
}
