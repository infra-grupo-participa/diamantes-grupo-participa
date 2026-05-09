<?php

declare(strict_types=1);

namespace Diamantes\Storage;

/**
 * StorageDriver implementation backed by Supabase via PostgREST (REST API).
 *
 * ## Why PostgREST instead of PDO pgsql?
 *
 * Hostinger shared hosting (the current deployment target) does NOT ship
 * pdo_pgsql/php_pgsql extensions in their standard PHP 8.2 environment.
 * PostgREST is accessible over HTTPS using only curl (always available) and
 * the service_role key, making this implementation fully portable without
 * requiring any PHP extension changes or host reconfiguration.
 *
 * Security:
 *  - service_role key is NEVER exposed to the frontend. PHP backend only.
 *  - Key is read from GP_SUPABASE_SERVICE_ROLE_KEY env var at runtime.
 *  - All writes use UPSERT with `on_conflict=id` to maintain idempotency.
 *  - RLS is bypassed by service_role; row-level authZ is enforced above this layer.
 *
 * Configuration (env vars):
 *  - GP_SUPABASE_URL            (e.g. https://npqyvjhvtfahuxfmuhie.supabase.co)
 *  - GP_SUPABASE_SERVICE_ROLE_KEY
 *  - GP_SUPABASE_SCHEMA         (default: 'portal' — isolates from co-tenant `public`
 *                                schema used by the Digisac bot in the same project)
 *
 * Schema isolation:
 *  PostgREST exposes additional schemas via the Accept-Profile (read) and
 *  Content-Profile (write) headers. The schema must be added to the project's
 *  exposed-schemas list in Settings → API. See docs/migration-supabase.md.
 *
 * All HTTP errors are wrapped in StorageException.
 */
class SupabaseStateRepository implements StorageDriver
{
    public const DEFAULT_SCHEMA = 'portal';

    private string $baseUrl;
    private string $serviceRoleKey;
    private string $schema;

    /** @var array<string, string> */
    private array $defaultHeaders;

    public function __construct(string $baseUrl, string $serviceRoleKey, string $schema = self::DEFAULT_SCHEMA)
    {
        $this->baseUrl        = rtrim($baseUrl, '/');
        $this->serviceRoleKey = $serviceRoleKey;
        $this->schema         = $schema;
        $this->defaultHeaders = [
            'apikey: '        . $this->serviceRoleKey,
            'Authorization: Bearer ' . $this->serviceRoleKey,
            'Content-Type: application/json',
            'Accept: application/json',
            'Accept-Profile: '  . $this->schema,
            'Content-Profile: ' . $this->schema,
            'Prefer: return=representation',
        ];
    }

    // ─── Factory ──────────────────────────────────────────────────────────────

    /**
     * Build from environment variables. Returns null when GP_SUPABASE_URL or
     * GP_SUPABASE_SERVICE_ROLE_KEY are absent (driver unavailable).
     */
    public static function fromEnv(): ?self
    {
        $url    = trim((string)(getenv('GP_SUPABASE_URL') ?: ''));
        $key    = trim((string)(getenv('GP_SUPABASE_SERVICE_ROLE_KEY') ?: ''));
        $schema = trim((string)(getenv('GP_SUPABASE_SCHEMA') ?: self::DEFAULT_SCHEMA));
        if ($url === '' || $key === '') {
            return null;
        }
        return new self($url, $key, $schema);
    }

    // ─── Users ────────────────────────────────────────────────────────────────

    public function readUsers(): array
    {
        $rows = $this->get('/rest/v1/users?select=*&order=created_at.asc');
        return array_map([$this, 'rowToUser'], $rows);
    }

    public function writeUsers(array $users): void
    {
        // Bulk UPSERT — replaces all rows matching existing IDs, inserts new ones.
        // Rows NOT in $users are left in place (use deleteUser() to remove explicitly).
        if (empty($users)) {
            return;
        }
        $rows = array_map([$this, 'userToRow'], $users);
        $this->upsert('/rest/v1/users', $rows, 'id');
    }

