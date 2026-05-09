<?php

declare(strict_types=1);

namespace Diamantes\Storage;

/**
 * StorageDriver implementation backed by the existing JSON flat-file storage.
 *
 * Wraps StateRepository to satisfy the StorageDriver interface. This is the
 * default driver (GP_STORAGE_DRIVER=json) and preserves all Fase 3 behaviour.
 *
 * Reading and writing users delegates to the full gp_read_state() /
 * gp_update_state() pattern via callable injections, keeping all normalization
 * logic in bootstrap.php (unchanged).
 */
final class JsonStateDriver implements StorageDriver
{
    public function __construct(
        private readonly StateRepository $repo,
        /** @var callable(): array<string, mixed> */
        private readonly mixed $readState,
        /** @var callable(callable): mixed */
        private readonly mixed $updateState,
        private readonly string $auditLogFile,
        private readonly string $portalsJsonFile,
    ) {
    }

    // ─── Users ────────────────────────────────────────────────────────────────

    public function readUsers(): array
    {
        $state = ($this->readState)();
        return is_array($state['users'] ?? null) ? $state['users'] : [];
    }

    public function writeUsers(array $users): void
    {
        ($this->updateState)(static function (array $state) use ($users): array {
            $state['users'] = $users;
            return [$state, null];
        });
    }

    public function findUserById(string $id): ?array
    {
        $state = ($this->readState)();
        foreach (is_array($state['users'] ?? null) ? $state['users'] : [] as $user) {
            if (is_array($user) && ($user['id'] ?? '') === $id) {
                return $user;
            }
        }
        return null;
    }

    public function findUserByEmail(string $email): ?array
    {
        $normalized = mb_strtolower(trim($email), 'UTF-8');
        $state = ($this->readState)();
        foreach (is_array($state['users'] ?? null) ? $state['users'] : [] as $user) {
            if (!is_array($user)) {
                continue;
            }
            if (mb_strtolower(trim((string)($user['email'] ?? '')), 'UTF-8') === $normalized) {
                return $user;
            }
        }
        return null;
    }

    public function upsertUser(array $user): void
    {
        $id = (string)($user['id'] ?? '');
        ($this->updateState)(static function (array $state) use ($user, $id): array {
            $users  = is_array($state['users'] ?? null) ? $state['users'] : [];
            $found  = false;
            foreach ($users as &$existing) {
                if (is_array($existing) && ($existing['id'] ?? '') === $id) {
                    $existing = $user;
                    $found    = true;
                    break;
                }
            }
            unset($existing);
            if (!$found) {
                $users[] = $user;
            }
            $state['users'] = $users;
            return [$state, null];
        });
    }

    public function deleteUser(string $id): void
    {
        ($this->updateState)(static function (array $state) use ($id): array {
            $users = is_array($state['users'] ?? null) ? $state['users'] : [];
            $state['users'] = array_values(array_filter(
                $users,
                static fn($u): bool => is_array($u) && ($u['id'] ?? '') !== $id
            ));
            return [$state, null];
        });
    }

    // ─── Audit log ───────────────────────────────────────────────────────────

    public function appendAuditLog(array $entry): void
    {
        $this->repo->appendLogLine($this->auditLogFile, $entry);
    }

    // ─── Clients ─────────────────────────────────────────────────────────────

    public function readClients(): array
    {
        $portalsRaw = @file_get_contents($this->portalsJsonFile);
        if ($portalsRaw === false) {
            return [];
        }
        $config = json_decode($portalsRaw, true);
        if (!is_array($config) || !is_array($config['portals'] ?? null)) {
            return [];
        }
        return $config['portals'];
    }

    public function findClientBySlug(string $slug): ?array
    {
        foreach ($this->readClients() as $client) {
            if (is_array($client) && ($client['slug'] ?? '') === $slug) {
                return $client;
            }
        }
        return null;
    }
}
