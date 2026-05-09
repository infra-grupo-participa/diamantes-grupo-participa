<?php

declare(strict_types=1);

namespace Diamantes\Storage;

/**
 * Contract for application state persistence drivers.
 *
 * All implementations MUST be idempotent on read, atomic on write,
 * and MUST never leak driver-specific exceptions to callers — wrap in
 * StorageException instead.
 *
 * Implementations:
 *  - StateRepository  — JSON flat-file (default, Fase 3)
 *  - SupabaseStateRepository — PostgREST over HTTPS (Fase 5)
 *  - DualWriteStorageDriver — fan-out writes for zero-downtime migration
 */
interface StorageDriver
{
    // ─── Users ────────────────────────────────────────────────────────────────

    /**
     * Return all users as a flat array of user arrays.
     *
     * @return array<int, array<string, mixed>>
     */
    public function readUsers(): array;

    /**
     * Persist a full snapshot of all users, replacing any previous state.
     *
     * @param array<int, array<string, mixed>> $users
     */
    public function writeUsers(array $users): void;

    /**
     * Find a single user by ID. Returns null when not found.
     *
     * @return array<string, mixed>|null
     */
    public function findUserById(string $id): ?array;

    /**
     * Find a single user by email (case-insensitive). Returns null when not found.
     *
     * @return array<string, mixed>|null
     */
    public function findUserByEmail(string $email): ?array;

    /**
     * Insert or update a user record (upsert by id).
     *
     * @param array<string, mixed> $user
     */
    public function upsertUser(array $user): void;

    /**
     * Delete a user by ID. No-op when not found.
     */
    public function deleteUser(string $id): void;

    // ─── Audit log ───────────────────────────────────────────────────────────

    /**
     * Append a single audit log entry.
     *
     * @param array<string, mixed> $entry
     */
    public function appendAuditLog(array $entry): void;

    // ─── Clients (portals) ────────────────────────────────────────────────────

    /**
     * Return all client/portal configurations.
     *
     * @return array<int, array<string, mixed>>
     */
    public function readClients(): array;

    /**
     * Find a single client by slug. Returns null when not found.
     *
     * @return array<string, mixed>|null
     */
    public function findClientBySlug(string $slug): ?array;
}