    public function findUserById(string $id): ?array
    {
        $rows = $this->get('/rest/v1/users?id=eq.' . rawurlencode($id) . '&select=*&limit=1');
        return isset($rows[0]) && is_array($rows[0]) ? $this->rowToUser($rows[0]) : null;
    }

    public function findUserByEmail(string $email): ?array
    {
        // email is stored lower-cased at write time; normalize the lookup too.
        $normalizedEmail = mb_strtolower(trim($email), 'UTF-8');
        $rows = $this->get('/rest/v1/users?email=eq.' . rawurlencode($normalizedEmail) . '&select=*&limit=1');
        return isset($rows[0]) && is_array($rows[0]) ? $this->rowToUser($rows[0]) : null;
    }

    public function upsertUser(array $user): void
    {
        $row = $this->userToRow($user);
        $this->upsert('/rest/v1/users', [$row], 'id');
    }

    public function deleteUser(string $id): void
    {
        $this->delete('/rest/v1/users?id=eq.' . rawurlencode($id));
    }

    // ─── Audit log ───────────────────────────────────────────────────────────

    public function appendAuditLog(array $entry): void
    {
        $row = [
            'event'      => (string)($entry['event'] ?? ''),
            'user_id'    => isset($entry['userId']) && $entry['userId'] !== null ? (string)$entry['userId'] : null,
            'ip'         => isset($entry['ip']) && $entry['ip'] !== '' ? (string)$entry['ip'] : null,
            'context'    => isset($entry['context']) ? $entry['context'] : null,
            'created_at' => isset($entry['time']) && $entry['time'] !== '' ? (string)$entry['time'] : null,
        ];
        // Remove nulls for context only if genuinely absent
        if ($row['context'] === null) {
            unset($row['context']);
        }
        if ($row['created_at'] === null) {
            unset($row['created_at']);
        }
        $this->post('/rest/v1/audit_log', $row);
    }

    // ─── Clients ─────────────────────────────────────────────────────────────

    public function readClients(): array
    {
        $rows = $this->get('/rest/v1/clients?select=*&order=slug.asc');
        return array_map([$this, 'rowToClient'], $rows);
    }

    public function findClientBySlug(string $slug): ?array
    {
        $rows = $this->get('/rest/v1/clients?slug=eq.' . rawurlencode($slug) . '&select=*&limit=1');
        return isset($rows[0]) && is_array($rows[0]) ? $this->rowToClient($rows[0]) : null;
    }

