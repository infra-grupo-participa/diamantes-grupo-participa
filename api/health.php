<?php
/**
 * api/health.php — Health check endpoint (público, sem auth).
 *
 * Uso: GET /api/health.php
 *
 * Retorna 200 com status JSON completo quando tudo OK.
 * Retorna 503 quando algo crítico está faltando (env vars, extensões, storage).
 * Usado por:
 *  - smoke test do CI (php-smoke.yml)
 *  - smoke test pós-deploy (deploy-prod.yml / deploy-homolog.yml)
 *  - monitoramento externo
 *
 * @version 1.0
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

$root = dirname(__DIR__);

$checks = [
    'status' => 'ok',
    'timestamp' => date('c'),
    'php_version' => PHP_VERSION,
    'checks' => [],
];

// 1. PHP extensions
$requiredExtensions = ['curl', 'json', 'mbstring', 'openssl'];
foreach ($requiredExtensions as $ext) {
    $checks['checks']["php_ext_$ext"] = extension_loaded($ext) ? 'ok' : 'missing';
    if (!extension_loaded($ext)) {
        $checks['status'] = 'degraded';
    }
}

// 2. Composer autoload (PSR-4)
$autoload = $root . '/vendor/autoload.php';
$checks['checks']['composer_autoload'] = file_exists($autoload) ? 'ok' : 'missing';
if (!file_exists($autoload)) {
    $checks['status'] = 'degraded';
}

// 3. Storage writable (state JSON, audit log, rate limits)
$storageDir = __DIR__ . '/storage';
$checks['checks']['storage_writable'] = (is_dir($storageDir) && is_writable($storageDir)) ? 'ok' : 'unwritable';
if (!is_dir($storageDir) || !is_writable($storageDir)) {
    $checks['status'] = 'degraded';
}

// 4. Portals config present
$portalsFile = __DIR__ . '/data/portals.json';
$checks['checks']['portals_config'] = is_readable($portalsFile) ? 'ok' : 'missing';
if (!is_readable($portalsFile)) {
    $checks['status'] = 'degraded';
}

// 5. Required env vars (fail-closed for ClickUp + webhook)
$requiredEnv = [
    'GP_CLICKUP_API_KEY' => 'critical',
    'GP_CLICKUP_WEBHOOK_SECRET' => 'critical',
];
foreach ($requiredEnv as $name => $severity) {
    $value = (string)(getenv($name) ?: '');
    $present = $value !== '';
    $checks['checks']['env_' . strtolower($name)] = $present ? 'ok' : 'missing';
    if (!$present && $severity === 'critical') {
        $checks['status'] = 'degraded';
    }
}

// 6. Optional env vars (informational)
$optionalEnv = [
    'GP_APP_BASE_URL',
    'GP_MAIL_FROM_EMAIL',
    'GP_SHEETS_SYNC_URL',
    'GP_SUPABASE_URL',
    'GP_STORAGE_DRIVER',
    'GP_PORTALS_SOURCE',
];
foreach ($optionalEnv as $name) {
    $value = (string)(getenv($name) ?: '');
    $checks['checks']['env_' . strtolower($name)] = $value !== '' ? 'configured' : 'default';
}

// 7. ClickUp API connectivity (only when key is present, lightweight HEAD on /user)
if (($checks['checks']['env_gp_clickup_api_key'] ?? 'missing') === 'ok') {
    $apiKey = (string)getenv('GP_CLICKUP_API_KEY');
    $ch = curl_init('https://api.clickup.com/api/v2/user');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_NOBODY => true,
        CURLOPT_HTTPHEADER => ['Authorization: ' . $apiKey],
    ]);
    curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($httpCode === 200) {
        $checks['checks']['clickup_api'] = 'ok';
    } elseif ($httpCode === 401) {
        $checks['checks']['clickup_api'] = 'invalid_token';
        $checks['status'] = 'degraded';
    } elseif ($httpCode === 0) {
        $checks['checks']['clickup_api'] = 'unreachable';
    } else {
        $checks['checks']['clickup_api'] = 'http_' . $httpCode;
    }
}

http_response_code($checks['status'] === 'ok' ? 200 : 503);
echo json_encode($checks, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
