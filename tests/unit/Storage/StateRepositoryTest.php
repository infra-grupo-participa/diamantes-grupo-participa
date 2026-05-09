<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Storage;

use Diamantes\Storage\StateRepository;
use PHPUnit\Framework\TestCase;

final class StateRepositoryTest extends TestCase
{
    private string $tmpDir;
    private string $stateFile;

    protected function setUp(): void
    {
        $this->tmpDir = sys_get_temp_dir() . '/gp_state_test_' . uniqid('', true);
        mkdir($this->tmpDir, 0775, true);
        $this->stateFile = $this->tmpDir . '/app-state.json';
    }

    protected function tearDown(): void
    {
        foreach (glob($this->tmpDir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->tmpDir);
    }

    private function repo(): StateRepository
    {
        return new StateRepository($this->tmpDir, $this->stateFile);
    }

    public function testReadJsonFileReturnsFallbackWhenFileMissing(): void
    {
        $repo = $this->repo();
        $result = $repo->readJsonFile('/nonexistent/file.json', ['default' => true]);
        $this->assertSame(['default' => true], $result);
    }

    public function testWriteJsonFileAndReadBack(): void
    {
        $repo = $this->repo();
        $data = ['users' => [], 'version' => 1];
        $repo->writeJsonFile($this->stateFile, $data);

        $result = $repo->readJsonFile($this->stateFile, []);
        $this->assertSame($data, $result);
    }

    public function testWriteJsonFileIsAtomicViaTempRename(): void
    {
        $repo = $this->repo();
        $repo->writeJsonFile($this->stateFile, ['step' => 1]);

        // Verify no .tmp file remains.
        $this->assertFileDoesNotExist($this->stateFile . '.tmp');
    }

    public function testAppendLogLineCreatesValidJsonl(): void
    {
        $repo = $this->repo();
        $logFile = $this->tmpDir . '/test.jsonl';
        $repo->appendLogLine($logFile, ['event' => 'test', 'ok' => true]);
        $repo->appendLogLine($logFile, ['event' => 'test2', 'ok' => false]);

        $lines = array_filter(explode(PHP_EOL, trim(file_get_contents($logFile))));
        $this->assertCount(2, $lines);

        foreach ($lines as $line) {
            $decoded = json_decode($line, true);
            $this->assertIsArray($decoded);
            $this->assertArrayHasKey('event', $decoded);
        }
    }

    public function testReadSecretTextFileReturnsEmptyForMissingFile(): void
    {
        $result = StateRepository::readSecretTextFile('/nonexistent/secret.txt');
        $this->assertSame('', $result);
    }

    public function testReadSecretTextFileTrimResult(): void
    {
        $secretFile = $this->tmpDir . '/secret.txt';
        file_put_contents($secretFile, "  my-secret-key  \n");
        $result = StateRepository::readSecretTextFile($secretFile);
        $this->assertSame('my-secret-key', $result);
    }

    public function testEnsureStorageCreatesDirectory(): void
    {
        $nestedDir = $this->tmpDir . '/nested/storage';
        $repo = new StateRepository($nestedDir, $nestedDir . '/state.json');
        $repo->ensureStorage();
        $this->assertDirectoryExists($nestedDir);
        // Cleanup
        @rmdir($nestedDir);
        @rmdir(dirname($nestedDir));
    }
}
