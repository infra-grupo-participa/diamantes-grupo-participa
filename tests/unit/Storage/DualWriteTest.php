<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Storage;

use Diamantes\Storage\DualWriteStorageDriver;
use Diamantes\Storage\StorageDriver;
use Diamantes\Storage\StorageException;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for DualWriteStorageDriver.
 *
 * Verifies:
 *  - Reads come exclusively from the primary driver.
 *  - Writes are fanned out to both primary and secondary.
 *  - Secondary failures are swallowed (primary write still succeeds).
 */
final class DualWriteTest extends TestCase
{
    // ─── Read operations use primary only ─────────────────────────────────────

    public function testReadUsersReadsFromPrimaryOnly(): void
    {
        $users = [['id' => 'u1', 'name' => 'Primary User']];

        $primary   = $this->makeDriver(readUsers: $users);
        $secondary = $this->makeDriver(readUsers: [['id' => 'u2', 'name' => 'Secondary User']]);

        $dual   = new DualWriteStorageDriver($primary, $secondary);
        $result = $dual->readUsers();

        $this->assertSame($users, $result);
    }

    public function testFindUserByIdReadsFromPrimary(): void
    {
        $user = ['id' => 'abc', 'name' => 'From Primary'];

        $primary   = $this->makeDriver(findUserById: $user);
        $secondary = $this->makeDriver(findUserById: null);
        $dual      = new DualWriteStorageDriver($primary, $secondary);

        $result = $dual->findUserById('abc');
        $this->assertSame($user, $result);
    }

    public function testFindUserByEmailReadsFromPrimary(): void
    {
        $user = ['id' => 'xyz', 'email' => 'test@example.com'];

        $primary   = $this->makeDriver(findUserByEmail: $user);
        $secondary = $this->makeDriver(findUserByEmail: null);
        $dual      = new DualWriteStorageDriver($primary, $secondary);

        $result = $dual->findUserByEmail('test@example.com');
        $this->assertSame($user, $result);
    }

    public function testReadClientsReadsFromPrimary(): void
    {
        $clients = [['slug' => 'joao-lima']];

        $primary   = $this->makeDriver(readClients: $clients);
        $secondary = $this->makeDriver(readClients: []);
        $dual      = new DualWriteStorageDriver($primary, $secondary);

        $this->assertSame($clients, $dual->readClients());
    }

    public function testFindClientBySlugReadsFromPrimary(): void
    {
        $client = ['slug' => 'joao-lima', 'display_name' => 'João Lima'];

        $primary   = $this->makeDriver(findClientBySlug: $client);
        $secondary = $this->makeDriver(findClientBySlug: null);
        $dual      = new DualWriteStorageDriver($primary, $secondary);

        $this->assertSame($client, $dual->findClientBySlug('joao-lima'));
    }

    // ─── Write operations fan out to both ────────────────────────────────────