    // ─── Row ↔ domain mappers ─────────────────────────────────────────────────

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function rowToUser(array $row): array
    {
        $meta = is_array($row['meta'] ?? null) ? $row['meta'] : [];
        return [
            'id'            => (string)($row['id'] ?? ''),
            'name'          => (string)($row['name'] ?? ''),
            'email'         => (string)($row['email'] ?? ''),
            'password'      => (string)($row['password_hash'] ?? ''),
            'documentType'  => (string)($meta['documentType'] ?? $row['document_type'] ?? 'cpf'),
            'documentValue' => (string)($meta['documentValue'] ?? $row['document_value'] ?? ''),
            'cpf'           => (string)($meta['cpf'] ?? ''),
            'role'          => (string)($row['role'] ?? 'client'),
            'status'        => (string)($row['status'] ?? 'pending'),
            'clientSlug'    => (string)($row['client_slug'] ?? ''),
            'createdAt'     => (string)($row['created_at'] ?? ''),
            'updatedAt'     => (string)($row['updated_at'] ?? ''),
        ];
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function userToRow(array $user): array
    {
        $row = [
            'id'            => (string)($user['id'] ?? ''),
            'name'          => (string)($user['name'] ?? ''),
            'email'         => mb_strtolower(trim((string)($user['email'] ?? '')), 'UTF-8'),
            'password_hash' => (string)($user['password'] ?? ''),
            'role'          => (string)($user['role'] ?? 'client'),
            'status'        => (string)($user['status'] ?? 'pending'),
            'client_slug'   => (string)($user['clientSlug'] ?? ''),
            'meta'          => [
                'documentType'  => (string)($user['documentType'] ?? 'cpf'),
                'documentValue' => (string)($user['documentValue'] ?? ''),
                'cpf'           => (string)($user['cpf'] ?? ''),
            ],
        ];

        // Remove empty id — PostgREST will treat missing id as server default.
        if ($row['id'] === '') {
            unset($row['id']);
        }

        return $row;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function rowToClient(array $row): array
    {
        $config = is_array($row['config'] ?? null) ? $row['config'] : [];
        return [
            'slug'              => (string)($row['slug'] ?? ''),
            'display_name'      => (string)($row['display_name'] ?? ''),
            'cliente_name_var'  => (string)($config['cliente_name_var'] ?? ''),
            'cliente_task_id'   => (string)($config['cliente_task_id'] ?? ''),
            'cf_tipos'          => is_array($config['cf_tipos'] ?? null) ? $config['cf_tipos'] : [],
            'assignee_ids'      => is_array($config['assignee_ids'] ?? null) ? $config['assignee_ids'] : [],
            'auto_map'          => is_array($config['auto_map'] ?? null) ? $config['auto_map'] : [],
            'css_card_bg'       => (string)($config['css_card_bg'] ?? '#ffffff'),
            'dropdown_indent_quirk' => (bool)($config['dropdown_indent_quirk'] ?? true),
        ];
    }

    // ─── HTTP helpers ─────────────────────────────────────────────────────────

    /**
     * HTTP GET → returns decoded array of rows.
     *
     * @return array<int, array<string, mixed>>
     */
    private function get(string $path): array
    {
        [$status, $body] = $this->curlRequest('GET', $path, null, []);
        if ($status < 200 || $status >= 300) {
            throw new StorageException("Supabase GET {$path} returned HTTP {$status}: {$body}");
        }
        $decoded = json_decode($body, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * HTTP POST (insert). Returns decoded response.
     *
     * @param array<string, mixed> $payload
     * @return array<mixed>
     */
    private function post(string $path, array $payload): array
    {
        [$status, $body] = $this->curlRequest('POST', $path, $payload, []);
        if ($status < 200 || $status >= 300) {
            throw new StorageException("Supabase POST {$path} returned HTTP {$status}: {$body}");
        }
        $decoded = json_decode($body, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * UPSERT via POST with Prefer: resolution=merge-duplicates.
     *
     * @param array<int, array<string, mixed>> $rows
     */
    private function upsert(string $path, array $rows, string $onConflict): void
    {
        $extraHeaders = [
            'Prefer: resolution=merge-duplicates,return=minimal',
        ];
        $url = $path . '?on_conflict=' . rawurlencode($onConflict);
        [$status, $body] = $this->curlRequest('POST', $url, $rows, $extraHeaders);
        if ($status < 200 || $status >= 300) {
            throw new StorageException("Supabase UPSERT {$path} returned HTTP {$status}: {$body}");
        }
    }

    /**
     * HTTP DELETE by filter URL.
     */
    private function delete(string $path): void
    {
        [$status, $body] = $this->curlRequest('DELETE', $path, null, []);
        if ($status < 200 || $status >= 300) {
            throw new StorageException("Supabase DELETE {$path} returned HTTP {$status}: {$body}");
        }
    }

    /**
     * Execute a curl request. Returns [int $httpStatus, string $body].
     *
     * Protected (not private) to allow test subclasses to override without
     * needing a real HTTP connection.
     *
     * @param array<string, mixed>|array<int, array<string, mixed>>|null $payload
     * @param array<int, string> $extraHeaders
     * @return array{int, string}
     */
    protected function curlRequest(string $method, string $path, mixed $payload, array $extraHeaders): array
    {
        $url = $this->baseUrl . $path;
        $ch  = curl_init($url);
        if ($ch === false) {
            throw new StorageException('curl_init() failed for ' . $url);
        }

        $headers = array_merge($this->defaultHeaders, $extraHeaders);

        $jsonBody = '';
        if ($payload !== null) {
            $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($encoded === false) {
                throw new StorageException('Failed to JSON-encode payload for ' . $url);
            }
            $jsonBody = $encoded;
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        if ($jsonBody !== '') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonBody);
        }

        $body   = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error  = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new StorageException("curl request to {$url} failed: {$error}");
        }

        return [$status, (string)$body];
    }
}
