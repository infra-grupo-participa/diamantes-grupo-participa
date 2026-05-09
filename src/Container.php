<?php

declare(strict_types=1);

namespace Diamantes;

use Diamantes\Auth\AuditLogger;
use Diamantes\Auth\RateLimiter;
use Diamantes\Integrations\ClickUpClient;
use Diamantes\Integrations\Mailer;
use Diamantes\Integrations\SheetsSync;
use Diamantes\Storage\StateRepository;

/**
 * Simple service factory / registry.
 *
 * Builds each service once (lazy singleton) and injects storage paths and
 * environment-sourced configs. No reflection, no third-party DI container.
 */
final class Container
{
    private static ?self $instance = null;

    private string $storageDir;
    private string $dataDir;
    private string $stateFile;
    private string $auditLogFile;
    private string $rateLimitFile;
    private string $notificationLogFile;

    /** @var array<string, object> */
    private array $services = [];

    private function __construct(
        string $storageDir,
        string $dataDir,
        string $stateFile,
        string $auditLogFile,
        string $rateLimitFile,
        string $notificationLogFile,
    ) {
        $this->storageDir = $storageDir;
        $this->dataDir = $dataDir;
        $this->stateFile = $stateFile;
        $this->auditLogFile = $auditLogFile;
        $this->rateLimitFile = $rateLimitFile;
        $this->notificationLogFile = $notificationLogFile;
    }

    /**
     * Bootstrap the container from the standard GP_* constants.
     *
     * Safe to call multiple times — returns the same singleton.
     */
    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self(
                storageDir: GP_STORAGE_DIR,
                dataDir: GP_DATA_DIR,
                stateFile: GP_STATE_FILE,
                auditLogFile: GP_AUDIT_LOG_FILE,
                rateLimitFile: GP_RATE_LIMIT_FILE,
                notificationLogFile: GP_NOTIFICATION_LOG_FILE,
            );
        }
        return self::$instance;
    }

    /**
     * Reset singleton — intended for unit tests only.
     */
    public static function reset(): void
    {
        self::$instance = null;
    }

    // ─── Service accessors ────────────────────────────────────────────────────

    public function stateRepository(): StateRepository
    {
        return $this->make('stateRepository', fn() => new StateRepository(
            $this->storageDir,
            $this->stateFile,
        ));
    }

    public function auditLogger(): AuditLogger
    {
        return $this->make('auditLogger', fn() => new AuditLogger($this->auditLogFile));
    }

    public function rateLimiter(): RateLimiter
    {
        return $this->make('rateLimiter', fn() => new RateLimiter($this->rateLimitFile));
    }

    public function clickUpClient(): ClickUpClient
    {
        return $this->make('clickUpClient', fn() => new ClickUpClient($this->resolveClickUpApiKey()));
    }

    public function sheetsSync(): SheetsSync
    {
        return $this->make('sheetsSync', fn() => new SheetsSync(
            SheetsSync::urlFromEnv(),
            SheetsSync::secretFromEnv(),
        ));
    }

    public function mailer(): Mailer
    {
        return $this->make('mailer', fn() => new Mailer(
            Mailer::fromEmailFromEnv(),
            Mailer::fromNameFromEnv(),
            $this->notificationLogFile,
        ));
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    /**
     * @template T of object
     * @param callable(): T $factory
     * @return T
     */
    private function make(string $key, callable $factory): mixed
    {
        if (!isset($this->services[$key])) {
            $this->services[$key] = $factory();
        }
        return $this->services[$key];
    }

    private function resolveClickUpApiKey(): string
    {
        $config = [];
        $configFile = $this->dataDir . '/clickup-config.json';
        if (is_file($configFile)) {
            $raw = file_get_contents($configFile);
            $decoded = $raw !== false ? json_decode($raw, true) : null;
            $config = is_array($decoded) ? $decoded : [];
        }

        $candidates = [
            getenv('GP_CLICKUP_API_KEY') ?: '',
            getenv('CLICKUP_API_KEY') ?: '',
            StateRepository::readSecretTextFile($this->dataDir . '/clickup-api-key.txt'),
            trim((string)($config['apiKey'] ?? '')),
            trim((string)($config['clickupApiKey'] ?? '')),
            trim((string)($config['token'] ?? '')),
        ];

        foreach ($candidates as $candidate) {
            $value = trim((string)$candidate);
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }
}
