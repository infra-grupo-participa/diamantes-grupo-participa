<?php

declare(strict_types=1);

namespace Diamantes\Storage;

use Diamantes\Http\JsonResponse;
use Diamantes\Http\Request;

/**
 * Read/write the application state JSON file with exclusive locking.
 *
 * Mirrors the logic of gp_read_state(), gp_update_state(), gp_read_json_file(),
 * gp_write_json_file(), gp_append_log_line(), and gp_ensure_storage() from
 * api/bootstrap.php — behaviour is bit-for-bit identical.
 */
final class StateRepository
{
    private string $storageDir;
    private string $stateFile;

    public function __construct(string $storageDir, string $stateFile)
    {
        $this->storageDir = $storageDir;
        $this->stateFile = $stateFile;
    }

    /**
     * Ensure the storage directory exists.
     *
     * Sends HTTP 500 and exits on failure.
     */
    public function ensureStorage(): void
    {
        if (!is_dir($this->storageDir)
            && !mkdir($this->storageDir, 0775, true)
            && !is_dir($this->storageDir)
        ) {
            JsonResponse::send(['ok' => false, 'error' => 'Não foi possível preparar o storage.'], 500);
        }
    }

    /**
     * Read a JSON file from disk, returning $fallback on any failure.
     *
     * @param array<mixed> $fallback
     * @return array<mixed>
     */
    public function readJsonFile(string $path, array $fallback): array
    {
        if (!is_file($path)) {
            return $fallback;
        }
        $contents = file_get_contents($path);
        if ($contents === false || trim($contents) === '') {
            return $fallback;
        }
        $decoded = json_decode($contents, true);
        return is_array($decoded) ? $decoded : $fallback;
    }

    /**
     * Atomically write an array as JSON to $path (temp-rename strategy).
     *
     * @param array<mixed> $value
     */
    public function writeJsonFile(string $path, array $value): void
    {
        $this->ensureStorage();
        $tempPath = $path . '.tmp';
        $payload = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            JsonResponse::send(['ok' => false, 'error' => 'Falha ao serializar dados.'], 500);
        }
        if (file_put_contents($tempPath, $payload, LOCK_EX) === false || !rename($tempPath, $path)) {
            @unlink($tempPath);
            JsonResponse::send(['ok' => false, 'error' => 'Falha ao salvar dados.'], 500);
        }
    }

    /**
     * Append a single JSONL line to $path. Best-effort — never throws.
     *
     * @param array<mixed> $value
     */
    public function appendLogLine(string $path, array $value): void
    {
        $this->ensureStorage();
        $payload = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            return;
        }
        @file_put_contents($path, $payload . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    /**
     * Read the application state from disk (normalizes on read).
     *
     * @return array<string, mixed>
     */
    public function read(callable $normalizer, callable $defaultState): array
    {
        $this->ensureStorage();
        if (!is_file($this->stateFile)) {
            $default = $defaultState();
            $this->writeJsonFile($this->stateFile, $default);
            return $default;
        }

        $state = $this->readJsonFile($this->stateFile, $defaultState());
        $normalized = $normalizer($state);
        if ($normalized !== $state) {
            $this->writeJsonFile($this->stateFile, $normalized);
        }
        return $normalized;
    }

    /**
     * Apply $mutator to the state under an exclusive file lock.
     *
     * $mutator signature: (array $state): [array $nextState, mixed $result]
     *
     * Returns the $result value returned by $mutator.
     */
    public function update(callable $mutator, callable $normalizer, callable $defaultState): mixed
    {
        $this->ensureStorage();
        $handle = fopen($this->stateFile, 'c+');
        if ($handle === false) {
            JsonResponse::send(['ok' => false, 'error' => 'Falha ao abrir o storage.'], 500);
        }

        if (!flock($handle, LOCK_EX)) {
            fclose($handle);
            JsonResponse::send(['ok' => false, 'error' => 'Falha ao bloquear o storage.'], 500);
        }

        $contents = stream_get_contents($handle);
        $state = json_decode($contents ?: '', true);
        if (!is_array($state)) {
            $state = $defaultState();
        }
        $state = $normalizer($state);

        [$nextState, $result] = $mutator($state);
        $nextState = $normalizer($nextState);
        $payload = json_encode($nextState, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            flock($handle, LOCK_UN);
            fclose($handle);
            JsonResponse::send(['ok' => false, 'error' => 'Falha ao serializar o storage.'], 500);
        }

        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, $payload);
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        return $result;
    }

    /**
     * Read a secret from a plain-text file, trimming whitespace.
     *
     * Returns '' on any error.
     */
    public static function readSecretTextFile(string $path): string
    {
        if (!is_file($path)) {
            return '';
        }
        $contents = file_get_contents($path);
        if ($contents === false) {
            return '';
        }
        return trim((string)$contents);
    }
}