    public function testWriteUsersFansOutToBoth(): void
    {
        $primaryCalled   = false;
        $secondaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            if ($op === 'writeUsers') {
                $primaryCalled = true;
            }
        });
        $secondary = $this->makeWriteTracker(function (string $op) use (&$secondaryCalled) {
            if ($op === 'writeUsers') {
                $secondaryCalled = true;
            }
        });

        $dual = new DualWriteStorageDriver($primary, $secondary);
        $dual->writeUsers([['id' => 'u1']]);

        $this->assertTrue($primaryCalled);
        $this->assertTrue($secondaryCalled);
    }

    public function testUpsertUserFansOutToBoth(): void
    {
        $primaryCalled   = false;
        $secondaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            if ($op === 'upsertUser') {
                $primaryCalled = true;
            }
        });
        $secondary = $this->makeWriteTracker(function (string $op) use (&$secondaryCalled) {
            if ($op === 'upsertUser') {
                $secondaryCalled = true;
            }
        });

        $dual = new DualWriteStorageDriver($primary, $secondary);
        $dual->upsertUser(['id' => 'u1', 'name' => 'Test']);

        $this->assertTrue($primaryCalled);
        $this->assertTrue($secondaryCalled);
    }

    public function testDeleteUserFansOutToBoth(): void
    {
        $primaryCalled   = false;
        $secondaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            if ($op === 'deleteUser') {
                $primaryCalled = true;
            }
        });
        $secondary = $this->makeWriteTracker(function (string $op) use (&$secondaryCalled) {
            if ($op === 'deleteUser') {
                $secondaryCalled = true;
            }
        });

        $dual = new DualWriteStorageDriver($primary, $secondary);
        $dual->deleteUser('u1');

        $this->assertTrue($primaryCalled);
        $this->assertTrue($secondaryCalled);
    }

    public function testAppendAuditLogFansOutToBoth(): void
    {
        $primaryCalled   = false;
        $secondaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            if ($op === 'appendAuditLog') {
                $primaryCalled = true;
            }
        });
        $secondary = $this->makeWriteTracker(function (string $op) use (&$secondaryCalled) {
            if ($op === 'appendAuditLog') {
                $secondaryCalled = true;
            }
        });

        $dual = new DualWriteStorageDriver($primary, $secondary);
        $dual->appendAuditLog(['event' => 'test']);

        $this->assertTrue($primaryCalled);
        $this->assertTrue($secondaryCalled);
    }

    // ─── Secondary failures do NOT propagate ─────────────────────────────────

    public function testSecondaryWriteFailureDoesNotPropagateOnUpsert(): void
    {
        $primaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            if ($op === 'upsertUser') {
                $primaryCalled = true;
            }
        });
        $secondary = $this->makeFailingDriver();

        $dual = new DualWriteStorageDriver($primary, $secondary);

        // Must not throw even though secondary fails.
        $dual->upsertUser(['id' => 'u1']);

        $this->assertTrue($primaryCalled, 'Primary must still be called when secondary fails.');
    }

    public function testSecondaryWriteFailureDoesNotPropagateOnAppendAuditLog(): void
    {
        $primaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            $primaryCalled = true;
        });
        $secondary = $this->makeFailingDriver();
        $dual      = new DualWriteStorageDriver($primary, $secondary);

        $dual->appendAuditLog(['event' => 'test']);

        $this->assertTrue($primaryCalled);
    }

    public function testSecondaryWriteFailureDoesNotPropagateOnDeleteUser(): void
    {
        $primaryCalled = false;

        $primary   = $this->makeWriteTracker(function (string $op) use (&$primaryCalled) {
            $primaryCalled = true;
        });
        $secondary = $this->makeFailingDriver();
        $dual      = new DualWriteStorageDriver($primary, $secondary);

        $dual->deleteUser('u1');
        $this->assertTrue($primaryCalled);
    }

    // ─── Driver factories ─────────────────────────────────────────────────────

    /**
     * Build a read-only stub StorageDriver with configurable return values.
     *
     * @param array<int, array<string, mixed>> $readUsers
     * @param array<string, mixed>|null $findUserById
     * @param array<string, mixed>|null $findUserByEmail
     * @param array<int, array<string, mixed>> $readClients
     * @param array<string, mixed>|null $findClientBySlug
     */
    private function makeDriver(
        array $readUsers = [],
        ?array $findUserById = null,
        ?array $findUserByEmail = null,
        array $readClients = [],
        ?array $findClientBySlug = null,
    ): StorageDriver {
        return new class (
            $readUsers,
            $findUserById,
            $findUserByEmail,
            $readClients,
            $findClientBySlug,
        ) implements StorageDriver {
            public function __construct(
                private array  $users,
                private ?array $userById,
                private ?array $userByEmail,
                private array  $clients,
                private ?array $clientBySlug,
            ) {
            }

            public function readUsers(): array { return $this->users; }
            public function writeUsers(array $users): void { }
            public function findUserById(string $id): ?array { return $this->userById; }
            public function findUserByEmail(string $email): ?array { return $this->userByEmail; }
            public function upsertUser(array $user): void { }
            public function deleteUser(string $id): void { }
            public function appendAuditLog(array $entry): void { }
            public function readClients(): array { return $this->clients; }
            public function findClientBySlug(string $slug): ?array { return $this->clientBySlug; }
        };
    }

    /**
     * Build a StorageDriver that calls $onWrite($operationName) on any write.
     */
    private function makeWriteTracker(callable $onWrite): StorageDriver
    {
        return new class ($onWrite) implements StorageDriver {
            public function __construct(private readonly mixed $onWrite) {}

            public function readUsers(): array { return []; }
            public function findUserById(string $id): ?array { return null; }
            public function findUserByEmail(string $email): ?array { return null; }
            public function readClients(): array { return []; }
            public function findClientBySlug(string $slug): ?array { return null; }

            public function writeUsers(array $users): void { ($this->onWrite)('writeUsers'); }
            public function upsertUser(array $user): void { ($this->onWrite)('upsertUser'); }
            public function deleteUser(string $id): void { ($this->onWrite)('deleteUser'); }
            public function appendAuditLog(array $entry): void { ($this->onWrite)('appendAuditLog'); }
        };
    }

    /**
     * Build a StorageDriver where ALL write operations throw StorageException.
     */
    private function makeFailingDriver(): StorageDriver
    {
        return new class implements StorageDriver {
            public function readUsers(): array { return []; }
            public function findUserById(string $id): ?array { return null; }
            public function findUserByEmail(string $email): ?array { return null; }
            public function readClients(): array { return []; }
            public function findClientBySlug(string $slug): ?array { return null; }

            public function writeUsers(array $users): void {
                throw new StorageException('Secondary is down');
            }
            public function upsertUser(array $user): void {
                throw new StorageException('Secondary is down');
            }
            public function deleteUser(string $id): void {
                throw new StorageException('Secondary is down');
            }
            public function appendAuditLog(array $entry): void {
                throw new StorageException('Secondary is down');
            }
        };
    }
}
