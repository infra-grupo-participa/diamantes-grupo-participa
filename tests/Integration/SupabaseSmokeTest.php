<?php

declare(strict_types=1);

namespace Diamantes\Tests\Integration;

use Diamantes\Storage\SupabaseStateRepository;
use PHPUnit\Framework\TestCase;

/**
 * Integration smoke test — verifies real connectivity to Supabase.
 *
 * SKIPPED automatically when GP_SUPABASE_URL or GP_SUPABASE_SERVICE_ROLE_KEY
 * are absent (CI without credentials, local dev, etc.).
 *
 * To run manually:
 *   GP_SUPABASE_URL=https://... GP_SUPABASE_SERVICE_ROLE_KEY=... vendor/bin/phpunit tests/Integration/
 */
final class SupabaseSmokeTest extends TestCase
{
    private SupabaseStateRepository $repo;

    protected function setUp(): void
    {
        $url = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
        $key = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));

        if ($url === '' || $key === '') {
            $this->markTestSkipped('GP_SUPABASE_URL and GP_SUPABASE_SERVICE_ROLE_KEY not set — skipping integration test.');
        }

        $this->repo = new SupabaseStateRepository($url, $key);
    }

    public function testReadClientsReturnsArrayFromSupabase(): void
    {
        $clients = $this->repo->readClients();
        // The table may be empty in a fresh environment — just verify the call succeeds.
        $this->assertIsArray($clients);
    }

    public function testReadUsersReturnsArrayFromSupabase(): void
    {
        $users = $this->repo->readUsers();
        $this->assertIsArray($users);
    }

    public function testUpsertAndFindAndDeleteUser(): void
    {
        $testId = 'smoke-test-' . uniqid('', true);

        try {
            // Upsert
            $this->repo->upsertUser([
                'id'            => $testId,
                'name'          => 'Smoke Test User',
                'email'         => 'smoke-' . $testId . '@example.test',
                'password'      => '$2y$10$fakehash',
                'role'          => 'client',
                'status'        => 'pending',
                'clientSlug'    => '',
                'documentType'  => 'cpf',
                'documentValue' => '00000000000',
                'cpf'           => '00000000000',
            ]);

            // Find by ID
            $found = $this->repo->findUserById($testId);
            $this->assertNotNull($found, 'findUserById should return the upserted user.');
            $this->assertSame($testId, $found['id']);
            $this->assertSame('Smoke Test User', $found['name']);

            // Find by email
            $byEmail = $this->repo->findUserByEmail('smoke-' . $testId . '@example.test');
            $this->assertNotNull($byEmail);
            $this->assertSame($testId, $byEmail['id']);
        } finally {
            // Always clean up — even on assertion failure.
            $this->repo->deleteUser($testId);

            $deleted = $this->repo->findUserById($testId);
            $this->assertNull($deleted, 'User should be deleted after deleteUser().');
        }
    }

    public function testAppendAuditLogDoesNotThrow(): void
    {
        $this->repo->appendAuditLog([
            'event'  => 'smoke_test',
            'userId' => null,
            'time'   => date('c'),
        ]);
        // If we get here without exception, the log was appended (or silently accepted).
        $this->assertTrue(true);
    }
}
