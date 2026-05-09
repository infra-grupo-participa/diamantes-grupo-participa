<?php

declare(strict_types=1);

namespace Diamantes\Storage;

/**
 * Dual-write StorageDriver for zero-downtime migration.
 *
 * All write operations (writeUsers, upsertUser, deleteUser, appendAuditLog)
 * are fanned out to BOTH the primary and the secondary driver.
 *
 * All read operations use the primary driver only.
 *
 * If the secondary driver throws during a write, the error is silently logged
 * to error_log() and does NOT propagate — this ensures a degraded secondary
 * (e.g. Supabase temporarily unavailable) never disrupts production traffic.
 *
 * Usage (GP_STORAGE_DRIVER=dual):
 *
 *   primary   → StateRepository (JSON) — reads come from here
 *   secondary → SupabaseStateRepository (PostgREST) — kept in sync
 *
 * Once migration is validated, flip GP_STORAGE_DRIVER=supabase and decommission
 * the JSON files.
 */
final class DualWriteStorageDriver implements StorageDriver
{
    public function __construct(
        private readonly StorageDriver $primary,
        private readonly StorageDriver $secondary,
    ) {
    }

    // ─── Reads (primary only) ─────────────────────────────────────────────────

    public function readUsers(): array
    {
        return $this->primary->readUsers();
    }

    public function findUserById(string $id): ?array
    {
        return $this->primary->findUserById($id);
    }

    public function findUserByEmail(string $email): ?array
    {
        return $this->primary->findUserByEmail($email);
    }

    public function readClients(): array
    {
        return $this->primary->readClients();
    }

    public function findClientBySlug(string $slug): ?array
    {
        return $this->primary->findClientBySlug($slug);
    }

    // ─── Writes (fan-out to both) ─────────────────────────────────────────────

    public function writeUsers(array $users): void
    {
        $this->primary->writeUsers($users);
        $this->trySecondary(fn() => $this->secondary->writeUsers($users), 'writeUsers');
    }

    public function upsertUser(array $user): void
    {
        $this->primary->upsertUser($user);
        $this->trySecondary(fn() => $this->secondary->upsertUser($user), 'upsertUser');
    }

    public function deleteUser(string $id): void
    {
        $this->primary->deleteUser($id);
        $this->trySecondary(fn() => $this->secondary->deleteUser($id), 'deleteUser');
    }

    public function appendAuditLog(array $entry): void
    {
        $this->primary->appendAuditLog($entry);
        $this->trySecondary(fn() => $this->secondary->appendAuditLog($entry), 'appendAuditLog');
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /**
     * Execute $fn against the secondary driver, swallowing any exception.
     * On failure: logs to error_log() for observability but never throws.
     */
    private function trySecondary(callable $fn, string $operation): void
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            error_log(sprintf(
                '[DualWriteStorageDriver] secondary.%s failed: %s',
                $operation,
                $e->getMessage()
            ));
        }
    }
}
