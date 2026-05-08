<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

gp_require_method('POST');

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
$payload = stripos($contentType, 'multipart/form-data') !== false ? $_POST : gp_request_payload();
$clientSlug = trim((string)($payload['clientSlug'] ?? ''));

if ($clientSlug !== '') {
    gp_require_client_access($clientSlug);
} else {
    $user = gp_require_auth();
    if (($user['role'] ?? '') !== 'admin' && ($user['status'] ?? '') !== 'approved') {
        gp_json_response(['ok' => false, 'error' => 'Sessão sem acesso ao ClickUp.'], 403);
    }
}

$method = strtoupper((string)($payload['method'] ?? 'GET'));
$path = (string)($payload['path'] ?? '');
if ($path === '') {
    gp_json_response(['ok' => false, 'error' => 'Path do ClickUp é obrigatório.'], 422);
}

$body = $payload['body'] ?? null;
$files = [];
if (!empty($_FILES)) {
    foreach ($_FILES as $name => $file) {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
            $files[$name] = $file;
        }
    }
}

if (!empty($files)) {
    $multipartFields = [];
    foreach ($payload as $key => $value) {
        if (in_array($key, ['method', 'path', 'body', 'clientSlug'], true)) {
            continue;
        }
        if (is_scalar($value)) {
            $multipartFields[$key] = (string)$value;
        }
    }
    $response = gp_clickup_request($method, $path, $multipartFields, [], $files);
} else {
    $response = gp_clickup_request($method, $path, is_array($body) ? $body : ($body === '' ? null : $body), [], $files);
}

if (in_array($response['status'], [401, 403], true)) {
    $decoded = json_decode($response['body'], true);
    $details = '';
    if (is_array($decoded)) {
        foreach (['err', 'error', 'message', 'ECODE'] as $key) {
            $value = trim((string)($decoded[$key] ?? ''));
            if ($value !== '') {
                $details = $value;
                break;
            }
        }
    }

    $error = $response['status'] === 401
        ? 'Credencial do ClickUp inválida ou expirada.'
        : 'Credencial do ClickUp sem acesso a esse workspace ou recurso.';

    if ($details !== '') {
        $error .= ' ' . $details . '.';
    }

    $error .= ' Atualize GP_CLICKUP_API_KEY, CLICKUP_API_KEY ou api/data/clickup-api-key.txt.';

    gp_json_response([
        'ok' => false,
        'error' => $error,
        'clickupStatus' => $response['status'],
    ], $response['status']);
}

gp_raw_response($response['body'], $response['status'], $response['contentType']);
