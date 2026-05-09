<?php

declare(strict_types=1);

namespace Diamantes\Integrations;

use Diamantes\Http\JsonResponse;

/**
 * HTTP client for the ClickUp API.
 *
 * Security invariants preserved from bootstrap.php Fase-1 remediation:
 * - Absolute URL paths are validated: host MUST be api.clickup.com (SSRF whitelist).
 * - CURLOPT_PROTOCOLS | CURLOPT_REDIR_PROTOCOLS restricted to CURLPROTO_HTTPS only.
 * - API key sourced from env (GP_CLICKUP_API_KEY) with file fallback.
 */
final class ClickUpClient
{
    private const BASE_URL = 'https://api.clickup.com/api/v2';
    private const ALLOWED_HOST = 'api.clickup.com';

    private string $apiKey;

    public function __construct(string $apiKey)
    {
        $this->apiKey = $apiKey;
    }

    /**
     * Execute a ClickUp API request.
     *
     * @param string               $method   HTTP method (GET, POST, PUT, PATCH, DELETE).
     * @param string               $path     Relative path (e.g. "task/abc/comment") OR absolute
     *                                       URL (must point to api.clickup.com).
     * @param mixed                $body     JSON-serialisable body or null.
     * @param string[]             $extraHeaders
     * @param array<string, mixed> $files
     * @return array{status: int, body: string, contentType: string}
     */
    public function request(
        string $method,
        string $path,
        mixed $body = null,
        array $extraHeaders = [],
        array $files = [],
    ): array {
        if (str_starts_with($path, 'http')) {
            // Absolute URL: validate host is api.clickup.com (SSRF whitelist).
            $parsedHost = parse_url($path, PHP_URL_HOST);
            if ($parsedHost !== self::ALLOWED_HOST) {
                JsonResponse::send(['ok' => false, 'error' => 'Host não permitido para requisição ClickUp.'], 422);
            }
            $url = $path;
        } else {
            $url = rtrim(self::BASE_URL, '/') . '/' . ltrim($path, '/');
        }

        if ($this->apiKey === '') {
            JsonResponse::send([
                'ok' => false,
                'error' => 'Chave do ClickUp não configurada. Defina GP_CLICKUP_API_KEY, CLICKUP_API_KEY ou api/data/clickup-api-key.txt.',
            ], 500);
        }

        $headers = array_merge(['Authorization: ' . $this->apiKey], $extraHeaders);
        return self::httpRequest($method, $url, $body, $headers, $files);
    }

    /**
     * Low-level cURL wrapper. Restricted to HTTPS-only protocols.
     *
     * @param string[]             $headers
     * @param array<string, mixed> $files
     * @return array{status: int, body: string, contentType: string}
     */
    public static function httpRequest(
        string $method,
        string $url,
        mixed $body = null,
        array $headers = [],
        array $files = [],
    ): array {
        if (!function_exists('curl_init')) {
            JsonResponse::send(['ok' => false, 'error' => 'cURL não está disponível nessa hospedagem.'], 500);
        }

        $curl = curl_init($url);

        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 45,
            // CRITICAL-1: restrict protocols to HTTPS only — prevents SSRF to http/ftp/file/etc.
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        ]);

        if (!empty($files)) {
            $multipart = [];
            foreach ($body as $key => $value) {
                $multipart[$key] = $value;
            }
            foreach ($files as $name => $file) {
                $multipart[$name] = curl_file_create(
                    $file['tmp_name'],
                    $file['type'] ?: 'application/octet-stream',
                    $file['name']
                );
            }
            curl_setopt($curl, CURLOPT_POSTFIELDS, $multipart);
        } elseif ($body !== null) {
            if (!in_array('Content-Type: application/json', $headers, true)) {
                $headers[] = 'Content-Type: application/json';
                curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);
            }
            curl_setopt(
                $curl,
                CURLOPT_POSTFIELDS,
                is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            );
        }

        $response = curl_exec($curl);
        if ($response === false) {
            $error = curl_error($curl);
            curl_close($curl);
            JsonResponse::send(['ok' => false, 'error' => 'Falha ao falar com o ClickUp: ' . $error], 502);
        }

        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $headerSize = (int)curl_getinfo($curl, CURLINFO_HEADER_SIZE);
        $headerBlock = substr($response, 0, $headerSize);
        $bodyBlock = substr($response, $headerSize);
        curl_close($curl);

        $contentType = 'application/json; charset=utf-8';
        foreach (explode("\r\n", $headerBlock) as $headerLine) {
            if (stripos($headerLine, 'Content-Type:') === 0) {
                $contentType = trim(substr($headerLine, strlen('Content-Type:')));
                break;
            }
        }

        return [
            'status' => $status,
            'body' => $bodyBlock,
            'contentType' => $contentType,
        ];
    }

    /**
     * Convenience: fetch a ClickUp task by ID.
     *
     * @return array<string, mixed>
     */
    public function getTask(string $taskId): array
    {
        $response = $this->request('GET', 'task/' . rawurlencode($taskId));
        $decoded = json_decode($response['body'] ?? '[]', true);
        if (($response['status'] ?? 500) >= 400 || !is_array($decoded)) {
            throw new \RuntimeException('Não foi possível carregar a task no ClickUp.');
        }
        return $decoded;
    }
}
